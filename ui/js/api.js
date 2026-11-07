// Talks to the hauling service: the port and token come from Rust (`service_info`),
// the state arrives by Server-Sent Events, the actions go by POST.

export function createApi({ invoke, fetchImpl = globalThis.fetch, EventSourceImpl = globalThis.EventSource }) {
  const listeners = new Set();
  let info = null;
  let source = null;
  let state = { status: "connecting", ui: null, error: null };

  function set(patch) {
    state = { ...state, ...patch };
    for (const fn of listeners) fn(state);
  }

  function base() {
    return `http://127.0.0.1:${info.port}`;
  }

  async function start() {
    try {
      info = await invoke("service_info");
    } catch (e) {
      set({ status: "error", error: String(e) });
      return;
    }
    if (info.error) {
      set({ status: "error", error: info.error });
      return;
    }
    open();
  }

  function open() {
    source = new EventSourceImpl(`${base()}/events?token=${encodeURIComponent(info.token)}`);
    source.addEventListener("ui", (e) => {
      try {
        set({ status: "ok", ui: JSON.parse(e.data), error: null });
      } catch {
        set({ status: "error", error: "bad data from the service" });
      }
    });
    // EventSource reconnects by itself (the service asks for 2 s), unless the answer was a refusal.
    source.onerror = async () => {
      if (source && source.readyState === 2) {
        set({ status: "error", error: "the service refused the connection" });
        return;
      }
      set({ status: "reconnecting" });
      try {
        const now = await invoke("service_info"); // did the service stop?
        if (now.error) set({ status: "error", error: now.error });
      } catch {
        // keep "reconnecting"
      }
    };
  }

  async function action(type, payload = {}) {
    if (!info || info.error) throw new Error("service not running");
    let answer;
    let response;
    try {
      response = await fetchImpl(`${base()}/action`, {
        method: "POST",
        headers: { Authorization: `Bearer ${info.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ type, ...payload }),
      });
      answer = await response.json();
    } catch {
      throw new Error("service did not answer");
    }
    if (!response.ok || !answer || !answer.ok) throw new Error((answer && answer.error) || `HTTP ${response.status}`);
  }

  function subscribe(fn) {
    listeners.add(fn);
    fn(state);
    return () => listeners.delete(fn);
  }

  function stop() {
    if (source) source.close();
    source = null;
  }

  // Only the port: widgets (a map in a frame) need it, the token stays here.
  return { start, stop, action, subscribe, get state() { return state; }, get port() { return info && !info.error ? info.port : null; } };
}

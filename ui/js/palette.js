import { h } from "./dom.js";
import { moveSelection, rowsOf } from "./rows.js";

const DEBOUNCE_MS = 250;

/**
 * The search bar in the middle of the screen (Alt+P). root holds #palette-input, #palette-status, #palette-results.
 * handlers: addToList(name), setStart(place), viewOnMap(place), setShip(name): the overlay does the work.
 * onEscape(): Escape was pressed (the overlay goes back to game mode). onClose(): the palette closed by itself.
 */
export function createPalette({ root, search, getPlace, handlers, onEscape = () => {}, debounceMs = DEBOUNCE_MS, input: field = null }) {
  // `input`: a field outside root (the one in the bar): the results are then a list under it, opened when it gets the focus
  const input = field || root.querySelector("#palette-input");
  const external = Boolean(field);
  const status = root.querySelector("#palette-status");
  const list = root.querySelector("#palette-results");
  const details = new Map(); // row key -> text under the row (time at a place...)
  let rows = [];
  let selected = -1;
  let generation = 0;
  let timer = null;

  const isOpen = () => !root.hidden;

  function bound() {
    const run = (fn) => async (...args) => {
      try {
        await fn(...args);
      } catch (e) {
        status.textContent = String((e && e.message) || e);
      }
    };
    return {
      addToList: run(handlers.addToList),
      setStart: run(handlers.setStart),
      setShip: run(handlers.setShip),
      viewOnMap: run(async (place) => {
        await handlers.viewOnMap(place);
        close();
      }),
      showTime: async (place) => {
        const key = `place:${place}`;
        details.set(key, "Loading the time...");
        render();
        details.set(key, (await search.timeAt(place)) || "Time unknown here");
        render();
      },
    };
  }

  function render() {
    list.replaceChildren(...rows.map((row, i) => {
      const extra = details.get(row.key) || row.detail;
      return h("div", { class: `result${i === selected ? " selected" : ""}`, "data-kind": row.kind },
        h("div", { class: "result-head" },
          h("strong", { text: row.title }),
          row.subtitle ? h("span", { class: "muted", text: ` ${row.subtitle}` }) : null),
        extra ? h("p", { class: "muted", text: extra }) : null,
        (row.shops || []).map((s) => h("div", { class: "row" }, h("span", { text: s.text }), s.actions.map(button))),
        h("div", { class: "row" }, row.actions.map(button)));
    }));
    const chosen = list.querySelector(".selected");
    if (chosen && chosen.scrollIntoView) chosen.scrollIntoView({ block: "nearest" });
  }

  const button = (action) => h("button", { type: "button", class: "small", text: action.label, onclick: () => action.run() });

  async function run() {
    const mine = ++generation;
    const text = input.value;
    status.textContent = text.trim() ? "Searching..." : "";
    const results = await search.search(text, getPlace());
    if (mine !== generation) return; // a newer search is on its way
    rows = rowsOf(results, bound());
    selected = rows.length ? 0 : -1;
    details.clear();
    render();
    status.textContent = results.errors.length ? results.errors.join(" · ") : text.trim().length >= 2 && !rows.length ? "No result" : "";
  }

  function open() {
    root.hidden = false;
    input.value = "";
    rows = [];
    selected = -1;
    generation++;
    details.clear();
    render();
    status.textContent = "Search a place, a ship or an item";
    input.focus();
  }

  /** The field got the focus (a click in the bar): show the list, keep what was typed. */
  function show() {
    if (!root.hidden) return;
    root.hidden = false;
    if (!input.value.trim()) status.textContent = "Search a place, a ship or an item";
    else run();
  }

  function close() {
    generation++;
    clearTimeout(timer);
    root.hidden = true;
  }

  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(run, debounceMs);
  });

  const onKey = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      onEscape();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      selected = moveSelection(selected, e.key === "ArrowDown" ? 1 : -1, rows.length);
      render();
    } else if (e.key === "Enter" && e.target === input && rows[selected]) {
      e.preventDefault();
      rows[selected].primary.run();
    }
  };
  root.addEventListener("keydown", onKey);
  if (external) {
    input.addEventListener("keydown", onKey);
    input.addEventListener("focus", show);
    // A click anywhere else closes the list (the field keeps its text)
    document.addEventListener("pointerdown", (e) => {
      if (!root.hidden && !root.contains(e.target) && e.target !== input) close();
    });
  }

  return { open, close, isOpen, toggle: () => {
    if (!isOpen()) return open();
    close();
    onEscape(); // same as Escape: back to game mode
  } };
}

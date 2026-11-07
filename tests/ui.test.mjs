import assert from "node:assert/strict";
import test from "node:test";

import { createApi } from "../ui/js/api.js";

class FakeSource {
  static last = null;
  constructor(url) {
    this.url = url;
    this.handlers = {};
    this.closed = false;
    FakeSource.last = this;
  }
  addEventListener(name, fn) {
    this.handlers[name] = fn;
  }
  close() {
    this.closed = true;
  }
}

const info = { port: 4242, token: "tok en", error: null };

test("start connects to /events with the token in the query", async () => {
  const api = createApi({ invoke: async () => info, EventSourceImpl: FakeSource });
  await api.start();
  assert.equal(FakeSource.last.url, "http://127.0.0.1:4242/events?token=tok%20en");
});

test("a ui event becomes the state", async () => {
  const api = createApi({ invoke: async () => info, EventSourceImpl: FakeSource });
  await api.start();
  FakeSource.last.handlers.ui({ data: JSON.stringify({ status: "hi" }) });
  assert.equal(api.state.status, "ok");
  assert.equal(api.state.ui.status, "hi");
  FakeSource.last.handlers.ui({ data: "{broken" });
  assert.equal(api.state.status, "error");
});

test("an error from Rust shows and nothing connects", async () => {
  FakeSource.last = null;
  const api = createApi({ invoke: async () => ({ port: 0, token: "", error: "service not found" }), EventSourceImpl: FakeSource });
  await api.start();
  assert.equal(api.state.status, "error");
  assert.equal(api.state.error, "service not found");
  assert.equal(FakeSource.last, null);
});

test("a failing invoke shows as an error", async () => {
  const api = createApi({ invoke: async () => { throw new Error("no ipc"); }, EventSourceImpl: FakeSource });
  await api.start();
  assert.equal(api.state.status, "error");
});

test("connection loss shows reconnecting", async () => {
  const api = createApi({ invoke: async () => info, EventSourceImpl: FakeSource });
  await api.start();
  FakeSource.last.onerror();
  assert.equal(api.state.status, "reconnecting");
});

test("a closed stream (refused) is an error, not a reconnection", async () => {
  const api = createApi({ invoke: async () => info, EventSourceImpl: FakeSource });
  await api.start();
  FakeSource.last.readyState = 2;
  await FakeSource.last.onerror();
  assert.equal(api.state.status, "error");
});

test("a service that stopped is reported while reconnecting", async () => {
  let calls = 0;
  const invoke = async () => (++calls === 1 ? info : { ...info, error: "service stopped (exit code: 3)" });
  const api = createApi({ invoke, EventSourceImpl: FakeSource });
  await api.start();
  await FakeSource.last.onerror();
  assert.equal(api.state.status, "error");
  assert.match(api.state.error, /stopped/);
});

test("a null answer from /action is an error, not a crash", async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => null });
  const api = createApi({ invoke: async () => info, fetchImpl, EventSourceImpl: FakeSource });
  await api.start();
  await assert.rejects(api.action("read_page"), /HTTP 200/);
});

test("action posts JSON with the bearer token", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push([url, init]);
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  const api = createApi({ invoke: async () => info, fetchImpl, EventSourceImpl: FakeSource });
  await api.start();
  await api.action("set_start", { place: "Area18" });
  const [url, init] = calls[0];
  assert.equal(url, "http://127.0.0.1:4242/action");
  assert.equal(init.headers.Authorization, "Bearer tok en");
  assert.deepEqual(JSON.parse(init.body), { type: "set_start", place: "Area18" });
});

test("action throws the service's error", async () => {
  const fetchImpl = async () => ({ ok: false, status: 400, json: async () => ({ ok: false, error: "unknown place" }) });
  const api = createApi({ invoke: async () => info, fetchImpl, EventSourceImpl: FakeSource });
  await api.start();
  await assert.rejects(api.action("set_start", { place: "x" }), /unknown place/);
});

test("action without a running service refuses", async () => {
  const api = createApi({ invoke: async () => ({ ...info, error: "down" }), EventSourceImpl: FakeSource });
  await api.start();
  await assert.rejects(api.action("read_page"), /not running/);
});

test("stop closes the stream", async () => {
  const api = createApi({ invoke: async () => info, EventSourceImpl: FakeSource });
  await api.start();
  api.stop();
  assert.ok(FakeSource.last.closed);
});

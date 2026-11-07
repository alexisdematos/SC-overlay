import assert from "node:assert/strict";
import test from "node:test";

import { clock, duration, localLabel, money, parseTime, secondsUntil, sureLabel } from "../ui/js/format.js";
import { alertsOf } from "../ui/js/widgets/alerts.js";

test("duration", () => {
  assert.equal(duration(3725), "1h02m05s");
  assert.equal(duration(125), "2m05s");
  assert.equal(duration(9), "9s");
  assert.equal(duration(-4), "0s");
  assert.equal(duration(NaN), "0s");
  assert.equal(duration(null), "0s");
});

test("money", () => {
  assert.equal(money(1234567), "1,234,567");
  assert.equal(money(45000, true), "45k");
  assert.equal(money(45500, true), "45.5k");
  assert.equal(money(999, true), "999");
  assert.equal(money(-2400, true), "-2.4k");
  assert.equal(money(undefined), "?");
});

test("times", () => {
  assert.equal(parseTime("nope"), null);
  assert.equal(secondsUntil("2026-01-01T00:10:00Z", Date.parse("2026-01-01T00:00:00Z")), 600);
  assert.equal(secondsUntil(null, 0), null);
  assert.match(clock("2026-01-01T12:34:00Z", "en-GB"), /^\d\d:\d\d$/);
  assert.equal(clock("bad"), "");
});

test("sureLabel follows the service marks", () => {
  assert.equal(sureLabel(""), "");
  assert.equal(sureLabel("~"), "guessed");
  assert.equal(sureLabel("?"), "unknown");
});

test("alertsOf gathers every problem and is empty when all is well", () => {
  assert.deepEqual(alertsOf({ ui: null, state: { status: "ok" } }), []);
  assert.deepEqual(alertsOf({ ui: { warnings: [] }, state: { status: "ok" } }), []);
  const out = alertsOf({
    ui: { warnings: ["patch"], team: { error: "x", readError: "y" }, trade: { on: true, error: "z" } },
    state: { status: "error", error: "down" },
  });
  assert.deepEqual(out, ["Service: down", "patch", "Team: x", "Team: y", "Trade: z"]);
  assert.deepEqual(alertsOf({ ui: { trade: { on: false, error: "z" } }, state: { status: "reconnecting" } }), ["Service: reconnecting..."]);
});

test("localLabel says the time at the place and marks the night", () => {
  assert.equal(localLabel({ clock: "14:20", phase: "Afternoon", day: true }), "14:20 afternoon");
  assert.equal(localLabel({ clock: "03:10", phase: "Night", day: false }), "03:10 night ☾");
  assert.equal(localLabel({ clock: "03:10" }), "03:10");
  assert.equal(localLabel(null), "");
  assert.equal(localLabel({}), "");
});

import { mapSrc } from "../ui/js/widgets/map.js";

test("mapSrc builds the embed address from the site origin and the service port", () => {
  assert.equal(mapSrc("https://versetime.ofs.workers.dev", 4242), "https://versetime.ofs.workers.dev/?embed&bg=transparent&fps=30&live=4242");
  assert.equal(mapSrc("http://127.0.0.1:8093/some/page?x=1", 7), "http://127.0.0.1:8093/?embed&bg=transparent&fps=30&live=7");
  assert.equal(mapSrc("https://versetime.ofs.workers.dev", null), "https://versetime.ofs.workers.dev/?embed&bg=transparent&fps=30");
  assert.throws(() => mapSrc("not a url", 1));
});

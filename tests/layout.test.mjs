import assert from "node:assert/strict";
import test from "node:test";

import { clampRect, isShown, nextGameView, normalizeBox, parseLayout, serializeLayout, snap } from "../ui/js/layout.js";

const view = { width: 1000, height: 500 };
const defs = [
  { type: "a", defaults: { x: 10, y: 20, w: 300, h: 200, pinned: true } },
  { type: "b", defaults: { x: 400, y: 20, w: 300, h: 200, pinned: false } },
];

test("clampRect keeps a box on screen and not too small", () => {
  assert.deepEqual(clampRect({ x: -50, y: -5, w: 200, h: 100 }, view), { x: 0, y: 0, w: 200, h: 100 });
  assert.deepEqual(clampRect({ x: 5000, y: 5000, w: 200, h: 100 }, view), { x: 800, y: 400, w: 200, h: 100 });
  assert.deepEqual(clampRect({ x: 0, y: 0, w: 10, h: 10 }, view), { x: 0, y: 0, w: 160, h: 60 });
  assert.deepEqual(clampRect({ x: 0, y: 0, w: 9000, h: 9000 }, view), { x: 0, y: 0, w: 1000, h: 500 });
});

test("snap rounds to the grid", () => {
  assert.equal(snap(13), 16);
  assert.equal(snap(11), 8);
  assert.equal(snap(0), 0);
});

test("normalizeBox fills what is missing and bounds the opacity", () => {
  const d = defs[0].defaults;
  assert.deepEqual(normalizeBox(null, d), { x: 10, y: 20, w: 300, h: 200, opacity: 0.85, pinned: true, hidden: false });
  const odd = normalizeBox({ x: "1", w: 5, opacity: 9, pinned: "yes", hidden: true }, d);
  assert.equal(odd.x, 10);
  assert.equal(odd.w, 160);
  assert.equal(odd.opacity, 1);
  assert.equal(odd.pinned, true);
  assert.equal(odd.hidden, true);
  assert.equal(normalizeBox({ opacity: 0 }, d).opacity, 0.2);
});

test("parseLayout gives defaults for bad text and drops unknown widgets", () => {
  for (const text of ["", "nope", "null", '{"version":1,"widgets":{}}']) {
    const out = parseLayout(text, defs);
    assert.deepEqual(Object.keys(out), ["a", "b"]);
    assert.equal(out.a.x, 10);
  }
  const saved = serializeLayout({ a: { x: 50, y: 60, w: 400, h: 300, opacity: 0.5, pinned: false, hidden: false }, zzz: { x: 1 } });
  const out = parseLayout(saved, defs);
  assert.deepEqual(Object.keys(out), ["a", "b"]);
  assert.equal(out.a.x, 50);
  assert.equal(out.a.opacity, 0.5);
  assert.equal(out.b.x, 400);
});

test("game mode shows pinned widgets only; hidden never shows", () => {
  const box = { pinned: true, hidden: false };
  assert.equal(isShown("game", box), true);
  assert.equal(isShown("game", { ...box, pinned: false }), false);
  assert.equal(isShown("interaction", { ...box, pinned: false }), true);
  assert.equal(isShown("edit", { ...box, hidden: true }), false);
});

test("the game view: pinned widgets, all of the profile, none; hidden ones never show", () => {
  const pinned = { hidden: false, pinned: true };
  const loose = { hidden: false, pinned: false };
  const gone = { hidden: true, pinned: true };
  assert.deepEqual([pinned, loose, gone].map((b) => isShown("game", b)), [true, false, false]);
  assert.deepEqual([pinned, loose, gone].map((b) => isShown("game", b, "pinned")), [true, false, false]);
  assert.deepEqual([pinned, loose, gone].map((b) => isShown("game", b, "all")), [true, true, false]);
  assert.deepEqual([pinned, loose, gone].map((b) => isShown("game", b, "none")), [false, false, false]);
  // the other modes ignore the view
  assert.deepEqual([pinned, loose, gone].map((b) => isShown("edit", b, "none")), [true, true, false]);
  assert.deepEqual(["pinned", "all", "none", "pinned"].map(nextGameView), ["all", "none", "pinned", "all"]);
});

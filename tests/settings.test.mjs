import assert from "node:assert/strict";
import test from "node:test";

import { serializeLayout } from "../ui/js/layout.js";
import {
  DEFAULT_DIM, DEFAULT_PROFILE, MAX_NAME, activeBoxes, addProfile, blurOf, cleanName, dimOf, hotkeysOf, nextProfile, parseSettings,
  removeProfile, renameProfile, serializeSettings, setBlur, setDim, setHotkeys,
} from "../ui/js/settings.js";

const defs = [
  { type: "a", defaults: { x: 10, y: 20, w: 300, h: 200, pinned: true } },
  { type: "b", defaults: { x: 400, y: 20, w: 300, h: 200, pinned: false } },
];
const file = (profiles, rest = {}) => JSON.stringify({ version: 1, ...rest, profiles });
const layout = (widgets) => ({ version: 2, widgets });

test("no file: the first profile is the layout of earlier versions, else the defaults", () => {
  const legacy = serializeLayout({ a: { x: 99, y: 1, w: 320, h: 100, opacity: 0.5, pinned: false, hidden: true } });
  const { settings, broken } = parseSettings("", legacy, defs);
  assert.equal(broken, false);
  assert.equal(settings.active, DEFAULT_PROFILE);
  assert.equal(activeBoxes(settings).a.x, 99);
  assert.equal(activeBoxes(settings).a.hidden, true);
  assert.equal(parseSettings("", "", defs).settings.profiles.get(DEFAULT_PROFILE).b.x, 400);
});

test("profiles and the active one are read, each box from its widget's defaults", () => {
  const text = file({ transport: layout({ a: { x: 5 } }), team: layout({}) }, { active: "team" });
  const { settings } = parseSettings(text, "", defs);
  assert.deepEqual([...settings.profiles.keys()], ["transport", "team"]);
  assert.equal(settings.active, "team");
  assert.equal(settings.profiles.get("transport").a.x, 5);
  assert.equal(settings.profiles.get("transport").a.y, 20);
});

test("an unknown or missing active profile falls back to the first", () => {
  assert.equal(parseSettings(file({ x: layout({}), y: layout({}) }, { active: "nope" }), "", defs).settings.active, "x");
  assert.equal(parseSettings(file({ x: layout({}) }), "", defs).settings.active, "x");
});

test("the hotkeys and unknown fields come back as they were", () => {
  const text = file({ x: layout({}) }, { hotkeys: { toggle: "Ctrl+F9" }, future: [1, 2] });
  const { settings } = parseSettings(text, "", defs);
  const again = JSON.parse(serializeSettings(settings));
  assert.deepEqual(again.hotkeys, { toggle: "Ctrl+F9" });
  assert.deepEqual(again.future, [1, 2]);
  assert.equal(again.version, 1);
  assert.equal(again.active, "x");
  assert.deepEqual(Object.keys(again.profiles), ["x"]);
});

test("a file that is not a settings object is broken, and still gives a usable profile", () => {
  for (const text of ["{oops", "[]", "42", "null"]) {
    const { settings, broken } = parseSettings(text, "", defs);
    assert.equal(broken, true, text);
    assert.equal(settings.profiles.size, 1);
  }
  assert.equal(parseSettings("   ", "", defs).broken, false);
});

test("profile names are trimmed, bounded, and never reserved or empty", () => {
  assert.equal(cleanName("  Transport  "), "Transport");
  assert.equal(cleanName("x".repeat(80)).length, MAX_NAME);
  for (const bad of ["", "   ", "__proto__", "constructor", "prototype", null, 3]) assert.equal(cleanName(bad), "");
  const text = '{"profiles":{"__proto__":{"widgets":{}},"ok":{"widgets":{}}}}'; // JSON.parse makes "__proto__" an own key
  assert.ok(Object.keys(JSON.parse(text).profiles).includes("__proto__"));
  assert.deepEqual([...parseSettings(text, "", defs).settings.profiles.keys()], ["ok"]);
});

test("addProfile copies the boxes and refuses an empty or taken name", () => {
  const { settings } = parseSettings("", "", defs);
  const name = addProfile(settings, " Team ", activeBoxes(settings));
  assert.equal(name, "Team");
  settings.profiles.get("Team").a.x = 777;
  assert.notEqual(activeBoxes(settings).a.x, 777);
  assert.equal(addProfile(settings, "Team", activeBoxes(settings)), "");
  assert.equal(addProfile(settings, "  ", activeBoxes(settings)), "");
  assert.equal(addProfile(settings, "__proto__", activeBoxes(settings)), "");
});

test("renameProfile keeps the order and the active profile, and refuses empty, reserved or taken names", () => {
  const { settings } = parseSettings(file({ a: layout({}), b: layout({}), c: layout({}) }, { active: "b" }), "", defs);
  const boxes = settings.profiles.get("b");
  assert.equal(renameProfile(settings, "b", " Team "), "Team");
  assert.deepEqual([...settings.profiles.keys()], ["a", "Team", "c"]);
  assert.equal(settings.active, "Team");
  assert.equal(settings.profiles.get("Team"), boxes);
  assert.equal(renameProfile(settings, "Team", "Team"), "Team");
  assert.equal(renameProfile(settings, "Team", "a"), "");
  assert.equal(renameProfile(settings, "Team", "  "), "");
  assert.equal(renameProfile(settings, "Team", "__proto__"), "");
  assert.equal(renameProfile(settings, "nope", "x"), "");
  assert.deepEqual([...settings.profiles.keys()], ["a", "Team", "c"]);
});

test("hotkeys: read from the file, written back with the other keys of the block kept", () => {
  const { settings } = parseSettings(file({ x: layout({}) }, { hotkeys: { toggle: "Ctrl+F9", other: "kept", profile: 3 } }), "", defs);
  assert.deepEqual(hotkeysOf(settings), { toggle: "Ctrl+F9" });
  setHotkeys(settings, { palette: "Alt+K", profile: "Alt+L" });
  assert.deepEqual(JSON.parse(serializeSettings(settings)).hotkeys, { toggle: "Ctrl+F9", other: "kept", profile: "Alt+L", palette: "Alt+K" });
  const bare = parseSettings("", "", defs).settings;
  assert.deepEqual(hotkeysOf(bare), {});
  setHotkeys(bare, { toggle: "Alt+O" });
  assert.deepEqual(JSON.parse(serializeSettings(bare)).hotkeys, { toggle: "Alt+O" });
});

test("the dim behind the overlay has a default, is bounded, and is kept in the file", () => {
  const { settings } = parseSettings("", "", defs);
  assert.equal(dimOf(settings), DEFAULT_DIM);
  setDim(settings, 0.3);
  assert.equal(JSON.parse(serializeSettings(settings)).dim, 0.3);
  setDim(settings, 5);
  assert.equal(dimOf(settings), 0.9);
  setDim(settings, -1);
  assert.equal(dimOf(settings), 0);
  setDim(settings, "nope");
  assert.equal(dimOf(settings), DEFAULT_DIM);
  const again = parseSettings(file({ x: layout({}) }, { dim: "dark" }), "", defs).settings;
  assert.equal(dimOf(again), DEFAULT_DIM);
  assert.equal(dimOf(parseSettings(file({ x: layout({}) }, { dim: 0.7 }), "", defs).settings), 0.7);
});

test("blur is on unless the file says false", () => {
  const { settings } = parseSettings("", "", defs);
  assert.equal(blurOf(settings), true);
  setBlur(settings, false);
  assert.equal(JSON.parse(serializeSettings(settings)).blur, false);
  assert.equal(blurOf(parseSettings(serializeSettings(settings), "", defs).settings), false);
  setBlur(settings, true);
  assert.equal(blurOf(settings), true);
  assert.equal(blurOf(parseSettings(file({ x: layout({}) }, { blur: "no" }), "", defs).settings), true);
});

test("nextProfile goes round, removeProfile keeps the last one", () => {
  const { settings } = parseSettings(file({ a: layout({}), b: layout({}), c: layout({}) }, { active: "c" }), "", defs);
  assert.equal(nextProfile(settings), "a");
  settings.active = "a";
  assert.equal(nextProfile(settings), "b");
  assert.equal(removeProfile(settings, "a"), true);
  assert.equal(settings.active, "b");
  assert.equal(removeProfile(settings, "zzz"), false);
  assert.equal(removeProfile(settings, "b"), true);
  assert.equal(removeProfile(settings, "c"), false);
  assert.equal(settings.profiles.size, 1);
  const only = parseSettings("", "", defs).settings;
  assert.equal(nextProfile(only), DEFAULT_PROFILE);
});

import assert from "node:assert/strict";
import test from "node:test";

import { comboFromEvent, comboProblem, keyName } from "../ui/js/hotkey.js";

const press = (code, mods = {}, altGraph = false) => ({
  code,
  ctrlKey: false, altKey: false, shiftKey: false, metaKey: false,
  ...mods,
  getModifierState: (name) => name === "AltGraph" && altGraph,
});

test("the key is named from its physical code, whatever the keyboard layout", () => {
  assert.equal(keyName("KeyQ"), "Q"); // the "a" key of an AZERTY keyboard has the code KeyQ
  assert.equal(keyName("Digit1"), "1");
  assert.equal(keyName("F9"), "F9");
  assert.equal(keyName("F13"), "");
  assert.equal(keyName("ArrowUp"), "ArrowUp");
  assert.equal(keyName("NumpadAdd"), "");
});

test("a combination is written with its modifiers in a fixed order", () => {
  assert.deepEqual(comboFromEvent(press("KeyO", { altKey: true })), { combo: "Alt+O" });
  assert.deepEqual(comboFromEvent(press("F9", { shiftKey: true, ctrlKey: true })), { combo: "Ctrl+Shift+F9" });
  assert.deepEqual(comboFromEvent(press("Digit7", { altKey: true, ctrlKey: true, shiftKey: true })), { combo: "Ctrl+Alt+Shift+7" });
});

test("only modifiers held: still waiting", () => {
  for (const code of ["ControlLeft", "ShiftRight", "AltLeft", "MetaLeft"]) assert.deepEqual(comboFromEvent(press(code, { altKey: true })), {});
});

test("what would take a key away from typing is refused", () => {
  assert.ok(comboFromEvent(press("KeyO")).error);
  assert.ok(comboFromEvent(press("KeyO", { shiftKey: true })).error);
  assert.deepEqual(comboFromEvent(press("F12")), { combo: "F12" });
  assert.ok(comboFromEvent(press("NumpadAdd", { altKey: true })).error);
});

test("AltGr (Ctrl+Alt on Windows) is not taken for a combination", () => {
  const r = comboFromEvent(press("KeyE", { ctrlKey: true, altKey: true }, true));
  assert.equal(r.combo, undefined);
  assert.match(r.error, /AltGr/);
});

test("comboProblem", () => {
  assert.equal(comboProblem("Alt+O"), "");
  assert.equal(comboProblem("F5"), "");
  assert.notEqual(comboProblem("O"), "");
  assert.notEqual(comboProblem("Shift+O"), "");
  assert.equal(comboProblem("Ctrl+Shift+O"), "");
});

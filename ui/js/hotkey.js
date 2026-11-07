// A shortcut typed by pressing it. Always from the physical key (event.code), never event.key: on an AZERTY keyboard
// the key that gives "a" is KeyQ, and the app names keys by position ("Alt+Q"), like the shortcut it registers.

const MODIFIER_CODES = new Set(["ControlLeft", "ControlRight", "ShiftLeft", "ShiftRight", "AltLeft", "AltRight", "MetaLeft", "MetaRight"]);
const NAMED = {
  Space: "Space", Enter: "Enter", Tab: "Tab", Backspace: "Backspace", Delete: "Delete", Insert: "Insert",
  Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown",
  ArrowUp: "ArrowUp", ArrowDown: "ArrowDown", ArrowLeft: "ArrowLeft", ArrowRight: "ArrowRight",
};

/** The key part of a shortcut for a physical key code, or "" when we do not offer it. */
export function keyName(code) {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1[0-2])$/.test(code)) return code;
  return NAMED[code] || "";
}

const isFunctionKey = (key) => /^F([1-9]|1[0-2])$/.test(key);

/** Why a combination is not allowed (it would take a key away from typing), or "" when it is. */
export function comboProblem(combo) {
  const parts = String(combo).split("+");
  const key = parts.pop();
  if (!key) return "no key";
  if (isFunctionKey(key)) return "";
  if (!parts.length) return "needs Ctrl or Alt with the key (only F1 to F12 can be alone)";
  if (parts.length === 1 && parts[0] === "Shift") return "Shift alone is not enough: add Ctrl or Alt";
  return "";
}

/**
 * What a keydown says: { combo } when a key goes with its modifiers, { error } when it cannot be used,
 * {} while only modifiers are held (still waiting for the key).
 */
export function comboFromEvent(e) {
  if (MODIFIER_CODES.has(e.code)) return {};
  // AltGr reaches the page as Ctrl+Alt: a combination nobody pressed on purpose
  if (typeof e.getModifierState === "function" && e.getModifierState("AltGraph")) return { error: "AltGr is not usable: use Ctrl, Alt or Shift" };
  const key = keyName(e.code);
  if (!key) return { error: "this key is not offered" };
  const mods = [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Super"].filter(Boolean);
  const combo = [...mods, key].join("+");
  const problem = comboProblem(combo);
  return problem ? { error: problem } : { combo };
}

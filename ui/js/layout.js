// Widget boxes: position, size, opacity, pinned, hidden. Pure helpers; overlay.js saves them in localStorage.

export const GRID = 8;
export const MIN_SIZE = { w: 160, h: 60 };
export const DEFAULT_OPACITY = 0.85;
const LAYOUT_VERSION = 2;

export function snap(value, grid = GRID) {
  return Math.round(value / grid) * grid;
}

function clamp(value, low, high) {
  return Math.min(Math.max(value, low), high);
}

/** Keep a box inside the viewport: never smaller than MIN_SIZE (unless the screen is), never off screen. */
export function clampRect(rect, viewport) {
  const w = Math.min(Math.max(Math.round(rect.w), MIN_SIZE.w), viewport.width);
  const h = Math.min(Math.max(Math.round(rect.h), MIN_SIZE.h), viewport.height);
  return {
    x: clamp(Math.round(rect.x), 0, Math.max(0, viewport.width - w)),
    y: clamp(Math.round(rect.y), 0, Math.max(0, viewport.height - h)),
    w,
    h,
  };
}

function number(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

/** One saved box, with every missing or odd field taken from the widget's defaults. */
export function normalizeBox(raw, defaults) {
  const r = raw && typeof raw === "object" ? raw : {};
  return {
    x: number(r.x, defaults.x),
    y: number(r.y, defaults.y),
    w: Math.max(MIN_SIZE.w, number(r.w, defaults.w)),
    h: Math.max(MIN_SIZE.h, number(r.h, defaults.h)),
    opacity: clamp(number(r.opacity, DEFAULT_OPACITY), 0.2, 1),
    pinned: typeof r.pinned === "boolean" ? r.pinned : Boolean(defaults.pinned),
    hidden: typeof r.hidden === "boolean" ? r.hidden : false,
  };
}

/** {type: saved box} -> {type: box} for exactly the known widgets. Anything unreadable gives the defaults. */
export function boxesFrom(widgets, defs) {
  const saved = widgets && typeof widgets === "object" ? widgets : {};
  const out = {};
  for (const def of defs) out[def.type] = normalizeBox(saved[def.type], def.defaults);
  return out;
}

/** Saved layout text -> {type: box} for exactly the known widgets. Anything unreadable gives the defaults. */
export function parseLayout(text, defs) {
  let saved = {};
  try {
    const raw = JSON.parse(text);
    if (raw && raw.version === LAYOUT_VERSION && raw.widgets && typeof raw.widgets === "object") saved = raw.widgets;
  } catch {
    saved = {};
  }
  return boxesFrom(saved, defs);
}

/** The layout as it is saved: also what a profile holds in the settings file. */
export function layoutObject(boxes) {
  return { version: LAYOUT_VERSION, widgets: boxes };
}

export function serializeLayout(boxes) {
  return JSON.stringify(layoutObject(boxes));
}

export const GAME_VIEWS = ["pinned", "all", "none"];

/** The view after this one: pinned widgets, then every widget of the profile, then none, then pinned again. */
export function nextGameView(view) {
  return GAME_VIEWS[(GAME_VIEWS.indexOf(view) + 1) % GAME_VIEWS.length];
}

/**
 * The other modes show every widget that is not hidden. Game mode shows, by `view`: the pinned widgets (the usual),
 * every widget of the profile that is not hidden ("all"), or none.
 */
export function isShown(mode, box, view = "pinned") {
  if (box.hidden) return false;
  if (mode !== "game") return true;
  if (view === "all") return true;
  if (view === "none") return false;
  return box.pinned;
}

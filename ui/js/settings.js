// The settings file (layouts.json): profiles of the widget layout, the active profile, and what the page does not own
// (the hotkeys, read by the app at start, and any field it does not know). Pure helpers; overlay.js loads and saves.

import { boxesFrom, layoutObject, parseLayout } from "./layout.js";

export const SETTINGS_VERSION = 1;
export const DEFAULT_PROFILE = "default";
export const MAX_NAME = 30;
const OWN = new Set(["version", "active", "profiles"]);
const RESERVED = new Set(["__proto__", "constructor", "prototype"]);

/** A profile name as kept: trimmed, 30 characters at most. Empty when there is nothing usable. */
export function cleanName(name) {
  const text = typeof name === "string" ? name.trim().slice(0, MAX_NAME).trim() : "";
  return RESERVED.has(text) ? "" : text;
}

/**
 * File text (and the layout an earlier version kept in localStorage) -> { settings, broken }.
 * settings: { active, profiles: Map(name -> boxes), extra: every other field of the file, kept as it was }.
 * broken: the file has text that is not a settings object: the caller keeps a copy before saving over it.
 * A missing or empty file is not broken: the first profile comes from the earlier layout.
 */
export function parseSettings(text, legacyText, defs) {
  let raw = null;
  let broken = false;
  if (typeof text === "string" && text.trim()) {
    try {
      const value = JSON.parse(text);
      if (value && typeof value === "object" && !Array.isArray(value)) raw = value;
      else broken = true;
    } catch {
      broken = true;
    }
  }
  const profiles = new Map();
  const extra = {};
  if (raw) {
    const saved = raw.profiles && typeof raw.profiles === "object" && !Array.isArray(raw.profiles) ? raw.profiles : {};
    for (const [key, value] of Object.entries(saved)) {
      const name = cleanName(key);
      if (!name || profiles.has(name) || !value || typeof value !== "object") continue;
      profiles.set(name, boxesFrom(value.widgets, defs));
    }
    for (const [key, value] of Object.entries(raw)) if (!OWN.has(key) && !RESERVED.has(key)) extra[key] = value;
  }
  if (!profiles.size) profiles.set(DEFAULT_PROFILE, parseLayout(legacyText, defs));
  const first = profiles.keys().next().value;
  const active = typeof raw?.active === "string" && profiles.has(cleanName(raw.active)) ? cleanName(raw.active) : first;
  return { settings: { active, profiles, extra }, broken };
}

export function serializeSettings(settings) {
  const profiles = {};
  for (const [name, boxes] of settings.profiles) profiles[name] = layoutObject(boxes);
  return JSON.stringify({ ...settings.extra, version: SETTINGS_VERSION, active: settings.active, profiles }, null, 2);
}

export const activeBoxes = (settings) => settings.profiles.get(settings.active);

/** The profile after the active one, back to the first after the last. */
export function nextProfile(settings) {
  const names = [...settings.profiles.keys()];
  return names[(names.indexOf(settings.active) + 1) % names.length];
}

/** A profile of this name, a copy of `boxes`. Returns its name, or "" when the name is empty, reserved or taken. */
export function addProfile(settings, name, boxes) {
  const clean = cleanName(name);
  if (!clean || settings.profiles.has(clean)) return "";
  settings.profiles.set(clean, JSON.parse(JSON.stringify(boxes)));
  return clean;
}

/** Rename a profile, keeping its place in the order (and the active one). Returns the new name, or "" when refused. */
export function renameProfile(settings, from, to) {
  const clean = cleanName(to);
  if (!clean || !settings.profiles.has(from)) return "";
  if (clean === from) return from;
  if (settings.profiles.has(clean)) return "";
  const renamed = new Map();
  for (const [name, boxes] of settings.profiles) renamed.set(name === from ? clean : name, boxes);
  settings.profiles = renamed;
  if (settings.active === from) settings.active = clean;
  return clean;
}

export const DEFAULT_DIM = 0.55;
const MAX_DIM = 0.9;
const clampDim = (v) => Math.min(Math.max(Number.isFinite(v) ? v : DEFAULT_DIM, 0), MAX_DIM);

/** How much the game behind is dimmed outside the game mode, 0 (not at all) to 0.9. */
export function dimOf(settings) {
  return typeof settings.extra.dim === "number" ? clampDim(settings.extra.dim) : DEFAULT_DIM;
}

export function setDim(settings, value) {
  settings.extra.dim = clampDim(Number(value));
}

/** Blur the game behind the overlay (on unless the file says false). */
export const blurOf = (settings) => settings.extra.blur !== false;

export function setBlur(settings, on) {
  settings.extra.blur = Boolean(on);
}

/** The hotkeys the file holds ({ toggle, palette, profile }, only the ones it names). */
export function hotkeysOf(settings) {
  const saved = settings.extra.hotkeys;
  const out = {};
  if (saved && typeof saved === "object" && !Array.isArray(saved)) {
    for (const key of ["toggle", "palette", "profile", "widgets"]) if (typeof saved[key] === "string" && saved[key].trim()) out[key] = saved[key].trim();
  }
  return out;
}

/** Keep these hotkeys in the file (other keys of its "hotkeys" block stay as they are). */
export function setHotkeys(settings, patch) {
  const current = settings.extra.hotkeys;
  const base = current && typeof current === "object" && !Array.isArray(current) ? current : {};
  settings.extra.hotkeys = { ...base, ...patch };
}

/** Remove a profile, never the last one. The active one moves to the first that is left. */
export function removeProfile(settings, name) {
  if (settings.profiles.size <= 1 || !settings.profiles.has(name)) return false;
  settings.profiles.delete(name);
  if (settings.active === name) settings.active = settings.profiles.keys().next().value;
  return true;
}

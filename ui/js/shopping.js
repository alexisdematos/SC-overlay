// The shopping list the overlay remembers: names from the map frame (its shopping card is the editor),
// and which ones were bought. Pure helpers; overlay.js stores the result in localStorage.

export const MAX_ITEMS = 8;
export const MAX_NAME = 80;

/** A list of item names from outside: trimmed, unique (any case), short, at most MAX_ITEMS. null when it is not a list. */
export function sanitizeNames(list) {
  if (!Array.isArray(list)) return null;
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    if (typeof raw !== "string") continue;
    const name = raw.trim();
    if (!name || name.length > MAX_NAME || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push(name);
    if (out.length === MAX_ITEMS) break;
  }
  return out;
}

/** The names the map sent, each with the bought flag it had; an item the map dropped is gone. */
export function mergeShopping(current, names) {
  const before = new Map(current.map((i) => [i.name.toLowerCase(), i.done]));
  return names.map((name) => ({ name, done: before.get(name.toLowerCase()) === true }));
}

export function parseSaved(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const items = raw.filter((i) => i && typeof i.name === "string");
  const names = sanitizeNames(items.map((i) => i.name)) || [];
  return mergeShopping(items, names);
}

export function setBought(list, name, done) {
  return list.map((i) => (i.name === name ? { ...i, done: Boolean(done) } : i));
}

/** The names of a `{shopping: [...]}` message, only when it comes from the map frame itself. Else null. */
export function acceptShoppingMessage(event, frameWindow, origin) {
  if (!frameWindow || event.source !== frameWindow || event.origin !== origin) return null;
  return sanitizeNames(event.data && event.data.shopping);
}

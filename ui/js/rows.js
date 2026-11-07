// Search results -> the rows the palette shows, with their actions bound to the overlay's handlers. Pure.
//
// handlers: { addToList(name), setStart(place), viewOnMap(place), setShip(name), showTime(place) }

import { money } from "./format.js";

export function rowsOf(results, handlers) {
  const rows = [];

  for (const p of results.places) {
    const where = [p.type, p.body && p.body !== p.name ? p.body : "", p.system].filter(Boolean).join(" · ");
    rows.push({
      kind: "place",
      key: `place:${p.name}`,
      title: p.name,
      subtitle: where,
      detail: p.services.length ? `Services: ${p.services.join(", ")}` : "",
      primary: { label: "Details", run: () => handlers.showTime(p.name) },
      actions: [
        { label: "Start here", run: () => handlers.setStart(p.name) },
        { label: "On the map", run: () => handlers.viewOnMap(p.name) },
      ],
    });
  }

  for (const s of results.ships) {
    rows.push({
      kind: "ship",
      key: `ship:${s.name}`,
      title: s.name,
      subtitle: s.drive ? `Quantum drive: ${s.drive}` : "",
      detail: "",
      primary: { label: "Use ship", run: () => handlers.setShip(s.name) },
      actions: [{ label: "Use ship", run: () => handlers.setShip(s.name) }],
    });
  }

  const item = results.item;
  if (item) {
    rows.push({
      kind: "item",
      key: `item:${item.name}`,
      title: item.name,
      subtitle: item.category,
      detail: "",
      shops: item.shops.map((s) => ({
        text: `${s.shop ? `${s.shop}, ` : ""}${s.location}${s.system ? ` (${s.system})` : ""}`
          + `${s.priceAuec === null ? "" : ` · ${money(s.priceAuec)} aUEC`}${s.trip ? ` · ${s.trip}` : ""}`,
        actions: [
          { label: "Start here", run: () => handlers.setStart(s.location) },
          { label: "On the map", run: () => handlers.viewOnMap(s.location) },
        ],
      })),
      primary: { label: "Add to list", run: () => handlers.addToList(item.name) },
      actions: [{ label: "Add to list", run: () => handlers.addToList(item.name) }],
    });
  }
  return rows;
}

/** Keyboard selection: wraps around; -1 when there is no row. */
export function moveSelection(current, delta, count) {
  if (count <= 0) return -1;
  if (current < 0) return delta > 0 ? 0 : count - 1;
  return (current + delta + count) % count;
}

import { h, line } from "../dom.js";

// The stops in order, as the service writes them (routeLines).
export const route = {
  type: "route",
  title: "Route",
  defaults: { x: 24, y: 64, w: 380, h: 280, pinned: true },

  render(el, { ui }) {
    if (!ui) return el.replaceChildren(line("Waiting for the service..."));
    const lines = ui.routeLines || [];
    const out = [];
    if (ui.planning) out.push(line("Planning...", "muted"));
    if (!lines.length && !ui.planning) out.push(line("No route yet", "muted"));
    out.push(h("div", { class: "lines" }, lines.map((text) => line(String(text), "pre"))));
    el.replaceChildren(...out);
  },
};

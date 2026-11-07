import { line } from "../dom.js";

/** Everything that needs the player's eyes. Empty list = nothing to show. */
export function alertsOf({ ui, state }) {
  const out = [];
  if (state && state.status === "error") out.push(`Service: ${state.error || "error"}`);
  else if (state && state.status === "reconnecting") out.push("Service: reconnecting...");
  if (ui) {
    for (const w of ui.warnings || []) out.push(String(w));
    if (ui.team?.error) out.push(`Team: ${ui.team.error}`);
    if (ui.team?.readError) out.push(`Team: ${ui.team.readError}`);
    if (ui.trade?.on && ui.trade.error) out.push(`Trade: ${ui.trade.error}`);
  }
  return out;
}

// Patch warnings, service and team errors. In game mode it only shows when there is something.
export const alerts = {
  type: "alerts",
  title: "Alerts",
  defaults: { x: 24, y: 520, w: 380, h: 100, pinned: true },

  empty: (ctx) => alertsOf(ctx).length === 0,

  render(el, ctx) {
    const items = alertsOf(ctx);
    if (!items.length) return el.replaceChildren(line("No alert", "muted"));
    el.replaceChildren(...items.map((text) => line(text, "warn")));
  },
};

import { h, line } from "../dom.js";
import { money } from "../format.js";

// Goods to buy and sell on the way (UEX prices, computed by the service).
export const trade = {
  type: "trade",
  title: "Trade on the route",
  defaults: { x: 888, y: 344, w: 380, h: 240, pinned: false },

  render(el, { ui, act, mode }) {
    if (!ui) return el.replaceChildren(line("Waiting for the service..."));
    const t = ui.trade || {};
    const live = mode !== "game";
    const out = [];

    if (live) {
      const budget = h("input", { type: "text", placeholder: "Budget (50k)", value: t.budget ? String(t.budget) : "", maxlength: "20" });
      out.push(h("div", { class: "row" },
        h("label", {}, h("input", {
          type: "checkbox", checked: Boolean(t.on),
          onchange: (e) => act("set_option", { key: "trade", value: e.target.checked }),
        }), " Suggest trades"),
        budget,
        h("button", { type: "button", class: "small", text: "Set", onclick: () => act("trade_budget", { text: budget.value }) })));
    } else if (!t.on) {
      out.push(line("Trade suggestions are off", "muted"));
    }

    if (t.on) {
      if (t.fetching) out.push(line("Fetching prices...", "muted"));
      const items = t.suggestions || [];
      if (!items.length && !t.fetching && !t.error) out.push(line(t.reason ? `Nothing to suggest: ${t.reason}` : "Nothing to suggest", "muted"));
      for (const s of items) {
        out.push(line(
          `${s.buyPlace || "?"} → ${s.sellPlace || "?"}:${s.scu ?? "?"} SCU ${s.name || "?"} (+${money(s.profit, true)})${s.old ? " [old prices]" : ""}`));
      }
    }
    if (t.error) out.push(line(String(t.error), "warn"));
    el.replaceChildren(...out);
  },
};

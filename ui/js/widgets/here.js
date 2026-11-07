import { h, line } from "../dom.js";
import { money } from "../format.js";

/** What to do at the place you are in: trade stops of the route, and shopping items sold here. */
export function remindersOf({ ui, shopping = [], shop }) {
  const place = ui && ui.location && ui.location.name;
  const out = { place: place || null, trades: [], items: [] };
  if (!place) return out;
  const trade = ui.trade || {};
  for (const s of trade.on ? trade.suggestions || [] : []) {
    const done = s.done || {};
    if (s.buyPlace === place && !done.buy) {
      out.trades.push({ side: "buy", suggestion: s, text: `Buy ${s.scu ?? "?"} SCU ${s.name || "?"} (${money(s.buy)}/SCU)` });
    }
    if (s.sellPlace === place && !done.sell) {
      out.trades.push({ side: "sell", suggestion: s, text: `Sell ${s.scu ?? "?"} SCU ${s.name || "?"} (+${money(s.profit, true)})` });
    }
  }
  for (const item of shopping) {
    if (item.done) continue;
    const entry = shop(item.name, place);
    if (entry.status === "ok" && entry.offer) out.items.push({ name: item.name, offer: entry.offer, title: entry.name });
  }
  return out;
}

// Buy reminder: shown in game mode only when there is something to do here.
export const here = {
  type: "here",
  title: "Here",
  defaults: { x: 24, y: 640, w: 380, h: 120, pinned: true },

  empty: (ctx) => {
    const r = remindersOf(ctx);
    return r.trades.length === 0 && r.items.length === 0;
  },

  render(el, ctx) {
    const { ui, act, mode, setBought } = ctx;
    if (!ui) return el.replaceChildren(line("Waiting for the service..."));
    const r = remindersOf(ctx);
    const live = mode !== "game";
    if (!r.place) return el.replaceChildren(line("Where you are is not known yet", "muted"));
    const out = [h("p", {}, h("strong", { text: `Here: ${r.place}` }))];
    for (const t of r.trades) {
      const s = t.suggestion;
      out.push(h("div", { class: "row" }, h("span", { text: t.text }),
        live ? h("button", {
          type: "button", class: "small", text: "Done",
          onclick: () => act("trade_done", { buyPlace: s.buyPlace, sellPlace: s.sellPlace, name: s.name, side: t.side }),
        }) : null));
    }
    for (const i of r.items) {
      const shop = i.offer.shop ? ` at ${i.offer.shop}` : "";
      out.push(h("div", { class: "row" }, h("span", { text: `${i.title}: ${money(i.offer.priceAuec)} aUEC${shop}` }),
        live ? h("button", { type: "button", class: "small", text: "Bought", onclick: () => setBought(i.name, true) }) : null));
    }
    if (!r.trades.length && !r.items.length) out.push(line("Nothing to buy or sell here", "muted"));
    el.replaceChildren(...out);
  },
};

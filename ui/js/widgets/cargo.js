import { h, line, select } from "../dom.js";
import { sureLabel } from "../format.js";

const AUTO = "\u0000auto";

// Ship, start place, SCU gauge, contracts and their legs.
export const cargo = {
  type: "cargo",
  title: "Cargo and contracts",
  defaults: { x: 424, y: 64, w: 440, h: 380, pinned: false },

  render(el, { ui, act, mode }) {
    if (!ui) return el.replaceChildren(line("Waiting for the service..."));
    const live = mode !== "game";
    const out = [];

    const ship = ui.ship || {};
    const ships = ui.lists?.ships || [];
    const shipOptions = ships.includes(ship.name) || !ship.name ? ships : [ship.name, ...ships];
    const places = ui.lists?.places || [];
    const start = ui.start?.place || "";
    if (live) {
      out.push(
        h("div", { class: "row" },
          h("label", {}, "Ship ",
            select([[AUTO, "Auto (last flown)"], ...shipOptions.map((s) => [s, s])], ship.auto ? AUTO : ship.name || "",
              (v) => act("set_ship", v === AUTO ? { auto: true } : { ship: v }))),
          h("label", {}, "Start ",
            select([["", "Anywhere"], ...places.map((p) => [p.name, p.name])], start,
              (v) => act("set_start", { place: v })))));
    } else {
      out.push(line(`${ship.name || "No ship"}${start ? ` · from ${start}` : ""}`, "muted"));
    }

    const total = ui.total || {};
    if (total.capacity) {
      out.push(h("div", { class: "gauge" },
        h("progress", { max: total.capacity, value: Math.min(total.scu || 0, total.capacity) }),
        h("span", { class: total.scu > total.capacity ? "warn" : "", text: ` ${total.scu || 0} / ${total.capacity} SCU` })));
    } else if (total.scu) {
      out.push(line(`${total.scu} SCU`));
    }

    const contracts = ui.contracts || [];
    if (!contracts.length) out.push(line("No contract", "muted"));
    for (const c of contracts) {
      const box = h("div", { class: "contract" },
        h("div", { class: "row" },
          h("strong", { text: c.title || c.code || c.id }),
          (c.sharedWith || []).length ? h("span", { class: "muted", text: ` shared: ${c.sharedWith.join(", ")}` }) : null,
          live ? h("button", { type: "button", class: "small", text: "Hide", onclick: () => act("hide_contract", { contract: c.id }) }) : null));
      for (const leg of c.legs || []) {
        const mark = sureLabel(leg.sure);
        const state = leg.delivered ? "done" : leg.picked ? "picked" : "";
        const text = `${leg.cargo || "?"}${leg.scu ? ` ${leg.scu} SCU` : ""}: ${leg.from || "?"} → ${leg.to || "?"}`
          + (mark ? ` (${mark})` : "") + (leg.fromTeam ? ` [${leg.fromTeam}]` : "");
        box.append(line(text, state));
      }
      out.push(box);
    }
    el.replaceChildren(...out);
  },
};

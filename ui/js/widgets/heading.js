import { h, line } from "../dom.js";
import { clock, duration, localLabel, secondsUntil } from "../format.js";

// Where the quantum jump goes, and when it arrives. Ticks every second for the countdown.
export const heading = {
  type: "heading",
  title: "Heading and time",
  defaults: { x: 24, y: 360, w: 380, h: 144, pinned: true },
  tickMs: 1000,

  render(el, { ui, now }) {
    if (!ui) return el.replaceChildren(line("Waiting for the service..."));
    const out = [];
    const target = ui.heading;
    if (target && target.to) {
      out.push(h("p", {}, h("strong", { text: `${target.from || "?"} → ${target.to}` })));
      if (Array.isArray(target.via) && target.via.length) out.push(line(`Via ${target.via.join(", ")}`, "muted"));
      const left = secondsUntil(target.eta, now);
      if (left === null) out.push(line("Travel time unknown yet", "muted"));
      else if (left > 0) out.push(line(`Arrives in ${duration(left)} (${clock(target.eta)})`));
      else out.push(line("Should have arrived", "muted"));
      // The route stop of the destination knows the time there (day or night on arrival).
      const stop = (ui.route || []).find((r) => r.place === target.to);
      const there = localLabel(stop && stop.local);
      if (there) out.push(line(`On arrival at ${target.to}: ${there}`));
      const jump = secondsUntil(target.jumpAt, now);
      if (jump !== null && jump > 0) out.push(line(`Ship starts moving in ${duration(jump)}`, "muted"));
    } else {
      const next = (ui.route || [])[0];
      out.push(line("No destination picked", "muted"));
      if (next) {
        const there = localLabel(next.local);
        out.push(line(`Next stop: ${next.place}${next.arrival ? ` (${clock(next.arrival)})` : ""}${there ? ` · there ${there}` : ""}`));
      }
    }
    if (ui.aboard) out.push(line(`Aboard ${ui.aboard.owner || "?"}'s ${ui.aboard.ship || "ship"}`, "muted"));
    out.push(line(`Time ${clock(new Date(now).toISOString())}`, "muted"));
    el.replaceChildren(...out);
  },
};

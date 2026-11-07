import { h, line } from "../dom.js";

/** The pseudo is optional: send it only when something is typed. */
function named(input) {
  const name = input.value.trim();
  return name ? { name } : {};
}

/**
 * Is this member on our game server? "same" or "other" when both shards are known, else "unknown"
 * (no log line yet, or an older SC-hauling or Worker that does not send it).
 */
export function serverOf(ownShard, member) {
  const theirs = member && member.state && member.state.shard;
  if (!ownShard || !theirs) return "unknown";
  return ownShard === theirs ? "same" : "other";
}

// Team code, members, what they share. Create, join and leave need the mouse (interaction mode).
export const team = {
  type: "team",
  title: "Team",
  defaults: { x: 888, y: 64, w: 320, h: 260, pinned: false },

  render(el, { ui, act, mode }) {
    if (!ui) return el.replaceChildren(line("Waiting for the service..."));
    const t = ui.team || {};
    const live = mode !== "game";
    const out = [];

    if (!t.code) {
      out.push(line("Not in a team", "muted"));
      if (live) {
        const name = h("input", { type: "text", placeholder: "Your pseudo", value: t.name || "", maxlength: "40" });
        const code = h("input", { type: "text", placeholder: "Team code or link", maxlength: "200" });
        out.push(
          h("div", { class: "row" }, name,
            h("button", { type: "button", class: "small", text: "Create", onclick: () => act("team_create", named(name)) })),
          h("div", { class: "row" }, code,
            h("button", { type: "button", class: "small", text: "Join", onclick: () => act("team_join", { code: code.value, ...named(name) }) })));
      }
    } else {
      out.push(h("div", { class: "row" },
        h("strong", { text: `Team ${t.code}` }),
        live ? h("button", { type: "button", class: "small", text: "Leave", onclick: () => act("team_leave") }) : null));
      const members = t.members || [];
      if (!members.length) out.push(line(t.reading ? "Reading the team..." : "No member yet", "muted"));
      for (const m of members) {
        const shared = (m.shared || []).length;
        const self = Boolean(m.id && m.id === t.self);
        const server = self ? "unknown" : serverOf(ui.shard, m);
        out.push(line(
          `${m.name || "?"}${self ? " (you)" : ""}${shared ? ` · shares ${shared} contract${shared > 1 ? "s" : ""}` : ""}`
            + (server === "same" ? " · same server" : server === "other" ? " · other server" : ""),
          server === "other" ? "muted" : ""));
      }
    }
    for (const problem of [t.error, t.readError]) if (problem) out.push(line(String(problem), "warn"));
    el.replaceChildren(...out);
  },
};

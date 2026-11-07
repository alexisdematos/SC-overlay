// The settings panel: the three shortcuts (typed by pressing them) and the layout profiles.
// overlay.js gives it what touches the layout (profiles) and the saving; this file draws and collects.

import { h } from "./dom.js";
import { comboFromEvent, comboProblem } from "./hotkey.js";

const DEFAULTS = { toggle: "Alt+O", palette: "Alt+P", profile: "Alt+I", widgets: "Alt+U" };
const FIELDS = [
  ["toggle", "Play / interact", "Switches between the game and the overlay"],
  ["palette", "Search", "Opens the search bar"],
  ["profile", "Next profile", "Switches to the next layout profile"],
  ["widgets", "Show widgets", "In the game: pinned widgets, then every widget of the profile, then none"],
];
const KEEP_PAUSE_MS = 5000; // the app resumes the shortcuts by itself after 15 s without this call

/**
 * invoke: tauri's. actions: { profiles(): {names, active}, use(name), add(name), rename(from, to), remove(name) }, each
 * of the last four returns "" when done or the reason it was refused. saveHotkeys(patch) writes the file: true when done.
 */
export function createSettingsPanel({ root, invoke, actions, saveHotkeys, dim, blur }) {
  let open = false;
  let drafts = { ...DEFAULTS };
  let message = { text: "", bad: false };
  let keepAlive = null;

  const resume = () => {
    clearInterval(keepAlive);
    keepAlive = null;
    invoke("pause_hotkeys", { paused: false }).catch(() => {});
  };

  function say(text, bad = false) {
    message = { text, bad };
    const el = root.querySelector(".settings-message");
    if (el) {
      el.textContent = text;
      el.className = `settings-message ${bad ? "warn" : "muted"}`;
    }
  }

  function keyField(name, title, hint) {
    const input = h("input", {
      type: "text", readonly: true, class: "keyfield", value: drafts[name], "aria-label": title, autocomplete: "off",
      onfocus: () => {
        input.value = "Press the keys...";
        invoke("pause_hotkeys", { paused: true }).catch(() => {});
        clearInterval(keepAlive);
        keepAlive = setInterval(() => invoke("pause_hotkeys", { paused: true }).catch(() => {}), KEEP_PAUSE_MS);
      },
      onblur: () => {
        input.value = drafts[name];
        resume();
      },
      onkeydown: (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.key === "Escape") {
          input.blur();
          return;
        }
        const { combo, error } = comboFromEvent(e);
        if (error) say(error, true);
        if (!combo) return;
        drafts[name] = combo;
        say("");
        input.blur();
      },
    });
    const reset = h("button", {
      type: "button", class: "small", text: "Default", title: `Back to ${DEFAULTS[name]}`,
      onclick: () => { drafts[name] = DEFAULTS[name]; input.value = drafts[name]; say(""); },
    });
    return h("div", { class: "row" }, h("span", { class: "keylabel", text: title, title: hint }), input, reset);
  }

  async function apply() {
    const duplicates = new Set(Object.values(drafts)).size !== FIELDS.length;
    if (duplicates) return say("Two actions have the same shortcut", true);
    for (const value of Object.values(drafts)) {
      const problem = comboProblem(value);
      if (problem) return say(`${value}: ${problem}`, true);
    }
    try {
      const labels = await invoke("set_hotkeys", {
        toggle: drafts.toggle, palette: drafts.palette, profile: drafts.profile, widgets: drafts.widgets,
      });
      [drafts.toggle, drafts.palette, drafts.profile, drafts.widgets] = labels;
      const patch = {};
      for (const [name] of FIELDS) patch[name] = drafts[name];
      const saved = await saveHotkeys(patch);
      say(saved ? "Applied and saved." : "Applied, but not saved to the settings file: they will be back to the old ones at the next start.", !saved);
    } catch (e) {
      say(String(e), true);
      await loadLabels(); // what is really in use
    }
    draw();
  }

  async function loadLabels() {
    try {
      const labels = await invoke("shortcut_labels");
      [drafts.toggle, drafts.palette, drafts.profile, drafts.widgets] = labels;
    } catch {
      // keep what the fields hold
    }
  }

  function profileRows() {
    const { names, active } = actions.profiles();
    const refused = (reason) => { say(reason, Boolean(reason)); draw(); };
    const rows = names.map((name) => {
      const field = h("input", {
        type: "text", value: name, maxlength: "30", class: "profilefield", "aria-label": `Profile ${name}`, spellcheck: "false",
        onchange: () => refused(actions.rename(name, field.value)),
        onkeydown: (e) => e.stopPropagation(),
      });
      return h("div", { class: "row" },
        field,
        h("button", { type: "button", class: "small", text: name === active ? "Active" : "Use", disabled: name === active, onclick: () => refused(actions.use(name)) }),
        h("button", { type: "button", class: "small", text: "Delete", disabled: names.length <= 1, onclick: () => refused(actions.remove(name)) }));
    });
    const input = h("input", {
      type: "text", maxlength: "30", placeholder: "New profile (copy of the active one)", class: "profilefield", spellcheck: "false",
      onkeydown: (e) => { e.stopPropagation(); if (e.key === "Enter") add.click(); },
    });
    const add = h("button", { type: "button", class: "small", text: "Add", onclick: () => refused(actions.add(input.value)) });
    return [...rows, h("div", { class: "row" }, input, add)];
  }

  let appVersion = "";
  let upd = { text: "", bad: false, version: null, busy: false };

  async function checkUpdates() {
    upd = { text: "Checking...", bad: false, version: null, busy: true };
    draw();
    try {
      const found = await invoke("check_update");
      upd = found
        ? { text: `Version ${found.version} is available (you have ${found.current}).`, bad: false, version: found.version, busy: false }
        : { text: "You have the latest version.", bad: false, version: null, busy: false };
    } catch (e) {
      upd = { text: `Update check failed: ${e}`, bad: true, version: null, busy: false };
    }
    draw();
  }

  async function installUpdate() {
    upd = { ...upd, text: "Downloading. The overlay closes, installs, then you start it again.", bad: false, busy: true };
    draw();
    try {
      await invoke("install_update");
    } catch (e) {
      upd = { text: `Update failed: ${e}`, bad: true, version: null, busy: false };
      draw();
    }
  }

  function draw() {
    root.replaceChildren(
      h("div", { class: "settings-head" },
        h("strong", { text: "Settings" }),
        h("button", { type: "button", class: "small", text: "Close", onclick: () => api.close() })),
      h("h3", { text: "Shortcuts" }),
      h("p", { class: "muted", text: "Click a field, press the keys, then click Apply. No restart needed." }),
      ...FIELDS.map(([name, title, hint]) => keyField(name, title, hint)),
      h("div", { class: "row" }, h("button", { type: "button", text: "Apply shortcuts", onclick: apply })),
      h("h3", { text: "Background" }),
      h("div", { class: "row" },
        h("span", { class: "keylabel", text: "Dim the game", title: "How dark the game is behind the overlay (not in the game mode)" }),
        h("input", {
          type: "range", min: "0", max: "0.9", step: "0.05", value: String(dim.get()), "aria-label": "Dim the game",
          oninput: (e) => dim.set(Number(e.target.value)),
        })),
      h("div", { class: "row" },
        h("label", { title: "Blurs the game behind the overlay when you are not in the game mode (Windows 10 and 11)" },
          h("input", { type: "checkbox", checked: blur.get(), onchange: (e) => blur.set(e.target.checked) }), " Blur the game")),
      h("h3", { text: "Layout profiles" }),
      ...profileRows(),
      h("h3", { text: "Updates" }),
      h("div", { class: "row" },
        h("span", { class: "keylabel", text: appVersion ? `Version ${appVersion}` : "Version" }),
        h("button", { type: "button", class: "small", text: "Check for updates", disabled: upd.busy, onclick: checkUpdates }),
        upd.version ? h("button", { type: "button", class: "small", text: `Install ${upd.version}`, disabled: upd.busy, onclick: installUpdate }) : ""),
      upd.text ? h("p", { class: upd.bad ? "warn" : "muted", text: upd.text }) : "",
      h("p", { class: `settings-message ${message.bad ? "warn" : "muted"}`, text: message.text }));
  }

  const api = {
    get isOpen() { return open; },
    async open() {
      resume(); // a pause that was left over
      open = true;
      message = { text: "", bad: false };
      await loadLabels();
      try { appVersion = await invoke("app_version"); } catch { /* shown without it */ }
      draw();
      root.hidden = false;
    },
    close() {
      open = false;
      root.hidden = true;
      resume();
    },
    toggle() {
      return open ? api.close() : api.open();
    },
    /** The profiles changed from outside (the bar, a shortcut): redraw if shown. */
    refresh() {
      if (open) draw();
    },
  };
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape") api.close(); // the fields that take keys stop the event themselves
  });
  return api;
}

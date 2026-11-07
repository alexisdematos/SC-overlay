import { createApi } from "./api.js";
import { createPalette } from "./palette.js";
import { createSearch } from "./search.js";
import { h } from "./dom.js";
import { MIN_SIZE, clampRect, isShown, nextGameView, parseLayout, serializeLayout, snap } from "./layout.js";
import { MAX_ITEMS, acceptShoppingMessage, mergeShopping, parseSaved, setBought } from "./shopping.js";
import { createShopFinder } from "./shopfinder.js";
import { createSettingsPanel } from "./settingspanel.js";
import {
  activeBoxes, addProfile, blurOf, dimOf, nextProfile, parseSettings, removeProfile, renameProfile, serializeSettings, setBlur,
  setDim, setHotkeys,
} from "./settings.js";
import { WIDGETS } from "./widgets/index.js";

const LAYOUT_KEY = "layout2"; // the layout of earlier versions: the first profile, and the copy when the file cannot be written
const SHOPPING_KEY = "shopping";
const TOAST_MS = 5000;
const SAVE_MS = 300;

const tauri = window.__TAURI__;
const api = createApi({ invoke: tauri.core.invoke });
const $ = (id) => document.getElementById(id);

let mode = "game";
let boxes = parseLayout(load(), WIDGETS);
let warnings = [];
let mapUrl = null;
let mapFocus = null; // { place, nonce }: "On the map" in the palette
const pendingAdds = [];
let palette = null;
let shopping = parseSaved(read(SHOPPING_KEY));
let finder = null;
let toastTimer = null;
const frames = new Map(); // type -> { def, el, body, dirty, shown }

function read(key) {
  try {
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

function load() {
  return read(LAYOUT_KEY);
}

function saveShopping() {
  try {
    localStorage.setItem(SHOPPING_KEY, JSON.stringify(shopping));
  } catch {
    // the list comes back from the map at the next start
  }
}

// The layout is kept in the settings file (profiles). `boxes` is the active profile's own object: changing it changes
// the settings, save() then writes them after a short pause.
let settings = null;
let saveTimer = null;
let saveBlocked = false; // the file has text we could not keep a copy of: nothing is written over it
let saveWarned = false;
let settingsPanel = null;
let gameView = "pinned"; // what the game mode shows: "pinned" widgets, "all" of the profile, or "none" (not kept)

function save() {
  if (!settings || saveBlocked) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, SAVE_MS);
}

/** Write the settings now. True when the file has them. */
async function flushSave() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!settings || saveBlocked) return false;
  try {
    await tauri.core.invoke("save_settings", { text: serializeSettings(settings) });
    return true;
  } catch (e) {
    try {
      localStorage.setItem(LAYOUT_KEY, serializeLayout(boxes)); // at least this layout comes back (the file wins when it can be read)
    } catch {
      // a convenience: keep going without it
    }
    if (!saveWarned) {
      saveWarned = true;
      toast(`Layout not saved to the settings file: ${e}`);
    }
    return false;
  }
}

/** The settings file (else the layout of earlier versions) -> settings and the active profile's boxes. */
async function loadSettings() {
  let text = "";
  try {
    text = await tauri.core.invoke("load_settings");
  } catch {
    text = "";
  }
  const parsed = parseSettings(text, load(), WIDGETS);
  settings = parsed.settings;
  boxes = activeBoxes(settings);
  if (parsed.broken) {
    try {
      const copy = await tauri.core.invoke("backup_settings");
      toast(`The settings file could not be read: a copy is kept in ${copy}`);
    } catch (e) {
      saveBlocked = true;
      toast(`The settings file could not be read and not copied (${e}): your layout is not saved`);
    }
  }
}

/** The dim behind the overlay (outside the game mode) as the settings say. */
function applyDim() {
  document.documentElement.style.setProperty("--dim", String(dimOf(settings)));
}

/** The shortcuts in use, on the buttons that mention them. */
async function showKeyLabels() {
  const [toggleKey, , profileKey] = await tauri.core.invoke("shortcut_labels");
  $("back").textContent = `Back to game (${toggleKey})`;
  $("profile").title = `Layout profile (${profileKey} for the next one)`;
  tauri.core.invoke("set_blur_enabled", { enabled: blurOf(settings) }).catch(() => {});
}

let flashTimer = null;

/** A short message that shows in game mode too (the notice lives in the bar, which the game mode hides). */
function flash(text) {
  const el = $("flash");
  el.textContent = text;
  el.hidden = false;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { el.hidden = true; }, 1800);
}

function refreshProfiles() {
  $("profiles").hidden = mode !== "edit";
  if (!settings) return;
  $("profile").replaceChildren(...[...settings.profiles.keys()].map((name) => h("option", { value: name, text: name })));
  $("profile").value = settings.active;
  if (settingsPanel) settingsPanel.refresh();
}

function useProfile(name) {
  if (!settings || !settings.profiles.has(name) || name === settings.active) return;
  settings.active = name;
  boxes = activeBoxes(settings);
  for (const def of WIDGETS) applyBox(def.type);
  save();
  renderAll();
  refreshProfiles();
  flash(`Profile: ${name}`);
}

const viewport = () => ({ width: innerWidth, height: innerHeight });

// ---- notices ---------------------------------------------------------------

function showNotice(text) {
  const n = $("notice");
  n.textContent = text;
  n.hidden = !text;
}

function toast(text) {
  showNotice(text);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => showNotice(warnings.join(" · ")), TOAST_MS);
}

function act(type, payload) {
  return api.action(type, payload).catch((e) => toast(`${type}: ${e.message}`));
}

// ---- widgets ---------------------------------------------------------------

function context() {
  return { ui: api.state.ui, state: api.state, act, mode, now: Date.now(), mapUrl, servicePort: api.port, mapFocus,
    shopping, shop: (item, place) => (finder ? finder.check(item, place) : { status: "none", offer: null }),
    setBought: (name, done) => { shopping = setBought(shopping, name, done); saveShopping(); renderAll(); } };
}

function usableViewport() {
  const v = viewport();
  return v.width >= MIN_SIZE.w && v.height >= MIN_SIZE.h ? v : null; // 0 while the window is not laid out yet
}

/** Show a box inside the screen. The saved box is not touched: a small window now must not shrink the layout for good. */
function applyBox(type) {
  const { el } = frames.get(type);
  const v = usableViewport();
  const box = v ? { ...boxes[type], ...clampRect(boxes[type], v) } : boxes[type];
  el.style.left = `${box.x}px`;
  el.style.top = `${box.y}px`;
  el.style.width = `${box.w}px`;
  el.style.height = `${box.h}px`;
  el.style.setProperty("--widget-opacity", String(box.opacity));
  el.querySelector(".pin").checked = box.pinned;
  el.querySelector(".opacity").value = String(box.opacity);
}

/** A text field of the widget has the focus: a refresh would take it from the player's hands. */
function isTyping(body) {
  const a = document.activeElement;
  return Boolean(a && body.contains(a) && (a.tagName === "TEXTAREA" || (a.tagName === "INPUT" && a.type === "text")));
}

function renderWidget(type) {
  const frame = frames.get(type);
  const { def, el, body } = frame;
  const ctx = context();
  // `empty` may ask the network (the buy reminder): never for a widget that is not shown anyway
  const wanted = isShown(mode, boxes[type], gameView);
  // A widget with nothing to say stays out of the pinned view; when the player asks for them all, it shows
  const hiddenInGame = wanted && mode === "game" && gameView === "pinned" && def.empty && def.empty(ctx);
  el.hidden = !wanted || Boolean(hiddenInGame);
  if (frame.shown !== !el.hidden) {
    frame.shown = !el.hidden;
    if (def.visibility) def.visibility(body, frame.shown, ctx);
  }
  if (el.hidden) return;
  if (isTyping(body)) {
    frame.dirty = true; // drawn when the field loses the focus
    return;
  }
  frame.dirty = false;
  def.render(body, ctx);
}

function renderAll() {
  for (const def of WIDGETS) renderWidget(def.type);
  refreshAddList();
}

function refreshAddList() {
  const add = $("add");
  const hidden = WIDGETS.filter((d) => boxes[d.type].hidden);
  add.replaceChildren(h("option", { value: "", text: "Add widget..." }), ...hidden.map((d) => h("option", { value: d.type, text: d.title })));
  add.hidden = mode !== "edit" || hidden.length === 0;
}

function interactive(target) {
  return Boolean(target.closest("input, select, textarea, button, label, .handle"));
}

/** Drag with the pointer: onMove gets the distance from the start; the box is saved at the end. */
function track(el, down, onMove, onEnd) {
  el.setPointerCapture(down.pointerId);
  const start = { x: down.clientX, y: down.clientY };
  const move = (e) => onMove(e.clientX - start.x, e.clientY - start.y);
  const end = () => {
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", end);
    el.removeEventListener("pointercancel", end);
    onEnd();
  };
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
}

/** The player moves or resizes a box: this one is kept (inside the screen). */
function setBox(type, patch) {
  const v = usableViewport();
  const next = { ...boxes[type], ...patch };
  boxes[type] = v ? { ...next, ...clampRect(next, v) } : next;
  applyBox(type);
}

function snapBox(type) {
  const b = boxes[type];
  setBox(type, { x: snap(b.x), y: snap(b.y), w: snap(b.w), h: snap(b.h) });
  save();
}

function mount() {
  for (const def of WIDGETS) {
    const type = def.type;
    const body = h("div", { class: "wbody" });
    const bar = h("div", { class: "wbar" },
      h("span", { class: "wtitle", text: def.title }),
      h("input", {
        class: "opacity", type: "range", min: "0.2", max: "1", step: "0.05", title: "Opacity",
        oninput: (e) => { boxes[type].opacity = Number(e.target.value); applyBox(type); },
        onchange: save,
      }),
      h("label", { title: "Show in game mode" }, h("input", {
        class: "pin", type: "checkbox",
        onchange: (e) => { boxes[type].pinned = e.target.checked; save(); },
      }), " pin"),
      h("button", {
        type: "button", class: "small", text: "Hide", title: "Hide this widget",
        onclick: () => { boxes[type].hidden = true; save(); renderAll(); },
      }));
    const handle = h("div", { class: "handle", title: "Resize" });
    const el = h("section", { class: "widget", "data-widget": type }, bar, body, handle);
    $("widgets").append(el);
    frames.set(type, { def, el, body, dirty: false, shown: null });
    el.addEventListener("focusout", () => setTimeout(() => { if (frames.get(type).dirty) renderWidget(type); }, 0));

    el.addEventListener("pointerdown", (down) => {
      if (mode !== "edit") return;
      if (down.target === handle) {
        const from = { ...boxes[type] };
        track(el, down, (dx, dy) => setBox(type, { w: from.w + dx, h: from.h + dy }), () => snapBox(type));
      } else if (!interactive(down.target)) {
        const from = { ...boxes[type] };
        track(el, down, (dx, dy) => setBox(type, { x: from.x + dx, y: from.y + dy }), () => snapBox(type));
      }
    });
    applyBox(type);
  }
}

// ---- palette actions ---------------------------------------------------------

/** The map widget shown (it holds the shopping card and the map), and its frame. */
function ensureMapFrame() {
  if (boxes.map.hidden) {
    boxes.map.hidden = false;
    save();
  }
  renderAll(); // may replace the frame: flushAdds waits for the new one to announce itself
  return document.querySelector(".map-frame");
}

function mapOrigin() {
  try {
    return new URL(mapUrl).origin;
  } catch {
    return null;
  }
}

const ADD_RETRY_MS = 1000;
const ADD_TRIES = 10;
let addTimer = null;

/** Sends the waiting items to the map frame. They stay waiting until the map's list shows them (confirmAdds). */
function flushAdds() {
  const frame = document.querySelector(".map-frame");
  const origin = mapOrigin();
  if (!frame || !frame.contentWindow || !origin) return;
  for (const name of pendingAdds) frame.contentWindow.postMessage({ shoppingAdd: name }, origin);
}

/** The map's list arrived: what it holds is added. */
function confirmAdds() {
  for (const name of pendingAdds.splice(0)) {
    if (shopping.some((i) => i.name.toLowerCase() === name.toLowerCase())) toast(`${name} added to the shopping list`);
    else pendingAdds.push(name);
  }
}

/** The map frame may still be loading: ask again every second, then say it did not answer. */
function retryAdds() {
  clearInterval(addTimer);
  let tries = 0;
  addTimer = setInterval(() => {
    if (!pendingAdds.length) return clearInterval(addTimer);
    if (++tries > ADD_TRIES) {
      clearInterval(addTimer);
      toast(`The map at ${mapOrigin()} did not take ${pendingAdds.splice(0).join(", ")}: it needs the new SC-map (SC_MAP_URL)`);
      return;
    }
    flushAdds();
  }, ADD_RETRY_MS);
}

function paletteHandlers() {
  return {
    addToList: async (name) => {
      if (shopping.some((i) => i.name.toLowerCase() === name.toLowerCase())) return toast(`${name} is already on the list`);
      if (shopping.length >= MAX_ITEMS) return toast("The shopping list is full");
      if (!pendingAdds.includes(name)) pendingAdds.push(name);
      ensureMapFrame(); // the map's shopping card is where the list lives
      flushAdds();
      retryAdds();
      toast(`${name}: adding to the shopping list`);
    },
    setStart: async (place) => {
      await api.action("set_start", { place });
      toast(`Start: ${place}`);
    },
    setShip: async (ship) => {
      await api.action("set_ship", { ship });
      toast(`Ship: ${ship}`);
    },
    viewOnMap: async (place) => {
      mapFocus = { place, nonce: Date.now() };
      ensureMapFrame();
    },
  };
}

// ---- modes and connection --------------------------------------------------

function setMode(next) {
  flushSave(); // no change waits in the pause when the overlay goes back to the game
  mode = next;
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); // no stale controls kept in game mode
  document.body.className = `mode-${mode}`;
  if (mode === "game" && palette) palette.close();
  if (mode === "game" && settingsPanel && settingsPanel.isOpen) settingsPanel.close(); // also gives the shortcuts back
  $("bar").hidden = mode === "game";
  $("edit").textContent = mode === "edit" ? "Done" : "Edit layout";
  refreshProfiles();
  renderAll();
}

function drawLink(state) {
  const pill = $("link");
  pill.textContent = state.status;
  pill.className = `pill ${state.status === "ok" ? "ok" : state.status === "error" ? "error" : ""}`;
  pill.title = state.error || "";
  renderAll();
}

async function main() {
  await loadSettings();
  applyDim();
  mount();
  api.subscribe(drawLink);
  $("profile").addEventListener("change", (e) => useProfile(e.target.value));
  tauri.core.invoke("pause_hotkeys", { paused: false }).catch(() => {}); // a pause left by a page that was reloaded
  settingsPanel = createSettingsPanel({
    root: $("settings"),
    invoke: tauri.core.invoke,
    dim: {
      get: () => dimOf(settings),
      set: (value) => { setDim(settings, value); applyDim(); save(); },
    },
    blur: {
      get: () => blurOf(settings),
      set: (on) => {
        setBlur(settings, on);
        tauri.core.invoke("set_blur_enabled", { enabled: on }).catch(() => {});
        save();
      },
    },
    saveHotkeys: async (patch) => {
      setHotkeys(settings, patch);
      showKeyLabels().catch(() => {});
      return flushSave();
    },
    actions: {
      profiles: () => ({ names: [...settings.profiles.keys()], active: settings.active }),
      use: (name) => { useProfile(name); return ""; },
      add: (name) => {
        const added = addProfile(settings, name, boxes);
        if (!added) return "Profile name empty, reserved or already used";
        useProfile(added);
        return "";
      },
      rename: (from, to) => {
        if (!renameProfile(settings, from, to)) return "Profile name empty, reserved or already used";
        save();
        refreshProfiles();
        return "";
      },
      remove: (name) => {
        if (!removeProfile(settings, name)) return "The last profile stays";
        boxes = activeBoxes(settings);
        for (const def of WIDGETS) applyBox(def.type);
        save();
        renderAll();
        refreshProfiles();
        return "";
      },
    },
  });
  $("settings-btn").addEventListener("click", () => settingsPanel.toggle());
  window.addEventListener("pagehide", flushSave);
  $("edit").addEventListener("click", () => tauri.core.invoke("set_mode", { mode: mode === "edit" ? "interaction" : "edit" }));
  $("back").addEventListener("click", () => tauri.core.invoke("set_mode", { mode: "game" }));
  $("quit").addEventListener("click", () => tauri.core.invoke("quit_app"));
  $("add").addEventListener("change", (e) => {
    const type = e.target.value;
    if (!type) return;
    boxes[type].hidden = false;
    save();
    renderAll();
  });
  window.addEventListener("resize", () => { for (const def of WIDGETS) applyBox(def.type); });
  for (const def of WIDGETS) if (def.tickMs) setInterval(() => renderWidget(def.type), def.tickMs);

  await tauri.event.listen("mode", (e) => setMode(e.payload));
  const addWarning = (text) => { if (!warnings.includes(text)) warnings.push(text); showNotice(warnings.join(" · ")); };
  await tauri.event.listen("warning", (e) => addWarning(String(e.payload)));
  for (const text of await tauri.core.invoke("get_warnings")) addWarning(String(text));
  mapUrl = await tauri.core.invoke("map_url");
  await showKeyLabels();
  finder = createShopFinder({ apiUrl: await tauri.core.invoke("api_url"), onChange: renderAll });
  window.addEventListener("message", (e) => {
    let origin = null;
    try {
      origin = new URL(mapUrl).origin;
    } catch {
      return;
    }
    const frame = document.querySelector(".map-frame");
    const names = acceptShoppingMessage(e, frame && frame.contentWindow, origin);
    if (!names) return;
    shopping = mergeShopping(shopping, names);
    confirmAdds();
    flushAdds();
    saveShopping();
    renderAll();
  });
  const search = createSearch({ apiUrl: await tauri.core.invoke("api_url") });
  palette = createPalette({
    root: $("palette"),
    input: $("palette-input"),
    search,
    getPlace: () => (api.state.ui && api.state.ui.location && api.state.ui.location.name) || null,
    handlers: paletteHandlers(),
    onEscape: () => tauri.core.invoke("set_mode", { mode: "game" }),
  });
  await tauri.event.listen("palette", () => palette.toggle());
  await tauri.event.listen("profile-next", () => useProfile(nextProfile(settings)));
  await tauri.event.listen("widgets-cycle", () => {
    gameView = nextGameView(gameView);
    renderAll();
    flash({ pinned: "Widgets: pinned ones", all: "Widgets: all of the profile", none: "Widgets: hidden" }[gameView]);
  });
  setMode(await tauri.core.invoke("get_mode"));
  await api.start();
}

main();

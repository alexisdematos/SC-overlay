import { h, line } from "../dom.js";

/** The embed address: the whole site (search, cards, team, shopping), transparent, 30 fps, reading the service's /state. */
export function mapSrc(base, port) {
  const url = new URL(base);
  const query = ["embed", "bg=transparent", "fps=30"];
  if (Number.isInteger(port) && port > 0) query.push(`live=${port}`);
  return `${url.origin}/?${query.join("&")}`;
}

/** The map's address fragment for a place: #Lorville, #HUR-L2_Faithful_Dream_Station. */
export function placeHash(name) {
  return `#${encodeURI(String(name).replaceAll(" ", "_"))}`;
}

// SC-map in an iframe. The frame is created once: a new /ui must not reload the map.
export const map = {
  type: "map",
  title: "Map",
  defaults: { x: 424, y: 464, w: 640, h: 400, pinned: false },

  render(el, { mapUrl, servicePort, mapFocus }) {
    if (!mapUrl) return el.replaceChildren(line("Map address unknown", "muted"));
    let src;
    try {
      src = mapSrc(mapUrl, servicePort);
    } catch {
      return el.replaceChildren(line("Bad map address", "warn"));
    }
    const frame = el.querySelector("iframe");
    const hash = mapFocus ? placeHash(mapFocus.place) : "";
    if (!frame || frame.dataset.src !== src) {
      el.replaceChildren(h("iframe", {
        class: "map-frame", src: src + hash, "data-src": src, "data-focus": mapFocus ? String(mapFocus.nonce) : "", title: "Map",
      }));
      return;
    }
    // "On the map" from the palette: only the fragment changes, the map selects the place without reloading
    if (mapFocus && frame.dataset.focus !== String(mapFocus.nonce)) {
      frame.dataset.focus = String(mapFocus.nonce);
      frame.src = src + hash;
    }
  },

  /** Shown or hidden: a hidden map stops drawing (the frame cannot tell by itself). */
  visibility(el, shown, { mapUrl }) {
    const frame = el.querySelector("iframe");
    if (!frame || !frame.contentWindow || !mapUrl) return;
    try {
      frame.contentWindow.postMessage({ pause: !shown }, new URL(mapUrl).origin);
    } catch {
      // bad address: nothing to pause
    }
  },
};

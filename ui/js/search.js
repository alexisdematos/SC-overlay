// What the search palette asks the VerseTime API: places (/locations), ships (/ships), and the best matching
// item with the shops that sell it (/buy). Pure of the DOM; fetch is injected.

export const MIN_QUERY = 2;
export const ITEM_MIN_QUERY = 3;
const MAX_QUERY = 60;
const MAX_PLACES = 5;
const MAX_SHIPS = 4;
const MAX_SHOPS = 3;
// The API answers these when nothing matches: not a failure to show
const NO_MATCH = new Set([400, 404, 422]);

class ApiFailure extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export function createSearch({ apiUrl, fetchImpl = globalThis.fetch }) {
  async function get(path, params) {
    const response = await fetchImpl(`${apiUrl}${path}?${new URLSearchParams({ ...params, lang: "en" })}`);
    let body = null;
    try {
      body = await response.json();
    } catch {
      // not JSON: judged by the status below
    }
    if (!response.ok) throw new ApiFailure((body && body.error) || `HTTP ${response.status}`, response.status);
    if (body === null) throw new ApiFailure("unreadable answer", response.status);
    return body;
  }

  /** `text` typed in the palette, `place` where the player is (or null). Never throws: failures come back in `errors`. */
  async function search(text, place) {
    const q = String(text || "").trim().slice(0, MAX_QUERY);
    const out = { query: q, places: [], ships: [], item: null, errors: [] };
    if (q.length < MIN_QUERY) return out;

    const asks = [get("/locations", { q }), get("/ships", { q })];
    asks.push(q.length >= ITEM_MIN_QUERY ? get("/buy", place ? { item: q, from: place } : { item: q }) : Promise.resolve(null));
    const [places, ships, item] = await Promise.allSettled(asks);

    const fail = (what, r) => {
      if (r.status === "rejected" && !NO_MATCH.has(r.reason && r.reason.status)) out.errors.push(`${what}: ${r.reason && r.reason.message}`);
    };
    fail("places", places);
    fail("ships", ships);
    fail("items", item);

    if (places.status === "fulfilled" && Array.isArray(places.value)) {
      out.places = places.value.slice(0, MAX_PLACES).filter((p) => p && p.name).map((p) => ({
        name: String(p.name), type: p.type || "", body: p.body || "", system: p.system || "",
        services: Array.isArray(p.services) ? p.services.map(String) : [],
      }));
    }
    if (ships.status === "fulfilled" && Array.isArray(ships.value)) {
      out.ships = ships.value.slice(0, MAX_SHIPS).filter((s) => s && s.name).map((s) => ({
        name: String(s.name), drive: driveText(s.quantumDrive),
      }));
    }
    if (item.status === "fulfilled" && item.value && item.value.item && item.value.item.name) {
      out.item = {
        name: String(item.value.item.name),
        category: item.value.item.category || "",
        shops: (Array.isArray(item.value.shops) ? item.value.shops : []).slice(0, MAX_SHOPS).filter((s) => s && s.location).map((s) => ({
          shop: s.shop || "", location: String(s.location), system: s.system || "",
          priceAuec: Number.isFinite(s.priceAuec) ? s.priceAuec : null,
          trip: s.travel && s.travel.text ? String(s.travel.text) : null,
        })),
      };
    }
    return out;
  }

  /** The API's own sentence about the time at a place ("It is 14:20 ..."), or null. */
  async function timeAt(name) {
    try {
      const answer = await get("/time", { location: name });
      return answer && typeof answer.summary === "string" ? answer.summary : null;
    } catch {
      return null;
    }
  }

  return { search, timeAt };
}

function driveText(d) {
  if (!d || !d.name) return "";
  return `${d.name} (size ${d.size ?? "?"}, ${d.speedKmS ?? "?"} km/s, spool ${d.spoolSeconds ?? "?"} s)`;
}

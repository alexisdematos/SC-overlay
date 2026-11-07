// "Is this item sold where I am?": asks the API (GET /buy?item=&from=) and remembers the answer per item and place.

const MAX_ENTRIES = 200;

export function createShopFinder({ apiUrl, fetchImpl = globalThis.fetch, now = Date.now, onChange = () => {}, ttlMs = 30 * 60e3, retryMs = 60e3 }) {
  const cache = new Map(); // key -> { status, offer, name, until }
  const asking = new Set();

  const keyOf = (item, place) => `${item.toLowerCase()}|${place.toLowerCase()}`;

  /** The shop of `place` (the cheapest one) among the answer's shops, or null. */
  function offerAt(answer, place) {
    const here = (answer.shops || []).filter((s) => s && typeof s.location === "string" && s.location.toLowerCase() === place.toLowerCase() && Number.isFinite(s.priceAuec));
    if (!here.length) return null;
    const best = here.reduce((a, b) => (b.priceAuec < a.priceAuec ? b : a));
    return { shop: best.shop || "", priceAuec: best.priceAuec };
  }

  async function ask(item, place, key) {
    asking.add(key);
    let entry;
    try {
      const query = new URLSearchParams({ item, from: place, lang: "en" });
      const response = await fetchImpl(`${apiUrl}/buy?${query}`);
      const answer = await response.json();
      if (!response.ok) throw new Error((answer && answer.error) || `HTTP ${response.status}`);
      entry = { status: "ok", offer: offerAt(answer, place), name: (answer.item && answer.item.name) || item, until: now() + ttlMs };
    } catch (e) {
      entry = { status: "error", offer: null, name: item, error: String(e.message || e), until: now() + retryMs };
    }
    asking.delete(key);
    cache.set(key, entry);
    if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value);
    onChange();
  }

  /** The known answer (it may be a little old while a new one is asked), or a "loading" one. */
  function check(item, place) {
    if (!item || !place) return { status: "none", offer: null };
    const key = keyOf(item, place);
    const entry = cache.get(key);
    if ((!entry || entry.until <= now()) && !asking.has(key)) ask(item, place, key);
    return entry || { status: "loading", offer: null };
  }

  return { check };
}

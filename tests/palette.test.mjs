import assert from "node:assert/strict";
import test from "node:test";

import { moveSelection, rowsOf } from "../ui/js/rows.js";
import { createSearch } from "../ui/js/search.js";
import { placeHash } from "../ui/js/widgets/map.js";

function api(routes) {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    const path = new URL(url).pathname;
    const hit = routes[path];
    if (!hit) return { ok: false, status: 404, json: async () => ({ error: "nope" }) };
    if (hit.status) return { ok: false, status: hit.status, json: async () => ({ error: hit.error || "x" }) };
    return { ok: true, status: 200, json: async () => hit.body };
  };
  return { urls, search: createSearch({ apiUrl: "https://api.test", fetchImpl }) };
}

const LOCATIONS = [{ name: "Lorville", type: "city", body: "Hurston", system: "Stanton", services: ["shops", "bar"] }];
const SHIPS = [{ name: "Cutlass Black", quantumDrive: { name: "Atlas", size: 1, speedKmS: 200000, spoolSeconds: 5 } }];
const BUY = { item: { name: "MedPen", category: "Medical" }, shops: [{ shop: "Pharmacy", location: "Lorville", system: "Stanton", priceAuec: 750, travel: { text: "4 min" } }] };

test("search ignores short text and never calls the API", async () => {
  const { urls, search } = api({});
  const out = await search.search(" a ", "Lorville");
  assert.deepEqual([out.places, out.ships, out.item, out.errors], [[], [], null, []]);
  assert.equal(urls.length, 0);
});

test("search merges places, ships and the best item", async () => {
  const { urls, search } = api({ "/locations": { body: LOCATIONS }, "/ships": { body: SHIPS }, "/buy": { body: BUY } });
  const out = await search.search("medpen", "Lorville");
  assert.equal(out.places[0].name, "Lorville");
  assert.match(out.ships[0].drive, /Atlas/);
  assert.deepEqual([out.item.name, out.item.shops[0].priceAuec, out.item.shops[0].trip], ["MedPen", 750, "4 min"]);
  assert.ok(urls.some((u) => u.includes("/buy?") && u.includes("from=Lorville")));
});

test("two letters ask places and ships but not the item", async () => {
  const { urls, search } = api({ "/locations": { body: LOCATIONS }, "/ships": { body: [] } });
  await search.search("lo", null);
  assert.equal(urls.some((u) => u.includes("/buy")), false);
});

test("no match statuses are silent, real failures are reported", async () => {
  const quiet = api({ "/locations": { body: [] }, "/ships": { body: [] }, "/buy": { status: 404 } });
  assert.deepEqual((await quiet.search.search("zzzz", null)).errors, []);
  const broken = api({ "/locations": { status: 500, error: "boom" }, "/ships": { body: [] }, "/buy": { status: 400 } });
  const out = await broken.search.search("zzzz", null);
  assert.equal(out.errors.length, 1);
  assert.match(out.errors[0], /places: boom/);
});

test("timeAt returns the API sentence or null", async () => {
  const ok = api({ "/time": { body: { summary: "It is 14:20" } } });
  assert.equal(await ok.search.timeAt("Lorville"), "It is 14:20");
  const bad = api({});
  assert.equal(await bad.search.timeAt("Lorville"), null);
});

test("rows carry the essentials and run the right handler", async () => {
  const calls = [];
  const handlers = Object.fromEntries(["addToList", "setStart", "viewOnMap", "setShip", "showTime"].map((n) => [n, (x) => calls.push([n, x])]));
  const { search } = api({ "/locations": { body: LOCATIONS }, "/ships": { body: SHIPS }, "/buy": { body: BUY } });
  const rows = rowsOf(await search.search("medpen", "Lorville"), handlers);
  assert.deepEqual(rows.map((r) => r.kind), ["place", "ship", "item"]);
  rows[0].primary.run();
  rows[0].actions[0].run();
  rows[0].actions[1].run();
  rows[1].primary.run();
  rows[2].primary.run();
  rows[2].shops[0].actions[0].run();
  assert.deepEqual(calls, [
    ["showTime", "Lorville"], ["setStart", "Lorville"], ["viewOnMap", "Lorville"],
    ["setShip", "Cutlass Black"], ["addToList", "MedPen"], ["setStart", "Lorville"],
  ]);
  assert.match(rows[2].shops[0].text, /750 aUEC/);
});

test("moveSelection wraps and handles empty lists", () => {
  assert.equal(moveSelection(-1, 1, 0), -1);
  assert.equal(moveSelection(-1, 1, 3), 0);
  assert.equal(moveSelection(-1, -1, 3), 2);
  assert.equal(moveSelection(2, 1, 3), 0);
  assert.equal(moveSelection(0, -1, 3), 2);
});

test("placeHash fits the map's #Place_Name format", () => {
  assert.equal(placeHash("Lorville"), "#Lorville");
  assert.equal(placeHash("HUR-L2 Faithful Dream Station"), "#HUR-L2_Faithful_Dream_Station");
  assert.equal(placeHash("A B&C"), "#A_B&C");
});

test("a non-JSON 404 reads as no match, a non-JSON 500 as a failure", async () => {
  const make = (status) => createSearch({
    apiUrl: "https://api.test",
    fetchImpl: async (url) => (new URL(url).pathname === "/buy"
      ? { ok: false, status, json: async () => { throw new SyntaxError("not json"); } }
      : { ok: true, status: 200, json: async () => [] }),
  });
  assert.deepEqual((await make(404).search("medpen", null)).errors, []);
  assert.equal((await make(500).search("medpen", null)).errors.length, 1);
});

import assert from "node:assert/strict";
import test from "node:test";

import { createShopFinder } from "../ui/js/shopfinder.js";
import { acceptShoppingMessage, mergeShopping, parseSaved, sanitizeNames, setBought } from "../ui/js/shopping.js";
import { remindersOf } from "../ui/js/widgets/here.js";

test("sanitizeNames keeps clean, unique, short names", () => {
  assert.equal(sanitizeNames("nope"), null);
  assert.deepEqual(sanitizeNames([" MedPen ", "medpen", "", 5, null, "P4-AR", "x".repeat(81)]), ["MedPen", "P4-AR"]);
  assert.equal(sanitizeNames(Array.from({ length: 20 }, (_, i) => `item${i}`)).length, 8);
});

test("mergeShopping keeps the bought flag and drops what the map dropped", () => {
  const current = [{ name: "MedPen", done: true }, { name: "Gone", done: true }];
  assert.deepEqual(mergeShopping(current, ["medpen", "P4-AR"]), [{ name: "medpen", done: true }, { name: "P4-AR", done: false }]);
  assert.deepEqual(mergeShopping(current, []), []);
});

test("parseSaved survives bad text", () => {
  assert.deepEqual(parseSaved(""), []);
  assert.deepEqual(parseSaved("{"), []);
  assert.deepEqual(parseSaved('{"a":1}'), []);
  assert.deepEqual(parseSaved('[{"name":"MedPen","done":true},{"name":5},null]'), [{ name: "MedPen", done: true }]);
});

test("setBought changes one item", () => {
  const list = [{ name: "a", done: false }, { name: "b", done: false }];
  assert.deepEqual(setBought(list, "b", true), [{ name: "a", done: false }, { name: "b", done: true }]);
});

test("a shopping message counts only from the map frame and its origin", () => {
  const frame = {};
  const good = { source: frame, origin: "https://site.example", data: { shopping: ["MedPen"] } };
  assert.deepEqual(acceptShoppingMessage(good, frame, "https://site.example"), ["MedPen"]);
  assert.equal(acceptShoppingMessage({ ...good, source: {} }, frame, "https://site.example"), null);
  assert.equal(acceptShoppingMessage({ ...good, origin: "https://evil.example" }, frame, "https://site.example"), null);
  assert.equal(acceptShoppingMessage(good, null, "https://site.example"), null);
  assert.equal(acceptShoppingMessage({ ...good, data: null }, frame, "https://site.example"), null);
  assert.equal(acceptShoppingMessage({ ...good, data: { shopping: "x" } }, frame, "https://site.example"), null);
});

function answer(shops) {
  return { ok: true, status: 200, json: async () => ({ item: { name: "P4-AR Rifle" }, shops }) };
}

test("the finder finds the cheapest shop of the place, asks once, and remembers", async () => {
  const urls = [];
  let t = 1000;
  let changes = 0;
  const finder = createShopFinder({
    apiUrl: "https://api.test",
    now: () => t,
    onChange: () => changes++,
    fetchImpl: async (url) => {
      urls.push(url);
      return answer([
        { shop: "Centermass", location: "Lorville", priceAuec: 4625 },
        { shop: "Cubby Blast", location: "lorville", priceAuec: 4100 },
        { shop: "Elsewhere", location: "Orison", priceAuec: 1 },
        { shop: "Broken", location: "Lorville", priceAuec: null }, // never the cheapest, whatever its number
      ]);
    },
  });
  assert.equal(finder.check("p4ar", "Lorville").status, "loading");
  assert.equal(finder.check("p4ar", "Lorville").status, "loading"); // still one request
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(urls.length, 1);
  assert.equal(urls[0], "https://api.test/buy?item=p4ar&from=Lorville&lang=en");
  const entry = finder.check("p4ar", "Lorville");
  assert.deepEqual([entry.status, entry.offer, entry.name], ["ok", { shop: "Cubby Blast", priceAuec: 4100 }, "P4-AR Rifle"]);
  assert.equal(urls.length, 1); // cached
  assert.equal(changes, 1);
  t += 31 * 60e3; // expired: asked again, the old answer shows meanwhile
  assert.equal(finder.check("p4ar", "Lorville").status, "ok");
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(urls.length, 2);
});

test("not sold here is an ok answer without offer; errors are remembered for a minute", async () => {
  let t = 0;
  let calls = 0;
  const finder = createShopFinder({
    apiUrl: "https://api.test",
    now: () => t,
    fetchImpl: async () => {
      calls++;
      if (calls === 1) return answer([{ shop: "x", location: "Orison", priceAuec: 5 }]);
      return { ok: false, status: 400, json: async () => ({ error: "unknown item" }) };
    },
  });
  finder.check("a", "Lorville");
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(finder.check("a", "Lorville").offer, null);
  finder.check("b", "Lorville");
  await new Promise((r) => setTimeout(r, 0));
  const failed = finder.check("b", "Lorville");
  assert.equal(failed.status, "error");
  assert.match(failed.error, /unknown item/);
  finder.check("b", "Lorville");
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls, 2); // not asked again before the retry delay
  t += 61e3;
  finder.check("b", "Lorville");
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls, 3);
});

test("the finder does nothing without an item or a place", () => {
  const finder = createShopFinder({ apiUrl: "https://api.test", fetchImpl: async () => { throw new Error("must not be called"); } });
  assert.equal(finder.check("", "Lorville").status, "none");
  assert.equal(finder.check("a", "").status, "none");
});

const suggestion = (patch = {}) => ({
  buyPlace: "Lorville", sellPlace: "Area18", name: "Agricium", scu: 32, buy: 25, sell: 30, profit: 45000,
  done: { buy: false, sell: false }, ...patch,
});

test("trade reminders: buy here, sell here, ticked ones gone, off when trade is off", () => {
  const ui = (place, over = {}) => ({ location: { name: place }, trade: { on: true, suggestions: [suggestion(over)] } });
  const shop = () => ({ status: "none" });
  assert.deepEqual(remindersOf({ ui: ui("Lorville"), shop }).trades.map((t) => t.text), ["Buy 32 SCU Agricium (25/SCU)"]);
  assert.deepEqual(remindersOf({ ui: ui("Area18"), shop }).trades.map((t) => t.text), ["Sell 32 SCU Agricium (+45k)"]);
  assert.equal(remindersOf({ ui: ui("Orison"), shop }).trades.length, 0);
  assert.equal(remindersOf({ ui: ui("Lorville", { done: { buy: true, sell: false } }), shop }).trades.length, 0);
  assert.equal(remindersOf({ ui: { ...ui("Lorville"), trade: { on: false, suggestions: [suggestion()] } }, shop }).trades.length, 0);
});

test("no location, no reminder, and no shop question", () => {
  const shop = () => { throw new Error("must not be asked"); };
  const r = remindersOf({ ui: { location: { name: null }, trade: {} }, shopping: [{ name: "MedPen", done: false }], shop });
  assert.deepEqual(r, { place: null, trades: [], items: [] });
  assert.equal(remindersOf({ ui: null, shop }).place, null);
});

test("shopping reminders: only open items sold here", () => {
  const entries = {
    MedPen: { status: "ok", offer: { shop: "Pharmacy", priceAuec: 12400 }, name: "MedPen" },
    Rifle: { status: "ok", offer: null, name: "P4-AR Rifle" },
    Slow: { status: "loading", offer: null },
    Bad: { status: "error", offer: null },
  };
  const asked = [];
  const shop = (name) => { asked.push(name); return entries[name]; };
  const shopping = ["MedPen", "Rifle", "Slow", "Bad", "Done"].map((name) => ({ name, done: name === "Done" }));
  const r = remindersOf({ ui: { location: { name: "Lorville" } }, shopping, shop });
  assert.deepEqual(r.items.map((i) => [i.name, i.offer.priceAuec]), [["MedPen", 12400]]);
  assert.deepEqual(asked, ["MedPen", "Rifle", "Slow", "Bad"]); // the bought one is not asked
});

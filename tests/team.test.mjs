import assert from "node:assert/strict";
import test from "node:test";

import { serverOf } from "../ui/js/widgets/team.js";

const member = (shard) => ({ id: "m", state: shard === undefined ? {} : { shard } });

test("serverOf: same, other, or unknown when a shard is missing", () => {
  assert.equal(serverOf("pub_a_1_1", member("pub_a_1_1")), "same");
  assert.equal(serverOf("pub_a_1_1", member("pub_b_2_2")), "other");
  assert.equal(serverOf(null, member("pub_a_1_1")), "unknown");
  assert.equal(serverOf("pub_a_1_1", member(undefined)), "unknown");
  assert.equal(serverOf("pub_a_1_1", { id: "m" }), "unknown");
  assert.equal(serverOf("pub_a_1_1", null), "unknown");
});

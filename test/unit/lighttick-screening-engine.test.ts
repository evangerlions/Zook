import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { screen } from "../../src/modules/lighttick/investments/screening/screen.engine.ts";
import { ruleFields } from "../../src/modules/lighttick/investments/screening/screen.validation.ts";
import {
  numeric,
  from,
  compare,
} from "../../src/modules/lighttick/investments/screening/screen.rational.ts";
const golden = JSON.parse(
  readFileSync(
    new URL("../fixtures/lighttick/screening-golden.json", import.meta.url),
    "utf8",
  ),
);
export const manual = { source: "manual", quote: "", reason: "" };
export function makeInput(item: any, fields: any, on: string): any {
  return {
    rule: { id: "inv-rule-fixture", revision: 1, fields },
    template: {
      id: "inv-template-fixture",
      revision: 1,
      fields: { name: "Synthetic" },
    },
    as_of: on,
    decision_at: on + "T16:00:00+08:00",
    algorithm_version: "screen-rational-session-v1",
    digest: "a".repeat(64),
    sources: [
      {
        instrument: {
          id: item.instrument_id,
          code: item.code,
          market: "SSE",
          name: item.name,
          revision: 1,
        },
        snapshot: {
          id: "inv-snapshot-fixture",
          revision: 1,
          dataset: {
            ...item,
            calendar: item.calendar,
            input_digest: "b".repeat(64),
            supplier: "csv",
            adapter_version: "synthetic",
            available_at: on + "T16:00:00+08:00",
            bars: item.bars.map((b: any) => ({
              ...b,
              open: b.close,
              low: b.close,
              amount_cny: b.turnover_cny,
              turnover_rate_pct: b.turnover_rate_pct ?? null,
            })),
            limitations: [],
          },
        },
        security_status: item.security_status ?? null,
      },
    ],
  };
}
for (const c of golden.cases)
  test("exact legacy field/three-valued golden " + c.id, async () => {
    const request = { ...c.request };
    delete request.as_of;
    const modified = { ...c, request };
    const item = golden.items[c.item_key];
    const fields = ruleFields({
      name: "Synthetic rule",
      description: "",
      source_text: "",
      ...request,
      conditions: request.conditions.map((x: any) => ({
        ...x,
        mapping: manual,
      })),
      recipe: null,
      sort_mapping: manual,
    });
    const result = await screen(makeInput(item, fields, c.request.as_of)),
      e = result.evaluations[0];
    assert.equal(e.status, c.expected.status);
    assert.deepEqual(e.values, c.expected.values);
    assert.deepEqual(
      e.details.map((d) => d.result),
      c.expected.condition_results,
    );
    assert.equal(
      result.output_digest,
      (await screen(makeInput(item, fields, c.request.as_of))).output_digest,
    );
  });
for (const c of golden.recipes)
  test("exact legacy bounded recipe " + c.id, async () => {
    const request = { ...c.request };
    delete request.as_of;
    const fields = ruleFields({
        name: "Synthetic recipe",
        description: "",
        source_text: "",
        ...request,
        recipe: c.recipe,
        sort_mapping: manual,
      }),
      result = await screen(
        makeInput(golden.items[c.item_key], fields, c.request.as_of),
      );
    assert.equal(result.evaluations[0].status, c.expected.status);
    assert.deepEqual(
      result.evaluations[0].details.map((d) => d.result),
      c.expected.condition_results,
    );
  });
test("strict rational comparison, invalid numbers/prototype fields and inclusive intervals", () => {
  assert.equal(compare(from("1e-60"), from("0")), 1);
  for (const v of [
    1,
    "NaN",
    "Infinity",
    "1e61",
    "1e20",
    "0." + "0".repeat(60) + "1",
  ])
    assert.throws(() => numeric(v));
  const fields = {
    name: "r",
    description: "",
    source_text: "",
    conditions: [],
    combine: "all",
    sort_by: "close",
    descending: true,
    secondary_sort_by: null,
    secondary_descending: true,
    limit: 20,
    recipe: null,
    sort_mapping: manual,
  };
  assert.throws(() => ruleFields({ ...fields, sort_by: "__proto__" }));
  assert.throws(() =>
    ruleFields({
      ...fields,
      conditions: [
        {
          field: "close",
          op: "between",
          value: "2",
          upper_value: "1",
          mapping: manual,
        },
      ],
    }),
  );
});
test("missing snapshot is explicit unknown and ties/order remain deterministic with exact secondary sorting", async () => {
  const c = golden.cases[0],
    item = golden.items[c.item_key],
    fields = {
      name: "r",
      conditions: [],
      combine: "all",
      sort_by: "close",
      descending: true,
      secondary_sort_by: null,
      secondary_descending: true,
      limit: 1,
      recipe: null,
    },
    i = makeInput(item, fields, c.request.as_of);
  i.sources.push({
    ...i.sources[0],
    instrument: {
      ...i.sources[0].instrument,
      id: "inv-missing-fixture",
      code: "600001",
    },
    snapshot: null,
  });
  const output = await screen(i);
  assert.equal(output.unresolved, 1);
  assert.equal(output.evaluations[1].status, "unknown");
  assert.ok(output.evaluations[1].source.snapshot_id === null);
});
test("same-day unfinished session is unknown even with an early available bar", async () => {
  const c = golden.cases[0],
    input = makeInput(
      golden.items[c.item_key],
      {
        name: "intraday",
        conditions: [],
        combine: "all",
        sort_by: "close",
        descending: true,
        secondary_sort_by: null,
        secondary_descending: true,
        limit: 20,
        recipe: null,
      },
      c.request.as_of,
    );
  input.decision_at = input.as_of + "T06:30:00Z";
  const result = await screen(input);
  assert.equal(result.evaluations[0].status, "unknown");
  assert.match(result.evaluations[0].sorting[0].reason!, /^SESSION_INCOMPLETE/);
});
test("equal primary values use exact secondary, then stable symbol identity without rounded-number sorting", async () => {
  const c = golden.cases[0],
    input = makeInput(
      golden.items[c.item_key],
      {
        name: "sort",
        conditions: [],
        combine: "all",
        sort_by: "close",
        descending: true,
        secondary_sort_by: "turnover_cny",
        secondary_descending: true,
        limit: 20,
        recipe: null,
      },
      c.request.as_of,
    );
  const source = input.sources[0];
  input.sources = ["600003", "600001", "600002"].map((code, j) => {
    const s = structuredClone(source);
    s.instrument.id = "inv-sort-fixture-" + j;
    s.instrument.code = code;
    const bar = s.snapshot!.dataset.bars.find((b) => b.date === input.as_of)!;
    bar.close = "10";
    bar.amount_cny =
      j === 0
        ? "100.000000000000000000000000000001"
        : "100.000000000000000000000000000002";
    return s;
  });
  const result = await screen(input);
  assert.deepEqual(
    result.items.map((i) => i.code),
    ["600001", "600002", "600003"],
  );
  assert.equal(
    result.items[0].values.turnover_cny,
    result.items[2].values.turnover_cny,
  );
  assert.equal(result.items[0].sorting.length, 2);
});

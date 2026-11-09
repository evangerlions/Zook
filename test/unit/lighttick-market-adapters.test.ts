import test from "node:test";
import assert from "node:assert/strict";
import { DailyMarketAdapter } from "../../src/modules/lighttick/investments/market/market.adapter.ts";
import { MarketTransport } from "../../src/modules/lighttick/investments/market/market.transport.ts";
import { marketJson } from "../../src/modules/lighttick/investments/market/lossless-json.ts";
import { referenceCalendar } from "../../src/modules/lighttick/investments/market/market.calendar.ts";
import { csvRows } from "../../src/modules/lighttick/investments/market/market.csv.ts";
import type {
  DailySupplier,
  DailyRequest,
} from "../../src/modules/lighttick/investments/market/market.types.ts";
const now = () => new Date("2026-11-05T08:00:00Z"),
  signal = () => new AbortController().signal;
const instrument = {
  id: "inv-synthetic-symbol",
  revision: 1,
  code: "600000",
  market: "SSE",
  kind: "stock",
  name: "Synthetic",
  archived: false,
  created_at: now().toISOString(),
  updated_at: now().toISOString(),
} as const;
const input: DailyRequest = {
  instrument,
  start: "2026-10-28",
  end: "2026-10-30",
};
const policy = async (_s: DailySupplier) => ({
  enabled: true,
  revision: "synthetic-v1",
  tushare_token: "SYNTHETIC_TOKEN_NOT_REAL",
});
const eastPacket = () => ({
  rc: 0,
  data: {
    code: "600000",
    market: 1,
    klines: [
      "2026-10-30,10,11,12,9,0.0000000001,9007199254740993.0000000001,0,0,0,0.87",
    ],
  },
});
const fake = (
  perform: (url: string, init: RequestInit) => Response | Promise<Response>,
) =>
  new MarketTransport((async (u: any, i: any) =>
    perform(String(u), i)) as typeof fetch);
test("raw JSON numbers are preserved before float parsing, including escaped strings and extreme integers", () => {
  assert.deepEqual(
    marketJson(
      '{"n":9007199254740993.0000000001,"s":"a\\\"123\\\"","b":true,"nil":null,"array":[1e-10,-0.0100]}',
    ),
    {
      n: "9007199254740993.0000000001",
      s: 'a"123"',
      b: true,
      nil: null,
      array: ["1e-10", "-0.0100"],
    },
  );
  for (const s of [
    '{"n":01}',
    '{"n":1e}',
    '{"n":NaN}',
    "[1,]",
    '"unterminated',
    "[".repeat(41) + "]".repeat(41),
  ])
    assert.throws(() => marketJson(s));
});
test("CSV Chinese aliases, quoted fields, tiny amounts and explicitly declared units retain decimal precision", async () => {
  assert.deepEqual(csvRows('a,b\r\n"x,y","q""z"\r\n'), [
    ["a", "b"],
    ["x,y", 'q"z'],
  ]);
  const r = await new DailyMarketAdapter(
    policy,
    fake(() => {
      throw Error("CSV must not use network");
    }),
    now,
  ).read(
    "csv",
    {
      ...input,
      declared_source: "Synthetic CSV",
      volume_unit: "lots100",
      amount_unit: "thousand_CNY",
      csv: "日期,开盘,最高,最低,收盘,成交量,成交额,换手率\r\n2026-10-30,10,12,9,11,0.0000000001,9007199254740.9930000001,0.87\r\n",
    },
    signal(),
  );
  assert.equal(r.bars[0].volume_shares, "0.00000001");
  assert.equal(r.bars[0].amount_cny, "9007199254740993.0000001");
  assert.deepEqual(r.missing_sessions, ["2026-10-28", "2026-10-29"]);
  assert.equal(r.price_basis, "unadjusted");
  assert.equal(r.realtime, false);
  assert.ok(r.input_digest);
});
test("CSV invalid quotes/units, duplicate dates, closed sessions and unfinished current-day data fail explicitly", async () => {
  const adapter = new DailyMarketAdapter(policy, undefined, now),
    base = {
      ...input,
      declared_source: "Synthetic",
      volume_unit: "shares" as const,
      amount_unit: "CNY" as const,
    },
    header = "date,open,high,low,close,volume,amount\n";
  for (const csv of [
    header + "2026-10-30,10,12,9,11,1,1\n2026-10-30,10,12,9,11,1,1",
    header + "2026-10-30,13,12,9,11,1,1",
    header + '2026-10-30,10,12,9,11,"1"bad,1',
  ])
    await assert.rejects(adapter.read("csv", { ...base, csv }, signal()));
  await assert.rejects(
    adapter.read(
      "csv",
      {
        ...base,
        volume_unit: undefined,
        csv: header + "2026-10-30,10,12,9,11,1,1",
      },
      signal(),
    ),
    { reason: "CSV_SOURCE_UNITS_REQUIRED" },
  );
  await assert.rejects(
    adapter.read(
      "csv",
      {
        ...base,
        start: "2026-10-01",
        end: "2026-10-07",
        csv: header + "2026-10-01,10,12,9,11,1,1",
      },
      signal(),
    ),
    { reason: "CLOSED_CALENDAR_SESSION" },
  );
  await assert.rejects(
    new DailyMarketAdapter(
      policy,
      undefined,
      () => new Date("2026-11-05T06:00:00Z"),
    ).read(
      "csv",
      {
        ...base,
        start: "2026-11-05",
        end: "2026-11-05",
        csv: header + "2026-11-05,10,12,9,11,1,1",
      },
      signal(),
    ),
    { reason: "INCOMPLETE_OR_OUTSIDE_DATE" },
  );
});
test("Eastmoney calls one fixed unadjusted HTTPS endpoint and preserves exact amount without a supplier fallback", async () => {
  const calls: any[] = [],
    adapter = new DailyMarketAdapter(
      policy,
      fake((url, init) => {
        calls.push({ url, init });
        return new Response(JSON.stringify(eastPacket()));
      }),
      now,
    ),
    r = await adapter.read("eastmoney", input, signal());
  assert.equal(calls.length, 1);
  const u = new URL(calls[0].url);
  assert.equal(u.origin, "https://push2his.eastmoney.com");
  assert.equal(u.searchParams.get("fqt"), "0");
  assert.equal(calls[0].init.redirect, "error");
  assert.equal(r.bars[0].amount_cny, "9007199254740993.0000000001");
  assert.equal(r.bars[0].volume_shares, "0.00000001");
});
test("Tencent uses one selected daily endpoint and explicit STAR volume versus other-stock lots", async () => {
  for (const [code, market, shares] of [
    ["000001", "SZSE", "1234500"],
    ["688001", "SSE", "12345"],
  ] as const) {
    let count = 0;
    const symbol = (market === "SSE" ? "sh" : "sz") + code;
    const adapter = new DailyMarketAdapter(
      policy,
      fake((url) => {
        ++count;
        assert.equal(new URL(url).hostname, "proxy.finance.qq.com");
        return new Response(
          JSON.stringify({
            code: 0,
            data: {
              [symbol]: {
                day: [
                  ["2026-10-27", "10", "11", "12", "9", "1", "", "", "1"],
                  [
                    "2026-10-30",
                    "10",
                    "11",
                    "12",
                    "9",
                    "12345",
                    "",
                    "",
                    "100000.0000000001",
                  ],
                ],
              },
            },
          }),
        );
      }),
      now,
    );
    const r = await adapter.read(
      "tencent",
      { ...input, instrument: { ...instrument, code, market } },
      signal(),
    );
    assert.equal(count, 1);
    assert.equal(r.bars.length, 1);
    assert.equal(r.bars[0].volume_shares, shares);
    assert.equal(r.bars[0].amount_cny, "1000000000.000001");
  }
});
test("Tushare queries complete provider calendar then exact daily fields; credentials stay outside results", async () => {
  const calls: any[] = [],
    adapter = new DailyMarketAdapter(
      policy,
      fake((_url, init) => {
        const b = JSON.parse(init.body as string);
        calls.push(b);
        assert.equal(b.token, "SYNTHETIC_TOKEN_NOT_REAL");
        return b.api_name === "trade_cal"
          ? new Response(
              '{"code":0,"data":{"fields":["exchange","cal_date","is_open"],"items":[["SSE","20261028",1],["SSE","20261029",1],["SSE","20261030",1]]}}',
            )
          : new Response(
              '{"code":0,"data":{"fields":["ts_code","trade_date","open","high","low","close","vol","amount"],"items":[["600000.SH","20261030",10,12,9,11,0.0000000001,9007199254740.9930000001]]}}',
            );
      }),
      now,
    );
  const r = await adapter.read("tushare", input, signal());
  assert.deepEqual(
    calls.map((c) => c.api_name),
    ["trade_cal", "daily"],
  );
  assert.equal(r.bars[0].amount_cny, "9007199254740993.0000001");
  assert.deepEqual(r.missing_sessions, ["2026-10-28", "2026-10-29"]);
  assert.equal(JSON.stringify(r).includes("SYNTHETIC_TOKEN"), false);
});
test("suppliers are independently disabled and a policy change during IO prevents publishing a result", async () => {
  let calls = 0;
  const adapter = new DailyMarketAdapter(
    async (s) => ({ ...(await policy(s)), enabled: s === "csv" }),
    fake(() => {
      ++calls;
      return new Response("{}");
    }),
    now,
  );
  await assert.rejects(adapter.read("eastmoney", input, signal()), {
    reason: "SUPPLIER_DISABLED",
  });
  assert.equal(calls, 0);
  let version = "1";
  const changed = new DailyMarketAdapter(
    async (s) => ({ ...(await policy(s)), revision: version }),
    fake(() => {
      version = "2";
      return new Response(JSON.stringify(eastPacket()));
    }),
    now,
  );
  await assert.rejects(changed.read("eastmoney", input, signal()), {
    reason: "POLICY_CHANGED",
  });
});
test("provider HTTP/rate limit/network/format errors are specific, single attempt, and never leak credentials", async () => {
  for (const [perform, reason] of [
    [() => new Response("PRIVATE_TOKEN", { status: 429 }), "RATE_LIMIT"],
    [() => new Response("PRIVATE_TOKEN", { status: 503 }), "HTTP_ERROR"],
    [
      () => {
        throw Error("PRIVATE_PROXY_TOKEN");
      },
      "CONNECTION_FAILED",
    ],
    [() => new Response("{broken PRIVATE_TOKEN"), "INVALID_JSON"],
    [() => new Response('{"rc":0,"data":null}'), "INVALID_EASTMONEY_PACKET"],
  ] as const) {
    let calls = 0;
    const adapter = new DailyMarketAdapter(
      policy,
      fake(() => {
        ++calls;
        return perform();
      }),
      now,
    );
    await assert.rejects(
      adapter.read("eastmoney", input, signal()),
      (e: any) => {
        assert.equal(e.reason, reason);
        assert.ok(!String(e).includes("PRIVATE"));
        return true;
      },
    );
    assert.equal(calls, 1);
  }
});
test("response byte limits and cancellation stop before a result; only allowlisted HTTPS hosts are permitted", async () => {
  const transport = fake(
    () => new Response(new Uint8Array(2 * 1024 * 1024 + 1)),
  );
  await assert.rejects(
    transport.text("https://push2his.eastmoney.com/test", {}, signal()),
    { reason: "RESPONSE_TOO_LARGE" },
  );
  await assert.rejects(
    transport.text("http://push2his.eastmoney.com/test", {}, signal()),
    { reason: "INVALID_ENDPOINT" },
  );
  await assert.rejects(transport.text("https://127.0.0.1/test", {}, signal()), {
    reason: "INVALID_ENDPOINT",
  });
  const c = new AbortController();
  c.abort(Error("PRIVATE_REASON"));
  await assert.rejects(
    new DailyMarketAdapter(policy, transport, now).read(
      "eastmoney",
      input,
      c.signal,
    ),
    { reason: "CANCELLED" },
  );
});
test("calendar freezes exchange-specific 2026 holidays and weekend make-up workdays; unsupported/expired coverage stays unknown", () => {
  const c = referenceCalendar("SSE", "2026-09-20", "2026-10-10", now());
  assert.equal(c.status, "available");
  assert.equal(c.sessions["2026-09-20"], false);
  assert.equal(c.sessions["2026-09-25"], false);
  assert.equal(c.sessions["2026-10-01"], false);
  assert.equal(c.sessions["2026-10-08"], true);
  assert.equal(c.sessions["2026-10-10"], false);
  assert.equal(
    referenceCalendar("BSE", input.start, input.end, now()).status,
    "coverage_unknown",
  );
  assert.equal(
    referenceCalendar("SSE", "2025-10-28", "2025-10-30", now()).status,
    "coverage_unknown",
  );
  assert.deepEqual(
    referenceCalendar(
      "SSE",
      input.start,
      input.end,
      new Date("2026-11-28T00:00:00Z"),
    ).sessions,
    {},
  );
});

test("mutable server policy and credential rotation are fenced; availability is no earlier than IO completion", async () => {
  const mutable = {
    enabled: true,
    revision: "1",
    tushare_token: "SYNTHETIC_TOKEN_NOT_REAL",
  };
  const a = new DailyMarketAdapter(
    async () => mutable,
    fake(() => {
      mutable.revision = "2";
      return new Response(JSON.stringify(eastPacket()));
    }),
    now,
  );
  await assert.rejects(a.read("eastmoney", input, signal()), {
    reason: "POLICY_CHANGED",
  });
  const credential = {
    enabled: true,
    revision: "same-config",
    tushare_token: "SYNTHETIC_TOKEN_NOT_REAL",
  };
  const rotated = new DailyMarketAdapter(
    async () => credential,
    fake((_url, init) => {
      const b = JSON.parse(init.body as string);
      if (b.api_name === "trade_cal")
        return new Response(
          JSON.stringify({
            code: 0,
            data: {
              fields: ["exchange", "cal_date", "is_open"],
              items: [["SSE", "20261030", 1]],
            },
          }),
        );
      credential.tushare_token = "SYNTHETIC_ROTATED_NOT_REAL";
      return new Response(
        JSON.stringify({
          code: 0,
          data: {
            fields: [
              "ts_code",
              "trade_date",
              "open",
              "high",
              "low",
              "close",
              "vol",
              "amount",
            ],
            items: [
              ["600000.SH", "20261030", "10", "12", "9", "11", "100", "1000"],
            ],
          },
        }),
      );
    }),
    now,
  );
  await assert.rejects(
    rotated.read("tushare", { ...input, start: "2026-10-30" }, signal()),
    { reason: "POLICY_CHANGED" },
  );
  let current = now();
  const b = new DailyMarketAdapter(
    policy,
    fake(() => {
      current = new Date(current.getTime() + 5000);
      return new Response(JSON.stringify(eastPacket()));
    }),
    () => current,
  );
  const r = await b.read("eastmoney", input, signal());
  assert.equal(r.retrieved_at, current.toISOString());
  assert.equal(r.available_at, current.toISOString());
});

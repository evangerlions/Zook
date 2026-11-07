import { investmentId } from "../investment.service.ts";
import {
  researchFields,
  type ResearchEvidence,
  type ResearchMarketSource,
  type ResearchEntry,
} from "./research.types.ts";
import {
  keys,
  object,
  text,
  integer,
  fail,
} from "../../learning/native-learning.validation.ts";
export const researchId = (id: unknown) => {
  const s = text(id, 100, true);
  if (!/^inv-[a-zA-Z0-9_-]{8,96}$/.test(s))
    fail(422, "Invalid research identity.");
  return s;
};
function raw(value: unknown, max: number, required = false) {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (required && !value.trim()) ||
    value.includes("\u0000")
  )
    fail(422, "Research text is invalid or exceeds capacity.");
  return value;
}
export function researchInput(b: Record<string, unknown>) {
  keys(b, [
    "base_revision",
    "instrument_id",
    "account_id",
    "title",
    "horizon",
    "evidence",
    "market_sources",
    "material_sources",
    ...researchFields,
  ]);
  const base = integer(b.base_revision, 0, 99),
    instrument_id = investmentId(b.instrument_id),
    account_id = b.account_id === null ? null : investmentId(b.account_id),
    title = text(b.title, 200, true);
  if (!["short", "swing"].includes(b.horizon as string))
    fail(422, "Select a declared research horizon.");
  if (
    !Array.isArray(b.evidence) ||
    b.evidence.length > 30 ||
    !Array.isArray(b.market_sources) ||
    b.market_sources.length > 30
  )
    fail(422, "At most 30 evidence items and market sources are supported.");
  const evidence: ResearchEvidence[] = b.evidence.map(evidenceInput);
  const market_sources: ResearchMarketSource[] = b.market_sources.map((v) => {
    const s = object(v);
    keys(s, ["id", "version", "input_digest"]);
    if (
      s.version !== 1 ||
      typeof s.input_digest !== "string" ||
      !/^[a-f0-9]{64}$/.test(s.input_digest)
    )
      fail(422, "Select an exact market snapshot revision and digest.");
    return { id: investmentId(s.id), version: 1, input_digest: s.input_digest };
  });
  if (new Set(market_sources.map((s) => s.id)).size !== market_sources.length)
    fail(422, "Duplicate market sources.");
  const fields = Object.fromEntries(
    researchFields.map((k) => [k, raw(b[k], 12000)]),
  ) as Pick<ResearchEntry, (typeof researchFields)[number]>;
  if (Buffer.byteLength(JSON.stringify(b)) > 200000)
    fail(413, "Research command exceeds 200000 bytes.");
  return {
    base,
    fields: {
      instrument_id,
      account_id,
      title,
      horizon: b.horizon as ResearchEntry["horizon"],
      evidence,
      market_sources,
      ...fields,
    },
  };
}
export function evidenceInput(v: unknown): ResearchEvidence {
  const e = object(v);
  keys(e, [
    "title",
    "content",
    "locator",
    "source_url",
    "available_at",
    "contrary_evidence",
  ]);
  const available_at = text(e.available_at, 40, true);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      available_at,
    ) ||
    !Number.isFinite(Date.parse(available_at)) ||
    available_at.slice(0, 10) < "0001-01-01" ||
    new Date(available_at.slice(0, 10)).toISOString().slice(0, 10) !==
      available_at.slice(0, 10)
  )
    fail(422, "Evidence requires an explicit available time with timezone.");
  let source_url: string | null = null;
  if (e.source_url !== null) {
    source_url = text(e.source_url, 2000, true);
    try {
      const u = new URL(source_url);
      if (!["https:", "http:"].includes(u.protocol) || u.username || u.password)
        throw Error();
    } catch {
      fail(422, "Evidence URL must use http(s) without credentials.");
    }
  }
  return {
    title: text(e.title, 200, true),
    content: raw(e.content, 12000, true),
    locator: raw(e.locator, 1000),
    source_url,
    available_at,
    contrary_evidence: raw(e.contrary_evidence, 12000),
  };
}

import type { PoolClient } from "pg";
import type { CreditsTransaction } from "../../../modules/ai-novel/credits/ai-novel-credits-model.ts";
import {
  reportedWindow,
  invalidatedPreviousWindow,
} from "../../../modules/ai-novel/credits/credits-reporting.ts";

export async function persistCreditReporting(
  client: PoolClient,
  userId: string,
  state: CreditsTransaction,
) {
  const invalidated = invalidatedPreviousWindow(state);
  if (invalidated)
    await client.query(
      `UPDATE zook_ai_novel_credit_windows SET payload=payload || '{"stable":false}'::jsonb
    WHERE user_id=$1 AND period_key=$2`,
      [userId, invalidated],
    );
  const window = reportedWindow(state);
  if (window)
    await client.query(
      `
    INSERT INTO zook_ai_novel_credit_windows(user_id,period_key,refresh_at,payload) VALUES($1,$2,$3,$4::jsonb)
    ON CONFLICT(user_id,period_key) DO UPDATE SET payload = EXCLUDED.payload || jsonb_build_object(
      'stable', (zook_ai_novel_credit_windows.payload->>'stable')::boolean AND (EXCLUDED.payload->>'stable')::boolean,
      'covered', (zook_ai_novel_credit_windows.payload->>'covered')::boolean AND (EXCLUDED.payload->>'covered')::boolean,
      'firstExhaustAt', COALESCE(zook_ai_novel_credit_windows.payload->>'firstExhaustAt', EXCLUDED.payload->>'firstExhaustAt'))`,
      [userId, window.start, window.end, JSON.stringify(window)],
    );
  const event = state.reporting?.event;
  if (!event) return;
  // Duplicate debits must fail the whole transaction, not silently hide a debit.
  await client.query(
    `INSERT INTO zook_ai_novel_credit_events(user_id,event_id,occurred_at,payload)
    VALUES($1,$2,$3,$4::jsonb) ${event.kind === "debit" ? "" : "ON CONFLICT DO NOTHING"}`,
    [userId, event.id, event.at, JSON.stringify(event)],
  );
}

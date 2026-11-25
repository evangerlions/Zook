import { InvestmentService, investmentId } from "../investment.service.ts";
import type { LightTickOwner } from "../../lighttick.types.ts";
import { fail, keys } from "../../learning/native-learning.validation.ts";
import type { Decision, EvidenceReference, JournalState, DecisionReview } from "./journal.types.ts";
import { decisionHistoryInput, decisionInput, reviewInput, shanghaiDay } from "./journal.validation.ts";
import { currentDecisions, decisionSummary, journalFills, journalTimeline, reviewedDecision } from "./journal.timeline.ts";
import { journalHistory } from "./journal.history.ts";

export class InvestmentJournalService extends InvestmentService {
  private get store() { return this.repo.investments.journal; }
  private async state(owner: LightTickOwner): Promise<JournalState> {
    return await this.store.get(owner) ?? { revision: 0, watchlist: [], decisions: {}, reviews: {} };
  }

  private readOwner<T>(owner: LightTickOwner, work: () => Promise<T>) {
    return this.repo.transaction(owner, async () => {
      await this.authorize();
      return work();
    });
  }

  private async persist(owner: LightTickOwner, state: JournalState) {
    const base = state.revision++;
    if (Buffer.byteLength(JSON.stringify(state)) > 3 * 1024 * 1024)
      fail(413, "Investment journal exceeds owner storage capacity.");
    await this.store.save(owner, state, base);
  }

  async dashboard(owner: LightTickOwner) {
    return this.readOwner(owner, async () => {
      const state = await this.state(owner);
      const today = shanghaiDay(this.clock().toISOString());
      const decisions = currentDecisions(state).sort((a, b) => b.occurred_at.localeCompare(a.occurred_at) || a.id.localeCompare(b.id));
      const scheduled = decisions.filter(row => row.review_on && !reviewedDecision(row, state))
        .sort((a, b) => a.review_on!.localeCompare(b.review_on!) || a.id.localeCompare(b.id));
      const next = scheduled.find(row => row.review_on! > today);
      const instruments = await this.repo.investments.instruments(owner);
      const byId = new Map(instruments.map(row => [row.id, row]));
      const summary = (row: Decision) => ({ ...decisionSummary(row, state),
        instrument_name: byId.get(row.instrument_id)?.name ?? row.instrument_id });
      return {
        today,
        watchlist: state.watchlist.flatMap(id => {
          const instrument = byId.get(id);
          const last = decisions.find(row => row.instrument_id === id);
          const next = scheduled.find(row => row.instrument_id === id);
          return instrument ? [{ instrument, latest: last ? summary(last) : null, review_on: next?.review_on ?? null }] : [];
        }),
        reviews_due: scheduled.filter(row => row.review_on! <= today).map(summary),
        next_review: next ? summary(next) : null,
        recent_decisions: decisions.slice(0, 20).map(summary),
      };
    });
  }

  async follow(owner: LightTickOwner, id: string, body: Record<string, unknown>, key: string) {
    keys(body, ["following"]);
    const following = body.following;
    if (typeof following !== "boolean") fail(422, "Provide an explicit watchlist state.");
    return this.command(owner, key, "investment_journal_watchlist", id, "set", body, async () => {
      const instrument = await this.repo.investments.instrument(owner, id);
      if (!instrument || (following && instrument.archived)) fail(404, "Instrument is unavailable.");
      const state = await this.state(owner);
      const exists = state.watchlist.includes(id);
      if (exists !== following) {
        state.watchlist = following ? [id, ...state.watchlist] : state.watchlist.filter(item => item !== id);
        if (state.watchlist.length > 1000) fail(413, "Watchlist capacity exceeded.");
        await this.persist(owner, state);
      }
      return { instrument_id: id, following };
    });
  }

  private async evidence(owner: LightTickOwner, ref: EvidenceReference) {
    const { research, materials } = this.repo.investments;
    const version = ref.kind === "research"
      ? (await research.versions(owner, ref.id, ref.revision + 1, 1))[0]
      : await materials.version(owner, ref.id, ref.revision);
    if (version?.revision !== ref.revision) fail(404, "Evidence version is unavailable.");
    return version;
  }

  async readEvidence(owner: LightTickOwner, ref: EvidenceReference) {
    return this.readOwner(owner, async () => {
      const row = await this.evidence(owner, ref);
      return "content_digest" in row
        ? { kind: "material" as const, entry: row }
        : { kind: "research" as const, entry: row };
    });
  }

  async saveDecision(owner: LightTickOwner, id: string, body: Record<string, unknown>, key: string) {
    const { base, fields } = decisionInput(body);
    return this.command(owner, key, "investment_journal_decision", id, "save", body, async now => {
      const state = await this.state(owner);
      const history = state.decisions[id] ?? [];
      const prior = history.at(-1);
      if ((prior?.revision ?? 0) !== base) fail(409, "Decision changed; compare the latest version.");
      if (prior && prior.instrument_id !== fields.instrument_id) fail(409, "Decision instrument is immutable.");
      if (!prior && Object.keys(state.decisions).length >= 1000) fail(413, "Decision capacity exceeded.");
      const instrument = await this.repo.investments.instrument(owner, fields.instrument_id);
      if (!instrument || (!prior && instrument.archived)) fail(404, "Instrument is unavailable.");
      const occurred = fields.occurred_at ?? prior?.occurred_at ?? now;
      if (occurred > now) fail(422, "Decision time cannot be in the future.");
      if (fields.review_on && fields.review_on < shanghaiDay(occurred)) fail(422, "Review date cannot precede the decision.");

      if (fields.account_id) {
        const account = await this.repo.investments.account(owner, fields.account_id);
        if (!account || (account.archived && prior?.account_id !== fields.account_id))
          fail(404, "Account is unavailable.");
      }
      if (fields.event_ids.length && !fields.account_id) fail(422, "Select the account for the linked fills.");
      if (prior?.event_ids.length && fields.account_id !== prior.account_id)
        fail(409, "A linked decision belongs to its original account.");
      if (fields.account_id && fields.event_ids.length) {
        const fills = journalFills(await this.repo.investments.ledger.events(owner, fields.account_id));
        for (const event of fields.event_ids) {
          const existing = prior?.event_ids.includes(event);
          if (!fills.some(fill => fill.original.id === event && (existing || (fill.effective.input?.kind === "fill"
            && fill.effective.input.fill.instrument_id === fields.instrument_id))))
            fail(422, "A linked fill is unavailable for this decision instrument and account.");
        }
      }
      for (const ref of fields.evidence) {
        const version = await this.evidence(owner, ref);
        if ((version.instrument_id && version.instrument_id !== fields.instrument_id)
          || (version.account_id && version.account_id !== fields.account_id))
          fail(422, "Evidence belongs to a different instrument or account.");
      }
      const firstRecorded = prior?.recorded_at ?? now;
      const row: Decision = {
        ...fields, id, revision: base + 1, occurred_at: occurred, recorded_at: firstRecorded, updated_at: now,
        backfilled: occurred < firstRecorded,
      };
      state.decisions[id] = [...history, row];
      await this.persist(owner, state);
      return row;
    });
  }

  async decision(owner: LightTickOwner, id: string, revision?: number) {
    return this.readOwner(owner, async () => {
      const state = await this.state(owner);
      const history = state.decisions[id];
      const row = revision === undefined ? history?.at(-1) : history?.find(item => item.revision === revision);
      if (!row) fail(404, "Decision was not found.");
      const fills = row.account_id && row.event_ids.length
        ? journalFills(await this.repo.investments.ledger.events(owner, row.account_id))
          .filter(fill => row.event_ids.includes(fill.original.id))
        : [];
      return { decision: row, revisions: history.map(({ revision, updated_at }) => ({ revision, updated_at })),
        reviews: state.reviews[id] ?? [], fills };
    });
  }

  async decisions(owner: LightTickOwner, query: Record<string, string | undefined>) {
    const input = decisionHistoryInput(query);
    return this.readOwner(owner, async () => journalHistory(this.repo.investments, owner, await this.state(owner),
      input, shanghaiDay(this.clock().toISOString())));
  }

  async review(owner: LightTickOwner, id: string, reviewId: string, body: Record<string, unknown>, key: string) {
    const fields = reviewInput(body);
    return this.command(owner, key, "investment_journal_review", id + "/" + reviewId, "append", body, async now => {
      const state = await this.state(owner);
      const row = state.decisions[id]?.at(-1);
      if (!row) fail(404, "Decision was not found.");
      if (row.revision !== fields.decision_revision) fail(409, "Decision changed; compare before reviewing.");
      const history = state.reviews[id] ?? [];
      if (history.length >= 100) fail(413, "Review capacity exceeded.");
      if (history.some(item => item.id === reviewId)) fail(409, "A review with this ID already exists.");
      const review: DecisionReview = { ...fields, id: reviewId, decision_id: id, recorded_at: now };
      state.reviews[id] = [...history, review];
      await this.persist(owner, state);
      return review;
    });
  }

  async timeline(owner: LightTickOwner, rawId: string, kind: string, cursor: string, limit: number) {
    const id = investmentId(rawId);
    return this.readOwner(owner, () => this.state(owner).then(state =>
      journalTimeline(this.repo.investments, owner, state, id, kind, cursor, limit)));
  }

  async receipt(owner: LightTickOwner, key: string) {
    return this.readOwner(owner, async () => {
      if (key.length < 8 || key.length > 128) fail(422, "Invalid request identity.");
      const receipt = await this.repo.getOperation(owner, key);
      if (!receipt || !["investment_journal_watchlist", "investment_journal_decision", "investment_journal_review"].includes(receipt.entityType))
        fail(404, "Journal receipt was not found.");
      return { target: receipt.entityId, result: receipt.resultPayload };
    });
  }
}

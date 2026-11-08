import type { LightTickOwner } from "../../lighttick.types.ts";
import type { LightTickRepository } from "../../lighttick.repository.ts";
import { fail } from "../../learning/native-learning.validation.ts";
/** Owner snapshot is held by the shared exporter. No secrets or internal lease/fence is exported. */
export async function exportPortfolio(repo: LightTickRepository, o: LightTickOwner) {
    const store = repo.investments.portfolio, summaries = await store.summaries(o), accounts = await repo.investments.accounts(o), entries = [], runs = [], baselines = [];
    let count = 0, bytes = 0;
    const bound = (v: unknown) => { bytes += Buffer.byteLength(JSON.stringify(v)); if (++count > 5000 || bytes > 8 * 1024 * 1024)
        fail(413, "Portfolio export exceeds bounded capacity; no truncated export returned."); };
    const command = async (key: string, entity: string, id: string) => { const op = await repo.getOperation(o, key); if (!op || op.entityType !== entity || op.entityId !== id)
        throw Error("Portfolio original provenance missing."); return { key, action: op.action, body: op.requestPayload, result: op.resultPayload }; };
    if (summaries.length > 200 || accounts.length > 1000)
        fail(413, "Portfolio catalog exceeds export capacity.");
    for (const a of accounts) {
        const facts = await store.facts(o, a.id);
        if (facts.length > 500)
            fail(413, "Portfolio fact capacity exceeded.");
        for (const f of facts) {
            const versions = await store.history(o, f.id);
            if (versions.length !== f.revision)
                throw Error("Portfolio history incomplete.");
            const history = [];
            for (const v of versions) {
                const row = { ...v, command: await command(v.request_key, "investment_portfolio_fact", a.id + "/" + v.id) };
                bound(row);
                history.push(row);
            }
            entries.push({ id: f.id, account_id: a.id, history });
        }
        const saved = await store.saved(o, a.id);
        if (saved.length > 500)
            fail(413, "Portfolio saved report capacity exceeded.");
        for (const v of saved) {
            const row = { ...v, command: await command(v.request_key, "investment_portfolio_adopt", a.id + "/" + v.work_id) };
            bound(row);
            entries.push(row);
        }
        const versions = await repo.investments.baselines(o, a.id);
        for (const v of versions) {
            bound(v);
            baselines.push({ account_id: a.id, ...v });
        }
    }
    for (const summary of summaries) {
        const w = await store.work(o, summary.id);
        if (!w)
            throw Error("Portfolio work disappeared from owner snapshot.");
        const commands = [];
        for (const key of w.command_keys)
            commands.push(await command(key, "investment_portfolio_work", w.account_id + "/" + w.id));
        const { appId, userId, fence, lease_until, command_keys, ...data } = w, row = { ...data, commands };
        bound(row);
        runs.push(row);
    }
    return { entries, baselines, runs };
}

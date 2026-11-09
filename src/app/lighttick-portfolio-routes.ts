import { PortfolioService } from "../modules/lighttick/investments/portfolio/portfolio.service.ts";
import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import type { HttpRequest } from "../shared/types.ts";
import { object, integer, fail } from "../modules/lighttick/learning/native-learning.validation.ts";
export async function handlePortfolio(runtime: {
    portfolio?: PortfolioService;
}, o: LightTickOwner, r: HttpRequest, authorize: () => Promise<void>) {
    const match = /^\/api\/v1\/lighttick\/investments\/accounts\/(inv-[a-zA-Z0-9_-]+)\/(portfolio(?:\/.*)?|valuations(?:\/.*)?)$/.exec(r.path);
    if (!match)
        return;
    const base = runtime.portfolio;
    if (!base)
        fail(503, "Portfolio worker unavailable.");
    const s = new PortfolioService(base.repo, base.queue, authorize, base.clock), account = match[1], path = match[2], q = r.query ?? {}, limit = q.limit === undefined ? 20 : integer(Number(q.limit), 1, 100), key = r.headers["idempotency-key"] ?? r.headers["Idempotency-Key"] ?? "";
    if (r.method === "GET") {
        if (path === "portfolio/facts")
            return s.listPortfolio(o, account, "facts", q.cursor, limit);
        if (path === "portfolio/work")
            return s.listPortfolio(o, account, "work", q.cursor, limit);
        if (path === "portfolio/baselines")
            return s.listPortfolio(o, account, "baselines", q.cursor, limit);
        if (path === "valuations")
            return s.valuations(o, account, q.cursor, limit);
        const history = /^portfolio\/facts\/(inv-[a-zA-Z0-9_-]+)\/history$/.exec(path);
        if (history)
            return s.history(o, account, history[1], q.cursor, limit);
        const fact = /^portfolio\/facts\/(inv-[a-zA-Z0-9_-]+)$/.exec(path);
        if (fact)
            return s.readFact(o, account, fact[1]);
        const work = /^portfolio\/work\/(inv-[a-zA-Z0-9_-]+)$/.exec(path);
        if (work)
            return s.readWork(o, account, work[1]);
        const value = /^valuations\/(inv-[a-zA-Z0-9_-]+)$/.exec(path);
        if (value)
            return s.valuations(o, account, "", 20, value[1]);
    }
    if (r.method === "GET")
        fail(404, "Portfolio route not found.");
    const b = object(r.body);
    if (Buffer.byteLength(JSON.stringify(b)) > 64000)
        fail(413, "Portfolio command exceeds 64 KiB.");
    if (path === "portfolio/work" && r.method === "POST")
        return s.create(o, account, b, key);
    const fact = /^portfolio\/facts\/(inv-[a-zA-Z0-9_-]+)$/.exec(path);
    if (fact && r.method === "PUT")
        return s.writeFact(o, account, fact[1], b, key);
    const work = /^portfolio\/work\/(inv-[a-zA-Z0-9_-]+)\/(cancel|adopt)$/.exec(path);
    if (work && r.method === "POST")
        return work[2] === "cancel" ? s.cancel(o, account, work[1], b, key) : s.adopt(o, account, work[1], b, key);
    fail(404, "Portfolio route not found.");
}

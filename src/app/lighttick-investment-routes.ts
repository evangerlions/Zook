import {InvestmentLedgerService} from "../modules/lighttick/investments/ledger.service.ts";
import type { LightTickRepository } from "../modules/lighttick/lighttick.repository.ts";
import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import type { HttpRequest } from "../shared/types.ts";
import { InvestmentService } from "../modules/lighttick/investments/investment.service.ts";
import {
  object,
  integer,
  fail,
} from "../modules/lighttick/learning/native-learning.validation.ts";
export async function handleInvestmentRequest(
  repo: LightTickRepository,
  owner: LightTickOwner,
  r: HttpRequest,
  authorize: () => Promise<void>,
  ledger?: InvestmentLedgerService,
) {
  const prefix = "/api/v1/lighttick/investments/";
  if (!r.path.startsWith(prefix)) return;
  const path = r.path.slice(prefix.length),
    service = new InvestmentService(repo, authorize),
    key = r.headers["idempotency-key"] ?? r.headers["Idempotency-Key"] ?? "";
  if (r.method === "GET" && ["accounts", "instruments"].includes(path))
    return service.list(
      owner,
      path as "accounts" | "instruments",
      r.query?.cursor ?? "",
      r.query?.limit === undefined
        ? 50
        : integer(Number(r.query.limit), 1, 100),
    );
  const ledgerMatch=/^accounts\/(inv-[a-zA-Z0-9_-]+)\/(ledger|events)$/.exec(path),workMatch=/^work\/(inv-[a-zA-Z0-9_-]+)(?:\/(cancel))?$/.exec(path);
  if(ledgerMatch||workMatch){
    if(!ledger)fail(503,'Investment worker is unavailable.');
    const work=new InvestmentLedgerService(repo,ledger.queue,authorize,ledger.clock);
    if(ledgerMatch&&r.method==='GET'&&ledgerMatch[2]==='ledger')return work.ledger(owner,ledgerMatch[1],r.query?.cursor??'',r.query?.limit===undefined?50:integer(Number(r.query.limit),1,100),r.query?.ledger_schema??'1');
    if(workMatch&&r.method==='GET'&&!workMatch[2])return work.work(owner,workMatch[1]);
    const b=object(r.body);if(Buffer.byteLength(JSON.stringify(b))>16000)fail(413,'Ledger command exceeds capacity.');
    if(ledgerMatch&&r.method==='POST'&&ledgerMatch[2]==='events')return work.append(owner,ledgerMatch[1],b,key);
    if(workMatch&&r.method==='POST'&&workMatch[2]==='cancel')return work.cancel(owner,workMatch[1],b,key);
    fail(404,'Ledger route was not found.');
  }
  const match =
    /^(accounts|instruments)\/(inv-[a-zA-Z0-9_-]+)(?:\/(status))?$/.exec(path);
  if (match && r.method === "GET" && !match[3])
    return service.read(
      owner,
      match[1] as "accounts" | "instruments",
      match[2],
    );
  const body = r.method === "GET" ? {} : object(r.body);
  if (Buffer.byteLength(JSON.stringify(body)) > 256000)
    fail(413, "Investment request exceeds capacity.");
  if (path === "instruments" && r.method === "POST")
    return service.createInstrument(owner, body, key);
  if (match && r.method === "PUT" && !match[3])
    return match[1] === "accounts"
      ? service.createAccount(owner, match[2], body, key)
      : service.updateInstrument(owner, match[2], body, key);
  if (match?.[1] === "accounts" && match[3] === "status" && r.method === "POST")
    return service.archiveAccount(owner, match[2], body, key);
  fail(404, "Investment route was not found.");
}

# AINovel Alipay recovery

The API process runs a startup pass and then checks once per minute. One pass
processes at most 20 orders per allowed payment environment sequentially; a tick is skipped while the previous
pass is running. Each official Alipay query has a 20-second timeout; multiple
orders may therefore take longer than 20 seconds. SIGINT and SIGTERM stop new
passes immediately and drain the current pass before the database is closed.

Candidates come from the order table, restricted to the configured environment,
app and seller. Pending payments and paid-but-unapplied orders are eligible. An
internal `lastRecoveryAt` field rotates least recently checked orders first.
No additional table, queue or worker is required.

The job calls `syncAlipayMembership`, the same provider workflow used by the
public `POST /api/v1/ai_novel/billing/sync` entry. Verified queries, notifications
and local paid recovery converge on one short transactional settlement. Network
queries run outside that transaction. Known paid/closed/failed payments do not
query Alipay again; paid/unapplied payments settle locally. Query failures leave
that order pending and allow later orders to continue. Separate user requests
run independently rather than sharing an older in-flight result.

Normal sync discovers server-side orders without requiring a client marker.
Trusted local refunded/revoked financial facts remove their corresponding grants
without another notification or provider query; these orders are blocked rather
than pending. Financial refund evidence survives repeated paid notifications.
This does not add refund discovery or execution: settled orders are not polled
for later refunds. Checkout expiry alone is not payment failure. Existing channel
conflicts and deleted-account restrictions remain enforced.

Search structured logs for `membership sync started`, `membership sync completed`,
`membership order query pending`, `membership order evidence rejected` and
`alipay recovery user pending`. Logs include identifiers, counts and outcomes,
never signed payment payloads or keys.

`GET /api/v1/ai_novel/billing/alipay/orders/{orderId}` only reads persisted order
and current membership. It does not contact Alipay or apply membership. Clients
use POST membership sync for explicit verification and local reconciliation.

## 双环境凭证路由

部署身份决定可处理的支付环境：online 仅正式，local/dev 支持正式及沙箱。每种环境使用自己的商户/密钥/网关，共用补单与结算实现。每轮分别扫描各环境最多 20 笔，环境内部逐笔查询；缺少价格不会阻断已冻结订单补单。回调按持久化订单选择验签器，并校验商户与金额，不信任请求头选择环境。

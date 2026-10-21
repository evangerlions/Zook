# AINovel Alipay recovery

The API process runs a startup pass and then checks once per minute. One pass
processes at most 20 orders sequentially; a tick is skipped while the previous
pass is running. The existing official Alipay SDK timeout is 8 seconds. SIGINT
and SIGTERM stop new passes immediately and drain the current pass before the
database is closed.

Candidates come from the existing order table, restricted to the configured
environment, app and seller. Pending payments and paid-but-unapplied orders are
eligible. An internal `lastRecoveryAt` field in the existing JSON record rotates
the least recently checked orders first. No new table, queue or worker is needed.

The job calls the existing order query. Verified provider evidence and retrying
a persisted paid order converge on the same transactional membership grant used
by notifications. Paid/applied orders are never granted twice. Conflicts stay
pending until allowed by existing channel policy; deleted accounts are never
re-granted. Checkout expiry alone is not payment failure. Settled orders are not
polled for refunds by this task.

Search structured logs for `ainovel alipay recovery result` and
`ainovel alipay recovery failed; retained for retry`. Results include order ID,
payment status, membership application and conflict, never payment payloads or
keys. A paid order with `membershipApplied=false` needs follow-up if the conflict
does not clear; this task does not bypass policy or initiate refunds.

No external endpoint or request/response shape is added. Existing authenticated
order queries now also retry membership application for an owned, verified paid
order that has not yet been applied, with the same merchant and account checks.

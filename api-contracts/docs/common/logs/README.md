# Client Log Remote Pull

## Goal

Describe the external client-log remote-pull flow in contract form.

## Flow

1. Client fetches policy via `GET /api/v1/logs/policy`
2. Client claims upload work via `GET /api/v1/logs/pull-task` with `X-Did`
3. Client uploads encrypted log payload via `POST /api/v1/logs/upload`
4. If there is no data, client acks `no_data`
5. If local retries are exhausted, client may mark the task failed

## Constraints

- Log payload is AES-GCM + gzip + NDJSON
- Claim token is required for upload
- Ack / fail are task-scoped
- This document only covers external client-facing endpoints

## Related OpenAPI

- `api-contracts/openapi/common/logs.yaml`

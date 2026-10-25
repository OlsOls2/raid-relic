# Raid Relic

A raid-only traveling community relic. This first increment is a dependency-free local prototype, authored by Codex in the single conversation recorded in [CODEX_SESSION.md](CODEX_SESSION.md). Resume that thread for all future code and documentation work.

## Setup and tests

Use Node.js 22 or newer (the initial checks ran on Node 24). No npm dependencies, credentials, cloud SDK, or OAuth setup are required for tests.

```sh
npm test
```

The tests use synthetic signing secrets, an injected clock and memory state, and simulated HTTP streams. They do not bind a listening socket or contact Twitch. The application server was not started during this increment.

For a later, explicitly authorized local preview, copy `.env.example` to `.env`, replace the secret placeholder locally, and use `node --env-file=.env src/server.js`. The default port is **5191**; `PORT` can override it. `npm start` reads already exported environment variables and does not load `.env` automatically. Never commit local env files. The supplied client ID `6ggythtvgo572dxu8jo4xoaqtn37ix` is public configuration, not a credential, and is unused by this increment. Do not provide OAuth or cloud credentials yet.

Routes: `GET /health` returns JSON health; `POST /eventsub` accepts webhook messages; `/` is the static Atlas; `/overlay` is the static overlay. The original compass/crystal SVG is in `public/relic.svg`. Both views explicitly display prototype status and have no live data or countdown.

## Webhook boundary

The signature is HMAC-SHA256 over message ID + original timestamp + exact raw request body bytes. The implementation validates the signature encoding and compares fixed-length digests with `timingSafeEqual` before JSON parsing. It rejects bodies over 64 KiB, malformed JSON/UTF-8, invalid raid fields, and unsupported notification subscriptions. Raid notifications require `channel.raid` version `1`.

Authenticated timestamps may be at most ten minutes old; future timestamps are rejected, so the receiving clock must be accurate. Timestamp checks happen before deduplication. Repeated authenticated message IDs are acknowledged with 204 without restarting a ritual. Entries remain through their signature acceptance window; memory capacity returns 503 rather than discarding unexpired IDs. Signed verification challenges return HTTP 200 with their exact raw text, including on retries, and Content-Length equal to the UTF-8 byte length. HTTP 204 acknowledgements send no body, Content-Length, or Transfer-Encoding. Signed revocations are acknowledged but do not yet update subscription lifecycle state. Missing webhook configuration fails closed with 503; health remains available.

A valid raid notification records a **local 90-second ritual starting at receipt processing time**, never a Twitch-synchronized window. There is no claim endpoint in this increment. A future claim must prove participation from **both incoming raiders and host chat**; a raid event alone does not prove individual viewer membership. OAuth, identity rules, chat collection, and abuse controls need design and verification before claims exist.

`createApp({ secret, state, now })` supports injection without opening a server. `dispatch` accepts raw buffers and lowercase HTTP headers; `handler` adapts Node HTTP streams and enforces the limit during collection. The memory adapter's `accept({ id, expiresAt, now, raid })` returns `accepted`, `duplicate`, or `full`. Insertion and ritual mutation are synchronous within one process; concurrent duplicate tests share the same state. `getRitual` returns a snapshot, not a durable or live state API. Expired entries are lazily pruned on acceptance. No secret or request-body logging is implemented.

## Architecture and deployment boundary

The target is **Cloud Run with minimum instances zero and Firestore**, not Cloudflare. A later Firestore adapter must transactionally deduplicate the event and create/update its ritual together, with expiry cleanup and bounded retention. An instance restart currently loses all memory; separate instances do not share it. This adapter is only for local tests/prototyping and must be replaced before deployment.

Store deadlines as timestamps. Do not rely on a background timer while Cloud Run is scaled to zero; evaluate deadlines when processing requests. Later overlays need an authenticated state transport and consistent persistent reads. Cloud Run cold starts and delivery latency do not make the local ritual synchronized with Twitch.

The owner reports project `raid-relic-hackathon` exists with billing intentionally disabled. Deployment is blocked pending the owner. No GCP resources or billing were inspected or changed. No deployment configuration is included, and scale-to-zero does not promise zero cost. Do not link billing or deploy in this increment.

## Verified locally versus pending

Automated tests cover health, raw-byte signature preservation, valid/tampered/forged signatures, malformed signature lengths, stale/future/invalid timestamps, duplicate and concurrent deliveries, exact retryable challenge responses, ASCII/multibyte challenge byte lengths at the HTTP boundary, empty 204 semantics, malformed/oversized bodies, invalid UTF-8 and schemas, streaming body limits, adapter capacity/expiry/isolation, revocation acknowledgement, and static asset loading. Verification after the challenge-header correction: `npm test` passed; `node test/app.test.js` explicitly reported **20 tests passing, zero failures** on Node 24.22.1. The test runner in this environment summarizes `npm test` as one passing test file; the direct invocation exposes the individual node:test results. These use simulated HTTP streams, with no listening socket, browser/OBS, or live Twitch validation.

Pending: Firestore transactions, durable journey/ownership history, claim rules, OAuth, chat bot, token handling, subscription registration/revocation lifecycle, live webhook delivery, browser/OBS validation, accessibility review, and deployment. No live Twitch or Devpost interaction has occurred. No claims or successful handoffs are represented by the skeleton.

Before any live integration, verify against current official Twitch documentation: EventSub `channel.raid` version and conditions (incoming host filter versus outgoing broadcaster), subscription authorization and transport requirements, signature/timestamp/retry behavior, and callback challenge expectations. No current scope requirements were verified online in this increment. Raid EventSub permission requirements must be checked independently of chat. For the future EventSub chat bot path, investigate `user:read:chat`, `user:write:chat`, `user:bot`, and `channel:bot`, their token types, broadcaster grants/moderator alternatives, and whether writing chat is necessary. These are candidates to verify, not an approved scope set. Request only the minimum scopes for the chosen design after verification.

## How we used Codex

Codex is the sole code author in the original thread and created the HTTP boundary, injectable memory adapter, synthetic test cases, original SVG and static pages, and documentation. No other thread or subagent was created. Local automated verification is kept separate from pending integration claims. The first attempt was blocked by the workspace sandbox before any files were written; work resumed in the same thread after the operator fixed it. Curated `.codex-evidence/run-NNN.jsonl` and `.codex-evidence/SESSION_ID` are permitted; other evidence files, raw rollout backups, auth files and secrets remain ignored and must not be committed. Curated records must never contain credentials. See [AGENTS.md](AGENTS.md) for ongoing constraints.

MIT licensed; see [LICENSE](LICENSE).

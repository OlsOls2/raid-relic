# Private raid dispatch evidence — local emergency patch

Parent reports canonical `raid-relic-sendfix1025` logged `dispatch-rejected` at 2026-10-25T10:44:05.262675Z. The old worker mapped a received 4xx response to rejected and discarded its exact status/message. Only the 400–499 range is known; the historical exact response is **unrecoverable**. Do not replay the POST to discover it, infer a 403 or blame a particular Twitch setting. Owner has not retried. This patch has only mocked local proof until parent review/QA/deployment.

Request audit: source HOME 1591805230 to target OTHER 1591806023 uses Helix POST `/helix/raids?from_broadcaster_id=1591805230&to_broadcaster_id=1591806023`, validated source Keeper user grant with existing `channel:manage:raids`, not target/bot token. No guessed Content-Type/scope changes. Codex made no provider/cloud/credential/control/stream calls.

Future dispatches log one structured `raid_relic_raid_dispatch` record independently after the POST, even if final persistence fails. A diagnostic of at most 1 KiB merges only into the same owned dispatching intent via finish CAS; it cannot overwrite confirmed/rejected/replaced state. The 4 KiB registry guard remains. Logger failures are harmless; finalize failure leaves reconcile-only dispatch state. Nothing automatically retries 401, timeout, malformed JSON, 5xx or ambiguous completion.

Own private control status/action outcome can show HTTP status (null when unavailable), safe Twitch message/error, redaction/truncation flags, source/target IDs, intent hash, **expected** source principal and source-user grant kind, timestamps, numeric rate-reset/retry-after when supplied. Expected principal records the validated grant selection, not a new upstream assertion. Messages are byte-bounded and scrub actual used token occurrences, credential assignments, Bearer/OAuth values, high-entropy strings, keys and URLs. No upstream object, exception, stack, full headers, raw URL or credentials is dumped. Public Atlas/overlay/journey never receives this diagnostic. Old rejected intents without evidence remain unchanged; no invented backfill.

| Actual observed outcome | Owner interpretation / next step |
| --- | --- |
|200 | Accepted API call, not travel. Wait for genuine raid EventSub/native completion; never send again to force arrival. |
|401 | Review source user ID, existing manage-raids scope, token validity and client match; reconnect source if needed. No automatic POST retry. |
|403 | Generic provider-forbidden: owner reviews exact safe message. This status is not documented in the specific Start a Raid reference and alone proves no incoming policy, account-age or scope cause. |
|429 | Documented limit: 10 requests per 10 minutes. Wait for observed reset/retry-after; inspect native state before any new action. |
|400 | If the safe message identifies a block, refusal/restriction or too many viewers, owner reviews incoming settings, block and viewer/account criteria; never auto-relax. Otherwise review invalid/equal IDs and actual native/live state. |
|404 | Target not found: owner reviews target identity. |
|409 | Already in process of raiding another channel: **STOP; no new Send Off or Process while native raid is pending.** |
|Other 4xx | Review exact safe message and native state; no inferred cause or automatic retry. |
|5xx, network, malformed response | Unknown outcome: stop for read-only operator reconciliation. Never blindly retry or clear dispatch markers. |

## Safe owner/operator procedure after parent deployment

1. Read only your matching control's intent status and diagnostic. Share only scrubbed diagnostic fields with the operator, never cookies, tokens, auth codes or grant bodies. No live checks were performed by Codex.
2. If old intent is definitely **rejected**, independently verify there is **no native pending raid banner**. If uncertain, stop. This patch neither clears old intents nor authorises cancellation/reset.
3. Only after owner review resolves the observed cause, both actual streams are live, sequential Bootstrap/reconcile has finished and readiness/lifecycle/context are eligible, the owner may choose a **new explicit Send Off**, not Process. No automatic retry or live attempt is part of this task.
4. Accepted, unknown, dispatching, leased/processing or otherwise ambiguous intent: stop for read-only operator review. Never delete/change DB rows, reset holder/stream IDs, clear dispatch evidence, retarget or Process to retry. Preserve OAuth grants and existing configuration.

Parent verified the official [Start a Raid reference](https://dev.twitch.tv/docs/api/reference/#start-a-raid). POST needs Authorization, Client-Id and query parameters, with no required body/Content-Type. Native Raid Now or the native 90-second countdown precedes actual raid; channel.raid confirms it. These are Twitch native timings, distinct from the app-local claim window. This patch fixes diagnostic loss, not a proven raid restriction or request/token bug; the lost historical cause remains unknown. Successful200 outcomes log INFO; rejected/unknown outcomes log WARNING.

# Local emergency restart / Send Off patch —2026-10-25

Authorized only in the fd05/d529-based emergency worktree. Parent reviews/commits/deploys; Codex made no live provider/cloud calls. No polish/Coulds promotion, dependencies, OAuth grant schema/namespace changes or subscription deletion.

The source audit proves a precision failure path: `started_at` can have whole-second precision while the prior offline delivery watermark has milliseconds. Strict `startedAt > closedThrough` can reject a distinct rapid restart. A fresh CAS-bound Helix observation previously used the same guard and returned `accepted` even without changing online state. New signed distinct streams can match that same second; a fresh CAS-bound live observation can recover a different stream started after the last retired stream, even if a delayed offline receipt crossed its start. Known closed IDs, stale observations and concurrent lifecycle changes still fail closed. No budget, consent, holder or tombstone reset is performed. Observation results distinguish applied, no-change, closed and superseded; applied changes fan out.

The Send Off control previously ignored the reservation result and unconditionally invoked a worker. Failed reservations therefore returned `idle-or-reconcile-only` and could select an older queued intent. Reservation now returns an explicit closed-enum reason, and failed reservations never invoke the worker. Successful requests bind worker claim to their exact intent ID. Private status shows observed source/target online flags and reservation eligibility; subscription readiness alone is not live eligibility. Safe JSON warnings contain only fixed event/severity, configured Keeper ID and a closed reason. No raw errors, headers, tokens, URLs or upstream bodies are logged.

Parent-provided current10:14 state has both channels offline, holderHOME, both opted in/unpaused/unbanned, no send intent/watermark/pending hop. HTTP-only historical204/200 logs do **not** establish the exact09:32 failed predicate or historical payload. UTC labels require no hour conversion.

## Owner after parent review/deployment

1. Start **both actual streams**. Open each matching Keeper control/profile; reconnect only if its control session expired.
2. Bootstrap/reconcile each sequentially, then refresh source. Expect both readiness flags true **and** both observed-online flags true; source must hold the relic and both policies/context must remain eligible. A closed/superseded/no-change observation is not a promise of live eligibility.
3. With no queued intent, use the named **Send Off** action, not Process. If blocked, report only the safe reason and stop to resolve it. Pending/accepted/unknown/ambiguous outcomes must never be cleared or blindly retried. No global reset or fabricated online state is available.

No actual live restart, Bootstrap, chat, Send Off or raid was performed to validate this patch by Codex. Parent will run host validation; existing grants/secret references/origins/resources must be preserved.

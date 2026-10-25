# Original Must audit — local merged branch,2026-10-25

Owner deadlines: Must due 28 October; feature complete 30 October. This audits implementation against the original ten items, not a claim that all Musts or live validation are complete. Cloudflare Durable Objects were explicitly superseded by owner-approved Cloud Run+Firestore; the chosen backend is not a missing feature.

Parent reports current production `raid-relic-claimfix1025`, source `bbd673832450f26063e9c6a7ae865daaaa005e43`,100% traffic; proof commit `f4e437e`,264/264 independent tests and three mocked browser workflows/16 checks,15 asset parity and unchanged three OAuth grant metadata. Local polish374 and emergency264 are different checkpoints, not this merge's proof. Current merge contains additional undeployed Shoulds/Coulds/polish/self-history features. No deployment, live page/query or provider call was performed for this audit.

| Original Must | Status / implementation evidence | Remaining owner blockers and priority |
| --- | --- | --- |
|1. Signed raid/chat EventSub | Done (local): raw-body timing-safe HMAC, replay window, dedupe, strict challenge/schema/conditions; `src/app.js`, subscriptions/webhook tests. | Genuine delivery/path coverage is owner-operated; no blanket end-to-end proof. P1 validation. |
|2. Streamer OAuth and bot read/send | Done (local): two explicitly configured Keeper identities, separate bot grant, exact redirect/browser state, encrypted tokens, scoped controls; OAuth/bot/pilot tests. | Actual new vote ACK delivery not yet tested live. No arbitrary-channel onboarding claim. P1 owner validation. |
|3. Durable relic/marks/lineage and live WebSocket | Done (local), accepted Cloud Run/Firestore architecture: one registry, transactional dedupe/claim/transfer/lineage, bounded documents; memory+fake Firestore tests and shared ordered hub. | Comprehensive real database/emulator/concurrency/integration QA remains partial; cross-instance fanout unsupported (max1). P1/P2. |
|4. OBS idle relic/rings/charge | Done (local), original faceted slow-turn relic, rings from completed history, charge from approved current marks; reduced motion/corner modes. | Local Simulator browser proof is not physical OBS validation. Full1280×800 two-channel gate authored for parent run. P1 owner OBS check. |
|5. Marks | Done (local), one normalized word/emoji, conservative safety filters, deterministic canonical rune,30-second per-viewer cooldown and five marks **per user per stream**, trusted stream/holder context and atomic budgets. Marks tests. | Actual chat/approval workflow and retained-data limits need owner demonstration; private pending-ID moderation UI remains limited. P1 usability. |
|6. Send Off / ritual / manual snatch | Partial: source-grant Start Raid, at-most-once dispatch and safe diagnostics implemented; eligible manual verified raid opens pending/snatch. App-local90 seconds begin at verified receipt. | **Not native-countdown synchronized.** Native Raid Now/countdown is external. Expired-confirmed recovery is narrow owner CAS, not a raid cancel/reset. Owner validation required; do not fake timing authority. P1. |
|7. Target arrival | Done (local), receipt-seeking3s streak+2s impact+15s unfurl, approved incoming source-rune preview; reconnect seeks phase, no API-acceptance travel. | Physical OBS/full end-to-end footage remains pending; local mocked screenshots do not prove it. P1. |
|8. Two-chat claim | Done (local), distinct original nonbot actors on both sides, immutable IDs/no cross-side reuse, atomic transfer/ring/stop. Future signed viewers0–2 use T1;3+ capped ceil-sqrt; legacy stored T2 unchanged. ACK outbox has exact-chat ten-minute receipts and30s delivery grace for committed votes only. | Chat location is not actual raid-membership proof. Old actual T2 window had1/1 insufficient; owner expiry/retest pending. No retrovotes/retroACK. P1 owner test. |
|9. Atlas | Done (local), read-only constellation/stops/rings and approved plaintext/runes, bounded manual pagination/fresh privacy reads; Atlas tests/browser gates. Local branch also has text search, self-capability lookup, recap. | Current production does not contain all polish/Coulds. Owner screenshots/live journey need actual completed claim; no fake seed. P1 validation. |
|10. Moderation/privacy/eligible Keepers | Partial: signed role-gated veto/pause/block/optout, only opted-in eligible holders/targets; non-Keeper raids stay home. Pending text private, approved Atlas only, forget erases retained content/associations without rate/quota refund. Local scoped capability and nonce cleanup preserve minimal idempotence receipts. | **Channel bans incomplete:** local signed channel.ban ingestion requires recent existing `channel:moderate` grant proof; default scopes/five subscriptions unchanged. No automatic sixth registration, ban backfill, unban or timeout-expiry reconciliation; live grant support unclaimed. Offline preparation foundation is Done (local); activation/consent/provenance/race work is Missing. P0 remains Partial overall. |

## Authorized071 foundation and remaining activation work

Owner authorised a narrow offline reconciliation foundation in071: `src/ban-safety.js` and fixture tests prepare bounded private snapshots and optionally reconcile exact ban/unban payloads through required injected adapters. This foundation is now implemented locally, **not wired or activated**. [Contract, parent-provided official references and limits](BAN_SAFETY_FOUNDATION.md). Default scopes and five subscriptions are unchanged. Must10 remains Partial: Olly must approve minimum additional permissions (`channel:moderate` plus recommended read-only `moderation:read`), consent/readiness UI and Go/No-Go before a later activation increment. Provenance-separated manual/platform blocks, revocation, snapshot/event CAS races, unban/timeout and privacy integration are still missing. No live-grant or global-ban-readiness claim.

Physical OBS/real ACK/full dual-chat validation remains owner-operated. Must6's app-local timing differs from native-countdown synchronization and needs explicit product acceptance; no fake synchronized claim. Grok deadlines remain Must due28 October / feature complete30 October. Production claimfix1025/bbd remains frozen; no new deployment is authorised by this local module.

## Read-only recording routes and local QA

Source `src/app.js` routes configured numeric `/overlay/:id` to `overlay-live.html`. `/overlay` is a legacy static prototype, not a channel-live recording source. After owner permission, canonical recording URLs are:

- https://raid-relic-760724762396.us-central1.run.app/overlay/1591805230
- https://raid-relic-760724762396.us-central1.run.app/overlay/1591806023
- https://raid-relic-760724762396.us-central1.run.app/atlas/

Use full overlays (no `corner=1`) at1280×800 for this gate. URLs were confirmed from source, **not opened** during Grok retest. `scripts/browser-smoke-full-overlay.js` uses only fixed local HTTPS5191, memory/fake OAuth/Twitch, source/host configured routes and actual DOM/WebSocket projection. It verifies transparent body, visible original SVG relic inside viewport, genuine mocked raid receipt then fixture-clock20s seek, actual dual-chat transfer and Atlas ring. No production changes/seed, no screenshot or physical OBS proof is claimed.

Commands for parent independent QA (run browser gates sequentially on registered5191):

```sh
node --test --test-isolation=none
npm run release:files
node scripts/browser-smoke-claims.js
node scripts/browser-smoke-full-overlay.js
```

Historical merge audit unit result:403 total,398 passed, five sandbox EPERM loopback skips, zero failures. Parent subsequently reported403/403 zero skips and11 browser flows/47 checks for that merge;071 module verification is separate; no future count or result is assumed. Syntax/diff/inventory are checked separately. No Codex staging/commit/push/deploy is authorised.

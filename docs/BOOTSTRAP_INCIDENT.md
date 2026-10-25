# Canonical bootstrap incident —2026-10-25 closeout

All deployment/live inspection facts below are **parent reported and verified**, not inspected by Codex. The authorized minimal hotfix is deployed; all source/cloud work is frozen again. This docs turn authorizes no commit, deployment, live call or credential read by Codex.

| Item | Current canonical value |
| --- | --- |
| Source | `d52937d8f107b2a540bd69e4846e91a328590ffe` — minimal **fd05-based** hotfix |
| Git release tag | `bootstrap-hotfix-20261025` |
| Revision / traffic | `raid-relic-bootstrap1025` /100% |
| Origin | https://raid-relic-760724762396.us-central1.run.app |
| Build | `15869b41-a42c-4273-b5a7-6f494f40cb76` |
| Immutable image | `sha256:3c22790e783f20d4bfe73a44e46c00092b7b809d109f7d84273fdfd530aa851d` |

Main code commit `0334042` contains the same fix **plus preexisting Coulds**. Main was **not deployed wholesale** to canonical. Shoulds00004 and Coulds00005 remain preserved0% tags; the hotfix does not promote their features. Later docs/evidence commits do not change canonical deployed d529 or authorize another deploy.

## Cause and bounded correction

Twitch returned both `channel.raid` condition keys, with the unused direction as an empty string. The old exact-key-count comparison missed an already enabled subscription, attempted a duplicate create, received409 and surfaced bootstrap502. The same overly strict condition check also affected signed raid notification acceptance.

The shared matcher now permits only the documented unused opposite raid key **absent or empty string**. Nonempty opposite values, unknown keys and other mismatches remain rejected. Initial lookup,409 relist, final readiness and signed raid notifications use it. Callback/type/version/grant/ownership gates remain strict; no subscription deletes, scope expansion or store-schema change. Challenges already returned200; regressions confirm raw UTF-8 response, byte Content-Length and signature checks.

A failed explicit bootstrap emits one bounded structured warning (`raid_relic_bootstrap_failed`, severityWARNING), configured Keeper ID and closed-enum diagnostics only. No error message/stack, raw upstream payload, request URL/header or token is logged. Logger failure cannot change the outcome; persisted private diagnostics remain available.

## Parent verification — what is and is not proven

- Production patch host **229/229**, main **325/325**, zero skips; mocked pilot browser8checks PASS; audit0 and syntax/diff/release gates pass.
- Canonical health at08:33 matched d529, owner-test-ready/liveValidated:false;15 assets/pages byte-matched. Protected controls GET401/POST403, both overlay APIs mode:live/status:waiting, Atlas200, unsigned webhook403, judges404.
- Parent's live Helix list confirmed all ten enabled **canonical** callbacks. Replaying the fixed manager for both Keepers returned ready:true with **no subscription creates**. This is not a completed live Bootstrap/Send Off test.
- All three OAuth grant-document updateTimes were unchanged before/after, using nonexistent-field-mask metadata-only reads; no credential values were disclosed. Secret references/SA/resources/canonical origins preserved, min0/max1 and both paid flagsfalse. Tagged releases preserved.
- No live Bootstrap, Send Off, raid or chat was triggered by parent/Codex for this verification. No claim of live end-to-end, physical OBS or AI validation; budgets/scale-to-zero do not guarantee free usage.

## Owner's next canonical clicks — sequential, no action by Codex

1. Restart the two actual streams as needed so **raidrelichq1591805230** and **OlsOls2/olsols2 1591806023** are really live. Do not edit online state/IDs or seed the database. Close old tagged control/OBS sessions; use only canonical for this retry. **Expected:** real streams live; existing canonical callbacks remain intact. No routing migration or subscription deletion is needed for the confirmed ten callbacks.
2. Open https://raid-relic-760724762396.us-central1.run.app/control/1591805230 in the home Keeper's matching browser profile. If401, reconnect **only that matching Keeper** at https://raid-relic-760724762396.us-central1.run.app/oauth/keeper/1591805230/start using raidrelichq. One-hour app control expiry does not mean stored OAuth grants vanished. Do not reconnect bot/other accounts unnecessarily. **Expected:** correct private home control; no token/code disclosure or raid.
3. Click **Bootstrap / reconcile this channel** once and wait until it finishes. **Expected:** successful reconciliation, all five own conditions enabled and authoritative actual stream observation. If failed, stop and report only the safe diagnostic stage/type/direction/status—not raw logs, headers or credentials.
4. Open https://raid-relic-760724762396.us-central1.run.app/control/1591806023 in Other's matching profile. If401, reconnect only OlsOls2 at https://raid-relic-760724762396.us-central1.run.app/oauth/keeper/1591806023/start . Then **Bootstrap / reconcile this channel**, waiting for completion; never overlap jobs. **Expected:** five enabled conditions for Other, no409 duplicate create and no raid.
5. Return to home and click **Refresh status** after Other finishes. **Expected:** **both readiness flags true**, all five enabled conditions per channel, real current stream states. Holder is actual persisted state, not assumed home/unplaced. If not ready or any diagnostic remains, **stop and report it**, do not press Send Off as a workaround.

This retry checklist stops at readiness. No Send Off by us. Unknown/accepted dispatch safety markers must never be cleared/retried; no global reset, collection/auth/grant deletion, direct approval/holder edits or fabricated state. Existing private mark/claim rules continue unchanged. Any future real owner raid is a separate deliberate owner action, not proven by this closeout.

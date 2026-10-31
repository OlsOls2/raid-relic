# Judge admission · local candidate, 31 October 2026

This default-OFF mode is not deployed by the source author. It is separate from the existing short-lived owner preview. Judges receive the code in the private judging submission instructions, so they need no owner contact. Never place it in a repository, URL, public document, screenshot or log. Enter it in the HTTPS root form; the existing Secure/HttpOnly/SameSite cookie lasts at most 12 hours per login. The same code can be re-entered until 16 November 2026 00:00 UTC exclusive. Expiry also closes admitted WebSockets.

## Parent-only configuration

Use a separate zero-traffic candidate; do not modify production traffic, IAM or existing preview credentials. Required environment:

- `JUDGE_ADMISSION_ENABLED=true` (unset/false preserves existing behavior).
- `P5_PREVIEW_READ_ONLY=true` (false/unset is a startup error in judge mode).
- `P5_PREVIEW_PRIVATE_ENABLED=false` (owner-preview and judge modes cannot coexist).
- `JUDGE_ACCESS_EXPIRES_AT=2026-11-16T00:00:00.000Z` (exact exclusive deadline).
- `JUDGE_ACCESS_SHA256`: SHA-256 hex of `<JUDGE_CODE>` as UTF-8, provisioned by the parent through a dedicated Secret Manager version/environment binding. `<JUDGE_CODE>` must be an independently generated canonical 32-byte base64url value (43 characters). Parent supplies the actual value privately; none is generated here.

Parent creates/stores `<JUDGE_CODE>` in its approved secret workflow, computes the digest without logging it, binds only that digest to `JUDGE_ACCESS_SHA256`, and puts the code in private judge instructions. No new OAuth scopes, provider credentials, permissions or services are required by this implementation. Never reuse an owner code. Keep existing application environment/scopes unchanged apart from the explicit read-only policy; audit the deployment diff and health before distributing access. Do not publish the raw code as an environment example.

## Exact parent provisioning template (not executed)

Use only already-authorized existing Secret Manager objects readable by the existing runtime identity; stop if that prerequisite is absent. These commands add versions, not IAM grants or projects. Replace the three uppercase secret/version placeholders with reviewed identifiers. `<JUDGE_CODE>` is documentation only: enter the real canonical43-character value at the silent prompt, never in shell history, a command argument, source, URL or environment file. No actual code is supplied here. Run in a private operator terminal with shell tracing disabled; do not capture the raw-code prompt in a recording.

```bash
set +x
umask 077
if ! IFS= read -r -s -p 'Judge code (<JUDGE_CODE> supplied privately): ' judge_code; then unset judge_code; exit 1; fi
printf '\n'
# Canonical validation reads stdin, never an argv credential.
printf '%s' "$judge_code" | python3 -c 'import sys,base64,re; s=sys.stdin.read(); assert re.fullmatch(r"[A-Za-z0-9_-]{43}",s); b=base64.urlsafe_b64decode(s+"="); assert len(b)==32 and base64.urlsafe_b64encode(b).decode().rstrip("=")==s'
# Only continue if validation succeeds; on any failure unset and stop.
if [ "$?" -ne 0 ]; then unset judge_code; exit 1; fi
if ! printf '%s' "$judge_code" | gcloud secrets versions add EXISTING_JUDGE_CODE_SECRET --project=raid-relic-hackathon --data-file=-; then unset judge_code; exit 1; fi
judge_digest=$(printf '%s' "$judge_code" | sha256sum)
judge_digest=${judge_digest%% *}
if ! printf '%s' "$judge_digest" | gcloud secrets versions add EXISTING_JUDGE_DIGEST_SECRET --project=raid-relic-hackathon --data-file=-; then unset judge_code judge_digest; exit 1; fi
unset judge_code judge_digest
```

Deliver the code via the private judging submission instructions, not owner-only contact. Keep its raw secret version restricted to the existing authorized operator workflow; the application needs only the digest secret. Select the exact digest version reported by the successful version-add command, never `latest`. The parent applies the following overlay to its reviewed zero-traffic deployment command (not to the existing100% revision):

```text
--no-traffic --tag=judge-admission
--update-env-vars=JUDGE_ADMISSION_ENABLED=true,P5_PREVIEW_READ_ONLY=true,P5_PREVIEW_PRIVATE_ENABLED=false,JUDGE_ACCESS_EXPIRES_AT=2026-11-16T00:00:00.000Z
--update-secrets=JUDGE_ACCESS_SHA256=EXISTING_JUDGE_DIGEST_SECRET:PINNED_DIGEST_VERSION
```

Preserve all other reviewed release/image, existing secret bindings, service account, resources, region, IAM and traffic settings. Do not add an IAM grant, create a project, use `--allow-unauthenticated`, change scopes, or promote. The parent must verify the complete environment diff and startup before publishing a judge URL. The code is never a deployment argument; its digest remains a Secret Manager reference. Failed secret operations must stop provisioning; no public fallback is permitted.

## Server enforcement and limitations

Admission precedes dispatch. Authenticated judge requests are restricted to a closed GET/HEAD public-content/static read surface and numeric `/ws/<channel>` read feed. OAuth/control/EventSub/internal routes and every application POST/PUT/PATCH/DELETE are denied before handlers; the sole POST exception is bounded same-origin credential login. Existing P5 read-only runtime guards independently remain active, including disabling optional P7 actions. Admission gives no owner/moderator/session/consent authority. It does not enable a simulated live raid: the film/judge demos remain labelled fiction, while public retained records remain read-only observations. Search/forge/private sharing POST utilities are intentionally unavailable.

The existing owner preview retains its original independent configuration, 24-hour maximum expiry, ambiguity rejection, rate/body/header limits and action-policy behavior. Judge expiry is fixed, not an unlimited TTL. Existing live public/old-tag access and service IAM are unaffected by this local change. Parent must still run real HTTPS form/cookie/WebSocket integration and full release gates before deployment; focused local tests are not physical Twitch/OBS proof.

## Source348 focused validation

On the available Node24.22.1 environment, `node test/private-preview.test.js` passed19tests/0fail/0skip; `node_modules/.bin/prettier --write src/server.js test/private-preview.test.js` formatted the changed JavaScript. The attempted `node --test test/private-preview.test.js test/private-preview-transport.test.js` failed its transport file: all three HTTPS cases stopped at `Private fixture startup failed`, before acceptance assertions. No cause is inferred from that closed error. Real HTTPS/browser judge-mode login, numeric WSS projection/expiry and full Node22 release QA remain parent gates, not claimed passes. No live provider or cloud action was performed.

## Source349 transport definitions and current production receipt

The existing offline `privatePreviewFixture({judge:true})` now uses an independent synthetic key and a fixed-deadline clock offset that advances with real elapsed time. It does not fake a real long-duration observation. New transport assertions exercise actual HTTPS form/cookie and numeric WSS projection, reject cookie-authenticated action and non-read-upgrade paths before app/feed counters, and wait for real short-fixture expiry/disconnection. Synthetic read resources test gate routing, not real font decoding or complete application asset parity. Parent Node22 offline VM runs these definitions; source349 did not execute transport/browser tests. Full release remains pending.

Parent independently verified31October18:07UTC production `raid-relic-judge-freeze-on-1031` at100%, health200, runtime2b218b390210f709f031eac4b79b2606b1ff09e0, image193e48e…, P5ROfalse/privatefalse. This is separate from the un-deployed judge-mode candidate and supersedes historical retained-marks100% observations. No source-author live lookup, credential read or deployment occurred.

Source349 focused validation: `node test/private-preview.test.js` passed20tests/0fail/0skip on available Node24.22.1; changed JavaScript was formatted with pinned Prettier3.9.10. Transport/browser definitions were not executed by this source turn; parent Node22/full release results remain independent and pending.

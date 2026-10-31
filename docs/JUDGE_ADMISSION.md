# Judge admission · activated zero-traffic review, 31 October 2026

## Current tagged revision · parent configuration correction after first activation

Judge entrypoint: **[judge-mode-1031](https://judge-mode-1031---raid-relic-vz4bhnskgq-uc.a.run.app)**. Enter `<JUDGE_CODE>` from the private judging instructions in the root form, never in a URL. Judges need no owner contact or Twitch login. Parent reports the current tagged submission target is revision `raid-relic-judge-mode-fixed-1031`, tag `judge-mode-1031`, at **0% traffic**, using immutable runtime **f8151d2ed5abdbb487dd91654d9b594adb747d7e** and image **sha256:a9586b561ae4c3cc4021674f784b656648f34b3c3d9062ef706e871062dff705** without rebuilding. Judge admission and server read-only flags are ON; P5 private-preview mode is false. Expiry is **2026-11-16T00:00:00Z exclusive**.

Parent completed exactly one digest-only secret `raid-relic-judge-digest-1031`, version1, and exactly one secret-scoped accessor grant to the existing runtime service account identified below. Parent reports the independent43-character plaintext code exists only at `/home/ubuntu/.raid-relic-judge/JUDGE_CODE`, mode0600, directory0700. It was not supplied to or read by the source author. No raw-code Secret Manager object/version was created.

**Historical first-revision acceptance: 26 HTTP checks passed (22:05:41 UTC activation), a separate cohort:** correct-code form303 and Secure cookie admitted health200 identifying the exact runtime; wrong header and wrong form401; anonymous health401 and root gate only. Eleven HTML/JS/font/vendor responses matched immutable source bytes, including the45-second demo, Atlas and olsols3 overlay resources. Actual retained-stop detail and Keeper APIs returned200/read-only; `/start` explained the sandbox. Eight OAuth/control/SendOff/EventSub/internal/POST attempts returned403, exactly `Judge sandbox is read only`, before application dispatch. No live Twitch/chat/raid calls, browser/WSS actions, visual rendering or long-duration proof occurred in this acceptance.

Parent subsequently found by static source/configuration inspection that the first revision inherited canonical `OVERLAY_ORIGIN`. `src/runtime.js` sets `overlayOrigins` from that exact environment value, and `src/overlay-sockets.js` rejects upgrades with other request origins. Successful HTML/API HTTP responses therefore did **not** establish working tag-origin WSS.

Parent corrected only the configuration with a second immutable revision, `raid-relic-judge-mode-fixed-1031`, at0%, setting `OVERLAY_ORIGIN=https://judge-mode-1031---raid-relic-vz4bhnskgq-uc.a.run.app`. The same tag and URL now select that revision. The first `raid-relic-judge-mode-1031` revision remains untagged at0% and is not the submission target. These are **two configuration revisions, one final tagged target**, with the same runtime/image and no rebuild, extra IAM, secret, version or binding. Production `raid-relic-judge-freeze-on-1031` remains100%; all prior tags other than the owned new judge-mode tag are unchanged. Parent now reports **26 HTTP checks PASSED on the corrected revision**, separately from the historical first-revision26, not added together: overlay HTML and eleven immutable static responses matched; correct-code form303/health200; wrong form/header401; retained Atlas stop and Keeper APIs200/read-only; eight action-route attempts403 before app dispatch. The deployed `OVERLAY_ORIGIN` exactly equals the tagged origin, the secret still has one version, production remains100% and all prior nonowned tags are preserved. No deployed WSS or browser test was performed, as the owner requested HTTP-only acceptance. Correct source-derived origin configuration is not an observed WSS success.

Historical immutable-source evidence remains separately scoped: parent Node22 **1277 passed, zero skips**, offline private-browser **3checks**, [CI41228565537](https://github.com/OlsOls2/raid-relic/actions/runs/41228565537) test + journey green. These are not new deployed browser/WSS observations. Production `raid-relic-judge-freeze-on-1031` / runtime2b218b3 remains100%; all old tags and existing secret bindings were preserved except the authorized new digest binding. A following docs-only repository SHA may differ from runtime f8151d2; it requires no image rebuild or redeploy. Source author performed no cloud, credential, Git or live operation.


This default-OFF mode was activated by the parent as recorded above, not by the source author. It is separate from the existing short-lived owner preview. Judges receive the code in the private judging submission instructions, so they need no owner contact. Never place it in a repository, URL, public document, screenshot or log. Enter it in the HTTPS root form; the existing Secure/HttpOnly/SameSite cookie lasts at most 12 hours per login. The same code can be re-entered until 16 November 2026 00:00 UTC exclusive. Expiry also closes admitted WebSockets.

## Parent-only configuration

Use a separate zero-traffic candidate; do not modify production traffic, project IAM or existing preview credentials. The narrowly scoped secret-resource IAM exception below is authorized for this operation only. Required environment:

- `JUDGE_ADMISSION_ENABLED=true` (unset/false preserves existing behavior).
- `P5_PREVIEW_READ_ONLY=true` (false/unset is a startup error in judge mode).
- `P5_PREVIEW_PRIVATE_ENABLED=false` (owner-preview and judge modes cannot coexist).
- `OVERLAY_ORIGIN=https://judge-mode-1031---raid-relic-vz4bhnskgq-uc.a.run.app` (must exactly match the tagged browser origin; inherited canonical origin rejects tag-origin WSS).
- `JUDGE_ACCESS_EXPIRES_AT=2026-11-16T00:00:00.000Z` (exact exclusive deadline).
- `JUDGE_ACCESS_SHA256`: SHA-256 hex of `<JUDGE_CODE>` as UTF-8, provisioned by the parent through a dedicated Secret Manager version/environment binding. `<JUDGE_CODE>` must be an independently generated canonical 32-byte base64url value (43 characters). Parent supplies the actual value privately; none is generated here.

Parent generates `<JUDGE_CODE>` privately into `/home/ubuntu/.raid-relic-judge/JUDGE_CODE` (mode0600), computes its SHA-256 without printing either value, and binds only the digest secret to `JUDGE_ACCESS_SHA256`. Plaintext is never stored in Secret Manager. Judges receive it through private submission instructions. No new OAuth scopes or provider credentials are authorized; only the single secret-resource grant below is allowed. Never reuse an owner code. Keep existing application environment/scopes unchanged apart from the explicit read-only policy; audit the deployment diff and health before distributing access. Do not publish the raw code as an environment example.

## Source350 · narrowly authorized exception, 31 October 2026 22:03 UTC

Explicit owner-delegated Grok authorization supersedes **only** the earlier blanket no-IAM/no-new-secret prerequisite for this operation. Parent alone may create **one** new Secret Manager secret, `raid-relic-judge-digest-1031`, with **exactly one version**, containing only the SHA-256 hex digest of an independent canonical43-character/32-byte base64url judge code. Parent may add **exactly one resource-scoped** `roles/secretmanager.secretAccessor` binding for `serviceAccount:raid-relic-runtime@raid-relic-hackathon.iam.gserviceaccount.com` **on that secret only**. No project IAM, new principal, broader role, raw-code secret/version, unrelated resource or credential change is authorized. This replaces the earlier two-secret template; do not execute that obsolete procedure.

Plaintext storage is only `/home/ubuntu/.raid-relic-judge/JUDGE_CODE`, mode0600, in an owner-only directory. The source author must never read it. No code/digest is printed or put into command arguments, shell history, repository, URL, environment file or QA artifact. `<JUDGE_CODE>` remains documentation notation, not an actual credential. Private judge instructions are the authorized delivery channel, not a public document or a second plaintext file.

## Historical authorized parent provisioning procedure · completed, do not rerun

Run once in a private, unrecorded operator shell. The following subshell disables tracing and stops on any failure. It refuses an existing code file or unsafe directory; the secret creation likewise fails if the named secret exists. **Do not rerun, add another version or regenerate after a partial failure.** Parent must first reconcile nonsecret operation metadata against the one-secret/one-version/one-grant authorization. A partial failure is not permission to deploy or fall back public.

```bash
(
  set +x
  set -euo pipefail
  umask 077
  # Python writes the raw code only to the exclusive0600 file.
  # Only the digest goes to this nonexported shell variable, never the terminal.
  judge_digest=$(python3 - <<'PYCODE'
import hashlib, os, secrets, stat, base64
folder = '/home/ubuntu/.raid-relic-judge'
try:
    os.mkdir(folder, 0o700)
except FileExistsError:
    pass
directory = os.open(folder, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
try:
    info = os.fstat(directory)
    if info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o700:
        raise RuntimeError('Unsafe judge directory')
    code = base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b'=')
    if len(code) != 43:
        raise RuntimeError('Invalid generated judge code')
    descriptor = os.open('JUDGE_CODE', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=directory)
    with os.fdopen(descriptor, 'wb') as output:
        output.write(code)
        output.flush()
        os.fsync(output.fileno())
    os.fsync(directory)
    print(hashlib.sha256(code).hexdigest(), end='')
finally:
    os.close(directory)
PYCODE
  )
  [[ "$judge_digest" =~ ^[a-f0-9]{64}$ ]] || exit 1
  printf '%s' "$judge_digest" | gcloud secrets create raid-relic-judge-digest-1031 \
    --project=raid-relic-hackathon --replication-policy=automatic --data-file=-
  unset judge_digest
  # The create-with-data operation creates the sole version1. No versions add.
  gcloud secrets add-iam-policy-binding raid-relic-judge-digest-1031 \
    --project=raid-relic-hackathon \
    --member=serviceAccount:raid-relic-runtime@raid-relic-hackathon.iam.gserviceaccount.com \
    --role=roles/secretmanager.secretAccessor --condition=None
)
```

The commands above are documentation, not performed operations. Do not use secret access commands, print the code file, grant project roles, or create a raw-code Secret Manager object. After successful provisioning, parent verifies only nonsecret metadata: exactly one enabled version (`1`), the one resource grant and the reviewed deployment diff. Do not dump IAM/env/secret material into public evidence. If prerequisites or counts differ, stop for review rather than granting more authority.

## Historical parent deployment boundary · activation completed above

The authorized procedure was for parent alone to deploy `judge-mode-1031` at **0%**, using the **already tested immutable f8151d2 image**, not a rebuild or a mutable image tag. Resolve its exact digest from the parent's reviewed release record; no image digest is invented here. Preserve the existing production environment template and all prior tags, resources, service account, secret bindings and traffic except the one new digest binding, these explicit judge/read-only flags and the exact tagged OVERLAY_ORIGIN. Apply this overlay to the reviewed parent deployment command:

```text
--no-traffic --tag=judge-mode-1031 --revision-suffix=judge-mode-fixed-1031
--image=<IMMUTABLE_F8151D2_IMAGE_DIGEST>
--update-env-vars=JUDGE_ADMISSION_ENABLED=true,P5_PREVIEW_READ_ONLY=true,P5_PREVIEW_PRIVATE_ENABLED=false,JUDGE_ACCESS_EXPIRES_AT=2026-11-16T00:00:00.000Z,OVERLAY_ORIGIN=https://judge-mode-1031---raid-relic-vz4bhnskgq-uc.a.run.app
--update-secrets=JUDGE_ACCESS_SHA256=raid-relic-judge-digest-1031:1
```

Never use `latest`, `--set-secrets` to replace existing bindings, `--allow-unauthenticated`, project IAM changes, scope expansion or promotion. Preserve production `raid-relic-judge-freeze-on-1031` at100% and all existing tags. The fixed expiry remains **16 November2026 00:00UTC exclusive**. Parent verifies startup, anonymous denial, authenticated read-only routes and HTTP/WSS write denial before distributing a judge URL. The source351 parent receipt above now records completed activation, secret creation and the one scoped IAM binding. This template is retained for provenance, not a request to provision or deploy again.

## Server enforcement and limitations

Admission precedes dispatch. Authenticated judge requests are restricted to a closed GET/HEAD public-content/static read surface and numeric `/ws/<channel>` read feed. OAuth/control/EventSub/internal routes and every application POST/PUT/PATCH/DELETE are denied before handlers; the sole POST exception is bounded same-origin credential login. Existing P5 read-only runtime guards independently remain active, including disabling optional P7 actions. Admission gives no owner/moderator/session/consent authority. It does not enable a simulated live raid: the film/judge demos remain labelled fiction, while public retained records remain read-only observations. Search/forge/private sharing POST utilities are intentionally unavailable.

The existing owner preview retains its original independent configuration, 24-hour maximum expiry, ambiguity rejection, rate/body/header limits and action-policy behavior. Judge expiry is fixed, not an unlimited TTL. Existing live public/old-tag access and service IAM are unaffected by this local change. The later scoped parent QA receipt below supersedes the earlier local fixture-startup failure as a release-test blocker. Parent completed provisioning and the corrected revision’s26 HTTP checks passed as recorded above, separately from the historical first-revision cohort; automated tests are not physical Twitch/OBS proof.

## Historical source348 focused validation

On the available Node24.22.1 environment, `node test/private-preview.test.js` passed19tests/0fail/0skip; `node_modules/.bin/prettier --write src/server.js test/private-preview.test.js` formatted the changed JavaScript. The attempted `node --test test/private-preview.test.js test/private-preview-transport.test.js` failed its transport file: all three HTTPS cases stopped at `Private fixture startup failed`, before acceptance assertions. No cause is inferred from that closed error. Real HTTPS/browser judge-mode login, numeric WSS projection/expiry and full Node22 release QA remain parent gates, not claimed passes. No live provider or cloud action was performed.

## Historical source349 transport definitions and production receipt

The existing offline `privatePreviewFixture({judge:true})` now uses an independent synthetic key and a fixed-deadline clock offset that advances with real elapsed time. It does not fake a real long-duration observation. New transport assertions exercise actual HTTPS form/cookie and numeric WSS projection, reject cookie-authenticated action and non-read-upgrade paths before app/feed counters, and wait for real short-fixture expiry/disconnection. Synthetic read resources test gate routing, not real font decoding or complete application asset parity. Parent Node22 offline VM runs these definitions; source349 did not execute transport/browser tests. At source349, full release remained pending; the later parent receipts above supersede that status.

Parent independently verified31October18:07UTC production `raid-relic-judge-freeze-on-1031` at100%, health200, runtime2b218b390210f709f031eac4b79b2606b1ff09e0, image193e48e…, P5ROfalse/privatefalse. At that18:07 checkpoint this was separate from the then-un-deployed judge-mode candidate and supersedes historical retained-marks100% observations. No source-author live lookup, credential read or deployment occurred.

Source349 focused validation: `node test/private-preview.test.js` passed20tests/0fail/0skip on available Node24.22.1; changed JavaScript was formatted with pinned Prettier3.9.10. Transport/browser definitions were not executed by this source turn; parent Node22/full release results were then independent and pending; the later receipt above supplies their scoped outcome.

## Parent QA receipt supplied for source350 · historical, not activation

Parent reports immutable f8151d2 passed **Node22 1277tests/0skips**, private-browser **3checks**, and hosted [CI41228565537](https://github.com/OlsOls2/raid-relic/actions/runs/41228565537) **test + journey green**. These scoped parent results supersede the earlier source348 fixture-startup failure and source349 pending-test wording, which remain historical records above. No new QA, physical Twitch/OBS proof or judge-mode cloud activation is invented by this docs-only update. Parent-reported production remains `raid-relic-judge-freeze-on-1031` at100%; no source-author live lookup or cloud/Git operation was performed.

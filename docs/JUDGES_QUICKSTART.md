# Judges Simulator — local Coulds review

**Current parent-verified Coulds proof:**287/287 host tests,zero skips; all five sandboxed browser workflows PASS—Forge actual JSON/SVG downloads2 checks, recap actual SVG/1200×630 PNG4, judges3,pilot8,Atlas13. npm audit0 vulnerabilities;54 release files/diff PASS. Parent viewed Forge desktop/375px and recap PNG/mobile: clear Simulator/template/no-live-apply labels and canonical moon parity. No physical/live AI/Twitch proof. Recapc63ec31 is branch-pushed, Forge awaits parent commit. Coulds are ONLYfeature/raid-relic-coulds, not main/Shoulds/live. Fade after3 streams and shared-chat resonance are deferred, not implemented. Prior pending QA below is historical. Main and both revisions stay frozen; no further provider/key/cloud actions are authorized.


**MAIN AND BOTH REVISIONS ARE FROZEN.** Canonical `raid-relic-00003-kwp` remains100%/sourcefd05. Parent completed the Shoulds tagged0% preview `00004-kul`/source0723; it shares live Firestore/auth rows, not isolated staging. [Tagged preview safety](TAGGED_PREVIEW.md) supersedes older not-deployed claims. Could #1 recap and Could #2 Forge remain only on `feature/raid-relic-coulds`, neither merged nor deployed. Do not build, deploy, change cloud state, read credentials or initiate real Twitch/AI actions for this review. [LIVE_TEST.md](LIVE_TEST.md) remains the separate frozen owner workflow, not this simulator.

## Fresh clone and start

Use Node.js **22+** and the review branch `feature/raid-relic-coulds`. Use the authorised clone URL below, or the provided reviewer archive; GitHub read access may be needed. The app simulation itself needs no Twitch, cloud or OpenAI credentials, `.env`, paid key or actual consent. With an archive, unpack it and enter its repository directory instead of running git clone.

```sh
git clone --branch feature/raid-relic-coulds https://github.com/OlsOls2/raid-relic.git raid-relic
cd raid-relic
node --version
npm ci --ignore-scripts --no-audit --no-fund
npm run judges
```

Open **http://127.0.0.1:5191/judges** exactly (not `localhost`). The explicit command runs `node scripts/judges.js --simulator` and binds only registered loopback **127.0.0.1:5191**, with no alternative port. If occupied, stop this attempt and resolve the port owner; do not terminate other projects. Production `NODE_ENV` or any `K_SERVICE` setting rejects startup. Ambient store/provider configuration is not passed into the fixture. It uses only fresh memory, synthetic OAuth/account grants, mocked Twitch HTTP and a disabled Chronicle transport; it never loads default credentials or the Firestore SDK. Real `npm start` is unchanged.

Every page, loading/error view, tab and response header says **SIMULATOR**, including 160px overlays. API objects have `mode: simulator`. Actual numerical account IDs are engine constants, presented as Simulated identities; they do not assert actual consent, online status or raids. Links stay local. OAuth start/callback and external redirects are denied. Production has no simulator route, query activation, seed or admin endpoint; judge scripts/assets/tests are excluded from release.

## Click order

1. **Simulate three consents, setup & Keep**: mock bot and both mock Keepers, sequential reconciliation (five enabled subscriptions each), already-live stream observations and explicit opt-in. No browser login occurs.
2. **Add approved source mark “moon”**: actual mark/approval kernel via synthetic signed chat. Inspect **Observed eligible simulated Keeper**: it lists the other opted-in observed-online mock Keeper, not continuous provider authority or an arbitrary destination.
3. **Simulate Send Off API acceptance**: mock Start Raid runs through the authenticated internal owner-control helper. The relic stays source, zero rings and no arrival. API acceptance is not travel.
4. **Simulate verified raid receipt**: synthetic HMAC EventSub opens the host's incoming approved-rune preview and the app-local 90-second claim window. Only this separate receipt starts presentation; it is never called Twitch synchronized.
5. **Source !offer**, then **Host !accept**: independent buttons invoke two different nonbot actors in their respective authenticated mock chats. For the tiny simulated raid, T=1 on each side. One side alone cannot transfer; both commit ownership, an Atlas stop and exactly one ring. Chat location is not proof of actual raid membership.
6. Open **Simulated Atlas**. Search **moon** using the approved-text input (Enter works), follow its stop link, and inspect the rune and **Fiction · template** line. This searches shared public approved text, not verified personal ownership or viewer/account associations. Query is transient POST body data, never the URL/history. Clear before screenshots if desired. Chronicle generation remains **OFF**, no key, not real AI; even a small model could incur costs if separately approved/enabled later.
7. From Atlas choose **Journey recap card** (or the console’s **Simulated recap card & downloads** link). Inspect actual completed-stop/ring/retained-entry counts, the full route and explicitly labelled rune subset. Click **Download SVG** and optionally **Download PNG**: both refresh from current memory, and the files themselves carry a Simulator watermark. No automatic public post occurs; old files cannot be recalled after erasure. Empty/reset history is truthfully zero. Parent has verified actual recap SVG/PNG exports; see the current proof above.
8. **Forget source mark** demonstrates fresh search results and the active host overlay losing the retained content. Refresh a separate Atlas/stop tab manually: it is a snapshot, not a remote-erasure push to old browser pages or screenshots. The completed ring/stop remains. Minimal existing quota/cooldown records are not refunded; no Twitch-wide erasure is claimed.
9. Open **Simulated Forge templates & JSON** (or Atlas → **Relic Forge templates**). Enter **tall violet crystal with 8 facets**, click **Preview template**, inspect source:template/schemaVersion1/mode:simulator/applied:false. Try **warm amber orb** for a distinct deterministic template. Fullwidth/case variants normalize identically. **Copy JSON**, **Download JSON**, **Download SVG** are local previews with Simulator mode/watermarks; no real AI or live customization. Clearing/errors remove old preview and blob URLs. No DB write/provider call/key/auth is needed for templates.
10. **Reset only local memory** starts fresh isolated memory and reconnects/reloads the two preview frames. Separate tabs need manual reload. For an alternate expiry demo, reset/repeat through the receipt, then **Advance synthetic clock 90s** before host acceptance; claims can no longer complete. The synthetic clock also advances with local elapsed time, without provider polling.

The source is **Simulated raidrelichq (1591805230)**, host **Simulated olsols2 (1591806023)**, bot **Simulated raidrelicbot (1591804828)**. These are fixed allowlisted engine actors, not real authenticated accounts. The wrapper's POST actions accept one allowlisted action only, exact local Origin and JSON up to1024 bytes, with no arbitrary URL, target, actor or configuration input. No secrets, tokens, CSRF values or private participant associations are returned to the judges console.

## Overlay and optional sound

Local source: http://127.0.0.1:5191/overlay/1591805230?corner=1

Local host: http://127.0.0.1:5191/overlay/1591806023?corner=1

Optional sound: http://127.0.0.1:5191/overlay/1591806023?corner=1&sound=1

Sound is muted by default: no AudioContext/oscillators without opt-in and a local **Sound** button gesture (OBS Browser Source → Interact if used). Browser permission and OBS audio routing still apply; no autoplay bypass. `sound=0` is silent, and corner/sound order is independent. Initial/reconnect snapshots do not replay cues. All views remain explicitly simulated, including sound demonstrations. Context-count/mock tests are not physical listening or live OBS proof.

## QA and cleanup

```sh
npm test
node --test --test-isolation=none
npm run release:files
git diff --check
```

Stop the judges launcher with **Ctrl-C** before running any browser script. Optional parent-host scripts each own5191 and must run **sequentially**:

```sh
node scripts/browser-smoke-forge.js
node scripts/browser-smoke-recap.js
node scripts/browser-smoke-judges.js
node scripts/browser-smoke.js
node scripts/browser-smoke-pilot.js
```

The judges browser smoke uses sandboxed Chromium, blocked nonlocal HTTP/WebSockets and the in-memory fixture; finally closes browser/server/sockets and saves available labelled captures/results under ignored `artifacts/judges-*`. It covers receipt/claim, search/template, erasure/reset and375px layout. No new dependency is required for core tests; optional browser QA requires the already installed Playwright and `/snap/bin/chromium`. Parent has now run it successfully: six labelled screenshots exist and desktop/mobile/stop captures were reviewed. Simulator labels remain clear and persistent; the sticky header appears at the viewport scroll position in full-page captures, with the initial DOM banner present. No real raid or AI claim was found. The CLI also closes its own HTTP/WS resources on Ctrl-C/SIGTERM. Closing idle OBS/browser sources contains local usage.

Parent verified Should #4 **254/254**, Atlas/audio/pilot browser PASS, pushed `86c28e6`; Should #3 **244/244 + Atlas PASS**, `483b898`; Should #2 **231/231 + Atlas PASS**, `b3e7f57` + `b5a135f`; Should #1 **223/223 + pilot PASS**, `b0027e0`. These are historical local-mock branch proofs. Current Should #5 evidence is recorded below; neither set is real Twitch/OBS/AI validation. OAuth scopes stay exactly Keeper `channel:bot channel:manage:raids`, bot `user:read:chat user:write:chat user:bot`. No claim that all Musts or live validation are complete.

Latest **parent-verified Should #5 QA**: **261/261 host tests PASS, zero skips**; all254 baseline tests retained. **All three sandboxed Chromium workflows PASS**: judges three checks with six labelled screenshots, pilot eight checks, and current Atlas/search/Chronicle/audio checks. Parent also verifies **audit zero vulnerabilities,44 release files and diff check PASS**. Earlier Codex sandbox261/256pass/five EPERM skips is historical, superseded for host validation. Codex has not rerun the browsers in this docs-only update. No actual providers, credentials, keys, costs, cloud operations or deployments were used; live00003/sourcefd05 remains frozen. At that historical proof point all five Shoulds were branch-only; they are now merged/tagged as recorded above, with canonical live stillfd05; parent will review and commit the entire Should #5 increment separately.

Could #1 current sandbox QA:273total/268pass/five EPERM loopback skips/0fail, all261 baseline retained;22 test files/48 release inventory/diff and client/browser syntax pass. New recap host PNG/download/mobile/privacy screenshots and all three existing browser workflows await parent rerun. Prior Should #5 parent261/browser passes above are historical, not a new Could #1 browser pass. The local-only wrapper permits blob images for recap rendering without allowing nonlocal requests; exports themselves retain the Simulator watermark.


Could #2 optional model path is not part of the judges walk-through: both Chronicle cost gates remainfalse and no key is bound. The local wrapper rejects real OAuth and has a hard mock-only provider transport. An actual owner would separately need prior approval, both gates, a Secret Manager key reference, their own scoped private session and a completed received stop. The narrow `/control/:id/forge` page warns about provider upload/charges and requires explicit acknowledgement; one Forge attempt per latest received stop is persisted before any upstream call. No automatic retries/auto-apply or extra scopes. Do not submit personal data. All model/moderation tests are mocks, never real provider validation.

Parent verified Could #1 host274/274 and actual SVG/1200×630 PNG recap downloads PASS, pushedc63ec31 and reviewed moon parity/Simulator labels. Those are historical recap proofs, not new Forge browser proof. The new Forge gate uses owned standard Downloads storage (no Snap-private `/tmp`), retains sandboxing, verifies real downloaded files and cleans only its own unique directory after browser closes. Parent has now passed the new gate and all four existing workflows, as recorded above. Main and both cloud revisions remain frozen; no fade/resonance/promotion is authorized here.
Could #2 local suite:287 total/282pass/five sandbox EPERM skips/0fail,274baseline retained,23 test files/54 release files and syntax/diff pass. Forge model tests remain mock-only; parent browser/download capture proof and all four existing reruns now PASS. Paid Chronicle/Forge were never called; both flags remainfalse on preview.

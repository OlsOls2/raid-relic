# Should #1: observed Keeper targets — branch-local review

**Live deployment is frozen by the owner.** Do not build, deploy, change cloud configuration, contact live Twitch/OpenAI, read credentials or initiate owner live actions for this branch review. The live owner-test deployment remains source `fd05a5ee67f841b1ac92ebb221581db227d2353f`, revision `raid-relic-00003-kwp`. Earlier redeploy authorizations are superseded. This Should is **not deployed**. Work stays in the original Codex thread; no other Should features are included.

## Start with local branch QA

```sh
git switch feature/raid-relic-shoulds
npm test
node --test --test-isolation=none
npm run release:files
git diff --check
```

Current sandbox result: **223 total,218 pass,zero failures,five EPERM loopback skips**. All216 baseline tests are retained. The host216/216 and prior mocked-browser passes concern the frozen baseline, not new branch visual proof. No build/deploy is part of these commands. Parent reviews before any commit/push; Codex has not committed or pushed.

Optional parent-host **local mocked** browser QA on registered5191: `node scripts/browser-smoke-pilot.js` and `node scripts/browser-smoke.js` (sequentially). They do not connect to Twitch; keep Simulator labels visible, Chromium sandbox enabled, and stop only their own fixture server. No new browser/OBS pass or screenshot is claimed for this Should here.

## What to review

The authenticated private control page now has a labelled **Observed eligible raid target** selector. The list comes from one consistent stored lifecycle/mark-policy snapshot, not Get Streams or provider polling. It excludes the viewer's own channel and any target that is offline, not opted in, paused, banned or blocked/ineligible. Source ownership/current eligibility is also required. The same two curated accounts remain: home `raidrelichq`1591805230 and `olsols2`1591806023; bot1591804828. No scopes, grant onboarding or arbitrary targets were added.

**Refresh status** manually reads a fresh snapshot. “Observed online” is not continuous live authority. An empty list gives setup/refresh guidance; it is not proof that no other Twitch stream exists. With one candidate the button still reads **Send Off to olsols2** (or **Send Off to raidrelichq**), preserving the existing browser gate. Selection produces only the canonical `send:<allowlistedID>` action; request JSON remains exactly action+CSRF, with actor derived from the scoped session. There is one explicit named-target confirmation and no automatic action on selection/refresh.

Server reservation and final dispatch still recheck current ownership, stream, consent and policies. Tests cover both holder directions, offline/unopted/paused/banned/blocked/self exclusions, cross-account session rejection, and stale selection before reservation/during preflight. A stale UI cannot force an ineligible raid. Candidate output contains only public channel ID/login and safe eligibility booleans, no token, stream ID, pending mark/chat data or participant IDs. No background networking was introduced.

## Frozen live owner instructions

The existing [owner-test guide](LIVE_TEST.md) and [deployed release handoff](DEPLOYMENT.md) describe revision00003/sourcefd05. They are not permission to redeploy this branch or perform live actions during local review. The owner may carry out the separately authorized actual test against that frozen deployment; this new selector will not appear there. Actual live verification remains unproven by local mocked tests. No claim that all Musts/Shoulds are complete.

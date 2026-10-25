# Shoulds branch: observed Keeper targets and shared-text search

**Live deployment is frozen by the owner.** Do not build, deploy, change cloud configuration, contact live Twitch/OpenAI, read credentials or initiate owner live actions for this branch review. The live owner-test deployment remains source `fd05a5ee67f841b1ac92ebb221581db227d2353f`, revision `raid-relic-00003-kwp`. Earlier redeploy authorizations are superseded. Should#2 is **not deployed**; Should#1 was reviewed/pushed on this branch, also not deployed. Work stays in the original Codex thread; only Should#1 and the separately authorized Should#2 are included; no Should#3.

## Start with local branch QA

```sh
git switch feature/raid-relic-shoulds
npm test
node --test --test-isolation=none
npm run release:files
git diff --check
```

Current sandbox result: **231 total,226 pass,zero failures,five EPERM loopback skips**. All223 pre-search tests are retained. Parent verified Should#1 with223/223 plus pilot browser PASS and pushedb0027e0; these facts do not prove the new search browser gate. The host216/216 and prior mocked-browser passes concern the frozen baseline, not new branch visual proof. No build/deploy is part of these commands. Parent reviews before any commit/push; Codex has not committed or pushed.

Optional parent-host **local mocked** browser QA on registered5191: `node scripts/browser-smoke-pilot.js` and `node scripts/browser-smoke.js` (sequentially). They do not connect to Twitch; keep Simulator labels visible, Chromium sandbox enabled, and stop only their own fixture server. The extended search browser check is pending parent host QA; no new search/browser/OBS screenshot proof is claimed.

## What to review

The authenticated private control page now has a labelled **Observed eligible raid target** selector. The list comes from one consistent stored lifecycle/mark-policy snapshot, not Get Streams or provider polling. It excludes the viewer's own channel and any target that is offline, not opted in, paused, banned or blocked/ineligible. Source ownership/current eligibility is also required. The same two curated accounts remain: home `raidrelichq`1591805230 and `olsols2`1591806023; bot1591804828. No scopes, grant onboarding or arbitrary targets were added.

**Refresh status** manually reads a fresh snapshot. “Observed online” is not continuous live authority. An empty list gives setup/refresh guidance; it is not proof that no other Twitch stream exists. With one candidate the button still reads **Send Off to olsols2** (or **Send Off to raidrelichq**), preserving the existing browser gate. Selection produces only the canonical `send:<allowlistedID>` action; request JSON remains exactly action+CSRF, with actor derived from the scoped session. There is one explicit named-target confirmation and no automatic action on selection/refresh.

Server reservation and final dispatch still recheck current ownership, stream, consent and policies. Tests cover both holder directions, offline/unopted/paused/banned/blocked/self exclusions, cross-account session rejection, and stale selection before reservation/during preflight. A stale UI cannot force an ineligible raid. Candidate output contains only public channel ID/login and safe eligibility booleans, no token, stream ID, pending mark/chat data or participant IDs. No background networking was introduced.

## Should #2: Where has my mark been?

Run the local mocked Atlas browser script above, or open its labelled Simulator Atlas on5191. In **Approved mark text (one word or emoji)** enter a shared approved word such as the fixture's synthetic moon mark; click **Search approved text** or press Enter. Matching completed stop links and approved rune/text are shown in pages≤20. Follow a stop link to existing detail navigation; **Clear search** removes the input/results. The script checks Unicode normalization, POST-only search without URL changes and375px results. Clear the synthetic query before capturing screenshots; do not collect real user queries.

This is shared-text discovery, **not verified personal ownership or a viewer/account association lookup**. Exact mark NFKC/case normalization and one-word/emoji bounds apply; substring matching is literal, not regex. Pending text and content erased by forget/block/veto/opt-out never appear in a fresh search. No-result/invalid/unavailable states clear old matches; manual requests read fresh data, without a query cache or polling. Browsers can retain displayed results until a clear/refresh/navigation; there is no claim of remote screenshot erasure.

The dedicated read-only POST endpoint accepts query/offset/limit in a≤1024-byte JSON body, never in URL/history/logs. It rate-limits before a single bounded lineage-document read. General Atlas POST stays405; malformed arguments fail400. Public result fields are only stop/channel/time/ring/approved-text/rune fields; no actor IDs, private association or OAuth data. Scopes are unchanged: Keepers channel:bot + channel:manage:raids; bot user:read:chat + user:write:chat + user:bot. No new authorization or provider traffic.

## Frozen live owner instructions

The existing [owner-test guide](LIVE_TEST.md) and [deployed release handoff](DEPLOYMENT.md) describe revision00003/sourcefd05. They are not permission to redeploy this branch or perform live actions during local review. The owner may carry out the separately authorized actual test against that frozen deployment; this new selector will not appear there. Actual live verification remains unproven by local mocked tests. No claim that all Musts/Shoulds are complete.

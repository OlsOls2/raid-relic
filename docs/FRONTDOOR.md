# Public front door · Group 4

The root page introduces Raid Relic with **“Raids that leave a story.”** and **“A living relic your chat passes to the next stream. Both chats claim it. Every hand-off adds a ring.”** The primary link opens the fictional 45-second `/demo/judge`; the secondary link opens `/start`. The separate interactive `/demo/` remains 35 seconds and `/demo/film` remains 150 seconds. Public navigation also appears on the Keeper page, interactive-demo footer and film/judge end card.

The existing Atlas hero and its renderer, first-frame handover and resource ceilings are reused. The landing reserves that same art footprint, with both actions and the relic targeted above the fold at 1920×1080, and the primary action above the fold at 390×844. A mobile 56px action bar includes the safe-area inset. At widths below 600px, the native ledger disclosure starts collapsed and responds to viewport changes; the user can still open it. `/atlas/` retains the map, ledger, search and completed-stop history. The landing folds the detailed archive behind a disclosure rather than removing records or inventing a shorter history. “How we verify” explains verified arrival, both chats, the distinct Wander path and erasure limits.

## Admission stays closed

`/start` replaces the pilot dropdown with a channel-name field. It matches only the existing public configured mapping; this is not a Twitch account resolver. A configured name reveals the same exact canonical role-bound OAuth/control/OBS links as before. An unknown name gets an honest invitation to contact the owner. There is no new generic OAuth route, open signup, automatic consent, readiness claim, grant, subscription or game action. Connection still verifies the matching account on the existing callback. Private control/wizard behavior belongs to Group 5 and is unchanged here.

## Public dates and Keeper cards

`publicDate` in the existing `streak-view.js` is the shared en-GB UTC date formatter for Atlas, map captions, public scores, Keeper records and recap. Dates less than 24 hours old use relative text; older/future dates use a human UTC date. Card exports use the same formatter with an absolute date so a saved card stays factual. Invalid dates never invent a completion. Zero ring/rune displays yield to “First journey begins” or are hidden; completed counts remain authoritative.

Keeper previews are actual rendered landscape cards based on the current bounded public stop metadata, shown at 320×180. They are previews, not export grants or proof of live status. Raster work is sequential. Each thumbnail PNG is at most 32 KiB, with at most 16 retained URLs / 512 KiB aggregate; all owned URLs are revoked on refresh/leave. Three entries are initially expanded; the remainder use a `+N more` disclosure and defer thumbnail work. A rendering failure leaves the factual stop text, never a substitute image.

Each ring has two buttons at most: Share and the selected download/copy action. Web Share shares the public stop link where supported; otherwise the menu offers Landscape PNG, Vertical PNG and Copy stop link. PNG download still re-reads the current profile/approved stop and rechecks it immediately before saving. No private participant IDs or pending text enter the card. Saved files cannot be recalled after erasure.

## Parent verification required

Source authoring did not execute the application, tests or browser. Parent should run:

- `test/frontdoor.test.js`, existing onboarding/admission/privacy/card tests, then the full native suite.
- `scripts/browser-smoke-onboarding.js`: actual 1920/390 geometry, above-fold actions/art, 56px mobile bar, height ≤4500 at 390×844, responsive disclosure, keyboard focus, computed Cinzel/body size, no visible ISO dates, typed known/unknown channel behavior and all existing CSRF/session/origin checks.
- `scripts/browser-smoke-desirability.js`: real decoded 320×180 thumbnail pixels, at most two buttons/ring, public metadata, both manual PNG orientations and existing erasure/unavailable-export denial. Six additional signed mock hops create a genuine four-entry profile to check the three-entry / `+1 more` disclosure and actual decoded previews. The test explicitly selects the fallback share menu; it does not invoke an OS share sheet.
- The complete browser cohort, public captures and source/runtime parity checks before any preview publication.

No vendored axe runtime was found in the repository during this increment. These keyboard/layout/type checks are not an axe scan, an assistive-technology certification or a claim of zero serious axe findings. Parent can supply an already-reviewed offline axe tool if available; no dependency was installed or fetched here. Manual Web Share/device and assistive-technology review remain owner checks.

Group 3's parent-reported real-hour proof exercised the frozen source274 default-card read workload and synthetic transport arrival. It is not byte-identical proof of this front-door increment or physical OBS. No overlay layout, animation timing, connection policy, authority, consent, quota, delivery, paid-service or server-resource behavior is changed here. The shared public streak date caption now uses the human date formatter as part of this public-copy increment. Publication remains blocked by the separate unresolved evidence policy; no evidence files, exporter, caps, generated QUALITY or deployment state are changed by this increment.

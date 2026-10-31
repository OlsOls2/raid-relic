# 31 October follow-ups — local source candidate

The owner reported a successful olsols2 → olsols3 hand-off and Ring 12 at
11:12–11:15 UTC. This is an owner report, not source-author live execution.
Deployment verification belongs to the parent. At 11:19–11:20 UTC the parent
confirmed an approved `light` mark in the active actual holder session, while
the public Ring 12 arrival archive and Keeper archived glyph count were zero.
This confirms an archive-only view gap, not a missing stored mark. The source
author did not read production data or independently verify the live overlay.

## Approved retention policy — local source334 candidate

The owner explicitly clarified at 12:02 UTC that approved marks belong to the
ring/hold where made and remain public after a stream ends. The parent reports
`light` still approved in a closed olsols3 session with Ring 12 held there.
The previous online-only view does not meet that policy.

Atlas list/detail/search, Keeper glyphs and the holder overlay now share a pure
read-time union of existing arrival marks and approved marks made during that
hold. Stored arrival snapshots are **not modified**. Each additional mark needs
its configured channel's retained approved record and a trusted creation time
strictly inside one continuous authoritative hold: after that stop's claim and
before the next claim (or the actual current holder's open-ended final hold).
Equal-boundary, missing timestamp, discontinuous/unsorted and initial-hold legacy
attribution is conservatively omitted rather than guessed. Stream closure or a
new stream does not change this association. No stream is reopened and offline
mark collection remains denied by the existing live-holder/quota rules.

Reads recheck approval, opt-in, pause/ban and block/privacy state; erased/vetoed
records cannot be regenerated. Origin/channel/stream/user references remain
private; only existing opaque mark IDs, approved text and original glyphs escape.
An already represented mark is not appended twice. Bounds stay four configured
Keepers, sixteen stops/sessions, 160 marks per projected ring and 512 KiB private
projection; over-capacity fails closed, without truncation or data deletion.
Keeper's existing bounded twenty-glyph preview retains its honest total count.

No migration, approval, quota reset, collection, provider action or data write is
needed for the parent-reported unambiguous Ring 12 `light`. Tests are definitions,
not source-author execution: both stores cover offline retention, old/new stream,
search/detail, move/replay, forget/block and private-pending exclusion. The browser
probe renders the actual offline holder glyph in Atlas, Keeper and reduced-motion
SVG overlay. Normal WebGL/resource coverage remains in existing workflows.
**Completion still requires parent QA and the actual new zero-preview APIs showing
stored Ring 12 `light`; a local fixture pass alone is insufficient.**

The bounded `/overlay?channel=...` alias accepts only an exact configured login or
ID with an existing feed and redirects relatively to the numeric overlay route.
Extra/duplicate parameters, encoded names and arbitrary destinations fail closed.
Invalid multiword mark guidance now gives `!mark light` as the one-word example.
Waiting copy explicitly distinguishes a received request from verified arrival;
neither claim eligibility nor the verified 180-second clock changes.

Setup already uses bounded I/O. Its dedicated status now records pending, terminal
failure or timeout rather than leaving a pending label on transport failure.
Only the existing explicit setup flow may retry (three attempts / 45 seconds);
unknown raid outcomes are never retried. A slow/error response with polling and
subsequent explicit Setup recovery is defined in the onboarding browser probe.

All new tests are unrun by the source author. Parent QA, formatting, evidence and
any new private read-only zero-traffic preview remain required. No production
traffic change is part of this candidate. Static modules currently cache for one
hour: after an owner-authorized promotion, hard-reload the control/overlay pages
before checking the new UI; an old open tab is not proof of new runtime behavior.

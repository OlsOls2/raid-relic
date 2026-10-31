# 31 October follow-ups — local source candidate

The owner reported a successful olsols2 → olsols3 hand-off and Ring 12 at
11:12–11:15 UTC. This is an owner report, not source-author live execution.
Deployment verification belongs to the parent. At 11:19–11:20 UTC the parent
confirmed an approved `light` mark in the active actual holder session, while
the public Ring 12 arrival archive and Keeper archived glyph count were zero.
This confirms an archive-only view gap, not a missing stored mark. The source
author did not read production data or independently verify the live overlay.

Mark acknowledgements are transaction-derived: approved means public on the live
relic; pending means private until approval. Current-hold marks are not retroactive
edits to completed-stop archives. Keeper glyphs currently describe the latest
received ring's archived source marks; Atlas stop marks are also historical.
The candidate adds a distinct read-only current-hold projection to Atlas overview
and the current Keeper page. It requires the actual configured holder, matching
active open session, online/opted-in/unpaused/unbanned channel and approved,
unblocked marks. It exposes no author IDs or pending text and caps marks at 160.
Both stores derive it from consistent reads; GET performs no writes or provider
actions. Stop detail/arrival counts remain immutable. Current-hold marks enter
the next completed archive only through the existing verified hand-off path.
This candidate does not approve, migrate, reconstruct or rewrite marks or Ring 12.
Forget/block and inactive context remove the live projection on the next read.
Local both-store regression definitions cover privacy, holder changes and replay;
the browser probe checks actual Atlas/Keeper images and the existing WSS overlay
render, with archived and current glyphs counted separately.

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

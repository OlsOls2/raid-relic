# Raid Relic

One original relic, carried between Twitch communities and bound by two chats.

[Open the Atlas](https://raid-relic-760724762396.us-central1.run.app/atlas/) · [Recap](https://raid-relic-760724762396.us-central1.run.app/recap) · [Forge preview](https://raid-relic-760724762396.us-central1.run.app/forge)

## Try the journey

1. The owner connects the bot and both configured Keepers in their matching Twitch profiles, then reconciles each channel sequentially: [home control](https://raid-relic-760724762396.us-central1.run.app/control/1591805230), [second control](https://raid-relic-760724762396.us-central1.run.app/control/1591806023). Both streams must be live, opted in and ready.
2. Add each numeric OBS browser source: `/overlay/1591805230` and `/overlay/1591806023`, normally 1280×720. For a badge use 160×160 with `?corner=1`. Sound is muted by default; `?sound=1` also requires a trusted local gesture/browser permission.
3. A viewer writes `!mark moon`. Marks stay private until a moderator approves the actual private pending ID; never guess it. The budget is five per viewer per stream, with a 30-second cooldown.
4. Before Send Off, write an ordinary original message in the source chat to establish source-stream presence. Send Off opens a provisional 180-second voting window; complete the native Twitch raid. A newly verified landing then gives both chats a full 180 seconds. API acceptance alone never moves the relic or shows an arrival.
5. Use `!offer` in the source, or after redirect in the target if that same actor was seen in the source stream; a different actor uses `!accept` in the host. Twitch must confirm the raid and both thresholds must be met. New raids with 0–2 signed viewers need one per side; larger raids use capped square root. Legal early votes are kept; the landing deadline is fixed by receipt and duplicates never extend it. Neither clock is Twitch's countdown.
6. Refresh the Atlas after completion: one actual stop and ring, approved text search, and downloadable recap. Name entry alone proves nothing; `!relic mymarks` explicitly shares a short-lived link to that actor's surviving approved history in public chat.

[Owner workflow, recovery and safeguards](docs/LIVE_TEST.md) · [Under-three-minute demo](docs/DEMO_SCRIPT.md)

## Local judges demo

Node 22+: `npm ci`, then `npm run judges`. Open **http://127.0.0.1:5191/judges** and follow the simulated steps. No Twitch, cloud or model credentials are needed. All simulated pages are labelled; `/judges` is not deployed. Stop with Ctrl-C.

`npm test` runs the mocked unit/integration suite. Parent-run sandboxed browser scripts live in `scripts/browser-smoke-*.js`; they use fixed local port 5191, never real Twitch.

## Built with Codex

All original application code and documentation were authored in one original Codex session, `01a1705c-a87d-7143-80f6-021e47b78ced`; the parent reviews, commits and independently tests/deploys. Reviews caught second-versus-millisecond restart watermarks, lost 4xx raid diagnostics, and a defined-but-never-called chat sender. Screenshot review shaped the original crystal, readable rune orbit and receipt-seeking arrival.

Historical pre-P4 checkpoint: **485/485 host tests**, **16 browser workflows/61 checks**, plus the reviewed P3.1 GL/SVG demo. Current parent P4 proof: **493/493 host tests, zero skips**, the P4 browser gate and the GL/SVG cinematic demo passed; the parent viewed their seven private Simulator captures. Local fixtures do not prove physical OBS/audio or live Twitch. Grok reported the prior P3 Ols→Home test at 17:08–17:12 UK: Home held four rings and the claim ACK arrived. These P4 features are present locally; final refinements and the full browser matrix still need review before parent deployment. Consult deployment records for the runtime identity. [Factual Codex draft](docs/CODEX_USAGE.md) · [Session/evidence cutoff](CODEX_SESSION.md).

## Privacy and running costs

Cloud Run + Firestore, one holder, bounded transactional claims/history and read-only WebSocket overlays. Only approved retained content is public; forget/block/veto/opt-out purge retained associated content. Minimal bounded anti-abuse/idempotency hashes remain briefly; downloading a recap creates an unrecallable local snapshot.

Chronicle/Forge paid generation stays **OFF**; Forge is a preview, never an automatic live design. The standalone ban-reconciliation foundation remains **unwired**; current known-ban gates are not comprehensive channel-ban synchronization. No extra scopes are requested here.

Close idle OBS connections to contain usage. Budget alerts and free quotas are not a cost guarantee. P4 adds 12-hour rolling private sessions (five-minute renewal checks on authenticated activity), cached status lights and a local [Cinzel OFL font](docs/CINZEL_FONT.md), with original SVG fallback.

[Historical README, preserved verbatim before P4](docs/archive/README-pre-p4.md) · [Architecture/deployment](docs/DEPLOYMENT.md) · [Priority plan](docs/PRIORITY_PLAN.md)

102 local emergency review: incoming snapshots now omit old-holder destination copy; late eligible original claim commands receive a bounded closed-window reply without transfer. Existing confirmed/ended records are not revived or edited. Parent QA for this fix is pending; no new live validation is claimed.

## P5 branch preview (not canonical)

Keeper scores and original geometric badges derive only from retained completed stops. Initial home hold time and historical raider participation are unknown. Public raider names require separate original-chat `!relic scores on` consent before a counted vote; `!relic scores off` or `!relic forgetme` removes the entry. `!relic top` and `!relic badges` are local mocked additions, not enabled on canonical landing1025. Atlas scores refresh manually.

Any parent-deployed P5 tag must set `P5_PREVIEW_READ_ONLY=true`: OAuth, private controls, EventSub and every non-GET request are denied before effects. This tag shares storage and is not an isolated game stage. Canonical cbe88c3 remains frozen at100%; Grok reports its20:04–20:08 UTC Home→Ols physical roundtrip passed (holder Ols, five rings); this is not P5 physical validation. Parent baseline519/519,19 mock flows69 checks predates this unverified P5 increment. See [P5 rules and review](docs/P5_RULES.md).

P5 promotion is now owner-authorized **after parent QA**. The existing P5 tag stays read only. A new canonical revision must explicitly set `P5_PREVIEW_READ_ONLY=false` (or remove the preview flag), because the service template currently inherits `true`; never promote the read-only tag unchanged. Parent preserves origins, scopes, secret references and runtime caps. Local108 also adds two-chat completion notices, truthful missing-vote replies, larger decorative glyphs and a single three-second gold fusion hold. No retroactive messages for existing completed hops.

Parent21:25 diagnosis: canonical917dfcd/raid-relic-p5binding1025 serves five recorded rings over HTTP **and WSS with the exact canonical Origin**. The old9d read-only P5 tag serves Atlas/HTTP but its own tag Origin is intentionally rejected by the canonical-only WebSocket gate; it is not a native OBS source. Use [Home overlay](https://raid-relic-760724762396.us-central1.run.app/overlay/1591805230) or [Ols overlay](https://raid-relic-760724762396.us-central1.run.app/overlay/1591806023). No origin widening or callback changes are needed. Grok has not yet physically validated new P5 chat commands.

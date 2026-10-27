# PRIVATE DRAFT — for Olly/Grok to edit — not submitted

This owner-editable draft stays in the private repository. Nothing has been posted to Devpost or made public by this writing task.

## Inspiration

A raid usually lasts ten seconds. Raid Relic turns it into something two communities build together, then pass on. We wanted the receiving streamer to inherit more than a brief notification: a shared object with visible memories, community contributions and a reason to welcome the next hand-off. One relic travels through the configured pilot, rather than giving every channel a disconnected collectible.

## What it does

Viewers contribute approved words or emoji, represented by original procedural runes. A completed hand-off adds a growth ring and a retained journey stop. A Twitch API request being accepted does not move the relic: a signed raid receipt and distinct eligible participants from both chats must complete the binding. Chat participation is not proof of actual raid membership. The app's 180-second claim window is not synchronized with Twitch's native countdown.

Keepers explicitly opt in. Seekers are suggested first, while other ready, eligible configured Keepers remain selectable. Receiving the relic removes the recipient from the queue; holders cannot seek, and former holders must deliberately rejoin after passing. Status explains observed membership and rank without joining. The pilot currently has three configured channels, with a bounded two-to-four-channel setup, not unrestricted onboarding.

The Atlas shows retained journeys, current-holder observations and Keeper pages. Expanded review-preview cards add approved engravings, hop counts and journey context, distinguishing the Keeper at a recorded stop from the current holder at export. Fresh public reads cancel changed exports; saved downloads cannot be recalled. Moderator veto, block, opt-out and self-forget protect retained content. Private held words and viewer identifiers are excluded from public cards.

## How we built it

The application uses Node.js 22+, Cloud Run and Firestore. Transactions keep claims, ownership and history consistent. Signed EventSub **webhooks** use raw-body HMAC checks, replay protection and deduplication. The reconnecting WebSocket is the read-only OBS/browser feed, not an upstream EventSub connection. Streamers use a normal OBS Browser Source; viewers need no companion application.

The relic combines original WebGL geometry with readable SVG fallback and reduced-motion support. Three.js remains credited MIT software; the self-hosted Cinzel font has its OFL licence. Cards are client-side canvas PNGs, without a rendering server. These increments add no paid service, dependency or recurring infrastructure. Existing scale-to-zero hosting and registry allowances are not a guarantee of a zero bill. Paid Chronicle and automatic clipping remain OFF; clipping is design-only pending separate consent and implementation.

## How we used Codex

Code, tests, procedural assets and documentation were authored in the original CLI session **01a1705c-a87d-7143-80f6-021e47b78ced**, through small, reviewable increments without delegated or forked authoring agents. Owner feedback shaped the product; the operator independently ran native Node/Chromium tests, inspected images, managed Git/CI and performed guarded releases. The source-authoring agent did not access credentials, operate live Twitch controls or deploy cloud resources.

The [session record](../CODEX_SESSION.md) and [Codex usage account](CODEX_USAGE.md) describe the selected sanitized evidence. The machine manifest records its cutoff and omissions; five whole entries were omitted during secondary privacy scanning. It is not a complete unredacted conversation, and raw JSONL logs are not committed. We do not infer human-visible delivery from a mock provider's acceptance.

## Challenges

The hardest boundary was acceptance versus arrival: a timeout or ambiguous Raid POST must never cause an automatic repeat. Token expiry needed per-role singleflight, distributed leases, rereads and atomic encrypted-pair rotation. Ordinary expiry can renew before use; transient 429/503 failures are temporary, while definitive refresh rejection requires reconnecting. A dropped overlay must resume the existing clock and votes instead of replaying a fresh arrival.

Privacy also extends into exports: an engraving removed during rendering must not escape into a stale download. Mobile controls needed genuine wrapping at 320px, not clipped content. Persistent-runtime reconstruction tests were kept separate from platform cold-start evidence.

## Accomplishments

The operator's reliability cohort passed **859/859 native tests, zero skips, and 41 serial browser workflows / 128 checks**. These are synthetic/runtime/browser results, not physical Twitch or OBS certification. The [quality record](QUALITY.md) preserves the dated evidence; [reliability notes](RELIABILITY_DEMO.md) explain its layers.

An operator-correlated AUTOSCALING record established one min-zero cold start on the older `judge-ready` preview: a 2223ms health request, followed by a 117ms request. That is one observation, not p95, an SLA or a cold test of the new revision. Separately, the owner reported a real Ring 10 / Streak 3 hand-off on 26 October; the source author did not observe it.

## What's next

The owner can record the permanently labelled 150-second [simulated film](https://demo-film---raid-relic-vz4bhnskgq-uc.a.run.app/demo/film), review the first-run checklist and reliability previews, then add separately identified real Twitch footage. New cards, film and checklist remain review-preview features until owner-approved promotion; this queue preserved production runtime `3dbae6f`.

Next decisions include consented pilot expansion, physical OBS/platform checks and private accessibility feedback. Unconfigured streamers still need owner admission, human Twitch consent and OBS installation. Optional clipping and fuller ban reconciliation require later explicit permission/design review. Wander remains OFF and its scheduler commented pending explicit owner GO. No draft text authorizes activation. Feature freeze remains 31 October 2026, 18:00 UK/UTC.

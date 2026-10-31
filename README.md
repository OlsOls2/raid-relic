# Raid Relic

Raids that leave a story. A living relic passes between consenting Keeper streams; a verified raid and both eligible chats must claim it before a hand-off adds a ring.

[Open public production](https://raid-relic-760724762396.us-central1.run.app): **no login required for public content** for Atlas, Keeper public pages, overlay or the demos. No owner contact is required. Public content browsing is read-only; **production is not globally read-only**. Keeper control requires Twitch sign-in as one of the owner-admitted creator channels raidrelichq, olsols2 or olsols3; arbitrary judges do not gain controls. Public access implies no consent, live setup or raid authority; do not trigger Twitch actions. Privacy was prelaunch timing, not a judge restriction.

## Try it in under five minutes

Allow 30 seconds to open the public site, then spend about one minute on each route:

1. [Atlas](https://raid-relic-760724762396.us-central1.run.app/atlas/): find Ring 12 and open its retained approved light.
2. [Keeper olsols3](https://raid-relic-760724762396.us-central1.run.app/keeper/olsols3): inspect the retained glyphs and observed holder/stream status.
3. [Read-only overlay](https://raid-relic-760724762396.us-central1.run.app/overlay/1593561134): inspect the retained marks, including offline presentation.

The overlay's numeric route shape is defined in `src/app.js`; olsols3's operator-supplied ID is 1593561134. Earlier parent proof verified one approved light on Ring 12, exactly once in detail, with Keeper glyphs and overlay marks present after stream closure. Retained approved marks stay on their creation ring/hold after offline, subject to privacy removals. This does not guarantee a stream is currently live. See the [judge quickstart](docs/JUDGES_QUICKSTART.md).

The separate [45-second judge cut](https://raid-relic-760724762396.us-central1.run.app/demo/judge), [150-second film](https://raid-relic-760724762396.us-central1.run.app/demo/film?autoplay=1&kiosk=1) and [35-second interactive demo](https://raid-relic-760724762396.us-central1.run.app/demo/) are labelled fiction, not real arrivals or live proof.

![Neutral original compass and violet-crystal artwork; not a screenshot or live proof](public/relic.svg)
*Original procedural/vector art, not a live view, screenshot or verification result.*

## Proof and boundaries

Earlier15:43 runtime2b218b proof and offline Ring12light verification remain historical and separately scoped, not new observations of the current site. This documentation commit is not a new runtime/image. See [provenance](docs/PROVENANCE.md) and [generated quality](docs/QUALITY.md).

API acceptance is not arrival. The app's 180-second claim window requires verified receipt and distinct eligible nonbot participants on both sides; chat location does not prove raid membership. Only approved text is public. Forgetting removes retained content without refunding quota; saved downloads cannot be recalled. This configured creator-channel pilot is not open public signup or evidence of community adoption.

## Build and read more

Node.js 22+, Cloud Run, Firestore, signed EventSub webhooks and a read-only WebSocket feed support the app. Original procedural WebGL/SVG visuals have reduced-motion support. Local setup: `npm ci && npm test`, then `npm run judges` for the labelled offline fixture.

[Project guide](docs/PROJECT_GUIDE.md) · [Architecture](ARCHITECTURE.md) · [Privacy](docs/PRIVACY.md) · [Built with Codex and prompt/code/test examples](docs/DEVPOST_DRAFT.md) · [Actual session roles](docs/CODEX_SESSIONS.md) · [Built with Codex](BUILT_WITH_CODEX.md) · [2:45 recording plan](docs/DEMO_SCRIPT.md) · [Historical provenance](docs/PROVENANCE.md)

Parent completed G3.05 whole-plate checks and G4.04 recorded cold navigation; [scoped facts](docs/PANEL_STATUS.md), not a claimed speedup. Physical OBS, manual assistive technology and native OS sharing remain unproved. Compaction G6.07 is not authorized here. Paid AI is off; clipping is design-only and unwired. Scale-to-zero is not a zero-invoice guarantee. No production promotion is implied.

Unofficial fan project. Not affiliated with Twitch. Original visuals are not screenshots or live proof. [MIT licence](LICENSE) · [Third-party MIT/OFL notices](THIRD_PARTY_NOTICES.md).

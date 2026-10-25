# Frozen Shoulds tagged preview — parent-reported handoff

These are parent-verified facts, recorded without Codex cloud/provider calls or credential reads. **Main and BOTH revisions are now frozen until owner tests.** The previous freeze exception authorized only the parent's already completed Shoulds tagged deployment. It does not authorize further builds, deployment, promotion, consent, subscription bootstrap or Send Off by Codex. New work is only `feature/raid-relic-coulds`, original saved thread; Could #1 recap is not merged or deployed. No Forge, fade or resonance is included.

| Item | Parent-verified value |
| --- | --- |
| Merged green main / preview source | `072317a2f127fc3a67137812ba9b762fe1f34ead` (261/261 host tests) |
| Build identifier supplied by parent | `c40be500` |
| Immutable image digest | `sha256:69a3dc185158c35cf8d4a23a413ecf5432ad86c1d3643d536f5a33f98437bfa1` |
| Tagged revision | `raid-relic-00004-kul`, tag `shoulds`, no normal traffic |
| Tagged origin | https://shoulds---raid-relic-vz4bhnskgq-uc.a.run.app |
| Canonical live revision / traffic | `raid-relic-00003-kwp`,100%; source `fd05a5ee67f841b1ac92ebb221581db227d2353f` |
| Canonical origin | https://raid-relic-760724762396.us-central1.run.app |
| Preview scaling / resources | min0/max1; existing secret references and resources preserved |
| Paid Chronicle gates | `CHRONICLE_ENABLED=false`, `CHRONICLE_ALLOW_PAID=false` |

Parent verified tagged health matches0723,15 public assets byte-match, read-only search and protected401 boundaries, both initial WebSocket snapshots in live mode waiting, and judges404/excluded. Canonical live health still identifiesfd05. No actual OAuth consent, Twitch or model calls were performed; waiting cloud snapshots are not proof of Twitch delivery or live raid validation. Neither revision contains Could #1. Historical Shoulds-freeze descriptions in older notes predate this completed tagged deployment.

## Shared database — NOT isolated staging

The tag **shares live Firestore, OAuth token/state and control-session rows**. Reauthorizing can rotate live browser controls. Dual bootstrap/Send Off can conflict. Each revision has independent in-process fanout: a write through one does not automatically publish to WebSockets connected to the other. No isolated staging database or cross-revision fanout was added. Never treat this tag as a safe place to seed/reset real data; the local judges Simulator is the isolated-memory path.

The parent configured tagged `OVERLAY_ORIGIN`, `OAUTH_REDIRECT_URI`, `OAUTH_REDIRECT_ALLOWLIST` and `EVENTSUB_CALLBACK_URL` against the tag origin, with exact `/auth/callback` and `/eventsub` paths. The owner has been warned to register the additional tagged callback and avoid concurrent bootstrap/Send Off across origins. Codex must not register it or run consent/bootstrap/raids. Even scale-to-zero/tagged0% is not a no-cost guarantee; active WebSockets/requests can incur usage. Close idle browser/OBS sources.

## Owner/parent checklist — no automatic testing

- Keep main, canonical100% and tagged0% frozen until the owner coordinates actual tests. Check the existing parent proof above; this document does not start requests.
- Before any owner consent, confirm exact tagged callback registration and the intended account/browser profile. Coordinate shared control-session/token effects with canonical users.
- Use only one origin for bootstrap/Send Off at a time. Account for external-write fanout limitations; manually reconnect/refresh the other origin rather than assuming its state is current.
- Keep both Chronicle gates off. A future paid mode would need separate prior owner approval plus both gates and a key binding; no key or current price is asserted here.
- **Before any future promotion**, the parent must restore canonical origin settings from the saved **pre-tag configuration metadata**: `OVERLAY_ORIGIN`, `OAUTH_REDIRECT_URI`, the exact `OAUTH_REDIRECT_ALLOWLIST` and `EVENTSUB_CALLBACK_URL`. Expected canonical paths remain `/auth/callback` and `/eventsub`; do not copy tag-origin values into canonical traffic. Preserve all other saved secret references/resources and review state/schema compatibility. This is a future review requirement, not promotion authorization.
- Review Could #1 separately on its feature branch. SVG/PNG files are local snapshots; old downloads cannot be recalled after privacy removal. Do not claim it is present on either frozen revision.

The frozen actual-owner guide remains [LIVE_TEST.md](LIVE_TEST.md). Local judges setup is [JUDGES_QUICKSTART.md](JUDGES_QUICKSTART.md). No cloud configuration was written by Codex.

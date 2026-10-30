# P8 — one relic, time-boxed cosmetic editions

## Current delivery — 26 October 2026, 02:20 UTC

Parent-reported state; Codex did not query cloud or run these host/live checks.

| Surface | Revision / source | Delivery |
| --- | --- | --- |
| Canonical | `raid-relic-judgefix1026` / `6401dcb52e20a954f6bda9fc7403f21a0f05c646` | 100%; P7 five gates ON, pin300; paid OFF. Includes P1–P7 and judge fixes, **not P8 or its inline canvas fallback fix**. |
| P8 preview | `raid-relic-p8edition1026` / `41f446dbe63d144b0501b9bc01cc732154e9353c` | 0%; `P5_PREVIEW_READ_ONLY=true`, P7 five gates OFF. Published for manual acceptance, not promoted. |

Parent reports both health endpoints200 at02:20,49 served-response SHA matches, three OAuth document metadata timestamps unchanged (zero fields read), **644/644 tests, zero skips;25 local browser workflows/87 checks**. Three labelled Simulator captures were viewed: one GPU core/eight facets/64 arrival dust points, plus decoded colored and unoccluded SVG after context loss, reduced390/no-WebGL/corner160 and BASE date boundaries. These are parent QA results, not assistant-run physical Twitch validation.

[P8 demo](https://p8-edition---raid-relic-vz4bhnskgq-uc.a.run.app/demo/) · [P8 Atlas](https://p8-edition---raid-relic-vz4bhnskgq-uc.a.run.app/atlas/) · [canonical demo](https://raid-relic-760724762396.us-central1.run.app/demo/) · [canonical Atlas](https://raid-relic-760724762396.us-central1.run.app/atlas/). Real J1/P7 raid/chat use remains canonical and owner-operated. Preview self-origin WSS403 is intentional; HTTP preview is not an OBS streaming test and origins must not be widened.

**Remaining external gates:** Grok/Olly P8 manual acceptance and separate promotion authorization; owner-run J1/P7 live action test remains pending. P8 implementation is complete for this preview: one relic, cosmetic palette/geometry/particles and evidence-derived edition badge,23October–30November inclusive (end-exclusive1DecemberUTC), distinct from the retained 13November08:00Z–16November08:00Z event-days badge window. P9 remains retained but undefined. Freeze31October18:00UK/UTC. A docs commit does not change either deployed `RELEASE_COMMIT`; no rebuild/redeploy follows from this update.

## Configuration and visible treatment

`public/editions.js` contains frozen version1 `EDITION_CONFIG`. Each entry has exactly `version,id,name,badgeLabel,startsAt,endsAt,design,particles`. UTC dates are strict, start inclusive/end exclusive. Designs use the existing closed Forge-compatible fields; particle kind is `none` or `orbit-dust`, max96. Duplicates, overlap, unknown fields, invalid dates/colors/geometry/capacity or invalid clocks fail closed to BASE. No remote JSON, writable settings, query overrides, resolver or network import.

First edition: **Season One · Autumn 2026**, `season-one-autumn-2026`, **2026-10-23T00:00:00Z ≤ now < 2026-12-01T00:00:00Z**. Original eight-facet crystal, aspect1.05, silver/violet/gold accents and64 small procedural dust points in one draw call during verified arrival only. These are decorative, never approved runes, viewers or rings. Idle/hidden/reduced/context-loss paths draw no dust. Existing DPR1,30fps idle/60fps full arrival/30fps corner,16 visual bands/160 approved sprite cap and <20k triangle budget remain. Geometry/particles rebuild only when edition ID changes; old resources are disposed. Explicit local Forge design previews retain their own designs.

Live overlay, Atlas aggregate hero, fictional demo and recorded replay mini use the shared cosmetic selection. SVG/reduced/no-WebGL fallback uses an original faceted procedural SVG with edition palette and a cosmetic label; no particles. Corner uses the visual treatment and accessible title, hiding the extra label to preserve160×160 ritual/caption rows. BASE returns after the end. No new timer, socket, polling, database mutation, relic ID, holder, lineage, season reset, quota or claim authority exists. Date selection cannot transfer ownership. This is independent original art, not an official Twitch asset or affiliation claim.

## Evidence badge is separate from active cosmetics

`Carried during Season One Autumn 2026` is derived on read from retained completed claim/known hold evidence overlapping the edition window. A proven first outgoing instant may support the source badge; its unmeasured initial duration stays unknown. Completed intervals are half-open; an ongoing known hold can earn at exact start. Zero history earns no edition badge. Retained evidence may still support a badge after cosmetics end; deleting personal content does not invent/remove channel transfer evidence. Raider opt-in/erasure and no private numeric identities remain unchanged.

The existing **Event-days badge · 13–15 Nov** badge retains its **13November08:00Z–16November08:00Z** evidence window; J1 replaces its label and removes the external brand citation. An October cosmetic edition badge does not prove conference attendance or personal participation.

## Published zero-traffic preview

The parent-published preview/source and QA above supersede the earlier intended/unverified statements. Inspect [demo](https://p8-edition---raid-relic-vz4bhnskgq-uc.a.run.app/demo/), [Atlas](https://p8-edition---raid-relic-vz4bhnskgq-uc.a.run.app/atlas/) and [transparent recorded replay](https://p8-edition---raid-relic-vz4bhnskgq-uc.a.run.app/atlas/embed). The demo remains permanently simulated, with fictional identities/zero initial rings and no API/Twitch connection. Atlas reads retained evidence; it does not seed history.

Canonical6401 stays100%; P8 acceptance/promotion is pending. Preview WSS self-origin403 is intentional under the canonical-only origin policy; do not broaden origins or treat the preview as live OBS proof.

Parent commands: `node --test`, `npm run release:files`, syntax/diff gates, existing24 browser flows plus `node scripts/browser-smoke-editions.js`. Optional `P8_CAPTURE=1` writes only `edition-overlay.png`, `edition-mobile.png`, `edition-atlas.png`, viewport-bounded≤512KiB, visibly Simulator. Parent has viewed the three captures recorded above; these are parent-run local Simulator results, not source-author host/physical proof. Existing sandbox/resource/security limits remain.

J5 is already installed by parent:09:00UTC daily, one attempt/day, pinned reviewed24f29c0 code, read-only first probe OK, expiry3November00:00UTC; watchdog unchanged. P8 does not modify ops files or the job. J6 parent completed the immutable judging-baseline pins and one approved cleanup (12 inactive untagged revisions/11 unreferenced images); all tagged/current/rollback/recent-five protected. Automatic registry policy remains dry-run; no final-v1 claim. P9 remains retained but undefined. Freeze31October2026,18:00UK/UTC.

**Historical review131 (resolved):** fallback art is now deterministic **same-origin `/edition-crystal/<configured-id>.svg`**, generated from the validated palette/facet/aspect/shape configuration before OAuth/store access, with explicit SVG dimensions. No CSP/connect/origin policy is broadened. The first screenshot's missing image is a confirmed visual failure; its exact decode/CSP cause was not proven by source inspection. The browser gate now requires successful `decode()`, positive natural dimensions and actual colored alpha pixels after real context loss, reduced motion, forced no-WebGL and BASE restoration, rather than an element box/src alone. This historical review gap is resolved by the parent QA recorded above.

Window labels derive from each configured UTC interval (exclusive end minus1ms for the displayed last day). `badgeLabel` is closed/validated and unique per configured event; interval helpers return the actual matching labels, so a future distinct event cannot inherit another season’s text/dates. The event-days badge remains unchanged. The compatibility `EDITION_BADGE` names only the first edition.

**Historical diagnostic135 (resolved):** parent established the white fallback rectangle: the lost canvas retained vendor inline `display:block` despite `hidden=true`, computed display remained visible and its box stayed280px. Renderer initialization/fallback now explicitly set inline display:none; only a successful eligible frame restores block. Parent subsequently verified unoccluded decoded fallback pixels and viewed good captures; no CSP/origin change or test-side hiding is used.

Combined candidate138 keeps edition IDs/evidence rules stable, adding an explicit unofficial/non-affiliation disclaimer next to edition labels and earned edition badges. Atlas shows the cosmetic label once beneath the hero; embedded replay retains its own accessible context. Stop lists use the native ordered-list number once. No new delivery/test result is claimed; parent review/combined0% preview and P7 log findings are pending. Production6401 and old preview41f stay unchanged.

## 30 October J1 presentation update

Current source uses **Season One · Autumn 2026**, neutral sigil route `/edition-crystal/season-one-autumn-2026.svg`, and footer **Unofficial fan project. Not affiliated with Twitch.** Historical dates, completed-hop/hold evidence, original geometry and rendering/resource guards are preserved. Names in this document are normalized to the current neutral presentation; earlier deployed previews and dated screenshots remain historical and are not rewritten. This local source increment awaits parent native QA and a new zero-traffic preview; production promotion is not authorized.

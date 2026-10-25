# Three.js vendor provenance and P2 bounds

Parent independently fetched and byte-compared all three files, and verified the MIT licence. Version is fixed at **0.186.0 / revision186**; Codex did not fetch them or independently verify the remote source.

| Local file | Parent source URL | SHA-256 |
| --- | --- | --- |
| public/vendor/three.module.js | https://unpkg.com/three@0.186.0/build/three.module.js | 9052042d676cb0fdc1ddfefe193053f34b7ac0513a616fdac4535d49987812ea |
| public/vendor/three.core.js | https://unpkg.com/three@0.186.0/build/three.core.js | 9edde002b066a9a05676a6127f67735b62baf399bdea529f2f7e31657da769e6 |
| public/vendor/LICENSE-three.txt | https://unpkg.com/three@0.186.0/LICENSE | 8b378ebe60e2fe500158cb0ac71cb5e8b7d92953c2abcc63a0eb90499653b5bc |

The renderer shows at most **16 ring bands and16 tilted orbits**. For larger totals, the overlay states the actual completed count and explicitly says16 visual bands are shown. This is a rendering cap, not archive truncation. Up to160 approved rune sprites, at most144 core-plus-rim triangles and12,288 torus triangles keep geometry below20,000 triangles; corner geometry is smaller. Pixel ratio is1, rendering30fps idle/corner and60fps only during verified target arrival; hidden/null-state views stop rendering. Reduced motion, unavailable WebGL/import, context loss and teardown preserve SVG fallback.

Forge's explicit **Preview this design in3D locally** button uses the validated current template facets/aspect/palette. It creates only local GPU resources: no live settings, authentication changes, storage or automatic application. Its optional dynamic renderer import cannot prevent2D template generation/downloads. Clear/edit/pagehide abort pending preview creation and dispose resources.

Parent's initial snapshot omitted docs/DEMO_SCRIPT.md, causing a harness failure rather than an application failure. Latest P2 review changes require fresh independent unit/browser QA; no new pass is asserted here.

Parent local QA command: `node scripts/browser-smoke-relic3d.js`. Optional `P2_CAPTURE=1` retains two labelled Simulator viewport PNGs in ignored artifacts/; screenshots are not produced or claimed by default. Run only inside the approved networkless bounded Chromium-sandbox workflow, fixed loopback5191. These captures are not physical OBS or live Twitch proof.

The headless visibility check explicitly injects a configurable document.hidden getter and dispatches visibilitychange, restoring the original own-property descriptor in finally. It verifies renderer pause/resume under injected visibility; it does not prove physical OS tab hiding. Unit coverage independently exercises hidden state. The gate checks accepted-only target state at30fps before the mock verified raid enables60fps. Optional full captures wait for the approved view to settle; corner captures retain160×160 bounds.

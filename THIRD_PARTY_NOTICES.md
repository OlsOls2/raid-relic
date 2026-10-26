# Third-party notices

The project source is licensed under the root [MIT licence](LICENSE). This does not replace the separate notices below. No vendor/font bytes or licence texts were changed by readiness149.

| Bundled component | Version / provenance | Full bundled licence |
| --- | --- | --- |
| Three.js (`public/vendor/three.module.js`, `three.core.js`) | npm Three0.186.0 / source `REVISION = '186'`; parent-reviewed unpkg files, URLs and SHA-256 in [vendor provenance](docs/THREE_VENDOR.md) | [MIT, copyright2010–2026 Three.js authors](public/vendor/LICENSE-three.txt) |
| Cinzel variable display font (`public/fonts/Cinzel.ttf`) | TTF name table: Cinzel / Cinzel Regular, Version2.000. Google Fonts pinned commit `3dd78844021e948ceb633d1dcee3f7885561b5d9`; source URLs/SHA-256 in [font provenance](docs/CINZEL_FONT.md) | [SIL Open Font License1.1, copyright2020 Cinzel Project Authors](public/fonts/OFL-Cinzel.txt) |

The full copyright/permission/disclaimer texts remain bundled; neither component implies author endorsement. The font remains OFL, not relicensed as project MIT. Original crystal/rune/favicon geometry is repository-authored, not a Twitch logo or third-party model. Cosmetic edition fan disclaimers remain visible.

Runtime npm dependencies are declared in package.json and locked in package-lock.json, not copied into `public/vendor`: `@google-cloud/firestore` and `ws`. Their package licences travel with installed dependencies. Parent fresh dependency/security auditing remains a release gate; this notice is not a claim of a newly executed npm audit or history scan.

# Try Raid Relic without a Twitch login

Open the [45-second whole-loop sandbox](https://judge-sandbox---raid-relic-vz4bhnskgq-uc.a.run.app/demo/judge). This is a zero-traffic read-only review preview, separate from canonical production. It requires no Twitch account, OBS installation, consent or control-page action.

## Three distinct review layers

1. **45-second presentation:** Send Off, original arrival, a provisional source offer, distinct host accept, approved sample engraving, simulated live-holder spotlight, retained journey/replay, and a card preview. It reuses the recording film's eight scenes at a faster presentation pace. The sample Keepers are `demo_keeper_a` and `demo_keeper_b`. There is no connection to Twitch and no application API, socket, persistent storage or real game effect. The story creates exactly one fictional ring. Optional export requires your click and is permanently watermarked simulated.
2. **150-second recording film:** [Open `/demo/film`](https://demo-film---raid-relic-vz4bhnskgq-uc.a.run.app/demo/film) for the original slower recording pace. Pause, next, restart and seek remain available. Space and Right Arrow act only when focus is on the page, leaving native controls alone. Hidden tabs freeze the clock; reduced motion preserves readable SVG and text. Forty-five seconds is the presentation target on a normally rendering visible page, not a hardware timing guarantee.
3. **Actual runtime fixture verification:** The signed mock OAuth/EventSub/transaction/WebSocket workflows test application authority separately from this fictional presentation. Their results are synthetic local evidence, not physical Twitch/OBS proof. The dedicated [headless runtime journey](CI_JOURNEY.md) passed all three hosted checks after the unit job in [run 40516037721](https://github.com/OlsOls2/raid-relic/actions/runs/40516037721), at runtime `57f005dc07ea5ec9540bbcbdd39f69d57f761cf1`. The parent reports the accepted native application cohort as 913/913 tests, zero skips, and 44 serial workflows / 137 checks. Use the dated [quality record](QUALITY.md) for operator-generated cohorts.

The [35-second interactive demo](https://raid-relic-760724762396.us-central1.run.app/demo/) remains a separate hands-on option. The [public Atlas](https://raid-relic-760724762396.us-central1.run.app/atlas/) is the retained real public record, not the sandbox's invented journey. Platform acceptance is not proof of audience arrival; chat location is not proof of raid membership. No automated review here operates a real stream, chat, OAuth consent or Send Off.

## Screenshot provenance

The new README images are `docs/media/demo-film-story.png` and `docs/media/demo-film-card.png`. The parent operator captured, actually viewed and promoted both PNGs from the source233 native workflow (two checks passed in 35.903 seconds). That focused capture result is separate from the later accepted application cohort above. They come from the actual local `/demo/film` renderer, paused through the visible film controls at story positions 80,000 and 135,000 milliseconds. They are 1280×720 viewport captures, not whole-page coverage, live streams or exported production cards. The preview contains only sample names, the approved sample word moon, original runes and a fictional retained hop.

Run the optional capture in the existing offline native sandbox:

```sh
README_CAPTURE=1 node scripts/browser-smoke-judge.js
```

It writes only `artifacts/readme-film-story.png` and `artifacts/readme-film-card.png` plus the closed judge result. Each PNG is limited to 512 KiB, each raster is below 4 MiB, and aggregate captures remain below 4 MiB. The operator completed trusted no-follow, single-link regular-file promotion, PNG signature/dimension checks and actual image review for these captures. No image is generated, reconstructed from memory or substituted for native output. The story PNG is 162,989 bytes and the card PNG is 104,131 bytes (267,120 bytes combined). These are native fixture screenshots, not source-generated images.

## Boundaries

The exact `/demo/judge` GET route shares the film HTML and static module graph under `connect-src 'none'`; POST remains denied. Query parameters do not choose a provider, role, dataset or pace. The 150-second film's default route and fixtures are unchanged. Card export remains local, original art with SVG fallback; there is no paid rendering service, new dependency, scheduler or scope. Native tests use a controlled presentation clock for bounded deterministic scene checks and actual rendered pixels. This does not turn their test elapsed time into a physical stopwatch or soak measurement.

The independent operator-owned [active-use overlay soak](ACCESSIBILITY_PERFORMANCE.md) completed 7,201,700 ms of real observation on 27 October at 14:35:04.842 UTC, excluding warm-up. It used explicit trusted synthetic input and passed declared resource bounds; it is not physical OBS or unattended-use proof. The source author did not inspect private proof files. Repository visibility, judge access and any future production promotion remain owner decisions. This is not a Devpost submission or permission to activate Wander, clips or paid features. Required Twitch/TwitchCon fan disclaimers and third-party library/font legal attributions remain intact. The bounded README/film review found original procedural artwork and required platform references, not a basis for claims about every historical asset.

## Completed review increments

Parent-reported closeout, 27 October 2026 after 14:35 UTC:

| Increment | Runtime commit | Zero-traffic review tag |
| --- | --- | --- |
| Scoped security hardening | `7ec622148d6eb3a78d2bdd24ed6c9ddcaca4bdfd` | [safety0](https://safety---raid-relic-vz4bhnskgq-uc.a.run.app) |
| Accessibility/performance implementation | `001d0616c24b9178d231759b9c7cd71b8a75575a` | [accessible-perf0](https://accessible-perf---raid-relic-vz4bhnskgq-uc.a.run.app) |
| No-login judge presentation | `f18a503b9f016fd0f3e6eebdd84f5e4981751554` | [judge-sandbox0](https://judge-sandbox---raid-relic-vz4bhnskgq-uc.a.run.app/demo/judge) |
| Full runtime journey CI | `57f005dc07ea5ec9540bbcbdd39f69d57f761cf1` | [journey-ci0](https://journey-ci---raid-relic-vz4bhnskgq-uc.a.run.app) |

All four requested automated increments are complete, including the real two-hour active-use observation and hosted journey gate. Security coverage remains [scoped and qualified](SECURITY.md), not universal penetration-test clearance; bounded OAuth allocation does not delete legacy orphan records. Physical Twitch/OBS and assistive-technology signoff remain owner-operated review layers.

These publications did not promote production. At the parent's later staging observation, production was externally changed to `raid-relic-eventsub-fix-on-1027` at 100%, release `d2ae612945a40bee51a3c879d94bcf68cf8f9fc8`, created at 13:15:14.573404 UTC. This run did not create or promote that revision; the acting principal and approval are not established here. No rollback or permission is inferred. The journey review remains master read-only, with all five P7 gates off, Seekers on and Wander/clipping/paid features off. Later documentation changes preserve deployed runtime `57f005d` rather than relabelling it as the docs commit.

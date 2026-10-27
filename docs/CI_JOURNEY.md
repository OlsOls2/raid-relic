# Headless runtime journey gate

The `journey` job in `.github/workflows/ci.yml` follows the existing Node 22 unit/format/evidence job. It selects the standard Ubuntu 22.04 runner with a pinned, non-setuid bubblewrap 0.9.0 build; the completed hosted run verified namespace availability for this configuration. The unit job remains on Ubuntu latest. Toolchain setup installs pinned `playwright-core` 1.58.2 and its Chromium build before the test boundary. The dependency is development-only; production images still install with `--omit=dev --ignore-scripts` and exclude test scripts, browsers and fixtures.

`node scripts/ci-journey.js` launches only `scripts/browser-smoke-journey-ci.js` through bubblewrap/prlimit: empty allowlisted child environment, separate user/PID/network namespaces, loopback-only synthetic TLS/WSS, read-only source/toolchain, writable temporary storage and one artifact directory. The launcher exposes no host home, credentials, provider settings or cloud authentication. It declares a 120-second CPU limit, 1 GiB per-process data limit, 256 MiB Node heap, 512-process limit, 2,048 descriptors, 16 MiB file limit, 512 MiB temporary filesystem and 180-second wall watchdog. These are local test budgets, not application or production limits or an aggregate RSS measurement. Chromium sandboxing stays enabled; unavailable namespace/browser support fails the job rather than skipping or falling back to no-sandbox.

The native operator can run the same browser workflow directly inside the existing approved offline harness:

```sh
node scripts/browser-smoke-journey-ci.js
```

The test uses the real runtime with fake Firestore, mock OAuth/Helix transport and signed local EventSub deliveries. Its configured fixture identities are synthetic uses of the pilot constants, not real logins or live operations. It crosses these boundaries:

1. Mock provider identity validation issues an own Keeper session. The actual local control UI selects a ready recipient and submits its normal Origin/CSRF-protected Send Off. Exactly one source-principal-bound mock Raid POST is accepted; holder and ring count remain unchanged.
2. A verified HMAC raid delivery opens the actual arrival/WSS projection and original GL pixels. Distinct original source/host chat actors reach the real quorum. Exactly one ring, target holder and completion receipt per room commit; repeated chat does not cause a second ring or Raid POST.
3. A source engraving is explicitly approved before transfer and is present in the public retained stop; held sample text is absent. The actual Keeper spotlight/public DTO, Atlas replay controls and manual PNG download are exercised. The PNG signature/dimensions, decoded nonempty pixels, approved-word drawing and simulator label are checked; held text must not be drawn.

The report is closed JSON, capped at 64 KiB, with stage, check results and numerical diagnostics. No screenshots, raw DOM, cookies, tokens, provider bodies or actual mark-owner IDs are uploaded. The CI launcher reads one regular, single-link, no-follow bounded result after the isolated process exits and emits only a closed summary. Missing/malformed reports, absent browsers and failures are fatal. No external runtime network is permitted; browser request interception is an additional control, not the OS boundary.

The launcher uses the caller's verified nonroot UID/GID rather than assuming 1000, preserving the unprivileged user-namespace identity mapping on runners with another numeric identity. Root callers are refused. Startup failures emit only closed `preflightStage`, `childExitCode`, `childSignal`, `errorCode` and `stderrCategory` fields. Child output is bounded to 64 KiB and never printed; stderr is classified as permission denial, namespace unavailability, missing mount/module, missing toolchain, invalid option/argument, unclassified or empty. These categories identify a diagnostic lead, not proof of its root cause. No unsandboxed or privileged target fallback is provided.

## Verified hosted and native results

On 27 October 2026, the parent reported [CI run 40516037721](https://github.com/OlsOls2/raid-relic/actions/runs/40516037721) successful for **both unit and journey jobs** at exact commit **`57f005dc07ea5ec9540bbcbdd39f69d57f761cf1`**. The hosted journey emitted `passed=true`, three checks, stage `spotlight-replay-export`, child exit zero, and trusted bootstrap `launch / OK`. Identity, separate user/PID/network namespaces, loopback-only networking, read-only mounts and writable scratch checks passed before application execution. The final gate required all three actual journey checks, not merely bootstrap success.

The accepted native application cohort is **913/913 tests, zero skips, and 44 serial browser workflows / 137 checks**. The journey additionally passed three consecutive focused runs. Its own-control POST proof reads a bounded clone of the actual browser response and waits for the normal status refresh; no fake response or Send Off retry is used. Application, test-support and browser-workflow hashes remained unchanged through subsequent CI-only portability corrections. These results are parent-operated, not source-author execution.

The operator published [journey-ci0](https://journey-ci---raid-relic-vz4bhnskgq-uc.a.run.app) as `raid-relic-journey-ci-1027`, runtime `57f005dc07ea5ec9540bbcbdd39f69d57f761cf1`, at zero traffic. Health returned 200 and 63 served static hashes plus configured pilot metadata matched. Image digest: `5520f21607aaffa8d59b2d120b516b55bfb8467fed530aca3ae95629fc0e5e87`. A later documentation/evidence commit does not replace that deployed runtime identity or require rebuilding byte-identical application assets.

## Portable sandbox toolchain

Setup verifies official bubblewrap 0.9.0's release archive against SHA-256 `c6347eaced49ac0141996f46bba3b089e5e6ea4408bc1c43bab9f2d05dd094e1` before extraction. Meson/Ninja/pkg-config/libcap prerequisites support a nonroot build/install under runner temporary storage with `require_userns=true`. No setuid installation, root application, AppArmor/sysctl disabling or paid runner is used. Pinned Playwright core 1.58.2 downloads its matching official Chromium without the broad `--with-deps` font/system-upgrade sweep.

The trusted operator supplies absolute `RAID_RELIC_BWRAP_PATH`; the native default remains `/usr/bin/bwrap`. The launcher resolves and validates ownership, regular-file status, non-setuid permissions and required `--size`, `--perms` and `--unshare-all` capabilities. Its bounded help check prints no tool output. It never chooses an executable from HTTP, fixture data or PATH.

A trusted read-only bootstrap requires the expected nonroot identity, distinct namespaces, only loopback, read-only source/toolchain/bootstrap mounts and create/remove probes confined to private temporary storage and artifacts. Size-capped `/tmp` uses mode 1777; the child creates mode-0700 HOME/cache. Closed startup diagnostics distinguish launcher stage, origin, permission area and error enums without raw stderr. Failed invariants, absent reports and malformed artifacts remain fatal.

Earlier hosted attempts encountered Ubuntu 22.04's old bubblewrap lacking `--size`, an excessive dependency-install timeout, and Ubuntu 24.04 bubblewrap setup denial. Those were failed platform gates, not accepted journey runs. The verified configuration above resolved them without weakening isolation or increasing the ten-minute job deadline.

This is application-authority verification, distinct from the pure fictional [45-second judge presentation](JUDGES.md) and from owner-operated physical Twitch/OBS tests. The hosted gate is complete. The separate real two-hour active-use overlay soak also passed; its measurements and limits are recorded in [accessibility/performance](ACCESSIBILITY_PERFORMANCE.md). It remains manual and is never scheduled or run by ordinary CI.

No new production service, scheduler, permission, scope, traffic change, repository visibility change or public submission is part of this CI increment. Existing Actions permissions remain contents-read and checkout does not persist credentials.

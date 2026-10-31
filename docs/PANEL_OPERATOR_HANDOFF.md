# Panel operator handoff · approval and backup gate · 31 October 2026

This is a **non-executable checklist**, not a database procedure, cloud command, permission grant or claim that operations occurred. Idle raidrelichq compaction is **NOT STARTED**. Original311 only read code/proof metadata and wrote documentation. Parent owns any approved operation; source authors do not access production data, credentials or backups.

## Before any retained-state compaction

- [ ] Obtain explicit approval for the exact channel, bounded record class, purpose and retention change. A preview approval or requested deadline does not authorize deletion, promotion, main/default change or scope expansion.
- [ ] Establish current idle/safe conditions from authoritative, freshly reviewed operator metadata. Record the current deployed version and exact state versions; do not assume the older14a4 or production snapshot is still current. No pending transfer, in-flight action, unknown dispatch or active stream may be inferred away.
- [ ] Take a **private COMPLETE backup first** of the relevant state and dependencies. Verify completeness, record count, byte bounds and integrity, and confirm authorized recovery access. Do not publish raw content, credentials, private URLs or backup bodies. An unverified/partial backup blocks the operation.
- [ ] Identify a known, bounded existing method and its exact eligibility predicates. If no reviewed method exists, stop for design/approval; do not invent commands, scans, bulk deletes or a new maintenance service. Use version/CAS preconditions so changed state causes refusal rather than overwriting newer work.
- [ ] Preserve retained pending/approved/rejected content and author erasure reachability; current stream/session, five-mark spent counters, cooldowns, consent, blocks, share revocations, archive lineage, closed-event IDs/start fences, replay receipts and unknown/at-most-once dispatch boundaries remain protected. An empty-looking summary is not proof that its dependent records are disposable.
- [ ] Review rollback safety before writing. Restoring an old backup must never resurrect forgotten content, stale consent, expired capabilities, closed streams or action eligibility. If safe recovery cannot be described without weakening those fences, stop.

## After a specifically authorized bounded operation

- [ ] Compare exact intended changes with the approved eligibility set and CAS versions; verify no unrelated holder, pending hop, ring, privacy association, quota or dispatch change.
- [ ] Check surviving content/erasure paths, current/retired stream fences and replay/idempotence. Exercise only approved offline regressions unless separate live authorization exists; never replay a real event or retry an unknown Raid POST merely to test cleanup.
- [ ] Record bounded counts, integrity/version metadata, refusal/recovery outcomes and remaining uncertainty privately. Public docs receive only safe factual summaries. Stop further work if any invariant differs; do not automatically restore a privacy-stale backup.

## Separate release/access decisions

Parent read-only history review04:50:52UTC found default main3991bb84b9a3d60d1681e8d18e68b5e9cb44f511 ancestral to14a4,33 feature commits/1merge, with no rewrite/main merge/default switch. This completes review, not promotion authority. Existing canonical service IAM/100% traffic and old tags remain unchanged by the new candidate.

Repo PRIVATE is distinct from site access: existing unlisted previews returned unauthenticated200. New preview-only access gate is LOCAL UNCOMMITTED and locally tested, not provisioned/deployed. Parent must review actual new flags, expiry and credential delivery without putting the access key into source, URLs, logs, screenshots or public metadata. Authentication does not grant control/moderation authority or waive read-only policy.

The requested grouped zero-preview by15:00UK and freeze18:00UTC are planning constraints, not evidence of completion. Full composite QA, exact-byte format/CI/evidence checks, lead review and parent-controlled history integration precede any new preview. No physical OBS/Twitch/manual AT proof is implied. [Audit](PANEL_STATUS.md) · [Provenance](PROVENANCE.md).

# Offline Codex submission evidence

Use only original session **01a1705c-a87d-7143-80f6-021e47b78ced**. This workflow makes no network/provider/cloud calls, loads no credentials and stays outside production uploads/images. No raw backup is committed.

1. Let authoring run042 finish. Parent refreshes its already-scanned **owned fixed backup** inside `.codex-evidence/rollout-backups/`. Do not point at the live Codex rollout, WAL, auth directories or an unrelated session; do not discover/read those files with this tool.
2. Supply the existing exact snapshot leaf. Example (replace the timestamp with the actual owned backup name):

```sh
node scripts/export-codex-evidence.js --input .codex-evidence/rollout-backups/rollout-2026-10-25T12-00-00-01a1705c-a87d-7143-80f6-021e47b78ced.jsonl
```

3. Review `.codex-evidence/EXPORTED_TRANSCRIPT.md` and `.codex-evidence/EXPORT_MANIFEST.json`. Confirm session, cutoff, source SHA/bytes, omitted material, disclosed item limits and exported-message/tool coverage. Inspect actual files before claiming an exported transcript exists. This task did not run the exporter on the real backup; parent must generate it after042 for the submission.
4. Commit only the reviewed sanitized outputs, this guide/README/session docs, exporter/tests and curated `run-NNN.jsonl`/SESSION_ID. Never force-add `.codex-evidence/rollout-backups`, other raw/opaque/private evidence or temporary outputs. The ignore allowlist names exactly two exports. Do not auto-stage all evidence.

The parser includes timestamped user/assistant messages and function/custom tool calls/results from native JSONL. It also labels native event_msg copies (they can duplicate messages). System/developer roles, reasoning/analysis, bootstrap instructions, encrypted_content, image/audio/base64 and internal metadata are omitted; counts disclose exclusions. Each selected item is capped at32768 characters, with sanitized full-item SHA and omitted-character count. Raw snapshot≤200MiB; oversize inputs fail rather than silently crop history. No links expose raw/private backups. The manifest's last timestamped source-record cutoff is not a claim of future or active-thread completeness. Earlier native compaction omissions cannot be reconstructed by this exporter.

Credential screening happens on selected decoded content before bounding/writing. A first pass checks **all selected visible fields** for strong provider/GitHub/private-key patterns; these remain fatal, including when an earlier field would otherwise trigger omission. Private reasoning, opaque fields and media remain excluded. A second pass treats suspicious non-key literal assignments, Authorization headers or sensitive fields by omitting the **entire selected item's content**, without assuming whether the value is real or synthetic. Its timestamp/source line and a generic category remain readable; manifest `credentialLookingItems` and `credentialReasons` disclose counts. Unflagged messages/tools remain readable. No matched value is printed. The existing narrowly classified fixture list is unchanged; do not add unknown values to it to make an export pass.

The scanner is conservative, not a guarantee that arbitrary secrets/personal information are detectable. Parent must review the generated transcript before publication. Strong-key failures must not be bypassed. Parent reported292/292 host tests for the prior exporter; the fixed post041 snapshot then correctly failed closed on a literal assignment. No real backup was read in this correction. After run042 finishes, parent will refresh the scanned fixed snapshot, re-export and review/commit evidence **before any fade work**. A successful real export is still pending; synthetic fixture exports are not conversation evidence.

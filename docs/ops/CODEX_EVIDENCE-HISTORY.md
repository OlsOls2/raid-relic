# Historical notes — not current delivery authority

# Offline Codex submission evidence

Use only original session **01a1705c-a87d-7143-80f6-021e47b78ced**. This workflow makes no network/provider/cloud calls, loads no credentials and stays outside production uploads/images. No raw backup is committed.

1. For the next parent-only refresh, let authoring run045 finish. Parent refreshes its already-scanned **owned fixed backup** inside `.codex-evidence/rollout-backups/`. Do not point at the live Codex rollout, WAL, auth directories or an unrelated session; do not discover/read those files with this tool.
2. Supply the existing exact snapshot leaf. Example (replace the timestamp with the actual owned backup name):

```sh
node scripts/export-codex-evidence.js --input .codex-evidence/rollout-backups/rollout-2026-10-25T12-00-00-01a1705c-a87d-7143-80f6-021e47b78ced.jsonl
```

3. Review `.codex-evidence/EXPORTED_TRANSCRIPT.md` and `.codex-evidence/EXPORT_MANIFEST.json`. Confirm session, cutoff, source SHA/bytes, omitted material, disclosed item limits and exported-message/tool coverage. The real post042 export already exists and is committed inb6ae4b9. After045, parent refreshes the selected transcript/manifest and latest curated CLI-log digests from a new scanned fixed snapshot; Codex does not read or export the actual backup. Do not predict the future counts/cutoff/hash.
4. Commit only the reviewed sanitized outputs, this guide/README/session docs, exporter/tests and curated `run-NNN.jsonl`/SESSION_ID. Never force-add `.codex-evidence/rollout-backups`, other raw/opaque/private evidence or temporary outputs. The ignore allowlist names exactly two exports. Do not auto-stage all evidence.

The parser includes timestamped user/assistant messages and function/custom tool calls/results from native JSONL. It also labels native event_msg copies (they can duplicate messages). System/developer roles, reasoning/analysis, bootstrap instructions, encrypted_content, image/audio/base64 and internal metadata are omitted; counts disclose exclusions. Each selected item is capped at32768 characters, with sanitized full-item SHA and omitted-character count. Raw snapshot≤200MiB; oversize inputs fail rather than silently crop history. No links expose raw/private backups. The manifest's last timestamped source-record cutoff is not a claim of future or active-thread completeness. Earlier native compaction omissions cannot be reconstructed by this exporter.

Credential screening happens on selected decoded content before bounding/writing. A first pass checks **all selected visible fields** for strong provider/GitHub/private-key patterns; these remain fatal, including when an earlier field would otherwise trigger omission. Private reasoning, opaque fields and media remain excluded. A second pass treats suspicious non-key literal assignments, Authorization headers or sensitive fields by omitting the **entire selected item's content**, without assuming whether the value is real or synthetic. Its timestamp/source line and a generic category remain readable; manifest `credentialLookingItems` and `credentialReasons` disclose counts. Unflagged messages/tools remain readable. No matched value is printed. The existing narrowly classified fixture list is unchanged; do not add unknown values to it to make an export pass.

The scanner is conservative, not a guarantee that arbitrary secrets/personal information are detectable. Parent reviews generated files before publication; strong-key failures must not be bypassed. Historical post041 failed closed on a literal assignment; the corrected exporter safely omitted whole credential-looking items without expanding its fixture allowlist.

Actual committed proof: parent committed/pushedb6ae4b9 after real fixed post042 export;870 selected entries, cutoff2026-10-25T06:29:41.733Z, transcript SHA25658183847ddd17274efecac534fa78d7f086e7197740f21fe26268cad5a216dca,43 CLI log digests,20 whole credential-looking items omitted with no assumption about credential status; strong-key scanner found none. Raw15.8MB remains LOCAL ignored, selected2.5MB Markdown/manifest committed. The current committed manifest is the authoritative snapshot; it does not yet include later authoring runs. Parent will refresh only after045 completes, then review/commit updated outputs. No refresh or actual raw-backup read by Codex in this docs-only run.

Parent subsequently committed/pushed fade d392a0c then resonance d8eecf4. Latest host312/312 zero skips; all seven sandboxed browser workflows/33 checks PASS (Atlas13,pilot8,judges3,recap3,Forge2,fade2,resonance2), audit0/release55/diff pass. Captures and result JSON are local labelled SIMULATOR artifacts, parent-viewed, not live Shared Chat/Twitch/physical OBS/AI evidence. Main and both cloud revisions remain frozen, paid gatesOFF, scopes/subscriptions unchanged.

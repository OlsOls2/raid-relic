# Selected evidence: bounded, private-input operator procedure

The manifest is authoritative for cutoff, original source lines, ordered components, digests, entry counts and omissions. Selected evidence is **not raw-complete**. Never publish raw snapshots, private reasoning/instructions, opaque content, credentials, media or scanner findings. The source author has not read raw/selected history or private reports. [Original session](../CODEX_SESSION.md) · [historical checkpoints](ops/CODEX_EVIDENCE-HISTORY.md).

## Authorization and limits

Parent authenticated direct owner message `1565854078880190495`, **2026-10-30T22:25:04Z**: selected components ≤16 MiB each, aggregate ≤32 MiB, redaction unchanged; small feature-branch releases and **zero-traffic** previews, no production traffic shift. Earlier missing-approval failures remain historical. Freeze: 31 October 18:00 UTC. Through source298, the original session was the sole author. The parent has now verified one owner-authorized documentation/QA worker; [CODEX_SESSIONS](CODEX_SESSIONS.md) records its actual identity and report-only contribution. Original lead still owns app/art authorship and integration; the recovered report is not a completed full-history merge. This policy implementation does not itself export, scan, execute QA or publish.

Production constants: **16,777,216 bytes/component**, **33,554,432 bytes aggregate**, fixed raw snapshot ≤**209,715,200 bytes**. The aggregate budget also includes the generated index. No entry is removed/truncated merely to fit chunks: boundaries are between complete original selected entries, retaining headers, source-line numbers, order and bytes. A single complete entry (including the first-part preamble) exceeding one part fails closed. Existing approved per-item rendering bounds/disclosures and credential/private/media redaction remain unchanged; this is not a new history-truncation mechanism.

Legacy exports ≤16 MiB retain formatVersion 1 and the single transcript/array-report procedure. Larger exports use formatVersion 2: `EXPORTED_TRANSCRIPT.md` is explicitly an **index, not transcript content**. `parts` lists canonical relative filenames `EXPORTED_TRANSCRIPT.part-NNN-<aggregate-sha256>.md`, contiguous order, bytes, SHA256 and entry counts. `exportBytes` / `exportSHA256` describe exact byte concatenation in manifest order, with **no inserted separators**. Index bytes/hash are separately verified. Never scan only the index or infer full-history coverage from its size.

## Session coverage

`SESSION_ID` and the fixed-snapshot exporter continue to identify only original lead `01a1705c-a87d-7143-80f6-021e47b78ced`. Existing generated evidence is fixed through270; the planned original refresh through301 is upcoming, not a newly verified cutoff. It excludes worker `01a18f00-8033-7d81-befa-9b82d727a3a6`; private worker CLI logs/transcript are not public attachments or original selected-export components. The registry/report links document that boundary without inventing worker run numbers or export coverage. No generated output is edited by this documentation integration.

## Fixed-snapshot migration and commands

Run only after the source writer stops, from the repository root. Existing dirty generated outputs are operator-owned. Preserve the prior reviewed generation privately before migration; do not edit it or discard historical entries. The currently oversized legacy candidate is migrated by **re-exporting the same explicit fixed raw snapshot**, not by reading/truncating the selected file or accepting its old oversize manifest. No active-session discovery.

```sh
node scripts/export-codex-evidence.js --input .codex-evidence/rollout-backups/rollout-EXPLICIT-OWNED-SNAPSHOT-01a1705c-a87d-7143-80f6-021e47b78ced.jsonl
node scripts/sanitize-evidence.js --report /explicit/private/findings-envelope.json
node scripts/sanitize-evidence.js --verify-report /explicit/private/fresh-zero-envelope.json
npm run evidence:summary
npm run evidence:verify
npm test
```

The two sanitizer commands have a mandatory scanner step immediately **before each** command. Use the existing operator-approved secondary gitleaks tool/config on **every complete selected component**, no raw inputs, no printed findings, no blanket allowlist. All findings, including public client-ID matches, remove the **whole original selected entry**. The historically reported five secondary omissions are not waived or reset by chunking: reconcile those rules/findings against the same fixed source during fresh scanning; investigate any unexplained reduction before publication. Exact newly generated counts must come from the parent, never this document.

For v1, the private report is the existing gitleaks findings array; `File` must be `EXPORTED_TRANSCRIPT.md` or `.codex-evidence/EXPORTED_TRANSCRIPT.md`. For v2, before scanning, save an envelope from the **current** manifest metadata, then scan each `parts[i].path` and fill its findings array without changing saved bindings. Every component must appear, including empty arrays. Preserve scanner line numbers and matched values privately; never print or commit reports. Scan from the repository root so `File` is either the component basename or `.codex-evidence/<basename>`; absolute/traversal/other paths are rejected. Use your approved scanner's JSON-report option, writing one private report per component, then copy its parsed array to the corresponding saved `findings` field. Do not rewrite metadata to make a stale report pass.

Private v2 report shape (placeholder values are explanatory, not real evidence):

```json
{
  "formatVersion": 2,
  "exportSHA256": "EXACT_CURRENT_CONCATENATION_SHA256",
  "components": [
    {
      "path": "EXACT_parts[0].path",
      "bytes": 123,
      "sha256": "EXACT_parts[0].sha256",
      "findings": []
    }
  ]
}
```

`components` must match **all** manifest parts in exact order. Each finding retains gitleaks `File`, `StartLine`, optional `EndLine`, `RuleID`, `Match`; private extra scanner fields never enter public metadata. Component-local lines are mapped to original aggregate lines. No entry crosses a boundary; a report cannot silently omit a second half. Index/header findings cannot be sanitized as an entry: stop and investigate. Report input remains bounded to16 MiB /10,000 findings.

After omission, filenames/hashes/partitioning can change. Make a **new** envelope from the changed candidate and freshly rescan **all** parts. `--verify-report` accepts only a complete zero-finding envelope for the exact current aggregate and ordered part set. Nonzero, stale, reordered, duplicate or missing components fail closed. If fresh findings remain, re-export the same fixed snapshot and reconcile all findings for that exact input, rather than applying stale line numbers. Original headers/source lines survive whole-entry omission; omission counts and rules remain public, values/report paths remain private.

## Candidate generations, recovery and CI

Exporter/sanitizer create candidate files; this is **not permission to stage unsanitized evidence**. Only zero-proof verification plus regenerated summary and parent QA permits publication. A private exclusive `.selected-generation.lock` excludes concurrent writers. Files are written with exclusive temporary creation; manifest rename is the final commit record. Readers check the manifest before/after reading, canonical paths, actual bytes/hashes/counts, link count, regular-file status, no symlinks, no unlisted/stale parts and no active lock. A torn/crashed generation is rejected, never silently accepted. Writer compare-and-swap rejects a stale input manifest.

After an interrupted operation, stop other writers; privately preserve the failed candidate for diagnosis. The operator may remove **only confirmed abandoned** lock/`.generation.tmp` files and regenerate from the same owned fixed snapshot. Do not use recovery to delete source history, clear omissions or bypass verification. Old canonical part files are removed only by successful generation replacement; malformed/unlisted part names require explicit operator investigation, not automatic acceptance. Never run two generations concurrently.

CI explicitly runs `npm run evidence:verify`; `npm test` also verifies evidence and ordinary node tests verify the generated session summary. Both v1 and v2 readers need no private report/raw input in CI. Zero proof binds aggregate SHA plus the exact ordered part-descriptor SHA; changing a component, order, count, index, cutoff or summary fails. `.gitignore` allows only the canonical published index/manifest and exact part-name shape; raw runs, reports, locks and generation temporaries remain ignored. Stage only parent-verified manifest-listed files, never a wildcard or private report.

Synthetic tests cover legacy compatibility, byte-preserving chunk boundaries, whole-entry omission, report generation mismatch, tampering, missing/duplicate/reordered/traversal/unlisted parts, symlink/hardlink/nonregular/oversize files, candidate locks, stale-writer CAS and index integrity. Source author has **not executed** these tests or any actual export. Parent must run focused evidence tests, formatter/full native gates and the real fixed-snapshot migration/rescan before release. No current test counts, cutoff, hashes or additional-session claims are invented here.

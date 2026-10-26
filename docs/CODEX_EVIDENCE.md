# Selected Codex evidence

The manifest is authoritative for exact cutoff, counts, digests and omissions. A selected export is not raw-complete. Raw snapshots, private reasoning/instructions, opaque content, credentials and media are never public evidence. The source author reads safe metadata only. [Original session](../CODEX_SESSION.md) · [historical exporter checkpoints](ops/CODEX_EVIDENCE-HISTORY.md).

## Tier 1 secondary scan gate (run168)

Operator reports the fixed export through168 is now secondary-sanitized: five whole entries omitted and a zero-finding rescan bound to its SHA. The source author has not opened selected text or private scanner reports. Repeat the following procedure for every later fixed export, after the writer stops:

1. Refresh from the explicitly owned fixed snapshot with the existing exporter (never discover/read the active session). Run the scanner on **only** the selected `EXPORTED_TRANSCRIPT.md`, writing a JSON report to an explicit private path. Do not print findings.
2. `node scripts/sanitize-evidence.js --report /explicit/private/scan.json`
3. Rescan the changed selected file into a fresh private JSON report. All findings—including public client-ID matches—cause whole-entry omission. No blanket allowlist. If new findings remain, re-export the same fixed snapshot and use a reconciled report for that exact input; never apply stale line numbers to modified text.
4. Only after an empty finding array: `node scripts/sanitize-evidence.js --verify-report /explicit/private/rescan.json`
5. `npm run evidence:summary`, then `npm run evidence:verify` and `npm test`. The first command regenerates `CODEX_SESSION.md` from verified public metadata; verification and ordinary unit tests reject a stale or mismatched summary. The manifest records exact new bytes/SHA, secondary omission counts/rules and the zero-finding report digest bound to that export SHA. No matched values, private report paths or raw content are written to the manifest. Preserve original entry headers/source-line numbers and disclose omissions.

A nonzero or missing rescan fails CI. Ordinary `node --test` includes the selected-artifact verifier; no raw input or private scanner report is needed in CI. Publication size cap is16 MiB per selected file; if the export outgrows it, stop for an explicitly reviewed chunking change rather than truncating silently. Snapshot source remains capped at200 MiB. The current two parent-generated outputs must remain untouched by the source author. Refresh through168 is an operator step after this turn, not a prediction of its count/hash.

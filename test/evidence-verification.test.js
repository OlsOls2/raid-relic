import test from 'node:test';
import assert from 'node:assert/strict';
import { transcriptFrom, SESSION_ID } from '../scripts/export-codex-evidence.js';
import { evidenceSHA, verifyEvidenceBytes, verifyEvidence } from '../scripts/verify-evidence.js';
import { omitSecondary, attestSecondary } from '../scripts/sanitize-evidence.js';
function fixture() {
  const rows = [
    { timestamp: '2026-10-26T10:00:00.000Z', type: 'session_meta', payload: { id: SESSION_ID } },
    ...['selected text', JSON.stringify({ nested: 'encoded safe text' })].map((text) => ({
      timestamp: '2026-10-26T10:01:00.000Z',
      type: 'response_item',
      payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] },
    })),
  ];
  const raw = Buffer.from(rows.map(JSON.stringify).join('\n')),
    parsed = transcriptFrom(raw),
    bytes = Buffer.from(parsed.markdown);
  const manifest = {
    formatVersion: 1,
    sessionID: SESSION_ID,
    rawSnapshotSHA256: evidenceSHA(raw),
    rawBytes: raw.length,
    exportBytes: bytes.length,
    exportSHA256: evidenceSHA(bytes),
    exportedEntries: parsed.exportedEntries,
    eventCounts: parsed.counts,
    omissions: parsed.omissions,
    cutoff: parsed.cutoff,
    firstTimestamp: parsed.firstTimestamp,
    sourceRunLogs: [{ leaf: 'run-000.jsonl', bytes: 1, sha256: 'a'.repeat(64) }],
    scope: 'Selected only.',
  };
  return { bytes, manifest };
}
test('selected submission artifacts verify under ordinary isolated node --test (no raw/private input)', async () => {
  await verifyEvidence();
  const { updateEvidenceSummary } = await import('../scripts/update-evidence-summary.js');
  await updateEvidenceSummary({ check: true });
});
test('secondary scan removes entire entries for every rule including public-ID matches without copying findings', () => {
  const f = fixture(),
    line =
      f.bytes
        .toString()
        .split('\n')
        .findIndex((s) => s.includes('selected text')) + 1;
  const report = [
    {
      File: 'EXPORTED_TRANSCRIPT.md',
      StartLine: line,
      EndLine: line,
      RuleID: 'public-id',
      Secret: 'NEVER_COPY_SECRET',
      Match: 'selected text',
    },
    {
      File: 'EXPORTED_TRANSCRIPT.md',
      StartLine: line,
      RuleID: 'generic-api-key',
      Secret: 'SECOND_VALUE',
      Match: 'selected text',
    },
  ];
  const out = omitSecondary(f.bytes, f.manifest, report, 'b'.repeat(64));
  assert.equal(out.manifest.secondaryScan.omittedEntries, 1);
  assert.equal(out.manifest.secondaryScan.findings, 2);
  assert.ok(!out.bytes.includes(Buffer.from('selected text')));
  assert.ok(!JSON.stringify(out).includes('NEVER_COPY'));
  assert.match(out.bytes.toString(), /source line 2/);
  assert.match(out.bytes.toString(), /encoded safe text/);
  assert.throws(() => verifyEvidenceBytes(out.bytes, out.manifest));
  const final = attestSecondary(out.bytes, out.manifest, [], 'c'.repeat(64));
  assert.equal(verifyEvidenceBytes(out.bytes, final).secondaryOmittedEntries, 1);
  assert.throws(() => attestSecondary(out.bytes, out.manifest, [{}], 'c'.repeat(64)));
});
test('evidence tamper, cutoff/session/count/omission drift and unsafe report locations fail closed', () => {
  const f = fixture(),
    out = omitSecondary(f.bytes, f.manifest, [], 'b'.repeat(64)),
    final = attestSecondary(out.bytes, out.manifest, [], 'c'.repeat(64));
  for (const changes of [
    { sessionID: 'wrong' },
    { unexpectedPrivateField: 'rejected' },
    { cutoff: '2026-10-27T10:01:00.000Z' },
    { exportedEntries: 3 },
    { eventCounts: { session_meta: 1, response_item: -1 } },
    { sourceRunLogCount: 7 },
    { exportBytes: 1 },
    { omissions: { ...final.omissions, private: -1 } },
    { secondaryScan: { ...final.secondaryScan, scannedExportSHA256: '0'.repeat(64) } },
  ])
    assert.throws(() => verifyEvidenceBytes(out.bytes, { ...final, ...changes }));
  assert.throws(() =>
    omitSecondary(
      f.bytes,
      f.manifest,
      [{ File: 'EXPORTED_TRANSCRIPT.md', StartLine: 10, RuleID: 'safe', Match: 'wrong content' }],
      'd'.repeat(64),
    ),
  );
  assert.throws(() =>
    verifyEvidenceBytes(Buffer.concat([out.bytes, Buffer.from('tamper')]), final),
  );
  for (const finding of [
    { File: 'other-file', StartLine: 4, RuleID: 'safe' },
    { File: 'EXPORTED_TRANSCRIPT.md', StartLine: 1, RuleID: 'safe' },
    { File: 'EXPORTED_TRANSCRIPT.md', StartLine: 5, RuleID: 'unsafe\nbody' },
  ])
    assert.throws(() => omitSecondary(f.bytes, f.manifest, [finding], 'd'.repeat(64)));
});

test('selected strong-key scan rejects real and escaped key shapes, not regex source notation', async () => {
  const { rejectStrongSelectedKeys } = await import('../scripts/verify-evidence.js');
  const value = 'sk-' + 'A'.repeat(35);
  assert.throws(() => rejectStrongSelectedKeys(value));
  assert.throws(() => rejectStrongSelectedKeys('\\u0073\\u006b-' + 'A'.repeat(35)));
  assert.doesNotThrow(() => rejectStrongSelectedKeys('/sk-(?:proj-)?[A-Za-z0-9_-]{16,}/'));
});

test('generated session summary uses verified counts rather than stale run047 prose', async () => {
  const { evidenceSessionMarkdown } = await import('../scripts/update-evidence-summary.js');
  const summary = {
    sessionID: SESSION_ID,
    cutoff: '2026-10-26T11:15:04.950Z',
    exportedEntries: 2,
    sourceRunLogCount: 1,
    exportSHA256: 'd'.repeat(64),
    secondaryOmittedEntries: 0,
  };
  const manifest = {
    exportSHA256: summary.exportSHA256,
    cutoff: summary.cutoff,
    exportBytes: 500,
    sourceRunLogs: [{ leaf: 'run-000.jsonl' }],
    secondaryScan: { status: 'zero-findings' },
  };
  const text = evidenceSessionMarkdown(summary, manifest);
  assert.match(text, /Selected entries \| 2/);
  assert.match(text, /not raw-complete/);
  assert.ok(text.includes(summary.cutoff));
  const chunkedText = evidenceSessionMarkdown(summary, {
    ...manifest,
    formatVersion: 2,
    parts: [{}],
  });
  assert.match(chunkedText, /sole APP source author/);
  assert.match(chunkedText, /CODEX_SESSIONS/);
  assert.match(chunkedText, /transcripts are not included/);
  assert.ok(!text.includes('CODEX_SESSIONS')); // Legacy generated prose stays byte-compatible.

  assert.throws(() => evidenceSessionMarkdown(summary, { ...manifest, cutoff: 'stale' }));
  assert.throws(() =>
    evidenceSessionMarkdown(summary, { ...manifest, secondaryScan: { status: 'rescan-required' } }),
  );
});

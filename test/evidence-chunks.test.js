import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  unlink,
  symlink,
  link,
  truncate,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { transcriptFrom, SESSION_ID } from '../scripts/export-codex-evidence.js';
import {
  PART_LIMIT,
  TOTAL_LIMIT,
  evidenceSHA,
  evidenceEntries,
  packageSelected,
  validateParts,
  selectedFiles,
  readSelected,
  publishSelected,
  verifyEvidenceBytes,
  boundedFile,
} from '../scripts/verify-evidence.js';
import { omitSecondary, attestSecondary, mappedReport } from '../scripts/sanitize-evidence.js';
function fixture() {
  const rows = [
    { timestamp: '2026-10-30T22:00:00.000Z', type: 'session_meta', payload: { id: SESSION_ID } },
    ...[1, 2, 3, 4].map((n) => ({
      timestamp: '2026-10-30T22:01:00.000Z',
      type: 'response_item',
      payload: { type: 'message', role: 'user', content: `safe item ${n} ${'word '.repeat(400)}` },
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
    eventCounts: parsed.counts,
    exportedEntries: parsed.exportedEntries,
    omissions: parsed.omissions,
    firstTimestamp: parsed.firstTimestamp,
    cutoff: parsed.cutoff,
    exportBytes: bytes.length,
    exportSHA256: evidenceSHA(bytes),
    sourceRunLogCount: 1,
    sourceRunLogs: [{ leaf: 'run-000.jsonl', bytes: 1, sha256: 'a'.repeat(64) }],
    scope: 'Synthetic selected only.',
  };
  const { lines, entries } = evidenceEntries(bytes.toString());
  const limit = Buffer.byteLength(lines.slice(0, entries[1].start).join('\n') + '\n');
  return packageSelected(bytes, manifest, limit);
}
function envelope(f) {
  return {
    formatVersion: 2,
    exportSHA256: f.manifest.exportSHA256,
    components: f.manifest.parts.map((p) => ({
      path: p.path,
      bytes: p.bytes,
      sha256: p.sha256,
      findings: [],
    })),
  };
}
async function disk(t, f = fixture()) {
  const root = await mkdtemp(join(tmpdir(), 'evidence-chunks-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, '.codex-evidence'));
  await publishSelected(root, f, null);
  return { root, dir: join(root, '.codex-evidence'), f };
}
test('production selected bounds remain 16 MiB per part, 32 MiB total; packaging preserves every original byte/header/order', () => {
  assert.equal(PART_LIMIT, 16777216);
  assert.equal(TOTAL_LIMIT, 33554432);
  const f = fixture();
  assert.ok(f.manifest.parts.length > 1);
  assert.deepEqual(Buffer.concat(f.files.slice(0, -1).map((p) => p.bytes)), f.bytes);
  assert.equal(
    f.manifest.parts.reduce((n, p) => n + p.entries, 0),
    4,
  );
  validateParts(f.bytes, f.manifest);
  assert.match(f.files.at(-1).bytes.toString(), /index, NOT the transcript/);
  assert.throws(() => packageSelected(f.bytes, f.manifest, 1), /Single selected entry/);
  assert.throws(() => packageSelected(Buffer.alloc(TOTAL_LIMIT + 1), f.manifest), /size/);
  assert.throws(() => packageSelected(f.bytes, f.manifest, PART_LIMIT + 1));
});
test('legacy small selected exports stay v1 and verify after existing array-report procedure', () => {
  const f = fixture(),
    legacy = structuredClone(f.manifest);
  legacy.formatVersion = 1;
  delete legacy.parts;
  delete legacy.indexSHA256;
  delete legacy.indexBytes;
  const packed = packageSelected(f.bytes, legacy);
  assert.equal(packed.manifest.formatVersion, 1);
  assert.equal(packed.files.length, 1);
  const omitted = omitSecondary(packed.bytes, packed.manifest, [], 'b'.repeat(64));
  const final = attestSecondary(omitted.bytes, omitted.manifest, [], 'c'.repeat(64));
  assert.equal(verifyEvidenceBytes(omitted.bytes, final).exportedEntries, 4);
});
test('chunk scanner envelope maps original component lines and removes whole entries, including public-ID findings', () => {
  const f = fixture(),
    report = envelope(f),
    target = report.components[1],
    bytes = f.files[1].bytes;
  const line =
    bytes
      .toString()
      .split('\n')
      .findIndex((l) => l.includes('safe item')) + 1;
  const matched = bytes.toString().split('\n')[line - 1];
  target.findings = [
    {
      File: target.path,
      StartLine: line,
      EndLine: line,
      RuleID: 'public-id',
      Match: matched,
      Secret: 'PRIVATE_REPORT_VALUE',
    },
  ];
  const out = omitSecondary(f.bytes, f.manifest, report, 'b'.repeat(64));
  assert.equal(out.manifest.secondaryScan.omittedEntries, 1);
  assert.equal(out.manifest.secondaryScan.findings, 1);
  assert.ok(!out.bytes.includes(Buffer.from(matched)));
  assert.ok(!JSON.stringify(out).includes('PRIVATE_REPORT_VALUE'));
  assert.deepEqual(
    evidenceEntries(out.bytes.toString()).entries.map((e) => e.sourceLine),
    evidenceEntries(f.bytes.toString()).entries.map((e) => e.sourceLine),
  );
  const final = attestSecondary(out.bytes, out.manifest, envelope(out), 'c'.repeat(64));
  assert.equal(verifyEvidenceBytes(out.bytes, final).exportedEntries, 4);
  assert.equal(final.secondaryScan.scannedPartsSHA256, evidenceSHA(JSON.stringify(final.parts)));
  assert.throws(() => attestSecondary(out.bytes, out.manifest, report, 'c'.repeat(64)));
  assert.throws(() => attestSecondary(out.bytes, out.manifest, [], 'c'.repeat(64)));
});
test('report envelopes reject stale aggregate, stale/missing/duplicated/reordered parts, foreign paths and cross-component lines', () => {
  const f = fixture();
  const variants = [
    (r) => (r.exportSHA256 = '0'.repeat(64)),
    (r) => r.components.reverse(),
    (r) => r.components.pop(),
    (r) => (r.components[1] = r.components[0]),
    (r) => (r.components[0].sha256 = '0'.repeat(64)),
    (r) => r.components[0].bytes++,
    (r) => (r.components[0].path = '../escape.md'),
    (r) =>
      (r.components[0].findings = [
        { File: r.components[1].path, StartLine: 1, RuleID: 'public-id', Match: 'safe' },
      ]),
    (r) =>
      (r.components[0].findings = [
        {
          File: r.components[0].path,
          StartLine: 1,
          EndLine: 999999,
          RuleID: 'public-id',
          Match: 'safe',
        },
      ]),
  ];
  for (const change of variants) {
    const report = envelope(f);
    change(report);
    assert.throws(() => mappedReport(f.bytes, f.manifest, report));
  }
});
test('manifest tamper rejects reordered/duplicate/traversal parts, false counts, bytes, digest and index', () => {
  const f = fixture();
  for (const change of [
    (m) => m.parts.reverse(),
    (m) => (m.parts[1] = m.parts[0]),
    (m) => (m.parts[0].path = '../escape.md'),
    (m) => m.parts[0].entries++,
    (m) => m.parts[0].bytes++,
    (m) => (m.parts[0].sha256 = '0'.repeat(64)),
    (m) => m.indexBytes++,
    (m) => (m.indexSHA256 = '0'.repeat(64)),
    (m) => (m.parts[0].order = 0),
  ]) {
    const m = structuredClone(f.manifest);
    change(m);
    assert.throws(() => validateParts(f.bytes, m));
  }
  assert.throws(() => validateParts(Buffer.concat([f.bytes, Buffer.from('changed')]), f.manifest));
});
test('candidate disk generation reads in exact order; zero proof binds exact parts and index', async (t) => {
  const { root, f } = await disk(t);
  const before = await readSelected(root);
  assert.deepEqual(before.bytes, f.bytes);
  const omitted = omitSecondary(f.bytes, f.manifest, envelope(f), 'b'.repeat(64));
  await publishSelected(root, omitted, before.manifestSHA256);
  const after = await readSelected(root),
    final = attestSecondary(after.bytes, after.manifest, envelope(after), 'c'.repeat(64));
  await publishSelected(
    root,
    { bytes: after.bytes, manifest: final, files: selectedFiles(after.bytes, final) },
    after.manifestSHA256,
  );
  const verified = await readSelected(root);
  assert.equal(verifyEvidenceBytes(verified.bytes, verified.manifest).exportedEntries, 4);
  await assert.rejects(publishSelected(root, f, before.manifestSHA256), /Stale generation/);
});
for (const kind of [
  'missing',
  'unlisted',
  'symlink',
  'hardlink',
  'nonregular',
  'oversize',
  'index',
  'lock',
  'temp',
])
  test(`disk generation rejects ${kind} before accepting selected data`, async (t) => {
    const { root, dir, f } = await disk(t),
      path = join(dir, f.manifest.parts[0].path);
    if (kind === 'missing') await unlink(path);
    if (kind === 'unlisted')
      await writeFile(
        join(dir, 'EXPORTED_TRANSCRIPT.part-999-' + '0'.repeat(64) + '.md'),
        'unlisted',
      );
    if (kind === 'symlink') {
      await unlink(path);
      await symlink(f.manifest.parts[1].path, path);
    }
    if (kind === 'hardlink') await link(path, join(dir, 'private-hardlink'));
    if (kind === 'nonregular') {
      await unlink(path);
      await mkdir(path);
    }
    if (kind === 'oversize') {
      assert.equal(PART_LIMIT, 16777216);
      assert.equal(TOTAL_LIMIT, 33554432);
      // Exercise the actual bounded reader without requiring a file beyond the
      // sandbox's independent 16 MiB RLIMIT_FSIZE boundary.
      await assert.rejects(
        boundedFile(path, f.manifest.parts[0].bytes - 1),
        /^Error: Evidence file rejected$/,
      );
      let preventedByOS = false;
      try {
        await truncate(path, PART_LIMIT + 1);
      } catch (error) {
        assert.equal(error.code, 'EFBIG');
        preventedByOS = true;
      }
      if (preventedByOS) {
        // Only the expected OS refusal is accepted; the original candidate must
        // remain byte-exact and un-attested, rather than treating corruption as OK.
        assert.deepEqual(await boundedFile(path, PART_LIMIT), f.files[0].bytes);
        assert.deepEqual((await readSelected(root)).bytes, f.bytes);
      } else {
        await assert.rejects(readSelected(root), /^Error: Evidence file rejected$/);
      }
      assert.equal(
        JSON.parse(await readFile(join(dir, 'EXPORT_MANIFEST.json'))).secondaryScan,
        undefined,
      );
      return;
    }
    if (kind === 'index')
      await writeFile(join(dir, 'EXPORTED_TRANSCRIPT.md'), 'not the exact generated index');
    if (kind === 'lock') await writeFile(join(dir, '.selected-generation.lock'), '');
    if (kind === 'temp') await writeFile(path + '.generation.tmp', 'incomplete');
    await assert.rejects(readSelected(root));
  });
test('writer rejects symlink and hardlinked destinations and does not create an attestation', async (t) => {
  const { root, dir, f } = await disk(t),
    path = join(dir, 'EXPORTED_TRANSCRIPT.md');
  await link(path, join(dir, 'private-index-copy'));
  await assert.rejects(publishSelected(root, f));
  assert.equal(
    JSON.parse(await readFile(join(dir, 'EXPORT_MANIFEST.json'))).secondaryScan,
    undefined,
  );
});
test('production-limit split is byte-exact above16 MiB without changing body or entry provenance', () => {
  const f = fixture(),
    first = f.bytes.toString().indexOf('### 1.');
  const preamble = f.bytes.subarray(0, first).toString();
  const entries = Array.from(
    { length: 600 },
    (_, i) =>
      `### ${i + 1}. 2026-10-30T22:01:00.000Z — user (source line ${i + 2})\n\n\`\`\`\`text\n${'a'.repeat(29000)}\n### 999. body text is not an entry\n\`\`\`\`\n\n`,
  );
  const bytes = Buffer.from(preamble + entries.join(''));
  assert.ok(bytes.length > PART_LIMIT && bytes.length < TOTAL_LIMIT);
  const manifest = {
    ...f.manifest,
    formatVersion: 1,
    exportedEntries: 600,
    eventCounts: { session_meta: 1, response_item: 600 },
    rawBytes: bytes.length,
  };
  delete manifest.parts;
  delete manifest.indexBytes;
  delete manifest.indexSHA256;
  const out = packageSelected(bytes, manifest);
  assert.equal(out.manifest.parts.length, 2);
  assert.ok(out.manifest.parts.every((p) => p.bytes <= PART_LIMIT));
  assert.deepEqual(Buffer.concat(out.files.slice(0, -1).map((f) => f.bytes)), bytes);
  validateParts(out.bytes, out.manifest);
});
test('an empty scan for changed partitioning cannot reuse the old ordered-set proof', () => {
  const f = fixture(),
    out = omitSecondary(f.bytes, f.manifest, envelope(f), 'b'.repeat(64));
  const final = attestSecondary(out.bytes, out.manifest, envelope(out), 'c'.repeat(64));
  const repacked = packageSelected(
    out.bytes,
    final,
    Math.max(...f.manifest.parts.map((p) => p.bytes)),
  );
  if (JSON.stringify(repacked.manifest.parts) !== JSON.stringify(final.parts))
    assert.throws(() => verifyEvidenceBytes(repacked.bytes, repacked.manifest));
  const changed = structuredClone(final);
  changed.secondaryScan.scannedPartsSHA256 = '0'.repeat(64);
  assert.throws(() => verifyEvidenceBytes(out.bytes, changed));
});
test('source cap and CI keep all selected-component verification, no raw broad allowlist', async () => {
  const exporter = await readFile(
    new URL('../scripts/export-codex-evidence.js', import.meta.url),
    'utf8',
  );
  const workflow = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const ignore = await readFile(new URL('../.gitignore', import.meta.url), 'utf8');
  assert.match(exporter, /MAX_BYTES = 200 \* 1024 \* 1024/);
  assert.match(workflow, /run: npm run evidence:verify/);
  assert.match(ignore, /!\/\.codex-evidence\/EXPORTED_TRANSCRIPT\.part-/);
  assert.ok(!ignore.includes('!/.codex-evidence/*.md'));
  assert.ok(!ignore.includes('!/.codex-evidence/run-'));
});
test('omission report cannot cross a chunk boundary and nonzero rescan never attests', () => {
  const f = fixture(),
    report = envelope(f),
    row = report.components[0];
  const lines = f.files[0].bytes.toString().split('\n');
  row.findings = [
    {
      File: row.path,
      StartLine: lines.length - 1,
      EndLine: lines.length,
      RuleID: 'public-id',
      Match: lines.at(-2) || 'safe',
    },
  ];
  assert.throws(() => mappedReport(f.bytes, f.manifest, report));
  const out = omitSecondary(f.bytes, f.manifest, envelope(f), 'b'.repeat(64)),
    nonzero = envelope(out),
    text = out.files[0].bytes.toString().split('\n');
  const line = text.findIndex((s) => s.includes('safe item')) + 1;
  nonzero.components[0].findings = [
    {
      File: nonzero.components[0].path,
      StartLine: line,
      RuleID: 'public-id',
      Match: text[line - 1],
    },
  ];
  assert.throws(() => attestSecondary(out.bytes, out.manifest, nonzero, 'c'.repeat(64)));
});
test('existing whole-entry omission totals survive zero proof and re-packaging; no report values become metadata', () => {
  const f = fixture(),
    report = envelope(f);
  for (const [i, row] of report.components.entries()) {
    const lines = f.files[i].bytes.toString().split('\n');
    const line = lines.findIndex((s) => s.includes('safe item')) + 1;
    row.findings = [
      { File: row.path, StartLine: line, RuleID: 'public-id', Match: lines[line - 1] },
    ];
  }
  const out = omitSecondary(f.bytes, f.manifest, report, 'b'.repeat(64));
  const omitted = out.manifest.secondaryScan.omittedEntries;
  assert.equal(omitted, 4);
  const final = attestSecondary(out.bytes, out.manifest, envelope(out), 'c'.repeat(64));
  const repacked = packageSelected(out.bytes, final);
  assert.equal(repacked.manifest.secondaryScan.omittedEntries, omitted);
  assert.equal(repacked.manifest.secondaryScan.findings, 4);
  assert.equal(evidenceEntries(repacked.bytes.toString()).entries.length, 4);
});
test('torn manifest/component replacement fails closed; stale parts invalidate even a legacy candidate', async (t) => {
  const { root, dir, f } = await disk(t);
  const torn = structuredClone(f.manifest);
  torn.parts[0].sha256 = '0'.repeat(64);
  await writeFile(join(dir, 'EXPORT_MANIFEST.json'), JSON.stringify(torn));
  await assert.rejects(readSelected(root));
  const legacy = { ...f.manifest, formatVersion: 1 };
  delete legacy.parts;
  delete legacy.indexBytes;
  delete legacy.indexSHA256;
  await writeFile(join(dir, 'EXPORT_MANIFEST.json'), JSON.stringify(legacy));
  await writeFile(join(dir, 'EXPORTED_TRANSCRIPT.md'), f.bytes);
  await assert.rejects(readSelected(root), /Stale components/);
});

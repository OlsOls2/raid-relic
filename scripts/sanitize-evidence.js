// Operator-only offline secondary omission. Explicit selected artifacts and report;
// no raw/active session discovery, no finding values emitted or copied.
import { readFile, writeFile, rename, lstat, unlink } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  evidenceEntries,
  evidenceSHA,
  readSelected,
  verifyEvidenceBytes,
} from './verify-evidence.js';
const ruleName = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value);
export function omitSecondary(bytes, manifest, report, reportSHA256) {
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.length > 16 * 1024 * 1024 ||
    manifest.exportBytes !== bytes.length ||
    manifest.exportSHA256 !== evidenceSHA(bytes)
  )
    throw Error('Selected input mismatch');
  if (!Array.isArray(report) || report.length > 10000 || !/^[a-f0-9]{64}$/.test(reportSHA256))
    throw Error('Report rejected');
  if (manifest.secondaryScan)
    throw Error('Fresh selected export required before a new omission pass');
  const text = new TextDecoder('utf8', { fatal: true }).decode(bytes),
    { lines, entries } = evidenceEntries(text),
    affected = new Map(),
    rules = {};
  for (const finding of report) {
    if (
      !ruleName(finding.RuleID) ||
      typeof finding.File !== 'string' ||
      basename(finding.File) !== 'EXPORTED_TRANSCRIPT.md' ||
      !Number.isSafeInteger(finding.StartLine) ||
      finding.StartLine < 1
    )
      throw Error('Finding location rejected');
    const end = finding.EndLine ?? finding.StartLine;
    if (!Number.isSafeInteger(end) || end < finding.StartLine || end > lines.length)
      throw Error('Finding range rejected');
    const region = lines.slice(finding.StartLine - 1, end).join('\n');
    // Bind report positions to this exact selected content without reflecting it.
    if (
      typeof finding.Match !== 'string' ||
      !finding.Match ||
      finding.Match.length > 65536 ||
      !region.includes(finding.Match)
    )
      throw Error('Stale finding rejected');
    const hits = entries.filter((e) => e.start + 1 <= end && e.end + 1 >= finding.StartLine);
    if (!hits.length || finding.StartLine < entries[0].start + 1)
      throw Error('Finding outside selected entry');
    for (const e of hits) {
      const set = affected.get(e.start) ?? new Set();
      set.add(finding.RuleID);
      affected.set(e.start, set);
    }
    rules[finding.RuleID] = (rules[finding.RuleID] ?? 0) + 1;
  }
  // Process bottom-up so original scanner line positions remain meaningful.
  for (const entry of [...entries].reverse())
    if (affected.has(entry.start)) {
      const ids = [...affected.get(entry.start)].sort().join(', ');
      lines.splice(
        entry.start + 1,
        entry.end - entry.start,
        '',
        '````text',
        `[omitted after secondary secret scan; rules: ${ids}; entire selected entry removed]`,
        '````',
        '',
      );
    }
  const output = Buffer.from(lines.join('\n')),
    next = structuredClone(manifest);
  if (output.length > 16 * 1024 * 1024) throw Error('Selected output too large');
  next.exportBytes = output.length;
  next.exportSHA256 = evidenceSHA(output);
  next.sourceRunLogCount = next.sourceRunLogs.length;
  next.secondaryScan = {
    status: 'rescan-required',
    findings: report.length,
    omittedEntries: affected.size,
    rules,
    omissionReportSHA256: reportSHA256,
  };
  next.scope +=
    ' Secondary scanner findings cause whole selected-entry omission, including public identifiers; zero-finding rescan required.';
  return { bytes: output, manifest: next };
}
export function attestSecondary(bytes, manifest, report, reportSHA256) {
  if (
    !Array.isArray(report) ||
    report.length !== 0 ||
    manifest.secondaryScan?.status !== 'rescan-required'
  )
    throw Error('Zero-finding rescan required');
  const next = structuredClone(manifest);
  next.secondaryScan = {
    ...next.secondaryScan,
    status: 'zero-findings',
    reportSHA256,
    scannedExportSHA256: evidenceSHA(bytes),
  };
  verifyEvidenceBytes(bytes, next);
  return next;
}
export async function sanitizeEvidence({ root = process.cwd(), reportPath, verify = false } = {}) {
  if (typeof reportPath !== 'string' || !reportPath)
    throw Error('Explicit private report required');
  const path = resolve(reportPath),
    s = await lstat(path);
  if (!s.isFile() || s.isSymbolicLink() || s.size > 16 * 1024 * 1024)
    throw Error('Report file rejected');
  const raw = await readFile(path),
    report = JSON.parse(raw),
    selected = await readSelected(root),
    digest = evidenceSHA(raw);
  const result = verify
    ? {
        bytes: selected.bytes,
        manifest: attestSecondary(selected.bytes, selected.manifest, report, digest),
      }
    : omitSecondary(selected.bytes, selected.manifest, report, digest);
  const outputs = verify
    ? ['EXPORT_MANIFEST.json']
    : ['EXPORTED_TRANSCRIPT.md', 'EXPORT_MANIFEST.json'];
  const temporary = [];
  try {
    for (const name of outputs) {
      const dest = join(root, '.codex-evidence', name),
        tmp = dest + '.secondary.tmp';
      await writeFile(
        tmp,
        name.endsWith('.md') ? result.bytes : JSON.stringify(result.manifest, null, 2) + '\n',
        { flag: 'wx', mode: 0o600 },
      );
      temporary.push([tmp, dest]);
    }
    for (const [tmp, dest] of temporary) await rename(tmp, dest);
  } finally {
    for (const [tmp] of temporary) await unlink(tmp).catch(() => {});
  }
  return {
    status: result.manifest.secondaryScan.status,
    omittedEntries: result.manifest.secondaryScan.omittedEntries,
    exportBytes: result.manifest.exportBytes,
    exportSHA256: result.manifest.exportSHA256,
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 2 || !['--report', '--verify-report'].includes(args[0]))
      throw Error('Arguments rejected');
    console.log(
      JSON.stringify(
        await sanitizeEvidence({ reportPath: args[1], verify: args[0] === '--verify-report' }),
      ),
    );
  } catch {
    console.error('Secondary evidence processing failed closed; no finding content printed.');
    process.exitCode = 1;
  }
}

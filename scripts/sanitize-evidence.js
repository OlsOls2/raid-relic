// Operator-only offline secondary omission. Explicit selected artifacts and report;
// no raw/active session discovery, no finding values emitted or copied.
import { lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  evidenceEntries,
  evidenceSHA,
  readSelected,
  verifyEvidenceBytes,
  packageSelected,
  publishSelected,
  validateParts,
  PART_LIMIT,
  TOTAL_LIMIT,
  boundedFile,
  selectedFiles,
} from './verify-evidence.js';
const ruleName = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value);
// A v2 report is a private envelope, not a published scanner report. Every
// component (including zero findings) must be bound to the exact current bytes.
export function mappedReport(bytes, manifest, report) {
  if (manifest.formatVersion !== 2) {
    if (!Array.isArray(report)) throw Error('Legacy report rejected');
    return report;
  }
  validateParts(bytes, manifest);
  if (
    !report ||
    Object.keys(report).sort().join(',') !== 'components,exportSHA256,formatVersion' ||
    report.formatVersion !== 2 ||
    report.exportSHA256 !== evidenceSHA(bytes) ||
    !Array.isArray(report.components) ||
    report.components.length !== manifest.parts.length
  )
    throw Error('Report generation rejected');
  let offset = 0,
    lineOffset = 0;
  const findings = [];
  for (const [i, p] of manifest.parts.entries()) {
    const row = report.components[i];
    if (
      !row ||
      Object.keys(row).sort().join(',') !== 'bytes,findings,path,sha256' ||
      row.path !== p.path ||
      row.sha256 !== p.sha256 ||
      row.bytes !== p.bytes ||
      !Array.isArray(row.findings) ||
      row.findings.length > 10000 ||
      findings.length + row.findings.length > 10000
    )
      throw Error('Report component rejected');
    const text = new TextDecoder('utf8', { fatal: true }).decode(
      bytes.subarray(offset, offset + p.bytes),
    );
    const lineCount = text.split('\n').length;
    for (const f of row.findings) {
      if (
        !f ||
        ![p.path, `.codex-evidence/${p.path}`].includes(f.File) ||
        !Number.isSafeInteger(f.StartLine) ||
        f.StartLine < 1 ||
        !Number.isSafeInteger(f.EndLine ?? f.StartLine) ||
        (f.EndLine ?? f.StartLine) < f.StartLine ||
        (f.EndLine ?? f.StartLine) > lineCount - (i + 1 < manifest.parts.length ? 1 : 0)
      )
        throw Error('Report component location rejected');
      findings.push({
        ...f,
        File: 'EXPORTED_TRANSCRIPT.md',
        StartLine: f.StartLine + lineOffset,
        EndLine: (f.EndLine ?? f.StartLine) + lineOffset,
      });
    }
    offset += p.bytes;
    lineOffset += lineCount - 1;
  }
  return findings;
}
export function omitSecondary(bytes, manifest, report, reportSHA256) {
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.length > (manifest.formatVersion === 2 ? TOTAL_LIMIT : PART_LIMIT) ||
    manifest.exportBytes !== bytes.length ||
    manifest.exportSHA256 !== evidenceSHA(bytes)
  )
    throw Error('Selected input mismatch');
  report = mappedReport(bytes, manifest, report);
  if (!Array.isArray(report) || report.length > 10000 || !/^[a-f0-9]{64}$/.test(reportSHA256))
    throw Error('Report rejected');
  if (manifest.secondaryScan)
    throw Error('Fresh selected export required before a new omission pass');
  const text = new TextDecoder('utf8', { fatal: true }).decode(bytes),
    { lines, entries } = evidenceEntries(text),
    affected = new Map(),
    rules = Object.create(null);
  for (const finding of report) {
    if (
      !ruleName(finding.RuleID) ||
      typeof finding.File !== 'string' ||
      !['EXPORTED_TRANSCRIPT.md', '.codex-evidence/EXPORTED_TRANSCRIPT.md'].includes(
        finding.File,
      ) ||
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
  if (output.length > TOTAL_LIMIT) throw Error('Selected output too large');
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
  return packageSelected(output, next);
}
export function attestSecondary(bytes, manifest, report, reportSHA256) {
  report = mappedReport(bytes, manifest, report);
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
    ...(manifest.formatVersion === 2
      ? { scannedPartsSHA256: evidenceSHA(JSON.stringify(manifest.parts)) }
      : {}),
  };
  verifyEvidenceBytes(bytes, next);
  return next;
}
export async function sanitizeEvidence({ root = process.cwd(), reportPath, verify = false } = {}) {
  if (typeof reportPath !== 'string' || !reportPath)
    throw Error('Explicit private report required');
  const path = resolve(reportPath),
    s = await lstat(path);
  if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1 || s.size > 16 * 1024 * 1024)
    throw Error('Report file rejected');
  const raw = await boundedFile(path, 16 * 1024 * 1024),
    report = JSON.parse(raw),
    selected = await readSelected(root),
    digest = evidenceSHA(raw);
  const result = verify
    ? {
        bytes: selected.bytes,
        manifest: attestSecondary(selected.bytes, selected.manifest, report, digest),
      }
    : omitSecondary(selected.bytes, selected.manifest, report, digest);
  await publishSelected(
    root,
    {
      bytes: result.bytes,
      manifest: result.manifest,
      files: selectedFiles(result.bytes, result.manifest),
    },
    selected.manifestSHA256,
  );
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

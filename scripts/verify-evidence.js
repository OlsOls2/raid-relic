// Offline verification of selected public artifacts only. Never reads raw inputs.
import { readFile, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SESSION_ID } from './export-codex-evidence.js';
export const evidenceSHA = (bytes) => createHash('sha256').update(bytes).digest('hex');
const hash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const integer = (value) => Number.isSafeInteger(value) && value >= 0;
// Detect real key-shaped strings, including bounded ASCII escapes, never values in errors.
export function rejectStrongSelectedKeys(text) {
  const strong =
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16})/;
  let candidate = text;
  for (let i = 0; i < 4; i++) {
    if (strong.test(candidate)) throw Error('Selected strong credential pattern rejected');
    const decoded = candidate.replace(/\\u00([0-9a-f]{2})/gi, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16)),
    );
    if (decoded === candidate) return;
    candidate = decoded;
  }
  if (strong.test(candidate)) throw Error('Selected strong credential pattern rejected');
}
export function evidenceEntries(text) {
  // Exporter escapes four-backtick delimiters in bodies. Only headers outside
  // those fences are structural; embedded Markdown must never create entries.
  const lines = text.split('\n'),
    entries = [];
  let fenced = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === '````text') {
      if (fenced) throw Error('Evidence structure rejected');
      fenced = true;
      continue;
    }
    if (lines[i] === '````') {
      if (!fenced) throw Error('Evidence structure rejected');
      fenced = false;
      continue;
    }
    if (!fenced && /^### /.test(lines[i])) {
      const match = /^### (\d+)\. .* — .* \(source line (\d+)\)$/.exec(lines[i]);
      if (!match || Number(match[1]) !== entries.length + 1) throw Error('Evidence entry rejected');
      entries.push({ start: i, sourceLine: Number(match[2]) });
    }
  }
  if (fenced || !entries.length) throw Error('Evidence structure rejected');
  return {
    lines,
    entries: entries.map((entry, i) => ({
      ...entry,
      end: (entries[i + 1]?.start ?? lines.length) - 1,
    })),
  };
}
export function verifyEvidenceBytes(bytes, manifest) {
  if (!Buffer.isBuffer(bytes) || bytes.length > 16 * 1024 * 1024)
    throw Error('Evidence size rejected');
  const text = new TextDecoder('utf8', { fatal: true }).decode(bytes);
  rejectStrongSelectedKeys(text);
  const fields = new Set([
    'formatVersion',
    'sessionID',
    'inputLeaf',
    'rawSnapshotSHA256',
    'rawBytes',
    'eventCounts',
    'exportedEntries',
    'omissions',
    'firstTimestamp',
    'cutoff',
    'exportSHA256',
    'exportBytes',
    'sourceRunLogs',
    'sourceRunLogCount',
    'scope',
    'secondaryScan',
  ]);
  if (!manifest || Object.keys(manifest).some((key) => !fields.has(key)))
    throw Error('Unexpected evidence metadata');

  if (
    manifest?.formatVersion !== 1 ||
    manifest.sessionID !== SESSION_ID ||
    !hash(manifest.rawSnapshotSHA256) ||
    !integer(manifest.rawBytes) ||
    manifest.rawBytes > 200 * 1024 * 1024 ||
    manifest.exportBytes !== bytes.length ||
    manifest.exportSHA256 !== evidenceSHA(bytes)
  )
    throw Error('Evidence identity or digest rejected');
  if (
    !Number.isFinite(Date.parse(manifest.cutoff)) ||
    new Date(manifest.cutoff).toISOString() !== manifest.cutoff ||
    !text.includes(`Session: ${SESSION_ID}\n`) ||
    !text.includes(`Snapshot cutoff: ${manifest.cutoff} `)
  )
    throw Error('Evidence cutoff rejected');
  if (
    !manifest.eventCounts ||
    manifest.eventCounts.session_meta !== 1 ||
    Object.values(manifest.eventCounts).some((n) => !integer(n)) ||
    !Number.isFinite(Date.parse(manifest.firstTimestamp)) ||
    Date.parse(manifest.firstTimestamp) > Date.parse(manifest.cutoff)
  )
    throw Error('Evidence event metadata rejected');
  const { entries } = evidenceEntries(text);
  if (
    entries.at(-1).sourceLine > manifest.rawBytes ||
    manifest.exportedEntries >
      (manifest.eventCounts.response_item ?? 0) + (manifest.eventCounts.event_msg ?? 0)
  )
    throw Error('Evidence source-line count rejected');
  if (
    entries.length !== manifest.exportedEntries ||
    entries.some((e, i) => e.sourceLine < 1 || (i && e.sourceLine <= entries[i - 1].sourceLine))
  )
    throw Error('Evidence count rejected');
  const logs = manifest.sourceRunLogs;
  if (
    !Array.isArray(logs) ||
    !logs.length ||
    logs.length > 1000 ||
    manifest.sourceRunLogCount !== logs.length ||
    logs.some(
      (row, i) =>
        row.leaf !== `run-${String(i).padStart(3, '0')}.jsonl` ||
        Object.keys(row).sort().join(',') !== 'bytes,leaf,sha256' ||
        !integer(row.bytes) ||
        !hash(row.sha256),
    )
  )
    throw Error('Evidence run metadata rejected');
  const omissions = manifest.omissions;
  if (
    !omissions ||
    !['private', 'media', 'unselected', 'truncated', 'credentialLookingItems'].every((k) =>
      integer(omissions[k]),
    ) ||
    !omissions.credentialReasons ||
    Object.values(omissions.credentialReasons).some((n) => !integer(n)) ||
    Object.values(omissions.credentialReasons).reduce((a, b) => a + b, 0) !==
      omissions.credentialLookingItems
  )
    throw Error('Evidence omissions rejected');
  const scan = manifest.secondaryScan;
  if (
    scan?.status !== 'zero-findings' ||
    scan.scannedExportSHA256 !== manifest.exportSHA256 ||
    !hash(scan.reportSHA256) ||
    !integer(scan.omittedEntries) ||
    !integer(scan.findings) ||
    scan.omittedEntries > scan.findings ||
    scan.omittedEntries > entries.length ||
    !scan.rules ||
    Array.isArray(scan.rules) ||
    Object.values(scan.rules).some((n) => !integer(n)) ||
    Object.values(scan.rules).reduce((a, b) => a + b, 0) !== scan.findings
  )
    throw Error('Evidence secondary scan required');
  const omissionBodies = text
    .split('\n')
    .filter((line) => line.startsWith('[omitted after secondary secret scan; rules: ')).length;
  if (omissionBodies !== scan.omittedEntries)
    throw Error('Evidence secondary omission count rejected');
  return {
    sessionID: manifest.sessionID,
    cutoff: manifest.cutoff,
    exportedEntries: entries.length,
    sourceRunLogCount: logs.length,
    exportSHA256: manifest.exportSHA256,
    secondaryOmittedEntries: scan.omittedEntries,
  };
}
export async function readSelected(root) {
  const directory = await lstat(join(root, '.codex-evidence'));
  if (!directory.isDirectory() || directory.isSymbolicLink())
    throw Error('Evidence directory rejected');
  const paths = ['EXPORTED_TRANSCRIPT.md', 'EXPORT_MANIFEST.json'].map((name) =>
    join(root, '.codex-evidence', name),
  );
  for (const file of paths) {
    const s = await lstat(file);
    if (!s.isFile() || s.isSymbolicLink() || s.size > 16 * 1024 * 1024)
      throw Error('Evidence file rejected');
  }
  return {
    bytes: await readFile(paths[0]),
    manifest: JSON.parse(await readFile(paths[1], 'utf8')),
  };
}
export async function verifyEvidence(root = process.cwd()) {
  const { bytes, manifest } = await readSelected(root);
  return verifyEvidenceBytes(bytes, manifest);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 2) throw Error('Arguments rejected');
    console.log(JSON.stringify(await verifyEvidence()));
  } catch {
    console.error(
      'Selected evidence verification failed closed; no content or matched values printed.',
    );
    process.exitCode = 1;
  }
}

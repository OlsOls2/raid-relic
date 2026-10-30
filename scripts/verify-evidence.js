// Offline verification of selected public artifacts only. Never reads raw inputs.
import { lstat, open, readdir, writeFile, rename, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SESSION_ID } from './export-codex-evidence.js';
export const evidenceSHA = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const PART_LIMIT = 16 * 1024 * 1024;
export const TOTAL_LIMIT = 32 * 1024 * 1024;
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
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.length > (manifest?.formatVersion === 2 ? TOTAL_LIMIT : PART_LIMIT)
  )
    throw Error('Evidence size rejected');
  if (manifest?.formatVersion === 2) validateParts(bytes, manifest);
  else if (manifest?.parts || manifest?.indexBytes || manifest?.indexSHA256)
    throw Error('Legacy component metadata rejected');
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
    'parts',
    'indexSHA256',
    'indexBytes',
  ]);
  if (!manifest || Object.keys(manifest).some((key) => !fields.has(key)))
    throw Error('Unexpected evidence metadata');

  if (
    ![1, 2].includes(manifest?.formatVersion) ||
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
    (manifest.formatVersion === 2 &&
      scan.scannedPartsSHA256 !== evidenceSHA(JSON.stringify(manifest.parts))) ||
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
// Content-addressed, entry-aligned components. The manifest is the commit record.
const partPattern = /^EXPORTED_TRANSCRIPT\.part-(\d{3})-([a-f0-9]{64})\.md$/;
export function selectedIndex(manifest) {
  return Buffer.from(
    `# Selected transcript index\n\nThis file is an index, NOT the transcript. Concatenate the following components in order, without inserted bytes.\n\nSelected bytes: ${manifest.exportBytes}\n\nConcatenated SHA256: ${manifest.exportSHA256}\n\n${manifest.parts.map((p) => `- [${p.path}](${p.path}) (${p.bytes} bytes; SHA256 ${p.sha256}; ${p.entries} entries)`).join('\n')}\n`,
  );
}
export function packageSelected(bytes, manifest, partLimit = PART_LIMIT) {
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.length > TOTAL_LIMIT ||
    !Number.isSafeInteger(partLimit) ||
    partLimit < 1 ||
    partLimit > PART_LIMIT
  )
    throw Error('Selected aggregate size rejected');
  const next = structuredClone(manifest);
  next.exportBytes = bytes.length;
  next.exportSHA256 = evidenceSHA(bytes);
  if (bytes.length <= partLimit && manifest.formatVersion !== 2) {
    next.formatVersion = 1;
    delete next.parts;
    delete next.indexBytes;
    delete next.indexSHA256;
    return { bytes, manifest: next, files: [{ path: 'EXPORTED_TRANSCRIPT.md', bytes }] };
  }
  const text = new TextDecoder('utf8', { fatal: true }).decode(bytes);
  const { lines, entries } = evidenceEntries(text);
  const segments = entries.map((e, i) =>
    Buffer.from(
      lines.slice(i ? e.start : 0, entries[i + 1]?.start ?? lines.length).join('\n') +
        (i + 1 < entries.length ? '\n' : ''),
    ),
  );
  const chunks = [];
  let pending = [],
    size = 0,
    count = 0;
  const flush = () => {
    if (size) chunks.push({ bytes: Buffer.concat(pending, size), entries: count });
    pending = [];
    size = 0;
    count = 0;
  };
  for (const segment of segments) {
    if (segment.length > partLimit) throw Error('Single selected entry exceeds component limit');
    if (size + segment.length > partLimit) flush();
    pending.push(segment);
    size += segment.length;
    count++;
  }
  flush();
  if (!chunks.length || chunks.length > 128) throw Error('Component count rejected');
  next.formatVersion = 2;
  next.parts = chunks.map((c, i) => ({
    order: i + 1,
    path: `EXPORTED_TRANSCRIPT.part-${String(i + 1).padStart(3, '0')}-${next.exportSHA256}.md`,
    bytes: c.bytes.length,
    sha256: evidenceSHA(c.bytes),
    entries: c.entries,
  }));
  const index = selectedIndex(next);
  if (index.length > PART_LIMIT || bytes.length + index.length > TOTAL_LIMIT)
    throw Error('Published selected total rejected');
  next.indexBytes = index.length;
  next.indexSHA256 = evidenceSHA(index);
  return {
    bytes,
    manifest: next,
    files: [
      ...chunks.map((c, i) => ({ path: next.parts[i].path, bytes: c.bytes })),
      { path: 'EXPORTED_TRANSCRIPT.md', bytes: index },
    ],
  };
}
export function validateParts(bytes, manifest) {
  if (
    !Buffer.isBuffer(bytes) ||
    !integer(manifest.indexBytes) ||
    manifest.indexBytes > PART_LIMIT ||
    !Array.isArray(manifest.parts) ||
    !manifest.parts.length ||
    manifest.parts.length > 128 ||
    bytes.length + manifest.indexBytes > TOTAL_LIMIT
  )
    throw Error('Component metadata rejected');
  let offset = 0,
    count = 0;
  for (const [i, p] of manifest.parts.entries()) {
    if (
      Object.keys(p).sort().join(',') !== 'bytes,entries,order,path,sha256' ||
      p.order !== i + 1 ||
      p.path !==
        `EXPORTED_TRANSCRIPT.part-${String(i + 1).padStart(3, '0')}-${manifest.exportSHA256}.md` ||
      !integer(p.bytes) ||
      !p.bytes ||
      p.bytes > PART_LIMIT ||
      !integer(p.entries) ||
      !p.entries ||
      !hash(p.sha256)
    )
      throw Error('Component identity rejected');
    const chunk = bytes.subarray(offset, offset + p.bytes);
    if (chunk.length !== p.bytes || evidenceSHA(chunk) !== p.sha256)
      throw Error('Component digest rejected');
    // Every boundary is outside a fence, immediately before the next original header.
    const decoded = new TextDecoder('utf8', { fatal: true }).decode(chunk);
    const expected = count + 1;
    if (i + 1 < manifest.parts.length && !decoded.endsWith('\n'))
      throw Error('Component line boundary rejected');
    if (i && !decoded.startsWith(`### ${expected}. `)) throw Error('Component boundary rejected');
    const normalized = decoded.replace(/^### (\d+)\./gm, (line, n) => `### ${Number(n) - count}.`);
    if (evidenceEntries(normalized).entries.length !== p.entries)
      throw Error('Component entry count rejected');
    offset += p.bytes;
    count += p.entries;
  }
  const index = selectedIndex(manifest);
  if (
    offset !== bytes.length ||
    count !== manifest.exportedEntries ||
    manifest.indexBytes !== index.length ||
    manifest.indexSHA256 !== evidenceSHA(index)
  )
    throw Error('Component aggregate rejected');
}
export async function boundedFile(file, max) {
  if (!integer(max) || max > 200 * 1024 * 1024) throw Error('Read limit rejected');
  const before = await lstat(file);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > max)
    throw Error('Evidence file rejected');
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (
      stat.ino !== before.ino ||
      stat.dev !== before.dev ||
      stat.size !== before.size ||
      stat.nlink !== 1
    )
      throw Error('Evidence changed');
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const r = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!r.bytesRead) throw Error('Evidence shortened');
      offset += r.bytesRead;
    }
    const after = await handle.stat();
    const pathAfter = await lstat(file);
    if (
      after.size !== stat.size ||
      after.mtimeMs !== stat.mtimeMs ||
      after.ctimeMs !== stat.ctimeMs ||
      pathAfter.ino !== stat.ino ||
      pathAfter.dev !== stat.dev ||
      pathAfter.isSymbolicLink()
    )
      throw Error('Evidence changed');
    return bytes;
  } finally {
    await handle.close();
  }
}
export async function readSelected(root) {
  const dir = join(root, '.codex-evidence');
  const directory = await lstat(dir);
  if (!directory.isDirectory() || directory.isSymbolicLink())
    throw Error('Evidence directory rejected');
  if (
    (await readdir(dir)).some(
      (n) =>
        n === '.selected-generation.lock' ||
        /^EX(?:PORTED_TRANSCRIPT|PORT_MANIFEST).*\.generation\.tmp$/.test(n),
    )
  )
    throw Error('Generation in progress');
  const raw = await boundedFile(join(dir, 'EXPORT_MANIFEST.json'), 1024 * 1024);
  const manifest = JSON.parse(raw);
  if (![1, 2].includes(manifest?.formatVersion)) throw Error('Generation version rejected');
  const names = (await readdir(dir))
    .filter((n) => n.startsWith('EXPORTED_TRANSCRIPT.part-'))
    .sort();
  let bytes;
  if (manifest.formatVersion === 2) {
    if (
      !Array.isArray(manifest.parts) ||
      manifest.parts.length > 128 ||
      !integer(manifest.exportBytes) ||
      manifest.exportBytes > TOTAL_LIMIT
    )
      throw Error('Component list rejected');
    const expected = manifest.parts.map((p, i) => {
      if (
        p.path !==
          `EXPORTED_TRANSCRIPT.part-${String(i + 1).padStart(3, '0')}-${manifest.exportSHA256}.md` ||
        !partPattern.test(p.path) ||
        !integer(p.bytes) ||
        p.bytes > PART_LIMIT
      )
        throw Error('Component path rejected');
      return p.path;
    });
    if (
      JSON.stringify(names) !== JSON.stringify([...expected].sort()) ||
      manifest.parts.reduce((n, p) => n + p.bytes, 0) !== manifest.exportBytes
    )
      throw Error('Unlisted or missing component');
    const chunks = [];
    for (const p of manifest.parts) {
      const c = await boundedFile(join(dir, p.path), p.bytes);
      if (c.length !== p.bytes) throw Error('Component size rejected');
      chunks.push(c);
    }
    bytes = Buffer.concat(chunks, manifest.exportBytes);
    validateParts(bytes, manifest);
    const index = await boundedFile(join(dir, 'EXPORTED_TRANSCRIPT.md'), PART_LIMIT);
    if (!index.equals(selectedIndex(manifest))) throw Error('Index rejected');
  } else {
    if (names.length) throw Error('Stale components rejected');
    bytes = await boundedFile(join(dir, 'EXPORTED_TRANSCRIPT.md'), PART_LIMIT);
  }
  if (!(await boundedFile(join(dir, 'EXPORT_MANIFEST.json'), 1024 * 1024)).equals(raw))
    throw Error('Manifest changed during read');
  if (
    (await readdir(dir)).some(
      (n) =>
        n === '.selected-generation.lock' ||
        /^EX(?:PORTED_TRANSCRIPT|PORT_MANIFEST).*\.generation\.tmp$/.test(n),
    )
  )
    throw Error('Generation in progress');
  return { bytes, manifest, manifestSHA256: evidenceSHA(raw) };
}
export function selectedFiles(bytes, manifest) {
  if (manifest.formatVersion !== 2) return [{ path: 'EXPORTED_TRANSCRIPT.md', bytes }];
  validateParts(bytes, manifest);
  let offset = 0;
  return [
    ...manifest.parts.map((p) => {
      const chunk = bytes.subarray(offset, offset + p.bytes);
      offset += p.bytes;
      return { path: p.path, bytes: chunk };
    }),
    { path: 'EXPORTED_TRANSCRIPT.md', bytes: selectedIndex(manifest) },
  ];
}
// Single operator only; lock excludes overlapping exporter/sanitizer generations.
export async function publishSelected(root, packaged, expectedManifestSHA256) {
  const dir = join(root, '.codex-evidence');
  const info = await lstat(dir);
  if (!info.isDirectory() || info.isSymbolicLink()) throw Error('Output directory rejected');
  if (packaged.manifest.formatVersion === 2) validateParts(packaged.bytes, packaged.manifest);
  if (Buffer.byteLength(JSON.stringify(packaged.manifest, null, 2) + '\n') > 1024 * 1024)
    throw Error('Manifest size rejected');
  const canonical = selectedFiles(packaged.bytes, packaged.manifest);
  if (
    packaged.bytes.length > (packaged.manifest.formatVersion === 2 ? TOTAL_LIMIT : PART_LIMIT) ||
    packaged.manifest.exportBytes !== packaged.bytes.length ||
    packaged.manifest.exportSHA256 !== evidenceSHA(packaged.bytes) ||
    !Array.isArray(packaged.files) ||
    packaged.files.length !== canonical.length ||
    packaged.files.some(
      (f, i) =>
        f.path !== canonical[i].path ||
        !Buffer.isBuffer(f.bytes) ||
        !f.bytes.equals(canonical[i].bytes),
    )
  )
    throw Error('Generation output rejected');
  const lock = join(dir, '.selected-generation.lock');
  const handle = await open(lock, 'wx', 0o600);
  const temps = [];
  try {
    if (expectedManifestSHA256 !== undefined) {
      let current = null;
      try {
        current = evidenceSHA(await boundedFile(join(dir, 'EXPORT_MANIFEST.json'), 1024 * 1024));
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
      if (current !== expectedManifestSHA256) throw Error('Stale generation rejected');
    }
    for (const f of [
      ...packaged.files,
      {
        path: 'EXPORT_MANIFEST.json',
        bytes: Buffer.from(JSON.stringify(packaged.manifest, null, 2) + '\n'),
      },
    ]) {
      if (
        !['EXPORTED_TRANSCRIPT.md', 'EXPORT_MANIFEST.json'].includes(f.path) &&
        !partPattern.test(f.path)
      )
        throw Error('Output path rejected');
      const dest = join(dir, f.path);
      try {
        const stat = await lstat(dest);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
          throw Error('Output rejected');
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
      const tmp = dest + '.generation.tmp';
      await writeFile(tmp, f.bytes, { flag: 'wx', mode: 0o600 });
      temps.push([tmp, dest]);
    }
    // Readers reject the old/new mismatch until the final manifest rename.
    for (const [tmp, dest] of temps) await rename(tmp, dest);
    const keep = new Set(packaged.manifest.parts?.map((p) => p.path) ?? []);
    for (const name of await readdir(dir))
      if (partPattern.test(name) && !keep.has(name)) await unlink(join(dir, name));
  } finally {
    for (const [tmp] of temps) await unlink(tmp).catch(() => {});
    await handle.close();
    await unlink(lock);
  }
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

// Offline submission exporter. Never discover Codex/auth directories or active rollouts.
import { readFile, readdir, lstat, realpath, writeFile, rename } from 'node:fs/promises';
import { resolve, dirname, basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
export const SESSION_ID = '01a1705c-a87d-7143-80f6-021e47b78ced';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const MAX_BYTES = 200 * 1024 * 1024, MAX_TEXT = 32768;
const fixtures = new Set(['synthetic', 'synthetic-key', 'synthetic-test-only-key', 'synthetic-forge-test-key', 'synthetic-app', 'synthetic-client-secret', 'synthetic-pilot-hmac-secret', 'synthetic-journey-test-secret', 'synthetic-overlay-test-secret']);
function placeholder(value) { return fixtures.has(value) || /^\$\{[\w.]+\}?$/.test(value) || /^<[^<>]{1,80}>$/.test(value) || /^(?:YOUR_[A-Z_]+|PLACEHOLDER)$/.test(value); }
class CredentialLookingItem extends Error {
  constructor(category) { super(`Credential-looking item: ${category}`); this.category = category; }
}
function scan(text, keysOnly = false) {
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16})/.test(text)) throw Error('Credential scan failed (key pattern); no export written');
  if (keysOnly) return;
  for (const match of text.matchAll(/\b(?:access_token|refresh_token|client_secret|OPENAI_API_KEY|TWITCH_CLIENT_SECRET|TOKEN_ENCRYPTION_KEY|password)["']?\s*[:=]\s*["'`]([^"'`\r\n]+)["'`]/gi)) {
    if (!placeholder(match[1])) throw new CredentialLookingItem('literal assignment');
  }
  for (const match of text.matchAll(/\b(?:authorization|proxy-authorization)["']?\s*[:=]\s*["'`]?\s*(?:Bearer|OAuth|Basic)\s+([^\s"'`,;\]]+)/gi)) {
    const token = match[1].replace(/[)}]+$/, ''); if (!placeholder(token)) throw new CredentialLookingItem('authorization');
  }
}
const sensitive = /^(?:authorization|proxy-authorization|access_token|refresh_token|client_secret|password|OPENAI_API_KEY|TWITCH_CLIENT_SECRET|TOKEN_ENCRYPTION_KEY)$/i;
function clean(value, omissions, key = '', keysOnly = false) {
  if (key === 'encrypted_content' || /^(?:reasoning|analysis|system_prompt|developer_instructions|instructions)$/.test(key)) { omissions.private++; return '[private/opaque field omitted]'; }
  if (value && typeof value === 'object') {
    if (['reasoning', 'analysis', 'analysis_text', 'reasoning_text', 'summary_text'].includes(value.type)) { omissions.private++; return '[private reasoning block omitted]'; }
    if (['image', 'input_image', 'output_image', 'audio', 'input_audio', 'output_audio', 'image_url'].includes(value.type)) { omissions.media++; return '[media omitted]'; }
    if (Array.isArray(value)) return value.map(v => clean(v, omissions, '', keysOnly));
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clean(v, omissions, k, keysOnly)]));
  }
  if (typeof value !== 'string') return value;
  // Tool argument/output strings may themselves contain encoded JSON. Inspect its
  // decoded keys/values before serializing, rather than bypassing the scanner.
  if (/^\s*[\[{]/.test(value)) { let parsed; try { parsed = JSON.parse(value); } catch {} if (parsed && typeof parsed === 'object') return clean(parsed, omissions, '', keysOnly); }
  if (/^\s*(?:# Raid Relic authoring rules|<skills_instructions>|<permissions instructions>|<environment_context>|<INSTRUCTIONS>)/.test(value)
    || /# Raid Relic authoring rules|AGENTS\.md instructions for|<multi_agent_role>|You are Codex, an agent based/.test(value)) { omissions.private++; return '[bootstrap/instruction block omitted]'; }
  const visible = value.replace(/data:(?:image|audio|video)\/[^\s"'<>]+;base64,[A-Za-z0-9+/=]+/g, () => { omissions.media++; return '[media omitted]'; });
  scan(visible, keysOnly);
  if (!keysOnly && sensitive.test(key)) {
    const token = visible.replace(/^(?:Bearer|OAuth|Basic)\s+/i, '');
    if (!placeholder(token)) throw new CredentialLookingItem('sensitive field');
  }
  return visible;
}
export function transcriptFrom(raw) {
  if (!Buffer.isBuffer(raw) || raw.length > MAX_BYTES) throw Error('Input size rejected');
  let text; try { text = new TextDecoder('utf-8', { fatal: true }).decode(raw); } catch { throw Error('Invalid UTF8 input'); }
  const lines = text.split('\n'); const counts = {}, omissions = { private: 0, media: 0, unselected: 0, truncated: 0, credentialLookingItems: 0, credentialReasons: {} };
  const entries = []; let meta = 0, firstTimestamp = null, lastTimestamp = null;
  for (let n = 0; n < lines.length; n++) {
    if (!lines[n].trim()) continue; let row; try { row = JSON.parse(lines[n]); } catch { throw Error(`Broken JSON at line ${n + 1}; no export written`); }
    if (!row || typeof row.type !== 'string' || !row.payload || typeof row.payload !== 'object') throw Error(`Invalid event at line ${n + 1}`);
    counts[row.type] = (counts[row.type] ?? 0) + 1;
    const stamp = typeof row.timestamp === 'string' && !Number.isNaN(Date.parse(row.timestamp)) ? new Date(row.timestamp).toISOString() : null;
    if (stamp) { firstTimestamp ??= stamp; lastTimestamp = stamp; }
    const p = row.payload;
    if (row.type === 'session_meta') { if (p.id !== SESSION_ID) throw Error('Session mismatch; no export written'); meta++; continue; }
    let label, content;
    if (row.type === 'response_item' && p.type === 'message' && ['user', 'assistant'].includes(p.role)) { label = p.role; content = p.content; }
    else if (row.type === 'response_item' && ['function_call', 'custom_tool_call'].includes(p.type)) { label = 'tool call'; content = { name: p.name, call_id: p.call_id, input: p.arguments ?? p.input }; }
    else if (row.type === 'response_item' && ['function_call_output', 'custom_tool_call_output'].includes(p.type)) { label = 'tool result'; content = { call_id: p.call_id, output: p.output }; }
    // Native event_msg often duplicates response_item messages. Export it too,
    // explicitly labelled, rather than silently guessing which copy is canonical.
    else if (row.type === 'event_msg' && ['user_message', 'agent_message'].includes(p.type)) { label = `${p.type} (event record; may duplicate message)`; content = p.message; }
    else { omissions.unselected++; continue; }
    if (p.phase === 'analysis' || p.channel === 'analysis') { omissions.private++; continue; }
    // Traverse every visible field for fatal key patterns FIRST. A suspicious
    // early literal must never hide a later strong key in the same item.
    clean(content, { private: 0, media: 0 }, '', true);
    let body;
    try {
      const safe = clean(content, omissions);
      body = typeof safe === 'string' ? safe : JSON.stringify(safe, null, 2);
    } catch (error) {
      if (!(error instanceof CredentialLookingItem)) throw error;
      omissions.credentialLookingItems++;
      omissions.credentialReasons[error.category] = (omissions.credentialReasons[error.category] ?? 0) + 1;
      body = `[credential-looking item omitted in full; reason: ${error.category}; no credential status assumed]`;
    }
    if (body.length > MAX_TEXT) { omissions.truncated++; body = body.slice(0, MAX_TEXT) + `\n[bounded output: ${body.length - MAX_TEXT} characters omitted; sanitized item SHA256 ${sha(body)}]`; }
    entries.push(`### ${entries.length + 1}. ${stamp ?? 'timestamp unavailable'} — ${label} (source line ${n + 1})\n\n\`\`\`\`text\n${body.replaceAll('````', '[four-backtick delimiter escaped]')}\n\`\`\`\`\n`);
  }
  if (meta !== 1) throw Error('Exactly one matching session_meta required');
  const header = `# Sanitized Codex transcript\n\nSession: ${SESSION_ID}\n\nSnapshot cutoff: ${lastTimestamp ?? 'unavailable'} (last timestamped record; not a claim that future/active conversation is included).\n\nThis is a readable selected native-JSONL export, NOT a complete raw transcript. User/assistant messages and tool calls/results are retained; duplicate native event records are labelled. Private system/developer/bootstrap instructions, reasoning/analysis, opaque encrypted fields, media/base64 and other internal metadata are omitted. Each item is capped at ${MAX_TEXT} characters with an explicit omission count and sanitized-item digest. No raw-backup links or private credentials are published. Credential-looking literals, headers or sensitive fields cause whole-item content omission, with source line and reason retained; counts are in the manifest. Strong key patterns remain fatal across all selected visible fields, even in otherwise omitted items. Existing synthetic fixture literals are explicitly classified, not proof of real authentication.\n\n`;
  const markdown = header + entries.join('\n'); scan(markdown);
  return { markdown, counts, omissions, exportedEntries: entries.length, firstTimestamp, cutoff: lastTimestamp };
}
async function regular(file, max = MAX_BYTES) { const info = await lstat(file); if (!info.isFile() || info.isSymbolicLink() || info.size > max) throw Error('Source file rejected'); return info; }
export async function exportEvidence({ root = process.cwd(), input } = {}) {
  if (typeof input !== 'string' || !input) throw Error('Explicit --input required');
  const base = await realpath(root), evidence = join(base, '.codex-evidence'), backups = join(evidence, 'rollout-backups');
  for (const dir of [evidence, backups]) { const stat = await lstat(dir); if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('Source directory rejected'); }
  const file = resolve(base, input), leaf = basename(file);
  if (dirname(file) !== backups || !new RegExp(`^rollout-[A-Za-z0-9_.:T-]+-${SESSION_ID}\\.jsonl$`).test(leaf)) throw Error('Explicit owned snapshot path/session filename required');
  const before = await regular(file); const raw = await readFile(file); const after = await regular(file);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || raw.length !== before.size) throw Error('Snapshot changed during read');
  const parsed = transcriptFrom(raw);
  const sourceRunLogs = [];
  for (const name of (await readdir(evidence)).filter(name => /^run-\d{3}\.jsonl$/.test(name)).sort()) {
    const path = join(evidence, name); await regular(path); const bytes = await readFile(path); sourceRunLogs.push({ leaf: name, bytes: bytes.length, sha256: sha(bytes) });
  }
  const manifest = { formatVersion: 1, sessionID: SESSION_ID, inputLeaf: leaf, rawSnapshotSHA256: sha(raw), rawBytes: raw.length,
    eventCounts: parsed.counts, exportedEntries: parsed.exportedEntries, omissions: parsed.omissions, firstTimestamp: parsed.firstTimestamp,
    cutoff: parsed.cutoff, exportSHA256: sha(parsed.markdown), exportBytes: Buffer.byteLength(parsed.markdown), sourceRunLogs,
    scope: 'Selected sanitized native JSONL; private/internal/media omitted and per-item output bounded. Raw snapshot remains local ignored.' };
  scan(JSON.stringify(manifest));
  // Refuse symlink destinations; only these two approved outputs can be written.
  for (const name of ['EXPORTED_TRANSCRIPT.md', 'EXPORT_MANIFEST.json']) {
    try { if (!(await lstat(join(evidence, name))).isFile()) throw Error('Output rejected'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    try { await lstat(join(evidence, `${name}.tmp`)); throw Error('Existing temporary output rejected'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  await writeFile(join(evidence, 'EXPORTED_TRANSCRIPT.md.tmp'), parsed.markdown, { flag: 'wx', mode: 0o600 });
  await writeFile(join(evidence, 'EXPORT_MANIFEST.json.tmp'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  await rename(join(evidence, 'EXPORTED_TRANSCRIPT.md.tmp'), join(evidence, 'EXPORTED_TRANSCRIPT.md'));
  await rename(join(evidence, 'EXPORT_MANIFEST.json.tmp'), join(evidence, 'EXPORT_MANIFEST.json'));
  return { exportedEntries: parsed.exportedEntries, cutoff: parsed.cutoff, exportSHA256: manifest.exportSHA256 };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { if (process.argv.length !== 4 || process.argv[2] !== '--input') throw Error('Expected --input');
    const result = await exportEvidence({ input: process.argv[3] }); console.log(JSON.stringify(result));
  } catch { console.error('Evidence export failed closed. Check the owned snapshot path, session, JSON integrity and credential scan; no matched value is printed.'); process.exitCode = 1; }
}

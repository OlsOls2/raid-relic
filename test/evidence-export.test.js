import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { transcriptFrom, exportEvidence, SESSION_ID } from '../scripts/export-codex-evidence.js';
import { releaseFiles } from '../scripts/release-files.js';
const row = (type, payload) => ({ timestamp: '2026-10-25T12:00:00Z', type, payload });
const snapshot = rows => Buffer.from([row('session_meta', { id: SESSION_ID }), ...rows].map(v => JSON.stringify(v)).join('\n') + '\n');
const message = (role, text) => row('response_item', { type: 'message', role, content: [{ type: 'output_text', text }] });
async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), 'raid-relic-export-test-')); t.after(() => rm(root, { recursive: true, force: true }));
  const evidence = join(root, '.codex-evidence'); await mkdir(join(evidence, 'rollout-backups'), { recursive: true });
  const input = join(evidence, 'rollout-backups', `rollout-2026-10-25-${SESSION_ID}.jsonl`); return { root, evidence, input };
}
test('native export retains readable timestamped user/assistant/tool calls/results while excluding private/opaque/media', () => {
  const raw = snapshot([message('user', 'Build the local health route'), message('assistant', 'Implemented and tested'), message('system', 'PRIVATE_SYSTEM'), message('developer', 'PRIVATE_DEVELOPER'),
    row('response_item', { type: 'reasoning', encrypted_content: 'OPAQUE_CANARY', summary: 'PRIVATE_REASONING' }),
    row('response_item', { type: 'message', role: 'assistant', channel: 'analysis', content: [{ text: 'PRIVATE_ANALYSIS' }] }),
    row('response_item', { type: 'function_call', name: 'exec', call_id: 'c1', arguments: '{"cmd":"npm test"}' }),
    row('response_item', { type: 'function_call_output', call_id: 'c1', output: '{"output":"tests passed","encrypted_content":"OPAQUE_FIELD"}' }),
    row('response_item', { type: 'message', role: 'user', content: [{ type: 'input_image', data: 'BASE64_CANARY' }] }),
    message('user', '# AGENTS.md instructions for /repo\nPRIVATE_BOOTSTRAP'), row('event_msg', { type: 'agent_message', message: 'Final outcome' })]);
  const result = transcriptFrom(raw); for (const word of ['Build the local health route', 'Implemented and tested', 'npm test', 'tests passed', 'Final outcome', '2026-10-25']) assert.ok(result.markdown.includes(word));
  for (const word of ['PRIVATE_SYSTEM', 'PRIVATE_DEVELOPER', 'PRIVATE_REASONING', 'PRIVATE_ANALYSIS', 'OPAQUE_CANARY', 'OPAQUE_FIELD', 'BASE64_CANARY', 'PRIVATE_BOOTSTRAP']) assert.ok(!result.markdown.includes(word));
  assert.ok(result.omissions.private > 0); assert.ok(result.omissions.media > 0);
});
test('credential values fail closed before output, fixture classification is narrow; bounds are explicitly disclosed', async t => {
  const f = await setup(t);
  const dangerous = ['sk-' + 'A'.repeat(35), ['-----BEGIN', 'PRIVATE KEY-----'].join(' ')];
  for (const value of dangerous) { await writeFile(f.input, snapshot([message('assistant', value)])); await assert.rejects(exportEvidence({ root: f.root, input: f.input }), error => !error.message.includes('unownedCredentialValue12345')); }
  await assert.rejects(readFile(join(f.evidence, 'EXPORTED_TRANSCRIPT.md')), { code: 'ENOENT' });
  const safe = transcriptFrom(snapshot([message('assistant', JSON.stringify({ client_secret: 'synthetic-client-secret' })), message('assistant', 'x'.repeat(40000))])); assert.equal(safe.omissions.truncated, 1); assert.match(safe.markdown, /bounded output/);
});
test('wrong session/broken JSON/UTF8 fail closed without reflecting source values', () => {
  assert.throws(() => transcriptFrom(Buffer.from('{not-json-private-value')), /Broken JSON at line 1/);
  assert.throws(() => transcriptFrom(Buffer.from([255])), /UTF8/);
  assert.throws(() => transcriptFrom(Buffer.from(JSON.stringify(row('session_meta', { id: 'another-thread' })))), /Session mismatch/);
  assert.throws(() => transcriptFrom(Buffer.from('')), /matching session_meta/);
});
test('explicit snapshot allowlist rejects escape/symlinks and exports reproducibly with hashes and source-run manifest', async t => {
  const f = await setup(t); const raw = snapshot([message('user', 'Proceed'), message('assistant', 'Done')]); await writeFile(f.input, raw); await writeFile(join(f.evidence, 'run-041.jsonl'), 'curated cli fixture\n');
  await assert.rejects(exportEvidence({ root: f.root })); await assert.rejects(exportEvidence({ root: f.root, input: '../auth.json' }));
  const link = join(f.evidence, 'rollout-backups', `rollout-link-${SESSION_ID}.jsonl`); await symlink(f.input, link); await assert.rejects(exportEvidence({ root: f.root, input: link }));
  await exportEvidence({ root: f.root, input: f.input }); const first = await readFile(join(f.evidence, 'EXPORTED_TRANSCRIPT.md')); const manifest = JSON.parse(await readFile(join(f.evidence, 'EXPORT_MANIFEST.json')));
  assert.equal(manifest.sessionID, SESSION_ID); assert.equal(manifest.rawSnapshotSHA256, createHash('sha256').update(raw).digest('hex')); assert.equal(manifest.exportSHA256, createHash('sha256').update(first).digest('hex')); assert.equal(manifest.sourceRunLogs[0].leaf, 'run-041.jsonl');
  await exportEvidence({ root: f.root, input: f.input }); assert.deepEqual(await readFile(join(f.evidence, 'EXPORTED_TRANSCRIPT.md')), first);
});
test('exporter/evidence stay excluded from runtime release', async () => {
  assert.ok((await releaseFiles(process.cwd())).every(({ file }) => !file.startsWith('scripts/') && !file.startsWith('.codex-evidence/')));
});

test('unknown credential-looking items are omitted whole, while other readable items remain', () => {
  const values = ['password: "unknownLiteralCanary"', 'Authorization: Bearer unknownHeaderCanary', JSON.stringify({ ['refresh' + '_token']: 'unknownFieldCanary' })];
  const result = transcriptFrom(snapshot([...values.map(value => message('assistant', 'Do not retain any of this item: ' + value)), message('user', 'Readable next prompt')]));
  assert.equal(result.omissions.credentialLookingItems, 3);
  assert.deepEqual(result.omissions.credentialReasons, { 'literal assignment': 2, authorization: 1 });
  for (const value of ['unknownLiteralCanary', 'unknownHeaderCanary', 'unknownFieldCanary', 'Do not retain any of this item']) assert.ok(!result.markdown.includes(value));
  assert.match(result.markdown, /credential-looking item omitted in full/);
  assert.match(result.markdown, /source line 2/);
  assert.match(result.markdown, /Readable next prompt/);
  const decoded = transcriptFrom(snapshot([row('response_item', { type: 'function_call', name: 'exec', arguments: JSON.stringify({ ['refresh' + '_token']: 'unknownDecodedCanary' }) })]));
  assert.equal(decoded.omissions.credentialReasons['sensitive field'], 1);
  assert.ok(!decoded.markdown.includes('unknownDecodedCanary'));
});
test('whole-item omission cannot hide later strong keys in plaintext or nested decoded fields', () => {
  for (const strong of ['sk-' + 'A'.repeat(35), 'github_' + 'pat_' + 'B'.repeat(30), ['-----BEGIN', 'PRIVATE KEY-----'].join(' ')]) {
    for (const content of ['password: "unknownEarlierCanary" ' + strong, { ['refresh' + '_token']: 'unknownEarlierCanary', later: { output: strong } }]) {
      assert.throws(() => transcriptFrom(snapshot([row('response_item', { type: 'function_call', arguments: typeof content === 'string' ? content : JSON.stringify(content) })])), /key pattern/);
    }
  }
});

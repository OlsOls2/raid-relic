import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pilotFixture, HOME, OTHER } from '../test-support/pilot-fixture.js';
import { releaseFiles } from '../scripts/release-files.js';

test('brand-new configured channels expose truthful waiting/zero state with no provider work or unknown-channel access', async () => {
  const f = await pilotFixture();
  for (const id of [HOME, OTHER]) {
    const response = await f.request(`/api/overlay/${id}`); assert.equal(response.status, 200);
    const snapshot = JSON.parse(response.body);
    assert.equal(snapshot.status, 'waiting'); assert.equal(snapshot.approvedCount, 0); assert.equal(snapshot.lineageRings, 0);
    assert.equal(snapshot.handoff, null); assert.deepEqual(snapshot.marks, []);
    assert.ok(!JSON.stringify(snapshot).includes('streamId')); assert.ok(!JSON.stringify(snapshot).includes('userId'));
  }
  const atlas = JSON.parse((await f.request('/api/atlas')).body); assert.equal(atlas.total, 0); assert.deepEqual(atlas.stops, []);
  assert.equal((await f.request('/overlay/999')).status, 404); assert.equal(f.calls.length, 0);
});
test('polish keeps source and corner assets accessible and excludes local browser harness/demo from release', async () => {
  const html = await readFile('public/overlay-live.html', 'utf8');
  assert.match(html, /id="waiting-note" hidden>No active relic state for this channel/);
  assert.match(html, /id="status" role="status" aria-live="polite"/);
  assert.match(html, /aria-label="Enable optional overlay sounds"/);
  const files = await releaseFiles(process.cwd());
  assert.ok(files.every(({ file }) => !file.startsWith('scripts/') && !file.startsWith('docs/') && !file.startsWith('test-support/')));
  const demo = await readFile('docs/DEMO_SCRIPT.md', 'utf8');
  assert.match(demo, /2:45/); assert.match(demo, /01a1705c-a87d-7143-80f6-021e47b78ced/); assert.match(demo, /not evidence of completed live validation/);
});
test('archive palette provides AA normal-text contrast without external typography/assets', async () => {
  const css = await readFile('public/atlas.css', 'utf8');
  const color = token => css.match(new RegExp(`--${token}:(#[a-f0-9]{6})`))[1];
  const luminance = hex => hex.slice(1).match(/../g).map(v => parseInt(v, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
  for (const foreground of ['moon', 'muted', 'amber', 'violet']) {
    const values = [luminance(color(foreground)), luminance(color('deep'))].sort((a, b) => b - a);
    assert.ok((values[0] + .05) / (values[1] + .05) >= 4.5, foreground);
  }
  assert.ok(!/@import|https?:\/\/|@font-face/.test(css));
});

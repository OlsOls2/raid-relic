import test from 'node:test';
import assert from 'node:assert/strict';
import { pilotFixture, HOME, OTHER, BOT } from '../test-support/pilot-fixture.js';
import { holderLoginView } from '../src/public-view.js';
import { validSnapshot } from '../public/overlay-client.js';
import { readFile } from 'node:fs/promises';
test('registry holder is optional/closed and never inferred from readiness or legacy archive', () => {
  assert.equal(holderLoginView({}), undefined);
  assert.equal(holderLoginView({ holderId: 'unknown' }), undefined);
  assert.equal(holderLoginView({ holderId: '__proto__' }), undefined);
  assert.equal(holderLoginView({ holderId: HOME }), 'raidrelichq');
  const old = {
    type: 'snapshot',
    revision: 0,
    mode: 'live',
    status: 'ready',
    lineageRings: 0,
    marks: [],
    approvedCount: 0,
  };
  assert.equal(validSnapshot(old), true);
  assert.equal(validSnapshot({ ...old, holderLogin: 'olsols2' }), true);
  assert.equal(validSnapshot({ ...old, holderLogin: 'arbitrary_user' }), false);
  assert.equal(
    validSnapshot({
      ...old,
      status: 'waiting',
      holderLogin: 'raidrelichq',
      movedToLogin: 'olsols2',
    }),
    false,
  );
});
for (const kind of ['memory', 'firestore'])
  test(`${kind}: actual completed holder persists after handoff expiry, old room stays distinct`, async () => {
    const f = await pilotFixture(kind);
    for (const id of [BOT, HOME, OTHER]) await f.login(id);
    for (const id of [HOME, OTHER]) {
      await f.control(id, 'bootstrap');
      f.advance();
      await f.control(id, 'keep');
      f.advance();
    }
    await f.control(HOME, `send:${OTHER}`);
    await f.chat(HOME, '811', '!offer');
    f.advance();
    await f.raid();
    await f.chat(OTHER, '812', '!accept');
    f.advance(180001);
    for (const host of [HOME, OTHER]) {
      const s = await f.runtime.overlayFeeds[host].snapshot();
      assert.equal(s.holderLogin, 'olsols2');
      assert.equal(s.lineageRings, 1);
      assert.equal(s.handoff, null);
      assert.equal(validSnapshot(s), true);
    }
    assert.equal((await f.runtime.state.getKeeperRegistry()).holderId, OTHER);
  });
test('one footer fan notice on normal pages, no OBS branding disclaimer, permanent demo banner and identity', async () => {
  for (const name of ['atlas', 'demo']) {
    const html = await readFile(`public/${name}.html`, 'utf8');
    assert.equal(
      (html.match(/Unofficial fan project\. Not affiliated with Twitch\./g) ?? []).length,
      1,
    );
    assert.match(
      html,
      /<footer>[\s\S]*Unofficial fan project\. Not affiliated with Twitch\.[\s\S]*<\/footer>/,
    );
  }
  const demo = await readFile('public/demo.html', 'utf8');
  assert.equal((demo.match(/id="demo-banner"/g) ?? []).length, 1);
  assert.match(demo, /does not affect the real relic/);
  assert.match(demo, /demo-send-reason/);
  assert.ok(!(await readFile('public/edition-view.js', 'utf8')).includes('FAN_DISCLAIMER'));
});

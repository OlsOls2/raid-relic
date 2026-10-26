import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pilotFixture, HOME, OTHER, BOT } from '../test-support/pilot-fixture.js';
async function ready(f) {
  for (const id of [BOT, HOME, OTHER]) await f.login(id);
  for (const id of [HOME, OTHER]) {
    await f.control(id, 'bootstrap');
    f.advance();
    await f.control(id, 'keep');
    f.advance();
  }
}
async function status(f, id) {
  const response = await f.request(`/control/${id}/status`, 'GET', { cookie: f.cookies[id] });
  assert.equal(response.status, 200);
  return JSON.parse(response.body).pilot;
}
for (const kind of ['memory', 'firestore']) {
  test(`${kind}: scoped observed candidate snapshot supports both holder directions without provider requests`, async () => {
    const f = await pilotFixture(kind);
    await ready(f);
    let count = f.calls.length;
    const home = await status(f, HOME);
    assert.deepEqual(home.candidates, [
      { id: OTHER, login: 'olsols2', observedOnline: true, optedIn: true, eligible: true },
    ]);
    assert.equal(home.candidatesObservedAt, f.now());
    assert.deepEqual((await status(f, OTHER)).candidates, []);
    assert.equal(f.calls.length, count);
    assert.ok(!JSON.stringify(home.candidates).includes('token'));
    assert.ok(!JSON.stringify(home.candidates).includes('streamId'));
    f.advance();
    await f.raid();
    await f.chat(HOME, HOME, '!offer');
    await f.chat(OTHER, OTHER, '!accept');
    count = f.calls.length;
    assert.equal((await status(f, OTHER)).candidates[0].id, HOME);
    assert.deepEqual((await status(f, HOME)).candidates, []);
    assert.equal(f.calls.length, count);
    const before = f.calls.length;
    assert.equal(
      (await f.request(`/control/${HOME}/status`, 'GET', { cookie: f.cookies[OTHER] })).status,
      401,
    );
    assert.equal(
      (await f.control(HOME, `send:${OTHER}`, { cookie: f.cookies[OTHER] })).status,
      403,
    );
    assert.equal(f.calls.length, before);
  });
  test(`${kind}: offline, unopted, paused, banned, blocked and self are excluded from observed targets`, async () => {
    for (const condition of [
      'offline',
      'unopted',
      'paused',
      'banned',
      'blocked',
      'source-paused',
    ]) {
      const f = await pilotFixture(kind);
      await ready(f);
      if (condition === 'offline')
        await f.signed('stream.offline', { broadcaster_user_id: OTHER }, OTHER);
      if (condition === 'unopted') await f.control(OTHER, 'opt-out');
      if (condition === 'paused') await f.control(OTHER, 'pause');
      if (condition === 'source-paused') await f.control(HOME, 'pause');
      if (condition === 'banned')
        await f.runtime.state.setChannelPolicy(
          OTHER,
          { banned: true, blockedUserIds: [] },
          f.now(),
        );
      if (condition === 'blocked') await f.chat(HOME, HOME, `!relic block ${OTHER}`);
      const before = f.calls.length;
      assert.deepEqual((await status(f, HOME)).candidates, [], condition);
      assert.equal(f.calls.length, before);
      assert.ok(!(await status(f, OTHER)).candidates.some((candidate) => candidate.id === OTHER));
    }
  });
  test(`${kind}: stale selection cannot reserve or dispatch a now-ineligible target`, async () => {
    const f = await pilotFixture(kind);
    await ready(f);
    assert.equal((await status(f, HOME)).candidates[0].id, OTHER);
    await f.signed('stream.offline', { broadcaster_user_id: OTHER }, OTHER);
    await f.control(HOME, `send:${OTHER}`);
    assert.equal((await f.runtime.state.getKeeperRegistry()).send, undefined);
    assert.equal(f.calls.filter((c) => c.url.includes('/raids')).length, 0);
    const g = await pilotFixture(kind);
    await ready(g);
    assert.equal((await status(g, HOME)).candidates[0].id, OTHER);
    g.hook(async () => {
      g.hook(null);
      await g.runtime.state.controlMarks(
        OTHER,
        { broadcasterId: OTHER, chatterId: OTHER },
        { type: 'pause', paused: true },
        g.now(),
      );
    });
    await g.control(HOME, `send:${OTHER}`);
    assert.equal(g.calls.filter((c) => c.url.includes('/raids')).length, 0);
    assert.equal((await g.runtime.state.getKeeperRegistry()).send.status, 'rejected');
  });
}
test('control target selection is labelled, manual, canonical and keeps the named one-target button', async () => {
  const html = (await readFile('public/control.html', 'utf8')).replace(/\s+/g, ' '),
    js = await readFile('public/control.js', 'utf8');
  assert.match(html, /label for="raid-target"/);
  assert.match(
    html,
    /Send Off requests a real Twitch raid to this observed Keeper\. The relic moves only after Twitch confirms the raid and both chats bind it; sending rechecks eligibility\./,
  );
  assert.match(html, /id="target-empty"/);
  assert.ok(js.includes('Send Off to ${names[target.value]}'));
  assert.ok(js.includes('run(`send:${target.value}`)'));
  assert.ok(js.includes('JSON.stringify({ action, csrf })'));
  assert.ok(!js.includes('setInterval'));
});

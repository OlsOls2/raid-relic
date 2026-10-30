import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createApp } from '../src/app.js';
import { setupChannel, CANONICAL_APP } from '../public/onboarding.js';
import { publicDate } from '../public/streak-view.js';
import { pilotFixture, HOME, OTHER } from '../test-support/pilot-fixture.js';

test('front door has exact story/one-click actions while Atlas retains its map and ledger', async () => {
  const trap = new Proxy(
    {},
    {
      get() {
        throw Error('Unexpected private access');
      },
    },
  );
  const app = createApp({
    state: trap,
    oauth: {
      callbackPath: '/auth/callback',
      control: trap,
      route() {
        throw Error('Unexpected OAuth action');
      },
    },
  });
  const home = await app.dispatch({ method: 'GET', path: '/' });
  const atlas = await app.dispatch({ method: 'GET', path: '/atlas/' });
  assert.equal(home.status, 200);
  assert.equal(atlas.status, 200);
  const html = home.body.toString(),
    archive = atlas.body.toString();
  assert.match(html, /<body class="frontdoor">/);
  assert.match(html, /<h1 id="title">Raids that leave a story\.<\/h1>/);
  assert.ok(
    html.includes(
      'A living relic your chat passes to the next stream. Both chats claim it. Every hand-off adds a ring.',
    ),
  );
  assert.match(html, /class="primary-cta" href="\/demo\/judge">▶ Watch the 45-second demo/);
  assert.match(html, /class="secondary-cta" href="\/start">Add to my stream/);
  assert.equal((html.match(/<summary>How we verify<\/summary>/g) ?? []).length, 1);
  assert.match(html, /class="mobile-cta"/);
  assert.doesNotMatch(archive, /<body class="frontdoor">|class="mobile-cta"/);
  const film = await readFile('public/film.html', 'utf8');
  assert.match(
    film,
    /id="film-card-section"[\s\S]*?class="public-nav"[\s\S]*?href="\/start"[\s\S]*?<\/section>/,
  );
  for (const id of [
    'journey-map',
    'map-svg',
    'keeper-scores',
    'mark-search',
    'journey',
    'atlas-relic',
  ]) {
    assert.ok(archive.includes(`id="${id}"`));
    assert.ok(html.includes(`id="${id}"`));
  }
  for (const body of [html, archive])
    assert.equal(
      (body.match(/Unofficial fan project\. Not affiliated with Twitch\./g) ?? []).length,
      1,
    );
});

test('typed setup matches only configured names and never resolves or admits a new account', async () => {
  const names = { 201: 'sample_a', 202: 'sample_b' };
  for (const value of ['sample_b', 'SAMPLE_B', '@sample_b'])
    assert.equal(setupChannel(value, names).connect, CANONICAL_APP + '/oauth/keeper/202/start');
  for (const value of [
    'new_channel',
    '202',
    'https://twitch.tv/sample_b',
    'sample b',
    '__proto__',
    '@'.repeat(27),
    null,
  ])
    assert.equal(setupChannel(value, names), null);
  assert.deepEqual(names, { 201: 'sample_a', 202: 'sample_b' });
  const html = await readFile('public/start.html', 'utf8');
  assert.doesNotMatch(html, /<select|<option/);
  assert.match(html, /id="start-channel"\s+type="text"\s+maxlength="25"/);
  const source = await readFile('public/start.js', 'utf8');
  assert.match(source, /not admitted yet/);
  assert.doesNotMatch(source, /fetch\(|localStorage|sessionStorage|WebSocket/);
});
for (const kind of ['memory', 'firestore'])
  test(`${kind}: public front door/start do not change admission, consent or state`, async () => {
    const f = await pilotFixture(kind);
    const registry = await f.runtime.state.getKeeperRegistry();
    for (const path of ['/', '/atlas/', '/start'])
      assert.equal((await f.request(path, 'GET')).status, 200);
    assert.equal((await f.request('/oauth/keeper/999999999999/start', 'GET')).status, 404);
    assert.equal((await f.request('/control/' + OTHER + '/status', 'GET')).status, 401);
    assert.deepEqual(await f.runtime.state.getKeeperRegistry(), registry);
    assert.notEqual((await f.runtime.state.getStreamStatus(HOME))?.optedIn, true);
    assert.equal(f.calls.length, 0);
  });

test('one en-GB UTC formatter handles relative boundaries, future/old/invalid dates without visible ISO', () => {
  const now = Date.UTC(2026, 9, 30, 12);
  assert.equal(publicDate(now, now), 'Just now');
  assert.equal(publicDate(now - 60000, now), '1 minute ago');
  assert.equal(publicDate(now - 59 * 60000, now), '59 minutes ago');
  assert.equal(publicDate(now - 3600000, now), '1 hour ago');
  assert.equal(publicDate(now - 86399999, now), '23 hours ago');
  assert.equal(publicDate(now - 86400000, now), '29 Oct 2026, 12:00 UTC');
  assert.equal(publicDate(now + 60000, now), '30 Oct 2026, 12:01 UTC');
  assert.equal(publicDate(now, now, false), '30 Oct 2026, 12:00 UTC');
  for (const value of [null, -1, NaN, Infinity, '2026-10-30', 8640000000000001])
    assert.equal(publicDate(value, now), 'Time not recorded');
});

test('Keeper previews use actual card rendering; exports keep fresh-read privacy and bounded disposal', async () => {
  const cards = await readFile('public/keeper-card.js', 'utf8');
  const source = await readFile('public/receiving.js', 'utf8');
  assert.match(cards, /export async function keeperCardThumbnail/);
  assert.match(cards, /await keeperCardPNG\(model, 'landscape', stop\.raidAudience\)/);
  assert.match(cards, /blob\.size > 32768/);
  assert.match(source, /previewBytes \+ blob\.size > 524288/);
  assert.match(cards, /await assertFreshShare\(snapshot, recorded\.stopId, read\)/);
  assert.match(source, /URL\.revokeObjectURL\(url\)/);
  assert.match(source, /thumbnail\.width = 320;\s*thumbnail\.height = 180/);
  assert.match(source, /index >= 3/);
  assert.match(source, /if \(own !== generation \|\| active\.signal\.aborted\) break/);
  assert.match(source, /navigator\.share\(/);
  for (const label of ['Landscape PNG', 'Vertical PNG', 'Copy stop link'])
    assert.ok(source.includes(label));
  const css = await readFile('public/atlas.css', 'utf8');
  assert.match(css, /height: calc\(56px \+ env\(safe-area-inset-bottom\)\)/);
  assert.doesNotMatch(css, /overflow-x:\s*hidden/);
});

test('narrow Keeper records shrink display controls without hiding content or changing card pixel size', async () => {
  const css = await readFile('public/atlas.css', 'utf8');
  assert.match(css, /#receiving-refresh\s*\{[^}]*max-width:\s*100%;[^}]*white-space:\s*normal;/);
  assert.match(css, /#keeper-title\s*\{[^}]*overflow-wrap:\s*anywhere;/);
  assert.match(css, /\.keeper-share-options > \*\s*\{[^}]*min-width:\s*0;/);
  assert.match(css, /\.keeper-arrival button\s*\{[^}]*max-width:\s*calc\(100% - 12px\);/);
  assert.match(css, /\.keeper-card-preview\s*\{[^}]*width:\s*320px;[^}]*max-width:\s*100%;/);
  assert.doesNotMatch(css, /overflow-x:\s*hidden/);
});

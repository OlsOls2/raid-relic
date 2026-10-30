import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
test('real film observers use native targets, keeping framework UI tests separate', async () => {
  for (const file of ['browser-smoke-film-timing.js', 'observe-film-walltime.js']) {
    const source = await readFile(new URL('../scripts/' + file, import.meta.url), 'utf8');
    assert.match(source, /await nativeFilmReview\(\)/);
    assert.match(source, /nativeTabVisibilityPreflight/);
    assert.doesNotMatch(source, /native-page-visibility\.js/);
    assert.doesNotMatch(
      source,
      /nativePageVisibility\(|page\.clock|setFocusEmulationEnabled|dispatchEvent\(new Event\('visibilitychange'/,
    );
  }
  const source = await readFile(
    new URL('../test-support/native-film-review.js', import.meta.url),
    'utf8',
  );
  assert.match(source, /--remote-debugging-pipe/);
  assert.match(source, /'--headless=new'/);
  assert.match(source, /'--js-flags=--max-old-space-size=128'/);
  assert.match(source, /if \(!process\.getuid\?\.\(\)\) throw protocolError\(7\)/);
  assert.doesNotMatch(source, /process\.env\.(?:DISPLAY|XAUTHORITY)/);
  assert.match(source, /Target\.activateTarget/);
  assert.match(source, /export async function nativeTabVisibilityPreflight/);
  assert.match(source, /pages\.length !== 2/);
  assert.match(source, /document\.hidden === expected/);
  assert.match(source, /visibilityPreflightTurns\+\+/);
  assert.match(source, /Network\.requestWillBeSent/);
  assert.match(source, /Fetch\.failRequest/);
  assert.match(source, /MAX_INFLIGHT\s*=\s*64/);
  assert.match(source, /setTimeout\([\s\S]*?15000\s*,?\s*\)/);
  assert.match(source, /Browser\.close/);
  assert.match(source, /fixtureOnly:\s*true/);
  assert.match(
    source,
    /scrollIntoView\(\{ behavior: 'instant', block: 'center', inline: 'center' \}\)/,
  );
  assert.match(source, /document\.elementFromPoint\(x, y\)/);
  assert.match(source, /!node\.contains\(hit\)/);
  assert.match(source, /node\.matches\(':disabled'\)/);
  assert.match(source, /x >= innerWidth/);
  assert.match(source, /y >= innerHeight/);
  assert.match(source, /type: 'mousePressed'/);
  assert.match(source, /type: 'mouseReleased'/);
  assert.doesNotMatch(
    source,
    /chromium\.launch|connectOverCDP|setFocusEmulationEnabled|--remote-debugging-port|--no-sandbox|chromiumSandbox:\s*false|--disable-background-timer-throttling|--disable-renderer-backgrounding|node\.click\(|new MouseEvent/,
  );
});

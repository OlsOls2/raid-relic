import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { rgba, over, contrast } from '../test-support/a11y-contrast.js';
test('contrast math includes alpha compositing and standard luminance', () => {
  assert.equal(contrast([255, 255, 255, 1], [0, 0, 0, 1]), 21);
  assert.deepEqual(over([255, 255, 255, 0.5], [0, 0, 0, 1]), [127.5, 127.5, 127.5, 1]);
  assert.deepEqual(rgba('rgba(16, 29, 48, 0.5)'), [16, 29, 48, 0.5]);
  assert.ok(contrast(rgba('rgb(219, 169, 92)'), rgba('rgb(16, 29, 48)')) > 4.5);
  assert.throws(() => rgba('url(private)'));
});
test('public shells have native skip targets and no live per-frame demo clock', async () => {
  for (const name of ['atlas', 'demo']) {
    const s = await readFile(`public/${name}.html`, 'utf8');
    assert.match(s, /href="#main-content">Skip to main content/);
    assert.match(s, /<main id="main-content" tabindex="-1">/);
    assert.match(await readFile(`public/${name}.css`, 'utf8'), /summary:focus-visible/);
  }
  const demo = await readFile('public/demo.html', 'utf8');
  assert.match(demo, /<p id="demo-clock">/);
  assert.doesNotMatch(demo, /<p id="demo-clock"[^>]*(?:aria-live|role=)/);
});

test('demo separates one visible lock notice from its dedicated Send Off description', async () => {
  const html = await readFile('public/demo.html', 'utf8'),
    js = (await readFile('public/demo.js', 'utf8')).replace(/\s+/g, '');
  assert.match(html, /id="demo-send" aria-describedby="demo-send-reason"/);
  assert.match(html, /id="demo-send-reason" class="sr-only"/);
  assert.match(js, /text\('demo-lock',controls.notice\);/);
  assert.match(js, /text\('demo-send-reason',demoSendReason\(state,\{playing,tour\}\)\);/);
  assert.doesNotMatch(js, /text\('demo-lock',controls.notice\s*\+/);
  assert.ok(js.includes("state.streak===1?'binding':'bindings'"));
});

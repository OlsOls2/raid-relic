import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
test('growth profile stays a short natural-tour diagnostic with closed bounded output and no clock override', async () => {
  const source = await readFile(
    new URL('../scripts/browser-profile-growth.js', import.meta.url),
    'utf8',
  );
  assert.match(source, /tour <= 2/);
  assert.match(source, /\[1000, 11000, 20000, 35000\]/);
  assert.match(source, /SystemInfo\.getProcessInfo/);
  assert.match(source, /noDemoIO\(context\)/);
  assert.match(source, /Buffer\.byteLength\(output\) > 16384/);
  assert.match(source, /growth-profile-browser-results\.json/);
  assert.doesNotMatch(source, /page\.clock|Date\.now\s*=|process\.env|--no-sandbox|\.screenshot\(/);
  assert.match(source, /fixture\.calls\.length, 0/);
  assert.match(source, /await review\?\.close\(\)/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
test('squared Fresnel and twelfth-power specular preserve bounded arithmetic including endpoints', () => {
  const f = Math.fround;
  for (let i = 0; i <= 1024; i++) {
    const x = i / 1024,
      x2 = x * x,
      x4 = x2 * x2;
    assert.ok(Math.abs(x2 - Math.pow(x, 2)) <= 1e-15);
    assert.ok(Math.abs(x4 * x4 * x4 - Math.pow(x, 12)) <= 1e-15);
    const q2 = f(f(x) * f(x)),
      q4 = f(q2 * q2),
      q12 = f(f(q4 * q4) * q4);
    const expected = f(Math.pow(f(x), 12));
    assert.ok(Math.abs(q12 - expected) <= 2e-7 + 2e-6 * Math.abs(expected));
  }
});
test('actual core and halo shaders use cached normalized vectors and equivalent powers without altering art constants', async () => {
  const source = await readFile(new URL('../public/relic3d.js', import.meta.url), 'utf8');
  const fragments = [...source.matchAll(/fragmentShader:\s*'([^']+)'/g)].map((m) => m[1]);
  assert.equal(fragments.length, 2);
  const [core, halo] = fragments;
  assert.match(core, /vec3 N=normalize\(norm\); vec3 E=normalize\(eye\)/);
  assert.equal((core.match(/normalize\(norm\)/g) ?? []).length, 1);
  assert.equal((core.match(/normalize\(eye\)/g) ?? []).length, 1);
  assert.match(core, /const vec3 L=normalize\(vec3\(-\.5,\.8,1\.0\)\)/);
  assert.match(core, /float f=rim\*rim/);
  assert.match(core, /float x2=x\*x; float x4=x2\*x2; float shine=x4\*x4\*x4/);
  assert.match(core, /vec3\(\.70,\.63,\.84\),vec3\(\.86,\.90,\.94\)/);
  assert.match(core, /f\*1\.25\+shine\*\.85/);
  assert.match(core, /vec4\(metal,\.98\)/);
  assert.match(halo, /float rim=edge\*edge/);
  assert.match(halo, /vec3\(\.58,\.70,1\.0\),rim\*\.42/);
  for (const shader of fragments) assert.doesNotMatch(shader, /\bpow\(/);
});

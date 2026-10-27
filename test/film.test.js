import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  FILM_MS,
  FILM_SCENES,
  freshFilm,
  seekFilm,
  advanceFilm,
  filmStep,
  filmFrame,
  filmShortcut,
} from '../public/film-state.js';
import { createApp } from '../src/app.js';
test('150-second film follows eight ordered scenes and binds only after the distinct simulated accept', () => {
  assert.equal(FILM_MS, 150000);
  assert.equal(FILM_SCENES.length, 8);
  for (let i = 0; i < FILM_SCENES.length; i++) {
    const f = filmFrame(FILM_SCENES[i].at);
    assert.equal(f.index, i);
    assert.ok(Object.isFrozen(f.scene));
  }
  assert.equal(filmFrame(39999).offers, 0);
  assert.equal(filmFrame(40000).offers, 1);
  assert.equal(filmFrame(54999).rings, 0);
  assert.equal(filmFrame(55000).accepts, 1);
  assert.equal(filmFrame(55000).rings, 1);
  assert.equal(filmFrame(120000).rings, 1);
  assert.equal(filmFrame(150000).rings, 1);
  assert.equal(filmFrame(150000).index, 7);
  assert.equal(filmFrame(14999).arrivalElapsed, -1);
  assert.equal(filmFrame(15000).arrivalElapsed, 0);
});
test('film restart, seek/backseek, end and hidden clocks never catch up or accumulate extra rings', () => {
  let s = freshFilm();
  s = advanceFilm(s, 100);
  assert.equal(s.ms, 100);
  assert.equal(advanceFilm(s, 10000).ms, 350);
  assert.equal(advanceFilm(s, 500, true), s);
  for (const dt of [NaN, Infinity, -1, 0]) assert.equal(advanceFilm(s, dt), s);
  s = filmStep(s, 'toggle');
  assert.equal(advanceFilm(s, 100), s);
  for (const at of [150000, 30000, 55000, 0, 120000, 150000]) {
    s = seekFilm(s, at);
    assert.equal(s.ms, at);
    assert.equal(filmFrame(s.ms).rings, Number(at >= 55000));
  }
  assert.equal(s.playing, false);
  assert.deepEqual(filmStep(s, 'toggle'), freshFilm());
  assert.deepEqual(filmStep(s, 'restart'), freshFilm());
  s = freshFilm();
  for (let i = 1; i < 8; i++) {
    s = filmStep(s, 'next');
    assert.equal(s.ms, FILM_SCENES[i].at);
  }
  assert.equal(filmStep(s, 'next').ms, FILM_MS);
  assert.equal(seekFilm(s, NaN), s);
});
test('film shortcuts preserve focused controls, modifiers, repeats and normal page scrolling', () => {
  assert.equal(filmShortcut({ code: 'Space' }), 'toggle');
  assert.equal(filmShortcut({ code: 'ArrowRight' }), 'next');
  assert.equal(filmShortcut({ code: 'ArrowDown' }), null);
  for (const property of ['repeat', 'modified', 'interactive'])
    assert.equal(filmShortcut({ code: 'Space', [property]: true }), null);
});
test('film is an early static GET route with connect-none and no store/SDK or write access', async () => {
  const trap = new Proxy(
    {},
    {
      get() {
        throw Error('Unexpected SDK/store access');
      },
    },
  );
  const app = createApp({ state: trap, oauth: trap, previewReadOnly: true });
  for (const path of ['/demo/film', '/demo/film/', '/film.js', '/film-state.js', '/film.css']) {
    const r = await app.dispatch({ method: 'GET', path });
    assert.equal(r.status, 200);
    assert.match(r.headers['content-security-policy'], /connect-src 'none'/);
    assert.equal((await app.dispatch({ method: 'POST', path })).status, 403);
  }
  const html = await readFile('public/film.html', 'utf8');
  assert.match(html, /FILM \/ SIMULATOR — no Twitch connection or real transfers/);
  assert.match(html, /id="film-export" disabled/);
  for (const file of ['film.js', 'film-state.js', 'film.html']) {
    const s = await readFile('public/' + file, 'utf8');
    assert.doesNotMatch(
      s,
      /fetch\s*\(|WebSocket|XMLHttpRequest|sendBeacon|localStorage|sessionStorage|serviceWorker|AudioContext|speechSynthesis|\/api\/|\/internal\/|159180|olsols|raidrelichq/,
    );
  }
  const source = await readFile('public/film.js', 'utf8');
  assert.match(source, /film-export'\)\.onclick/);
  assert.equal((source.match(/saveRingCard\(/g) || []).length, 1);
  assert.match(source, /mode: 'demo'/);
  assert.match(source, /document\.hidden/);
  assert.match(source, /URL\.revokeObjectURL/);
});

test('judge entry scales only the exact local presentation path to45 seconds without changing claim order or hidden clocks', async () => {
  const { filmDuration, advanceFilmAtPace, JUDGE_MS } = await import('../public/film-state.js');
  assert.equal(JUDGE_MS, 45000);
  assert.equal(filmDuration('/demo/judge'), 45000);
  for (const path of ['/demo/film', '/demo/judge/other', '/demo/film?judge=1'])
    assert.equal(filmDuration(path), 150000);
  let s = freshFilm();
  for (let elapsed = 0; elapsed < 45000; elapsed += 15) s = advanceFilmAtPace(s, 15, '/demo/judge');
  assert.equal(s.ms, FILM_MS);
  assert.equal(s.playing, false);
  assert.equal(filmFrame(54999).rings, 0);
  assert.equal(filmFrame(55000).rings, 1);
  assert.equal(advanceFilmAtPace(freshFilm(), 1000, '/demo/judge', true).ms, 0);
  assert.deepEqual(advanceFilmAtPace(freshFilm(), 30, '/demo/film'), advanceFilm(freshFilm(), 30));
  const trap = new Proxy(
    {},
    {
      get() {
        throw Error('No SDK or state reads');
      },
    },
  );
  const app = createApp({ state: trap, oauth: trap, previewReadOnly: true });
  const response = await app.dispatch({ method: 'GET', path: '/demo/judge' });
  assert.equal(response.status, 200);
  assert.match(response.headers['content-security-policy'], /connect-src 'none'/);
  assert.equal((await app.dispatch({ method: 'POST', path: '/demo/judge' })).status, 403);
});

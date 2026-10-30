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
  filmPlaybackOptions,
  sampleFilmClock,
  reconcileFilmMotion,
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
  assert.equal(filmFrame(40000).scene.caption, 'Both chats claim it.');
  assert.equal(filmFrame(54999).rings, 0);
  assert.equal(filmFrame(55000).accepts, 1);
  assert.equal(filmFrame(55000).rings, 1);
  assert.equal(filmFrame(120000).rings, 1);
  assert.equal(filmFrame(150000).rings, 1);
  assert.equal(filmFrame(150000).index, 7);
  assert.equal(filmFrame(14999).arrivalElapsed, -1);
  assert.equal(filmFrame(15000).arrivalElapsed, 0);
});
test('film restart, seek/backseek and end preserve rings; visible elapsed catches up while normal hidden time pauses', () => {
  let s = freshFilm();
  s = advanceFilm(s, 100);
  assert.equal(s.ms, 100);
  assert.equal(advanceFilm(s, 10000).ms, 10100);
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

test('monotonic interval sampling catches throttling at both paces and holds the end without replay', () => {
  for (const [path, duration] of [
    ['/demo/film', 150000],
    ['/demo/judge', 45000],
  ]) {
    let clock = { state: freshFilm(), at: 100.125 };
    clock = sampleFilmClock(clock, 100.125 + duration, path, true, true);
    assert.equal(clock.state.ms, FILM_MS);
    assert.equal(clock.state.playing, false);
    assert.equal(sampleFilmClock(clock, clock.at + 60000, path, true, true).state.ms, FILM_MS);
    assert.equal(sampleFilmClock(clock, NaN, path), clock);
    assert.equal(sampleFilmClock(clock, clock.at - 1, path), clock);
  }
  let clock = { state: freshFilm(), at: 0 };
  clock = sampleFilmClock(clock, 60000, '/demo/film', true, false);
  assert.equal(clock.state.ms, 0);
  clock = sampleFilmClock(clock, 60250, '/demo/film');
  assert.equal(clock.state.ms, 250);
  clock = { at: clock.at, state: filmStep(clock.state, 'toggle') };
  clock = sampleFilmClock(clock, 120000, '/demo/film', false, true);
  assert.equal(clock.state.ms, 250);
  clock = { at: clock.at, state: filmStep(clock.state, 'toggle') };
  assert.equal(sampleFilmClock(clock, 120250, '/demo/film').state.ms, 500);
  clock = { at: 0, state: freshFilm() };
  for (let n = 1; n <= 1000; n++) clock = sampleFilmClock(clock, n * 0.125, '/demo/film');
  assert.equal(clock.state.ms, 125); // Preserve fractional deltas, not rounding debt.
});
test('reduced-motion starts static except explicit autoplay kiosk, with no external query authority', () => {
  assert.deepEqual(filmPlaybackOptions('', true), { kiosk: false, playing: false });
  assert.equal(filmPlaybackOptions('?autoplay=1', true).playing, false);
  assert.equal(filmPlaybackOptions('?kiosk=1', true).playing, false);
  assert.deepEqual(filmPlaybackOptions('?autoplay=1&kiosk=1', true), {
    kiosk: true,
    playing: true,
  });
  assert.equal(filmPlaybackOptions('', false).playing, true);
  assert.equal(filmPlaybackOptions('?kiosk=https://untrusted.example', true).kiosk, false);
  assert.equal(freshFilm(false).playing, false);
});
test('film clock is interval-based; kiosk keeps accessible pause and reduced effects remain bounded', async () => {
  const js = await readFile('public/film.js', 'utf8');
  const css = await readFile('public/film.css', 'utf8');
  const html = await readFile('public/film.html', 'utf8');
  assert.match(js, /setInterval\(tick,\s*250\)/);
  assert.doesNotMatch(js, /requestAnimationFrame/);
  assert.match(js, /sampleFilmClock\([\s\S]*?performance\.now\(\)/);
  assert.match(html, /id="film-play" aria-keyshortcuts="Space"/);
  assert.match(html, /Fictional sample chat, not connected to Twitch/);
  assert.equal((html.match(/<i><\/i>/g) ?? []).length, 12);
  assert.match(css, /animation:\s*film-ring\s+600ms/);
  assert.match(js, /motion\.matches\s*\?\s*1500\s*:\s*350/);
  assert.match(css, /prefers-reduced-motion/);
});

test('film restores current growth after synchronous release and late cancelled initialization', async () => {
  const { runInNewContext } = await import('node:vm');
  const source = await readFile('public/film.js', 'utf8');
  const lifecycle = source.slice(
    source.indexOf('function release()'),
    source.indexOf('async function prepareCard()'),
  );
  let finish;
  const archive = {};
  const context = {
    archive,
    alive: true,
    document: { hidden: false },
    motion: { matches: false },
    state: { ms: 60000, playing: false },
    view: {
      dispose() {
        delete archive.total;
      },
    },
    viewKey: null,
    pending: null,
    epoch: 0,
    AbortController,
    filmFrame,
    presentGrowth(target, total) {
      target.total = total;
    },
    createRelic3D: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  };
  runInNewContext(lifecycle + '; this.drawFilm = draw;', context);
  context.motion.matches = true;
  await context.drawFilm(filmFrame(60000));
  assert.equal(archive.total, 1);
  context.motion.matches = false;
  const initializing = context.drawFilm(filmFrame(60000));
  context.motion.matches = true;
  await context.drawFilm(filmFrame(60000));
  context.state = { ms: 0, playing: false };
  await context.drawFilm(filmFrame(0));
  finish({
    dispose() {
      delete archive.total;
    },
  });
  await initializing;
  assert.equal(
    archive.total,
    0,
    'late disposal restores latest count rather than captured ring one',
  );
  assert.equal(context.view, null);
  assert.equal(context.pending, null);
  context.motion.matches = false;
  const unloading = context.drawFilm(filmFrame(0));
  context.alive = false;
  await context.drawFilm(filmFrame(0));
  finish({
    dispose() {
      delete archive.total;
    },
  });
  await unloading;
  assert.equal(archive.total, undefined, 'unloaded film cannot resurrect growth art');
});

test('film close framing is opt-in and contact-sheet transport stays within protocol bounds', async () => {
  const renderer = await readFile('public/relic3d.js', 'utf8');
  const film = await readFile('public/film.js', 'utf8');
  const timing = await readFile('scripts/browser-smoke-film-timing.js', 'utf8');
  assert.match(renderer, /framing = 'default'/);
  assert.match(renderer, /framing === 'film' \? 20 : 36/);
  assert.match(film, /framing: 'film'/);
  assert.match(timing, /filmPaintedFraming/);
  assert.match(timing, /painted\.paintedHeight >= painted\.stageHeight \* 0\.5/);
  assert.match(timing, /assert\.equal\(painted\.overlap, 0\)/);
  assert.match(timing, /bytes\.toString\('base64'\)/);
  const frames = Array.from({ length: 4 }, () => Buffer.alloc(524288).toString('base64'));
  assert.ok(Buffer.byteLength(JSON.stringify(frames)) < 3 * 1024 * 1024);
  assert.equal(Buffer.from(frames[0], 'base64').length, 524288);
  assert.doesNotMatch(timing, /map\(\(bytes\) => \[\.\.\.bytes\]\)/);
});

test('observed reduced transition pauses normal film once without blocking manual resume or kiosk', () => {
  const playing = Object.freeze({ ms: 60000, playing: true });
  const reduced = reconcileFilmMotion(playing, false, true);
  assert.equal(reduced.state.playing, false);
  assert.equal(reduced.state.ms, 60000);
  assert.equal(reduced.reduced, true);
  const resumed = filmStep(reduced.state, 'toggle');
  assert.equal(reconcileFilmMotion(resumed, true, true).state, resumed);
  assert.ok(sampleFilmClock({ state: resumed, at: 0 }, 250, '/demo/film').state.ms > 60000);
  const paused = filmStep(resumed, 'toggle');
  assert.equal(reconcileFilmMotion(paused, true, false).state, paused);
  assert.equal(reconcileFilmMotion(resumed, false, true, true).state, resumed);
  const normalAgain = reconcileFilmMotion(resumed, true, false);
  assert.equal(
    reconcileFilmMotion(normalAgain.state, normalAgain.reduced, true).state.playing,
    false,
  );
});

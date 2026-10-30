// Closed local fiction. This clock never authorizes a real raid or transfer.
export const FILM_MS = 150000;
export const JUDGE_MS = 45000;
export const filmDuration = (path) => (path === '/demo/judge' ? JUDGE_MS : FILM_MS);
export function filmPlaybackOptions(search = '', reduced = false) {
  const query = new URLSearchParams(search);
  const kiosk = query.get('kiosk') === '1';
  return Object.freeze({ kiosk, playing: !reduced || (kiosk && query.get('autoplay') === '1') });
}
// Observe the preference itself, even when a change notification is delayed.
// Only the transition pauses: subsequent explicit Play remains available.
export function reconcileFilmMotion(state, previousReduced, reduced, kiosk = false) {
  return Object.freeze({
    reduced,
    state:
      reduced && !previousReduced && !kiosk ? Object.freeze({ ...state, playing: false }) : state,
  });
}
export function advanceFilmAtPace(state, delta, path, hidden = false, kiosk = false) {
  if (!state.playing || (hidden && !kiosk) || !Number.isFinite(delta) || delta <= 0) return state;
  const ms = Math.min(FILM_MS, state.ms + (delta * FILM_MS) / filmDuration(path));
  return Object.freeze({ ms, playing: ms < FILM_MS });
}
// Constant-work catch-up: no per-missed-frame loop, no Date.now authority.
export function sampleFilmClock(clock, now, path, hidden = false, kiosk = false) {
  if (!Number.isFinite(now) || now < clock.at) return clock;
  return Object.freeze({
    at: now,
    state: advanceFilmAtPace(clock.state, now - clock.at, path, hidden, kiosk),
  });
}
export const FILM_SCENES = Object.freeze([
  Object.freeze({
    at: 0,
    name: 'Send Off',
    caption: 'One relic. Two chats.',
  }),
  Object.freeze({
    at: 15000,
    name: 'Arrival',
    caption: 'The relic arrives.',
  }),
  Object.freeze({
    at: 40000,
    name: 'Two-chat claim',
    caption: 'Both chats claim it.',
  }),
  Object.freeze({
    at: 60000,
    name: 'Community engraving',
    caption: 'Leave a rune.',
  }),
  Object.freeze({
    at: 80000,
    name: 'Keeper spotlight',
    caption: 'A new Keeper.',
  }),
  Object.freeze({
    at: 100000,
    name: 'Recorded journey',
    caption: 'A story that stays.',
  }),
  Object.freeze({
    at: 120000,
    name: 'Journey replay',
    caption: 'Replay the journey.',
  }),
  Object.freeze({
    at: 135000,
    name: 'Take the story onward',
    caption: 'Carry the story onward.',
  }),
]);
export const freshFilm = (playing = true) => Object.freeze({ ms: 0, playing });
export function seekFilm(state, ms) {
  if (!Number.isFinite(ms)) return state;
  return Object.freeze({
    ms: Math.max(0, Math.min(FILM_MS, Math.round(ms))),
    playing: state.playing && ms < FILM_MS,
  });
}
export function advanceFilm(state, delta, hidden = false) {
  if (!state.playing || hidden || !Number.isFinite(delta) || delta <= 0) return state;
  // Normal hidden pages pause; visible throttled work catches up in one step.
  return advanceFilmAtPace(state, delta, '/demo/film', hidden);
}
export function filmStep(state, action) {
  if (action === 'restart') return freshFilm();
  if (action === 'toggle')
    return state.ms === FILM_MS
      ? freshFilm()
      : Object.freeze({ ...state, playing: !state.playing });
  if (action === 'next')
    return seekFilm(state, FILM_SCENES.find((s) => s.at > state.ms)?.at ?? FILM_MS);
  return state;
}
export function filmFrame(ms) {
  const clock = Number.isFinite(ms) ? Math.max(0, Math.min(FILM_MS, ms)) : 0;
  const index = FILM_SCENES.findLastIndex((s) => s.at <= clock);
  const completed = clock >= 55000;
  return Object.freeze({
    clock,
    index,
    scene: FILM_SCENES[index],
    rings: Number(completed),
    offers: Number(clock >= 40000),
    accepts: Number(completed),
    completed,
    engraved: clock >= 60000,
    replay: index === 6,
    arrivalElapsed: index === 6 ? ((clock - 120000) * 25000) / 15000 : clock - 15000,
  });
}
export function filmShortcut({ code, repeat = false, modified = false, interactive = false }) {
  if (repeat || modified || interactive) return null;
  return code === 'Space' ? 'toggle' : code === 'ArrowRight' ? 'next' : null;
}

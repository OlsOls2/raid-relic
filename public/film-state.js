// Closed local fiction. This clock never authorizes a real raid or transfer.
export const FILM_MS = 150000;
export const JUDGE_MS = 45000;
export const filmDuration = (path) => (path === '/demo/judge' ? JUDGE_MS : FILM_MS);
export function advanceFilmAtPace(state, delta, path, hidden = false) {
  if (path !== '/demo/judge') return advanceFilm(state, delta, hidden);
  if (!state.playing || hidden || !Number.isFinite(delta) || delta <= 0) return state;
  return seekFilm(state, state.ms + (Math.min(250, delta) * FILM_MS) / JUDGE_MS);
}
export const FILM_SCENES = Object.freeze([
  Object.freeze({
    at: 0,
    name: 'Send Off',
    caption: 'Two fictional Keepers choose to pass one relic. API acceptance is not an arrival.',
  }),
  Object.freeze({
    at: 15000,
    name: 'Arrival',
    caption: 'A simulated signed receipt begins the original arrival. No Twitch event is sent.',
  }),
  Object.freeze({
    at: 40000,
    name: 'Two-chat claim',
    caption:
      'An early offer waits for a distinct host accept. Only their completed simulated binding adds a ring.',
  }),
  Object.freeze({
    at: 60000,
    name: 'Community engraving',
    caption:
      'The approved sample word moon becomes an original community rune. Private held words never appear.',
  }),
  Object.freeze({
    at: 80000,
    name: 'Keeper spotlight',
    caption:
      'SIMULATED LIVE · @demo_keeper_b holds the relic. This is not a Twitch live-status observation.',
  }),
  Object.freeze({
    at: 100000,
    name: 'Recorded journey',
    caption:
      'One retained fictional hop, from @demo_keeper_a to @demo_keeper_b. Presence is not proof of raid membership.',
  }),
  Object.freeze({
    at: 120000,
    name: 'Journey replay',
    caption: 'Replay the same recorded arrival. Replay adds no ring, vote or new history.',
  }),
  Object.freeze({
    at: 135000,
    name: 'Take the story onward',
    caption:
      'Preview a permanently simulated ring card. Download only if you choose the export button.',
  }),
]);
export const freshFilm = () => Object.freeze({ ms: 0, playing: true });
export function seekFilm(state, ms) {
  if (!Number.isFinite(ms)) return state;
  return Object.freeze({
    ms: Math.max(0, Math.min(FILM_MS, Math.round(ms))),
    playing: state.playing && ms < FILM_MS,
  });
}
export function advanceFilm(state, delta, hidden = false) {
  if (!state.playing || hidden || !Number.isFinite(delta) || delta <= 0) return state;
  // A suspended tab never fast-forwards the story on return.
  return seekFilm(state, state.ms + Math.min(250, delta));
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

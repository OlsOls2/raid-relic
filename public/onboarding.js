// Public presentation only. No admission, authorization, polling or token access.
export const CANONICAL_APP = 'https://raid-relic-760724762396.us-central1.run.app';
export function setupLinks(id, names) {
  if (
    typeof id !== 'string' ||
    !/^[1-9]\d{0,19}$/.test(id) ||
    !Object.hasOwn(names, id) ||
    !/^[a-z0-9_]{1,25}$/.test(names[id])
  )
    return null;
  return Object.freeze({
    login: names[id],
    connect: `${CANONICAL_APP}/oauth/keeper/${id}/start`,
    control: `${CANONICAL_APP}/control/${id}`,
    overlay: `${CANONICAL_APP}/overlay/${id}`,
  });
}
// Name entry is presentation-only over the existing configured public mapping.
export function setupChannel(value, names) {
  if (typeof value !== 'string' || value.length > 26) return null;
  const login = value.trim().toLowerCase().replace(/^@/, '');
  if (!/^[a-z0-9_]{1,25}$/.test(login)) return null;
  const id = Object.keys(names).find((id) => names[id] === login);
  return setupLinks(id, names);
}
export function setupReadiness(
  pilot,
  { own = false, readAt = null, now = Date.now(), obs = false, id } = {},
) {
  const fresh = own && pilot && Number.isFinite(readAt) && now >= readAt;
  return Object.freeze({
    session: Boolean(fresh),
    optedIn: Boolean(fresh && pilot.optedIn === true),
    subscriptions: Boolean(fresh && pilot.subscriptions?.ready === true),
    botStored: Boolean(fresh && pilot.botGrantStored === true),
    obs: obs === true,
    queue: !fresh
      ? 'unchecked'
      : pilot.holder === id
        ? 'holding'
        : !pilot.optedIn
          ? 'opt-in-first'
          : !pilot.seekers?.enabled
            ? 'disabled'
            : pilot.seekers.joined
              ? 'joined'
              : 'off',
    // Compatibility field: a known own-session read, never fresh provider authorization.
    fresh: Boolean(fresh),
    ageSeconds: fresh ? Math.floor((now - readAt) / 1000) : null,
  });
}

// Presentation selection only: moving a control never invokes it or grants consent.
export function wizardPrimary(pilot, { copied = false, obs = false } = {}) {
  return {
    setup: pilot?.subscriptions?.ready === true && pilot.optedIn !== true
      ? 'first-keep'
      : 'first-bootstrap',
    overlay: copied && !obs ? 'first-obs-check' : 'first-obs-copy',
  };
}
export async function copyOBS(url, clipboard) {
  const parsed = new URL(url);
  if (
    parsed.origin !== CANONICAL_APP ||
    parsed.search ||
    parsed.hash ||
    !/^\/overlay\/[1-9]\d{0,19}$/.test(parsed.pathname) ||
    parsed.username ||
    parsed.password
  )
    throw Error('Invalid OBS URL');
  await clipboard.writeText(parsed.href);
  return 'URL copied — this does not prove OBS is installed or showing it.';
}

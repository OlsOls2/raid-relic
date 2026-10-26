// Pure presentation copy; callers supply only configured or fictional logins.
export function claimComplete(login) {
  const destination = typeof login === 'string' && /^[a-z0-9_]{1,25}$/.test(login) ? '@' + login : 'its new Keeper';
  return `Claim complete: the relic transferred to ${destination}; one new ring.`;
}

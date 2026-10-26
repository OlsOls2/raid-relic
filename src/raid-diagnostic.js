// Private dispatch evidence only. Never serialize an upstream object or exception.
export async function raidHTTP(url, options) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(8000),
    redirect: 'error',
  });
  const headers = {
    reset: response.headers.get('ratelimit-reset'),
    retryAfter: response.headers.get('retry-after'),
  };
  let data = null,
    malformed = false;
  try {
    const reader = response.body?.getReader();
    let bytes = 0;
    const parts = [];
    if (reader)
      for (;;) {
        const item = await reader.read();
        if (item.done) break;
        bytes += item.value.length;
        if (bytes > 16384) {
          await reader.cancel();
          throw Error();
        }
        parts.push(Buffer.from(item.value));
      }
    data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts)));
  } catch {
    malformed = true;
  }
  return { status: response.status, data, malformed, rate: headers };
}
function safeText(value, token, max) {
  if (typeof value !== 'string') return { text: null, redacted: false, truncated: false };
  let text = value,
    redacted = false;
  const replace = (regex) => {
    text = text.replace(regex, () => {
      redacted = true;
      return '[redacted]';
    });
  };
  if (token) {
    const parts = text.split(token);
    if (parts.length > 1) {
      redacted = true;
      text = parts.join('[redacted]');
    }
  }
  replace(/-----BEGIN[\s\S]*?(?:-----END[^\n]*-----|$)/g);
  replace(/\b(?:Bearer|OAuth)\s+(?!token\b)[^\s,;"']+/gi);
  replace(
    /\b(?:access_token|refresh_token|client_secret|authorization|code)["']?\s*[=:]\s*(?:"[^"]*"|'[^']*')/gi,
  );
  replace(
    /\b(?:access_token|refresh_token|client_secret|authorization|code)["']?\s*[=:]\s*["']?[^\s,;"'}]+/gi,
  );
  replace(/\b(?:sk-|gh[pousr]_)[a-zA-Z0-9_-]+/g);
  replace(/[A-Za-z0-9_+/=-]{24,}/g);
  replace(/https?:\/\/[^\s<>"']+/gi);
  text = text.replace(/[\x00-\x1f\x7f]/g, ' ');
  let bounded = '';
  for (const char of text) {
    if (Buffer.byteLength(bounded + char) > max) break;
    bounded += char;
  }
  return { text: bounded, redacted, truncated: bounded.length < text.length };
}
export function raidDiagnostic(intent, response, token, at, completedAt) {
  const status =
    Number.isInteger(response?.status) && response.status >= 100 && response.status <= 599
      ? response.status
      : null;
  const message = safeText(response?.data?.message, token, 180),
    error = safeText(response?.data?.error, token, 40);
  const category = response?.malformed
    ? 'malformed-response'
    : status === 200
      ? 'accepted-not-travel'
      : status === 401
        ? 'source-grant'
        : status === 403
          ? 'provider-forbidden'
          : status === 429
            ? 'rate-limited'
            : status === 409
              ? 'pending-native-raid'
              : status === 404
                ? 'target-not-found'
                : status === 400
                  ? /block|settings do not allow|does not accept|doesn't accept|restriction|too many viewers|not accept/i.test(
                      message.text ?? '',
                    )
                    ? 'incoming-raid-policy'
                    : 'native-state-review'
                  : status >= 400 && status < 500
                    ? 'request-rejected'
                    : 'unknown-reconcile-only';
  const nextStep =
    category === 'source-grant'
      ? 'Review source ID, token/client match and channel:manage:raids; reconnect source if needed. No automatic retry.'
      : category === 'provider-forbidden'
        ? 'Provider forbidden: owner reviews exact message; this status alone does not prove policy, account age or scope.'
        : category === 'pending-native-raid'
          ? 'STOP: native raid already in process. No new Send Off or Process while pending.'
          : category === 'target-not-found'
            ? 'Owner reviews target identity: Twitch reported target not found.'
            : category === 'incoming-raid-policy'
              ? `${/^[a-z0-9_]{1,25}$/.test(intent.targetLogin ?? '') ? intent.targetLogin : 'Target channel'} raid settings block this raider: check Raid Settings minimum account age/viewers. Owner review; no auto-relax.`
              : category === 'rate-limited'
                ? 'Limit: 10 requests per 10 minutes. Wait for observed reset/retryAfter; review native state before new owner attempt.'
                : category === 'native-state-review'
                  ? 'Owner reviews invalid/equal IDs, actual live/native state and exact message before considering a new attempt.'
                  : category === 'accepted-not-travel'
                    ? 'Accepted only; wait for verified raid EventSub, not another POST.'
                    : category === 'request-rejected'
                      ? 'Review safe Twitch message and native pending banner before any explicit new attempt.'
                      : 'Unknown outcome: stop for read-only reconciliation; never blindly retry.';
  const number = (value) =>
    typeof value === 'string' && /^\d{1,12}$/.test(value) ? Number(value) : null;
  return {
    httpStatus: status,
    category,
    nextStep,
    message: message.text,
    error: error.text,
    redacted: message.redacted || error.redacted,
    truncated: message.truncated || error.truncated,
    sourceId: intent.sourceId,
    targetId: intent.targetId,
    intentId: intent.id,
    expectedPrincipal: intent.sourceId,
    grantKind: 'source-keeper-user',
    at,
    completedAt,
    reset: number(response?.rate?.reset),
    retryAfter: number(response?.rate?.retryAfter),
  };
}
export function validRaidDiagnostic(d, intent) {
  return (
    d &&
    Buffer.byteLength(JSON.stringify(d)) <= 1024 &&
    d.intentId === intent.id &&
    d.sourceId === intent.sourceId &&
    d.targetId === intent.targetId
  );
}

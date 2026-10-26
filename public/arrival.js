// Receipt-time seeking, never replay-on-connect. No Twitch countdown is inferred.
export function arrivalPhase(handoff, serverNow, reducedMotion = false) {
  if (
    !handoff ||
    handoff.role !== 'host' ||
    serverNow < handoff.startedAt ||
    serverNow >= handoff.endsAt
  )
    return { phase: 'idle', progress: 1 };
  const elapsed = serverNow - handoff.startedAt;
  if (reducedMotion || elapsed >= 20000) return { phase: 'settled', progress: 1 };
  if (elapsed < 3000) return { phase: 'streak', progress: elapsed / 3000 };
  if (elapsed < 5000) return { phase: 'impact', progress: (elapsed - 3000) / 2000 };
  return { phase: 'unfurl', progress: (elapsed - 5000) / 15000 };
}

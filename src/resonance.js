import { publicOverlayState, runeSvg } from './marks.js';
import { withCarriedMarks } from './public-view.js';

// Decorative copied-word echo, not session membership or command authority.
export function echoCandidate(chat, config, now, sentAt) {
  return Boolean(config && chat?.copied && chat.echoText && !chat.isBot
    && config.channels.includes(chat.copied.origin) && config.channels.includes(chat.broadcasterId)
    && sentAt <= now && now - sentAt <= 5000);
}
export function reduceEcho(previous, channels, docs, lineage, chat, now) {
  const registry = structuredClone(previous ?? {}), host = chat.broadcasterId;
  const allowed = id => {
    const c = channels[id], d = docs[id];
    return c?.online && c.optedIn && !c.paused && !c.banned && !c.blockedUserIds.includes(id)
      && !c.blockedUserIds.includes(chat.chatterId) && d?.context?.optedIn && !d.paused
      && d.context.streamId === c.streamId && !d.blocked.includes(id) && !d.blocked.includes(chat.chatterId)
      && !d.context.blockedUserIds.includes(chat.chatterId);
  };
  const seen = (registry.echoSeen ?? []).filter(item => item.until > now).slice(-8);
  if (registry.holderId !== host || !allowed(host) || !allowed(chat.copied.origin)
    || seen.some(item => item.key === chat.copied.key) || (registry.echoLastAt !== undefined && now - registry.echoLastAt < 10000)) return null;
  const doc = docs[host], session = doc.sessions.find(item => item.streamId === doc.context.streamId);
  const exactLocal = session?.marks.some(mark => mark.status === 'approved' && mark.text === chat.echoText && !doc.blocked.includes(mark.userId) && !channels[host].blockedUserIds.includes(mark.userId) && !doc.context.blockedUserIds.includes(mark.userId));
  const last = lineage?.stops?.at(-1);
  const exactCarried = last?.to === host && last.marks.some(mark => mark.text === chat.echoText);
  if (!exactLocal && !exactCarried) return null;
  const view = withCarriedMarks(publicOverlayState(docs[host], host), lineage, registry, host);
  if (view.status !== 'ready' || !view.marks.some(mark => mark.runeSvg === runeSvg(chat.echoText))) return null;
  registry.echoSeen = [...seen, { key: chat.copied.key, until: now + 60000 }].slice(-8);
  registry.echoLastAt = now;
  registry.echo = { at: now, until: now + 1200, id: chat.copied.key };
  if (Buffer.byteLength(JSON.stringify(registry)) > 4096) throw new Error('Relic registry capacity reached');
  return registry;
}
export function echoView(registry, host, now) {
  const cue = registry?.echo;
  return registry?.holderId === host && cue && now >= cue.at && now < cue.until
    ? { receivedAt: cue.at, expiresAt: cue.until, id: cue.id } : undefined;
}

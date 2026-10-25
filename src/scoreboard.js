import { ackDocument, ackKey, ackStep } from './claim-ack.js';
import { hash } from './crypto.js';
import { INITIAL_HOME } from './lifecycle.js';
export const SCORE_LIMITS = Object.freeze({ players: 128, bytes: 65536, top: 20 });
export const TWITCHCON = Object.freeze({ label: 'TwitchCon San Diego 2026', source: 'https://www.twitchcon.com/san-diego-2026/', checked: '2026-10-25', startsAt: Date.parse('2026-11-13T08:00:00Z'), endsAt: Date.parse('2026-11-16T08:00:00Z') });
export const isScoreCommand = chat => ['scores-on','scores-off','top','badges'].includes(chat?.markAction?.type);
const login = value => typeof value === 'string' && /^[a-z0-9_]{1,25}$/.test(value);
const actorKey = id => hash(`score-actor-v1:${id}`);
const link = hop => hash(`score-hop-v1:${hop?.intentId ?? hop?.eventId}`);
const retained = (host, channels, marks, id) => channels[host]?.optedIn && !channels[host]?.banned && marks[host]?.context?.optedIn && !channels[host]?.blockedUserIds?.includes(id) && !marks[host]?.blocked?.includes(id);
const allowed = (host, channels, marks, id) => retained(host, channels, marks, id) && !channels[host]?.paused && !marks[host]?.paused;
export function retainedScores(scores, channels, marks) {
  return { ...scores, players: (scores?.players ?? []).filter(p => p.channels.every(host => retained(host,channels,marks))
    && !Object.keys(channels).some(host => [...(channels[host]?.blockedUserIds ?? []), ...(marks[host]?.blocked ?? [])].some(id => actorKey(id) === p.key))) };
}
// Private bounded consent/aggregate document. No raw actor IDs or chat text.
export function reduceScores(previous, { channels, marks, chat, now, vote, completion, hop }) {
  const doc = structuredClone(previous ?? { version: 1, players: [], receipts: [] });
  const action = chat?.markAction?.type, key = chat && actorKey(chat.chatterId);
  doc.receipts = doc.receipts.filter(r => r.until > now);
  doc.players = retainedScores(doc,channels,marks).players.filter(p => !(action === 'forgetme' && p.key === key));
  let message = null;
  const scoreCommand = isScoreCommand(chat);
  const request = scoreCommand ? hash(JSON.stringify(['score-command-v1',chat.broadcasterId,chat.chatterId,chat.messageId])) : null;
  // Withdrawal is an erasure, never contingent on reply/receipt capacity or pause.
  if (action === 'scores-off' && !doc.receipts.some(r=>r.key===request) && !chat.isBot && !chat.copied && channels[chat.broadcasterId] && /^\d{1,32}$/.test(chat.chatterId)) doc.players = doc.players.filter(p => p.key !== key);
  if (scoreCommand && !chat.isBot && !chat.copied && channels[chat.broadcasterId]?.online && allowed(chat.broadcasterId, channels, marks, chat.chatterId)) {
    if (action !== 'scores-off' && !doc.receipts.some(r => r.key === request) && doc.receipts.length >= 128) message = 'Score requests are busy. No consent change was accepted. Use !relic forgetme to erase retained content and scores.';
    if (!doc.receipts.some(r => r.key === request) && doc.receipts.length < 128) {
      const rate = hash(`score-rate-v1:${chat.broadcasterId}:${chat.chatterId}:${action==='scores-off'?'erase':'read'}`);
      const limited = doc.receipts.some(r => r.rate === rate && r.at + 30000 > now);
      // Minimal original-message receipts survive erasure and rate rejection for ten minutes.
      doc.receipts.push({ key: request, until: now + 600000, ...(limited ? {} : { rate, at: now }) });
      if (action === 'scores-off') { doc.players = doc.players.filter(p => p.key !== key); message = limited ? null : 'Public scores off. Your score name, participation count and links have been erased.'; }
      else if (!limited && action === 'scores-on') {
        if (!login(chat.chatterLogin)) message = 'Scores need your verified Twitch login. No public score was created.';
        else {
          let row = doc.players.find(p => p.key === key);
          if (!row && doc.players.length >= 128) message = 'The public score register is full. Your claims still work; no score was created.';
          else { if (!row) { row = { key, login: chat.chatterLogin, channels: [], joined: 0, since: now }; doc.players.push(row); }
            // A verified rename updates this self-consented row, never rekeys history.
            row.login = chat.chatterLogin; if (!row.channels.length) row.channels.push(chat.broadcasterId);
            message = `@${row.login}: public scores on for future completed claims. Anyone can see this name and count. Use !relic scores off to erase them.`;
          }
        }
      } else if (!limited && ['top','badges'].includes(action)) message = action;
    }
  }
  if (vote) { const row = doc.players.find(p => p.key === actorKey(vote)); if (row && row.since <= now) row.vote = link(hop); }
  if (completion) for (const row of doc.players) {
    if (row.vote === completion.link && completion.actors.some(id => actorKey(id) === row.key)) { row.joined++; delete row.vote; }
  }
  // Metadata exhaustion must never abort a game transfer. Opt-ins are refused first.
  if (Buffer.byteLength(JSON.stringify(doc)) > SCORE_LIMITS.bytes) throw Error('Score capacity invariant');
  return { doc, message };
}
export const scoreCompletion = (hop, actors) => ({ link: link(hop), actors });
// Public projection is an explicit whitelist; history is bounded, never an all-time claim.
export function scoreboard(lineage, registry, scores, config, now) {
  const stops = lineage?.stops ?? [];
  if (stops.length > 16 || !Number.isSafeInteger(now) || now < 0) throw Error('Invalid score archive');
  const seen = new Set(); let last = -1;
  for (let i = 0; i < stops.length; i++) { const s = stops[i];
    if (!config?.channels.includes(s.from) || !config.channels.includes(s.to) || s.from === s.to || !Number.isSafeInteger(s.claimedAt) || s.claimedAt < last || s.claimedAt > now || s.ringIndex !== i + 1 || typeof s.eventId !== 'string' || seen.has(s.eventId) || (i && stops[i-1].to !== s.from)) throw Error('Invalid score archive');
    seen.add(s.eventId); last = s.claimedAt;
  }
  const rows = config.channels.map(id => ({ channelId: id, login: Object.entries(config.logins).find(([,v])=>v===id)?.[0] ?? null, knownHoldSeconds: 0, hopsCarried: 0, badges: [] }));
  const row = id => rows.find(r=>r.channelId===id);
  if (registry?.originated || stops[0]?.from === INITIAL_HOME) row(INITIAL_HOME)?.badges.push('First Keeper');
  for (let i=0;i<stops.length;i++) { const s=stops[i], r=row(s.from); r.hopsCarried++;
    if ([1,5,10].includes(s.ringIndex)) r.badges.push(`Ring ${s.ringIndex}`);
    if (i>=2) r.badges.push('Chain of 3');
    if (i===0 && s.claimedAt>=TWITCHCON.startsAt && s.claimedAt<TWITCHCON.endsAt) r.badges.push('Carried during TwitchCon San Diego 2026');
    if (i) { const held=row(stops[i-1].to), start=stops[i-1].claimedAt; held.knownHoldSeconds += (s.claimedAt-start)/1000; if(start < TWITCHCON.endsAt && s.claimedAt > TWITCHCON.startsAt && s.claimedAt > start) held.badges.push('Carried during TwitchCon San Diego 2026'); }
  }
  if (stops.length && registry?.holderId === stops.at(-1).to) { const held=row(registry.holderId), start=stops.at(-1).claimedAt; held.knownHoldSeconds += (now-start)/1000; if(start < TWITCHCON.endsAt && now >= TWITCHCON.startsAt) held.badges.push('Carried during TwitchCon San Diego 2026'); }
  for (const r of rows) { r.knownHoldSeconds=Math.floor(r.knownHoldSeconds); if(r.knownHoldSeconds>=86400)r.badges.push('24h Keeper'); r.badges=[...new Set(r.badges)]; }
  rows.sort((a,b)=>b.knownHoldSeconds-a.knownHoldSeconds||b.hopsCarried-a.hopsCarried||a.channelId.localeCompare(b.channelId));
  if ((scores?.players?.length ?? 0) > 128 || (scores?.players ?? []).some(p => !login(p.login) || !Number.isInteger(p.joined) || p.joined < 0 || p.joined > 16 || !Number.isSafeInteger(p.since) || p.since < 0 || p.since > now)) throw Error('Invalid score aggregate');
  const raiders=(scores?.players??[]).filter(p=>login(p.login)).map(p=>({ login:p.login, claimsJoined:p.joined, since:p.since })).sort((a,b)=>b.claimsJoined-a.claimsJoined||a.login.localeCompare(b.login)).slice(0,20);
  return { asOf:now, rings:stops.length, coverage:'Retained completed archive only. Initial home hold start is unknown; historical raider participation is not available. Raider counts start after explicit score opt-in, never retroactively.', channels:rows, raiders, event:TWITCHCON };
}
export function scoreMessage(kind, view, host) {
  if(kind==='badges') return `Keeper badges: ${view.channels.find(r=>r.channelId===host)?.badges.join(', ') || 'none recorded yet'}. Retained completed archive only.`.slice(0,500);
  return `Recorded Keepers: ${view.channels.map(r=>`${r.login??r.channelId}: ${r.hopsCarried} hops, ${r.knownHoldSeconds}s known hold`).join('; ')}. Opted-in raiders: ${view.raiders.slice(0,3).map(r=>`@${r.login} ${r.claimsJoined}`).join(', ')||'none recorded'}. Not all-time history.`.slice(0,500);
}

export function scoreAckDocument(previous, chat, message, channel, marks, now) {
  const clean = ackDocument(previous, null, null, channel, marks, now);
  if (clean.rows.length >= 128 && !clean.rows.some(r=>r.key===ackKey(chat))) return clean;
  const doc = ackDocument(clean, chat, message, channel, marks, now, now);
  const row = doc.rows.find(r=>r.key===ackKey(chat));
  if (row?.status==='queued') { row.scoreKind=chat.markAction.type; if(row.scoreKind==='scores-on' && row.message.startsWith('@')) { row.consentKey=actorKey(chat.chatterId); row.message='Public score consent updated.'; } if(['top','badges'].includes(row.scoreKind)) row.message='Read public score summary.'; }
  // Bounded score metadata is separate from the gameplay ACK register.
  if (Buffer.byteLength(JSON.stringify(doc))>65536) { if(row?.status==='queued'){ row.status='cancelled';delete row.message;delete row.actorKey;delete row.consentKey; } }
  return doc;
}
export function scoreAckMutation(previous, op, channel, marks, now, scores, lineage, registry, config, host) {
  const doc=structuredClone(previous??{rows:[]}), row=doc.rows.find(r=>r.key===op.key);
  if(op.type==='claim'&&row?.status==='queued') {
    if(row.consentKey) { const consent=scores?.players.find(p=>p.key===row.consentKey); if(!consent) {row.status='cancelled';delete row.message;delete row.actorKey;} else row.message=`@${consent.login}: public scores on for future completed claims. Anyone can see this name and count. Use !relic scores off to erase them.`; }
    if(['top','badges'].includes(row.scoreKind)) row.message=scoreMessage(row.scoreKind,scoreboard(lineage,registry,scores,config,now),host);
  }
  const next=ackStep(doc,op,channel,marks,now);
  for(const r of next.doc.rows) if(r.status!=='queued'){delete r.consentKey;delete r.scoreKind;}
  return next;
}

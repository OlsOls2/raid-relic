import { boundedCall } from './bounded.js';
export class ChatSendError extends Error { constructor(stage, httpStatus = null, dropKind = null, isSent = null) { super('Chat message not sent'); this.diagnostic = { stage, httpStatus, dropKind, isSent }; } }
import { httpTransport } from './oauth.js';
import { hash } from './crypto.js';
import { normalizeMark, parseMarkCommand } from './marks.js';

export function parseChat(payload, { streamerId, botId, includeMarkCommands = false }) {
  const event = payload.event; const condition = payload.subscription?.condition;
  if (payload.subscription?.type !== 'channel.chat.message' || payload.subscription?.version !== '1' || condition?.broadcaster_user_id !== streamerId || condition.user_id !== botId
    || event?.broadcaster_user_id !== streamerId || typeof event?.chatter_user_id !== 'string' || !/^\d{1,32}$/.test(event.chatter_user_id)
    || typeof event.message_id !== 'string' || !event.message_id || event.message_id.length > 256
    || typeof event.message?.text !== 'string' || event.message.text.length > 2000
    || !Array.isArray(event.message.fragments) || event.message.fragments.length > 500
    || !event.message.fragments.every(fragment => fragment && ['text', 'emote', 'cheermote', 'mention'].includes(fragment.type) && typeof fragment.text === 'string')) throw new Error('Invalid chat payload');
  const chat = { broadcasterId: streamerId, chatterId: event.chatter_user_id, messageId: event.message_id };
  if (event.chatter_user_id === botId) chat.isBot = true;
  const origin = event.source_broadcaster_user_id, sourceMessage = event.source_message_id;
  if (origin != null || sourceMessage != null) {
    if (typeof origin !== 'string' || !/^\d{1,32}$/.test(origin) || typeof sourceMessage !== 'string'
      || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(sourceMessage)) throw new Error('Invalid copied chat metadata');
    if (origin !== streamerId) {
      // Never interpret copied text/badges as local commands or local role proof.
      chat.copied = { origin, key: hash(`${origin}:${sourceMessage.toLowerCase()}`) };
      const text = normalizeMark(event.message.text);
      if (text && !chat.isBot) chat.echoText = text;
      return chat;
    }
  }

  if (typeof event.chatter_user_login === 'string' && /^[a-zA-Z0-9_]{1,25}$/.test(event.chatter_user_login)) chat.chatterLogin = event.chatter_user_login.toLowerCase();
  if (includeMarkCommands) {
    const action = parseMarkCommand(event.message.text);
    if (action) {
      if (event.badges !== undefined && (!Array.isArray(event.badges) || event.badges.length > 100)) throw new Error('Invalid chat badges');
      chat.markAction = action;
      chat.isModerator = (event.badges ?? []).some(badge => badge?.set_id === 'moderator' && badge.id === '1');
    }
  }
  return chat;
}

export function createBot({ oauth, clientId, clientSecret, streamerId, botId, callbackUrl, webhookSecret, transport = httpTransport }) {
  if (!oauth || !clientId || !clientSecret || !/^\d+$/.test(streamerId ?? '') || !/^\d+$/.test(botId ?? '') || streamerId === botId) throw new Error('Bot configuration required');
  async function call(url, options) {
    try { return await boundedCall(signal => transport(url, { ...options, signal })); } catch { throw new Error('Bot request failed'); }
  }
  const headers = token => ({ Authorization: `Bearer ${token}`, 'Client-Id': clientId, 'content-type': 'application/json' });
  async function sendChat(message, { retryUnauthorized = true } = {}) {
    if (typeof message !== 'string' || !message.trim() || [...message].length > 500) throw new Error('Invalid chat message');
    for (let attempt = 0; attempt < 2; attempt++) {
      let token; try { token = await oauth.accessToken('bot', { refresh: attempt === 1 }); } catch { throw new ChatSendError('bot-grant'); }
      let response; try { response = await call('https://api.twitch.tv/helix/chat/messages', { method: 'POST', headers: headers(token),
        body: JSON.stringify({ broadcaster_id: streamerId, sender_id: botId, message }) }); } catch { throw new ChatSendError('transport'); }
      if (response.status === 401 && attempt === 0 && retryUnauthorized) continue;
      const sent = response.data?.data?.[0];
      if (response.status !== 200 || sent?.is_sent !== true || typeof sent.message_id !== 'string') {
        const known = ['automod_held', 'user_banned', 'channel_suspended', 'msg_banned', 'msg_duplicate', 'msg_ratelimit'];
        const code = sent?.drop_reason?.code;
        throw new ChatSendError('response', Number.isInteger(response.status) && response.status >= 100 && response.status <= 599 ? response.status : null, typeof code === 'string' ? known.includes(code) ? code : 'other' : sent?.is_sent === false ? 'not-sent' : response.status === 200 ? 'malformed-response' : null, typeof sent?.is_sent === 'boolean' ? sent.is_sent : null);
      }
      return { messageId: sent.message_id };
    }
  }
  function chatSubscription() {
    const callback = new URL(callbackUrl);
    if (callback.protocol !== 'https:' || callback.username || callback.password || callback.search || callback.hash || callback.pathname !== '/eventsub'
      || typeof webhookSecret !== 'string' || webhookSecret.length < 10 || webhookSecret.length > 100) throw new Error('Webhook configuration required');
    return { type: 'channel.chat.message', version: '1', condition: { broadcaster_user_id: streamerId, user_id: botId },
      transport: { method: 'webhook', callback: callbackUrl, secret: webhookSecret } };
  }
  async function subscribeChat() {
    const payload = chatSubscription();
    await oauth.accessToken('streamer'); await oauth.accessToken('bot');
    const response = await call('https://id.twitch.tv/oauth2/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' }).toString() });
    const token = response.data?.access_token;
    if (response.status !== 200 || typeof token !== 'string' || !token) throw new Error('App token unavailable');
    const created = await call('https://api.twitch.tv/helix/eventsub/subscriptions', { method: 'POST', headers: headers(token), body: JSON.stringify(payload) });
    if (created.status !== 202 || typeof created.data?.data?.[0]?.id !== 'string') throw new Error('Chat subscription not created');
    return { subscriptionId: created.data.data[0].id };
  }
  return { sendChat, chatSubscription, subscribeChat };
}

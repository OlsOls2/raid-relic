import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeMark,
  parseMarkCommand,
  markReviewPolicy,
  setMarkContext,
  reduceMark,
  publicMarks,
  MARK_LIMITS,
} from '../src/marks.js';
import { pilotFixture, HOME, OTHER, BOT } from '../test-support/pilot-fixture.js';

// Explicit independent examples, not a generated cross-product or a toxicity score.
const vectors = [
  ['skill is not kill', 'skill', 'skill'],
  ['skilled is not kill', 'skilled', 'skilled'],
  ['skills is not kill', 'skills', 'skills'],
  ['skillful is not kill', 'skillful', 'skillful'],
  ['skillfulness is not kill', 'skillfulness', 'skillfulness'],
  ['skillet is not kill', 'skillet', 'skillet'],
  ['skilling is not kill', 'skilling', 'skilling'],
  ['upskill is not kill', 'upskill', 'upskill'],
  ['reskilled is not kill', 'reskilled', 'reskilled'],
  ['scripture is benign', 'scripture', 'scripture'],
  ['moon is benign', 'moon', 'moon'],
  ['orchid is benign', 'orchid', 'orchid'],
  ['case folded skill', 'SKILL', 'skill'],
  ['fullwidth skill', 'ＳＫＩＬＬ', 'skill'],
  ['fullwidth skilled', 'ＳＫＩＬＬＥＤ', 'skilled'],
  ['compatibility circled letters', 'ⓢⓚⓘⓛⓛ', 'skill'],
  ['sharp s fold', 'Straße', 'strasse'],
  ['combining accent normalization', 'CAFE\u0301', 'café'],
  ['accented unicode word', 'ÉTOILE', 'étoile'],
  ['Greek final sigma fold', 'ΣΟΣ', 'σοσ'],
  ['Arabic word', 'مرحبا', 'مرحبا'],
  ['Japanese word', '月光', '月光'],
  ['blocked kill exact', 'kill', null],
  ['blocked kill uppercase', 'KILL', null],
  ['blocked kill fullwidth', 'ＫＩＬＬ', null],
  ['blocked kill circled', 'ⓚⓘⓛⓛ', null],
  ['blocked profanity exact', 'fuck', null],
  ['blocked profanity fullwidth', 'ＦＵＣＫ', null],
  ['blocked second profanity exact', 'shit', null],
  ['blocked second profanity mixed case', 'ShIt', null],
  ['blocked nazi exact', 'nazi', null],
  ['blocked nazi fullwidth', 'ＮＡＺＩ', null],
  ['blocked porn exact', 'porn', null],
  ['blocked porn mixed case', 'PoRn', null],
  ['blocked suicide exact', 'suicide', null],
  ['blocked suicide uppercase', 'SUICIDE', null],
  ['blocked https exact', 'https', null],
  ['blocked www exact', 'WWW', null],
  ['leet digit one', 'k1ll', null],
  ['leet uppercase digit one', 'K1LL', null],
  ['leet double ones', 'ki11', null],
  ['leet mixed digit suffix', 'k!ll', null],
  ['leet dollar letter', '$hit', null],
  ['leet profanity digit', 'sh1t', null],
  ['leet second digit', 'fu<k', null],
  ['leet at sign', 'n@zi', null],
  ['leet zero', 'p0rn', null],
  ['leet numeric suicide', 'su1c1de', null],
  ['fullwidth leet digit', 'ｋ１ｌｌ', null],
  ['leet punctuation separation', 'k.i.l.l', null],
  ['leet underscore separation', 'k_i_l_l', null],
  ['phrase separation', 'k i l l', null],
  ['hyphenated words unsupported', 'moon-star', null],
  ['two words unsupported', 'moon star', null],
  ['leading whitespace unsupported', ' moon', null],
  ['trailing whitespace unsupported', 'moon ', null],
  ['URL https unsupported', 'https://example.test', null],
  ['URL http unsupported', 'http://example.test', null],
  ['URL bare unsupported', 'www.example.test', null],
  ['email unsupported', 'moon@example.test', null],
  ['mention unsupported', '@moon', null],
  ['html unsupported', '<svg>', null],
  ['prototype key unsupported', '__proto__', null],
  ['JSON unsupported', '{"moon":true}', null],
  ['empty unsupported', '', null],
  ['nonstring null unsupported', null, null],
  ['nonstring object unsupported', {}, null],
  ['nonstring number unsupported', 123, null],
  ['newline control', 'moon\n', null],
  ['tab control', 'moon\t', null],
  ['null control', 'mo\u0000on', null],
  ['bidi override', 'mo\u202eon', null],
  ['zero width space', 'mo\u200bon', null],
  ['word joiner', 'mo\u2060on', null],
  ['word ZWJ unsupported', 'mo\u200don', null],
  ['word ZWNJ unsupported', 'mo\u200con', null],
  ['unpaired surrogate', '\ud800', null],
  ['unicode line separator', 'mo\u2028on', null],
  ['unicode paragraph separator', 'mo\u2029on', null],
  ['exact codepoint limit', 'a'.repeat(32), 'a'.repeat(32)],
  ['over codepoint limit', 'a'.repeat(33), null],
  ['exact raw byte limit unicode letters', '𠀀'.repeat(32), '𠀀'.repeat(32)],
  ['over raw byte limit unicode letters', '𠀀'.repeat(33), null],
  ['oversize normalized word', 'é'.repeat(65), null],
  ['raw cap applies before compatibility shrinking', 'ⓐ'.repeat(43), null],
  ['gem emoji supported', '💎', '💎'],
  ['moon emoji supported', '🌙', '🌙'],
  ['heart variation selector supported', '❤️', '❤️'],
  ['thumb modifier supported', '👍🏽', '👍🏽'],
  ['ZWJ astronaut supported', '👩🏽‍🚀', '👩🏽‍🚀'],
  ['ZWJ family supported', '👨‍👩‍👧‍👦', '👨‍👩‍👧‍👦'],
  ['regional flag supported', '🇬🇧', '🇬🇧'],
  ['numeric keycap supported', '1️⃣', '1️⃣'],
  ['hash keycap supported', '#️⃣', '#️⃣'],
  ['bare digit unsupported', '1', null],
  ['two gems unsupported', '💎💎', null],
  ['two flags unsupported', '🇬🇧🇫🇷', null],
  ['emoji plus word unsupported', '💎moon', null],
  ['emoji whitespace unsupported', '💎 🌙', null],
  ['stray modifier unsupported', '🏽', null],
  ['leading variation selector unsupported', '\ufe0f💎', null],
  ['trailing ZWJ unsupported', '💎\u200d', null],
];
assert.ok(vectors.length >= 60);
assert.equal(new Set(vectors.map(([name]) => name)).size, vectors.length);
for (const [name, input, expected] of vectors)
  test('offline mark filter: ' + name, () => {
    assert.equal(normalizeMark(input), expected);
  });

test('mark command delegates its bounded single token to the same offline filter', () => {
  assert.deepEqual(parseMarkCommand('!mark ＳＫＩＬＬ'), { type: 'mark', text: 'skill' });
  for (const input of ['kill', 'k1ll', 'n@zi', '__proto__', 'https://example.test'])
    assert.deepEqual(parseMarkCommand('!mark ' + input), { type: 'mark', text: null });
});

const viewer = { broadcasterId: '201', chatterId: '101' };
const context = () =>
  setMarkContext(null, '201', {
    streamId: 'synthetic-filter-stream',
    keeperId: '201',
    optedIn: true,
    holdsRelic: true,
    blockedUserIds: [],
  });
test('emoji acceptance never grants approval: default/forged policy stays pending; only trusted operator policy can auto-approve', () => {
  for (const policy of [
    undefined,
    {},
    { autoApprove: true, terms: [] },
    JSON.parse('{"autoApprove":true,"terms":[]}'),
    Object.assign(Object.create(null), { autoApprove: true, terms: [] }),
  ]) {
    const next = reduceMark(
      context(),
      '201',
      viewer,
      { type: 'mark', text: '💎', status: 'approved', autoApprove: true },
      100,
      policy,
    );
    assert.equal(next.sessions[0].marks[0].status, 'pending');
    assert.deepEqual(publicMarks(next, '201'), { marks: [] });
  }
  const policy = markReviewPolicy({ MARK_AUTO_APPROVE_ENABLED: 'true' });
  let next = reduceMark(context(), '201', viewer, { type: 'mark', text: '💎' }, 100);
  next = reduceMark(
    next,
    '201',
    { ...viewer, chatterId: '102' },
    { type: 'mark', text: '🌙' },
    101,
    policy,
  );
  assert.deepEqual(
    next.sessions[0].marks.map((m) => m.status),
    ['pending', 'approved'],
  );
  assert.equal(publicMarks(next, '201').marks.length, 1);
  assert.equal(next.sessions[0].spent, 2);
  assert.equal(MARK_LIMITS.perViewerPerStream, 5);
  assert.equal(MARK_LIMITS.cooldownMs, 30000);
});

for (const kind of ['memory', 'firestore'])
  test(`${kind}: signed skill remains private until owner approval; rejected leet/exact words spend nothing and forget refunds nothing`, async () => {
    const f = await pilotFixture(kind);
    for (const id of [BOT, HOME, OTHER]) await f.login(id);
    for (const id of [HOME, OTHER]) {
      await f.control(id, 'bootstrap');
      f.advance();
      await f.control(id, 'keep');
      f.advance();
    }
    await f.chat(HOME, '101', '!mark skill', { messageId: 'filter-skill' });
    await f.chat(HOME, '101', '!mark skill', { messageId: 'filter-skill' });
    let doc = await f.runtime.state.getPrivateMarks(HOME, { broadcasterId: HOME, chatterId: HOME });
    const current = () => doc.sessions.find((s) => s.streamId === doc.context.streamId);
    assert.equal(current().spent, 1);
    assert.equal(current().marks[0].text, 'skill');
    assert.equal(current().marks[0].status, 'pending');
    assert.equal((await f.runtime.state.getPublicMarks(HOME)).marks.length, 0);
    await f.chat(HOME, '102', '!relic approve m1');
    assert.equal((await f.runtime.state.getPublicMarks(HOME)).marks.length, 0);
    await f.chat(HOME, HOME, '!relic approve m1');
    assert.equal((await f.runtime.state.getPublicMarks(HOME)).marks.length, 1);
    f.advance(30001);
    await f.chat(HOME, '101', '!mark k1ll');
    await f.chat(HOME, '101', '!mark kill');
    await f.chat(HOME, '101', '!mark 💎');
    doc = await f.runtime.state.getPrivateMarks(HOME, { broadcasterId: HOME, chatterId: HOME });
    assert.equal(current().spent, 2);
    assert.deepEqual(
      current().marks.map((m) => m.status),
      ['approved', 'pending'],
    );
    assert.equal((await f.runtime.state.getPublicMarks(HOME)).marks.length, 1);
    await f.chat(HOME, '101', '!relic forgetme');
    doc = await f.runtime.state.getPrivateMarks(HOME, { broadcasterId: HOME, chatterId: HOME });
    assert.equal(current().marks.length, 0);
    assert.equal(current().viewers.find((v) => v.userId === '101').spent, 2);
    assert.equal(current().spent, 2);
    assert.equal((await f.runtime.state.getPublicMarks(HOME)).marks.length, 0);
  });

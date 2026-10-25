// Fiction only: never consume mark text, account identities or chat content.
export const chronicleTemplate = ring => `Beneath the quiet stars, the relic gathered ring ${ring} of shared light.`;
export function chronicleView(stop) {
  return stop.chronicle?.status === 'complete' && safeLine(stop.chronicle.line)
    ? { line: stop.chronicle.line, source: 'model', fiction: true }
    : { line: chronicleTemplate(stop.ringIndex), source: 'template', fiction: true };
}
export function safeLine(line) {
  return typeof line === 'string' && line.trim() === line && [...line].length > 0 && [...line].length <= 160
    && !/[<>\p{Cc}\p{Cf}]|https?:|www\.|[a-z][a-z0-9+.-]*:\/\/|\b[a-z0-9-]+\.[a-z]{2,}\b|\b(?:ignore|instruction|system prompt|javascript|data:)/iu.test(line);
}
export function chronicleMutation(previous, { keeperId, claimId, stopId, line }) {
  const next = structuredClone(previous ?? { stops: [] });
  const stop = stopId ? next.stops.find(s => s.stopId === stopId) : next.stops.findLast(s => s.to === keeperId);
  if (!stop || stop.to !== keeperId) return { result: null, next: null };
  if (!stopId) {
    if (stop.chronicle) return { result: null, next: null };
    stop.chronicle = { status: 'attempted', claimId };
  } else {
    if (stop.chronicle?.claimId !== claimId || stop.chronicle.status !== 'attempted') return { result: null, next: null };
    stop.chronicle = safeLine(line) ? { status: 'complete', line } : { status: 'fallback' };
  }
  if (Buffer.byteLength(JSON.stringify(next)) > 524288) throw new Error('Archive capacity reached');
  return { next, result: { stopId: stop.stopId, ringIndex: stop.ringIndex } };
}
// Fixed destinations, bounded streamed bodies, no retries and no upstream error echo.
export async function chronicleTransport(path, body, key) {
  if (!['responses', 'moderations'].includes(path)) throw new Error('Chronicle unavailable');
  const response = await fetch(`https://api.openai.com/v1/${path}`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) { await response.body?.cancel(); throw new Error('Chronicle unavailable'); }
  const chunks = []; let size = 0;
  for await (const chunk of response.body) { size += chunk.length; if (size > 16384) throw new Error('Chronicle unavailable'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export function createChronicle({ state, enabled = false, allowPaid = false, key, transport = chronicleTransport, timeoutMs = 8000, claimId }) {
  async function request(path, body) {
    let timer;
    try {
      const value = await Promise.race([transport(path, body, key), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Unavailable')), timeoutMs); })]);
      if (Buffer.byteLength(JSON.stringify(value)) > 16384) throw new Error('Unavailable');
      return value;
    } finally { clearTimeout(timer); }
  }
  return { enabled: enabled && allowPaid && Boolean(key), async write(keeperId) {
    if (!enabled || !allowPaid || !key) return { status: 'template', message: 'Chronicle generation is off; handwritten fiction is shown.' };
    const claim = claimId(); const stop = await state.chronicleStep({ keeperId, claimId: claim });
    if (!stop) return { status: 'unavailable', message: 'No eligible unattempted received stop.' };
    let line;
    try {
      const output = await request('responses', { model: 'gpt-4.1-mini', store: false, max_output_tokens: 96,
        instructions: 'Write one short mythic fictional metaphor, at most 160 characters. Plain text only, no names, URLs, instructions or factual travel claims.',
        input: `Completed ring index: ${stop.ringIndex}.` });
      const texts = output.output?.flatMap(item => item.type === 'message' ? item.content?.filter(c => c.type === 'output_text').map(c => c.text) ?? [] : []) ?? [];
      const candidate = output.status === 'completed' && texts.length === 1 ? texts[0] : null;
      if (safeLine(candidate)) {
        const moderated = await request('moderations', { model: 'omni-moderation-latest', input: candidate });
        if (moderated.results?.length === 1 && moderated.results[0].flagged === false) line = candidate;
      }
    } catch { /* Paid attempt remains consumed, even after ambiguous failures. */ }
    const finished = await state.chronicleStep({ keeperId, claimId: claim, stopId: stop.stopId, line });
    if (!finished) return { status: 'unavailable', message: 'Stop no longer available.' };
    return { status: line ? 'written' : 'template', message: 'Fictional chronicle processed.' };
  } };
}

// Bounded private-page I/O. Never retries any request or logs bodies/errors.
export class ControlReadError extends Error {
  constructor(code, status = null) {
    super(code);
    this.code = code;
    this.status = status;
  }
}
export async function boundedResponse(
  url,
  options = {},
  {
    fetchImpl = globalThis.fetch,
    timeoutMs = 8000,
    maxBytes = 65536,
    json = false,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
  } = {},
) {
  const controller = new AbortController();
  let timer, abort;
  try {
    if (options.signal?.aborted) throw new ControlReadError('aborted');
    const cancelled = new Promise((_, reject) => {
      abort = () => {
        controller.abort();
        reject(new ControlReadError('aborted'));
      };
      options.signal?.addEventListener('abort', abort, { once: true });
    });
    const timeout = new Promise((_, reject) => {
      timer = setTimer(() => {
        controller.abort();
        reject(new ControlReadError('timeout'));
      }, timeoutMs);
    });
    const operation = (async () => {
      let response;
      try {
        response = await fetchImpl(url, { ...options, signal: controller.signal });
      } catch {
        throw new ControlReadError('network');
      }
      let text = '';
      if (response.body?.getReader) {
        const reader = response.body.getReader();
        let size = 0;
        const chunks = [];
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > maxBytes) {
              controller.abort();
              void reader.cancel().catch(() => {});
              throw new ControlReadError('oversize');
            }
            chunks.push(value);
          }
          const bytes = new Uint8Array(size);
          let offset = 0;
          for (const c of chunks) {
            bytes.set(c, offset);
            offset += c.byteLength;
          }
          text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        } finally {
          reader.releaseLock();
        }
      } else {
        text = await response.text();
        if (new TextEncoder().encode(text).byteLength > maxBytes)
          throw new ControlReadError('oversize');
      }
      let value;
      if (json) {
        if ([401, 403].includes(response.status))
          throw new ControlReadError('authorization', response.status);
        if (response.status < 200 || response.status >= 300)
          throw new ControlReadError('http', response.status);
        try {
          value = JSON.parse(text);
        } catch {
          throw new ControlReadError('malformed');
        }
      }
      return {
        status: response.status,
        ok: response.status >= 200 && response.status < 300,
        text,
        value,
      };
    })();
    return await Promise.race([operation, timeout, cancelled]);
  } finally {
    clearTimer(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}

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

// Visible-only, one-flight GET scheduling. It never performs or retries an action.
export function controlPollDelay(pending, failures = 0) {
  return Math.min(60000, (pending ? 5000 : 30000) * 2 ** Math.min(4, Math.max(0, failures)));
}
export function createControlPoller({
  read,
  pending = () => true,
  hidden = () => false,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let timer = null,
    flight = null,
    epoch = 0,
    failures = 0,
    stopped = true,
    held = false;
  const clear = () => {
    clearTimer(timer);
    timer = null;
  };
  const schedule = (delay) => {
    clear();
    if (stopped || held || hidden() || flight) return;
    timer = setTimer(() => {
      timer = null;
      void request();
    }, delay);
  };
  async function request() {
    clear();
    if (stopped || held || hidden()) return;
    if (flight) return flight.promise;
    const own = epoch,
      controller = new AbortController();
    const task = { controller, promise: null };
    flight = task;
    task.promise = Promise.resolve()
      .then(() => read(controller.signal))
      .then(
        (ok) => {
          if (own === epoch && !controller.signal.aborted)
            failures = ok === false ? failures + 1 : 0;
        },
        () => {
          if (own === epoch && !controller.signal.aborted) failures++;
        },
      )
      .finally(() => {
        if (flight === task) flight = null;
        if (own === epoch) schedule(controlPollDelay(pending(), failures));
      });
    return task.promise;
  }
  return {
    start() {
      stopped = false;
      held = false;
      schedule(0);
    },
    request,
    async pause() {
      held = true;
      epoch++;
      clear();
      flight?.controller.abort();
      await flight?.promise;
    },
    resume({ immediate = false } = {}) {
      if (stopped) return;
      held = false;
      schedule(immediate ? 0 : controlPollDelay(pending(), failures));
    },
    visibility() {
      epoch++;
      clear();
      flight?.controller.abort();
      // Join the aborted generation before a visible read; never overlap it.
      const done = flight?.promise ?? Promise.resolve();
      void done.then(() => {
        if (!stopped && !held && !hidden()) schedule(0);
      });
    },
    stop() {
      stopped = true;
      epoch++;
      clear();
      flight?.controller.abort();
    },
  };
}

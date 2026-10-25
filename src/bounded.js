// Explicit finite await around injected transports; no retry and no raw errors.
export async function boundedCall(operation, timeoutMs = 8000) {
  const controller = new AbortController(); let timer;
  try { return await Promise.race([Promise.resolve().then(() => operation(controller.signal)), new Promise((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error('Operation timed out')); }, timeoutMs);
  })]); } finally { clearTimeout(timer); }
}

import assert from 'node:assert/strict';

// Serialized, staged transactions: writes commit together or are discarded.
// Optional retry executes and discards the first attempt, as an SDK retry can.
export function fakeFirestore() {
  const docs = new Map(); let queue = Promise.resolve();
  const db = {
    docs, reads: [], writes: [], failCommit: false, retry: false,
    collection(name) { return { doc(id) {
      const key = `${name}/${id}`;
      return { key, async get() { db.reads.push(key); return snapshot(docs.get(key)); },
        async create(value) { return db.runTransaction(async tx => {
          const ref = { key }; if ((await tx.get(ref)).exists) throw new Error('Already exists'); tx.set(ref, value);
        }); } };
    } }; },
    runTransaction(operation) {
      const execute = async () => {
        const attempt = async () => {
          const staged = new Map(); let writing = false;
          const tx = {
            async get(ref) { db.reads.push(ref.key); assert.equal(writing, false, 'All transaction reads precede writes'); return snapshot(docs.get(ref.key)); },
            set(ref, value) { db.writes.push(ref.key); writing = true; staged.set(ref.key, structuredClone(value)); },
            delete(ref) { db.writes.push(ref.key); writing = true; staged.set(ref.key, undefined); },
          };
          return { result: await operation(tx), staged };
        };
        if (db.retry) { db.retry = false; await attempt(); }
        const { result, staged } = await attempt();
        if (db.failCommit) throw new Error('Synthetic commit failure');
        for (const [key, value] of staged) { if (value === undefined) docs.delete(key); else docs.set(key, value); }
        return result;
      };
      const result = queue.then(execute); queue = result.catch(() => {}); return result;
    },
  };
  function snapshot(value) { return { exists: value !== undefined, data: () => structuredClone(value) }; }
  return db;
}

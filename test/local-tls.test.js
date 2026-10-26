import test from 'node:test';
import assert from 'node:assert/strict';
import { X509Certificate } from 'node:crypto';
import { createSecureContext } from 'node:tls';
import { stat } from 'node:fs/promises';
import { createLocalTLS } from '../test-support/local-tls.js';

test('local-only test TLS generates valid localhost material and deletes its own scratch files', async () => {
  const fixture = await createLocalTLS();
  try {
    createSecureContext(fixture.options);
    const certificate = new X509Certificate(fixture.options.cert);
    assert.equal(certificate.checkHost('localhost'), 'localhost');
    assert.equal(certificate.checkIP('127.0.0.1'), '127.0.0.1');
    assert.equal((await stat(fixture.directory)).mode & 0o777, 0o700);
  } finally {
    await fixture.cleanup();
  }
  await assert.rejects(stat(fixture.directory), { code: 'ENOENT' });
});

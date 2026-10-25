// Ephemeral local-test key material only. Never reads existing auth/cert files.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, chmod, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const run = promisify(execFile);
export async function createLocalTLS() {
  const root = resolve('artifacts'); await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, '.pilot-tls-')); await chmod(directory, 0o700);
  const cleanup = () => rm(directory, { recursive: true, force: true });
  try {
    const keyPath = join(directory, 'local.key'), certPath = join(directory, 'local.pem');
    await run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost',
      '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1', '-keyout', keyPath, '-out', certPath], { timeout: 15000, maxBuffer: 16384 });
    await chmod(keyPath, 0o600);
    return { directory, options: { key: await readFile(keyPath), cert: await readFile(certPath) }, cleanup };
  } catch { await cleanup(); throw new Error('Ephemeral local TLS generation failed'); }
}

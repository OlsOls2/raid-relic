import { readdir, readFile, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Explicit known runtime roots only; never traverse env/evidence/auth directories.
export async function releaseFiles(root, { runtime = false } = {}) {
  const files = ['LICENSE', 'package.json', 'package-lock.json'];
  if (!runtime) files.push('Dockerfile', 'cloudbuild.yaml', '.dockerignore', '.gcloudignore');
  for (const dir of ['src', 'public']) {
    if (!(await lstat(resolve(root, dir))).isDirectory()) throw new Error('Release directory rejected');
    for (const name of await readdir(resolve(root, dir))) {
      const path = `${dir}/${name}`;
      if (!/^[a-z][a-z0-9-]*\.(?:js|html|css|svg)$/.test(name)) throw new Error(`Unexpected release filename: ${path}`);
      files.push(path);
    }
  }
  return Promise.all(files.sort().map(async file => {
    if (!(await lstat(resolve(root, file))).isFile()) throw new Error(`Release symlink/directory rejected: ${file}`);
    const bytes = await readFile(resolve(root, file));
    return { file, sha256: createHash('sha256').update(bytes).digest('hex') };
  }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const files = await releaseFiles(process.cwd(), { runtime: process.argv.includes('--runtime') });
  console.log(process.argv.includes('--json') ? JSON.stringify(files, null, 2) : files.map(item => item.file).join('\n'));
}

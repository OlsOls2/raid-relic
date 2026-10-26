// Local test fixture only. Never imported by the application runtime.
import { createOverlayFixture } from '../test-support/overlay-fixture.js';
const fixture = await createOverlayFixture({ seed: true });
await fixture.listen();
console.log('LOCAL SIMULATOR ONLY: http://127.0.0.1:5191/overlay/111');
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, async () => {
    await fixture.close();
    process.exit(0);
  });

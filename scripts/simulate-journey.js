import { createJourneyFixture } from '../test-support/journey-fixture.js';
const fixture = await createJourneyFixture();
await fixture.listen();
console.log('SIMULATOR ONLY: http://127.0.0.1:5191/atlas/ and /overlay/1591805230?corner=1');
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await fixture.close(); process.exit(0); });

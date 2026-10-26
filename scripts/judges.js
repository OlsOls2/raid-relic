import { createJudges, JUDGES_ORIGIN } from '../test-support/judges.js';
if (process.argv.length !== 3 || process.argv[2] !== '--simulator')
  throw new Error('Use npm run judges for explicit LOCAL SIMULATOR intent');
const judges = await createJudges({ intent: true });
try {
  await judges.listen();
} catch (error) {
  await judges.close();
  throw error;
}
console.log(
  `SIMULATOR ONLY · local memory · no real Twitch/cloud/provider traffic: ${JUDGES_ORIGIN}/judges`,
);
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, async () => {
    if (stopping) return;
    stopping = true;
    await judges.close();
    process.exit(0);
  });

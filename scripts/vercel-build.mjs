// Vercel runs `npm run vercel-build` instead of `build` when this script exists (ported from Earmark's
// scripts/vercel-build.mjs; differences are recorded in docs/decisions.md D-44). A Production build does, in order:
//   1. scripts/deploy-env.ts  — refuses the build with a list of names if a variable is missing or wrong (D-45)
//   2. prisma migrate deploy  — pending migrations, so the schema ships with the code that needs it
//   3. scripts/seed-hosted.ts — demo accounts and the write-once fixture event, only when DEMO_MODE=1 (D-47)
//   4. npm run build
// Any step failing fails the build, and the previous deployment keeps serving. A Preview build (or a local run) does
// none of 1 to 3 and never touches the production database.
//
// MIGRATE_URL (Vercel, Production only): the database OWNER's direct (unpooled) connection string. Missing on a
// production build is a failed build (step 1), not a silent skip.
import { execSync } from 'node:child_process';

// A failed step ends the build with its own message and exit code, not a Node stack trace over it.
const run = (cmd, extra = {}) => {
  try {
    execSync(cmd, { stdio: 'inherit', env: { ...process.env, ...extra } });
  } catch (e) {
    console.error(`vercel-build: "${cmd}" failed (exit ${e.status ?? 'unknown'}). Build stopped; nothing after it ran.`);
    process.exit(typeof e.status === 'number' && e.status !== 0 ? e.status : 1);
  }
};

if (process.env.VERCEL_ENV === 'production') {
  run('npx tsx scripts/deploy-env.ts');
  const url = process.env.MIGRATE_URL;
  if (!url) {
    // deploy-env already refuses this; kept so the migration step can never run against the wrong URL.
    console.error('vercel-build: MIGRATE_URL is not set for Production. Refusing to deploy code ahead of its migrations.');
    process.exit(1);
  }
  run('npx prisma migrate deploy', { DATABASE_URL: url, DIRECT_URL: url });
  if (process.env.DEMO_MODE === '1') run('npx tsx scripts/seed-hosted.ts');
  else console.log('vercel-build: DEMO_MODE is not 1, no demo seed.');
} else {
  console.log(`vercel-build: VERCEL_ENV=${process.env.VERCEL_ENV ?? 'unset'}, no environment check, no migrations, no seed.`);
}
run('npm run build');

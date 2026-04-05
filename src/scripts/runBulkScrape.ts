/**
 * One-time script — bulk scrapes all active html sources via Apify and
 * populates the MedicalNews collection.
 *
 * Run:
 *   pnpm ts-node-dev --transpile-only --no-notify --watch "" src/scripts/runBulkScrape.ts
 */

import mongoose from 'mongoose';
import { env } from '../config/env';
import { runApifyBulkScrape } from '../jobs/medicalNews.job';

async function main(): Promise<void> {
  await mongoose.connect(env.MONGOURI);
  console.log('[runBulkScrape] Connected to MongoDB');

  await runApifyBulkScrape(1);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('[runBulkScrape] Fatal error:', err);
  process.exit(1);
});

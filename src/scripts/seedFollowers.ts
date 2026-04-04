/**
 * One-time script — seeds accounts that augustocoelho.medcof follows into the DB.
 *
 * Each account is inserted as an InstagramAccount with the workspace defined below.
 * Accounts already present are skipped (no overwrite).
 *
 * Run:
 *   WORKSPACE=medcof pnpm ts-node-dev --transpile-only --no-notify --watch "" src/scripts/seedFollowers.ts
 *   WORKSPACE=professores pnpm ts-node-dev --transpile-only --no-notify --watch "" src/scripts/seedFollowers.ts
 */

import { ApifyClient } from 'apify-client';
import mongoose from 'mongoose';
import { env } from '../config/env';
import { InstagramAccount } from '../models/InstagramAccount';

const SOURCE_HANDLE = 'augustocoelho.medcof';
const WORKSPACE = process.env.WORKSPACE ?? 'medcof';

async function scrapeFollowing(handle: string): Promise<Array<Record<string, unknown>>> {
  if (!env.INSTAGRAM_APIFY_TOKEN) throw new Error('INSTAGRAM_APIFY_TOKEN is not configured');

  const client = new ApifyClient({ token: env.INSTAGRAM_APIFY_TOKEN });

  const run = await client.actor('instaprism/instagram-following-scraper').start({
    username: handle,
    limit: 10_000,
  });

  console.log(`[seedFollowers] Apify run started (id: ${run.id}). Polling for completion...`);

  const finished = await client.run(run.id).waitForFinish({ waitSecs: 3600 });

  if (finished.status !== 'SUCCEEDED') {
    throw new Error(`Apify run ended with status: ${finished.status}`);
  }

  console.log(`[seedFollowers] Apify run succeeded. Fetching dataset...`);

  const { items } = await client.dataset(finished.defaultDatasetId).listItems({ limit: 10_000 });
  return items as Array<Record<string, unknown>>;
}

async function main(): Promise<void> {
  await mongoose.connect(env.MONGOURI);
  console.log(`[seedFollowers] Connected to MongoDB`);
  console.log(`[seedFollowers] Scraping following list of @${SOURCE_HANDLE} via Apify...`);

  const accounts = await scrapeFollowing(SOURCE_HANDLE);
  console.log(`[seedFollowers] ${accounts.length} accounts retrieved`);

  if (accounts.length > 0) {
    console.log(`[seedFollowers] Sample fields:`, Object.keys(accounts[0]));
  }

  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const f of accounts) {
    const handle = (f.username ?? '') as string;
    if (!handle) { failed++; continue; }

    const displayName = (f.fullName ?? handle) as string;
    const profilePicUrl = (f.profilePicUrl ?? null) as string | null;

    try {
      const existing = await InstagramAccount.exists({ externalId: handle });
      if (existing) { skipped++; continue; }

      await InstagramAccount.create({
        externalId: handle,
        handle,
        displayName,
        profileUrl: `https://instagram.com/${handle}`,
        followers: 0,
        workspace: WORKSPACE,
        status: 'desconectado',
        ingestEnabled: false,
        ...(profilePicUrl && { profilePicS3Url: profilePicUrl }),
      });

      created++;
      if (created % 25 === 0) console.log(`[seedFollowers] ${created} accounts created so far...`);
    } catch (err) {
      console.error(`[seedFollowers] ✗ ${handle}:`, err instanceof Error ? err.message : err);
      failed++;
    }
  }

  console.log(`\n[seedFollowers] Done.`);
  console.log(`  workspace : ${WORKSPACE}`);
  console.log(`  created   : ${created}`);
  console.log(`  skipped   : ${skipped} (already existed)`);
  console.log(`  failed    : ${failed}`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('[seedFollowers] Fatal error:', err);
  process.exit(1);
});

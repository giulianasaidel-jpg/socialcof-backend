import { InstagramAccount } from '../models/InstagramAccount';
import { InstagramSyncLog } from '../models/InstagramSyncLog';
import { scrapeProfile } from '../services/apifyInstagram';
import { scrapeAndPersistPosts, scrapeAndPersistReels } from '../services/instagramScrapeActions';

export const BETWEEN_IG_APIFY_STEPS_MS = 30_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function syncAccountProfile(account: InstanceType<typeof InstagramAccount>): Promise<void> {
  const profile = await scrapeProfile(account.handle);

  account.followers = profile.followersCount;
  account.displayName = profile.fullName || account.displayName;
  account.lastSyncAt = new Date();
  await account.save();

  await InstagramSyncLog.create({
    accountId: account._id,
    at: new Date(),
    level: 'ok',
    message: `[cron] Profile synced — ${profile.followersCount} followers`,
  });

  console.log(`[instagramSync] ✓ profile ${account.handle} — ${profile.followersCount} followers`);
}

export async function syncAccountPosts(account: InstanceType<typeof InstagramAccount>): Promise<void> {
  const result = await scrapeAndPersistPosts(account, 5);

  await InstagramSyncLog.create({
    accountId: account._id,
    at: new Date(),
    level: 'ok',
    message: `[cron] Posts synced — ${result.total} posts`,
  });

  console.log(`[instagramSync] ✓ posts ${account.handle} — ${result.total} posts`);
}

export async function syncAccountReels(account: InstanceType<typeof InstagramAccount>): Promise<void> {
  const result = await scrapeAndPersistReels(account, 5, { skipIfTranscribed: true });
  const ok = result.reels.filter((r) => r.status === 'ok').length;

  await InstagramSyncLog.create({
    accountId: account._id,
    at: new Date(),
    level: 'ok',
    message: `[cron] Reels processed — ${ok}/${result.total}`,
  });

  console.log(`[instagramSync] ✓ reels ${account.handle} — ${ok}/${result.total} transcribed`);
}

export async function syncInstagramAccountDailyBundle(
  account: InstanceType<typeof InstagramAccount>,
  gapMs: number,
): Promise<void> {
  const logErr = async (step: string, message: string) => {
    await InstagramSyncLog.create({
      accountId: account._id,
      at: new Date(),
      level: 'erro',
      message: `[cron] ${step}: ${message}`,
    });
  };

  try {
    await syncAccountProfile(account);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[instagramSync] ✗ profile ${account.handle}:`, message);
    await logErr('profile', message);
  }

  if (gapMs > 0) await sleep(gapMs);

  try {
    await syncAccountPosts(account);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[instagramSync] ✗ posts ${account.handle}:`, message);
    await logErr('posts', message);
  }

  if (gapMs > 0) await sleep(gapMs);

  try {
    await syncAccountReels(account);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[instagramSync] ✗ reels ${account.handle}:`, message);
    await logErr('reels', message);
  }
}

export async function runInstagramSyncJob(): Promise<void> {
  console.log('[instagramSync] Starting full manual sync (all ingestEnabled accounts, sequential)...');

  const accounts = await InstagramAccount.find({ ingestEnabled: true });

  if (accounts.length === 0) {
    console.log('[instagramSync] No accounts to sync.');
    return;
  }

  console.log(`[instagramSync] Found ${accounts.length} account(s).`);

  for (const account of accounts) {
    await syncInstagramAccountDailyBundle(account, 0);
  }

  console.log('[instagramSync] Done.');
}

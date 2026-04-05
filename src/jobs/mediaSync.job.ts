import { InstagramAccount } from '../models/InstagramAccount';
import { TikTokAccount } from '../models/TikTokAccount';
import { scrapeTikTokPosts } from '../services/apifyTikTok';
import { scrapeAndPersistStories, scrapeAndPersistReels } from '../services/instagramScrapeActions';
import { processTikTokMedia, upsertTikTokPost } from '../services/mediaPipeline';
import { syncAccountReels } from './instagramSync.job';
import { CRON_STAGGER_TIMEZONE, getTimezoneMinuteOfDay, dailyMinuteSlot } from './cronDailySlot';

const DELAY_MS = 3 * 60 * 1000;
const TT_MEDIA_SLOT_SALT = 'tt-media-v1';
export const BETWEEN_STORIES_AND_REELS_MS = 60 * 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function syncInstagramStoriesForAccount(
  account: InstanceType<typeof InstagramAccount>,
): Promise<void> {
  const result = await scrapeAndPersistStories(account);
  console.log(`[mediaSync] ✓ stories ${account.handle} — ${result.total} synced`);
}

async function syncTikTokPostsForAccount(
  account: InstanceType<typeof TikTokAccount>,
): Promise<void> {
  const posts = await scrapeTikTokPosts(account.handle, 30);

  for (const post of posts) {
    try {
      const media = await processTikTokMedia(post, account.handle);
      await upsertTikTokPost(account._id, post, media);
    } catch (err) {
      console.error(`[mediaSync] ✗ tiktok post ${post.id}:`, err instanceof Error ? err.message : err);
    }
  }

  account.lastSyncAt = new Date();
  await account.save();

  console.log(`[mediaSync] ✓ tiktok posts ${account.handle} — ${posts.length} synced`);
}

export async function runMediaSyncSlotTick(): Promise<void> {
  const minute = getTimezoneMinuteOfDay(CRON_STAGGER_TIMEZONE);

  const tiktokAccounts = await TikTokAccount.find({});
  const ttDue = tiktokAccounts.filter(
    (a) => dailyMinuteSlot(a._id.toString(), TT_MEDIA_SLOT_SALT) === minute,
  );

  if (ttDue.length > 0) {
    console.log(`[mediaSync] slot ${minute} — TikTok for ${ttDue.length} account(s)`);
  }

  for (const account of ttDue) {
    try {
      await syncTikTokPostsForAccount(account);
    } catch (err) {
      console.error(
        `[mediaSync] ✗ tiktok ${account.handle}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}

export async function runMediaSyncJob(): Promise<void> {
  console.log('[mediaSync] Starting media sync job...');

  const [instagramAccounts, tiktokAccounts] = await Promise.all([
    InstagramAccount.find({ ingestEnabled: true }),
    TikTokAccount.find({}),
  ]);

  type Task = { label: string; run: () => Promise<void> };

  const tasks: Task[] = [
    ...instagramAccounts.map((account) => ({
      label: `instagram-stories:${account.handle}`,
      run: () => syncInstagramStoriesForAccount(account),
    })),
    ...instagramAccounts.map((account) => ({
      label: `instagram-reels:${account.handle}`,
      run: () => syncAccountReels(account),
    })),
    ...tiktokAccounts.map((account) => ({
      label: `tiktok-posts:${account.handle}`,
      run: () => syncTikTokPostsForAccount(account),
    })),
  ];

  if (!tasks.length) {
    console.log('[mediaSync] No accounts to sync.');
    return;
  }

  console.log(`[mediaSync] ${tasks.length} task(s) queued — 3-min delay between each Apify call.`);

  for (let i = 0; i < tasks.length; i++) {
    if (i > 0) {
      console.log(`[mediaSync] Waiting 3 minutes before next call...`);
      await sleep(DELAY_MS);
    }

    const task = tasks[i];
    console.log(`[mediaSync] [${i + 1}/${tasks.length}] ${task.label}`);

    try {
      await task.run();
    } catch (err) {
      console.error(`[mediaSync] ✗ ${task.label}:`, err instanceof Error ? err.message : err);
    }
  }

  console.log('[mediaSync] Done.');
}

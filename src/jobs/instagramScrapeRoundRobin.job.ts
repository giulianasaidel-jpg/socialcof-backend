import { InstagramAccount } from '../models/InstagramAccount';
import { InstagramSyncLog } from '../models/InstagramSyncLog';
import {
  syncAccountProfile,
  syncAccountPosts,
  syncAccountReels,
  BETWEEN_IG_APIFY_STEPS_MS,
} from './instagramSync.job';
import { syncInstagramStoriesForAccount } from './mediaSync.job';

let igTickBusy = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runInstagramScrapeRoundRobinTick(): Promise<void> {
  if (igTickBusy) return;
  igTickBusy = true;
  try {
    const account = await InstagramAccount.findOne({ ingestEnabled: true }).sort({ lastSyncAt: 1, _id: 1 });
    if (!account) return;

    console.log(`[instagramScrape] stalest — ${account.handle} (lastSyncAt=${account.lastSyncAt?.toISOString() ?? 'never'})`);

    const logErr = async (step: string, message: string) => {
      await InstagramSyncLog.create({
        accountId: account._id,
        at: new Date(),
        level: 'erro',
        message: `[cron] ${step}: ${message}`,
      });
    };

    try {
      await Promise.all([
        (async () => {
          try {
            await syncAccountProfile(account);
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            console.error(`[instagramSync] ✗ profile ${account.handle}:`, message);
            await logErr('profile', message);
          }
        })(),
        (async () => {
          try {
            await syncAccountPosts(account);
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            console.error(`[instagramSync] ✗ posts ${account.handle}:`, message);
            await logErr('posts', message);
          }
        })(),
        (async () => {
          try {
            await syncInstagramStoriesForAccount(account);
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            console.error(`[instagramSync] ✗ stories ${account.handle}:`, message);
            await logErr('stories', message);
          }
        })(),
      ]);

      if (BETWEEN_IG_APIFY_STEPS_MS > 0) await sleep(BETWEEN_IG_APIFY_STEPS_MS);

      try {
        await syncAccountReels(account);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        console.error(`[instagramSync] ✗ reels ${account.handle}:`, message);
        await logErr('reels', message);
      }
    } catch (err) {
      console.error(`[instagramScrape] ✗ ${account.handle}:`, err instanceof Error ? err.message : err);
    }
  } finally {
    igTickBusy = false;
  }
}

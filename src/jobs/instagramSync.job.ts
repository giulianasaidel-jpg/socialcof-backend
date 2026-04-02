import { InstagramAccount } from '../models/InstagramAccount';
import { InstagramSyncLog } from '../models/InstagramSyncLog';
import { Post } from '../models/Post';
import { scrapeProfile, scrapeRecentPosts, toPostFormat } from '../services/apifyInstagram';

/**
 * Scrapes and persists the public profile data for a single account.
 */
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

/**
 * Scrapes and upserts the recent posts for a single account.
 */
export async function syncAccountPosts(account: InstanceType<typeof InstagramAccount>): Promise<void> {
  const posts = await scrapeRecentPosts(account.handle, 50);

  for (const post of posts) {
    const title = post.caption?.split('\n')[0]?.slice(0, 200) ?? post.shortCode;

    await Post.findOneAndUpdate(
      { instagramPostId: post.id },
      {
        $set: {
          accountId: account._id,
          instagramPostId: post.id,
          title,
          postedAt: post.timestamp ? new Date(post.timestamp) : new Date(),
          format: toPostFormat(post.type),
          likes: post.likesCount,
          comments: post.commentsCount,
          syncedAt: new Date(),
        },
      },
      { upsert: true, new: true },
    );
  }

  account.lastSyncAt = new Date();
  await account.save();

  await InstagramSyncLog.create({
    accountId: account._id,
    at: new Date(),
    level: 'ok',
    message: `[cron] Posts synced — ${posts.length} posts`,
  });

  console.log(`[instagramSync] ✓ posts ${account.handle} — ${posts.length} posts`);
}

/**
 * Daily cron job: scrapes profile + posts for every account with ingestEnabled.
 */
export async function runInstagramSyncJob(): Promise<void> {
  console.log('[instagramSync] Starting daily sync...');

  const accounts = await InstagramAccount.find({ ingestEnabled: true });

  if (accounts.length === 0) {
    console.log('[instagramSync] No accounts to sync.');
    return;
  }

  console.log(`[instagramSync] Found ${accounts.length} account(s).`);

  for (const account of accounts) {
    try {
      await syncAccountProfile(account);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[instagramSync] ✗ profile ${account.handle}:`, message);
      await InstagramSyncLog.create({ accountId: account._id, at: new Date(), level: 'erro', message: `[cron] profile: ${message}` });
    }

    try {
      await syncAccountPosts(account);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[instagramSync] ✗ posts ${account.handle}:`, message);
      await InstagramSyncLog.create({ accountId: account._id, at: new Date(), level: 'erro', message: `[cron] posts: ${message}` });
    }
  }

  console.log('[instagramSync] Done.');
}

import { InstagramAccount } from '../models/InstagramAccount';
import { InstagramSyncLog } from '../models/InstagramSyncLog';
import { Post } from '../models/Post';
import { scrapeProfile, scrapeRecentPosts, toPostFormat } from '../services/apifyInstagram';
import { uploadImageFromUrl, uploadCarouselImages } from '../services/s3';
import { processReel } from '../services/videoProcessor';
import { analyseImage, analyseCarousel } from '../services/visionAnalysis';

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
    const thumbnailUrl =
      post.displayUrl && post.type !== 'Video'
        ? await uploadImageFromUrl(post.displayUrl, `instagram/${account.handle}/${post.id}.jpg`).catch(() => null)
        : null;

    const carouselImages =
      post.type === 'Sidecar' && post.carouselDisplayUrls.length
        ? await uploadCarouselImages(post.carouselDisplayUrls, account.handle, post.id)
        : [];

    const transcript = await (async () => {
      if (post.type === 'Sidecar' && carouselImages.length) {
        return analyseCarousel(carouselImages).catch(() => null);
      }
      if (post.type === 'Image' && thumbnailUrl) {
        return analyseImage(thumbnailUrl).catch(() => null);
      }
      return null;
    })();

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
          postUrl: post.url ?? `https://www.instagram.com/p/${post.shortCode}/`,
          ...(thumbnailUrl && { thumbnailUrl }),
          ...(carouselImages.length && { carouselImages }),
          ...(transcript && { transcript }),
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
 * Downloads, compresses and transcribes Reels for a single account.
 * Skips reels that already have a transcript saved.
 */
export async function syncAccountReels(account: InstanceType<typeof InstagramAccount>): Promise<void> {
  const posts = await scrapeRecentPosts(account.handle, 20);
  const reels = posts.filter((p) => p.type === 'Video' && p.videoUrl);

  let processed = 0;

  for (const post of reels) {
    const existing = await Post.findOne({ instagramPostId: post.id, transcript: { $exists: true, $ne: '' } });
    if (existing) continue;

    try {
      const { s3VideoUrl, transcript } = await processReel(post.videoUrl!, account.handle, post.id);
      const title = post.caption?.split('\n')[0]?.slice(0, 200) ?? post.shortCode;

      await Post.findOneAndUpdate(
        { instagramPostId: post.id },
        {
          $set: {
            accountId: account._id,
            instagramPostId: post.id,
            title,
            postedAt: post.timestamp ? new Date(post.timestamp) : new Date(),
            format: 'Reels',
            likes: post.likesCount,
            comments: post.commentsCount,
            postUrl: post.url ?? `https://www.instagram.com/p/${post.shortCode}/`,
            ...(s3VideoUrl && { videoUrl: s3VideoUrl }),
            ...(transcript && { transcript }),
            syncedAt: new Date(),
          },
        },
        { upsert: true, new: true },
      );

      processed++;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[instagramSync] ✗ reel ${post.id}:`, message);
    }
  }

  await InstagramSyncLog.create({
    accountId: account._id,
    at: new Date(),
    level: 'ok',
    message: `[cron] Reels processed — ${processed}/${reels.length}`,
  });

  console.log(`[instagramSync] ✓ reels ${account.handle} — ${processed}/${reels.length} transcribed`);
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

    try {
      await syncAccountReels(account);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[instagramSync] ✗ reels ${account.handle}:`, message);
      await InstagramSyncLog.create({ accountId: account._id, at: new Date(), level: 'erro', message: `[cron] reels: ${message}` });
    }
  }

  console.log('[instagramSync] Done.');
}

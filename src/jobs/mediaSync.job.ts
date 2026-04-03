import { InstagramAccount } from '../models/InstagramAccount';
import { TikTokAccount } from '../models/TikTokAccount';
import { InstagramStory } from '../models/InstagramStory';
import { TikTokPost } from '../models/TikTokPost';
import { scrapeStories } from '../services/apifyInstagram';
import { scrapeTikTokPosts } from '../services/apifyTikTok';
import { uploadImageFromUrl } from '../services/s3';
import { processReel } from '../services/videoProcessor';
import { analyseImage } from '../services/visionAnalysis';
import { syncAccountReels } from './instagramSync.job';

const DELAY_MS = 3 * 60 * 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Scrapes and persists current Instagram stories for a single account.
 */
async function syncInstagramStoriesForAccount(
  account: InstanceType<typeof InstagramAccount>,
): Promise<void> {
  const stories = await scrapeStories(account.handle);
  const syncedAt = new Date();
  const expiresAt = new Date(syncedAt.getTime() + 24 * 60 * 60 * 1000);

  await Promise.all(
    stories.map(async (story) => {
      try {
        let thumbnailUrl: string | null = null;
        let s3VideoUrl: string | null = null;
        let transcript: string | null = null;

        if (story.mediaType === 'image' && story.displayUrl) {
          thumbnailUrl = await uploadImageFromUrl(
            story.displayUrl,
            `instagram/${account.handle}/stories/${story.id}.jpg`,
          ).catch(() => null);
          const imageForAnalysis = thumbnailUrl ?? story.displayUrl;
          transcript = await analyseImage(imageForAnalysis).catch(() => null);
        }

        if (story.mediaType === 'video' && story.videoUrl) {
          const processed = await processReel(
            story.videoUrl,
            account.handle,
            `story_${story.id}`,
          ).catch(() => ({ s3VideoUrl: null, transcript: null as string | null }));
          s3VideoUrl = processed.s3VideoUrl;
          transcript = processed.transcript || null;
        }

        await InstagramStory.findOneAndUpdate(
          { storyId: story.id },
          {
            $set: {
              accountId: account._id,
              storyId: story.id,
              handle: account.handle,
              mediaType: story.mediaType,
              ...(thumbnailUrl && { thumbnailUrl }),
              ...(s3VideoUrl && { videoUrl: s3VideoUrl }),
              ...(transcript && { transcript }),
              postedAt: story.timestamp ? new Date(story.timestamp) : undefined,
              syncedAt,
              expiresAt,
            },
          },
          { upsert: true, new: true },
        );
      } catch (err) {
        console.error(`[mediaSync] ✗ story ${story.id}:`, err instanceof Error ? err.message : err);
      }
    }),
  );

  console.log(`[mediaSync] ✓ stories ${account.handle} — ${stories.length} synced`);
}

/**
 * Scrapes and upserts recent TikTok posts for a single account.
 */
async function syncTikTokPostsForAccount(
  account: InstanceType<typeof TikTokAccount>,
): Promise<void> {
  const posts = await scrapeTikTokPosts(account.handle, 30);

  await Promise.all(
    posts.map(async (post) => {
      try {
        const thumbnailUrl = post.thumbnailUrl
          ? await uploadImageFromUrl(
              post.thumbnailUrl,
              `tiktok/${account.handle}/${post.id}_thumb.jpg`,
            ).catch(() => null)
          : null;

        const transcript = thumbnailUrl
          ? await analyseImage(thumbnailUrl).catch(() => null)
          : null;

        await TikTokPost.findOneAndUpdate(
          { tiktokPostId: post.id },
          {
            $set: {
              accountId: account._id,
              tiktokPostId: post.id,
              title: post.text?.slice(0, 300) || post.id,
              postedAt: post.timestamp ? new Date(post.timestamp) : undefined,
              ...(thumbnailUrl && { thumbnailUrl }),
              ...(transcript && { transcript }),
              likes: post.likes,
              comments: post.comments,
              shares: post.shares,
              views: post.views,
              postUrl: post.postUrl,
              hashtags: post.hashtags,
              syncedAt: new Date(),
            },
          },
          { upsert: true, new: true },
        );
      } catch (err) {
        console.error(`[mediaSync] ✗ tiktok post ${post.id}:`, err instanceof Error ? err.message : err);
      }
    }),
  );

  account.lastSyncAt = new Date();
  await account.save();

  console.log(`[mediaSync] ✓ tiktok posts ${account.handle} — ${posts.length} synced`);
}

/**
 * Scheduled job: scrapes stories, reels and TikTok posts for every enabled account.
 * Each Apify call is separated by a 3-minute delay to avoid rate limiting.
 *
 * Task order:
 *   1. Instagram stories — one call per account
 *   2. Instagram reels   — one call per account
 *   3. TikTok posts      — one call per account
 */
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

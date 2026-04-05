import { InstagramAccount } from '../models/InstagramAccount';
import { InstagramSyncLog } from '../models/InstagramSyncLog';
import {
  scrapeProfile,
  scrapeRecentPosts,
  scrapeStories,
  toPostFormat,
  resolveInstagramPostResultsLimit,
  type ApifyInstagramPost,
} from './apifyInstagram';
import { uploadImageFromUrl, uploadCarouselImages } from './s3';
import { analyseImage, analyseCarousel } from './visionAnalysis';
import {
  type ProcessedMedia,
  processVideoMedia,
  processStoryMedia,
  upsertInstagramPost,
  upsertInstagramStory,
  alreadyTranscribed,
} from './mediaPipeline';

export type InstagramAccountDoc = InstanceType<typeof InstagramAccount>;
export type ApifyRefreshRef = { promise: Promise<ApifyInstagramPost[]> | null };

export async function uploadThumbnailWithApifyFallback(
  account: InstagramAccountDoc,
  post: ApifyInstagramPost,
  effectiveLimit: number,
  refreshRef: ApifyRefreshRef,
): Promise<string | null> {
  if (!post.displayUrl || post.type === 'Video') return null;
  const key = `instagram/${account.handle}/${post.id}.jpg`;

  let url = await uploadImageFromUrl(post.displayUrl, key);
  if (url) return url;

  if (!refreshRef.promise) {
    refreshRef.promise = scrapeRecentPosts(account.handle, resolveInstagramPostResultsLimit(effectiveLimit));
  }
  const batch = await refreshRef.promise;
  const fresh = batch.find((p) => p.id === post.id);
  if (fresh?.displayUrl) url = await uploadImageFromUrl(fresh.displayUrl, key);
  return url;
}

async function resolvePostMedia(
  account: InstagramAccountDoc,
  post: ApifyInstagramPost,
  limit: number,
  refreshRef: ApifyRefreshRef,
): Promise<ProcessedMedia> {
  const thumbnailUrl = await uploadThumbnailWithApifyFallback(account, post, limit, refreshRef);

  if (post.type === 'Sidecar' && post.carouselDisplayUrls.length) {
    const carouselImages = await uploadCarouselImages(post.carouselDisplayUrls, account.handle, post.id);
    const transcript = carouselImages.length
      ? await analyseCarousel(carouselImages).catch(() => null)
      : null;
    return { thumbnailUrl, videoUrl: null, carouselImages, transcript };
  }

  if (post.type === 'Image' && thumbnailUrl) {
    const transcript = await analyseImage(thumbnailUrl).catch(() => null);
    return { thumbnailUrl, videoUrl: null, carouselImages: [], transcript };
  }

  return { thumbnailUrl, videoUrl: null, carouselImages: [], transcript: null };
}

export async function scrapeAndPersistProfile(account: InstagramAccountDoc) {
  const profile = await scrapeProfile(account.handle);

  account.followers = profile.followersCount;
  account.displayName = profile.fullName || account.displayName;
  account.lastSyncAt = new Date();
  await account.save();

  return {
    username: profile.username,
    fullName: profile.fullName,
    biography: profile.biography,
    followersCount: profile.followersCount,
    followsCount: profile.followsCount,
    postsCount: profile.postsCount,
    profilePicUrl: profile.profilePicUrl,
    profilePicUrlHD: profile.profilePicUrlHD,
    isVerified: profile.isVerified,
    isPrivate: profile.isPrivate,
    isBusinessAccount: profile.isBusinessAccount,
    externalUrl: profile.externalUrl,
    externalUrls: profile.externalUrls,
    igtvVideoCount: profile.igtvVideoCount,
  };
}

export async function scrapeAndPersistPosts(account: InstagramAccountDoc, limit: number) {
  const posts = await scrapeRecentPosts(account.handle, limit);
  const refreshRef: ApifyRefreshRef = { promise: null };
  const mediaMap = new Map<string, ProcessedMedia>();

  for (const post of posts) {
    const media = await resolvePostMedia(account, post, limit, refreshRef);
    await upsertInstagramPost(account._id, post, media);
    mediaMap.set(post.id, media);
  }

  account.lastSyncAt = new Date();
  await account.save();

  return {
    total: posts.length,
    posts: posts.map((post) => ({
      id: post.id,
      shortCode: post.shortCode,
      caption: post.caption,
      likesCount: post.likesCount,
      commentsCount: post.commentsCount,
      timestamp: post.timestamp,
      type: post.type,
      format: toPostFormat(post.type),
      url: post.url,
      displayUrl: post.displayUrl,
      hashtags: post.hashtags,
      alt: post.alt,
      ownerUsername: post.ownerUsername,
      isPinned: post.isPinned,
      thumbnailUrl: mediaMap.get(post.id)?.thumbnailUrl ?? null,
      carouselImages: mediaMap.get(post.id)?.carouselImages ?? [],
    })),
  };
}

export async function scrapeAndPersistReels(
  account: InstagramAccountDoc,
  limit: number,
  options?: { skipIfTranscribed?: boolean },
) {
  const posts = await scrapeRecentPosts(account.handle, limit);
  const reels = posts.filter((p) => p.type === 'Video' && p.videoUrl);

  const results: Array<
    | { id: string; shortCode: string; s3VideoUrl: string | null; transcript: string | null; status: 'ok' }
    | { id: string; shortCode: string; status: 'skipped' }
    | { id: string; shortCode: string; status: 'failed'; error: string }
  > = [];

  for (const post of reels) {
    if (options?.skipIfTranscribed && await alreadyTranscribed('post', post.id)) {
      results.push({ id: post.id, shortCode: post.shortCode, status: 'skipped' });
      continue;
    }

    try {
      const media = await processVideoMedia(post.videoUrl!, `instagram/${account.handle}/${post.id}.mp4`);
      await upsertInstagramPost(account._id, post, media);
      results.push({ id: post.id, shortCode: post.shortCode, s3VideoUrl: media.videoUrl, transcript: media.transcript, status: 'ok' });
    } catch (err) {
      results.push({ id: post.id, shortCode: post.shortCode, status: 'failed', error: err instanceof Error ? err.message : 'Unknown error' });
    }
  }

  account.lastSyncAt = new Date();
  await account.save();

  return { total: reels.length, reels: results };
}

export async function scrapeAndPersistStories(account: InstagramAccountDoc) {
  const stories = await scrapeStories(account.handle);
  const syncedAt = new Date();
  const expiresAt = new Date(syncedAt.getTime() + 24 * 60 * 60 * 1000);

  const results: Array<
    | { id: string; mediaType: string; thumbnailUrl: string | null; videoUrl: string | null; status: 'ok' }
    | { id: string; mediaType: string; status: 'failed'; error: string }
  > = [];

  for (const story of stories) {
    try {
      const media = await processStoryMedia(story, account.handle);
      await upsertInstagramStory(account._id, account.handle, story, media, syncedAt, expiresAt);
      results.push({ id: story.id, mediaType: story.mediaType, thumbnailUrl: media.thumbnailUrl, videoUrl: media.videoUrl, status: 'ok' });
    } catch (err) {
      results.push({ id: story.id, mediaType: story.mediaType, status: 'failed', error: err instanceof Error ? err.message : 'Unknown error' });
    }
  }

  return { total: stories.length, stories: results };
}

export async function syncInstagramAccount(account: InstagramAccountDoc) {
  try {
    await scrapeAndPersistProfile(account);
    const postsResult = await scrapeAndPersistPosts(account, 5);

    await InstagramSyncLog.create({
      accountId: account._id,
      at: new Date(),
      level: 'ok',
      message: `Synced ${postsResult.total} posts via Apify`,
    });

    return {
      followers: account.followers,
      syncedPosts: postsResult.total,
      lastSyncAt: account.lastSyncAt,
    };
  } catch (err) {
    await InstagramSyncLog.create({
      accountId: account._id,
      at: new Date(),
      level: 'erro',
      message: err instanceof Error ? err.message : 'Unknown error',
    });
    throw err;
  }
}

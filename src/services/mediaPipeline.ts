import { Types } from 'mongoose';
import { Post } from '../models/Post';
import { InstagramStory } from '../models/InstagramStory';
import { TikTokPost } from '../models/TikTokPost';
import { uploadImageFromUrl, uploadCarouselImages } from './s3';
import { processVideo, DOWNLOAD_HEADERS_BY_PLATFORM } from './videoProcessor';
import { analyseImage, analyseCarousel } from './visionAnalysis';
import { toPostFormat, type ApifyInstagramPost, type ApifyInstagramStory } from './apifyInstagram';
import type { ApifyTikTokPost } from './apifyTikTok';

export interface ProcessedMedia {
  thumbnailUrl: string | null;
  videoUrl: string | null;
  carouselImages: string[];
  transcript: string | null;
}

const EMPTY: ProcessedMedia = Object.freeze({
  thumbnailUrl: null,
  videoUrl: null,
  carouselImages: [],
  transcript: null,
});

export async function processImageMedia(imageUrl: string, s3Key: string): Promise<ProcessedMedia> {
  const thumbnailUrl = await uploadImageFromUrl(imageUrl, s3Key);
  const transcript = thumbnailUrl ? await analyseImage(thumbnailUrl).catch(() => null) : null;
  return { ...EMPTY, thumbnailUrl, transcript };
}

export async function processCarouselMedia(
  thumbnailUrl: string | null,
  carouselUrls: string[],
  handle: string,
  postId: string,
): Promise<ProcessedMedia> {
  const carouselImages = carouselUrls.length
    ? await uploadCarouselImages(carouselUrls, handle, postId)
    : [];
  const transcript = carouselImages.length
    ? await analyseCarousel(carouselImages).catch(() => null)
    : null;
  return { ...EMPTY, thumbnailUrl, carouselImages, transcript };
}

export async function processVideoMedia(
  videoUrl: string,
  s3Key: string,
  headers?: Record<string, string>,
): Promise<ProcessedMedia> {
  const result = await processVideo(videoUrl, s3Key, headers);
  return { ...EMPTY, videoUrl: result.s3VideoUrl, transcript: result.transcript || null };
}

export async function processStoryMedia(
  story: ApifyInstagramStory,
  handle: string,
): Promise<ProcessedMedia> {
  if (story.mediaType === 'video' && story.videoUrl) {
    return processVideoMedia(
      story.videoUrl,
      `instagram/${handle}/story_${story.id}.mp4`,
      DOWNLOAD_HEADERS_BY_PLATFORM.instagram,
    ).catch(() => ({ ...EMPTY }));
  }

  if (story.mediaType === 'image' && story.displayUrl) {
    return processImageMedia(story.displayUrl, `instagram/${handle}/stories/${story.id}.jpg`);
  }

  return { ...EMPTY };
}

export async function processTikTokMedia(
  post: ApifyTikTokPost,
  handle: string,
): Promise<ProcessedMedia> {
  if (!post.thumbnailUrl) return { ...EMPTY };
  const thumbnailUrl = await uploadImageFromUrl(post.thumbnailUrl, `tiktok/${handle}/${post.id}_thumb.jpg`);
  const transcript = thumbnailUrl ? await analyseImage(thumbnailUrl).catch(() => null) : null;
  return { ...EMPTY, thumbnailUrl, transcript };
}

export async function upsertInstagramPost(
  accountId: Types.ObjectId,
  post: ApifyInstagramPost,
  media: ProcessedMedia,
) {
  return Post.findOneAndUpdate(
    { instagramPostId: post.id },
    {
      $set: {
        accountId,
        instagramPostId: post.id,
        title: post.caption?.split('\n')[0]?.slice(0, 200) ?? post.shortCode,
        postedAt: post.timestamp ? new Date(post.timestamp) : new Date(),
        format: toPostFormat(post.type),
        likes: post.likesCount,
        comments: post.commentsCount,
        postUrl: post.url ?? `https://www.instagram.com/p/${post.shortCode}/`,
        ...(media.thumbnailUrl && { thumbnailUrl: media.thumbnailUrl }),
        ...(media.carouselImages.length && { carouselImages: media.carouselImages }),
        ...(media.videoUrl && { videoUrl: media.videoUrl }),
        ...(media.transcript && { transcript: media.transcript }),
        syncedAt: new Date(),
      },
    },
    { upsert: true, new: true },
  );
}

export async function upsertInstagramStory(
  accountId: Types.ObjectId,
  handle: string,
  story: ApifyInstagramStory,
  media: ProcessedMedia,
  syncedAt: Date,
  expiresAt: Date,
) {
  return InstagramStory.findOneAndUpdate(
    { storyId: story.id },
    {
      $set: {
        accountId,
        storyId: story.id,
        handle,
        mediaType: story.mediaType,
        ...(media.thumbnailUrl && { thumbnailUrl: media.thumbnailUrl }),
        ...(media.videoUrl && { videoUrl: media.videoUrl }),
        ...(media.transcript && { transcript: media.transcript }),
        postedAt: story.timestamp ? new Date(story.timestamp) : undefined,
        syncedAt,
        expiresAt,
      },
    },
    { upsert: true, new: true },
  );
}

export async function upsertTikTokPost(
  accountId: Types.ObjectId,
  post: ApifyTikTokPost,
  media: ProcessedMedia,
) {
  return TikTokPost.findOneAndUpdate(
    { tiktokPostId: post.id },
    {
      $set: {
        accountId,
        tiktokPostId: post.id,
        title: post.text?.slice(0, 300) || post.id,
        postedAt: post.timestamp ? new Date(post.timestamp) : undefined,
        ...(media.thumbnailUrl && { thumbnailUrl: media.thumbnailUrl }),
        ...(media.transcript && { transcript: media.transcript }),
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
}

export async function alreadyTranscribed(
  collection: 'post' | 'story' | 'tiktok',
  externalId: string,
): Promise<boolean> {
  const hasText = { transcript: { $exists: true, $ne: '' } };
  switch (collection) {
    case 'post': return !!(await Post.exists({ instagramPostId: externalId, ...hasText }));
    case 'story': return !!(await InstagramStory.exists({ storyId: externalId, ...hasText }));
    case 'tiktok': return !!(await TikTokPost.exists({ tiktokPostId: externalId, ...hasText }));
  }
}

import { ApifyClient } from 'apify-client';
import { env } from '../config/env';

export interface ApifyInstagramProfile {
  username: string;
  fullName: string;
  biography: string;
  followersCount: number;
  followsCount: number;
  postsCount: number;
  profilePicUrl: string;
  profilePicUrlHD: string | null;
  isVerified: boolean;
  isPrivate: boolean;
  isBusinessAccount: boolean;
  externalUrl: string | null;
  externalUrls: Array<{ title: string; url: string }>;
  igtvVideoCount: number;
}

export interface ApifyInstagramPost {
  id: string;
  shortCode: string;
  caption: string;
  likesCount: number;
  commentsCount: number;
  timestamp: string | null;
  type: 'Image' | 'Video' | 'Sidecar';
  url: string;
  displayUrl: string | null;
  hashtags: string[];
  alt: string | null;
  ownerUsername: string | null;
  isPinned: boolean;
  videoUrl: string | null;
  carouselDisplayUrls: string[];
}

function getClient(): ApifyClient {
  if (!env.INSTAGRAM_APIFY_TOKEN) throw new Error('INSTAGRAM_APIFY_TOKEN is not configured');
  return new ApifyClient({ token: env.INSTAGRAM_APIFY_TOKEN });
}

/**
 * Scrapes full public profile data for an Instagram handle.
 */
export async function scrapeProfile(handle: string): Promise<ApifyInstagramProfile> {
  const client = getClient();
  const run = await client.actor('apify/instagram-profile-scraper').call({ usernames: [handle] });
  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  const p = items[0] as Record<string, unknown>;

  return {
    username: (p.username ?? handle) as string,
    fullName: (p.fullName ?? p.full_name ?? '') as string,
    biography: (p.biography ?? '') as string,
    followersCount: (p.followersCount ?? 0) as number,
    followsCount: (p.followsCount ?? 0) as number,
    postsCount: (p.postsCount ?? 0) as number,
    profilePicUrl: (p.profilePicUrl ?? p.profile_pic_url ?? '') as string,
    profilePicUrlHD: (p.profilePicUrlHD ?? null) as string | null,
    isVerified: (p.verified ?? p.isVerified ?? false) as boolean,
    isPrivate: (p.private ?? p.isPrivate ?? false) as boolean,
    isBusinessAccount: (p.isBusinessAccount ?? false) as boolean,
    externalUrl: (p.externalUrl ?? null) as string | null,
    externalUrls: ((p.externalUrls as Array<{ title: string; url: string }>) ?? []),
    igtvVideoCount: (p.igtvVideoCount ?? 0) as number,
  };
}

/**
 * Scrapes recent posts with full metadata from a public Instagram profile.
 */
export async function scrapeRecentPosts(handle: string, limit = 50): Promise<ApifyInstagramPost[]> {
  const client = getClient();
  const run = await client.actor('apify/instagram-post-scraper').call({
    username: [handle],
    resultsLimit: limit,
  });
  const { items } = await client.dataset(run.defaultDatasetId).listItems();

  const mainItems: Record<string, unknown>[] = [];
  const childMap = new Map<string, string[]>();

  for (const item of items) {
    const p = item as Record<string, unknown>;
    if (typeof p.ownerUsername === 'string' && typeof p.id === 'string') {
      mainItems.push(p);
    } else if (typeof p.displayUrl === 'string') {
      const parentRef = (p.shortCode ?? p.parentId ?? p.parentShortCode) as string | undefined;
      if (parentRef) {
        const existing = childMap.get(parentRef) ?? [];
        childMap.set(parentRef, [...existing, p.displayUrl]);
      }
    }
  }

  return mainItems.map((p) => {
    const type = (p.type ?? 'Image') as 'Image' | 'Video' | 'Sidecar';
    const shortCode = (p.shortCode ?? '') as string;

    let carouselDisplayUrls: string[] = [];
    if (type === 'Sidecar') {
      const embedded = p.images as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(embedded) && embedded.length > 0) {
        carouselDisplayUrls = embedded.map((img) => img.displayUrl as string).filter(Boolean);
      }
      if (!carouselDisplayUrls.length) {
        const childPosts = p.childPosts as Array<Record<string, unknown>> | undefined;
        if (Array.isArray(childPosts) && childPosts.length > 0) {
          carouselDisplayUrls = childPosts.map((img) => img.displayUrl as string).filter(Boolean);
        }
      }
      if (!carouselDisplayUrls.length) {
        carouselDisplayUrls = childMap.get(shortCode) ?? [];
      }
    }

    return {
      id: (p.id ?? shortCode) as string,
      shortCode,
      caption: (p.caption ?? '') as string,
      likesCount: (p.likesCount ?? 0) as number,
      commentsCount: (p.commentsCount ?? 0) as number,
      timestamp: (p.timestamp ?? null) as string | null,
      type,
      url: (p.url ?? `https://instagram.com/p/${shortCode}`) as string,
      displayUrl: (p.displayUrl ?? null) as string | null,
      hashtags: ((p.hashtags as string[]) ?? []),
      alt: (p.alt ?? null) as string | null,
      ownerUsername: (p.ownerUsername ?? null) as string | null,
      isPinned: (p.isPinned ?? false) as boolean,
      videoUrl: (p.videoUrl ?? p.videoSrc ?? null) as string | null,
      carouselDisplayUrls,
    };
  });
}

/**
 * Maps an Apify post type to the internal post format.
 */
export function toPostFormat(type: ApifyInstagramPost['type']): 'Reels' | 'Carrossel' | 'Estático' {
  if (type === 'Sidecar') return 'Carrossel';
  if (type === 'Video') return 'Reels';
  return 'Estático';
}

export interface ApifyInstagramStory {
  id: string;
  mediaType: 'image' | 'video';
  displayUrl: string | null;
  videoUrl: string | null;
  timestamp: string | null;
  ownerUsername: string | null;
}

/**
 * Scrapes the current public stories for an Instagram handle.
 * Uses the `seemuapps/instagram-story-scraper` actor.
 * Output: one dataset item per username with a nested `stories` array.
 */
export async function scrapeStories(handle: string): Promise<ApifyInstagramStory[]> {
  const client = getClient();
  const run = await client.actor('seemuapps/instagram-story-scraper').call({ usernames: [handle] });
  const { items } = await client.dataset(run.defaultDatasetId).listItems();

  const profileRecord = items[0] as Record<string, unknown> | undefined;
  if (!profileRecord) return [];

  const rawStories = (profileRecord.stories ?? []) as Array<Record<string, unknown>>;

  return rawStories.map((s) => {
    const isVideo = s.mediaType === 'video';
    const mediaUrl = (s.mediaUrl ?? null) as string | null;
    const rawTimestamp = s.timestamp;
    const timestamp = typeof rawTimestamp === 'number'
      ? new Date(rawTimestamp * 1000).toISOString()
      : typeof rawTimestamp === 'string' ? rawTimestamp : null;

    return {
      id: (s.storyId ?? s.id ?? '') as string,
      mediaType: isVideo ? 'video' : 'image',
      displayUrl: isVideo ? null : mediaUrl,
      videoUrl: isVideo ? mediaUrl : null,
      timestamp,
      ownerUsername: handle,
    };
  });
}

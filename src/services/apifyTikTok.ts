import { ApifyClient } from 'apify-client';
import { env } from '../config/env';

export interface ApifyTikTokProfile {
  username: string;
  displayName: string;
  followers: number;
  following: number;
  likesCount: number;
  isVerified: boolean;
  profilePicUrl: string | null;
}

export interface ApifyTikTokPost {
  id: string;
  text: string;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  timestamp: string | null;
  postUrl: string;
  likes: number;
  comments: number;
  shares: number;
  views: number;
  hashtags: string[];
}

function getClient(): ApifyClient {
  if (!env.TIKTOK_APIFY_TOKEN) throw new Error('TIKTOK_APIFY_TOKEN is not configured');
  return new ApifyClient({ token: env.TIKTOK_APIFY_TOKEN });
}

/**
 * Scrapes public profile data for a TikTok handle.
 */
export async function scrapeTikTokProfile(handle: string): Promise<ApifyTikTokProfile> {
  const client = getClient();
  const run = await client.actor('clockworks/tiktok-scraper').call({
    profiles: [`https://www.tiktok.com/@${handle}`],
    resultsType: 'profiles',
    resultsLimit: 1,
  });
  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  const p = items[0] as Record<string, unknown>;
  const author = (p.authorMeta ?? {}) as Record<string, unknown>;

  return {
    username: (author.name ?? handle) as string,
    displayName: (author.nickName ?? author.name ?? handle) as string,
    followers: (author.fans ?? 0) as number,
    following: (author.following ?? 0) as number,
    likesCount: (author.heart ?? 0) as number,
    isVerified: (author.verified ?? false) as boolean,
    profilePicUrl: (author.avatar ?? author.originalAvatarUrl ?? null) as string | null,
  };
}

/**
 * Scrapes recent posts from a TikTok profile.
 * Note: `clockworks/tiktok-scraper` does not expose a direct video download URL
 * in its default dataset output (`mediaUrls` is always empty). The video thumbnail
 * is available via `videoMeta.coverUrl` and is used for S3 upload + vision analysis.
 */
export async function scrapeTikTokPosts(handle: string, limit = 30): Promise<ApifyTikTokPost[]> {
  const client = getClient();
  const run = await client.actor('clockworks/tiktok-scraper').call({
    profiles: [`https://www.tiktok.com/@${handle}`],
    resultsType: 'posts',
    resultsLimit: limit,
  });
  const { items } = await client.dataset(run.defaultDatasetId).listItems();

  return items.map((item) => {
    const p = item as Record<string, unknown>;
    const id = (p.id ?? '') as string;
    const videoMeta = (p.videoMeta ?? {}) as Record<string, unknown>;

    const hashtags = (() => {
      const raw = p.hashtags;
      if (!Array.isArray(raw)) return [];
      return raw.map((h: unknown) => {
        if (typeof h === 'string') return h;
        return ((h as Record<string, unknown>).name ?? '') as string;
      }).filter(Boolean);
    })();

    return {
      id,
      text: (p.text ?? '') as string,
      videoUrl: null,
      thumbnailUrl: (videoMeta.coverUrl ?? videoMeta.originalCoverUrl ?? null) as string | null,
      timestamp: (p.createTimeISO ?? null) as string | null,
      postUrl: (p.webVideoUrl ?? `https://www.tiktok.com/@${handle}/video/${id}`) as string,
      likes: (p.diggCount ?? 0) as number,
      comments: (p.commentCount ?? 0) as number,
      shares: (p.shareCount ?? 0) as number,
      views: (p.playCount ?? 0) as number,
      hashtags,
    };
  });
}

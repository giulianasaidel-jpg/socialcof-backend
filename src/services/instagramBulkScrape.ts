import { InstagramAccount } from '../models/InstagramAccount';
import { InstagramSyncLog } from '../models/InstagramSyncLog';
import type { InstagramAccountDoc } from './instagramScrapeActions';
import {
  scrapeAndPersistProfile,
  scrapeAndPersistPosts,
  scrapeAndPersistReels,
  scrapeAndPersistStories,
  syncInstagramAccount,
} from './instagramScrapeActions';

export type BulkScrapeKind = 'profile' | 'posts' | 'reels' | 'stories' | 'sync';

export interface BulkScrapeItemResult {
  externalId: string;
  handle: string;
  status: 'ok' | 'failed' | 'not_found';
  error?: string;
  summary?: Record<string, unknown>;
}

const DEFAULT_POSTS_LIMIT = 5;
const MAX_POSTS_LIMIT = 100;
const DEFAULT_REELS_LIMIT = 5;
const MAX_REELS_LIMIT = 20;

function dedupeExternalIdsPreserveOrder(raw: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of raw) {
    const t = id.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function clampPostsLimit(n: number | undefined): number {
  if (n === undefined) return DEFAULT_POSTS_LIMIT;
  if (!Number.isFinite(n)) return DEFAULT_POSTS_LIMIT;
  const f = Math.floor(n);
  return Math.min(MAX_POSTS_LIMIT, Math.max(1, f));
}

function clampReelsLimit(n: number | undefined): number {
  if (n === undefined) return DEFAULT_REELS_LIMIT;
  if (!Number.isFinite(n)) return DEFAULT_REELS_LIMIT;
  const f = Math.floor(n);
  return Math.min(MAX_REELS_LIMIT, Math.max(1, f));
}

async function runOne(
  account: InstagramAccountDoc,
  kind: BulkScrapeKind,
  postsLimit: number,
  reelsLimit: number,
): Promise<Omit<BulkScrapeItemResult, 'externalId' | 'handle'>> {
  try {
    switch (kind) {
      case 'profile': {
        const r = await scrapeAndPersistProfile(account);
        return { status: 'ok', summary: { followersCount: r.followersCount, postsCount: r.postsCount } };
      }
      case 'posts': {
        const r = await scrapeAndPersistPosts(account, postsLimit);
        return { status: 'ok', summary: { postsUpserted: r.total } };
      }
      case 'reels': {
        const r = await scrapeAndPersistReels(account, reelsLimit);
        const ok = r.reels.filter((x) => x.status === 'ok').length;
        const failed = r.reels.filter((x) => x.status === 'failed').length;
        return { status: 'ok', summary: { reelsCandidates: r.total, reelsOk: ok, reelsFailed: failed } };
      }
      case 'stories': {
        const r = await scrapeAndPersistStories(account);
        const ok = r.stories.filter((x) => x.status === 'ok').length;
        const failed = r.stories.filter((x) => x.status === 'failed').length;
        return { status: 'ok', summary: { storiesTotal: r.total, storiesOk: ok, storiesFailed: failed } };
      }
      case 'sync': {
        const r = await syncInstagramAccount(account);
        return { status: 'ok', summary: { syncedPosts: r.syncedPosts, followers: r.followers } };
      }
      default:
        return { status: 'failed', error: 'Unknown kind' };
    }
  } catch (err) {
    if (kind === 'sync') {
      await InstagramSyncLog.create({
        accountId: account._id,
        at: new Date(),
        level: 'erro',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
    return { status: 'failed', error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

export async function bulkScrapeInstagramAccounts(params: {
  accountIds: string[];
  kind: BulkScrapeKind;
  postsLimit?: number;
  reelsLimit?: number;
}): Promise<{
  kind: BulkScrapeKind;
  concurrency: 1;
  summary: { requested: number; ok: number; failed: number; notFound: number };
  results: BulkScrapeItemResult[];
}> {
  const raw = params.accountIds
    .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    .map((id) => id.trim());

  const accountIds = dedupeExternalIdsPreserveOrder(raw);

  const postsLimit = clampPostsLimit(params.postsLimit);
  const reelsLimit = clampReelsLimit(params.reelsLimit);

  const accounts = await InstagramAccount.find({ externalId: { $in: accountIds } });
  const byExternal = new Map(accounts.map((a) => [a.externalId, a]));

  const resultsById = new Map<string, BulkScrapeItemResult>();

  for (const extId of accountIds) {
    if (!byExternal.has(extId)) {
      resultsById.set(extId, { externalId: extId, handle: extId, status: 'not_found' });
    }
  }

  const toRun = accountIds
    .map((id) => byExternal.get(id))
    .filter((a): a is InstagramAccountDoc => !!a);

  for (const account of toRun) {
    const r = await runOne(account, params.kind, postsLimit, reelsLimit);
    resultsById.set(account.externalId, {
      externalId: account.externalId,
      handle: account.handle,
      ...r,
    });
  }

  const orderedResults = accountIds.map((id) => resultsById.get(id)!);

  const ok = orderedResults.filter((r) => r.status === 'ok').length;
  const failed = orderedResults.filter((r) => r.status === 'failed').length;
  const notFound = orderedResults.filter((r) => r.status === 'not_found').length;

  return {
    kind: params.kind,
    concurrency: 1,
    summary: { requested: accountIds.length, ok, failed, notFound },
    results: orderedResults,
  };
}

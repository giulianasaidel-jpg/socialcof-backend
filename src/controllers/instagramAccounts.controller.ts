import { Request, Response } from 'express';
import { Types, type PipelineStage } from 'mongoose';
import { InstagramAccount } from '../models/InstagramAccount';
import { TikTokAccount } from '../models/TikTokAccount';
import { InstagramStory } from '../models/InstagramStory';
import { Post } from '../models/Post';
import { TikTokPost } from '../models/TikTokPost';
import { MedicalNews } from '../models/MedicalNews';
import { MedNewsSource } from '../models/MedNewsSource';
import { scrapeProfile, scrapeRecentPosts, toPostFormat } from '../services/apifyInstagram';
import { uploadImageFromUrl, uploadCarouselImages, uploadBuffer } from '../services/s3';
import { analyseImage, analyseCarousel, analyseBrandColors } from '../services/visionAnalysis';
import {
  scrapeAndPersistProfile,
  scrapeAndPersistPosts,
  scrapeAndPersistReels,
  scrapeAndPersistStories,
  syncInstagramAccount,
} from '../services/instagramScrapeActions';
import { bulkScrapeInstagramAccounts, type BulkScrapeKind } from '../services/instagramBulkScrape';
import { analyzeAccount } from '../services/gptAnalysis';

const OBJECT_ID_HEX = /^[a-fA-F0-9]{24}$/;

const MED_NEWS_SOURCE_NAME_ALIASES: Record<string, string[]> = {
  'AHA Cardiology': ['AHA - Cardiology'],
  'ACC Cardiology': ['ACC - Cardiology'],
};

function expandMedNewsSourceNames(names: string[]): string[] {
  const out = new Set<string>();
  for (const n of names) {
    out.add(n);
    for (const a of MED_NEWS_SOURCE_NAME_ALIASES[n] ?? []) out.add(a);
  }
  return [...out];
}

function medNewsUrlPrefixMatchExpr(prefix: string): object | null {
  const p = prefix.trim().replace(/\/+$/u, '');
  if (!p.length) return null;
  const len = p.length;
  const lower = p.toLowerCase();
  return {
    $and: [
      { $gte: [{ $strLenCP: { $ifNull: ['$$artUrl', ''] } }, { $literal: len }] },
      {
        $eq: [
          { $substrCP: [{ $toLower: { $ifNull: ['$$artUrl', ''] } }, 0, { $literal: len }] },
          { $literal: lower },
        ],
      },
    ],
  };
}

function buildMedNewsLookupSubPipeline(
  sources: Array<{
    _id: Types.ObjectId;
    name: string;
    url: string;
    newsPageUrl?: string | null;
  }>,
): object[] {
  const ids = sources.map((s) => s._id);
  if (ids.length === 0) return [{ $match: { _id: { $exists: false } } }];

  const switchBranches = sources.map((s) => {
    const nameVariants = expandMedNewsSourceNames([s.name]);
    const parts: object[] = [{ $in: ['$$artSrc', nameVariants] }];
    const u = medNewsUrlPrefixMatchExpr(s.url);
    if (u) parts.push(u);
    if (s.newsPageUrl && s.newsPageUrl.trim() !== s.url.trim()) {
      const np = medNewsUrlPrefixMatchExpr(s.newsPageUrl);
      if (np) parts.push(np);
    }
    const thenExpr: object = parts.length === 1 ? parts[0] : { $or: parts };
    return { case: { $eq: ['$_id', s._id] }, then: thenExpr };
  });

  return [
    { $match: { _id: { $in: ids } } },
    {
      $match: {
        $expr: {
          $switch: {
            branches: switchBranches,
            default: { $literal: false },
          },
        },
      },
    },
  ];
}

function parseObjectIdArray(value: unknown): Types.ObjectId[] | null {
  if (!Array.isArray(value)) return null;
  const ids: Types.ObjectId[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || !OBJECT_ID_HEX.test(item) || !Types.ObjectId.isValid(item)) return null;
    ids.push(new Types.ObjectId(item));
  }
  return ids;
}

function parseStringRefArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || item.length === 0) return null;
    out.push(item);
  }
  return out;
}

async function resolveRelatedInstagramAccountIds(
  values: string[],
): Promise<{ ok: Types.ObjectId[] } | { error: string }> {
  const handles = [...new Set(values.filter((s) => !OBJECT_ID_HEX.test(s)))];
  const byExternal = new Map<string, Types.ObjectId>();
  if (handles.length) {
    const accounts = await InstagramAccount.find({ externalId: { $in: handles } }).select('_id externalId');
    for (const a of accounts) byExternal.set(a.externalId, a._id);
    const missing = handles.filter((h) => !byExternal.has(h));
    if (missing.length) return { error: `Unknown Instagram account(s): ${missing.join(', ')}` };
  }
  const ok: Types.ObjectId[] = [];
  for (const s of values) {
    if (OBJECT_ID_HEX.test(s)) ok.push(new Types.ObjectId(s));
    else ok.push(byExternal.get(s)!);
  }
  return { ok };
}

async function resolveRelatedTikTokAccountIds(values: string[]): Promise<{ ok: Types.ObjectId[] } | { error: string }> {
  const keys = [...new Set(values.filter((s) => !OBJECT_ID_HEX.test(s)))];
  const byExternal = new Map<string, Types.ObjectId>();
  if (keys.length) {
    const accounts = await TikTokAccount.find({
      $or: [{ externalId: { $in: keys } }, { handle: { $in: keys } }],
    }).select('_id externalId handle');
    for (const a of accounts) {
      byExternal.set(a.externalId, a._id);
      byExternal.set(a.handle, a._id);
    }
    const missing = keys.filter((k) => !byExternal.has(k));
    if (missing.length) return { error: `Unknown TikTok account(s): ${missing.join(', ')}` };
  }
  const ok: Types.ObjectId[] = [];
  for (const s of values) {
    if (OBJECT_ID_HEX.test(s)) ok.push(new Types.ObjectId(s));
    else ok.push(byExternal.get(s)!);
  }
  return { ok };
}

/**
 * Maps an InstagramAccount document to the API response shape.
 */
function toResponse(account: InstanceType<typeof InstagramAccount>) {
  return {
    id: account.externalId,
    handle: account.handle,
    displayName: account.displayName,
    profileUrl: account.profileUrl,
    followers: account.followers,
    status: account.status,
    lastSyncAt: account.lastSyncAt,
    tokenExpiresAt: account.tokenExpiresAt,
    ingestEnabled: account.ingestEnabled,
    workspace: account.workspace,
    profilePicS3Url: account.profilePicS3Url ?? null,
    brandColors: account.brandColors ?? [],
    referenceImages: account.referenceImages ?? [],
    brandPostImages: account.brandPostImages ?? [],
    relatedInstagramAccountIds: (account.relatedInstagramAccountIds ?? []).map((oid) => oid.toString()),
    relatedTikTokAccountIds: (account.relatedTikTokAccountIds ?? []).map((oid) => oid.toString()),
    relatedMedNewsSourceIds: (account.relatedMedNewsSourceIds ?? []).map((oid) => oid.toString()),
  };
}

/**
 * GET /instagram-accounts — Lists accounts filtered by workspace and user permissions.
 */
export async function listAccounts(req: Request, res: Response): Promise<void> {
  const { workspace } = req.query;
  const { role, allowedInstagramAccountIds } = req.user!;

  const filter: Record<string, unknown> = {};
  if (workspace) filter.workspace = workspace;
  if (role !== 'admin') filter.externalId = { $in: allowedInstagramAccountIds };

  const accounts = await InstagramAccount.find(filter);
  res.json(accounts.map(toResponse));
}

/**
 * GET /instagram-accounts/:id — Returns a single account by externalId.
 */
export async function getAccount(req: Request, res: Response): Promise<void> {
  const account = await InstagramAccount.findOne({ externalId: req.params.id });
  if (!account) {
    res.status(404).json({ message: 'Account not found' });
    return;
  }
  res.json(toResponse(account));
}

function relatedFeedAccountIdMatchExpr(accountIdLet: string): object {
  return {
    $expr: {
      $or: [
        { $eq: ['$_id', accountIdLet] },
        { $eq: [{ $toString: '$_id' }, { $toString: { $ifNull: [accountIdLet, ''] } }] },
      ],
    },
  };
}

function makeInstagramAccountLookupStage(accountsColl: string): object {
  return {
    $lookup: {
      from: accountsColl,
      let: { aid: '$accountId' },
      pipeline: [
        { $match: relatedFeedAccountIdMatchExpr('$$aid') },
        { $project: { externalId: 1, handle: 1 } },
      ],
      as: '_acc',
    },
  };
}

function makeTikTokAccountLookupStage(accountsColl: string): object {
  return {
    $lookup: {
      from: accountsColl,
      let: { aid: '$accountId' },
      pipeline: [
        { $match: relatedFeedAccountIdMatchExpr('$$aid') },
        { $project: { externalId: 1, handle: 1 } },
      ],
      as: '_tta',
    },
  };
}

function relatedFeedSortAndFacetStages(skip: number, limit: number): object[] {
  return [
    { $sort: { _hasTranscript: -1, sortAt: -1, _residencyFirst: 1 } },
    {
      $facet: {
        total: [{ $count: 'count' }],
        data: [{ $skip: skip }, { $limit: limit }],
      },
    },
  ];
}

type MedNewsSourceRow = {
  _id: Types.ObjectId;
  name: string;
  url: string;
  newsPageUrl?: string | null;
};

function buildRelatedPostStages(igIds: Types.ObjectId[], igLookupStage: object): object[] {
  if (igIds.length === 0) return [{ $match: { $expr: false } }];
  return [
    { $match: { accountId: { $in: igIds } } },
    igLookupStage,
    { $addFields: { _acct: { $arrayElemAt: ['$_acc', 0] } } },
    {
      $addFields: {
        type: { $cond: [{ $eq: ['$format', 'Reels'] }, 'instagram_reel', 'instagram_post'] },
        sortAt: '$postedAt',
        _residencyFirst: 1,
        _hasTranscript: { $cond: [{ $gt: ['$transcript', ''] }, 1, 0] },
        payload: {
          id: { $toString: '$_id' },
          instagramPostId: '$instagramPostId',
          accountId: {
            $cond: [
              { $gt: [{ $strLenCP: { $ifNull: ['$_acct.externalId', ''] } }, 0] },
              '$_acct.externalId',
              { $toString: '$accountId' },
            ],
          },
          title: '$title',
          postedAt: '$postedAt',
          format: '$format',
          likes: '$likes',
          comments: '$comments',
          saves: '$saves',
          postUrl: '$postUrl',
          thumbnailUrl: '$thumbnailUrl',
          videoUrl: '$videoUrl',
          transcript: '$transcript',
          carouselImages: { $ifNull: ['$carouselImages', []] },
        },
      },
    },
    { $project: { type: 1, sortAt: 1, payload: 1, _hasTranscript: 1, _residencyFirst: 1 } },
  ];
}

function buildRelatedStoryPipeline(igIds: Types.ObjectId[], igLookupStage: object): object[] {
  if (igIds.length === 0) return [{ $match: { $expr: false } }];
  return [
    { $match: { accountId: { $in: igIds } } },
    igLookupStage,
    { $addFields: { _acct: { $arrayElemAt: ['$_acc', 0] } } },
    {
      $addFields: {
        type: 'instagram_story',
        sortAt: { $ifNull: ['$postedAt', '$syncedAt'] },
        _residencyFirst: 1,
        _hasTranscript: { $cond: [{ $gt: ['$transcript', ''] }, 1, 0] },
        payload: {
          id: { $toString: '$_id' },
          storyId: '$storyId',
          accountId: {
            $cond: [
              { $gt: [{ $strLenCP: { $ifNull: ['$_acct.externalId', ''] } }, 0] },
              '$_acct.externalId',
              {
                $cond: [
                  { $gt: [{ $strLenCP: { $ifNull: ['$_acct.handle', ''] } }, 0] },
                  '$_acct.handle',
                  '$handle',
                ],
              },
            ],
          },
          handle: '$handle',
          mediaType: '$mediaType',
          thumbnailUrl: '$thumbnailUrl',
          videoUrl: '$videoUrl',
          transcript: '$transcript',
          postedAt: '$postedAt',
          syncedAt: '$syncedAt',
          expiresAt: '$expiresAt',
        },
      },
    },
    { $project: { type: 1, sortAt: 1, payload: 1, _hasTranscript: 1, _residencyFirst: 1 } },
  ];
}

function buildRelatedTiktokPipeline(ttIds: Types.ObjectId[], ttLookupStage: object): object[] {
  if (ttIds.length === 0) return [{ $match: { $expr: false } }];
  return [
    { $match: { accountId: { $in: ttIds } } },
    ttLookupStage,
    { $addFields: { _tt: { $arrayElemAt: ['$_tta', 0] } } },
    {
      $addFields: {
        type: 'tiktok_post',
        sortAt: { $ifNull: ['$postedAt', '$syncedAt'] },
        _residencyFirst: 1,
        _hasTranscript: { $cond: [{ $gt: ['$transcript', ''] }, 1, 0] },
        payload: {
          id: { $toString: '$_id' },
          tiktokPostId: '$tiktokPostId',
          accountId: {
            $cond: [
              { $gt: [{ $strLenCP: { $ifNull: ['$_tt.externalId', ''] } }, 0] },
              '$_tt.externalId',
              {
                $cond: [
                  { $gt: [{ $strLenCP: { $ifNull: ['$_tt.handle', ''] } }, 0] },
                  '$_tt.handle',
                  { $toString: '$accountId' },
                ],
              },
            ],
          },
          title: '$title',
          postedAt: '$postedAt',
          thumbnailUrl: '$thumbnailUrl',
          videoUrl: '$videoUrl',
          transcript: '$transcript',
          likes: '$likes',
          comments: '$comments',
          shares: '$shares',
          views: '$views',
          postUrl: '$postUrl',
          hashtags: { $ifNull: ['$hashtags', []] },
          syncedAt: '$syncedAt',
        },
      },
    },
    { $project: { type: 1, sortAt: 1, payload: 1, _hasTranscript: 1, _residencyFirst: 1 } },
  ];
}

function buildRelatedNewsPipelineStages(medSrcColl: string, medNewsLookupPipeline: object[]): object[] {
  return [
    {
      $lookup: {
        from: medSrcColl,
        let: { artSrc: '$source', artUrl: '$url' },
        pipeline: medNewsLookupPipeline,
        as: '_linkedSources',
      },
    },
    {
      $match: {
        $expr: { $gt: [{ $size: '$_linkedSources' }, 0] },
      },
    },
    {
      $addFields: {
        type: 'medical_news',
        sortAt: '$publishedAt',
        _residencyFirst: { $cond: [{ $eq: ['$specialty', 'residencia'] }, 0, 1] },
        _hasTranscript: { $cond: [{ $gt: [{ $strLenCP: { $ifNull: ['$summary', ''] } }, 0] }, 1, 0] },
        payload: {
          id: { $toString: '$_id' },
          title: '$title',
          summary: '$summary',
          source: '$source',
          url: '$url',
          category: '$category',
          language: '$language',
          specialty: '$specialty',
          author: '$author',
          tags: { $ifNull: ['$tags', []] },
          wordCount: '$wordCount',
          imageUrl: '$imageUrl',
          publishedAt: '$publishedAt',
          medNewsSourceId: { $toString: { $arrayElemAt: ['$_linkedSources._id', 0] } },
          medNewsSourceName: { $arrayElemAt: ['$_linkedSources.name', 0] },
        },
      },
    },
    { $project: { type: 1, sortAt: 1, payload: 1, _hasTranscript: 1, _residencyFirst: 1 } },
  ];
}

function buildInstagramRelatedFeedOnlyPipeline(igIds: Types.ObjectId[], skip: number, limit: number): object[] {
  const igAcc = InstagramAccount.collection.name;
  const igStory = InstagramStory.collection.name;
  const igL = makeInstagramAccountLookupStage(igAcc);
  const postStages = buildRelatedPostStages(igIds, igL);
  const storyPipeline = buildRelatedStoryPipeline(igIds, igL);
  return [
    ...postStages,
    { $unionWith: { coll: igStory, pipeline: storyPipeline } },
    ...relatedFeedSortAndFacetStages(skip, limit),
  ];
}

function buildTikTokRelatedFeedOnlyPipeline(ttIds: Types.ObjectId[], skip: number, limit: number): object[] {
  const ttL = makeTikTokAccountLookupStage(TikTokAccount.collection.name);
  return [...buildRelatedTiktokPipeline(ttIds, ttL), ...relatedFeedSortAndFacetStages(skip, limit)];
}

function buildNewsRelatedFeedOnlyPipeline(sources: MedNewsSourceRow[], skip: number, limit: number): object[] {
  if (sources.length === 0) return [{ $match: { $expr: false } }, ...relatedFeedSortAndFacetStages(skip, limit)];
  const medSrcColl = MedNewsSource.collection.name;
  const medNewsLookupPipeline = buildMedNewsLookupSubPipeline(sources);
  return [...buildRelatedNewsPipelineStages(medSrcColl, medNewsLookupPipeline), ...relatedFeedSortAndFacetStages(skip, limit)];
}

function buildRelatedInterestFeedPipeline(
  igIds: Types.ObjectId[],
  ttIds: Types.ObjectId[],
  medNewsSourcesForLookup: MedNewsSourceRow[],
  skip: number,
  limit: number,
): object[] {
  const igStory = InstagramStory.collection.name;
  const ttPost = TikTokPost.collection.name;
  const medNews = MedicalNews.collection.name;
  const medSrcColl = MedNewsSource.collection.name;
  const medNewsLookupPipeline = buildMedNewsLookupSubPipeline(medNewsSourcesForLookup);

  const igL = makeInstagramAccountLookupStage(InstagramAccount.collection.name);
  const ttL = makeTikTokAccountLookupStage(TikTokAccount.collection.name);

  const postStages = buildRelatedPostStages(igIds, igL);
  const storyPipeline = buildRelatedStoryPipeline(igIds, igL);
  const tiktokPipeline = buildRelatedTiktokPipeline(ttIds, ttL);
  const newsPipeline =
    medNewsSourcesForLookup.length > 0
      ? buildRelatedNewsPipelineStages(medSrcColl, medNewsLookupPipeline)
      : [{ $match: { $expr: false } }];

  return [
    ...postStages,
    { $unionWith: { coll: igStory, pipeline: storyPipeline } },
    { $unionWith: { coll: ttPost, pipeline: tiktokPipeline } },
    { $unionWith: { coll: medNews, pipeline: newsPipeline } },
    ...relatedFeedSortAndFacetStages(skip, limit),
  ];
}

function relatedFeedJsonFromAgg(
  agg: { total?: Array<{ count: number }>; data?: unknown[] } | undefined,
  pageNum: number,
  limitNum: number,
) {
  const total = agg?.total?.[0]?.count ?? 0;
  const data = (agg?.data ?? []) as Array<{ type: string; sortAt: Date; payload: Record<string, unknown> }>;
  return {
    data: data.map((row) => ({
      type: row.type,
      sortAt: row.sortAt,
      payload: row.payload,
    })),
    total,
    page: pageNum,
    limit: limitNum,
    pages: limitNum > 0 ? Math.ceil(total / limitNum) : 0,
  };
}

type RelatedFeedRequestContext = {
  pageNum: number;
  limitNum: number;
  skip: number;
  igIds: Types.ObjectId[];
  ttIds: Types.ObjectId[];
  medSourceIds: Types.ObjectId[];
  newsSourcesRows: MedNewsSourceRow[];
  relatedNewsSources: Array<{
    id: string;
    name: string;
    url: string;
    newsPageUrl: string | null;
    lastScrapedAt: Date | null | undefined;
    isActive: boolean;
    category: string;
    language: string;
  }>;
};

async function loadRelatedFeedRequestContext(req: Request, res: Response): Promise<RelatedFeedRequestContext | null> {
  const { role, allowedInstagramAccountIds } = req.user!;
  const externalId = req.params.id;

  if (role !== 'admin' && !allowedInstagramAccountIds.includes(externalId)) {
    res.status(403).json({ message: 'Access denied for this Instagram account' });
    return null;
  }

  const account = await InstagramAccount.findOne({ externalId });
  if (!account) {
    res.status(404).json({ message: 'Account not found' });
    return null;
  }

  const { page = '1', limit = '30' } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 30));
  const skip = (pageNum - 1) * limitNum;

  const igIds = (account.relatedInstagramAccountIds ?? []).map((oid) => new Types.ObjectId(String(oid)));
  const ttIds = (account.relatedTikTokAccountIds ?? []).map((oid) => new Types.ObjectId(String(oid)));
  const medSourceIds = account.relatedMedNewsSourceIds ?? [];

  const newsDocs =
    medSourceIds.length > 0
      ? await MedNewsSource.find({ _id: { $in: medSourceIds } })
          .select('_id name url newsPageUrl lastScrapedAt isActive category language')
          .sort({ name: 1 })
          .lean()
      : [];

  const newsSourcesRows: MedNewsSourceRow[] = newsDocs.map((s) => ({
    _id: s._id as Types.ObjectId,
    name: s.name,
    url: s.url,
    newsPageUrl: s.newsPageUrl,
  }));

  const relatedNewsSources = newsDocs.map((s) => ({
    id: String(s._id),
    name: s.name,
    url: s.url,
    newsPageUrl: s.newsPageUrl ?? null,
    lastScrapedAt: s.lastScrapedAt ?? null,
    isActive: s.isActive,
    category: s.category,
    language: s.language,
  }));

  return {
    pageNum,
    limitNum,
    skip,
    igIds,
    ttIds,
    medSourceIds,
    newsSourcesRows,
    relatedNewsSources,
  };
}

/**
 * GET /instagram-accounts/:id/related-feed — Single merged timeline (posts, reels, stories, TikTok, news). Prefer the split endpoints for stable pagination.
 */
export async function getRelatedInterestFeed(req: Request, res: Response): Promise<void> {
  const ctx = await loadRelatedFeedRequestContext(req, res);
  if (!ctx) return;

  const { igIds, ttIds, medSourceIds, newsSourcesRows, relatedNewsSources, skip, limitNum, pageNum } = ctx;

  if (igIds.length === 0 && ttIds.length === 0 && medSourceIds.length === 0) {
    res.json({ ...relatedFeedJsonFromAgg(undefined, pageNum, limitNum), relatedNewsSources: [] });
    return;
  }

  const pipeline = buildRelatedInterestFeedPipeline(igIds, ttIds, newsSourcesRows, skip, limitNum);
  const [agg] = await Post.aggregate(pipeline as PipelineStage[]);
  res.json({ ...relatedFeedJsonFromAgg(agg, pageNum, limitNum), relatedNewsSources });
}

/**
 * GET /instagram-accounts/:id/related-feed/instagram — Posts, reels and stories for relatedInstagramAccountIds only (Post.aggregate + stories union).
 */
export async function getRelatedInstagramInterestFeed(req: Request, res: Response): Promise<void> {
  const ctx = await loadRelatedFeedRequestContext(req, res);
  if (!ctx) return;
  const { igIds, skip, limitNum, pageNum } = ctx;

  if (igIds.length === 0) {
    res.json(relatedFeedJsonFromAgg(undefined, pageNum, limitNum));
    return;
  }

  const pipeline = buildInstagramRelatedFeedOnlyPipeline(igIds, skip, limitNum);
  const [agg] = await Post.aggregate(pipeline as PipelineStage[]);
  res.json(relatedFeedJsonFromAgg(agg, pageNum, limitNum));
}

/**
 * GET /instagram-accounts/:id/related-feed/tiktok — TikTok posts for relatedTikTokAccountIds only (TikTokPost.aggregate).
 */
export async function getRelatedTikTokInterestFeed(req: Request, res: Response): Promise<void> {
  const ctx = await loadRelatedFeedRequestContext(req, res);
  if (!ctx) return;
  const { ttIds, skip, limitNum, pageNum } = ctx;

  if (ttIds.length === 0) {
    res.json(relatedFeedJsonFromAgg(undefined, pageNum, limitNum));
    return;
  }

  const pipeline = buildTikTokRelatedFeedOnlyPipeline(ttIds, skip, limitNum);
  const [agg] = await TikTokPost.aggregate(pipeline as PipelineStage[]);
  res.json(relatedFeedJsonFromAgg(agg, pageNum, limitNum));
}

/**
 * GET /instagram-accounts/:id/related-feed/news — Medical news for linked MedNewsSource rows only (MedicalNews.aggregate + lookup).
 */
export async function getRelatedNewsInterestFeed(req: Request, res: Response): Promise<void> {
  const ctx = await loadRelatedFeedRequestContext(req, res);
  if (!ctx) return;
  const { medSourceIds, newsSourcesRows, relatedNewsSources, skip, limitNum, pageNum } = ctx;

  if (medSourceIds.length === 0) {
    res.json({ ...relatedFeedJsonFromAgg(undefined, pageNum, limitNum), relatedNewsSources: [] });
    return;
  }

  const pipeline = buildNewsRelatedFeedOnlyPipeline(newsSourcesRows, skip, limitNum);
  const [agg] = await MedicalNews.aggregate(pipeline as PipelineStage[]);
  res.json({ ...relatedFeedJsonFromAgg(agg, pageNum, limitNum), relatedNewsSources });
}

/**
 * Scrapes, uploads branding assets and upserts a single Instagram account.
 * Returns the saved account and whether it was newly created.
 */
async function discoverOne(handle: string, workspace: string): Promise<{ account: InstanceType<typeof InstagramAccount>; created: boolean }> {
  const [profile, posts] = await Promise.all([
    scrapeProfile(handle),
    scrapeRecentPosts(handle, 5),
  ]);

  const imagePosts = posts.filter((p) => p.type === 'Image' && p.displayUrl).slice(0, 6);

  const [profilePicS3Url, ...uploadedRefs] = await Promise.all([
    profile.profilePicUrl
      ? uploadImageFromUrl(profile.profilePicUrl, `branding/${handle}/profile-pic.jpg`).catch(() => null)
      : Promise.resolve(null),
    ...imagePosts.map((p, i) =>
      uploadImageFromUrl(p.displayUrl!, `branding/${handle}/ref_${i}.jpg`).catch(() => null),
    ),
  ]);

  const referenceImages = uploadedRefs.filter((u): u is string => u !== null);

  const brandColorSources = [profilePicS3Url, ...referenceImages].filter((u): u is string => u !== null);
  const brandColors = brandColorSources.length
    ? await analyseBrandColors(brandColorSources).catch(() => [])
    : [];

  const existed = await InstagramAccount.exists({ externalId: handle });

  const account = await InstagramAccount.findOneAndUpdate(
    { externalId: handle },
    {
      $set: {
        displayName: profile.fullName || handle,
        profileUrl: `https://instagram.com/${handle}`,
        followers: profile.followersCount,
        status: 'conectado',
        lastSyncAt: new Date(),
        ...(profilePicS3Url && { profilePicS3Url }),
        ...(referenceImages.length && { referenceImages }),
        ...(brandColors.length && { brandColors }),
      },
      $setOnInsert: {
        externalId: handle,
        handle,
        workspace,
        ingestEnabled: true,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  return { account: account!, created: !existed };
}

/**
 * POST /instagram-accounts/discover — Scrapes a public Instagram profile via Apify, saves (or updates)
 * the account, uploads profile pic and reference images to S3, and extracts brand colors.
 */
export async function discoverAccount(req: Request, res: Response): Promise<void> {
  const { handle, workspace } = req.body as { handle?: string; workspace?: string };

  if (!handle || !workspace) {
    res.status(400).json({ message: 'handle and workspace are required' });
    return;
  }

  try {
    const { account, created } = await discoverOne(handle, workspace);
    res.status(created ? 201 : 200).json(toResponse(account));
  } catch (err) {
    res.status(502).json({ message: 'Failed to scrape profile', error: err instanceof Error ? err.message : 'Unknown error' });
  }
}

/**
 * POST /instagram-accounts/bulk-discover — Scrapes and upserts multiple Instagram profiles in one call.
 * Processes handles sequentially to respect Apify rate limits.
 * Body: { handles: string[], workspace: string }
 * Returns per-handle results with status created | updated | failed.
 */
export async function bulkDiscoverAccounts(req: Request, res: Response): Promise<void> {
  const { handles, workspace } = req.body as { handles?: unknown; workspace?: string };

  if (!Array.isArray(handles) || handles.length === 0 || !workspace) {
    res.status(400).json({ message: 'handles (non-empty array) and workspace are required' });
    return;
  }

  const validHandles = handles.filter((h): h is string => typeof h === 'string' && h.trim().length > 0);

  if (validHandles.length === 0) {
    res.status(400).json({ message: 'handles must be an array of non-empty strings' });
    return;
  }

  const results: Array<{ handle: string; status: 'created' | 'updated' | 'failed'; account?: ReturnType<typeof toResponse>; error?: string }> = [];

  for (const handle of validHandles) {
    try {
      const { account, created } = await discoverOne(handle.trim(), workspace);
      results.push({ handle, status: created ? 'created' : 'updated', account: toResponse(account) });
    } catch (err) {
      results.push({ handle, status: 'failed', error: err instanceof Error ? err.message : 'Unknown error' });
    }
  }

  const summary = {
    total: validHandles.length,
    created: results.filter((r) => r.status === 'created').length,
    updated: results.filter((r) => r.status === 'updated').length,
    failed: results.filter((r) => r.status === 'failed').length,
  };

  res.json({ summary, results });
}

const BULK_SCRAPE_KINDS = new Set<BulkScrapeKind>(['profile', 'posts', 'reels', 'stories', 'sync']);
const BULK_SCRAPE_MAX_ACCOUNTS = 120;

/**
 * POST /instagram-accounts/bulk-scrape — Runs the same Apify scrape as the per-account routes for many accounts in parallel batches.
 * Body: { accountIds: string[] (externalId), kind: profile | posts | reels | stories | sync, postsLimit?: number, reelsLimit?: number }
 * Accounts are processed one after another (no parallel Apify runs).
 */
export async function bulkScrapeAccounts(req: Request, res: Response): Promise<void> {
  const { accountIds, kind, postsLimit, reelsLimit } = req.body as {
    accountIds?: unknown;
    kind?: string;
    postsLimit?: number;
    reelsLimit?: number;
  };

  if (!Array.isArray(accountIds) || accountIds.length === 0) {
    res.status(400).json({ message: 'accountIds (non-empty array) is required' });
    return;
  }

  const stringIds = accountIds.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
  if (stringIds.length === 0) {
    res.status(400).json({ message: 'accountIds must contain at least one non-empty string (externalId)' });
    return;
  }

  if (stringIds.length > BULK_SCRAPE_MAX_ACCOUNTS) {
    res.status(400).json({ message: `At most ${BULK_SCRAPE_MAX_ACCOUNTS} externalIds per request` });
    return;
  }

  if (!kind || !BULK_SCRAPE_KINDS.has(kind as BulkScrapeKind)) {
    res.status(400).json({ message: 'kind must be one of: profile, posts, reels, stories, sync' });
    return;
  }

  try {
    const out = await bulkScrapeInstagramAccounts({
      accountIds: stringIds,
      kind: kind as BulkScrapeKind,
      postsLimit,
      reelsLimit,
    });
    res.json(out);
  } catch (err) {
    res.status(502).json({ message: 'Bulk scrape failed', error: err instanceof Error ? err.message : 'Unknown error' });
  }
}

/**
 * POST /instagram-accounts — Creates a new Instagram account (admin only).
 */
export async function createAccount(req: Request, res: Response): Promise<void> {
  const account = await InstagramAccount.create(req.body);
  res.status(201).json(toResponse(account));
}

/**
 * PATCH /instagram-accounts/:id — Updates safe user-facing fields of an account.
 * Accepts displayName, status, ingestEnabled, workspace (admin), and related* arrays:
 * Mongo ObjectId hex strings and/or Instagram externalId handles / TikTok externalId or handle.
 */
export async function updateAccount(req: Request, res: Response): Promise<void> {
  const { role } = req.user!;
  const {
    displayName,
    status,
    ingestEnabled,
    workspace,
    relatedInstagramAccountIds,
    relatedTikTokAccountIds,
    relatedMedNewsSourceIds,
  } = req.body as {
    displayName?: string;
    status?: string;
    ingestEnabled?: boolean;
    workspace?: string;
    relatedInstagramAccountIds?: unknown;
    relatedTikTokAccountIds?: unknown;
    relatedMedNewsSourceIds?: unknown;
  };

  const patch: Record<string, unknown> = {};
  if (displayName !== undefined) patch.displayName = displayName;
  if (status !== undefined) patch.status = status;
  if (ingestEnabled !== undefined) patch.ingestEnabled = ingestEnabled;
  if (workspace !== undefined && role === 'admin') patch.workspace = workspace;

  const existing = await InstagramAccount.findOne({ externalId: req.params.id });
  if (!existing) {
    res.status(404).json({ message: 'Account not found' });
    return;
  }

  if (relatedInstagramAccountIds !== undefined) {
    const raw = parseStringRefArray(relatedInstagramAccountIds);
    if (raw === null) {
      res.status(400).json({ message: 'relatedInstagramAccountIds must be an array of non-empty strings' });
      return;
    }
    const resolved = await resolveRelatedInstagramAccountIds(raw);
    if ('error' in resolved) {
      res.status(400).json({ message: resolved.error });
      return;
    }
    const selfId = existing._id.toString();
    patch.relatedInstagramAccountIds = resolved.ok.filter((oid) => oid.toString() !== selfId);
  }
  if (relatedTikTokAccountIds !== undefined) {
    const raw = parseStringRefArray(relatedTikTokAccountIds);
    if (raw === null) {
      res.status(400).json({ message: 'relatedTikTokAccountIds must be an array of non-empty strings' });
      return;
    }
    const resolved = await resolveRelatedTikTokAccountIds(raw);
    if ('error' in resolved) {
      res.status(400).json({ message: resolved.error });
      return;
    }
    patch.relatedTikTokAccountIds = resolved.ok;
  }
  if (relatedMedNewsSourceIds !== undefined) {
    const parsed = parseObjectIdArray(relatedMedNewsSourceIds);
    if (parsed === null) {
      res.status(400).json({ message: 'relatedMedNewsSourceIds must be an array of valid ObjectId strings' });
      return;
    }
    patch.relatedMedNewsSourceIds = parsed;
  }

  if (Object.keys(patch).length === 0) {
    res.json(toResponse(existing));
    return;
  }

  const account = await InstagramAccount.findOneAndUpdate(
    { externalId: req.params.id },
    { $set: patch },
    { new: true },
  );
  res.json(toResponse(account!));
}

/**
 * DELETE /instagram-accounts/:id — Removes an account by externalId (admin only).
 */
export async function deleteAccount(req: Request, res: Response): Promise<void> {
  const account = await InstagramAccount.findOneAndDelete({ externalId: req.params.id });
  if (!account) {
    res.status(404).json({ message: 'Account not found' });
    return;
  }
  res.status(204).send();
}

/**
 * GET /instagram-accounts/:id/stats — Returns followers count, total posts and recent posts for a given period.
 */
export async function getAccountStats(req: Request, res: Response): Promise<void> {
  const account = await InstagramAccount.findOne({ externalId: req.params.id });
  if (!account) {
    res.status(404).json({ message: 'Account not found' });
    return;
  }

  const { dateFrom, dateTo } = req.query as Record<string, string>;

  const postFilter: Record<string, unknown> = { accountId: account._id };
  if (dateFrom || dateTo) {
    postFilter.postedAt = {};
    if (dateFrom) (postFilter.postedAt as Record<string, unknown>).$gte = new Date(dateFrom);
    if (dateTo) (postFilter.postedAt as Record<string, unknown>).$lte = new Date(dateTo);
  }

  const [totalPosts, recentPosts] = await Promise.all([
    Post.countDocuments(postFilter),
    Post.find(postFilter).sort({ postedAt: -1 }).limit(10),
  ]);

  res.json({
    followers: account.followers,
    totalPosts,
    recentPosts: recentPosts.map((p) => ({
      id: p._id.toString(),
      title: p.title,
      postedAt: p.postedAt,
      format: p.format,
      likes: p.likes,
      comments: p.comments,
      saves: p.saves,
      reach: p.reach,
      impressions: p.impressions,
      postUrl: p.postUrl ?? null,
      thumbnailUrl: p.thumbnailUrl ?? null,
    })),
  });
}

/**
 * POST /instagram-accounts/:id/scrape/profile — Fetches full public profile data from Apify, updates the account and returns all fields.
 */
export async function scrapeAccountProfile(req: Request, res: Response): Promise<void> {
  const account = await InstagramAccount.findOne({ externalId: req.params.id });
  if (!account) {
    res.status(404).json({ message: 'Account not found' });
    return;
  }

  try {
    const payload = await scrapeAndPersistProfile(account);
    res.json(payload);
  } catch (err) {
    res.status(502).json({ message: 'Profile scrape failed', error: err instanceof Error ? err.message : 'Unknown error' });
  }
}

/**
 * POST /instagram-accounts/:id/scrape/posts — Fetches recent posts from Apify, upserts them in the DB and returns the full list.
 */
export async function scrapeAccountPosts(req: Request, res: Response): Promise<void> {
  const account = await InstagramAccount.findOne({ externalId: req.params.id });
  if (!account) {
    res.status(404).json({ message: 'Account not found' });
    return;
  }

  const parsed = parseInt((req.query.limit as string) ?? '5', 10);
  const limit = Math.min(100, Math.max(1, Number.isFinite(parsed) && parsed > 0 ? parsed : 5));

  try {
    const payload = await scrapeAndPersistPosts(account, limit);
    res.json(payload);
  } catch (err) {
    res.status(502).json({ message: 'Posts scrape failed', error: err instanceof Error ? err.message : 'Unknown error' });
  }
}

/**
 * POST /instagram-accounts/:id/scrape/reels — Downloads, compresses and transcribes Reels via Whisper, then saves to DB and S3.
 */
export async function scrapeAccountReels(req: Request, res: Response): Promise<void> {
  const account = await InstagramAccount.findOne({ externalId: req.params.id });
  if (!account) {
    res.status(404).json({ message: 'Account not found' });
    return;
  }

  const parsed = parseInt((req.query.limit as string) ?? '5', 10);
  const limit = Math.min(20, Math.max(1, Number.isFinite(parsed) && parsed > 0 ? parsed : 5));

  try {
    const payload = await scrapeAndPersistReels(account, limit);
    res.json(payload);
  } catch (err) {
    res.status(502).json({ message: 'Reels scrape failed', error: err instanceof Error ? err.message : 'Unknown error' });
  }
}

/**
 * POST /instagram-accounts/:id/analyze — Uses GPT to analyze the content strategy of an account based on its synced posts.
 */
export async function analyzeAccountContent(req: Request, res: Response): Promise<void> {
  const account = await InstagramAccount.findOne({ externalId: req.params.id });
  if (!account) {
    res.status(404).json({ message: 'Account not found' });
    return;
  }

  const posts = await Post.find({ accountId: account._id }).sort({ postedAt: -1 }).limit(30);

  if (posts.length === 0) {
    res.status(400).json({ message: 'No posts found. Run sync first.' });
    return;
  }

  try {
    const analysis = await analyzeAccount(
      account.handle,
      posts.map((p) => ({ caption: p.title, likes: p.likes, comments: p.comments, format: p.format })),
    );

    res.json({ handle: account.handle, postsAnalyzed: posts.length, analysis });
  } catch (err) {
    res.status(502).json({ message: 'Analysis failed', error: err instanceof Error ? err.message : 'Unknown error' });
  }
}


/**
 * POST /instagram-accounts/:id/sync — Syncs followers and posts via Apify Instagram scraper.
 */
export async function syncAccount(req: Request, res: Response): Promise<void> {
  const account = await InstagramAccount.findOne({ externalId: req.params.id });
  if (!account) {
    res.status(404).json({ message: 'Account not found' });
    return;
  }

  try {
    const data = await syncInstagramAccount(account);
    res.json({
      message: 'Sync complete',
      followers: data.followers,
      syncedPosts: data.syncedPosts,
      lastSyncAt: data.lastSyncAt,
    });
  } catch (err) {
    res.status(502).json({ message: 'Sync failed', error: err instanceof Error ? err.message : 'Unknown error' });
  }
}

/**
 * POST /instagram-accounts/:id/scrape/stories — Scrapes current stories via Apify, uploads media to S3, and transcribes content.
 */
export async function scrapeAccountStories(req: Request, res: Response): Promise<void> {
  const account = await InstagramAccount.findOne({ externalId: req.params.id });
  if (!account) {
    res.status(404).json({ message: 'Account not found' });
    return;
  }

  try {
    const payload = await scrapeAndPersistStories(account);
    res.json(payload);
  } catch (err) {
    res.status(502).json({ message: 'Stories scrape failed', error: err instanceof Error ? err.message : 'Unknown error' });
  }
}

/**
 * POST /instagram-accounts/:id/branding/profile-pic — Uploads a profile picture to S3 and saves the URL.
 */
export async function uploadProfilePic(req: Request, res: Response): Promise<void> {
  const account = await InstagramAccount.findOne({ externalId: req.params.id });
  if (!account) { res.status(404).json({ message: 'Account not found' }); return; }

  const file = req.file;
  if (!file) { res.status(400).json({ message: 'No file uploaded (field: file)' }); return; }

  const ext = file.mimetype.split('/')[1] ?? 'jpg';
  const key = `branding/${account.handle}/profile-pic.${ext}`;

  const url = await uploadBuffer(file.buffer, key, file.mimetype);
  if (!url) { res.status(502).json({ message: 'S3 upload failed or AWS_S3_BUCKET not configured' }); return; }

  account.profilePicS3Url = url;
  await account.save();

  res.json({ profilePicS3Url: url });
}

/**
 * PATCH /instagram-accounts/:id/branding/colors — Sets the brand color palette (array of hex strings).
 */
export async function updateBrandColors(req: Request, res: Response): Promise<void> {
  const account = await InstagramAccount.findOne({ externalId: req.params.id });
  if (!account) { res.status(404).json({ message: 'Account not found' }); return; }

  const { colors } = req.body as { colors?: unknown };
  if (!Array.isArray(colors) || colors.some((c) => typeof c !== 'string')) {
    res.status(400).json({ message: 'colors must be an array of strings' });
    return;
  }

  account.brandColors = colors as string[];
  await account.save();

  res.json({ brandColors: account.brandColors });
}

/**
 * POST /instagram-accounts/:id/branding/reference-images — Uploads one or more reference images to S3.
 * Appends the new URLs to the existing list.
 */
export async function uploadReferenceImages(req: Request, res: Response): Promise<void> {
  const account = await InstagramAccount.findOne({ externalId: req.params.id });
  if (!account) { res.status(404).json({ message: 'Account not found' }); return; }

  const files = req.files as Express.Multer.File[] | undefined;
  if (!files?.length) { res.status(400).json({ message: 'No files uploaded (field: files)' }); return; }

  const uploaded = await Promise.all(
    files.map(async (file, i) => {
      const ext = file.mimetype.split('/')[1] ?? 'jpg';
      const key = `branding/${account.handle}/ref_${Date.now()}_${i}.${ext}`;
      return uploadBuffer(file.buffer, key, file.mimetype);
    }),
  );

  const newUrls = uploaded.filter((u): u is string => u !== null);
  account.referenceImages = [...account.referenceImages, ...newUrls];
  await account.save();

  res.json({ added: newUrls.length, referenceImages: account.referenceImages });
}

/**
 * DELETE /instagram-accounts/:id/branding/reference-images — Removes a reference image URL from the list.
 */
export async function deleteReferenceImage(req: Request, res: Response): Promise<void> {
  const account = await InstagramAccount.findOne({ externalId: req.params.id });
  if (!account) { res.status(404).json({ message: 'Account not found' }); return; }

  const { url } = req.body as { url?: string };
  if (!url) { res.status(400).json({ message: 'url is required' }); return; }

  account.referenceImages = account.referenceImages.filter((u) => u !== url);
  await account.save();

  res.json({ referenceImages: account.referenceImages });
}

export async function uploadBrandPostImages(req: Request, res: Response): Promise<void> {
  const account = await InstagramAccount.findOne({ externalId: req.params.id });
  if (!account) { res.status(404).json({ message: 'Account not found' }); return; }

  const files = req.files as Express.Multer.File[] | undefined;
  if (!files?.length) { res.status(400).json({ message: 'No files uploaded (field: files)' }); return; }

  const uploaded = await Promise.all(
    files.map(async (file, i) => {
      const ext = file.mimetype.split('/')[1] ?? 'jpg';
      const key = `branding/${account.handle}/post_${Date.now()}_${i}.${ext}`;
      return uploadBuffer(file.buffer, key, file.mimetype);
    }),
  );

  const newUrls = uploaded.filter((u): u is string => u !== null);
  account.brandPostImages = [...(account.brandPostImages ?? []), ...newUrls];
  await account.save();

  res.json({ added: newUrls.length, brandPostImages: account.brandPostImages });
}

export async function deleteBrandPostImage(req: Request, res: Response): Promise<void> {
  const account = await InstagramAccount.findOne({ externalId: req.params.id });
  if (!account) { res.status(404).json({ message: 'Account not found' }); return; }

  const { url } = req.body as { url?: string };
  if (!url) { res.status(400).json({ message: 'url is required' }); return; }

  account.brandPostImages = (account.brandPostImages ?? []).filter((u) => u !== url);
  await account.save();

  res.json({ brandPostImages: account.brandPostImages });
}

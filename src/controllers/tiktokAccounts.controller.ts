import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { TikTokAccount } from '../models/TikTokAccount';
import { TikTokPost } from '../models/TikTokPost';
import { scrapeTikTokProfile, scrapeTikTokPosts } from '../services/apifyTikTok';
import { uploadImageFromUrl } from '../services/s3';
import { analyseImage } from '../services/visionAnalysis';

/**
 * Maps a TikTokAccount document to the API response shape.
 */
function toResponse(account: InstanceType<typeof TikTokAccount>) {
  return {
    id: account.externalId,
    handle: account.handle,
    displayName: account.displayName,
    profileUrl: account.profileUrl,
    followers: account.followers,
    following: account.following,
    likesCount: account.likesCount,
    workspace: account.workspace,
    isVerified: account.isVerified,
    profilePicUrl: account.profilePicUrl ?? null,
    lastSyncAt: account.lastSyncAt ?? null,
  };
}

/**
 * GET /tiktok-accounts — Paginates TikTok accounts filtered by workspace.
 */
export async function listTikTokAccounts(req: Request, res: Response): Promise<void> {
  const { workspace, page = '1', limit = '20' } = req.query as Record<string, string>;

  const filter: Record<string, unknown> = {};
  if (workspace) filter.workspace = workspace;

  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const skip = (pageNum - 1) * limitNum;

  const [accounts, total] = await Promise.all([
    TikTokAccount.find(filter).sort({ lastSyncAt: -1 }).skip(skip).limit(limitNum),
    TikTokAccount.countDocuments(filter),
  ]);

  res.json({
    data: accounts.map(toResponse),
    total,
    page: pageNum,
    limit: limitNum,
    pages: Math.ceil(total / limitNum),
  });
}

/**
 * GET /tiktok-accounts/posts — Paginates TikTok posts across all accounts with embedded account info.
 * Filters: accountId (handle), workspace, dateFrom, dateTo.
 */
export async function listTikTokPosts(req: Request, res: Response): Promise<void> {
  const {
    accountId,
    workspace,
    dateFrom,
    dateTo,
    page = '1',
    limit = '20',
  } = req.query as Record<string, string>;

  const filter: Record<string, unknown> = {};

  if (accountId) {
    const account = await TikTokAccount.findOne({ externalId: accountId });
    if (!account) {
      res.json({ data: [], total: 0, page: 1, limit: Number(limit), pages: 0 });
      return;
    }
    filter.accountId = account._id;
  } else if (workspace) {
    const accounts = await TikTokAccount.find({ workspace }, { _id: 1 });
    filter.accountId = { $in: accounts.map((a) => a._id) };
  }

  if (dateFrom || dateTo) {
    filter.postedAt = {};
    if (dateFrom) (filter.postedAt as Record<string, unknown>).$gte = new Date(dateFrom);
    if (dateTo) (filter.postedAt as Record<string, unknown>).$lte = new Date(dateTo);
  }

  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const skip = (pageNum - 1) * limitNum;

  const [posts, total] = await Promise.all([
    TikTokPost.aggregate([
      { $match: filter },
      { $addFields: { _hasTranscript: { $cond: [{ $gt: ['$transcript', ''] }, 1, 0] } } },
      { $sort: { _hasTranscript: -1, postedAt: -1 } },
      { $skip: skip },
      { $limit: limitNum },
    ]),
    TikTokPost.countDocuments(filter),
  ]);

  const accountIds = [...new Set(posts.map((p) => p.accountId.toString()))];
  const accounts = await TikTokAccount.find({
    _id: { $in: accountIds.map((id) => new Types.ObjectId(id)) },
  });
  const accountMap = new Map(accounts.map((a) => [a._id.toString(), a]));

  res.json({
    data: posts.map((post) => {
      const account = accountMap.get(post.accountId.toString());
      return {
        id: post._id.toString(),
        tiktokPostId: post.tiktokPostId,
        title: post.title,
        postedAt: post.postedAt ?? null,
        thumbnailUrl: post.thumbnailUrl ?? null,
        videoUrl: post.videoUrl ?? null,
        transcript: post.transcript ?? null,
        likes: post.likes,
        comments: post.comments,
        shares: post.shares,
        views: post.views,
        postUrl: post.postUrl,
        hashtags: post.hashtags,
        syncedAt: post.syncedAt,
        account: account ? toResponse(account) : null,
      };
    }),
    total,
    page: pageNum,
    limit: limitNum,
    pages: Math.ceil(total / limitNum),
  });
}

/**
 * GET /tiktok-accounts/:id — Returns a single TikTok account by handle.
 */
export async function getTikTokAccount(req: Request, res: Response): Promise<void> {
  const account = await TikTokAccount.findOne({ externalId: req.params.id });
  if (!account) {
    res.status(404).json({ message: 'Account not found' });
    return;
  }
  res.json(toResponse(account));
}

/**
 * POST /tiktok-accounts/discover — Scrapes a public TikTok profile via Apify and saves it to the database.
 */
export async function discoverTikTokAccount(req: Request, res: Response): Promise<void> {
  const { handle, workspace } = req.body as { handle?: string; workspace?: string };

  if (!handle || !workspace) {
    res.status(400).json({ message: 'handle and workspace are required' });
    return;
  }

  const existing = await TikTokAccount.findOne({ externalId: handle });
  if (existing) {
    res.status(409).json({ message: 'Account already exists', account: toResponse(existing) });
    return;
  }

  try {
    const profile = await scrapeTikTokProfile(handle);

    const account = await TikTokAccount.create({
      externalId: handle,
      handle,
      displayName: profile.displayName || handle,
      profileUrl: `https://www.tiktok.com/@${handle}`,
      followers: profile.followers,
      following: profile.following,
      likesCount: profile.likesCount,
      isVerified: profile.isVerified,
      profilePicUrl: profile.profilePicUrl ?? undefined,
      workspace,
      lastSyncAt: new Date(),
    });

    res.status(201).json(toResponse(account));
  } catch (err) {
    res.status(502).json({ message: 'Failed to scrape TikTok profile', error: err instanceof Error ? err.message : 'Unknown error' });
  }
}

/**
 * DELETE /tiktok-accounts/:id — Removes a TikTok account by handle (admin only).
 */
export async function deleteTikTokAccount(req: Request, res: Response): Promise<void> {
  const account = await TikTokAccount.findOneAndDelete({ externalId: req.params.id });
  if (!account) {
    res.status(404).json({ message: 'Account not found' });
    return;
  }
  res.status(204).send();
}

/**
 * POST /tiktok-accounts/:id/scrape/posts — Scrapes recent TikTok posts via Apify,
 * uploads thumbnails/videos to S3, transcribes video audio with Whisper, and upserts to DB.
 */
export async function scrapeTikTokAccountPosts(req: Request, res: Response): Promise<void> {
  const account = await TikTokAccount.findOne({ externalId: req.params.id });
  if (!account) {
    res.status(404).json({ message: 'Account not found' });
    return;
  }

  const limit = Math.min(50, parseInt((req.query.limit as string) ?? '30'));

  try {
    const posts = await scrapeTikTokPosts(account.handle, limit);

    const upserted = await Promise.all(
      posts.map(async (post) => {
        try {
          const thumbnailUrl = post.thumbnailUrl
            ? await uploadImageFromUrl(post.thumbnailUrl, `tiktok/${account.handle}/${post.id}_thumb.jpg`)
            : null;

          const transcript = thumbnailUrl
            ? await analyseImage(thumbnailUrl).catch(() => null)
            : null;

          return TikTokPost.findOneAndUpdate(
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
          console.error(`[tiktok] Failed to process post ${post.id}:`, err instanceof Error ? err.message : err);
          return null;
        }
      }),
    );

    account.lastSyncAt = new Date();
    await account.save();

    const succeeded = upserted.filter(Boolean).length;

    res.json({
      total: posts.length,
      saved: succeeded,
      posts: posts.map((post) => {
        const saved = upserted.find((u) => u?.tiktokPostId === post.id);
        return {
          id: post.id,
          text: post.text,
          postUrl: post.postUrl,
          likes: post.likes,
          comments: post.comments,
          shares: post.shares,
          views: post.views,
          hashtags: post.hashtags,
          thumbnailUrl: saved?.thumbnailUrl ?? null,
          transcript: saved?.transcript ?? null,
        };
      }),
    });
  } catch (err) {
    res.status(502).json({ message: 'TikTok posts scrape failed', error: err instanceof Error ? err.message : 'Unknown error' });
  }
}

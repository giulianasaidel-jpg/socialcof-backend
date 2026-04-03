import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { InstagramStory } from '../models/InstagramStory';
import { InstagramAccount } from '../models/InstagramAccount';

/**
 * Maps an InstagramStory document and its parent account to the API response shape.
 */
function toResponse(
  story: InstanceType<typeof InstagramStory>,
  account: InstanceType<typeof InstagramAccount> | undefined,
) {
  return {
    id: story._id.toString(),
    storyId: story.storyId,
    mediaType: story.mediaType,
    thumbnailUrl: story.thumbnailUrl ?? null,
    videoUrl: story.videoUrl ?? null,
    transcript: story.transcript ?? null,
    postedAt: story.postedAt ?? null,
    syncedAt: story.syncedAt,
    expiresAt: story.expiresAt,
    account: account
      ? {
          id: account.externalId,
          handle: account.handle,
          displayName: account.displayName,
          profileUrl: account.profileUrl,
          profilePicS3Url: account.profilePicS3Url ?? null,
          followers: account.followers,
          workspace: account.workspace,
        }
      : null,
  };
}

/**
 * GET /instagram-stories — Paginates stories with embedded account info.
 * Filters: accountId (handle), workspace, mediaType, dateFrom, dateTo.
 */
export async function listInstagramStories(req: Request, res: Response): Promise<void> {
  const {
    accountId,
    workspace,
    mediaType,
    dateFrom,
    dateTo,
    page = '1',
    limit = '20',
  } = req.query as Record<string, string>;

  const filter: Record<string, unknown> = {};

  if (accountId) {
    const account = await InstagramAccount.findOne({ externalId: accountId });
    if (!account) {
      res.json({ data: [], total: 0, page: 1, limit: Number(limit) });
      return;
    }
    filter.accountId = account._id;
  } else if (workspace) {
    const accounts = await InstagramAccount.find({ workspace }, { _id: 1 });
    if (!accounts.length) {
      res.json({ data: [], total: 0, page: 1, limit: Number(limit), pages: 0 });
      return;
    }
    filter.accountId = { $in: accounts.map((a) => a._id) };
  }

  if (mediaType === 'image' || mediaType === 'video') {
    filter.mediaType = mediaType;
  }

  if (dateFrom || dateTo) {
    filter.syncedAt = {};
    if (dateFrom) (filter.syncedAt as Record<string, unknown>).$gte = new Date(dateFrom);
    if (dateTo) (filter.syncedAt as Record<string, unknown>).$lte = new Date(dateTo);
  }

  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const skip = (pageNum - 1) * limitNum;

  const [stories, total] = await Promise.all([
    InstagramStory.aggregate([
      { $match: filter },
      { $addFields: { _hasTranscript: { $cond: [{ $gt: ['$transcript', ''] }, 1, 0] } } },
      { $sort: { _hasTranscript: -1, syncedAt: -1 } },
      { $skip: skip },
      { $limit: limitNum },
    ]),
    InstagramStory.countDocuments(filter),
  ]);

  const accountIds = [...new Set(stories.map((s) => s.accountId.toString()))];
  const accounts = await InstagramAccount.find({
    _id: { $in: accountIds.map((id) => new Types.ObjectId(id)) },
  });
  const accountMap = new Map(accounts.map((a) => [a._id.toString(), a]));

  res.json({
    data: stories.map((s) => toResponse(s, accountMap.get(s.accountId.toString()))),
    total,
    page: pageNum,
    limit: limitNum,
    pages: Math.ceil(total / limitNum),
  });
}

import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { Post } from '../models/Post';
import { InstagramAccount } from '../models/InstagramAccount';

/**
 * Maps a Post document to the API response shape.
 */
function toResponse(post: InstanceType<typeof Post>, externalId: string) {
  return {
    id: post._id.toString(),
    accountId: externalId,
    title: post.title,
    postedAt: post.postedAt,
    format: post.format,
    likes: post.likes,
    comments: post.comments,
    saves: post.saves,
    reposts: post.reposts,
    forwards: post.forwards,
  };
}

/**
 * GET /posts — Lists posts with pagination and filters by accountId, dateFrom, dateTo, format.
 */
export async function listPosts(req: Request, res: Response): Promise<void> {
  const { accountId, dateFrom, dateTo, format, page = '1', limit = '50' } = req.query as Record<string, string>;

  const filter: Record<string, unknown> = {};

  if (accountId) {
    const account = await InstagramAccount.findOne({ externalId: accountId });
    if (!account) {
      res.json({ data: [], total: 0, page: 1, limit: Number(limit) });
      return;
    }
    filter.accountId = account._id;
  }

  if (dateFrom || dateTo) {
    filter.postedAt = {};
    if (dateFrom) (filter.postedAt as Record<string, unknown>).$gte = new Date(dateFrom);
    if (dateTo) (filter.postedAt as Record<string, unknown>).$lte = new Date(dateTo);
  }

  if (format) filter.format = format;

  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const skip = (pageNum - 1) * limitNum;

  const [posts, total] = await Promise.all([
    Post.find(filter).sort({ postedAt: -1 }).skip(skip).limit(limitNum),
    Post.countDocuments(filter),
  ]);

  const accountIds = [...new Set(posts.map((p) => p.accountId.toString()))];
  const accounts = await InstagramAccount.find({ _id: { $in: accountIds.map((id) => new Types.ObjectId(id)) } });
  const accountMap = new Map(accounts.map((a) => [a._id.toString(), a.externalId]));

  res.json({
    data: posts.map((p) => toResponse(p, accountMap.get(p.accountId.toString()) ?? '')),
    total,
    page: pageNum,
    limit: limitNum,
  });
}

/**
 * GET /posts/:id — Returns a single post by MongoDB _id.
 */
export async function getPost(req: Request, res: Response): Promise<void> {
  const post = await Post.findById(req.params.id).populate<{ accountId: InstanceType<typeof InstagramAccount> }>('accountId');
  if (!post) {
    res.status(404).json({ message: 'Post not found' });
    return;
  }
  const account = post.accountId as unknown as InstanceType<typeof InstagramAccount>;
  res.json(toResponse(post as unknown as InstanceType<typeof Post>, account?.externalId ?? ''));
}

/**
 * POST /posts — Creates a new post manually.
 */
export async function createPost(req: Request, res: Response): Promise<void> {
  const { accountId, ...rest } = req.body;

  const account = await InstagramAccount.findOne({ externalId: accountId });
  if (!account) {
    res.status(400).json({ message: 'Instagram account not found' });
    return;
  }

  const post = await Post.create({ ...rest, accountId: account._id });
  res.status(201).json(toResponse(post, accountId));
}

/**
 * PATCH /posts/:id — Updates metrics or status of a post.
 */
export async function updatePost(req: Request, res: Response): Promise<void> {
  const post = await Post.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true });
  if (!post) {
    res.status(404).json({ message: 'Post not found' });
    return;
  }

  const account = await InstagramAccount.findById(post.accountId);
  res.json(toResponse(post, account?.externalId ?? ''));
}

/**
 * DELETE /posts/:id — Removes a post.
 */
export async function deletePost(req: Request, res: Response): Promise<void> {
  const post = await Post.findByIdAndDelete(req.params.id);
  if (!post) {
    res.status(404).json({ message: 'Post not found' });
    return;
  }
  res.status(204).send();
}

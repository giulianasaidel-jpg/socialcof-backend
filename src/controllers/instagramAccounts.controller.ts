import { Request, Response } from 'express';
import { InstagramAccount } from '../models/InstagramAccount';
import { InstagramSyncLog } from '../models/InstagramSyncLog';
import { Post } from '../models/Post';
import { scrapeProfile, scrapeRecentPosts, toPostFormat } from '../services/apifyInstagram';
import { analyzeAccount } from '../services/gptAnalysis';

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

/**
 * POST /instagram-accounts/discover — Scrapes a public Instagram profile via Apify and saves it to the database.
 */
export async function discoverAccount(req: Request, res: Response): Promise<void> {
  const { handle, workspace } = req.body as { handle?: string; workspace?: string };

  if (!handle || !workspace) {
    res.status(400).json({ message: 'handle and workspace are required' });
    return;
  }

  const existing = await InstagramAccount.findOne({ externalId: handle });
  if (existing) {
    res.status(409).json({ message: 'Account already exists', account: toResponse(existing) });
    return;
  }

  try {
    const profile = await scrapeProfile(handle);

    const account = await InstagramAccount.create({
      externalId: handle,
      handle,
      displayName: profile.fullName || handle,
      profileUrl: `https://instagram.com/${handle}`,
      followers: profile.followersCount,
      workspace,
      status: 'conectado',
      ingestEnabled: true,
      lastSyncAt: new Date(),
    });

    res.status(201).json(toResponse(account));
  } catch (err) {
    res.status(502).json({ message: 'Failed to scrape profile', error: err instanceof Error ? err.message : 'Unknown error' });
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
 * PATCH /instagram-accounts/:id — Updates an account by externalId.
 */
export async function updateAccount(req: Request, res: Response): Promise<void> {
  const account = await InstagramAccount.findOneAndUpdate(
    { externalId: req.params.id },
    { $set: req.body },
    { new: true },
  );
  if (!account) {
    res.status(404).json({ message: 'Account not found' });
    return;
  }
  res.json(toResponse(account));
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
    const profile = await scrapeProfile(account.handle);

    account.followers = profile.followersCount;
    account.displayName = profile.fullName || account.displayName;
    account.lastSyncAt = new Date();
    await account.save();

    res.json({
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
    });
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

  const limit = Math.min(100, parseInt((req.query.limit as string) ?? '50'));

  try {
    const posts = await scrapeRecentPosts(account.handle, limit);

    const upserted = await Promise.all(
      posts.map((post) => {
        const title = post.caption?.split('\n')[0]?.slice(0, 200) ?? post.shortCode;
        return Post.findOneAndUpdate(
          { instagramPostId: post.id },
          {
            $set: {
              accountId: account._id,
              instagramPostId: post.id,
              title,
              postedAt: post.timestamp ? new Date(post.timestamp) : new Date(),
              format: toPostFormat(post.type),
              likes: post.likesCount,
              comments: post.commentsCount,
              syncedAt: new Date(),
            },
          },
          { upsert: true, new: true },
        );
      }),
    );

    account.lastSyncAt = new Date();
    await account.save();

    res.json({
      total: upserted.length,
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
      })),
    });
  } catch (err) {
    res.status(502).json({ message: 'Posts scrape failed', error: err instanceof Error ? err.message : 'Unknown error' });
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

  let syncedCount = 0;

  try {
    const [profile, posts] = await Promise.all([
      scrapeProfile(account.handle),
      scrapeRecentPosts(account.handle, 50),
    ]);

    account.followers = profile.followersCount;

    for (const post of posts) {
      const title = post.caption?.split('\n')[0]?.slice(0, 200) ?? post.shortCode;

      await Post.findOneAndUpdate(
        { instagramPostId: post.id },
        {
          $set: {
            accountId: account._id,
            instagramPostId: post.id,
            title,
            postedAt: new Date(post.timestamp),
            format: toPostFormat(post.type),
            likes: post.likesCount,
            comments: post.commentsCount,
            syncedAt: new Date(),
          },
        },
        { upsert: true, new: true },
      );

      syncedCount++;
    }

    account.lastSyncAt = new Date();
    await account.save();

    await InstagramSyncLog.create({
      accountId: account._id,
      at: new Date(),
      level: 'ok',
      message: `Synced ${syncedCount} posts via Apify`,
    });

    res.json({ message: 'Sync complete', followers: account.followers, syncedPosts: syncedCount, lastSyncAt: account.lastSyncAt });
  } catch (err) {
    await InstagramSyncLog.create({
      accountId: account._id,
      at: new Date(),
      level: 'erro',
      message: err instanceof Error ? err.message : 'Unknown error',
    });

    res.status(502).json({ message: 'Sync failed', error: err instanceof Error ? err.message : 'Unknown error' });
  }
}

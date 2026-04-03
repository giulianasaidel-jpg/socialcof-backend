import { Request, Response } from 'express';
import { InstagramAccount } from '../models/InstagramAccount';
import { InstagramSyncLog } from '../models/InstagramSyncLog';
import { InstagramStory } from '../models/InstagramStory';
import { Post } from '../models/Post';
import { scrapeProfile, scrapeRecentPosts, scrapeStories, toPostFormat } from '../services/apifyInstagram';
import { uploadImageFromUrl, uploadCarouselImages, uploadBuffer } from '../services/s3';
import { processReel } from '../services/videoProcessor';
import { analyseImage, analyseCarousel } from '../services/visionAnalysis';
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
    profilePicS3Url: account.profilePicS3Url ?? null,
    brandColors: account.brandColors ?? [],
    referenceImages: account.referenceImages ?? [],
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
      posts.map(async (post) => {
        const title = post.caption?.split('\n')[0]?.slice(0, 200) ?? post.shortCode;
        const thumbnailUrl =
          post.displayUrl && post.type !== 'Video'
            ? await uploadImageFromUrl(post.displayUrl, `instagram/${account.handle}/${post.id}.jpg`).catch((err) => {
                console.error(`[s3] upload failed for ${post.id}:`, err.message);
                return null;
              })
            : null;

        const carouselImages =
          post.type === 'Sidecar' && post.carouselDisplayUrls.length
            ? await uploadCarouselImages(post.carouselDisplayUrls, account.handle, post.id)
            : [];

        const transcript = await (async () => {
          if (post.type === 'Sidecar' && carouselImages.length) {
            return analyseCarousel(carouselImages).catch(() => null);
          }
          if (post.type === 'Image' && thumbnailUrl) {
            return analyseImage(thumbnailUrl).catch(() => null);
          }
          return null;
        })();

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
              postUrl: post.url ?? `https://www.instagram.com/p/${post.shortCode}/`,
              ...(thumbnailUrl && { thumbnailUrl }),
              ...(carouselImages.length && { carouselImages }),
              ...(transcript && { transcript }),
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
        thumbnailUrl: upserted.find((u) => u?.instagramPostId === post.id)?.thumbnailUrl ?? null,
        carouselImages: upserted.find((u) => u?.instagramPostId === post.id)?.carouselImages ?? [],
      })),
    });
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

  const limit = Math.min(20, parseInt((req.query.limit as string) ?? '10'));

  try {
    const posts = await scrapeRecentPosts(account.handle, limit);
    const reels = posts.filter((p) => p.type === 'Video' && p.videoUrl);

    const results = await Promise.all(
      reels.map(async (post) => {
        try {
          const { s3VideoUrl, transcript } = await processReel(post.videoUrl!, account.handle, post.id);
          const title = post.caption?.split('\n')[0]?.slice(0, 200) ?? post.shortCode;

          await Post.findOneAndUpdate(
            { instagramPostId: post.id },
            {
              $set: {
                accountId: account._id,
                instagramPostId: post.id,
                title,
                postedAt: post.timestamp ? new Date(post.timestamp) : new Date(),
                format: 'Reels',
                likes: post.likesCount,
                comments: post.commentsCount,
                postUrl: post.url ?? `https://www.instagram.com/p/${post.shortCode}/`,
                ...(s3VideoUrl && { videoUrl: s3VideoUrl }),
                ...(transcript && { transcript }),
                syncedAt: new Date(),
              },
            },
            { upsert: true, new: true },
          );

          return { id: post.id, shortCode: post.shortCode, s3VideoUrl, transcript, status: 'ok' };
        } catch (err) {
          return { id: post.id, shortCode: post.shortCode, status: 'failed', error: err instanceof Error ? err.message : 'Unknown error' };
        }
      }),
    );

    account.lastSyncAt = new Date();
    await account.save();

    res.json({ total: reels.length, reels: results });
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

  let syncedCount = 0;

  try {
    const [profile, posts] = await Promise.all([
      scrapeProfile(account.handle),
      scrapeRecentPosts(account.handle, 50),
    ]);

    account.followers = profile.followersCount;

    for (const post of posts) {
      const title = post.caption?.split('\n')[0]?.slice(0, 200) ?? post.shortCode;
      const thumbnailUrl =
        post.displayUrl && post.type !== 'Video'
          ? await uploadImageFromUrl(post.displayUrl, `instagram/${account.handle}/${post.id}.jpg`).catch(() => null)
          : null;

      const carouselImages =
        post.type === 'Sidecar' && post.carouselDisplayUrls.length
          ? await uploadCarouselImages(post.carouselDisplayUrls, account.handle, post.id)
          : [];

      const transcript = await (async () => {
        if (post.type === 'Sidecar' && carouselImages.length) {
          return analyseCarousel(carouselImages).catch(() => null);
        }
        if (post.type === 'Image' && thumbnailUrl) {
          return analyseImage(thumbnailUrl).catch(() => null);
        }
        return null;
      })();

      await Post.findOneAndUpdate(
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
            postUrl: post.url ?? `https://www.instagram.com/p/${post.shortCode}/`,
            ...(thumbnailUrl && { thumbnailUrl }),
            ...(carouselImages.length && { carouselImages }),
            ...(transcript && { transcript }),
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
    const stories = await scrapeStories(account.handle);
    const syncedAt = new Date();
    const expiresAt = new Date(syncedAt.getTime() + 24 * 60 * 60 * 1000);

    const results = await Promise.all(
      stories.map(async (story) => {
        try {
          let thumbnailUrl: string | null = null;
          let s3VideoUrl: string | null = null;
          let transcript: string | null = null;

          if (story.mediaType === 'image' && story.displayUrl) {
            thumbnailUrl = await uploadImageFromUrl(
              story.displayUrl,
              `instagram/${account.handle}/stories/${story.id}.jpg`,
            ).catch(() => null);

            const imageForAnalysis = thumbnailUrl ?? story.displayUrl;
            transcript = await analyseImage(imageForAnalysis).catch(() => null);
          }

          if (story.mediaType === 'video' && story.videoUrl) {
            const processed = await processReel(
              story.videoUrl,
              account.handle,
              `story_${story.id}`,
            ).catch(() => ({ s3VideoUrl: null, transcript: null as string | null }));

            s3VideoUrl = processed.s3VideoUrl;
            transcript = processed.transcript || null;
          }

          await InstagramStory.findOneAndUpdate(
            { storyId: story.id },
            {
              $set: {
                accountId: account._id,
                storyId: story.id,
                handle: account.handle,
                mediaType: story.mediaType,
                ...(thumbnailUrl && { thumbnailUrl }),
                ...(s3VideoUrl && { videoUrl: s3VideoUrl }),
                ...(transcript && { transcript }),
                postedAt: story.timestamp ? new Date(story.timestamp) : undefined,
                syncedAt,
                expiresAt,
              },
            },
            { upsert: true, new: true },
          );

          return { id: story.id, mediaType: story.mediaType, thumbnailUrl, videoUrl: s3VideoUrl, status: 'ok' };
        } catch (err) {
          return { id: story.id, mediaType: story.mediaType, status: 'failed', error: err instanceof Error ? err.message : 'Unknown error' };
        }
      }),
    );

    res.json({ total: stories.length, stories: results });
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

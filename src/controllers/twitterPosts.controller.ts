import { Request, Response } from 'express';
import { TwitterLikePost } from '../models/TwitterLikePost';
import { InstagramAccount } from '../models/InstagramAccount';
import { Product } from '../models/Product';
import { Post } from '../models/Post';
import { MedicalNews } from '../models/MedicalNews';
import { TikTokPost } from '../models/TikTokPost';
import { InstagramStory } from '../models/InstagramStory';
import { generateSlidesFromSource, buildCarouselHtmls } from '../services/twitterPostGenerator';
import { streamSlidesAsZip, streamSlideAsPng } from '../services/slideExporter';
import type { DisplayMode, ITwitterLikePost } from '../models/TwitterLikePost';

function toResponse(doc: InstanceType<typeof TwitterLikePost>) {
  return {
    id: doc._id.toString(),
    mode: doc.mode,
    bodyFontSize: doc.bodyFontSize,
    profileName: doc.profileName,
    profileHandle: doc.profileHandle,
    profileImageUrl: doc.profileImageUrl,
    slides: doc.slides,
    slideHtmls: doc.slideHtmls,
    caption: doc.caption ?? '',
    sourceTranscript: doc.sourceTranscript,
    sourceCaption: doc.sourceCaption,
    sourceNewsId: doc.sourceNewsId?.toString() ?? null,
    sourceTikTokPostId: doc.sourceTikTokPostId?.toString() ?? null,
    sourceInstagramStoryId: doc.sourceInstagramStoryId?.toString() ?? null,
    status: doc.status,
    generatedAt: doc.generatedAt,
    createdAt: doc.createdAt,
  };
}

/**
 * GET /twitter-posts — Lists all twitter-like posts for an account.
 */
export async function listTwitterPosts(req: Request, res: Response): Promise<void> {
  const { accountId } = req.query as Record<string, string>;

  const filter: Record<string, unknown> = {};
  if (accountId) {
    const account = await InstagramAccount.findOne({ externalId: accountId });
    if (!account) { res.status(404).json({ message: 'Account not found' }); return; }
    filter.accountId = account._id;
  }

  const posts = await TwitterLikePost.find(filter).sort({ createdAt: -1 });
  res.json(posts.map(toResponse));
}

/**
 * GET /twitter-posts/:id — Returns a single twitter-like post.
 */
export async function getTwitterPost(req: Request, res: Response): Promise<void> {
  const post = await TwitterLikePost.findById(req.params.id);
  if (!post) { res.status(404).json({ message: 'TwitterLikePost not found' }); return; }
  res.json(toResponse(post));
}

/**
 * PATCH /twitter-posts/:id — Updates slides, status, or profile info.
 * When slides or any style field changes, regenerates all slideHtmls automatically.
 */
export async function updateTwitterPost(req: Request, res: Response): Promise<void> {
  const post = await TwitterLikePost.findById(req.params.id);
  if (!post) { res.status(404).json({ message: 'TwitterLikePost not found' }); return; }

  const {
    slides,
    mode,
    bodyFontSize,
    profileName,
    profileHandle,
    profileImageUrl,
    status,
  } = req.body as {
    slides?: string[];
    mode?: DisplayMode;
    bodyFontSize?: number;
    profileName?: string;
    profileHandle?: string;
    profileImageUrl?: string;
    status?: string;
  };

  if (slides !== undefined) post.slides = slides;
  if (mode !== undefined) post.mode = mode;
  if (bodyFontSize !== undefined) post.bodyFontSize = bodyFontSize;
  if (profileName !== undefined) post.profileName = profileName;
  if (profileHandle !== undefined) post.profileHandle = profileHandle;
  if (profileImageUrl !== undefined) post.profileImageUrl = profileImageUrl;
  if (status !== undefined) post.status = status as ITwitterLikePost['status'];

  const styleChanged = slides !== undefined || mode !== undefined || bodyFontSize !== undefined || profileName !== undefined || profileHandle !== undefined || profileImageUrl !== undefined;

  if (styleChanged) {
    const account = await InstagramAccount.findById(post.accountId);
    post.slideHtmls = await buildCarouselHtmls({
      texts: post.slides,
      mode: post.mode,
      bodyFontSize: post.bodyFontSize,
      profileName: post.profileName,
      profileHandle: post.profileHandle,
      profileImageUrl: post.profileImageUrl,
      brandingProfilePicUrl: account?.profilePicS3Url ?? undefined,
    });
  }

  await post.save();
  res.json(toResponse(post));
}

/**
 * DELETE /twitter-posts/:id — Removes a twitter-like post.
 */
export async function deleteTwitterPost(req: Request, res: Response): Promise<void> {
  const post = await TwitterLikePost.findByIdAndDelete(req.params.id);
  if (!post) { res.status(404).json({ message: 'TwitterLikePost not found' }); return; }
  res.status(204).send();
}

/**
 * POST /twitter-posts/generate
 *
 * Accepts multiple source modes:
 * 1. Direct: provide `texts[]` directly — generates HTML immediately.
 * 2. From Instagram post: provide `sourcePostId` — uses transcript + title.
 * 3. From MedFeed news: provide `sourceNewsId` — uses summary + title.
 * 4. From TikTok post: provide `sourceTikTokPostId` — uses transcript + title.
 * 5. From Instagram story: provide `sourceInstagramStoryId` — uses transcript.
 * 6. Manual: provide `sourceTranscript` + `sourceCaption`.
 *
 * Common options: mode (light|dark), bodyFontSize, profileName, profileHandle, profileImageUrl, slideCount, tone.
 */
export async function generateTwitterPost(req: Request, res: Response): Promise<void> {
  const {
    accountId,
    productId,
    texts,
    sourcePostId,
    sourceNewsId,
    sourceTikTokPostId,
    sourceInstagramStoryId,
    sourceTranscript,
    sourceCaption,
    mode = 'dark',
    bodyFontSize = 20,
    profileName,
    profileHandle,
    profileImageUrl,
    slideCount,
    tone,
  } = req.body as {
    accountId?: string;
    productId?: string;
    texts?: string[];
    sourcePostId?: string;
    sourceNewsId?: string;
    sourceTikTokPostId?: string;
    sourceInstagramStoryId?: string;
    sourceTranscript?: string;
    sourceCaption?: string;
    mode?: DisplayMode;
    bodyFontSize?: number;
    profileName?: string;
    profileHandle?: string;
    profileImageUrl?: string;
    slideCount?: number;
    tone?: string;
  };

  if (!accountId || !productId) {
    res.status(400).json({ message: 'accountId and productId are required' });
    return;
  }
  if (!texts?.length && !sourcePostId && !sourceNewsId && !sourceTikTokPostId && !sourceInstagramStoryId && !sourceTranscript && !sourceCaption) {
    res.status(400).json({ message: 'Provide texts[], sourcePostId, sourceNewsId, sourceTikTokPostId, sourceInstagramStoryId, or sourceTranscript/sourceCaption' });
    return;
  }

  const [account, product] = await Promise.all([
    InstagramAccount.findOne({ externalId: accountId }),
    Product.findOne({ externalId: productId }),
  ]);
  if (!account) { res.status(400).json({ message: 'Account not found' }); return; }
  if (!product) { res.status(400).json({ message: 'Product not found' }); return; }

  let resolvedTranscript = sourceTranscript ?? '';
  let resolvedCaption = sourceCaption ?? '';
  let resolvedTexts = texts ?? [];

  if (sourcePostId) {
    const post = await Post.findById(sourcePostId);
    if (!post) { res.status(400).json({ message: 'Source post not found' }); return; }
    resolvedTranscript = resolvedTranscript || post.transcript || '';
    resolvedCaption = resolvedCaption || post.title || '';

    if (!resolvedTranscript) {
      res.status(422).json({ code: 'NO_TRANSCRIPT', message: 'Post sem transcript. Descreva manualmente o conteúdo do post.' });
      return;
    }
  }

  if (sourceNewsId) {
    const news = await MedicalNews.findById(sourceNewsId);
    if (!news) { res.status(400).json({ message: 'MedicalNews not found' }); return; }
    resolvedTranscript = resolvedTranscript || news.summary || '';
    resolvedCaption = resolvedCaption || news.title || '';

    if (!resolvedTranscript) {
      res.status(422).json({ code: 'NO_SUMMARY', message: 'Notícia sem resumo. Descreva manualmente o conteúdo.' });
      return;
    }
  }

  if (sourceTikTokPostId) {
    const tiktokPost = await TikTokPost.findById(sourceTikTokPostId);
    if (!tiktokPost) { res.status(400).json({ message: 'TikTokPost not found' }); return; }
    resolvedTranscript = resolvedTranscript || tiktokPost.transcript || '';
    resolvedCaption = resolvedCaption || tiktokPost.title || '';

    if (!resolvedTranscript) {
      res.status(422).json({ code: 'NO_TRANSCRIPT', message: 'TikTok post sem transcript. Descreva manualmente o conteúdo.' });
      return;
    }
  }

  if (sourceInstagramStoryId) {
    const story = await InstagramStory.findById(sourceInstagramStoryId);
    if (!story) { res.status(400).json({ message: 'InstagramStory not found' }); return; }
    resolvedTranscript = resolvedTranscript || story.transcript || '';

    if (!resolvedTranscript) {
      res.status(422).json({ code: 'NO_TRANSCRIPT', message: 'Story sem transcript. Descreva manualmente o conteúdo.' });
      return;
    }
  }

  try {
    let generatedCaption = '';

    if (!resolvedTexts.length) {
      const generated = await generateSlidesFromSource({
        transcript: resolvedTranscript,
        caption: resolvedCaption,
        slideCount,
        tone,
      });
      resolvedTexts = generated.slides;
      generatedCaption = generated.caption;
    }

    if (!resolvedTexts.length) {
      res.status(502).json({ message: 'GPT returned no slides' });
      return;
    }

    const slideHtmls = await buildCarouselHtmls({
      texts: resolvedTexts,
      mode,
      bodyFontSize,
      profileName: profileName ?? account.displayName,
      profileHandle: profileHandle ?? account.handle,
      profileImageUrl,
      brandingProfilePicUrl: account.profilePicS3Url ?? undefined,
    });

    const doc = await TwitterLikePost.create({
      accountId: account._id,
      productId: product._id,
      createdBy: req.user!.userId,
      mode,
      bodyFontSize,
      profileName: profileName ?? account.displayName,
      profileHandle: profileHandle ?? account.handle,
      profileImageUrl: profileImageUrl ?? '',
      slides: resolvedTexts,
      slideHtmls,
      caption: generatedCaption,
      sourceTranscript: resolvedTranscript,
      sourceCaption: resolvedCaption,
      sourceNewsId: sourceNewsId ?? null,
      sourceTikTokPostId: sourceTikTokPostId ?? null,
      sourceInstagramStoryId: sourceInstagramStoryId ?? null,
      status: 'Rascunho',
      generatedAt: new Date(),
    });

    res.status(201).json(toResponse(doc));
  } catch (err) {
    res.status(502).json({ message: 'Generation failed', error: err instanceof Error ? err.message : 'Unknown error' });
  }
}

/**
 * GET /twitter-posts/:id/slides/:index/export — Renders a single slide as PNG.
 */
export async function exportTwitterSlide(req: Request, res: Response): Promise<void> {
  const post = await TwitterLikePost.findById(req.params.id);
  if (!post) { res.status(404).json({ message: 'TwitterLikePost not found' }); return; }

  const index = parseInt(req.params.index, 10);
  if (isNaN(index) || index < 0 || index >= post.slideHtmls.length) {
    res.status(400).json({ message: `Slide index out of range (0–${post.slideHtmls.length - 1})` });
    return;
  }

  const filename = `slide-${index + 1}-${post._id.toString()}`;

  try {
    await streamSlideAsPng(post.slideHtmls[index], filename, res);
  } catch (err) {
    if (!res.headersSent) {
      res.status(502).json({ message: 'Export failed', error: err instanceof Error ? err.message : 'Unknown error' });
    }
  }
}

/**
 * GET /twitter-posts/:id/export — Renders all slides as PNGs and returns a ZIP archive.
 */
export async function exportTwitterPost(req: Request, res: Response): Promise<void> {
  const post = await TwitterLikePost.findById(req.params.id);
  if (!post) { res.status(404).json({ message: 'TwitterLikePost not found' }); return; }
  if (!post.slideHtmls.length) { res.status(422).json({ message: 'Post has no slides to export' }); return; }

  const filename = `slides-${post._id.toString()}`;

  try {
    await streamSlidesAsZip(post.slideHtmls, filename, res);
  } catch (err) {
    if (!res.headersSent) {
      res.status(502).json({ message: 'Export failed', error: err instanceof Error ? err.message : 'Unknown error' });
    }
  }
}

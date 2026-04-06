import { Request, Response } from 'express';
import { env } from '../config/env';
import { StoryReply } from '../models/StoryReply';
import { InstagramAccount } from '../models/InstagramAccount';
import { Product } from '../models/Product';
import { Post } from '../models/Post';
import { MedicalNews } from '../models/MedicalNews';
import { TikTokPost } from '../models/TikTokPost';
import { InstagramStory } from '../models/InstagramStory';
import {
  generateStoryReply,
  enrichSocialSourceIfThin,
  buildStoryQuestionHtml,
  buildStoryAnswerHtml,
  type StoryDragLayoutPct,
} from '../services/twitterPostGenerator';
import { fetchWebBackgroundUrls, searchAlternateBackgroundUrls } from '../services/stockImageSearch';
import { uploadBuffer } from '../services/s3';
import { streamSlideAsPng } from '../services/slideExporter';
import type { StoryReplyMode, StoryFont } from '../models/StoryReply';

function clampStoryPct(v: unknown, fallback: number): number {
  if (typeof v !== 'number' || Number.isNaN(v)) return fallback;
  return Math.min(100, Math.max(0, v));
}

function layoutFromDoc(doc: InstanceType<typeof StoryReply>): StoryDragLayoutPct {
  return {
    stickerCenterX: doc.stickerCenterXPct ?? 50,
    stickerCenterY: doc.stickerCenterYPct ?? 18,
    answerCenterX: doc.answerCenterXPct ?? 50,
    answerCenterY: doc.answerCenterYPct ?? 52,
  };
}

function toResponse(doc: InstanceType<typeof StoryReply>) {
  return {
    id: doc._id.toString(),
    mode: doc.mode,
    font: doc.font,
    textColor: doc.textColor,
    highlightColor: doc.highlightColor,
    stickerFontSize: doc.stickerFontSize,
    answerFontSize: doc.answerFontSize,
    answerLineHeight: doc.answerLineHeight ?? 1.46,
    answerFillPadding: doc.answerFillPadding ?? 0,
    stickerCenterXPct: doc.stickerCenterXPct ?? 50,
    stickerCenterYPct: doc.stickerCenterYPct ?? 18,
    answerCenterXPct: doc.answerCenterXPct ?? 50,
    answerCenterYPct: doc.answerCenterYPct ?? 52,
    question: doc.question,
    answer: doc.answer,
    questionHtml: doc.questionHtml,
    answerHtml: doc.answerHtml,
    caption: doc.caption,
    backgroundUrl: doc.backgroundUrl ?? '',
    backgroundOverlayColor: doc.backgroundOverlayColor ?? 'rgba(0,0,0,0.65)',
    imageSearchQuery: doc.imageSearchQuery ?? '',
    profileName: doc.profileName,
    profileHandle: doc.profileHandle,
    profileImageUrl: doc.profileImageUrl,
    brandColors: doc.brandColors,
    sourceTranscript: doc.sourceTranscript,
    sourceCaption: doc.sourceCaption,
    sourcePostId: doc.sourcePostId?.toString() ?? null,
    sourceNewsId: doc.sourceNewsId?.toString() ?? null,
    sourceTikTokPostId: doc.sourceTikTokPostId?.toString() ?? null,
    sourceInstagramStoryId: doc.sourceInstagramStoryId?.toString() ?? null,
    status: doc.status,
    generatedAt: doc.generatedAt,
    createdAt: doc.createdAt,
  };
}

function buildBgOptions(doc: InstanceType<typeof StoryReply>) {
  return {
    backgroundUrl: doc.backgroundUrl || undefined,
    overlayColor: doc.backgroundOverlayColor || undefined,
  };
}

function rebuildHtmls(doc: InstanceType<typeof StoryReply>): void {
  const brandColors = doc.brandColors ?? [];
  const bg = buildBgOptions(doc);
  const L = layoutFromDoc(doc);
  doc.questionHtml = buildStoryQuestionHtml(doc.question, doc.mode, doc.profileName, brandColors, doc.font, doc.textColor, doc.highlightColor, doc.stickerFontSize, bg, {
    stickerCenterX: L.stickerCenterX,
    stickerCenterY: L.stickerCenterY,
  });
  doc.answerHtml = buildStoryAnswerHtml(doc.question, doc.answer, doc.mode, doc.profileName, brandColors, doc.font, doc.textColor, doc.highlightColor, doc.stickerFontSize, doc.answerFontSize, bg, doc.answerLineHeight, doc.answerFillPadding, L);
}

export async function listStoryReplies(req: Request, res: Response): Promise<void> {
  const { accountId } = req.query as Record<string, string>;
  const filter: Record<string, unknown> = {};
  if (accountId) {
    const account = await InstagramAccount.findOne({ externalId: accountId });
    if (!account) { res.status(404).json({ message: 'Account not found' }); return; }
    filter.accountId = account._id;
  }
  const docs = await StoryReply.find(filter).sort({ createdAt: -1 });
  res.json(docs.map(toResponse));
}

export async function getStoryReply(req: Request, res: Response): Promise<void> {
  const doc = await StoryReply.findById(req.params.id);
  if (!doc) { res.status(404).json({ message: 'StoryReply not found' }); return; }
  res.json(toResponse(doc));
}

export async function generateStoryReplyPost(req: Request, res: Response): Promise<void> {
  const {
    accountId,
    productId,
    sourcePostId,
    sourceNewsId,
    sourceTikTokPostId,
    sourceInstagramStoryId,
    sourceTranscript,
    sourceCaption,
    question: manualQuestion,
    answer: manualAnswer,
    mode = 'dark',
    font = 'classic',
    textColor = '#ffffff',
    highlightColor = '#FF6B2B',
    stickerFontSize,
    answerFontSize,
    answerLineHeight,
    answerFillPadding,
    tone,
    backgroundUrl: manualBackgroundUrl,
    backgroundOverlayColor = 'rgba(0,0,0,0.65)',
    brandPostImageIndex,
    brandPostImageUrl,
    stickerCenterXPct: bodyStickerCenterXPct,
    stickerCenterYPct: bodyStickerCenterYPct,
    answerCenterXPct: bodyAnswerCenterXPct,
    answerCenterYPct: bodyAnswerCenterYPct,
  } = req.body as {
    accountId?: string;
    productId?: string;
    sourcePostId?: string;
    sourceNewsId?: string;
    sourceTikTokPostId?: string;
    sourceInstagramStoryId?: string;
    sourceTranscript?: string;
    sourceCaption?: string;
    question?: string;
    answer?: string;
    mode?: StoryReplyMode;
    font?: StoryFont;
    textColor?: string;
    highlightColor?: string;
    stickerFontSize?: number;
    answerFontSize?: number;
    answerLineHeight?: number;
    answerFillPadding?: number;
    tone?: string;
    backgroundUrl?: string;
    backgroundOverlayColor?: string;
    brandPostImageIndex?: number;
    brandPostImageUrl?: string;
    stickerCenterXPct?: number;
    stickerCenterYPct?: number;
    answerCenterXPct?: number;
    answerCenterYPct?: number;
  };

  if (!accountId || !productId) {
    res.status(400).json({ message: 'accountId and productId are required' });
    return;
  }

  if (!sourcePostId && !sourceNewsId && !sourceTikTokPostId && !sourceInstagramStoryId && !sourceTranscript && !manualQuestion) {
    res.status(400).json({ message: 'Provide a source (sourcePostId, sourceNewsId, sourceTikTokPostId, sourceInstagramStoryId, sourceTranscript) or manual question/answer' });
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
  const mediaUrls: string[] = [];

  if (sourcePostId) {
    const post = await Post.findById(sourcePostId);
    if (!post) { res.status(400).json({ message: 'Source post not found' }); return; }
    resolvedTranscript = resolvedTranscript || post.transcript || '';
    resolvedCaption = resolvedCaption || post.title || '';
    if (post.carouselImages?.length) mediaUrls.push(...post.carouselImages);
    else if (post.thumbnailUrl) mediaUrls.push(post.thumbnailUrl);
  }

  if (sourceNewsId) {
    const news = await MedicalNews.findById(sourceNewsId);
    if (!news) { res.status(400).json({ message: 'MedicalNews not found' }); return; }
    const summary = (news.summary || '').trim();
    const title = (news.title || '').trim();
    let fromNews = '';
    if (summary && title) fromNews = `${title}\n\n${summary}`;
    else fromNews = summary || title;
    resolvedTranscript = resolvedTranscript || fromNews;
    resolvedCaption = resolvedCaption || title;
    if (news.imageUrl) mediaUrls.push(news.imageUrl);
  }

  if (sourceTikTokPostId) {
    const tiktokPost = await TikTokPost.findById(sourceTikTokPostId);
    if (!tiktokPost) { res.status(400).json({ message: 'TikTokPost not found' }); return; }
    resolvedTranscript = resolvedTranscript || tiktokPost.transcript || '';
    resolvedCaption = resolvedCaption || tiktokPost.title || '';
    if (tiktokPost.thumbnailUrl) mediaUrls.push(tiktokPost.thumbnailUrl);
  }

  if (sourceInstagramStoryId) {
    const story = await InstagramStory.findById(sourceInstagramStoryId);
    if (!story) { res.status(400).json({ message: 'InstagramStory not found' }); return; }
    resolvedTranscript = resolvedTranscript || story.transcript || '';
    if (story.thumbnailUrl) mediaUrls.push(story.thumbnailUrl);
  }

  if (!resolvedTranscript && !manualQuestion) {
    res.status(422).json({ code: 'NO_CONTENT', message: 'Sem conteúdo-fonte para gerar a caixinha. Forneça sourceTranscript ou question/answer manuais.' });
    return;
  }

  try {
    let question = manualQuestion ?? '';
    let answer = manualAnswer ?? '';
    let caption = '';

    if (!question) {
      const enriched = await enrichSocialSourceIfThin({ transcript: resolvedTranscript, caption: resolvedCaption });
      resolvedTranscript = enriched.transcript;
      resolvedCaption = enriched.caption;
      const generated = await generateStoryReply({
        transcript: resolvedTranscript,
        caption: resolvedCaption,
        imageUrls: mediaUrls,
        tone,
      });
      question = generated.question;
      answer = answer || generated.answer;
      caption = generated.caption;
    }

    if (!question) { res.status(502).json({ message: 'GPT returned empty question' }); return; }

    const brandColors = account.brandColors ?? [];
    const profileName = account.displayName || account.handle;

    let resolvedBgUrl = manualBackgroundUrl ?? '';
    let imageSearchQuery = '';

    if (!resolvedBgUrl) {
      const postLib = account.brandPostImages ?? [];
      const urlPick = typeof brandPostImageUrl === 'string' ? brandPostImageUrl.trim() : '';
      if (urlPick && postLib.includes(urlPick)) resolvedBgUrl = urlPick;
      else if (brandPostImageIndex !== undefined && Number.isInteger(brandPostImageIndex) && brandPostImageIndex >= 0 && brandPostImageIndex < postLib.length) {
        resolvedBgUrl = (postLib[brandPostImageIndex] ?? '').trim();
      }
    }

    if (!resolvedBgUrl && env.UNSPLASH_ACCESS_KEY) {
      const web = await fetchWebBackgroundUrls(resolvedTranscript, resolvedCaption, 1, false);
      resolvedBgUrl = web.urls[0] ?? '';
      imageSearchQuery = web.query;
    }

    const bgOptions = resolvedBgUrl ? { backgroundUrl: resolvedBgUrl, overlayColor: backgroundOverlayColor } : undefined;
    const stickerCenterXPct = bodyStickerCenterXPct !== undefined ? clampStoryPct(bodyStickerCenterXPct, 50) : 50;
    const stickerCenterYPct = bodyStickerCenterYPct !== undefined ? clampStoryPct(bodyStickerCenterYPct, 18) : 18;
    const answerCenterXPct = bodyAnswerCenterXPct !== undefined ? clampStoryPct(bodyAnswerCenterXPct, 50) : 50;
    const answerCenterYPct = bodyAnswerCenterYPct !== undefined ? clampStoryPct(bodyAnswerCenterYPct, 52) : 52;
    const dragLayout: StoryDragLayoutPct = {
      stickerCenterX: stickerCenterXPct,
      stickerCenterY: stickerCenterYPct,
      answerCenterX: answerCenterXPct,
      answerCenterY: answerCenterYPct,
    };
    const questionHtml = buildStoryQuestionHtml(question, mode, profileName, brandColors, font, textColor, highlightColor, stickerFontSize, bgOptions, {
      stickerCenterX: dragLayout.stickerCenterX,
      stickerCenterY: dragLayout.stickerCenterY,
    });
    const answerHtml = buildStoryAnswerHtml(question, answer, mode, profileName, brandColors, font, textColor, highlightColor, stickerFontSize, answerFontSize, bgOptions, answerLineHeight, answerFillPadding, dragLayout);

    const doc = await StoryReply.create({
      accountId: account._id,
      productId: product._id,
      createdBy: req.user!.userId,
      mode,
      font,
      textColor,
      highlightColor,
      stickerFontSize,
      answerFontSize,
      answerLineHeight: answerLineHeight ?? 1.46,
      answerFillPadding: answerFillPadding ?? 0,
      stickerCenterXPct,
      stickerCenterYPct,
      answerCenterXPct,
      answerCenterYPct,
      question,
      answer,
      questionHtml,
      answerHtml,
      caption,
      backgroundUrl: resolvedBgUrl,
      backgroundOverlayColor,
      imageSearchQuery,
      profileName,
      profileHandle: account.handle,
      profileImageUrl: account.profilePicS3Url ?? '',
      brandColors,
      sourceTranscript: resolvedTranscript,
      sourceCaption: resolvedCaption,
      sourcePostId: sourcePostId ?? null,
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

export async function updateStoryReply(req: Request, res: Response): Promise<void> {
  const doc = await StoryReply.findById(req.params.id);
  if (!doc) { res.status(404).json({ message: 'StoryReply not found' }); return; }

  const { question, answer, mode, font, textColor, highlightColor, stickerFontSize, answerFontSize, answerLineHeight, answerFillPadding, status, backgroundUrl, backgroundOverlayColor, stickerCenterXPct, stickerCenterYPct, answerCenterXPct, answerCenterYPct } = req.body as {
    question?: string;
    answer?: string;
    mode?: StoryReplyMode;
    font?: StoryFont;
    textColor?: string;
    highlightColor?: string;
    stickerFontSize?: number;
    answerFontSize?: number;
    answerLineHeight?: number;
    answerFillPadding?: number;
    status?: string;
    backgroundUrl?: string;
    backgroundOverlayColor?: string;
    stickerCenterXPct?: number;
    stickerCenterYPct?: number;
    answerCenterXPct?: number;
    answerCenterYPct?: number;
  };

  if (question !== undefined) doc.question = question;
  if (answer !== undefined) doc.answer = answer;
  if (mode !== undefined) doc.mode = mode;
  if (font !== undefined) doc.font = font;
  if (textColor !== undefined) doc.textColor = textColor;
  if (highlightColor !== undefined) doc.highlightColor = highlightColor;
  if (stickerFontSize !== undefined) doc.stickerFontSize = stickerFontSize;
  if (answerFontSize !== undefined) doc.answerFontSize = answerFontSize;
  if (answerLineHeight !== undefined) doc.answerLineHeight = answerLineHeight;
  if (answerFillPadding !== undefined) doc.answerFillPadding = answerFillPadding;
  if (status !== undefined) doc.status = status as 'Rascunho' | 'Aprovado' | 'Publicado';
  if (backgroundUrl !== undefined) doc.backgroundUrl = backgroundUrl;
  if (backgroundOverlayColor !== undefined) doc.backgroundOverlayColor = backgroundOverlayColor;
  if (stickerCenterXPct !== undefined) doc.stickerCenterXPct = clampStoryPct(stickerCenterXPct, doc.stickerCenterXPct ?? 50);
  if (stickerCenterYPct !== undefined) doc.stickerCenterYPct = clampStoryPct(stickerCenterYPct, doc.stickerCenterYPct ?? 18);
  if (answerCenterXPct !== undefined) doc.answerCenterXPct = clampStoryPct(answerCenterXPct, doc.answerCenterXPct ?? 50);
  if (answerCenterYPct !== undefined) doc.answerCenterYPct = clampStoryPct(answerCenterYPct, doc.answerCenterYPct ?? 52);

  const contentChanged = question !== undefined || answer !== undefined || mode !== undefined
    || font !== undefined || textColor !== undefined || highlightColor !== undefined
    || stickerFontSize !== undefined || answerFontSize !== undefined
    || answerLineHeight !== undefined || answerFillPadding !== undefined
    || backgroundUrl !== undefined || backgroundOverlayColor !== undefined
    || stickerCenterXPct !== undefined || stickerCenterYPct !== undefined
    || answerCenterXPct !== undefined || answerCenterYPct !== undefined;
  if (contentChanged) rebuildHtmls(doc);

  await doc.save();
  res.json(toResponse(doc));
}

export async function suggestStoryAlternateBackgrounds(req: Request, res: Response): Promise<void> {
  if (!env.UNSPLASH_ACCESS_KEY) {
    res.status(503).json({ message: 'UNSPLASH_ACCESS_KEY is not configured' });
    return;
  }
  const doc = await StoryReply.findById(req.params.id);
  if (!doc) { res.status(404).json({ message: 'StoryReply not found' }); return; }

  const page = Math.max(1, parseInt(String((req.body as { page?: number })?.page ?? 1), 10) || 1);
  const query = doc.imageSearchQuery?.trim() || 'medical healthcare education';
  try {
    const urls = await searchAlternateBackgroundUrls(query, page, 'portrait', 12);
    res.json({ urls, query, page });
  } catch (err) {
    res.status(502).json({ message: 'Image search failed', error: err instanceof Error ? err.message : 'Unknown error' });
  }
}

export async function uploadStoryBackground(req: Request, res: Response): Promise<void> {
  if (!env.AWS_S3_BUCKET) {
    res.status(503).json({ message: 'AWS_S3_BUCKET is not configured' });
    return;
  }
  const doc = await StoryReply.findById(req.params.id);
  if (!doc) { res.status(404).json({ message: 'StoryReply not found' }); return; }

  const file = req.file;
  if (!file) { res.status(400).json({ message: 'No file provided (field: file)' }); return; }

  const ext = file.mimetype.split('/')[1] ?? 'jpg';
  const key = `story-replies/${doc._id}/bg-${Date.now()}.${ext}`;
  const s3Url = await uploadBuffer(file.buffer, key, file.mimetype);
  if (!s3Url) { res.status(502).json({ message: 'Upload to S3 failed' }); return; }

  doc.backgroundUrl = s3Url;
  rebuildHtmls(doc);
  await doc.save();
  res.json(toResponse(doc));
}

export async function deleteStoryReply(req: Request, res: Response): Promise<void> {
  const doc = await StoryReply.findByIdAndDelete(req.params.id);
  if (!doc) { res.status(404).json({ message: 'StoryReply not found' }); return; }
  res.status(204).send();
}

export async function exportStoryQuestion(req: Request, res: Response): Promise<void> {
  const doc = await StoryReply.findById(req.params.id);
  if (!doc) { res.status(404).json({ message: 'StoryReply not found' }); return; }
  try {
    await streamSlideAsPng(doc.questionHtml, `story-question-${doc._id}`, res, 1080, 1920);
  } catch (err) {
    if (!res.headersSent) res.status(502).json({ message: 'Export failed', error: err instanceof Error ? err.message : 'Unknown error' });
  }
}

export async function exportStoryAnswer(req: Request, res: Response): Promise<void> {
  const doc = await StoryReply.findById(req.params.id);
  if (!doc) { res.status(404).json({ message: 'StoryReply not found' }); return; }
  try {
    await streamSlideAsPng(doc.answerHtml, `story-answer-${doc._id}`, res, 1080, 1920);
  } catch (err) {
    if (!res.headersSent) res.status(502).json({ message: 'Export failed', error: err instanceof Error ? err.message : 'Unknown error' });
  }
}

export async function previewStoryQuestion(req: Request, res: Response): Promise<void> {
  const doc = await StoryReply.findById(req.params.id);
  if (!doc) { res.status(404).send('Not found'); return; }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(doc.questionHtml);
}

export async function previewStoryAnswer(req: Request, res: Response): Promise<void> {
  const doc = await StoryReply.findById(req.params.id);
  if (!doc) { res.status(404).send('Not found'); return; }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(doc.answerHtml);
}

export async function saveStoryHtml(req: Request, res: Response): Promise<void> {
  const doc = await StoryReply.findById(req.params.id);
  if (!doc) { res.status(404).json({ message: 'StoryReply not found' }); return; }

  const { questionHtml, answerHtml } = req.body as { questionHtml?: string; answerHtml?: string };
  if (!questionHtml && !answerHtml) {
    res.status(400).json({ message: 'Provide questionHtml and/or answerHtml' });
    return;
  }

  if (questionHtml !== undefined) doc.questionHtml = questionHtml;
  if (answerHtml !== undefined) doc.answerHtml = answerHtml;

  await doc.save();
  res.json(toResponse(doc));
}

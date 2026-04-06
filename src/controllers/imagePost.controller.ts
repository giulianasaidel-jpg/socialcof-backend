import { Request, Response } from 'express';
import { env } from '../config/env';
import { ImagePost } from '../models/ImagePost';
import { InstagramAccount } from '../models/InstagramAccount';
import { Product } from '../models/Product';
import { Post } from '../models/Post';
import { MedicalNews } from '../models/MedicalNews';
import { TikTokPost } from '../models/TikTokPost';
import { InstagramStory } from '../models/InstagramStory';
import {
  generateImagePostContent,
  enrichSocialSourceIfThin,
  buildImageOverlayHtml,
  buildPanoramicSlideHtml,
  type ImageOverlayVisualInput,
} from '../services/twitterPostGenerator';
import { fetchWebBackgroundUrls, searchAlternateBackgroundUrls } from '../services/stockImageSearch';
import { uploadBuffer } from '../services/s3';
import { streamSlidesAsZip, streamSlideAsPng } from '../services/slideExporter';
import type {
  ImagePostBandStyle,
  ImagePostLayout,
  ImagePostMode,
  ImagePostOverlayFont,
  ImageStyle,
  IImagePostSlide,
} from '../models/ImagePost';

function isPreviewPhase(doc: InstanceType<typeof ImagePost>): boolean {
  return doc.overlayPhase === 'preview';
}

function finalVisualFromDoc(doc: InstanceType<typeof ImagePost>): ImageOverlayVisualInput {
  return {
    fontId: doc.overlayFont ?? 'montserrat',
    bandStyle: doc.bandStyle ?? 'solid',
    bandColor: doc.bandColor ?? '#ffffff',
    bandTextColor: doc.bandTextColor ?? '#111111',
    overlayBodyColor: doc.overlayBodyColor?.trim() || undefined,
    overlayStrongColor: doc.overlayStrongColor?.trim() || undefined,
    previewImageOnly: false,
  };
}

function slideVisualForDoc(doc: InstanceType<typeof ImagePost>): ImageOverlayVisualInput {
  if (isPreviewPhase(doc)) return { previewImageOnly: true };
  return finalVisualFromDoc(doc);
}

function toResponse(doc: InstanceType<typeof ImagePost>) {
  return {
    id: doc._id.toString(),
    layout: doc.layout,
    mode: doc.mode,
    imageStyle: doc.imageStyle,
    bodyFontSize: doc.bodyFontSize,
    overlayPhase: doc.overlayPhase ?? 'final',
    imageSearchQuery: doc.imageSearchQuery ?? '',
    overlayFont: doc.overlayFont ?? 'montserrat',
    bandStyle: doc.bandStyle ?? 'solid',
    bandColor: doc.bandColor ?? '#ffffff',
    bandTextColor: doc.bandTextColor ?? '#111111',
    overlayBodyColor: doc.overlayBodyColor ?? '',
    overlayStrongColor: doc.overlayStrongColor ?? '',
    slides: doc.slides.map((s) => ({
      backgroundUrl: s.backgroundUrl,
      overlayHtml: s.overlayHtml,
      overlayText: s.overlayText,
    })),
    caption: doc.caption,
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

export async function listImagePosts(req: Request, res: Response): Promise<void> {
  const { accountId } = req.query as Record<string, string>;
  const filter: Record<string, unknown> = {};
  if (accountId) {
    const account = await InstagramAccount.findOne({ externalId: accountId });
    if (!account) { res.status(404).json({ message: 'Account not found' }); return; }
    filter.accountId = account._id;
  }
  const docs = await ImagePost.find(filter).sort({ createdAt: -1 });
  res.json(docs.map(toResponse));
}

export async function getImagePost(req: Request, res: Response): Promise<void> {
  const doc = await ImagePost.findById(req.params.id);
  if (!doc) { res.status(404).json({ message: 'ImagePost not found' }); return; }
  res.json(toResponse(doc));
}

export async function generateImagePostEndpoint(req: Request, res: Response): Promise<void> {
  const {
    accountId,
    productId,
    sourcePostId,
    sourceNewsId,
    sourceTikTokPostId,
    sourceInstagramStoryId,
    sourceTranscript,
    sourceCaption,
    backgroundUrls,
    manualTexts,
    layout = 'static',
    mode = 'dark',
    imageStyle = 'lo-fi',
    bodyFontSize = 42,
    slideCount,
    tone,
    immediateFinal,
    overlayFont,
    bandStyle,
    bandColor,
    bandTextColor,
    overlayBodyColor,
    overlayStrongColor,
    brandPostImageIndex,
    brandPostImageUrl,
  } = req.body as {
    accountId?: string;
    productId?: string;
    sourcePostId?: string;
    sourceNewsId?: string;
    sourceTikTokPostId?: string;
    sourceInstagramStoryId?: string;
    sourceTranscript?: string;
    sourceCaption?: string;
    backgroundUrls?: string[];
    manualTexts?: string[];
    layout?: ImagePostLayout;
    mode?: ImagePostMode;
    imageStyle?: ImageStyle;
    bodyFontSize?: number;
    slideCount?: number;
    tone?: string;
    immediateFinal?: boolean;
    overlayFont?: ImagePostOverlayFont;
    bandStyle?: ImagePostBandStyle;
    bandColor?: string;
    bandTextColor?: string;
    overlayBodyColor?: string;
    overlayStrongColor?: string;
    brandPostImageIndex?: number;
    brandPostImageUrl?: string;
  };

  if (!accountId || !productId) {
    res.status(400).json({ message: 'accountId and productId are required' });
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

  const needsGeneration = !manualTexts?.length;
  if (needsGeneration && !resolvedTranscript) {
    res.status(422).json({ code: 'NO_CONTENT', message: 'Sem conteúdo-fonte. Forneça sourceTranscript, uma fonte, ou manualTexts[].' });
    return;
  }

  try {
    let texts = manualTexts ?? [];
    let caption = '';

    const resolvedSlideCount = slideCount ?? backgroundUrls?.length ?? 1;

    if (!texts.length) {
      const enriched = await enrichSocialSourceIfThin({ transcript: resolvedTranscript, caption: resolvedCaption });
      resolvedTranscript = enriched.transcript;
      resolvedCaption = enriched.caption;
      const generated = await generateImagePostContent({
        transcript: resolvedTranscript,
        caption: resolvedCaption,
        imageUrls: mediaUrls,
        slideCount: resolvedSlideCount,
        tone,
      });
      texts = generated.slides;
      caption = generated.caption;
    }

    if (!texts.length) { res.status(502).json({ message: 'GPT returned no text' }); return; }

    const brandColors = account.brandColors ?? [];
    const profileName = account.displayName || account.handle;
    const profileImageUrl = account.profilePicS3Url ?? '';

    const isPanoramic = layout === 'panoramic';

    let resolvedBackgrounds: string[];
    let imageSearchQuery = '';
    if (backgroundUrls?.length) {
      if (isPanoramic) {
        const u = backgroundUrls[0];
        if (!u) {
          res.status(400).json({ message: 'panoramic layout requires backgroundUrls[0]' });
          return;
        }
        resolvedBackgrounds = Array.from({ length: texts.length }, () => u);
      } else {
        resolvedBackgrounds = backgroundUrls;
      }
    } else {
      const postLib = account.brandPostImages ?? [];
      let fromBrand = '';
      const urlPick = typeof brandPostImageUrl === 'string' ? brandPostImageUrl.trim() : '';
      if (urlPick && postLib.includes(urlPick)) fromBrand = urlPick;
      else if (brandPostImageIndex !== undefined && Number.isInteger(brandPostImageIndex) && brandPostImageIndex >= 0 && brandPostImageIndex < postLib.length) {
        fromBrand = (postLib[brandPostImageIndex] ?? '').trim();
      }
      if (fromBrand) {
        resolvedBackgrounds = Array.from({ length: texts.length }, () => fromBrand);
      } else if (!env.UNSPLASH_ACCESS_KEY) {
        res.status(503).json({
          message:
            'Sem fundos: defina UNSPLASH_ACCESS_KEY, envie backgroundUrls[], ou use brandPostImageIndex / brandPostImageUrl (imagem em branding do perfil).',
        });
        return;
      } else {
        const web = await fetchWebBackgroundUrls(resolvedTranscript, resolvedCaption, texts.length, isPanoramic);
        imageSearchQuery = web.query;
        resolvedBackgrounds = web.urls;
      }
    }

    if (!resolvedBackgrounds.length || resolvedBackgrounds.some((u) => !u)) {
      res.status(502).json({ message: 'No background images available' });
      return;
    }

    const total = Math.min(texts.length, resolvedBackgrounds.length);
    const buildSlide = isPanoramic ? buildPanoramicSlideHtml : buildImageOverlayHtml;

    const resolvedOverlayFont = overlayFont ?? 'montserrat';
    const resolvedBandStyle = bandStyle ?? 'solid';
    const resolvedBandColor = bandColor ?? '#ffffff';
    const resolvedBandTextColor = bandTextColor ?? '#111111';
    const resolvedBodyColor = overlayBodyColor ?? '';
    const resolvedStrongColor = overlayStrongColor ?? '';
    const startAsFinal = Boolean(immediateFinal);

    const slides: IImagePostSlide[] = [];
    for (let i = 0; i < total; i++) {
      const visual: ImageOverlayVisualInput = startAsFinal
        ? {
            fontId: resolvedOverlayFont,
            bandStyle: resolvedBandStyle,
            bandColor: resolvedBandColor,
            bandTextColor: resolvedBandTextColor,
            overlayBodyColor: resolvedBodyColor || undefined,
            overlayStrongColor: resolvedStrongColor || undefined,
            previewImageOnly: false,
          }
        : { previewImageOnly: true };
      const overlayHtml = buildSlide(
        texts[i],
        resolvedBackgrounds[i],
        mode,
        bodyFontSize,
        brandColors,
        i,
        total,
        profileName,
        profileImageUrl,
        visual,
      );
      slides.push({ backgroundUrl: resolvedBackgrounds[i], overlayHtml, overlayText: texts[i] });
    }

    const doc = await ImagePost.create({
      accountId: account._id,
      productId: product._id,
      createdBy: req.user!.userId,
      layout: isPanoramic ? 'panoramic' : (total > 1 ? 'carousel' : layout),
      mode,
      imageStyle,
      bodyFontSize,
      slides,
      caption,
      profileName,
      profileHandle: account.handle,
      profileImageUrl,
      brandColors,
      sourceTranscript: resolvedTranscript,
      sourceCaption: resolvedCaption,
      sourcePostId: sourcePostId ?? null,
      sourceNewsId: sourceNewsId ?? null,
      sourceTikTokPostId: sourceTikTokPostId ?? null,
      sourceInstagramStoryId: sourceInstagramStoryId ?? null,
      status: 'Rascunho',
      overlayPhase: startAsFinal ? 'final' : 'preview',
      imageSearchQuery,
      overlayFont: resolvedOverlayFont,
      bandStyle: resolvedBandStyle,
      bandColor: resolvedBandColor,
      bandTextColor: resolvedBandTextColor,
      overlayBodyColor: resolvedBodyColor,
      overlayStrongColor: resolvedStrongColor,
      generatedAt: new Date(),
    });

    res.status(201).json(toResponse(doc));
  } catch (err) {
    res.status(502).json({ message: 'Generation failed', error: err instanceof Error ? err.message : 'Unknown error' });
  }
}

export async function updateImagePost(req: Request, res: Response): Promise<void> {
  const doc = await ImagePost.findById(req.params.id);
  if (!doc) { res.status(404).json({ message: 'ImagePost not found' }); return; }

  const {
    slides,
    mode,
    bodyFontSize,
    status,
    caption,
    overlayFont: patchFont,
    bandStyle: patchBandStyle,
    bandColor: patchBandColor,
    bandTextColor: patchBandTextColor,
    overlayBodyColor: patchBodyColor,
    overlayStrongColor: patchStrongColor,
  } = req.body as {
    slides?: Array<{ backgroundUrl: string; overlayText: string }>;
    mode?: ImagePostMode;
    bodyFontSize?: number;
    status?: string;
    caption?: string;
    overlayFont?: ImagePostOverlayFont;
    bandStyle?: ImagePostBandStyle;
    bandColor?: string;
    bandTextColor?: string;
    overlayBodyColor?: string;
    overlayStrongColor?: string;
  };

  if (mode !== undefined) doc.mode = mode;
  if (bodyFontSize !== undefined) doc.bodyFontSize = bodyFontSize;
  if (status !== undefined) doc.status = status as 'Rascunho' | 'Aprovado' | 'Publicado';
  if (caption !== undefined) doc.caption = caption;
  if (patchFont !== undefined) doc.overlayFont = patchFont;
  if (patchBandStyle !== undefined) doc.bandStyle = patchBandStyle;
  if (patchBandColor !== undefined) doc.bandColor = patchBandColor;
  if (patchBandTextColor !== undefined) doc.bandTextColor = patchBandTextColor;
  if (patchBodyColor !== undefined) doc.overlayBodyColor = patchBodyColor;
  if (patchStrongColor !== undefined) doc.overlayStrongColor = patchStrongColor;

  const visualPatch =
    patchFont !== undefined ||
    patchBandStyle !== undefined ||
    patchBandColor !== undefined ||
    patchBandTextColor !== undefined ||
    patchBodyColor !== undefined ||
    patchStrongColor !== undefined;

  const needsRebuild =
    slides !== undefined || mode !== undefined || bodyFontSize !== undefined || (visualPatch && !isPreviewPhase(doc));

  if (slides !== undefined) {
    const brandColors = doc.brandColors ?? [];
    const total = slides.length;
    const isPanoramic = doc.layout === 'panoramic';
    const buildSlide = isPanoramic ? buildPanoramicSlideHtml : buildImageOverlayHtml;
    const v = slideVisualForDoc(doc);
    doc.slides = slides.map((s, i) => ({
      backgroundUrl: s.backgroundUrl,
      overlayText: s.overlayText,
      overlayHtml: buildSlide(s.overlayText, s.backgroundUrl, doc.mode, doc.bodyFontSize, brandColors, i, total, doc.profileName, doc.profileImageUrl, v),
    }));
    if (!isPanoramic) doc.layout = total > 1 ? 'carousel' : 'static';
  } else if (needsRebuild) {
    const brandColors = doc.brandColors ?? [];
    const total = doc.slides.length;
    const buildSlide = doc.layout === 'panoramic' ? buildPanoramicSlideHtml : buildImageOverlayHtml;
    const v = slideVisualForDoc(doc);
    doc.slides = doc.slides.map((s, i) => ({
      backgroundUrl: s.backgroundUrl,
      overlayText: s.overlayText,
      overlayHtml: buildSlide(s.overlayText, s.backgroundUrl, doc.mode, doc.bodyFontSize, brandColors, i, total, doc.profileName, doc.profileImageUrl, v),
    }));
  }

  await doc.save();
  res.json(toResponse(doc));
}

export async function finalizeImagePostOverlay(req: Request, res: Response): Promise<void> {
  const doc = await ImagePost.findById(req.params.id);
  if (!doc) { res.status(404).json({ message: 'ImagePost not found' }); return; }

  const b = req.body as {
    overlayFont?: ImagePostOverlayFont;
    bandStyle?: ImagePostBandStyle;
    bandColor?: string;
    bandTextColor?: string;
    overlayBodyColor?: string;
    overlayStrongColor?: string;
  };

  if (b.overlayFont !== undefined) doc.overlayFont = b.overlayFont;
  if (b.bandStyle !== undefined) doc.bandStyle = b.bandStyle;
  if (b.bandColor !== undefined) doc.bandColor = b.bandColor;
  if (b.bandTextColor !== undefined) doc.bandTextColor = b.bandTextColor;
  if (b.overlayBodyColor !== undefined) doc.overlayBodyColor = b.overlayBodyColor;
  if (b.overlayStrongColor !== undefined) doc.overlayStrongColor = b.overlayStrongColor;

  doc.overlayPhase = 'final';
  const brandColors = doc.brandColors ?? [];
  const total = doc.slides.length;
  const buildSlide = doc.layout === 'panoramic' ? buildPanoramicSlideHtml : buildImageOverlayHtml;
  const v = finalVisualFromDoc(doc);
  doc.slides = doc.slides.map((s, i) => ({
    backgroundUrl: s.backgroundUrl,
    overlayText: s.overlayText,
    overlayHtml: buildSlide(s.overlayText, s.backgroundUrl, doc.mode, doc.bodyFontSize, brandColors, i, total, doc.profileName, doc.profileImageUrl, v),
  }));

  await doc.save();
  res.json(toResponse(doc));
}

export async function suggestSlideAlternateBackgrounds(req: Request, res: Response): Promise<void> {
  if (!env.UNSPLASH_ACCESS_KEY) {
    res.status(503).json({ message: 'UNSPLASH_ACCESS_KEY is not configured' });
    return;
  }
  const doc = await ImagePost.findById(req.params.id);
  if (!doc) { res.status(404).json({ message: 'ImagePost not found' }); return; }
  const index = parseInt(req.params.index, 10);
  if (isNaN(index) || index < 0 || index >= doc.slides.length) {
    res.status(400).json({ message: `Slide index out of range (0–${doc.slides.length - 1})` });
    return;
  }
  const page = Math.max(1, parseInt(String((req.body as { page?: number })?.page ?? 1), 10) || 1);
  const query = doc.imageSearchQuery?.trim() || 'medical healthcare education';
  const orientation = doc.layout === 'panoramic' ? 'landscape' : 'squarish';
  try {
    const urls = await searchAlternateBackgroundUrls(query, page, orientation, 12);
    res.json({ urls, query, page, slideIndex: index });
  } catch (err) {
    res.status(502).json({ message: 'Image search failed', error: err instanceof Error ? err.message : 'Unknown error' });
  }
}

export async function uploadSlideBackground(req: Request, res: Response): Promise<void> {
  if (!env.AWS_S3_BUCKET) {
    res.status(503).json({ message: 'AWS_S3_BUCKET is not configured' });
    return;
  }
  const doc = await ImagePost.findById(req.params.id);
  if (!doc) { res.status(404).json({ message: 'ImagePost not found' }); return; }
  const index = parseInt(req.params.index, 10);
  if (isNaN(index) || index < 0 || index >= doc.slides.length) {
    res.status(400).json({ message: `Slide index out of range (0–${doc.slides.length - 1})` });
    return;
  }
  const file = req.file;
  if (!file) { res.status(400).json({ message: 'No file provided (field: file)' }); return; }

  const ext = file.mimetype.split('/')[1] ?? 'jpg';
  const key = `image-posts/${doc._id}/slide-${index}-${Date.now()}.${ext}`;
  const s3Url = await uploadBuffer(file.buffer, key, file.mimetype);
  if (!s3Url) {
    res.status(502).json({ message: 'Upload to S3 failed' });
    return;
  }

  doc.slides[index].backgroundUrl = s3Url;
  const brandColors = doc.brandColors ?? [];
  const total = doc.slides.length;
  const buildSlide = doc.layout === 'panoramic' ? buildPanoramicSlideHtml : buildImageOverlayHtml;
  const v = slideVisualForDoc(doc);
  doc.slides[index].overlayHtml = buildSlide(
    doc.slides[index].overlayText,
    s3Url,
    doc.mode,
    doc.bodyFontSize,
    brandColors,
    index,
    total,
    doc.profileName,
    doc.profileImageUrl,
    v,
  );
  doc.markModified('slides');
  await doc.save();
  res.json({ backgroundUrl: s3Url, slideIndex: index, ...toResponse(doc) });
}

export async function deleteImagePost(req: Request, res: Response): Promise<void> {
  const doc = await ImagePost.findByIdAndDelete(req.params.id);
  if (!doc) { res.status(404).json({ message: 'ImagePost not found' }); return; }
  res.status(204).send();
}

export async function exportImageSlide(req: Request, res: Response): Promise<void> {
  const doc = await ImagePost.findById(req.params.id);
  if (!doc) { res.status(404).json({ message: 'ImagePost not found' }); return; }
  const index = parseInt(req.params.index, 10);
  if (isNaN(index) || index < 0 || index >= doc.slides.length) {
    res.status(400).json({ message: `Slide index out of range (0–${doc.slides.length - 1})` });
    return;
  }
  try {
    await streamSlideAsPng(doc.slides[index].overlayHtml, `image-post-${doc._id}-slide-${index + 1}`, res);
  } catch (err) {
    if (!res.headersSent) res.status(502).json({ message: 'Export failed', error: err instanceof Error ? err.message : 'Unknown error' });
  }
}

export async function exportImagePost(req: Request, res: Response): Promise<void> {
  const doc = await ImagePost.findById(req.params.id);
  if (!doc) { res.status(404).json({ message: 'ImagePost not found' }); return; }
  if (!doc.slides.length) { res.status(422).json({ message: 'Post has no slides to export' }); return; }
  try {
    await streamSlidesAsZip(doc.slides.map((s) => s.overlayHtml), `image-post-${doc._id}`, res);
  } catch (err) {
    if (!res.headersSent) res.status(502).json({ message: 'Export failed', error: err instanceof Error ? err.message : 'Unknown error' });
  }
}

export async function previewImageSlide(req: Request, res: Response): Promise<void> {
  const doc = await ImagePost.findById(req.params.id);
  if (!doc) { res.status(404).send('Not found'); return; }
  const index = parseInt(req.params.index, 10);
  if (isNaN(index) || index < 0 || index >= doc.slides.length) {
    res.status(400).send('Slide index out of range');
    return;
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(doc.slides[index].overlayHtml);
}

export async function saveImageSlideHtml(req: Request, res: Response): Promise<void> {
  const doc = await ImagePost.findById(req.params.id);
  if (!doc) { res.status(404).json({ message: 'ImagePost not found' }); return; }
  const index = parseInt(req.params.index, 10);
  if (isNaN(index) || index < 0 || index >= doc.slides.length) {
    res.status(400).json({ message: `Slide index out of range (0–${doc.slides.length - 1})` });
    return;
  }

  const { overlayHtml, overlayText } = req.body as { overlayHtml?: string; overlayText?: string };
  if (!overlayHtml && !overlayText) {
    res.status(400).json({ message: 'Provide overlayHtml and/or overlayText' });
    return;
  }

  if (overlayHtml !== undefined) doc.slides[index].overlayHtml = overlayHtml;
  if (overlayText !== undefined) doc.slides[index].overlayText = overlayText;
  doc.markModified('slides');

  await doc.save();
  res.json(toResponse(doc));
}

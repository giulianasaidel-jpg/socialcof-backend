import { Request, Response } from 'express';
import { Draft } from '../models/Draft';
import { Product } from '../models/Product';
import { InstagramAccount } from '../models/InstagramAccount';
import { MedicalNews } from '../models/MedicalNews';
import { generateDraft as generateDraftContent } from '../services/postGenerator';
import { scrapeUrl } from '../services/urlScraper';
import type { TemplateType } from '../models/Draft';

/**
 * Maps a Draft document to the API response shape.
 */
function toResponse(
  draft: InstanceType<typeof Draft>,
  productExternalId: string,
  accountExternalId: string,
) {
  return {
    id: draft._id.toString(),
    productId: productExternalId,
    accountId: accountExternalId,
    title: draft.title,
    type: draft.type,
    templateType: draft.templateType ?? null,
    basedOnUrl: draft.basedOnUrl ?? null,
    caption: draft.caption,
    hashtags: draft.hashtags ?? [],
    slides: draft.slides ?? [],
    status: draft.status,
    createdBy: draft.createdBy?.toString(),
    generatedAt: draft.generatedAt ?? null,
    createdAt: draft.createdAt,
  };
}

/**
 * GET /drafts — Lists all drafts (optionally filtered by workspace via query).
 */
export async function listDrafts(req: Request, res: Response): Promise<void> {
  const drafts = await Draft.find()
    .populate<{ productId: InstanceType<typeof Product> }>('productId')
    .populate<{ accountId: InstanceType<typeof InstagramAccount> }>('accountId');

  res.json(
    drafts.map((d) => {
      const product = d.productId as unknown as InstanceType<typeof Product>;
      const account = d.accountId as unknown as InstanceType<typeof InstagramAccount>;
      return toResponse(d as unknown as InstanceType<typeof Draft>, product?.externalId ?? '', account?.externalId ?? '');
    }),
  );
}

/**
 * GET /drafts/:id — Returns a single draft by id.
 */
export async function getDraft(req: Request, res: Response): Promise<void> {
  const draft = await Draft.findById(req.params.id)
    .populate<{ productId: InstanceType<typeof Product> }>('productId')
    .populate<{ accountId: InstanceType<typeof InstagramAccount> }>('accountId');

  if (!draft) {
    res.status(404).json({ message: 'Draft not found' });
    return;
  }

  const product = draft.productId as unknown as InstanceType<typeof Product>;
  const account = draft.accountId as unknown as InstanceType<typeof InstagramAccount>;
  res.json(toResponse(draft as unknown as InstanceType<typeof Draft>, product?.externalId ?? '', account?.externalId ?? ''));
}

/**
 * POST /drafts — Creates a new draft.
 */
export async function createDraft(req: Request, res: Response): Promise<void> {
  const { productId, accountId, ...rest } = req.body;

  const [product, account] = await Promise.all([
    Product.findOne({ externalId: productId }),
    InstagramAccount.findOne({ externalId: accountId }),
  ]);

  if (!product) {
    res.status(400).json({ message: 'Product not found' });
    return;
  }
  if (!account) {
    res.status(400).json({ message: 'Instagram account not found' });
    return;
  }

  const draft = await Draft.create({
    ...rest,
    productId: product._id,
    accountId: account._id,
    createdBy: req.user!.userId,
  });

  res.status(201).json(toResponse(draft, productId, accountId));
}

/**
 * PATCH /drafts/:id — Updates draft status, title, or caption.
 */
export async function updateDraft(req: Request, res: Response): Promise<void> {
  const draft = await Draft.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true })
    .populate<{ productId: InstanceType<typeof Product> }>('productId')
    .populate<{ accountId: InstanceType<typeof InstagramAccount> }>('accountId');

  if (!draft) {
    res.status(404).json({ message: 'Draft not found' });
    return;
  }

  const product = draft.productId as unknown as InstanceType<typeof Product>;
  const account = draft.accountId as unknown as InstanceType<typeof InstagramAccount>;
  res.json(toResponse(draft as unknown as InstanceType<typeof Draft>, product?.externalId ?? '', account?.externalId ?? ''));
}

/**
 * DELETE /drafts/:id — Removes a draft.
 */
export async function deleteDraft(req: Request, res: Response): Promise<void> {
  const draft = await Draft.findByIdAndDelete(req.params.id);
  if (!draft) {
    res.status(404).json({ message: 'Draft not found' });
    return;
  }
  res.status(204).send();
}

/**
 * POST /drafts/generate — Uses GPT-4o to generate a full draft (caption, hashtags, slides) from a topic and template type.
 */
export async function generateDraft(req: Request, res: Response): Promise<void> {
  const {
    accountId,
    productId,
    templateType,
    topic,
    tone,
    slideCount,
    referenceCaption,
    sourceUrl,
    sourceNewsId,
    basedOnUrl,
  } = req.body as {
    accountId?: string;
    productId?: string;
    templateType?: TemplateType;
    topic?: string;
    tone?: string;
    slideCount?: number;
    referenceCaption?: string;
    sourceUrl?: string;
    sourceNewsId?: string;
    basedOnUrl?: string;
  };

  if (!accountId || !productId || !templateType || !topic) {
    res.status(400).json({ message: 'accountId, productId, templateType and topic are required' });
    return;
  }

  const validTemplates: TemplateType[] = [
    'twitter-quote',
    'carousel-tips',
    'carousel-numbered',
    'carousel-before-after',
    'carousel-story',
    'static-announcement',
  ];

  if (!validTemplates.includes(templateType)) {
    res.status(400).json({ message: `templateType must be one of: ${validTemplates.join(', ')}` });
    return;
  }

  const [product, account] = await Promise.all([
    Product.findOne({ externalId: productId }),
    InstagramAccount.findOne({ externalId: accountId }),
  ]);

  if (!product) { res.status(400).json({ message: 'Product not found' }); return; }
  if (!account) { res.status(400).json({ message: 'Instagram account not found' }); return; }

  let sourceContent: string | undefined;
  let resolvedSourceUrl = basedOnUrl;

  try {
    if (sourceNewsId) {
      const news = await MedicalNews.findById(sourceNewsId);
      if (!news) { res.status(400).json({ message: 'MedicalNews not found' }); return; }
      sourceContent = `${news.title}\n\n${news.summary}`;
      resolvedSourceUrl = resolvedSourceUrl ?? news.url;
    } else if (sourceUrl) {
      const scraped = await scrapeUrl(sourceUrl);
      sourceContent = `${scraped.title}\n\n${scraped.text}`;
      resolvedSourceUrl = resolvedSourceUrl ?? sourceUrl;
    }
  } catch (err) {
    res.status(502).json({ message: 'Failed to fetch source content', error: err instanceof Error ? err.message : 'Unknown error' });
    return;
  }

  try {
    const generated = await generateDraftContent({
      templateType,
      topic,
      accountHandle: account.handle,
      tone,
      slideCount,
      referenceCaption,
      sourceContent,
    });

    const draft = await Draft.create({
      productId: product._id,
      accountId: account._id,
      createdBy: req.user!.userId,
      title: generated.title,
      type: generated.format,
      templateType: generated.templateType,
      caption: generated.caption,
      hashtags: generated.hashtags,
      slides: generated.slides,
      basedOnUrl: resolvedSourceUrl ?? null,
      status: 'Rascunho',
      generatedAt: new Date(),
    });

    res.status(201).json(toResponse(draft, productId, accountId));
  } catch (err) {
    res.status(502).json({ message: 'Generation failed', error: err instanceof Error ? err.message : 'Unknown error' });
  }
}

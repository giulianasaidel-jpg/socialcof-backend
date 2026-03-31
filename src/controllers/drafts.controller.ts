import { Request, Response } from 'express';
import { Draft } from '../models/Draft';
import { Product } from '../models/Product';
import { InstagramAccount } from '../models/InstagramAccount';

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
    basedOnUrl: draft.basedOnUrl,
    caption: draft.caption,
    status: draft.status,
    createdBy: draft.createdBy?.toString(),
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

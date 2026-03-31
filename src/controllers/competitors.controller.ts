import { Request, Response } from 'express';
import { Competitor } from '../models/Competitor';
import { Product } from '../models/Product';

/**
 * Maps a Competitor document to the API response shape.
 */
function toResponse(competitor: InstanceType<typeof Competitor>, productExternalId: string) {
  return {
    id: competitor._id.toString(),
    productId: productExternalId,
    handle: competitor.handle,
    displayName: competitor.displayName,
    profileUrl: competitor.profileUrl,
    followers: competitor.followers,
    avgLikesPerPost: competitor.avgLikesPerPost,
    engagementRatePct: competitor.engagementRatePct,
    publishedPostsCount: competitor.publishedPostsCount,
    insightsToBorrow: competitor.insightsToBorrow,
    isManual: competitor.isManual,
  };
}

/**
 * GET /competitors — Lists competitors filtered by accountId (maps to productId via query).
 */
export async function listCompetitors(req: Request, res: Response): Promise<void> {
  const { accountId } = req.query as Record<string, string>;
  const filter: Record<string, unknown> = {};

  if (accountId) {
    const product = await Product.findOne({ linkedInstagramAccountIds: accountId });
    if (product) filter.productId = product._id;
  }

  const competitors = await Competitor.find(filter).populate<{ productId: InstanceType<typeof Product> }>('productId');
  res.json(
    competitors.map((c) => {
      const product = c.productId as unknown as InstanceType<typeof Product>;
      return toResponse(c as unknown as InstanceType<typeof Competitor>, product?.externalId ?? '');
    }),
  );
}

/**
 * POST /competitors — Adds a competitor manually.
 */
export async function createCompetitor(req: Request, res: Response): Promise<void> {
  const { productId, ...rest } = req.body;

  const product = await Product.findOne({ externalId: productId });
  if (!product) {
    res.status(400).json({ message: 'Product not found' });
    return;
  }

  const competitor = await Competitor.create({ ...rest, productId: product._id, isManual: true });
  res.status(201).json(toResponse(competitor, productId));
}

/**
 * PATCH /competitors/:id — Updates competitor metrics.
 */
export async function updateCompetitor(req: Request, res: Response): Promise<void> {
  const competitor = await Competitor.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true }).populate<{
    productId: InstanceType<typeof Product>;
  }>('productId');
  if (!competitor) {
    res.status(404).json({ message: 'Competitor not found' });
    return;
  }
  const product = competitor.productId as unknown as InstanceType<typeof Product>;
  res.json(toResponse(competitor as unknown as InstanceType<typeof Competitor>, product?.externalId ?? ''));
}

/**
 * DELETE /competitors/:id — Removes a competitor.
 */
export async function deleteCompetitor(req: Request, res: Response): Promise<void> {
  const competitor = await Competitor.findByIdAndDelete(req.params.id);
  if (!competitor) {
    res.status(404).json({ message: 'Competitor not found' });
    return;
  }
  res.status(204).send();
}

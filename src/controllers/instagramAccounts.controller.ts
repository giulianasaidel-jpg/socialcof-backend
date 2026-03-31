import { Request, Response } from 'express';
import { InstagramAccount } from '../models/InstagramAccount';
import { InstagramSyncLog } from '../models/InstagramSyncLog';

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
 * POST /instagram-accounts/:id/sync — Triggers a manual sync and logs the attempt.
 */
export async function syncAccount(req: Request, res: Response): Promise<void> {
  const account = await InstagramAccount.findOne({ externalId: req.params.id });
  if (!account) {
    res.status(404).json({ message: 'Account not found' });
    return;
  }

  // TODO: integrate Meta API to pull real metrics here
  await InstagramSyncLog.create({
    accountId: account._id,
    at: new Date(),
    level: 'ok',
    message: 'Manual sync triggered',
  });

  account.lastSyncAt = new Date();
  await account.save();

  res.json({ message: 'Sync triggered', lastSyncAt: account.lastSyncAt });
}

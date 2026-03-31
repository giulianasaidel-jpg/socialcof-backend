import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { User } from '../models/User';

const SALT_ROUNDS = 10;

/**
 * Maps a User document to the API response shape (no passwordHash).
 */
function toResponse(user: InstanceType<typeof User>) {
  return {
    id: user._id.toString(),
    email: user.email,
    role: user.role,
    allowedInstagramAccountIds: user.allowedInstagramAccountIds,
    createdAt: user.createdAt,
  };
}

/**
 * GET /admin/users — Lists all users.
 */
export async function listUsers(req: Request, res: Response): Promise<void> {
  const users = await User.find().select('-passwordHash');
  res.json(users.map(toResponse));
}

/**
 * POST /admin/users — Invites a new user by e-mail with a temporary password (role required).
 */
export async function createUser(req: Request, res: Response): Promise<void> {
  const { email, role, allowedInstagramAccountIds, password } = req.body;

  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) {
    res.status(409).json({ message: 'User already exists' });
    return;
  }

  const temporaryPassword = password ?? Math.random().toString(36).slice(-10);
  const passwordHash = await bcrypt.hash(temporaryPassword, SALT_ROUNDS);

  const user = await User.create({ email, role, allowedInstagramAccountIds, passwordHash });

  res.status(201).json({
    ...toResponse(user),
    temporaryPassword: password ? undefined : temporaryPassword,
  });
}

/**
 * PATCH /admin/users/:id — Updates a user's role or allowed accounts.
 */
export async function updateUser(req: Request, res: Response): Promise<void> {
  const { role, allowedInstagramAccountIds } = req.body;
  const update: Record<string, unknown> = {};
  if (role) update.role = role;
  if (allowedInstagramAccountIds) update.allowedInstagramAccountIds = allowedInstagramAccountIds;

  const user = await User.findByIdAndUpdate(req.params.id, { $set: update }, { new: true });
  if (!user) {
    res.status(404).json({ message: 'User not found' });
    return;
  }
  res.json(toResponse(user));
}

/**
 * DELETE /admin/users/:id — Removes a user.
 */
export async function deleteUser(req: Request, res: Response): Promise<void> {
  const user = await User.findByIdAndDelete(req.params.id);
  if (!user) {
    res.status(404).json({ message: 'User not found' });
    return;
  }
  res.status(204).send();
}

/**
 * GET /admin/users/:id/accounts — Returns the list of allowed Instagram accounts for a user.
 */
export async function getUserAccounts(req: Request, res: Response): Promise<void> {
  const user = await User.findById(req.params.id).select('allowedInstagramAccountIds');
  if (!user) {
    res.status(404).json({ message: 'User not found' });
    return;
  }
  res.json({ allowedInstagramAccountIds: user.allowedInstagramAccountIds });
}

/**
 * PUT /admin/users/:id/accounts — Replaces the allowed Instagram accounts list for a user.
 */
export async function setUserAccounts(req: Request, res: Response): Promise<void> {
  const { allowedInstagramAccountIds } = req.body;

  const user = await User.findByIdAndUpdate(
    req.params.id,
    { $set: { allowedInstagramAccountIds } },
    { new: true },
  );
  if (!user) {
    res.status(404).json({ message: 'User not found' });
    return;
  }
  res.json(toResponse(user));
}

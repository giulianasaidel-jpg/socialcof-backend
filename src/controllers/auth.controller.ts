import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import { User } from '../models/User';
import { env } from '../config/env';
import { JwtPayload } from '../middleware/auth';

const ALLOWED_DOMAIN = 'grupomedcof.com.br';
const googleClient = new OAuth2Client(env.GOOGLE_CLIENT_ID);

const refreshTokenStore = new Map<string, string>();

/**
 * Builds and returns a signed access token JWT for the given user payload.
 */
function signAccessToken(payload: JwtPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN } as jwt.SignOptions);
}

/**
 * Builds and returns a signed refresh token JWT using the dedicated refresh secret.
 */
function signRefreshToken(payload: JwtPayload): string {
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, { expiresIn: env.JWT_REFRESH_EXPIRES_IN } as jwt.SignOptions);
}

/**
 * POST /auth/login — Authenticates user by email/password, returns access and refresh tokens.
 */
export async function login(req: Request, res: Response): Promise<void> {
  const { email, password } = req.body;

  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) {
    res.status(401).json({ message: 'Invalid credentials' });
    return;
  }

  if (!user.passwordHash) {
    res.status(401).json({ message: 'Invalid credentials' });
    return;
  }

  const isValid = await bcrypt.compare(password, user.passwordHash);
  if (!isValid) {
    res.status(401).json({ message: 'Invalid credentials' });
    return;
  }

  const payload: JwtPayload = {
    userId: user._id.toString(),
    role: user.role,
    allowedInstagramAccountIds: user.allowedInstagramAccountIds,
  };

  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);

  refreshTokenStore.set(refreshToken, user._id.toString());

  res.json({
    accessToken,
    refreshToken,
    user: {
      id: user._id.toString(),
      email: user.email,
      role: user.role,
      allowedInstagramAccountIds: user.allowedInstagramAccountIds,
    },
  });
}

/**
 * POST /auth/refresh — Exchanges a valid refresh token for a new access token.
 */
export async function refresh(req: Request, res: Response): Promise<void> {
  const { refreshToken } = req.body;

  if (!refreshToken || !refreshTokenStore.has(refreshToken)) {
    res.status(401).json({ message: 'Invalid refresh token' });
    return;
  }

  try {
    const payload = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET) as JwtPayload;
    const accessToken = signAccessToken({
      userId: payload.userId,
      role: payload.role,
      allowedInstagramAccountIds: payload.allowedInstagramAccountIds,
    });
    res.json({ accessToken });
  } catch {
    refreshTokenStore.delete(refreshToken);
    res.status(401).json({ message: 'Invalid or expired refresh token' });
  }
}

/**
 * POST /auth/logout — Invalidates the given refresh token.
 */
export function logout(req: Request, res: Response): void {
  const { refreshToken } = req.body;
  if (refreshToken) {
    refreshTokenStore.delete(refreshToken);
  }
  res.status(204).send();
}

/**
 * POST /auth/google — Verifies a Google ID token, enforces the grupomedcof.com.br domain,
 * finds or creates the user, and returns access and refresh tokens.
 */
export async function googleLogin(req: Request, res: Response): Promise<void> {
  const { idToken } = req.body;

  if (!idToken) {
    res.status(400).json({ message: 'idToken is required' });
    return;
  }

  let ticket;
  try {
    ticket = await googleClient.verifyIdToken({
      idToken,
      audience: env.GOOGLE_CLIENT_ID,
    });
  } catch {
    res.status(401).json({ message: 'Invalid Google token' });
    return;
  }

  const googlePayload = ticket.getPayload();
  if (!googlePayload?.email || !googlePayload.sub) {
    res.status(401).json({ message: 'Invalid Google token payload' });
    return;
  }

  const { email, sub: googleId } = googlePayload;

  if (!email.endsWith(`@${ALLOWED_DOMAIN}`)) {
    res.status(403).json({ message: `Only ${ALLOWED_DOMAIN} accounts are allowed` });
    return;
  }

  let user = await User.findOne({ email: email.toLowerCase() });

  if (!user) {
    user = await User.create({
      email: email.toLowerCase(),
      googleId,
      role: 'viewer',
      allowedInstagramAccountIds: [],
    });
  } else if (!user.googleId) {
    user.googleId = googleId;
    await user.save();
  }

  const payload: JwtPayload = {
    userId: user._id.toString(),
    role: user.role,
    allowedInstagramAccountIds: user.allowedInstagramAccountIds,
  };

  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);

  refreshTokenStore.set(refreshToken, user._id.toString());

  res.json({
    accessToken,
    refreshToken,
    user: {
      id: user._id.toString(),
      email: user.email,
      role: user.role,
      allowedInstagramAccountIds: user.allowedInstagramAccountIds,
    },
  });
}

/**
 * GET /auth/me — Returns the profile of the authenticated user.
 */
export async function me(req: Request, res: Response): Promise<void> {
  const user = await User.findById(req.user?.userId).select('-passwordHash');
  if (!user) {
    res.status(404).json({ message: 'User not found' });
    return;
  }
  res.json(user);
}

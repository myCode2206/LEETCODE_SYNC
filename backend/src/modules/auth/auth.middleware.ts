import type { RequestHandler, Response } from 'express';
import { AppError } from '../../common/app-error.js';
import type { AuthContext, AuthService } from './auth.service.js';

export function requireSession(auth: AuthService): RequestHandler {
  return async (req, res, next) => {
    const header = req.get('authorization');
    const token = header?.match(/^Bearer\s+(\S+)$/i)?.[1];
    res.locals.auth = await auth.authenticate(token);
    next();
  };
}

export function authOf(res: Response): AuthContext {
  const ctx = res.locals.auth as AuthContext | undefined;
  if (!ctx) throw new AppError('UNAUTHENTICATED', 'Please connect GitHub to continue.');
  return ctx;
}

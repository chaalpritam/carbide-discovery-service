import jwt from 'jsonwebtoken';
import type { SignOptions } from 'jsonwebtoken';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { AuthContext } from './auth.js';

export interface JwtPayload {
  keyId: number;
  role: 'admin' | 'provider';
  iat?: number;
  exp?: number;
}

export function signToken(
  payload: { keyId: number; role: string },
  secret: string,
  expiresIn: string
): string {
  const opts: SignOptions = { expiresIn: expiresIn as SignOptions['expiresIn'] };
  return jwt.sign(payload, secret, opts);
}

export function verifyToken(token: string, secret: string): JwtPayload {
  return jwt.verify(token, secret) as JwtPayload;
}

export function createBearerAuthHook(jwtSecret: string) {
  return function tryBearer(request: FastifyRequest, _reply: FastifyReply): boolean {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return false;
    }

    try {
      const token = authHeader.slice(7);
      const payload = verifyToken(token, jwtSecret);
      (request as FastifyRequest & { authContext: AuthContext }).authContext = {
        keyId: payload.keyId,
        role: payload.role,
      };
      return true;
    } catch {
      return false;
    }
  };
}

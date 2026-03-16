// ============================================================
// Stub Auth Middleware
// For local dev: uses a simple token = base64(userId)
// NOT FOR PRODUCTION - no password, no JWT signing
// ============================================================

import { Request, Response, NextFunction } from 'express';
import { query } from '../db/client.js';

// Extend Express Request to include user
declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

interface UserRow {
  id: string;
  email: string;
  name: string | null;
}

/**
 * Stub auth middleware - extracts userId from Authorization header
 * Format: "Bearer <base64(userId)>"
 */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const token = authHeader.slice(7); // Remove "Bearer "

  try {
    // Decode userId from token (stub: token is just base64(userId))
    const userId = Buffer.from(token, 'base64').toString('utf-8');

    // Verify user exists
    const result = await query<UserRow>(
      'SELECT id, email, name FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }

    req.userId = userId;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

/**
 * Generate a stub token for a userId
 */
export function generateToken(userId: string): string {
  return Buffer.from(userId).toString('base64');
}


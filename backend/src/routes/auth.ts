// ============================================================
// Auth Routes (Stub for Local Dev)
// Creates user by email, returns token
// ============================================================

import { Router } from 'express';
import crypto from 'crypto';
import { query } from '../db/client.js';
import { requireAuth, generateToken } from '../middleware/auth.js';

const router = Router();

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  created_at: Date;
}

// POST /auth/login - Create or get user by email
router.post('/login', async (req, res) => {
  const { email } = req.body;

  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'Email is required' });
  }

  const normalizedEmail = email.toLowerCase().trim();

  try {
    // Check if user exists
    let result = await query<UserRow>(
      'SELECT id, email, name, created_at FROM users WHERE email = $1',
      [normalizedEmail]
    );

    let user: UserRow;
    let isNewUser = false;

    if (result.rows.length === 0) {
      // Create new user
      const id = crypto.randomUUID();
      await query(
        'INSERT INTO users (id, email) VALUES ($1, $2)',
        [id, normalizedEmail]
      );

      result = await query<UserRow>(
        'SELECT id, email, name, created_at FROM users WHERE id = $1',
        [id]
      );
      user = result.rows[0];
      isNewUser = true;
    } else {
      user = result.rows[0];
    }

    const token = generateToken(user.id);

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
      token,
      isNewUser,
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// GET /auth/me - Get current user
router.get('/me', requireAuth, async (req, res) => {
  try {
    const result = await query<UserRow>(
      'SELECT id, email, name, created_at FROM users WHERE id = $1',
      [req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = result.rows[0];
    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
    });
  } catch (err) {
    console.error('Get user error:', err);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

export default router;


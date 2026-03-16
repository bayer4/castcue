// ============================================================
// User Topics Routes
// CRUD for a user's subscribed topics
// ============================================================

import { Router } from 'express';
import { query } from '../db/client.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

interface UserTopicRow {
  id: number;
  user_id: string;
  name: string;
  created_at: Date;
}

// All routes require auth
router.use(requireAuth);

// GET /user-topics - List user's topics
router.get('/', async (req, res) => {
  try {
    const result = await query<UserTopicRow>(
      `SELECT id, name, created_at FROM user_topics 
       WHERE user_id = $1 
       ORDER BY created_at DESC`,
      [req.userId]
    );

    res.json({
      topics: result.rows.map(row => ({
        id: row.id,
        name: row.name,
        createdAt: row.created_at,
      })),
    });
  } catch (err) {
    console.error('Error listing user topics:', err);
    res.status(500).json({ error: 'Failed to list topics' });
  }
});

// POST /user-topics - Add a topic
router.post('/', async (req, res) => {
  const { name } = req.body;

  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'Name is required' });
  }

  const normalizedName = name.toLowerCase().trim();

  if (normalizedName.length < 2) {
    return res.status(400).json({ error: 'Topic must be at least 2 characters' });
  }

  try {
    const result = await query<UserTopicRow>(
      `INSERT INTO user_topics (user_id, name) 
       VALUES ($1, $2) 
       RETURNING id, name, created_at`,
      [req.userId, normalizedName]
    );

    const topic = result.rows[0];
    res.status(201).json({
      id: topic.id,
      name: topic.name,
      createdAt: topic.created_at,
    });
  } catch (err: any) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Topic already exists' });
    }
    console.error('Error adding topic:', err);
    res.status(500).json({ error: 'Failed to add topic' });
  }
});

// DELETE /user-topics/:id - Remove a topic
router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);

  if (isNaN(id)) {
    return res.status(400).json({ error: 'Invalid topic ID' });
  }

  try {
    const result = await query(
      `DELETE FROM user_topics WHERE id = $1 AND user_id = $2`,
      [id, req.userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Topic not found' });
    }

    res.status(204).send();
  } catch (err) {
    console.error('Error deleting topic:', err);
    res.status(500).json({ error: 'Failed to delete topic' });
  }
});

export default router;


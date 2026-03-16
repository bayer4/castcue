// ============================================================
// Topics CRUD Routes
// ============================================================

import { Router } from 'express';
import { query } from '../db/client.js';
import crypto from 'crypto';

const router = Router();

interface TopicRow {
  id: string;
  name: string;
  description: string | null;
  created_at: Date;
}

// List all topics
router.get('/', async (req, res) => {
  try {
    const result = await query<TopicRow>(
      `SELECT id, name, description, created_at
       FROM topics
       ORDER BY created_at DESC`
    );

    res.json({
      topics: result.rows.map(row => ({
        id: row.id,
        name: row.name,
        description: row.description,
        createdAt: row.created_at,
      })),
    });
  } catch (err) {
    console.error('Error listing topics:', err);
    res.status(500).json({ error: 'Failed to list topics' });
  }
});

// Get single topic
router.get('/:id', async (req, res) => {
  try {
    const result = await query<TopicRow>(
      `SELECT id, name, description, created_at
       FROM topics
       WHERE id = $1`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Topic not found' });
    }

    const row = result.rows[0];
    res.json({
      id: row.id,
      name: row.name,
      description: row.description,
      createdAt: row.created_at,
    });
  } catch (err) {
    console.error('Error getting topic:', err);
    res.status(500).json({ error: 'Failed to get topic' });
  }
});

// Create topic
router.post('/', async (req, res) => {
  const { name, description } = req.body;

  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'Name is required' });
  }

  try {
    const id = crypto.randomUUID();

    await query(
      `INSERT INTO topics (id, name, description)
       VALUES ($1, $2, $3)`,
      [id, name.trim(), description?.trim() || null]
    );

    res.status(201).json({
      id,
      name: name.trim(),
      description: description?.trim() || null,
    });
  } catch (err: any) {
    if (err.code === '23505') {
      // Unique violation
      return res.status(409).json({ error: 'Topic with this name already exists' });
    }
    console.error('Error creating topic:', err);
    res.status(500).json({ error: 'Failed to create topic' });
  }
});

// Update topic
router.put('/:id', async (req, res) => {
  const { name, description } = req.body;

  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'Name is required' });
  }

  try {
    const result = await query(
      `UPDATE topics
       SET name = $1, description = $2
       WHERE id = $3
       RETURNING id, name, description, created_at`,
      [name.trim(), description?.trim() || null, req.params.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Topic not found' });
    }

    res.json(result.rows[0]);
  } catch (err: any) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Topic with this name already exists' });
    }
    console.error('Error updating topic:', err);
    res.status(500).json({ error: 'Failed to update topic' });
  }
});

// Delete topic
router.delete('/:id', async (req, res) => {
  try {
    const result = await query(
      `DELETE FROM topics WHERE id = $1`,
      [req.params.id]
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


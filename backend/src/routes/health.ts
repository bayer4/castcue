// ============================================================
// Health Check Route
// ============================================================

import { Router } from 'express';
import { query } from '../db/client.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    // Check database connection
    await query('SELECT 1');

    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '2.0.0',
    });
  } catch (err) {
    res.status(503).json({
      status: 'error',
      error: 'Database connection failed',
    });
  }
});

export default router;


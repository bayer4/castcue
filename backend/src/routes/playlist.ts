// ============================================================
// Playlist Routes
// Clip generation, listing, and listen tracking
// ============================================================

import { Router } from 'express';
import { query } from '../db/client.js';
import { requireAuth } from '../middleware/auth.js';
import { searchEpisodeWithTimestamps } from '../services/search.js';

const router = Router();

// All routes require auth
router.use(requireAuth);

// ============================================================
// POST /playlist/generate - Generate clips for user's topics × episodes
// ============================================================
router.post('/generate', async (req, res) => {
  try {
    const userId = req.userId!;

    // 1. Get user's topics
    const topicsResult = await query<{ name: string }>(
      `SELECT name FROM user_topics WHERE user_id = $1`,
      [userId]
    );
    const topics = topicsResult.rows.map((r) => r.name);

    if (topics.length === 0) {
      return res.json({
        createdCount: 0,
        updatedCount: 0,
        scannedEpisodes: 0,
        scannedTopics: 0,
        message: 'No topics configured. Add topics first.',
      });
    }

    // 2. Get episodes from user's subscribed podcasts
    const episodesResult = await query<{
      id: string;
      title: string;
      audio_url: string;
    }>(
      `SELECT DISTINCT e.id, e.title, e.audio_url
       FROM episodes e
       JOIN subscriptions s ON s.podcast_id = e.podcast_id
       WHERE s.user_id = $1
         AND e.podcast_id IS NOT NULL`,
      [userId]
    );
    const episodes = episodesResult.rows;

    if (episodes.length === 0) {
      return res.json({
        createdCount: 0,
        updatedCount: 0,
        scannedEpisodes: 0,
        scannedTopics: topics.length,
        message: 'No episodes found from subscribed podcasts.',
      });
    }

    // 3. For each (episode × topic), run search and upsert clips
    let createdCount = 0;
    let updatedCount = 0;

    for (const episode of episodes) {
      for (const topic of topics) {
        try {
          const { ranges } = await searchEpisodeWithTimestamps(episode.id, topic);

          for (const range of ranges) {
            // UPSERT: insert or update on conflict
            const upsertResult = await query(
              `INSERT INTO clips (episode_id, topic, start_ms, end_ms, confidence)
               VALUES ($1, $2, $3, $4, $5)
               ON CONFLICT (episode_id, topic, start_ms)
               DO UPDATE SET
                 end_ms = EXCLUDED.end_ms,
                 confidence = EXCLUDED.confidence
               RETURNING (xmax = 0) AS is_insert`,
              [episode.id, topic, range.startMs, range.endMs, range.confidence]
            );

            const isInsert = upsertResult.rows[0]?.is_insert;
            if (isInsert) {
              createdCount++;
            } else {
              updatedCount++;
            }
          }
        } catch (err) {
          console.error(`Error searching ${topic} in ${episode.id}:`, err);
          // Continue with other combinations
        }
      }
    }

    res.json({
      createdCount,
      updatedCount,
      scannedEpisodes: episodes.length,
      scannedTopics: topics.length,
    });
  } catch (err) {
    console.error('Error generating clips:', err);
    res.status(500).json({ error: 'Failed to generate clips' });
  }
});

// ============================================================
// GET /playlist - Get user's clips
// ============================================================
router.get('/', async (req, res) => {
  try {
    const userId = req.userId!;

    // Get clips for user's subscribed podcasts, with listen status
    const result = await query<{
      clip_id: number;
      topic: string;
      start_ms: number;
      end_ms: number;
      confidence: number;
      clip_created_at: Date;
      episode_id: string;
      episode_title: string;
      audio_url: string;
      podcast_title: string | null;
      image_url: string | null;
      listened_at: Date | null;
    }>(
      `SELECT
         c.id AS clip_id,
         c.topic,
         c.start_ms,
         c.end_ms,
         c.confidence,
         c.created_at AS clip_created_at,
         e.id AS episode_id,
         e.title AS episode_title,
         e.audio_url,
         p.title AS podcast_title,
         p.image_url,
         cl.listened_at
       FROM clips c
       JOIN episodes e ON e.id = c.episode_id
       JOIN podcasts p ON p.id = e.podcast_id
       JOIN subscriptions s ON s.podcast_id = p.id AND s.user_id = $1
       LEFT JOIN clip_listens cl ON cl.clip_id = c.id AND cl.user_id = $1
       ORDER BY c.created_at DESC
       LIMIT 100`,
      [userId]
    );

    const clips = result.rows.map((row) => ({
      clipId: row.clip_id,
      topic: row.topic,
      startMs: row.start_ms,
      endMs: row.end_ms,
      confidence: row.confidence,
      createdAt: row.clip_created_at,
      episodeId: row.episode_id,
      episodeTitle: row.episode_title,
      audioUrl: row.audio_url,
      podcastTitle: row.podcast_title,
      imageUrl: row.image_url,
      isNew: row.listened_at === null,
    }));

    res.json({ clips });
  } catch (err) {
    console.error('Error fetching playlist:', err);
    res.status(500).json({ error: 'Failed to fetch playlist' });
  }
});

// ============================================================
// POST /playlist/clips/:id/listen - Mark clip as listened
// ============================================================
router.post('/clips/:id/listen', async (req, res) => {
  const clipId = parseInt(req.params.id, 10);

  if (isNaN(clipId)) {
    return res.status(400).json({ error: 'Invalid clip ID' });
  }

  try {
    // Verify clip exists
    const clipResult = await query(
      `SELECT id FROM clips WHERE id = $1`,
      [clipId]
    );

    if (clipResult.rows.length === 0) {
      return res.status(404).json({ error: 'Clip not found' });
    }

    // Upsert listen record (idempotent)
    await query(
      `INSERT INTO clip_listens (user_id, clip_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, clip_id) DO NOTHING`,
      [req.userId, clipId]
    );

    res.json({ listened: true });
  } catch (err) {
    console.error('Error marking clip as listened:', err);
    res.status(500).json({ error: 'Failed to mark as listened' });
  }
});

export default router;


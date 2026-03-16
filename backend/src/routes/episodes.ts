// ============================================================
// Episodes Routes
// Handles episode ingestion with transcript processing
// ============================================================

import { Router } from 'express';
import { query } from '../db/client.js';
import { sliceIntoSegments } from '../services/segmentation.js';
import { embedBatch } from '../services/embedding.js';
import { IngestRequest, TranscriptWord } from '../types.js';
import pgvector from 'pgvector';

const router = Router();

interface EpisodeRow {
  id: string;
  title: string;
  audio_url: string;
  created_at: Date;
  segment_count?: number;
}

// List all episodes
router.get('/', async (req, res) => {
  try {
    const result = await query<EpisodeRow>(
      `SELECT e.id, e.title, e.audio_url, e.created_at,
              COUNT(s.id) as segment_count
       FROM episodes e
       LEFT JOIN segments s ON s.episode_id = e.id
       GROUP BY e.id
       ORDER BY e.created_at DESC`
    );

    res.json({
      episodes: result.rows.map(row => ({
        id: row.id,
        title: row.title,
        audioUrl: row.audio_url,
        createdAt: row.created_at,
        segmentCount: Number(row.segment_count),
      })),
    });
  } catch (err) {
    console.error('Error listing episodes:', err);
    res.status(500).json({ error: 'Failed to list episodes' });
  }
});

// Get single episode
router.get('/:id', async (req, res) => {
  try {
    const epResult = await query<EpisodeRow>(
      `SELECT id, title, audio_url, created_at FROM episodes WHERE id = $1`,
      [req.params.id]
    );

    if (epResult.rows.length === 0) {
      return res.status(404).json({ error: 'Episode not found' });
    }

    const segResult = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM segments WHERE episode_id = $1`,
      [req.params.id]
    );

    const ep = epResult.rows[0];
    res.json({
      id: ep.id,
      title: ep.title,
      audioUrl: ep.audio_url,
      createdAt: ep.created_at,
      segmentCount: Number(segResult.rows[0].count),
    });
  } catch (err) {
    console.error('Error getting episode:', err);
    res.status(500).json({ error: 'Failed to get episode' });
  }
});

// Ingest a new episode with transcript
router.post('/ingest', async (req, res) => {
  const body = req.body as IngestRequest;

  // Validate request
  if (!body.episodeId) {
    return res.status(400).json({ error: 'episodeId is required' });
  }
  if (!body.title) {
    return res.status(400).json({ error: 'title is required' });
  }
  if (!body.audioUrl) {
    return res.status(400).json({ error: 'audioUrl is required' });
  }
  if (!body.transcript?.words || !Array.isArray(body.transcript.words)) {
    return res.status(400).json({ error: 'transcript.words array is required' });
  }

  // Validate word format (sample check)
  const sampleWord = body.transcript.words[0];
  if (!sampleWord || typeof sampleWord.text !== 'string' ||
      typeof sampleWord.start !== 'number' || typeof sampleWord.end !== 'number') {
    return res.status(400).json({
      error: 'Each word must have text (string), start (number), and end (number)',
    });
  }

  try {
    console.log(`📥 Ingesting episode: ${body.episodeId}`);

    // 1. Create episode record
    await query(
      `INSERT INTO episodes (id, title, audio_url)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET title = $2, audio_url = $3`,
      [body.episodeId, body.title, body.audioUrl]
    );
    console.log(`  ✅ Episode record created`);

    // 2. Clear existing segments (in case of re-ingest)
    await query(`DELETE FROM segments WHERE episode_id = $1`, [body.episodeId]);

    // 3. Slice transcript into segments
    console.log(`  🔪 Slicing into segments...`);
    const segments = sliceIntoSegments(body.transcript.words);
    console.log(`  ✅ Created ${segments.length} segments`);

    // 4. Generate embeddings for all segments
    console.log(`  🧠 Generating embeddings...`);
    const texts = segments.map(s => s.text);
    const embeddings = await embedBatch(texts);
    console.log(`  ✅ Generated ${embeddings.length} embeddings`);

    // 5. Insert segments with embeddings
    console.log(`  💾 Saving to database...`);
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const emb = embeddings[i];

      await query(
        `INSERT INTO segments (episode_id, segment_index, text, start_ms, end_ms, embedding)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          body.episodeId,
          i,
          seg.text,
          seg.startMs,
          seg.endMs,
          pgvector.toSql(emb),
        ]
      );
    }
    console.log(`  ✅ Saved ${segments.length} segments`);

    res.status(201).json({
      success: true,
      episodeId: body.episodeId,
      segmentCount: segments.length,
      message: `Ingested ${segments.length} segments`,
    });
  } catch (err: any) {
    console.error('Error ingesting episode:', err);
    res.status(500).json({
      error: 'Failed to ingest episode',
      details: err.message,
    });
  }
});

// Delete episode
router.delete('/:id', async (req, res) => {
  try {
    const result = await query(
      `DELETE FROM episodes WHERE id = $1`,
      [req.params.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Episode not found' });
    }

    res.status(204).send();
  } catch (err) {
    console.error('Error deleting episode:', err);
    res.status(500).json({ error: 'Failed to delete episode' });
  }
});

// DEV: Attach episode to a podcast (for testing)
router.post('/:episodeId/attach-podcast', async (req, res) => {
  const { episodeId } = req.params;
  const { podcastId } = req.body;

  if (!podcastId || typeof podcastId !== 'string') {
    return res.status(400).json({ error: 'podcastId is required' });
  }

  try {
    // Verify episode exists
    const epResult = await query(
      `SELECT id FROM episodes WHERE id = $1`,
      [episodeId]
    );
    if (epResult.rows.length === 0) {
      return res.status(404).json({ error: 'Episode not found' });
    }

    // Verify podcast exists
    const podResult = await query(
      `SELECT id FROM podcasts WHERE id = $1`,
      [podcastId]
    );
    if (podResult.rows.length === 0) {
      return res.status(404).json({ error: 'Podcast not found' });
    }

    // Update episode
    await query(
      `UPDATE episodes SET podcast_id = $1 WHERE id = $2`,
      [podcastId, episodeId]
    );

    res.json({
      success: true,
      episodeId,
      podcastId,
      message: `Episode ${episodeId} attached to podcast ${podcastId}`,
    });
  } catch (err) {
    console.error('Error attaching podcast:', err);
    res.status(500).json({ error: 'Failed to attach podcast' });
  }
});

export default router;


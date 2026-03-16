// ============================================================
// Search Route
// The main endpoint for finding topic discussions
// ============================================================

import { Router } from 'express';
import { query } from '../db/client.js';
import { searchEpisodeWithTimestamps } from '../services/search.js';

const router = Router();

interface EpisodeRow {
  id: string;
  audio_url: string;
}

// Search for topic in episode
router.get('/', async (req, res) => {
  const { episodeId, topic } = req.query;

  if (!episodeId || typeof episodeId !== 'string') {
    return res.status(400).json({ error: 'episodeId query parameter is required' });
  }

  if (!topic || typeof topic !== 'string') {
    return res.status(400).json({ error: 'topic query parameter is required' });
  }

  try {
    // 1. Verify episode exists and get audio URL
    const epResult = await query<EpisodeRow>(
      `SELECT id, audio_url FROM episodes WHERE id = $1`,
      [episodeId]
    );

    if (epResult.rows.length === 0) {
      return res.status(404).json({ error: 'Episode not found' });
    }

    const episode = epResult.rows[0];

    // 2. Run the search
    console.log(`🔍 Searching "${topic}" in episode ${episodeId}`);
    const { ranges, method } = await searchEpisodeWithTimestamps(episodeId, topic);
    console.log(`  Found ${ranges.length} ranges via ${method} search`);

    // 3. Return results
    res.json({
      episodeId,
      audioUrl: episode.audio_url,
      topic,
      method,
      ranges: ranges.map(r => ({
        startMs: r.startMs,
        endMs: r.endMs,
        startFormatted: formatTime(r.startMs),
        endFormatted: formatTime(r.endMs),
        durationMs: r.endMs - r.startMs,
        occurrences: r.occurrences,
        confidence: Math.round(r.confidence * 100) / 100,
      })),
      totalRanges: ranges.length,
      totalDurationMs: ranges.reduce((sum, r) => sum + (r.endMs - r.startMs), 0),
    });
  } catch (err) {
    console.error('Error searching:', err);
    res.status(500).json({ error: 'Search failed' });
  }
});

/**
 * Format milliseconds as MM:SS or HH:MM:SS
 */
function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export default router;


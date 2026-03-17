// ============================================================
// Podcasts Routes
// Follow/unfollow podcast RSS feeds
// Search via iTunes API
// ============================================================

import { Router } from 'express';
import crypto from 'crypto';
import { query } from '../db/client.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

interface PodcastRow {
  id: string;
  rss_url: string;
  title: string | null;
  description: string | null;
  image_url: string | null;
  created_at: Date;
}

// iTunes Search API response types
interface ITunesResult {
  trackId: number;
  collectionName: string;
  artistName: string;
  feedUrl?: string;
  artworkUrl600?: string;
}

interface ITunesSearchResponse {
  resultCount: number;
  results: ITunesResult[];
}

// All routes require auth
router.use(requireAuth);

// GET /podcasts/search?q=... - Search podcasts via iTunes API
router.get('/search', async (req, res) => {
  const q = req.query.q;

  if (!q || typeof q !== 'string' || q.trim().length === 0) {
    return res.json({ results: [] });
  }

  try {
    const searchUrl = new URL('https://itunes.apple.com/search');
    searchUrl.searchParams.set('term', q.trim());
    searchUrl.searchParams.set('media', 'podcast');
    searchUrl.searchParams.set('limit', '10');

    const response = await fetch(searchUrl.toString());

    if (!response.ok) {
      console.error('iTunes API error:', response.status);
      return res.status(502).json({ error: 'Search service unavailable' });
    }

    const data: ITunesSearchResponse = await response.json();

    // Filter to only podcasts with a feedUrl and map to our format
    const results = data.results
      .filter((item) => item.feedUrl)
      .map((item) => ({
        podcastId: item.trackId,
        title: item.collectionName,
        author: item.artistName,
        feedUrl: item.feedUrl,
        artworkUrl600: item.artworkUrl600 || null,
      }));

    res.json({ results });
  } catch (err) {
    console.error('Error searching podcasts:', err);
    res.status(500).json({ error: 'Search failed' });
  }
});

// GET /podcasts - List user's followed podcasts
router.get('/', async (req, res) => {
  try {
    const result = await query<PodcastRow>(
      `SELECT p.id, p.rss_url, p.title, p.description, p.image_url, p.created_at
       FROM podcasts p
       JOIN subscriptions s ON s.podcast_id = p.id
       WHERE s.user_id = $1
       ORDER BY s.created_at DESC`,
      [req.userId]
    );

    res.json({
      podcasts: result.rows.map(row => ({
        id: row.id,
        rssUrl: row.rss_url,
        title: row.title,
        description: row.description,
        imageUrl: row.image_url,
        createdAt: row.created_at,
      })),
    });
  } catch (err) {
    console.error('Error listing podcasts:', err);
    res.status(500).json({ error: 'Failed to list podcasts' });
  }
});

// POST /podcasts/subscribe - Follow a podcast
// Accepts either { rssUrl } or { feedUrl } (or both, feedUrl takes priority)
router.post('/subscribe', async (req, res) => {
  const { rssUrl, feedUrl, title, imageUrl } = req.body;
  const url = feedUrl || rssUrl;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'rssUrl or feedUrl is required' });
  }

  // Basic URL validation
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  const normalizedUrl = parsedUrl.toString();

  try {
    // Check if podcast already exists
    let podcastResult = await query<PodcastRow>(
      'SELECT id, rss_url, title, description, image_url FROM podcasts WHERE rss_url = $1',
      [normalizedUrl]
    );

    let podcast: PodcastRow;

    if (podcastResult.rows.length === 0) {
      // Create new podcast with metadata if provided
      const id = crypto.randomUUID();
      await query(
        `INSERT INTO podcasts (id, rss_url, title, image_url) VALUES ($1, $2, $3, $4)`,
        [id, normalizedUrl, title || 'Loading...', imageUrl || null]
      );

      podcastResult = await query<PodcastRow>(
        'SELECT id, rss_url, title, description, image_url FROM podcasts WHERE id = $1',
        [id]
      );
      podcast = podcastResult.rows[0];
    } else {
      podcast = podcastResult.rows[0];
      
      // Update title/image if provided and currently missing
      if ((title && !podcast.title) || (imageUrl && !podcast.image_url)) {
        await query(
          `UPDATE podcasts SET 
            title = COALESCE($1, title),
            image_url = COALESCE($2, image_url)
          WHERE id = $3`,
          [title || null, imageUrl || null, podcast.id]
        );
        // Refresh
        podcastResult = await query<PodcastRow>(
          'SELECT id, rss_url, title, description, image_url FROM podcasts WHERE id = $1',
          [podcast.id]
        );
        podcast = podcastResult.rows[0];
      }
    }

    // Create subscription (ignore if already exists)
    await query(
      `INSERT INTO subscriptions (user_id, podcast_id) 
       VALUES ($1, $2) 
       ON CONFLICT (user_id, podcast_id) DO NOTHING`,
      [req.userId, podcast.id]
    );

    res.status(201).json({
      podcast: {
        id: podcast.id,
        rssUrl: podcast.rss_url,
        title: podcast.title,
        description: podcast.description,
        imageUrl: podcast.image_url,
      },
    });
  } catch (err) {
    console.error('Error following podcast:', err);
    res.status(500).json({ error: 'Failed to follow' });
  }
});

// DELETE /podcasts/:id/unsubscribe - Unfollow a podcast
router.delete('/:id/unsubscribe', async (req, res) => {
  const podcastId = req.params.id;

  try {
    const result = await query(
      `DELETE FROM subscriptions WHERE user_id = $1 AND podcast_id = $2`,
      [req.userId, podcastId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Follow not found' });
    }

    res.status(204).send();
  } catch (err) {
    console.error('Error unfollowing:', err);
    res.status(500).json({ error: 'Failed to unfollow' });
  }
});

export default router;

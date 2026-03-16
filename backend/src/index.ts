// ============================================================
// CastCue v2 - Main Entry Point
// ============================================================

import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import healthRouter from './routes/health.js';
import topicsRouter from './routes/topics.js';
import episodesRouter from './routes/episodes.js';
import searchRouter from './routes/search.js';
import authRouter from './routes/auth.js';
import userTopicsRouter from './routes/user-topics.js';
import podcastsRouter from './routes/podcasts.js';
import playlistRouter from './routes/playlist.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Large limit for transcript uploads

// Routes
app.use('/health', healthRouter);
app.use('/auth', authRouter);
app.use('/topics', topicsRouter);
app.use('/user-topics', userTopicsRouter);
app.use('/podcasts', podcastsRouter);
app.use('/episodes', episodesRouter);
app.use('/search', searchRouter);
app.use('/playlist', playlistRouter);

// Root redirect to health
app.get('/', (req, res) => {
  res.redirect('/health');
});

// Error handler
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════╗
║              CastCue v2 Backend                   ║
╠═══════════════════════════════════════════════════╣
║  Server running on http://localhost:${PORT}          ║
║                                                   ║
║  Auth:                                            ║
║    POST /auth/login         - Login by email      ║
║    GET  /auth/me            - Get current user    ║
║  User Topics:                                     ║
║    GET  /user-topics        - List my topics      ║
║    POST /user-topics        - Add topic           ║
║  Podcasts:                                        ║
║    GET  /podcasts/search    - Search iTunes       ║
║    POST /podcasts/subscribe - Subscribe           ║
║  Episodes:                                        ║
║    POST /episodes/ingest    - Ingest episode      ║
║  Playlist:                                        ║
║    GET  /playlist           - Get clips           ║
║    POST /playlist/generate  - Generate clips      ║
║    POST /playlist/clips/:id/listen - Mark played  ║
╚═══════════════════════════════════════════════════╝
  `);
});


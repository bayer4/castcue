'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { auth, playlist, User, Clip, ApiError } from '@/lib/api';
import Sidebar from '@/components/Sidebar';

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

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  return `${minutes}m`;
}

export default function PlaylistPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [clips, setClips] = useState<Clip[]>([]);
  const [generating, setGenerating] = useState(false);
  const [generateResult, setGenerateResult] = useState<string | null>(null);
  
  // Audio player state
  const [currentClip, setCurrentClip] = useState<Clip | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const loadData = async () => {
      try {
        const [userData, playlistRes] = await Promise.all([
          auth.me(),
          playlist.list(),
        ]);
        setUser(userData);
        setClips(playlistRes.clips);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          router.replace('/login');
        }
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [router]);

  // Audio event handlers
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => setCurrentTime(audio.currentTime * 1000);
    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentClip(null);
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('ended', handleEnded);
    };
  }, []);

  const handleGenerate = async () => {
    setGenerating(true);
    setGenerateResult(null);

    try {
      const result = await playlist.generate();
      setGenerateResult(
        result.message || 
        `Created ${result.createdCount} clips from ${result.scannedEpisodes} episodes × ${result.scannedTopics} topics`
      );
      
      // Refresh playlist
      const playlistRes = await playlist.list();
      setClips(playlistRes.clips);
    } catch (err) {
      if (err instanceof ApiError) {
        setGenerateResult(`Error: ${err.message}`);
      }
    } finally {
      setGenerating(false);
    }
  };

  const handlePlayClip = async (clip: Clip) => {
    const audio = audioRef.current;
    if (!audio) return;

    // If clicking the same clip, toggle play/pause
    if (currentClip?.clipId === clip.clipId) {
      if (isPlaying) {
        audio.pause();
      } else {
        audio.play();
      }
      return;
    }

    // Play new clip
    setCurrentClip(clip);
    audio.src = clip.audioUrl;
    audio.currentTime = clip.startMs / 1000;
    
    try {
      await audio.play();
      
      // Mark as listened (optimistically update UI)
      if (clip.isNew) {
        setClips((prev) =>
          prev.map((c) =>
            c.clipId === clip.clipId ? { ...c, isNew: false } : c
          )
        );
        // Fire and forget
        playlist.markListened(clip.clipId).catch(console.error);
      }
    } catch (err) {
      console.error('Failed to play:', err);
    }
  };

  const handleTogglePlayPause = () => {
    const audio = audioRef.current;
    if (!audio || !currentClip) return;

    if (isPlaying) {
      audio.pause();
    } else {
      audio.play();
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex">
      <Sidebar user={user} activeNav="playlist" />
      
      {/* Hidden audio element */}
      <audio ref={audioRef} />

      <main className="flex-1 flex flex-col">
        {/* Top bar */}
        <header className="h-14 px-6 border-b border-border flex items-center justify-between">
          <h1 className="text-lg font-semibold text-text-primary">Your Playlist</h1>
          <div className="flex items-center gap-3">
            <span className="px-2 py-1 bg-bg-secondary rounded text-sm text-text-tertiary">
              {clips.length} clip{clips.length !== 1 ? 's' : ''}
            </span>
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="px-3 py-1.5 bg-accent hover:bg-accent-hover disabled:opacity-50 rounded-lg text-sm font-medium text-white transition-colors flex items-center gap-2"
            >
              {generating ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Generate clips
                </>
              )}
            </button>
          </div>
        </header>

        {/* Generate result message */}
        {generateResult && (
          <div className="px-6 py-3 bg-bg-secondary border-b border-border">
            <p className="text-sm text-text-secondary">{generateResult}</p>
          </div>
        )}

        {/* Content area */}
        <div className="flex-1 p-6 overflow-y-auto">
          {clips.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center">
              <div className="w-16 h-16 rounded-2xl bg-bg-secondary border border-border flex items-center justify-center mb-4">
                <svg
                  className="w-8 h-8 text-text-tertiary"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"
                  />
                </svg>
              </div>
              <h2 className="text-lg font-medium text-text-primary mb-2">
                No clips yet
              </h2>
              <p className="text-text-secondary max-w-sm mb-6">
                Add topics and podcasts, then click "Generate clips" to find discussions.
              </p>
              <button
                onClick={() => router.push('/topics')}
                className="px-4 py-2 bg-bg-secondary border border-border hover:bg-bg-hover rounded-lg font-medium text-text-primary transition-colors"
              >
                Add topics & podcasts
              </button>
            </div>
          ) : (
            <div className="space-y-3 max-w-3xl">
              {clips.map((clip) => {
                const isCurrentClip = currentClip?.clipId === clip.clipId;
                const duration = clip.endMs - clip.startMs;

                return (
                  <div
                    key={clip.clipId}
                    className={`flex items-center gap-4 p-4 rounded-xl border transition-colors ${
                      isCurrentClip
                        ? 'bg-accent-muted border-accent/30'
                        : 'bg-bg-secondary border-border hover:bg-bg-tertiary'
                    }`}
                  >
                    {/* Artwork */}
                    <div className="w-14 h-14 rounded-lg bg-bg-hover flex-shrink-0 overflow-hidden">
                      {clip.imageUrl ? (
                        <img src={clip.imageUrl} alt="" className="w-14 h-14 object-cover" />
                      ) : (
                        <div className="w-14 h-14 flex items-center justify-center">
                          <svg className="w-6 h-6 text-text-tertiary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                          </svg>
                        </div>
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="px-2 py-0.5 bg-accent-muted text-accent text-xs font-medium rounded-full">
                          {clip.topic}
                        </span>
                        {clip.isNew && (
                          <span className="px-2 py-0.5 bg-green-500/20 text-green-400 text-xs font-medium rounded-full">
                            NEW
                          </span>
                        )}
                      </div>
                      <p className="text-text-primary font-medium truncate">{clip.episodeTitle}</p>
                      <p className="text-text-tertiary text-sm truncate">
                        {clip.podcastTitle} · {formatTime(clip.startMs)} · {formatDuration(duration)}
                      </p>
                    </div>

                    {/* Play button */}
                    <button
                      onClick={() => handlePlayClip(clip)}
                      className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors flex-shrink-0 ${
                        isCurrentClip && isPlaying
                          ? 'bg-accent text-white'
                          : 'bg-bg-hover hover:bg-border text-text-primary'
                      }`}
                    >
                      {isCurrentClip && isPlaying ? (
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                        </svg>
                      ) : (
                        <svg className="w-5 h-5 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Audio player bar */}
        <footer className="h-20 px-6 border-t border-border bg-bg-secondary flex items-center">
          <div className="flex items-center gap-4 w-full">
            {/* Artwork */}
            <div className="w-12 h-12 rounded-lg bg-bg-tertiary flex-shrink-0 overflow-hidden">
              {currentClip?.imageUrl ? (
                <img src={currentClip.imageUrl} alt="" className="w-12 h-12 object-cover" />
              ) : currentClip ? (
                <div className="w-12 h-12 flex items-center justify-center">
                  <svg className="w-5 h-5 text-text-tertiary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                </div>
              ) : null}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              {currentClip ? (
                <>
                  <p className="text-sm text-text-primary truncate">{currentClip.episodeTitle}</p>
                  <p className="text-xs text-text-tertiary truncate">
                    {currentClip.podcastTitle} · {currentClip.topic}
                  </p>
                </>
              ) : (
                <p className="text-sm text-text-tertiary">No clip playing</p>
              )}
            </div>

            {/* Controls */}
            <div className="flex items-center gap-2">
              <button
                onClick={handleTogglePlayPause}
                disabled={!currentClip}
                className={`p-3 rounded-full transition-colors ${
                  currentClip
                    ? 'bg-accent hover:bg-accent-hover text-white'
                    : 'bg-bg-tertiary text-text-tertiary cursor-not-allowed'
                }`}
              >
                {isPlaying ? (
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                )}
              </button>
            </div>

            {/* Time */}
            {currentClip && (
              <div className="text-xs text-text-tertiary font-mono w-24 text-right">
                {formatTime(currentTime)} / {formatTime(currentClip.endMs)}
              </div>
            )}
          </div>
        </footer>
      </main>
    </div>
  );
}

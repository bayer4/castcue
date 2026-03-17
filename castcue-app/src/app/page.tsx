"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type PlaylistClip = {
  id: number;
  topic: string;
  startMs: number;
  endMs: number;
  confidence: number;
  createdAt: string;
  episodeId: string;
  episodeTitle: string;
  audioUrl: string;
  podcastId: string;
  podcastTitle: string;
  artworkUrl: string | null;
  listened: boolean;
};

/* ── Icons ── */
const PlayIcon = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M8 5.14v14.72a1 1 0 001.5.86l12-7.36a1 1 0 000-1.72l-12-7.36A1 1 0 008 5.14z" />
  </svg>
);
const PauseIcon = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <rect x="6" y="4" width="4" height="16" rx="1" />
    <rect x="14" y="4" width="4" height="16" rx="1" />
  </svg>
);
const SkipIcon = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M5 5.14v14.72a1 1 0 001.5.86l10-7.36a1 1 0 000-1.72l-10-7.36A1 1 0 005 5.14z" />
    <rect x="18" y="5" width="2" height="14" rx="1" />
  </svg>
);
const SparkleIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3l1.912 5.813a2 2 0 001.275 1.275L21 12l-5.813 1.912a2 2 0 00-1.275 1.275L12 21l-1.912-5.813a2 2 0 00-1.275-1.275L3 12l5.813-1.912a2 2 0 001.275-1.275L12 3z" />
  </svg>
);

export default function Home() {
  const router = useRouter();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [clips, setClips] = useState<PlaylistClip[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentClipId, setCurrentClipId] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [clipProgressMs, setClipProgressMs] = useState(0);

  const loadPlaylist = useCallback(async () => {
    const response = await fetch("/api/playlist");
    if (response.status === 401) {
      router.push("/login");
      throw new Error("Unauthorized");
    }
    const payload = (await response.json()) as PlaylistClip[] | { error?: string };
    if (!response.ok) {
      throw new Error("error" in payload ? payload.error ?? "Failed" : "Failed");
    }
    setClips(payload as PlaylistClip[]);
  }, [router]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        if (!active) return;
        await loadPlaylist();
      } catch (error) {
        if (active) setMessage(error instanceof Error ? error.message : "Failed to load playlist");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [loadPlaylist]);

  const currentIndex = useMemo(
    () => clips.findIndex((clip) => clip.id === currentClipId),
    [clips, currentClipId],
  );
  const currentClip = currentIndex >= 0 ? clips[currentIndex] : null;

  async function markAsListened(clipId: number) {
    setClips((prev) => prev.map((clip) => (clip.id === clipId ? { ...clip, listened: true } : clip)));
    await fetch(`/api/playlist/clips/${clipId}/listen`, { method: "POST" });
  }

  function formatClock(ms: number) {
    const safe = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(safe / 60);
    const seconds = String(safe % 60).padStart(2, "0");
    return `${minutes}:${seconds}`;
  }

  function formatTimestamp(ms: number) {
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = String(totalSec % 60).padStart(2, "0");
    return `${m}:${s}`;
  }

  const playClip = useCallback(
    async (clipId: number) => {
      const clip = clips.find((entry) => entry.id === clipId);
      const audio = audioRef.current;
      if (!clip || !audio) return;

      const startSeconds = clip.startMs / 1000;
      const shouldSwapSrc = !audio.src || !audio.src.startsWith(clip.audioUrl);

      setCurrentClipId(clip.id);
      setClipProgressMs(0);
      if (!clip.listened) void markAsListened(clip.id);

      const startPlayback = async () => {
        audio.currentTime = startSeconds;
        try {
          await audio.play();
          setIsPlaying(true);
        } catch {
          setIsPlaying(false);
          setMessage("Audio playback was blocked. Click Play again.");
        }
      };

      if (shouldSwapSrc) {
        audio.src = clip.audioUrl;
        audio.load();
        audio.onloadedmetadata = () => {
          audio.onloadedmetadata = null;
          void startPlayback();
        };
      } else {
        await startPlayback();
      }
    },
    [clips],
  );

  const playNextClip = useCallback(async () => {
    if (currentIndex < 0) return;
    const nextIndex = currentIndex + 1;
    if (nextIndex >= clips.length) {
      audioRef.current?.pause();
      setIsPlaying(false);
      if (currentClip) setClipProgressMs(Math.max(0, currentClip.endMs - currentClip.startMs));
      return;
    }
    await playClip(clips[nextIndex].id);
  }, [clips, currentClip, currentIndex, playClip]);

  function seekWithinCurrentClip(event: MouseEvent<HTMLDivElement>) {
    if (!currentClip || !audioRef.current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, x / rect.width));
    const clipDurationMs = Math.max(1, currentClip.endMs - currentClip.startMs);
    const targetMs = currentClip.startMs + pct * clipDurationMs;
    audioRef.current.currentTime = targetMs / 1000;
    setClipProgressMs(targetMs - currentClip.startMs);
  }

  async function toggleClip(clip: PlaylistClip) {
    const audio = audioRef.current;
    if (!audio) return;
    if (currentClipId === clip.id) {
      if (isPlaying) {
        audio.pause();
        setIsPlaying(false);
      } else {
        try {
          if (audio.currentTime * 1000 < clip.startMs || audio.currentTime * 1000 >= clip.endMs) {
            audio.currentTime = clip.startMs / 1000;
          }
          await audio.play();
          setIsPlaying(true);
        } catch {
          setMessage("Unable to resume audio.");
        }
      }
      return;
    }
    await playClip(clip.id);
  }

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTimeUpdate = () => {
      if (!currentClip) return;
      const nowMs = audio.currentTime * 1000;
      const progress = Math.max(0, Math.min(nowMs - currentClip.startMs, currentClip.endMs - currentClip.startMs));
      setClipProgressMs(progress);
      if (nowMs >= currentClip.endMs) {
        audio.pause();
        void playNextClip();
      }
    };
    const onEnded = () => void playNextClip();
    const onPause = () => setIsPlaying(false);
    const onPlay = () => setIsPlaying(true);

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("play", onPlay);
    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("play", onPlay);
    };
  }, [currentClip, playNextClip]);

  async function handleGenerateClips() {
    setGenerating(true);
    setMessage(null);
    const response = await fetch("/api/playlist/generate", { method: "POST" });
    if (response.status === 401) { router.push("/login"); setGenerating(false); return; }
    const payload = (await response.json()) as { createdCount?: number; scannedEpisodes?: number; scannedTopics?: number; error?: string };
    if (!response.ok) { setMessage(payload.error ?? "Failed to generate clips."); setGenerating(false); return; }
    setMessage(`Found ${payload.createdCount ?? 0} conversations across ${payload.scannedEpisodes ?? 0} episodes.`);
    await loadPlaylist();
    setGenerating(false);
  }

  async function handleClearClips() {
    const confirmed = window.confirm("Clear all generated clips?");
    if (!confirmed) return;
    setMessage(null);
    const response = await fetch("/api/playlist", { method: "DELETE" });
    if (response.status === 401) { router.push("/login"); return; }
    const payload = (await response.json()) as { deleted?: number; error?: string };
    if (!response.ok) { setMessage(payload.error ?? "Failed to clear clips."); return; }
    setMessage(`Cleared ${payload.deleted ?? 0} clips.`);
    setCurrentClipId(null);
    setIsPlaying(false);
    await loadPlaylist();
  }

  const clipDurationMs = currentClip ? Math.max(1, currentClip.endMs - currentClip.startMs) : 1;
  const progressPct = currentClip ? Math.min(100, (clipProgressMs / clipDurationMs) * 100) : 0;

  return (
    <section className="mx-auto max-w-4xl pb-32">
      {/* Header */}
      <header className="mb-6 flex items-end justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Your Queue</h2>
          <p className="mt-1 text-sm text-[var(--text-tertiary)]">
            {clips.length > 0
              ? `${clips.length} conversation${clips.length !== 1 ? "s" : ""} found`
              : "Curated conversations from your podcasts"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {clips.length > 0 && (
            <button onClick={handleClearClips} className="btn-ghost">
              Clear
            </button>
          )}
          <button onClick={handleGenerateClips} disabled={generating} className="btn-primary">
            <SparkleIcon />
            {generating ? "Scanning..." : "Generate"}
          </button>
        </div>
      </header>

      {/* Status message */}
      {message && (
        <div className="animate-fade-in mb-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text-secondary)]">
          {message}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
        </div>
      )}

      {/* Empty state */}
      {!loading && clips.length === 0 && !message && (
        <div className="animate-fade-in flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--border)] py-20 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--accent-muted)]">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18V5l12-3v13" />
              <circle cx="6" cy="18" r="3" />
              <circle cx="18" cy="15" r="3" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold">No conversations yet</h3>
          <p className="mt-1 max-w-sm text-sm text-[var(--text-tertiary)]">
            Add topics you care about, subscribe to podcasts, then hit Generate to find conversations.
          </p>
        </div>
      )}

      {/* Clip list */}
      <div className="space-y-2">
        {clips.map((clip, i) => {
          const isActive = currentClipId === clip.id;
          const isClipPlaying = isActive && isPlaying;
          const durationSec = Math.max(1, Math.round((clip.endMs - clip.startMs) / 1000));

          return (
            <article
              key={clip.id}
              className={`clip-card flex items-center gap-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] p-3 ${isActive ? "clip-card--active" : ""}`}
              style={{ animationDelay: `${i * 30}ms` }}
              onClick={() => toggleClip(clip)}
              role="button"
              tabIndex={0}
            >
              {/* Artwork */}
              <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-[var(--elevated)]">
                {clip.artworkUrl ? (
                  <Image src={clip.artworkUrl} alt={clip.podcastTitle} fill className="object-cover" sizes="56px" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-[var(--text-tertiary)]">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M9 18V5l12-3v13" />
                      <circle cx="6" cy="18" r="3" />
                      <circle cx="18" cy="15" r="3" />
                    </svg>
                  </div>
                )}
              </div>

              {/* Info */}
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex items-center gap-2">
                  <span className="topic-pill">{clip.topic}</span>
                  {!clip.listened && <span className="new-badge">new</span>}
                </div>
                <p className="truncate text-[13px] font-semibold leading-tight">{clip.episodeTitle}</p>
                <p className="mt-0.5 truncate text-[12px] text-[var(--text-tertiary)]">
                  {clip.podcastTitle} · {formatTimestamp(clip.startMs)} · {durationSec}s
                </p>
              </div>

              {/* Play button */}
              <button
                className={`play-btn ${isClipPlaying ? "play-btn--active" : ""}`}
                onClick={(e) => { e.stopPropagation(); toggleClip(clip); }}
              >
                {isClipPlaying ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
              </button>
            </article>
          );
        })}
      </div>

      {/* Hidden audio */}
      <audio ref={audioRef} preload="metadata" className="hidden" />

      {/* ── Player Bar ── */}
      <div className="player-bar fixed inset-x-0 bottom-0 z-50">
        <div className="mx-auto flex max-w-4xl items-center gap-4 px-5 py-3">
          {/* Artwork */}
          <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-[var(--elevated)]">
            {currentClip?.artworkUrl ? (
              <Image src={currentClip.artworkUrl} alt={currentClip.podcastTitle} fill className="object-cover" sizes="48px" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-[var(--text-tertiary)]">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M9 18V5l12-3v13" />
                  <circle cx="6" cy="18" r="3" />
                  <circle cx="18" cy="15" r="3" />
                </svg>
              </div>
            )}
          </div>

          {/* Track info + progress */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium leading-tight">
                  {currentClip?.episodeTitle ?? "No clip selected"}
                </p>
                <p className="truncate text-[11px] text-[var(--text-tertiary)]">
                  {currentClip
                    ? `${currentClip.podcastTitle} · ${currentClip.topic}`
                    : "Select a clip to start listening"}
                </p>
              </div>
              <span className="ml-3 shrink-0 font-mono text-[11px] text-[var(--text-tertiary)]">
                {currentClip
                  ? `${formatClock(clipProgressMs)} / ${formatClock(clipDurationMs)}`
                  : "—:—"}
              </span>
            </div>

            {/* Progress bar */}
            <div
              className="progress-track mt-2"
              onClick={currentClip ? seekWithinCurrentClip : undefined}
            >
              <div className="progress-fill" style={{ width: `${progressPct}%` }} />
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => { if (currentClip) toggleClip(currentClip); }}
              disabled={!currentClip}
              className="play-btn"
              style={{ width: 44, height: 44 }}
            >
              {isPlaying ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
            </button>
            <button
              onClick={() => void playNextClip()}
              disabled={!currentClip}
              className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--text-tertiary)] transition hover:text-[var(--text-primary)] disabled:opacity-30"
            >
              <SkipIcon size={16} />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

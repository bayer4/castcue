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
      throw new Error("error" in payload ? payload.error ?? "Failed to load playlist" : "Failed to load playlist");
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
        if (active) {
          setMessage(error instanceof Error ? error.message : "Failed to load playlist");
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
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

  const playClip = useCallback(
    async (clipId: number) => {
      const clip = clips.find((entry) => entry.id === clipId);
      const audio = audioRef.current;
      if (!clip || !audio) return;

      const startSeconds = clip.startMs / 1000;
      const shouldSwapSrc = !audio.src || !audio.src.startsWith(clip.audioUrl);

      setCurrentClipId(clip.id);
      setClipProgressMs(0);
      if (!clip.listened) {
        void markAsListened(clip.id);
      }

      const startPlayback = async () => {
        audio.currentTime = startSeconds;
        try {
          await audio.play();
          setIsPlaying(true);
        } catch {
          setIsPlaying(false);
          setMessage("Audio playback was blocked by the browser. Click Play again.");
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
      if (currentClip) {
        setClipProgressMs(Math.max(0, currentClip.endMs - currentClip.startMs));
      }
      return;
    }
    await playClip(clips[nextIndex].id);
  }, [clips, currentClip, currentIndex, playClip]);

  function seekWithinCurrentClip(event: MouseEvent<HTMLButtonElement>) {
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

    const onEnded = () => {
      void playNextClip();
    };

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
    if (response.status === 401) {
      router.push("/login");
      setGenerating(false);
      return;
    }

    const payload = (await response.json()) as {
      createdCount?: number;
      scannedEpisodes?: number;
      scannedTopics?: number;
      error?: string;
    };

    if (!response.ok) {
      setMessage(payload.error ?? "Failed to generate clips.");
      setGenerating(false);
      return;
    }

    setMessage(
      `Generated ${payload.createdCount ?? 0} clips from ${payload.scannedEpisodes ?? 0} ready episodes across ${
        payload.scannedTopics ?? 0
      } topics.`,
    );
    await loadPlaylist();
    setGenerating(false);
  }

  async function handleClearClips() {
    const confirmed = window.confirm("Clear all generated clips for your current subscriptions?");
    if (!confirmed) return;

    setMessage(null);
    const response = await fetch("/api/playlist", { method: "DELETE" });
    if (response.status === 401) {
      router.push("/login");
      return;
    }

    const payload = (await response.json()) as { deleted?: number; error?: string };
    if (!response.ok) {
      setMessage(payload.error ?? "Failed to clear clips.");
      return;
    }

    setMessage(`Cleared ${payload.deleted ?? 0} clips. You can now regenerate.`);
    await loadPlaylist();
  }

  return (
    <section className="mx-auto max-w-5xl pb-28">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Playlist</h2>
          <p className="text-sm text-[var(--text-secondary)]">Your matched conversation clips appear here.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleClearClips}
            className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--elevated)] hover:text-[var(--text-primary)]"
          >
            Clear All Clips
          </button>
          <button
            onClick={handleGenerateClips}
            disabled={generating}
            className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--elevated)] hover:text-[var(--text-primary)] disabled:opacity-50"
          >
            {generating ? "Generating..." : "Generate Clips"}
          </button>
        </div>
      </header>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center">
        <p className="text-[var(--text-secondary)]">{message ?? "Click Generate Clips to build your queue."}</p>
      </div>

      <section className="mt-4 space-y-3">
        {loading ? <p className="text-sm text-[var(--text-secondary)]">Loading playlist...</p> : null}
        {!loading && clips.length === 0 ? (
          <p className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 text-sm text-[var(--text-secondary)]">
            No clips yet. Generate clips to populate your playlist.
          </p>
        ) : null}
        {clips.map((clip) => {
          const durationSec = Math.max(1, Math.round((clip.endMs - clip.startMs) / 1000));
          const startMin = Math.floor(clip.startMs / 60000);
          const startSec = Math.floor((clip.startMs % 60000) / 1000)
            .toString()
            .padStart(2, "0");
          return (
            <article
              key={clip.id}
              className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3"
            >
              <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md bg-[var(--elevated)]">
                {clip.artworkUrl ? (
                  <Image src={clip.artworkUrl} alt={clip.podcastTitle} fill className="object-cover" />
                ) : null}
              </div>
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex items-center gap-2">
                  <span className="rounded-full bg-[var(--accent)]/20 px-2 py-0.5 text-xs text-[var(--accent)]">
                    {clip.topic}
                  </span>
                  {!clip.listened ? (
                    <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] text-[var(--text-secondary)]">
                      NEW
                    </span>
                  ) : null}
                </div>
                <p className="truncate text-sm font-medium">{clip.episodeTitle}</p>
                <p className="truncate text-xs text-[var(--text-secondary)]">
                  {clip.podcastTitle} · {startMin}:{startSec} · {durationSec}s
                </p>
              </div>
              <button
                className="rounded-md border border-[var(--border)] px-3 py-1 text-sm text-[var(--text-secondary)] hover:bg-[var(--elevated)] hover:text-[var(--text-primary)]"
                onClick={() => toggleClip(clip)}
              >
                {currentClipId === clip.id && isPlaying ? "Pause" : "Play"}
              </button>
            </article>
          );
        })}
      </section>

      <audio ref={audioRef} preload="metadata" className="hidden" />

      <div className="fixed inset-x-0 bottom-0 border-t border-[var(--border)] bg-[var(--surface)]">
        <div className="mx-auto flex max-w-5xl items-center gap-3 p-3">
          <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-md bg-[var(--elevated)]">
            {currentClip?.artworkUrl ? (
              <Image src={currentClip.artworkUrl} alt={currentClip.podcastTitle} fill className="object-cover" />
            ) : null}
          </div>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{currentClip?.episodeTitle ?? "No clip selected"}</p>
            <p className="truncate text-xs text-[var(--text-secondary)]">
              {currentClip ? `${currentClip.topic} · ${currentClip.podcastTitle}` : "Select a clip to start listening"}
            </p>
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={seekWithinCurrentClip}
                disabled={!currentClip}
                className="group h-3 flex-1 overflow-hidden rounded-full border border-[var(--border)] bg-[var(--background)] disabled:cursor-not-allowed"
                aria-label="Seek within current clip"
              >
                <div
                  className="relative h-full bg-[var(--accent)] transition-all"
                  style={{
                    width: `${
                      currentClip
                        ? Math.min(
                            100,
                            (clipProgressMs / Math.max(1, currentClip.endMs - currentClip.startMs)) * 100,
                          )
                        : 0
                    }%`,
                  }}
                >
                  <span className="absolute right-0 top-1/2 h-3 w-3 -translate-y-1/2 translate-x-1/2 rounded-full border border-black/40 bg-[var(--accent)] shadow-sm" />
                </div>
              </button>
              <span className="text-[10px] text-[var(--text-secondary)]">
                {currentClip
                  ? `${formatClock(clipProgressMs)} / ${formatClock(currentClip.endMs - currentClip.startMs)}`
                  : "0:00 / 0:00"}
              </span>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => {
                if (!currentClip) return;
                void toggleClip(currentClip);
              }}
              className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--elevated)] hover:text-[var(--text-primary)]"
              disabled={!currentClip}
            >
              {isPlaying ? "Pause" : "Play"}
            </button>
            <button
              onClick={() => void playNextClip()}
              className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--elevated)] hover:text-[var(--text-primary)]"
              disabled={!currentClip}
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

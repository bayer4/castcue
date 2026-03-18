"use client";

import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type GenerationProgress = {
  current: number;
  total: number;
};

type GenerateErrorPayload = {
  error?: string;
};

type GenerationEventPayload =
  | { type: "start"; total: number }
  | { type: "progress"; current: number; total: number; clipsFound?: number }
  | { type: "done"; totalClips: number; scannedEpisodes: number; scannedTopics?: number; scannedPairs?: number }
  | { type: "error"; message?: string };

type GenerationContextValue = {
  isGenerating: boolean;
  statusMessage: string | null;
  progress: GenerationProgress | null;
  generationRunId: number;
  activePodcastId: string | null;
  queuedIds: string[];
  queuedEpisodeCount: number;
  completedEpisodes: number;
  setQueuedEpisodeCount: (count: number) => void;
  startGeneration: (options?: { podcastId?: string }) => void;
  enqueueGeneration: (podcastId: string) => void;
  clearStatus: () => void;
};

const GenerationContext = createContext<GenerationContextValue | null>(null);

export function GenerationProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [isGenerating, setIsGenerating] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [progress, setProgress] = useState<GenerationProgress | null>(null);
  const [generationRunId, setGenerationRunId] = useState(0);
  const [activePodcastId, setActivePodcastId] = useState<string | null>(null);
  const [queuedIds, setQueuedIds] = useState<string[]>([]);
  const [queuedEpisodeCount, setQueuedEpisodeCount] = useState(0);
  const [completedEpisodes, setCompletedEpisodes] = useState(0);

  const clearStatus = useCallback(() => {
    setStatusMessage(null);
  }, []);

  const runGeneration = useCallback((podcastId?: string) => {
    setIsGenerating(true);
    setStatusMessage(podcastId ? "Scanning podcast..." : "Scanning your podcasts...");
    setProgress(null);
    setActivePodcastId(podcastId ?? null);
    setGenerationRunId((value) => value + 1);

    void (async () => {
      try {
        const response = await fetch("/api/playlist/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(podcastId ? { podcastId } : {}),
        });
        if (response.status === 401) {
          setStatusMessage("Session expired. Please sign in again.");
          router.push("/login");
          return;
        }
        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as GenerateErrorPayload;
          setStatusMessage(payload.error ?? "Failed to generate clips.");
          return;
        }

        if (!response.body) {
          setStatusMessage("Generation failed. Please try again.");
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const chunks = buffer.split("\n\n");
          buffer = chunks.pop() ?? "";

          for (const chunk of chunks) {
            const dataLine = chunk
              .split("\n")
              .find((line) => line.startsWith("data: "));
            if (!dataLine) continue;

            let payload: GenerationEventPayload;
            try {
              payload = JSON.parse(dataLine.slice(6)) as GenerationEventPayload;
            } catch {
              continue;
            }

            if (payload.type === "start") {
              setProgress({ current: 0, total: payload.total });
              continue;
            }

            if (payload.type === "progress") {
              setProgress({ current: payload.current, total: payload.total });
              continue;
            }

            if (payload.type === "done") {
              setCompletedEpisodes((prev) => prev + payload.scannedEpisodes);
              setStatusMessage(`Found ${payload.totalClips} conversations across ${payload.scannedEpisodes} episodes.`);
              setProgress({ current: payload.scannedEpisodes, total: payload.scannedEpisodes });
              continue;
            }

            if (payload.type === "error") {
              setStatusMessage(payload.message ?? "Generation failed. Please try again.");
              continue;
            }
          }
        }
      } catch {
        setStatusMessage("Generation failed. Please try again.");
      } finally {
        setIsGenerating(false);
        setProgress(null);
        setActivePodcastId(null);
        setGenerationRunId((value) => value + 1);
      }
    })();
  }, [router]);

  const startGeneration = useCallback((options?: { podcastId?: string }) => {
    if (isGenerating) return;
    setCompletedEpisodes(0);
    setQueuedEpisodeCount(0);
    runGeneration(options?.podcastId);
  }, [isGenerating, runGeneration]);

  const enqueueGeneration = useCallback((podcastId: string) => {
    if (activePodcastId === podcastId) return;
    setQueuedIds((prev) => {
      if (prev.includes(podcastId)) return prev;
      return [...prev, podcastId];
    });
    if (!isGenerating) {
      setCompletedEpisodes(0);
      setQueuedEpisodeCount(0);
      setQueuedIds((prev) => prev.filter((id) => id !== podcastId));
      runGeneration(podcastId);
    }
  }, [isGenerating, activePodcastId, runGeneration]);

  // Drain queue when current generation finishes
  const prevIsGenerating = useRef(isGenerating);
  useEffect(() => {
    if (prevIsGenerating.current && !isGenerating && queuedIds.length > 0) {
      const [nextId, ...rest] = queuedIds;
      setQueuedIds(rest);
      runGeneration(nextId);
    }
    if (prevIsGenerating.current && !isGenerating && queuedIds.length === 0) {
      setCompletedEpisodes(0);
      setQueuedEpisodeCount(0);
    }
    prevIsGenerating.current = isGenerating;
  }, [isGenerating, queuedIds, runGeneration]);

  const value = useMemo(
    () => ({
      isGenerating,
      statusMessage,
      progress,
      generationRunId,
      activePodcastId,
      queuedIds,
      queuedEpisodeCount,
      setQueuedEpisodeCount,
      completedEpisodes,
      startGeneration,
      enqueueGeneration,
      clearStatus,
    }),
    [isGenerating, statusMessage, progress, generationRunId, activePodcastId, queuedIds, queuedEpisodeCount, completedEpisodes, startGeneration, enqueueGeneration, clearStatus],
  );

  return <GenerationContext.Provider value={value}>{children}</GenerationContext.Provider>;
}

export function useGeneration() {
  const context = useContext(GenerationContext);
  if (!context) {
    throw new Error("useGeneration must be used within GenerationProvider");
  }
  return context;
}

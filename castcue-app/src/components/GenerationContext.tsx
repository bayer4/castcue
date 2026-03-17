"use client";

import { createContext, ReactNode, useContext, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type GeneratePayload = {
  createdCount?: number;
  scannedEpisodes?: number;
  scannedTopics?: number;
  error?: string;
};

type GenerationContextValue = {
  isGenerating: boolean;
  statusMessage: string | null;
  generationRunId: number;
  startGeneration: () => void;
  clearStatus: () => void;
};

const GenerationContext = createContext<GenerationContextValue | null>(null);

export function GenerationProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [isGenerating, setIsGenerating] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [generationRunId, setGenerationRunId] = useState(0);

  function clearStatus() {
    setStatusMessage(null);
  }

  function startGeneration() {
    if (isGenerating) return;

    setIsGenerating(true);
    setStatusMessage("Scanning your podcasts...");
    setGenerationRunId((value) => value + 1);

    // Fire and forget: keeps running while user navigates across routes.
    void (async () => {
      try {
        const response = await fetch("/api/playlist/generate", { method: "POST" });
        if (response.status === 401) {
          setStatusMessage("Session expired. Please sign in again.");
          router.push("/login");
          return;
        }

        const payload = (await response.json()) as GeneratePayload;
        if (!response.ok) {
          setStatusMessage(payload.error ?? "Failed to generate clips.");
          return;
        }

        const created = payload.createdCount ?? 0;
        const scanned = payload.scannedEpisodes ?? 0;
        setStatusMessage(`Scan complete: found ${created} conversations across ${scanned} episodes.`);
      } catch {
        setStatusMessage("Generation failed. Please try again.");
      } finally {
        setIsGenerating(false);
        setGenerationRunId((value) => value + 1);
      }
    })();
  }

  const value = useMemo(
    () => ({
      isGenerating,
      statusMessage,
      generationRunId,
      startGeneration,
      clearStatus,
    }),
    [isGenerating, statusMessage, generationRunId],
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

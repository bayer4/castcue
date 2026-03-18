// PREREQUISITE: Run in Supabase SQL editor:
// ALTER TABLE episodes ADD COLUMN boundaries JSONB DEFAULT '[]';

import { cosine, mean, stdDev } from "./math";
import { SEARCH_CONFIG, StructuralBoundary } from "./types";

interface BoundarySegment {
  segment_index: number;
  start_ms: number;
  end_ms: number;
  embedding: number[];
}

export function computeStructuralBoundaries(
  segments: BoundarySegment[]
): StructuralBoundary[] {
  if (segments.length < 2) return [];

  const sorted = [...segments].sort((a, b) => a.segment_index - b.segment_index);
  const velocitySamples: Array<{ i: number; velocity: number }> = [];

  for (let i = 0; i < sorted.length - 1; i++) {
    const current = sorted[i];
    const next = sorted[i + 1];
    if (!current.embedding?.length || !next.embedding?.length) continue;

    const velocity = cosine(current.embedding, next.embedding);
    if (!Number.isFinite(velocity)) continue;
    velocitySamples.push({ i, velocity });
  }

  if (velocitySamples.length === 0) return [];

  const values = velocitySamples.map((sample) => sample.velocity);
  const avg = mean(values);
  const sd = stdDev(values, avg);

  const boundaries: StructuralBoundary[] = [];
  for (const sample of velocitySamples) {
    const dropZ = (avg - sample.velocity) / sd;
    if (dropZ > SEARCH_CONFIG.VELOCITY_Z_THRESHOLD) {
      boundaries.push({
        boundaryMs: sorted[sample.i + 1].start_ms,
        velocityDrop: sample.velocity,
      });
    }
  }

  return boundaries.sort((a, b) => a.boundaryMs - b.boundaryMs);
}

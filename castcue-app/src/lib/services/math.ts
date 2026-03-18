export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const length = Math.min(a.length, b.length);

  for (let i = 0; i < length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}

export function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

export function stdDev(arr: number[], avg: number): number {
  if (arr.length === 0) return 1e-6;
  const variance =
    arr.reduce((sum, v) => sum + (v - avg) ** 2, 0) / arr.length;
  return Math.sqrt(variance) || 1e-6;
}

export function averageVectors(vectors: number[][]): number[] {
  if (vectors.length === 0) return [];
  if (vectors.length === 1) return vectors[0];

  const dims = vectors[0].length;
  const result = new Array(dims).fill(0);

  for (const vec of vectors) {
    for (let i = 0; i < dims; i++) {
      result[i] += vec[i];
    }
  }

  for (let i = 0; i < dims; i++) {
    result[i] /= vectors.length;
  }

  return result;
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

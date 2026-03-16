// ============================================================
// Embedding Service
// Handles all OpenAI embedding operations
// ============================================================

import OpenAI from "openai";
import { SEARCH_CONFIG } from "./types";

let openai: OpenAI | null = null;

function getClient(): OpenAI {
  if (!openai) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openai;
}

/**
 * Generate embedding for a single text
 */
export async function embed(text: string): Promise<number[]> {
  const client = getClient();
  const response = await client.embeddings.create({
    model: SEARCH_CONFIG.EMBEDDING_MODEL,
    input: text,
  });
  return response.data[0].embedding;
}

/**
 * Generate embeddings for multiple texts (batched for efficiency)
 * OpenAI supports up to 2048 inputs per request
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const client = getClient();
  const BATCH_SIZE = 100; // Stay well under limit
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const response = await client.embeddings.create({
      model: SEARCH_CONFIG.EMBEDDING_MODEL,
      input: batch,
    });

    // OpenAI returns embeddings in same order as input
    for (const item of response.data) {
      results.push(item.embedding);
    }

    // Log progress for large batches
    if (texts.length > BATCH_SIZE) {
      console.log(
        `  Embedded ${Math.min(i + BATCH_SIZE, texts.length)}/${texts.length} segments`,
      );
    }
  }

  return results;
}

/**
 * Generate a topic query embedding with prompt engineering
 * "A detailed discussion about X" works better than just "X"
 */
export async function embedTopicQuery(topic: string): Promise<number[]> {
  return embed(`A detailed discussion about ${topic}`);
}

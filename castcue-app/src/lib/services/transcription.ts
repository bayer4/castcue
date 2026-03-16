import { TranscriptWord } from "./types";

type DeepgramWord = {
  word: string;
  start: number;
  end: number;
};

type DeepgramResponse = {
  results?: {
    channels?: Array<{
      alternatives?: Array<{
        words?: DeepgramWord[];
      }>;
    }>;
  };
};

export async function transcribeEpisode(audioUrl: string): Promise<TranscriptWord[]> {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    throw new Error("Missing DEEPGRAM_API_KEY");
  }

  const response = await fetch(
    "https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&utterances=true&punctuate=true&diarize=true",
    {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: audioUrl }),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Deepgram transcription failed: ${response.status} ${text}`);
  }

  const data = (await response.json()) as DeepgramResponse;
  const words = data.results?.channels?.[0]?.alternatives?.[0]?.words ?? [];

  return words.map((word) => ({
    text: word.word,
    start: Math.round(word.start * 1000),
    end: Math.round(word.end * 1000),
  }));
}

"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Topic = {
  id: string;
  name: string;
  created_at: string;
  clipCount: number;
};

export default function TopicsPage() {
  const router = useRouter();
  const [topics, setTopics] = useState<Topic[]>([]);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTopics = useCallback(async () => {
    const response = await fetch("/api/topics");
    if (response.status === 401) {
      router.push("/login");
      throw new Error("Unauthorized");
    }
    if (!response.ok) throw new Error("Failed to load topics");
    return (await response.json()) as Topic[];
  }, [router]);

  async function loadTopics() {
    setLoading(true);
    setError(null);
    try {
      setTopics(await fetchTopics());
    } catch {
      setError("Failed to load topics");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const data = await fetchTopics();
        if (!active) return;
        setTopics(data);
      } catch {
        if (!active) return;
        setError("Failed to load topics");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [fetchTopics]);

  async function createTopic(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;

    const response = await fetch("/api/topics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmed }),
    });

    if (!response.ok) {
      if (response.status === 401) {
        router.push("/login");
        return;
      }
      const payload = (await response.json()) as { error?: string };
      setError(payload.error ?? "Could not add topic");
      return;
    }

    setName("");
    await loadTopics();
  }

  async function deleteTopic(id: string) {
    const response = await fetch(`/api/topics/${id}`, { method: "DELETE" });
    if (!response.ok) {
      if (response.status === 401) {
        router.push("/login");
        return;
      }
      setError("Could not delete topic");
      return;
    }
    await loadTopics();
  }

  return (
    <section className="mx-auto max-w-4xl">
      <header className="mb-6">
        <h2 className="text-2xl font-semibold">Topics</h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Add topics you care about - CastCue will find conversations about them across your podcasts.
        </p>
      </header>

      <form onSubmit={createTopic} className="mb-6 flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Add topic (e.g., AI agents)"
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 outline-none ring-[var(--accent)] focus:ring-1"
        />
        <button className="rounded-lg bg-[var(--accent)] px-4 py-2 font-medium text-black">Add</button>
      </form>

      {error ? <p className="mb-4 text-sm text-red-400">{error}</p> : null}

      {loading ? (
        <p className="text-sm text-[var(--text-secondary)]">Loading topics...</p>
      ) : topics.length === 0 ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center text-[var(--text-secondary)]">
          Add topics you care about - CastCue will find conversations about them across your podcasts.
        </div>
      ) : (
        <div className="space-y-2">
          {topics.map((topic) => (
            <div
              key={topic.id}
              className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3"
            >
              <div>
                <p className="font-medium">{topic.name}</p>
                <p className="text-xs text-[var(--text-secondary)]">{topic.clipCount} clips</p>
              </div>
              <button
                onClick={() => deleteTopic(topic.id)}
                className="rounded-md border border-[var(--border)] px-2 py-1 text-sm text-[var(--text-secondary)] hover:bg-[var(--elevated)] hover:text-[var(--text-primary)]"
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

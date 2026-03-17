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
    <section className="mx-auto max-w-4xl pb-8">
      <header className="mb-6">
        <h2 className="text-2xl font-bold tracking-tight">Topics</h2>
        <p className="mt-1 text-sm text-[var(--text-tertiary)]">
          Add what you care about and CastCue will queue up matching conversations.
        </p>
      </header>

      <form onSubmit={createTopic} className="mb-6 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] p-3">
        <p className="mb-2 text-xs uppercase tracking-wide text-[var(--text-tertiary)]">Add topic</p>
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. AI agents, NBA playoffs, OpenAI"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--elevated)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none ring-[var(--accent)] transition focus:ring-1"
          />
          <button className="btn-primary">Add</button>
        </div>
      </form>

      {error ? (
        <p className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      ) : null}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
        </div>
      ) : topics.length === 0 ? (
        <div className="animate-fade-in flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--border)] py-16 text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--accent-muted)] text-[var(--accent)]">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M12 3v18M3 12h18" strokeLinecap="round" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold">No topics yet</h3>
          <p className="mt-1 max-w-sm text-sm text-[var(--text-tertiary)]">
            Add topics to start discovering the exact moments when your podcasts discuss them.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {topics.map((topic) => (
            <article
              key={topic.id}
              className="clip-card flex items-center justify-between rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] px-4 py-3"
            >
              <div>
                <div className="mb-1 flex items-center gap-2">
                  <span className="topic-pill">{topic.name}</span>
                  {topic.clipCount > 0 && <span className="new-badge">{topic.clipCount} clips</span>}
                </div>
                <p className="text-sm text-[var(--text-secondary)]">
                  {topic.clipCount === 0
                    ? "No clips yet"
                    : `${topic.clipCount} conversation${topic.clipCount === 1 ? "" : "s"} found`}
                </p>
              </div>
              <button
                onClick={() => deleteTopic(topic.id)}
                className="btn-ghost px-3 py-1.5 text-xs"
              >
                Delete
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

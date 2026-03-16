"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useState } from "react";

type Podcast = {
  id: string;
  title: string | null;
  description: string | null;
  image_url: string | null;
  rss_url: string;
  episodeCount: number;
  readyCount: number;
  processingCount: number;
  pendingCount: number;
  failedCount: number;
};

const popularPodcasts = [
  {
    title: "All-In Podcast",
    rssUrl: "https://rss.libsyn.com/shows/254861/destinations/1928300.xml",
    imageUrl:
      "https://is1-ssl.mzstatic.com/image/thumb/Podcasts124/v4/c7/d2/92/c7d292ea-44b3-47ff-2f5e-74fa5b23db6c/mza_7005270671777648882.png/600x600bb.jpg",
  },
  {
    title: "This Week in Startups",
    rssUrl: "https://anchor.fm/s/7c624c84/podcast/rss",
    imageUrl:
      "https://is1-ssl.mzstatic.com/image/thumb/Podcasts126/v4/bf/ce/23/bfce2354-2548-00f0-d795-a34404946a6b/mza_10222213905677371023.jpg/600x600bb.jpg",
  },
  {
    title: "The Bill Simmons Podcast",
    rssUrl: "https://feeds.megaphone.fm/the-bill-simmons-podcast",
    imageUrl:
      "https://is1-ssl.mzstatic.com/image/thumb/Podcasts211/v4/22/ca/58/22ca58e3-6aa9-ab35-b900-c715ddee0d3f/mza_6881305964363479864.jpg/600x600bb.jpg",
  },
  {
    title: "Huberman Lab",
    rssUrl: "https://feeds.megaphone.fm/hubermanlab",
    imageUrl:
      "https://is1-ssl.mzstatic.com/image/thumb/Podcasts221/v4/9a/d3/19/9ad31912-0b5a-a16e-2d7c-9fd074698b9c/mza_8994222203629500925.jpg/600x600bb.jpg",
  },
  {
    title: "Lex Fridman Podcast",
    rssUrl: "https://lexfridman.com/feed/podcast/",
    imageUrl:
      "https://is1-ssl.mzstatic.com/image/thumb/Podcasts115/v4/3e/e3/9c/3ee39c89-de08-47a6-7f3d-3849cef6d255/mza_16657851278549137484.png/600x600bb.jpg",
  },
  {
    title: "This Week in AI",
    rssUrl: "https://anchor.fm/s/10803d078/podcast/rss",
    imageUrl:
      "https://is1-ssl.mzstatic.com/image/thumb/Podcasts221/v4/61/5a/77/615a7751-f71e-1359-3f7c-40c3962253e4/mza_13119648361938912426.jpg/600x600bb.jpg",
  },
  {
    title: "The Startup Ideas Podcast",
    rssUrl: "https://rss2.flightcast.com/ordbkg8yojpehffas7vr7qpc.xml",
    imageUrl:
      "https://is1-ssl.mzstatic.com/image/thumb/Podcasts211/v4/d3/d7/fa/d3d7fab7-d7af-47a4-c985-32ea10f0ae67/mza_16751416052578985439.jpg/600x600bb.jpg",
  },
  {
    title: "My First Million",
    rssUrl: "https://feeds.megaphone.fm/HS2300184645",
    imageUrl:
      "https://is1-ssl.mzstatic.com/image/thumb/Podcasts221/v4/2a/5e/4d/2a5e4df0-8f2f-c5c7-1be9-4d220778f967/mza_12868536899493151042.jpeg/600x600bb.jpg",
  },
  {
    title: "The Tim Ferriss Show",
    rssUrl: "https://rss.art19.com/tim-ferriss-show",
    imageUrl:
      "https://is1-ssl.mzstatic.com/image/thumb/Podcasts126/v4/18/39/b4/1839b420-7aff-c501-5d0d-af2842fba013/mza_6255154260686997849.jpeg/600x600bb.jpg",
  },
  {
    title: "Hard Fork",
    rssUrl: "https://feeds.simplecast.com/6HKOhNgS",
    imageUrl:
      "https://is1-ssl.mzstatic.com/image/thumb/Podcasts221/v4/de/c5/20/dec52092-6be0-9007-875c-6aa8e690a905/mza_12490014444602578825.jpg/600x600bb.jpg",
  },
] as const;

export default function PodcastsPage() {
  const router = useRouter();
  const [podcasts, setPodcasts] = useState<Podcast[]>([]);
  const [rssUrl, setRssUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [subscribing, setSubscribing] = useState(false);
  const [busyRssUrl, setBusyRssUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchPodcasts = useCallback(async () => {
    const response = await fetch("/api/podcasts");
    if (response.status === 401) {
      router.push("/login");
      throw new Error("Unauthorized");
    }
    if (!response.ok) throw new Error("Failed to load podcasts");
    return (await response.json()) as Podcast[];
  }, [router]);

  async function loadPodcasts() {
    setLoading(true);
    setError(null);
    try {
      setPodcasts(await fetchPodcasts());
    } catch {
      setError("Failed to load podcasts");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const data = await fetchPodcasts();
        if (!active) return;
        setPodcasts(data);
      } catch {
        if (!active) return;
        setError("Failed to load podcasts");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [fetchPodcasts]);

  async function subscribe(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!rssUrl.trim()) return;

    setSubscribing(true);
    setError(null);

    const response = await fetch("/api/podcasts/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rssUrl: rssUrl.trim() }),
    });

    if (!response.ok) {
      if (response.status === 401) {
        router.push("/login");
        setSubscribing(false);
        return;
      }
      const payload = (await response.json()) as { error?: string };
      setError(payload.error ?? "Could not subscribe");
      setSubscribing(false);
      return;
    }

    setRssUrl("");
    setSubscribing(false);
    await loadPodcasts();
  }

  async function unsubscribe(id: string) {
    const response = await fetch(`/api/podcasts/${id}`, { method: "DELETE" });
    if (!response.ok) {
      if (response.status === 401) {
        router.push("/login");
        return;
      }
      setError("Could not unsubscribe");
      return;
    }
    await loadPodcasts();
  }

  async function subscribeByRssUrl(targetRssUrl: string) {
    setBusyRssUrl(targetRssUrl);
    setError(null);

    const response = await fetch("/api/podcasts/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rssUrl: targetRssUrl }),
    });

    if (!response.ok) {
      if (response.status === 401) {
        router.push("/login");
        setBusyRssUrl(null);
        return;
      }
      const payload = (await response.json()) as { error?: string };
      setError(payload.error ?? "Could not subscribe");
      setBusyRssUrl(null);
      return;
    }

    setBusyRssUrl(null);
    await loadPodcasts();
  }

  async function processEpisodes(podcastId?: string) {
    setError(null);
    const response = await fetch("/api/episodes/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(podcastId ? { podcastId } : {}),
    });
    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      setError(payload.error ?? "Could not process episodes");
      return;
    }
    await loadPodcasts();
  }

  const subscribedSet = new Set(podcasts.map((podcast) => podcast.rss_url));

  return (
    <section className="mx-auto max-w-5xl">
      <header className="mb-6">
        <h2 className="text-2xl font-semibold">Podcasts</h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Subscribe to podcasts to start finding conversations.
        </p>
      </header>

      <section className="mb-8">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-medium">Popular Podcasts</h3>
          <button
            onClick={() => processEpisodes()}
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--elevated)] hover:text-[var(--text-primary)]"
          >
            Process All Pending
          </button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {popularPodcasts.map((podcast) => {
            const subscribed = subscribedSet.has(podcast.rssUrl);
            const busy = busyRssUrl === podcast.rssUrl;
            return (
              <article
                key={podcast.rssUrl}
                className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3"
              >
                <div className="mb-3 flex items-center gap-3">
                  <div className="relative h-14 w-14 overflow-hidden rounded-md bg-[var(--elevated)]">
                    <Image src={podcast.imageUrl} alt={podcast.title} fill className="object-cover" />
                  </div>
                  <p className="line-clamp-2 text-sm font-medium">{podcast.title}</p>
                </div>
                <button
                  disabled={busy || subscribed}
                  onClick={() => subscribeByRssUrl(podcast.rssUrl)}
                  className="w-full rounded-md bg-[var(--accent)] px-3 py-2 text-sm font-medium text-black disabled:opacity-50"
                >
                  {subscribed ? "Subscribed" : busy ? "Subscribing..." : "Subscribe"}
                </button>
              </article>
            );
          })}
        </div>
      </section>

      <form onSubmit={subscribe} className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        <p className="mb-2 text-xs uppercase tracking-wide text-[var(--text-tertiary)]">
          Manual RSS (optional)
        </p>
        <div className="flex gap-2">
          <input
            value={rssUrl}
            onChange={(e) => setRssUrl(e.target.value)}
            placeholder="Paste a custom podcast RSS URL"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--elevated)] px-3 py-2 text-sm outline-none ring-[var(--accent)] focus:ring-1"
          />
          <button
            disabled={subscribing}
            className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] disabled:opacity-50"
          >
            {subscribing ? "Adding..." : "Add"}
          </button>
        </div>
      </form>

      {error ? <p className="mb-4 text-sm text-red-400">{error}</p> : null}

      {loading ? (
        <p className="text-sm text-[var(--text-secondary)]">Loading podcasts...</p>
      ) : podcasts.length === 0 ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center text-[var(--text-secondary)]">
          Subscribe to podcasts to start finding conversations.
        </div>
      ) : (
        <div className="space-y-3">
          {podcasts.map((podcast) => (
            <article
              key={podcast.id}
              className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
            >
              <div className="flex items-center gap-3">
                <div className="relative h-12 w-12 overflow-hidden rounded-md bg-[var(--elevated)]">
                  {podcast.image_url ? (
                    <Image src={podcast.image_url} alt="" fill className="object-cover" />
                  ) : null}
                </div>
                <div>
                  <p className="font-medium">{podcast.title ?? "Untitled podcast"}</p>
                  <p className="text-xs text-[var(--text-secondary)]">
                    {podcast.episodeCount} episodes · {podcast.readyCount} ready · {podcast.processingCount} processing
                    · {podcast.pendingCount} pending
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => processEpisodes(podcast.id)}
                  className="rounded-md border border-[var(--border)] px-3 py-1 text-sm text-[var(--text-secondary)] hover:bg-[var(--elevated)] hover:text-[var(--text-primary)]"
                >
                  Process Episodes
                </button>
                <button
                  onClick={() => unsubscribe(podcast.id)}
                  className="rounded-md border border-[var(--border)] px-3 py-1 text-sm text-[var(--text-secondary)] hover:bg-[var(--elevated)] hover:text-[var(--text-primary)]"
                >
                  Unsubscribe
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

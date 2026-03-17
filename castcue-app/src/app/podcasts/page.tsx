"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

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

type ItunesPodcastResult = {
  trackId: number;
  collectionName: string;
  artistName: string;
  artworkUrl100?: string;
  feedUrl?: string;
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
  const [loading, setLoading] = useState(true);
  const [busyRssUrl, setBusyRssUrl] = useState<string | null>(null);
  const [optimisticFollows, setOptimisticFollows] = useState<Set<string>>(new Set());
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<ItunesPodcastResult[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);

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
    setError(null);
    try {
      setPodcasts(await fetchPodcasts());
    } catch {
      setError("Failed to load podcasts");
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

  async function unsubscribe(id: string) {
    const response = await fetch(`/api/podcasts/${id}`, { method: "DELETE" });
    if (!response.ok) {
      if (response.status === 401) {
        router.push("/login");
        return;
      }
      setError("Could not unfollow");
      return;
    }
    await loadPodcasts();
  }

  async function subscribeByRssUrl(targetRssUrl: string) {
    setBusyRssUrl(targetRssUrl);
    setOptimisticFollows((prev) => new Set(prev).add(targetRssUrl));
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
        setOptimisticFollows((prev) => { const next = new Set(prev); next.delete(targetRssUrl); return next; });
        return;
      }
      const payload = (await response.json()) as { error?: string };
      setError(payload.error ?? "Could not follow");
      setBusyRssUrl(null);
      setOptimisticFollows((prev) => { const next = new Set(prev); next.delete(targetRssUrl); return next; });
      return;
    }

    setBusyRssUrl(null);
    await loadPodcasts();
    setOptimisticFollows((prev) => { const next = new Set(prev); next.delete(targetRssUrl); return next; });
  }

  async function processEpisodes(podcastId?: string) {
    const key = podcastId ?? "_all";
    setProcessingIds((prev) => new Set(prev).add(key));
    setError(null);
    try {
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
    } finally {
      setProcessingIds((prev) => { const next = new Set(prev); next.delete(key); return next; });
    }
  }

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedQuery(searchQuery.trim());
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [searchQuery]);

  useEffect(() => {
    if (debouncedQuery.length < 3) {
      setSearchResults([]);
      setSearchError(null);
      setSearching(false);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    (async () => {
      setSearching(true);
      setSearchError(null);

      try {
        const response = await fetch(
          `https://itunes.apple.com/search?term=${encodeURIComponent(debouncedQuery)}&media=podcast&limit=8`,
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error("Search failed");

        const payload = (await response.json()) as { results?: ItunesPodcastResult[] };
        if (!cancelled) {
          setSearchResults(
            (payload.results ?? []).filter((result) => Boolean(result.feedUrl)),
          );
        }
      } catch (fetchError) {
        if (!cancelled && !(fetchError instanceof DOMException && fetchError.name === "AbortError")) {
          setSearchError("Could not search podcasts right now.");
          setSearchResults([]);
        }
      } finally {
        if (!cancelled) setSearching(false);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [debouncedQuery]);

  const subscribedSet = new Set([
    ...podcasts.map((podcast) => podcast.rss_url),
    ...optimisticFollows,
  ]);

  return (
    <section className="mx-auto max-w-5xl pb-8">
      <header className="mb-6">
        <h2 className="text-2xl font-bold tracking-tight">Podcasts</h2>
        <p className="mt-1 text-sm text-[var(--text-tertiary)]">
          Follow podcasts to start finding conversations.
        </p>
      </header>

      <section className="mb-8 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] p-5">
        <p className="mb-2 text-xs uppercase tracking-wide text-[var(--text-tertiary)]">
          Search Podcasts
        </p>
        <h3 className="text-xl font-semibold tracking-tight">Find podcasts by name</h3>
        <p className="mt-1 text-sm text-[var(--text-tertiary)]">Search Apple Podcasts and follow in one click.</p>
        <div className="mt-4 flex gap-2">
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Type podcast name (min 3 characters)"
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--elevated)] px-4 py-3 text-base text-[var(--text-primary)] outline-none ring-[var(--accent)] transition focus:ring-1"
          />
        </div>
        <p className="mt-2 text-xs text-[var(--text-tertiary)]">
          Results come from Apple Podcasts.
        </p>

        {searchError ? (
          <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {searchError}
          </p>
        ) : null}

        {debouncedQuery.length >= 3 && (
          <div className="mt-4 space-y-2">
            {searching ? (
              <div className="flex items-center justify-center py-6">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
              </div>
            ) : searchResults.length === 0 ? (
              <p className="text-sm text-[var(--text-tertiary)]">No matching podcasts found.</p>
            ) : (
              searchResults.map((result) => {
                const feedUrl = result.feedUrl ?? "";
                const subscribed = subscribedSet.has(feedUrl);
                const busy = busyRssUrl === feedUrl;

                return (
                  <article
                    key={result.trackId}
                    className="clip-card flex items-center justify-between rounded-lg border border-[var(--border-subtle)] bg-[var(--elevated)] p-3"
                  >
                    <div className="mr-3 flex min-w-0 items-center gap-3">
                      <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-[var(--surface)]">
                        {result.artworkUrl100 ? (
                          <Image src={result.artworkUrl100} alt={result.collectionName} fill className="object-cover" sizes="48px" />
                        ) : null}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{result.collectionName}</p>
                        <p className="truncate text-xs text-[var(--text-tertiary)]">{result.artistName}</p>
                      </div>
                    </div>
                    <button
                      disabled={busy || subscribed || !feedUrl}
                      onClick={() => {
                        if (feedUrl) void subscribeByRssUrl(feedUrl);
                      }}
                      className={`shrink-0 ${subscribed ? "btn-ghost" : "btn-primary"} disabled:opacity-50`}
                    >
                      {subscribed ? "Following" : busy ? "Following..." : "Follow"}
                    </button>
                  </article>
                );
              })
            )}
          </div>
        )}
      </section>

      <section className="mb-8">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Suggested</h3>
          <button
            onClick={() => processEpisodes()}
            disabled={processingIds.has("_all")}
            className="btn-ghost disabled:opacity-50"
          >
            {processingIds.has("_all") ? "Processing..." : "Process All Pending"}
          </button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {popularPodcasts.map((podcast) => {
            const subscribed = subscribedSet.has(podcast.rssUrl);
            const busy = busyRssUrl === podcast.rssUrl;
            return (
              <article
                key={podcast.rssUrl}
                className="clip-card rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] p-3"
              >
                <div className="mb-3 flex items-center gap-3">
                  <div className="relative h-16 w-16 overflow-hidden rounded-lg bg-[var(--elevated)]">
                    <Image src={podcast.imageUrl} alt={podcast.title} fill className="object-cover" sizes="64px" />
                  </div>
                  <div className="min-w-0">
                    <p className="line-clamp-2 text-sm font-semibold">{podcast.title}</p>
                    <p className="mt-1 text-xs text-[var(--text-tertiary)]">Curated source</p>
                  </div>
                </div>
                {!loading && (
                  <button
                    disabled={busy || subscribed}
                    onClick={() => subscribeByRssUrl(podcast.rssUrl)}
                    className={`w-full ${subscribed ? "btn-ghost" : "btn-primary"} justify-center disabled:opacity-50`}
                  >
                    {subscribed ? "Following" : busy ? "Following..." : "Follow"}
                  </button>
                )}
              </article>
            );
          })}
        </div>
      </section>

      {error ? (
        <p className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      ) : null}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
        </div>
      ) : podcasts.length === 0 ? (
        <div className="animate-fade-in rounded-xl border border-dashed border-[var(--border)] py-16 text-center text-[var(--text-secondary)]">
          Follow podcasts to start finding conversations.
        </div>
      ) : (
        <div className="space-y-3">
          {podcasts.map((podcast) => (
            <article
              key={podcast.id}
              className="clip-card flex items-center justify-between rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] p-4"
            >
              <div className="flex items-center gap-3">
                <div className="relative h-12 w-12 overflow-hidden rounded-lg bg-[var(--elevated)]">
                  {podcast.image_url ? (
                    <Image src={podcast.image_url} alt="" fill className="object-cover" sizes="48px" />
                  ) : null}
                </div>
                <div className="min-w-0">
                  <p className="truncate font-semibold">{podcast.title ?? "Untitled podcast"}</p>
                  <p className="truncate text-xs text-[var(--text-secondary)]">
                    {podcast.episodeCount} episodes · {podcast.readyCount} ready · {podcast.processingCount} processing
                    · {podcast.pendingCount} pending
                  </p>
                  {podcast.failedCount > 0 ? (
                    <p className="mt-1 text-xs text-red-300">{podcast.failedCount} failed</p>
                  ) : null}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => processEpisodes(podcast.id)}
                  disabled={processingIds.has(podcast.id) || processingIds.has("_all")}
                  className="btn-ghost px-3 py-1.5 text-xs disabled:opacity-50"
                >
                  {processingIds.has(podcast.id) || processingIds.has("_all") ? "Processing..." : "Process Episodes"}
                </button>
                <button
                  onClick={() => unsubscribe(podcast.id)}
                  className="btn-ghost px-3 py-1.5 text-xs"
                >
                  Unfollow
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

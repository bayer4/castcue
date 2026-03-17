'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { podcasts, auth, Podcast, PodcastSearchResult, User, ApiError } from '@/lib/api';
import Sidebar from '@/components/Sidebar';

export default function PodcastsPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [podcastList, setPodcastList] = useState<Podcast[]>([]);
  
  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<PodcastSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [subscribingIds, setSubscribingIds] = useState<Set<number>>(new Set());
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // RSS state
  const [showRss, setShowRss] = useState(false);
  const [rssInput, setRssInput] = useState('');
  const [rssLoading, setRssLoading] = useState(false);
  const [rssError, setRssError] = useState<string | null>(null);

  useEffect(() => {
    const loadData = async () => {
      try {
        const [userData, podcastsRes] = await Promise.all([
          auth.me(),
          podcasts.list(),
        ]);
        setUser(userData);
        setPodcastList(podcastsRes.podcasts);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          router.replace('/login');
        }
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [router]);

  // Debounced search
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    searchTimeoutRef.current = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const { results } = await podcasts.search(searchQuery);
        setSearchResults(results);
      } catch (err) {
        console.error('Search failed:', err);
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 300);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchQuery]);

  const handleSubscribe = async (result: PodcastSearchResult) => {
    setSubscribingIds((prev) => new Set(prev).add(result.podcastId));

    try {
      const { podcast } = await podcasts.subscribe({
        feedUrl: result.feedUrl,
        title: result.title,
        imageUrl: result.artworkUrl600 || undefined,
      });
      setPodcastList((prev) => [podcast, ...prev]);
      setSearchResults((prev) => prev.filter((r) => r.podcastId !== result.podcastId));
    } catch (err) {
      console.error('Failed to follow:', err);
    } finally {
      setSubscribingIds((prev) => {
        const next = new Set(prev);
        next.delete(result.podcastId);
        return next;
      });
    }
  };

  const handleRssSubscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rssInput.trim()) return;

    setRssLoading(true);
    setRssError(null);

    try {
      const { podcast } = await podcasts.subscribe(rssInput.trim());
      setPodcastList((prev) => [podcast, ...prev]);
      setRssInput('');
      setShowRss(false);
    } catch (err) {
      if (err instanceof ApiError) {
        setRssError(err.message);
      }
    } finally {
      setRssLoading(false);
    }
  };

  const handleUnsubscribe = async (id: string) => {
    try {
      await podcasts.unsubscribe(id);
      setPodcastList((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      console.error('Failed to unfollow:', err);
    }
  };

  const isSubscribed = (feedUrl: string) => {
    return podcastList.some((p) => p.rssUrl === feedUrl);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex">
      <Sidebar user={user} activeNav="podcasts" />

      <main className="flex-1 flex flex-col">
        <header className="h-14 px-6 border-b border-border flex items-center justify-between">
          <h1 className="text-lg font-semibold text-text-primary">Podcasts</h1>
          <span className="px-2 py-1 bg-bg-secondary rounded text-sm text-text-tertiary">
            {podcastList.length} podcast{podcastList.length !== 1 ? 's' : ''}
          </span>
        </header>

        <div className="flex-1 p-6 max-w-2xl">
          {/* Search input */}
          <div className="relative mb-4">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-text-tertiary"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search podcasts to add..."
              className="w-full pl-10 pr-4 py-2.5 bg-bg-tertiary border border-border rounded-lg text-text-primary placeholder:text-text-tertiary focus:border-accent focus:ring-1 focus:ring-accent transition-colors"
            />
            {searchLoading && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              </div>
            )}
          </div>

          {/* Search results */}
          {searchQuery.trim() && (
            <div className="mb-6 max-h-64 overflow-y-auto">
              {searchResults.length === 0 && !searchLoading ? (
                <p className="text-text-tertiary text-sm text-center py-4">
                  No podcasts found for "{searchQuery}"
                </p>
              ) : (
                <div className="space-y-2">
                  {searchResults.map((result) => {
                    const alreadySubscribed = isSubscribed(result.feedUrl);
                    const isSubscribing = subscribingIds.has(result.podcastId);
                    
                    return (
                      <div
                        key={result.podcastId}
                        className="flex items-center gap-3 p-3 bg-bg-secondary border border-border rounded-lg"
                      >
                        <div className="w-12 h-12 rounded-lg bg-bg-hover flex-shrink-0 overflow-hidden">
                          {result.artworkUrl600 ? (
                            <img src={result.artworkUrl600} alt="" className="w-12 h-12 object-cover" />
                          ) : (
                            <div className="w-12 h-12 flex items-center justify-center">
                              <svg className="w-6 h-6 text-text-tertiary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                              </svg>
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-text-primary font-medium truncate text-sm">{result.title}</p>
                          <p className="text-text-tertiary text-xs truncate">{result.author}</p>
                        </div>
                        <button
                          onClick={() => handleSubscribe(result)}
                          disabled={alreadySubscribed || isSubscribing}
                          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex-shrink-0 ${
                            alreadySubscribed
                              ? 'bg-bg-hover text-text-tertiary cursor-default'
                              : 'bg-accent hover:bg-accent-hover text-white disabled:opacity-50'
                          }`}
                        >
                          {alreadySubscribed ? 'Added' : isSubscribing ? '...' : 'Add'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* RSS URL option */}
          <div className="mb-6">
            <button
              onClick={() => setShowRss(!showRss)}
              className="flex items-center gap-2 text-sm text-text-tertiary hover:text-text-secondary transition-colors"
            >
              <svg
                className={`w-4 h-4 transition-transform ${showRss ? 'rotate-90' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              Add via RSS URL
            </button>
            
            {showRss && (
              <form onSubmit={handleRssSubscribe} className="mt-3 flex gap-2">
                <input
                  type="url"
                  value={rssInput}
                  onChange={(e) => setRssInput(e.target.value)}
                  placeholder="https://feeds.example.com/podcast.xml"
                  className="flex-1 px-3 py-2 bg-bg-tertiary border border-border rounded-lg text-text-primary placeholder:text-text-tertiary focus:border-accent focus:ring-1 focus:ring-accent transition-colors font-mono text-sm"
                />
                <button
                  type="submit"
                  disabled={rssLoading || !rssInput.trim()}
                  className="px-3 py-2 bg-accent hover:bg-accent-hover rounded-lg font-medium text-white transition-colors disabled:opacity-50"
                >
                  {rssLoading ? '...' : 'Add'}
                </button>
              </form>
            )}
            {rssError && <p className="text-sm text-red-400 mt-2">{rssError}</p>}
          </div>

          {/* Followed podcasts */}
          <h2 className="text-sm font-medium text-text-secondary mb-3">Your podcasts</h2>
          {podcastList.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-12 h-12 rounded-xl bg-bg-secondary border border-border flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6 text-text-tertiary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
              </div>
              <p className="text-text-secondary">No podcasts yet</p>
              <p className="text-text-tertiary text-sm">Search above to add podcasts</p>
            </div>
          ) : (
            <div className="space-y-2">
              {podcastList.map((podcast) => (
                <div
                  key={podcast.id}
                  className="flex items-center gap-3 p-3 bg-bg-secondary border border-border rounded-lg group"
                >
                  <div className="w-12 h-12 rounded-lg bg-bg-hover flex-shrink-0 overflow-hidden">
                    {podcast.imageUrl ? (
                      <img src={podcast.imageUrl} alt="" className="w-12 h-12 object-cover" />
                    ) : (
                      <div className="w-12 h-12 flex items-center justify-center">
                        <svg className="w-6 h-6 text-text-tertiary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                        </svg>
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-text-primary font-medium truncate">{podcast.title || 'Loading...'}</p>
                    <p className="text-text-tertiary text-xs truncate font-mono">{podcast.rssUrl}</p>
                  </div>
                  <button
                    onClick={() => handleUnsubscribe(podcast.id)}
                    className="p-2 text-text-tertiary hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                    title="Unfollow"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}


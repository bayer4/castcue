'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { userTopics, podcasts, Topic, Podcast, PodcastSearchResult, ApiError } from '@/lib/api';

type Step = 'topics' | 'podcasts';

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('topics');
  const [loading, setLoading] = useState(true);

  // Topics state
  const [topics, setTopics] = useState<Topic[]>([]);
  const [topicInput, setTopicInput] = useState('');
  const [topicLoading, setTopicLoading] = useState(false);
  const [topicError, setTopicError] = useState<string | null>(null);

  // Podcasts state
  const [podcastList, setPodcastList] = useState<Podcast[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<PodcastSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [subscribingIds, setSubscribingIds] = useState<Set<number>>(new Set());
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [rssInput, setRssInput] = useState('');
  const [rssLoading, setRssLoading] = useState(false);
  const [rssError, setRssError] = useState<string | null>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Load existing data on mount
  useEffect(() => {
    const loadData = async () => {
      try {
        const [topicsRes, podcastsRes] = await Promise.all([
          userTopics.list(),
          podcasts.list(),
        ]);
        setTopics(topicsRes.topics);
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

  // Add topic
  const handleAddTopic = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topicInput.trim()) return;

    setTopicLoading(true);
    setTopicError(null);

    try {
      const topic = await userTopics.add(topicInput.trim());
      setTopics((prev) => [topic, ...prev]);
      setTopicInput('');
    } catch (err) {
      if (err instanceof ApiError) {
        setTopicError(err.message);
      }
    } finally {
      setTopicLoading(false);
    }
  };

  // Remove topic
  const handleRemoveTopic = async (id: number) => {
    try {
      await userTopics.remove(id);
      setTopics((prev) => prev.filter((t) => t.id !== id));
    } catch (err) {
      console.error('Failed to remove topic:', err);
    }
  };

  // Subscribe to podcast from search
  const handleSubscribe = async (result: PodcastSearchResult) => {
    setSubscribingIds((prev) => new Set(prev).add(result.podcastId));

    try {
      const { podcast } = await podcasts.subscribe({
        feedUrl: result.feedUrl,
        title: result.title,
        imageUrl: result.artworkUrl600 || undefined,
      });
      setPodcastList((prev) => [podcast, ...prev]);
      // Remove from search results
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

  // Subscribe via RSS URL
  const handleRssSubscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rssInput.trim()) return;

    setRssLoading(true);
    setRssError(null);

    try {
      const { podcast } = await podcasts.subscribe(rssInput.trim());
      setPodcastList((prev) => [podcast, ...prev]);
      setRssInput('');
      setShowAdvanced(false);
    } catch (err) {
      if (err instanceof ApiError) {
        setRssError(err.message);
      }
    } finally {
      setRssLoading(false);
    }
  };

  // Remove podcast
  const handleRemovePodcast = async (id: string) => {
    try {
      await podcasts.unsubscribe(id);
      setPodcastList((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      console.error('Failed to remove podcast:', err);
    }
  };

  // Check if podcast is already followed
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
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        {/* Progress */}
        <div className="flex items-center gap-2 mb-8">
          <div
            className={`flex-1 h-1 rounded-full transition-colors ${
              step === 'topics' ? 'bg-accent' : 'bg-accent/30'
            }`}
          />
          <div
            className={`flex-1 h-1 rounded-full transition-colors ${
              step === 'podcasts' ? 'bg-accent' : 'bg-border'
            }`}
          />
        </div>

        {/* Step 1: Topics */}
        {step === 'topics' && (
          <div className="bg-bg-secondary border border-border rounded-xl p-6">
            <h2 className="text-xl font-semibold text-text-primary mb-1">
              What topics interest you?
            </h2>
            <p className="text-text-secondary text-sm mb-6">
              We'll find discussions about these topics in your podcasts.
            </p>

            {/* Topic input */}
            <form onSubmit={handleAddTopic} className="flex gap-2 mb-4">
              <input
                type="text"
                value={topicInput}
                onChange={(e) => setTopicInput(e.target.value)}
                placeholder="e.g., artificial intelligence, climate change"
                className="flex-1 px-4 py-2.5 bg-bg-tertiary border border-border rounded-lg text-text-primary placeholder:text-text-tertiary focus:border-accent focus:ring-1 focus:ring-accent transition-colors"
              />
              <button
                type="submit"
                disabled={topicLoading || !topicInput.trim()}
                className="px-4 py-2.5 bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed rounded-lg font-medium text-white transition-colors"
              >
                {topicLoading ? '...' : 'Add'}
              </button>
            </form>

            {topicError && (
              <p className="text-sm text-red-400 mb-4">{topicError}</p>
            )}

            {/* Topic chips */}
            <div className="flex flex-wrap gap-2 mb-6 min-h-[40px]">
              {topics.length === 0 ? (
                <p className="text-text-tertiary text-sm">No topics yet</p>
              ) : (
                topics.map((topic) => (
                  <span
                    key={topic.id}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-accent-muted text-accent rounded-full text-sm font-medium"
                  >
                    {topic.name}
                    <button
                      onClick={() => handleRemoveTopic(topic.id)}
                      className="hover:text-white transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </span>
                ))
              )}
            </div>

            <button
              onClick={() => setStep('podcasts')}
              disabled={topics.length === 0}
              className="w-full px-4 py-3 bg-accent hover:bg-accent-hover disabled:bg-bg-tertiary disabled:text-text-tertiary disabled:cursor-not-allowed rounded-lg font-medium text-white transition-colors"
            >
              Continue
            </button>
          </div>
        )}

        {/* Step 2: Podcasts */}
        {step === 'podcasts' && (
          <div className="bg-bg-secondary border border-border rounded-xl p-6">
            <h2 className="text-xl font-semibold text-text-primary mb-1">
              Add your podcasts
            </h2>
            <p className="text-text-secondary text-sm mb-6">
              Search for podcasts to follow.
            </p>

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
                placeholder="Search podcasts..."
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
              <div className="mb-4 max-h-64 overflow-y-auto">
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
                          className="flex items-center gap-3 p-3 bg-bg-tertiary rounded-lg"
                        >
                          <div className="w-12 h-12 rounded-lg bg-bg-hover flex-shrink-0 overflow-hidden">
                            {result.artworkUrl600 ? (
                              <img
                                src={result.artworkUrl600}
                                alt=""
                                className="w-12 h-12 object-cover"
                              />
                            ) : (
                              <div className="w-12 h-12 flex items-center justify-center">
                                <svg className="w-6 h-6 text-text-tertiary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                                </svg>
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-text-primary font-medium truncate text-sm">
                              {result.title}
                            </p>
                            <p className="text-text-tertiary text-xs truncate">
                              {result.author}
                            </p>
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
                            {alreadySubscribed ? (
                              <span className="flex items-center gap-1">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                                Added
                              </span>
                            ) : isSubscribing ? (
                              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            ) : (
                              'Add'
                            )}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Your podcasts */}
            <div className="mb-4">
              <h3 className="text-sm font-medium text-text-secondary mb-2">
                Your podcasts ({podcastList.length})
              </h3>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {podcastList.length === 0 ? (
                  <p className="text-text-tertiary text-sm py-2">No podcasts yet</p>
                ) : (
                  podcastList.map((podcast) => (
                    <div
                      key={podcast.id}
                      className="flex items-center gap-3 p-3 bg-bg-tertiary rounded-lg group"
                    >
                      <div className="w-10 h-10 rounded-lg bg-bg-hover flex items-center justify-center flex-shrink-0 overflow-hidden">
                        {podcast.imageUrl ? (
                          <img
                            src={podcast.imageUrl}
                            alt=""
                            className="w-10 h-10 object-cover"
                          />
                        ) : (
                          <svg className="w-5 h-5 text-text-tertiary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                          </svg>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-text-primary font-medium truncate text-sm">
                          {podcast.title || 'Loading...'}
                        </p>
                      </div>
                      <button
                        onClick={() => handleRemovePodcast(podcast.id)}
                        className="p-1.5 text-text-tertiary hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Advanced: RSS URL */}
            <div className="mb-6">
              <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center gap-2 text-sm text-text-tertiary hover:text-text-secondary transition-colors"
              >
                <svg
                  className={`w-4 h-4 transition-transform ${showAdvanced ? 'rotate-90' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                Advanced: Add via RSS URL
              </button>
              
              {showAdvanced && (
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
                    className="px-3 py-2 bg-bg-hover hover:bg-border border border-border rounded-lg font-medium text-text-secondary transition-colors disabled:opacity-50"
                  >
                    {rssLoading ? '...' : 'Add'}
                  </button>
                </form>
              )}
              {rssError && (
                <p className="text-sm text-red-400 mt-2">{rssError}</p>
              )}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setStep('topics')}
                className="px-4 py-3 bg-bg-tertiary hover:bg-bg-hover border border-border rounded-lg font-medium text-text-secondary transition-colors"
              >
                Back
              </button>
              <button
                onClick={() => router.push('/playlist')}
                className="flex-1 px-4 py-3 bg-accent hover:bg-accent-hover rounded-lg font-medium text-white transition-colors"
              >
                Finish Setup
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

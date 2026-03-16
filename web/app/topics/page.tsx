'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { userTopics, auth, Topic, User, ApiError } from '@/lib/api';
import Sidebar from '@/components/Sidebar';

export default function TopicsPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [topicInput, setTopicInput] = useState('');
  const [topicLoading, setTopicLoading] = useState(false);
  const [topicError, setTopicError] = useState<string | null>(null);

  useEffect(() => {
    const loadData = async () => {
      try {
        const [userData, topicsRes] = await Promise.all([
          auth.me(),
          userTopics.list(),
        ]);
        setUser(userData);
        setTopics(topicsRes.topics);
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

  const handleRemoveTopic = async (id: number) => {
    try {
      await userTopics.remove(id);
      setTopics((prev) => prev.filter((t) => t.id !== id));
    } catch (err) {
      console.error('Failed to remove topic:', err);
    }
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
      <Sidebar user={user} activeNav="topics" />

      <main className="flex-1 flex flex-col">
        <header className="h-14 px-6 border-b border-border flex items-center justify-between">
          <h1 className="text-lg font-semibold text-text-primary">Topics</h1>
          <span className="px-2 py-1 bg-bg-secondary rounded text-sm text-text-tertiary">
            {topics.length} topic{topics.length !== 1 ? 's' : ''}
          </span>
        </header>

        <div className="flex-1 p-6 max-w-2xl">
          <p className="text-text-secondary mb-6">
            Add topics you're interested in. We'll find discussions about these in your podcasts.
          </p>

          {/* Add topic form */}
          <form onSubmit={handleAddTopic} className="flex gap-2 mb-6">
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

          {/* Topics list */}
          {topics.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-12 h-12 rounded-xl bg-bg-secondary border border-border flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6 text-text-tertiary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                </svg>
              </div>
              <p className="text-text-secondary">No topics yet</p>
              <p className="text-text-tertiary text-sm">Add your first topic above</p>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {topics.map((topic) => (
                <span
                  key={topic.id}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-bg-secondary border border-border rounded-lg text-text-primary group"
                >
                  {topic.name}
                  <button
                    onClick={() => handleRemoveTopic(topic.id)}
                    className="text-text-tertiary hover:text-red-400 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}


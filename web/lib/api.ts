const API_BASE = 'http://localhost:3001';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Fetch helper that automatically attaches auth token
 */
async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = typeof window !== 'undefined' 
    ? localStorage.getItem('castcue_token') 
    : null;

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (token) {
    (headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new ApiError(res.status, data.error || 'Request failed');
  }

  // Handle 204 No Content
  if (res.status === 204) {
    return {} as T;
  }

  return res.json();
}

// Auth
export interface User {
  id: string;
  email: string;
  name: string | null;
}

export interface LoginResponse {
  user: User;
  token: string;
  isNewUser: boolean;
}

export const auth = {
  login: (email: string) =>
    request<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  me: () => request<User>('/auth/me'),
};

// User Topics
export interface Topic {
  id: number;
  name: string;
  createdAt: string;
}

export const userTopics = {
  list: () => request<{ topics: Topic[] }>('/user-topics'),

  add: (name: string) =>
    request<Topic>('/user-topics', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),

  remove: (id: number) =>
    request<void>(`/user-topics/${id}`, {
      method: 'DELETE',
    }),
};

// Podcasts
export interface Podcast {
  id: string;
  rssUrl: string;
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  createdAt?: string;
}

export interface PodcastSearchResult {
  podcastId: number;
  title: string;
  author: string;
  feedUrl: string;
  artworkUrl600: string | null;
}

export interface SubscribeParams {
  feedUrl: string;
  title?: string;
  imageUrl?: string;
}

export const podcasts = {
  list: () => request<{ podcasts: Podcast[] }>('/podcasts'),

  search: (q: string) =>
    request<{ results: PodcastSearchResult[] }>(`/podcasts/search?q=${encodeURIComponent(q)}`),

  subscribe: (params: SubscribeParams | string) => {
    const body = typeof params === 'string' 
      ? { rssUrl: params } 
      : params;
    return request<{ podcast: Podcast }>('/podcasts/subscribe', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  unsubscribe: (id: string) =>
    request<void>(`/podcasts/${id}/unsubscribe`, {
      method: 'DELETE',
    }),
};

// Playlist
export interface Clip {
  clipId: number;
  topic: string;
  startMs: number;
  endMs: number;
  confidence: number;
  createdAt: string;
  episodeId: string;
  episodeTitle: string;
  audioUrl: string;
  podcastTitle: string | null;
  imageUrl: string | null;
  isNew: boolean;
}

export interface GenerateResult {
  createdCount: number;
  updatedCount: number;
  scannedEpisodes: number;
  scannedTopics: number;
  message?: string;
}

export const playlist = {
  list: () => request<{ clips: Clip[] }>('/playlist'),

  generate: () =>
    request<GenerateResult>('/playlist/generate', {
      method: 'POST',
    }),

  markListened: (clipId: number) =>
    request<{ listened: boolean }>(`/playlist/clips/${clipId}/listen`, {
      method: 'POST',
    }),
};


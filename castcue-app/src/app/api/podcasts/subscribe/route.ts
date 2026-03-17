import { NextResponse } from "next/server";
import Parser from "rss-parser";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedUser } from "@/lib/supabase/auth-user";

type FeedCustom = {
  image?: { url?: string };
  itunes?: { image?: string };
  title?: string;
  description?: string;
};

const parser = new Parser<Record<string, never>, FeedCustom>();

export async function POST(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json()) as { rssUrl?: string };
  const rssUrl = body?.rssUrl?.trim();

  if (!rssUrl) {
    return NextResponse.json({ error: "RSS URL is required" }, { status: 400 });
  }

  let feed: Awaited<ReturnType<typeof parser.parseURL>>;
  try {
    feed = await parser.parseURL(rssUrl);
  } catch {
    return NextResponse.json({ error: "Could not parse RSS feed" }, { status: 400 });
  }

  const imageUrl = feed.itunes?.image ?? feed.image?.url ?? null;
  const title = feed.title?.trim() || rssUrl;

  const admin = createAdminClient();

  const { data: podcast, error: podcastError } = await admin
    .from("podcasts")
    .upsert(
      {
        rss_url: rssUrl,
        title,
        description: feed.description ?? null,
        image_url: imageUrl,
        last_polled_at: new Date().toISOString(),
      },
      { onConflict: "rss_url" },
    )
    .select("id, title, description, image_url, rss_url")
    .single();

  if (podcastError || !podcast) {
    return NextResponse.json({ error: podcastError?.message ?? "Failed to save podcast" }, { status: 500 });
  }

  const { error: subError } = await admin.from("subscriptions").upsert(
    { user_id: user.id, podcast_id: podcast.id },
    { onConflict: "user_id,podcast_id", ignoreDuplicates: true },
  );

  if (subError) {
    return NextResponse.json({ error: subError.message }, { status: 500 });
  }

  const recentItems = (feed.items ?? []).slice(0, 3);
  const episodeRows = recentItems
    .map((item) => {
      const audioUrl = item.enclosure?.url ?? null;
      const guid = item.guid || item.link || item.title || null;
      if (!audioUrl || !guid || !item.title) return null;

      return {
        podcast_id: podcast.id,
        guid,
        title: item.title,
        audio_url: audioUrl,
        published_at: item.pubDate ? new Date(item.pubDate).toISOString() : null,
        status: "pending",
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  if (episodeRows.length) {
    const { error: episodeError } = await admin.from("episodes").upsert(episodeRows, {
      onConflict: "podcast_id,guid",
      ignoreDuplicates: true,
    });
    if (episodeError) {
      return NextResponse.json({ error: episodeError.message }, { status: 500 });
    }
  }

  return NextResponse.json({
    podcast,
    insertedEpisodes: episodeRows.length,
  });
}

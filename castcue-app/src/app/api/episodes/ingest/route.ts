import { NextResponse } from "next/server";
import { processEpisode } from "@/lib/services/pipeline";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedUser } from "@/lib/supabase/auth-user";

function formatErrorDetails(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack };
  }
  return { message: String(error) };
}

export async function POST(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { podcastId?: string };
  const podcastId = body.podcastId?.trim();
  console.log("[ingest] request received", { userId: user.id, podcastId: podcastId ?? null });

  const admin = createAdminClient();

  let podcastIds: string[] = [];
  if (podcastId) {
    const { data: subscription, error: subError } = await admin
      .from("subscriptions")
      .select("podcast_id")
      .eq("user_id", user.id)
      .eq("podcast_id", podcastId)
      .maybeSingle();

    if (subError) {
      console.log("[ingest] subscription lookup failed", { error: subError.message, podcastId, userId: user.id });
      return NextResponse.json({ error: subError.message }, { status: 500 });
    }
    if (!subscription) {
      console.log("[ingest] podcast not followed", { podcastId, userId: user.id });
      return NextResponse.json({ error: "Podcast not followed" }, { status: 403 });
    }
    podcastIds = [podcastId];
  } else {
    const { data: subs, error: subsError } = await admin
      .from("subscriptions")
      .select("podcast_id")
      .eq("user_id", user.id);

    if (subsError) {
      console.log("[ingest] subscriptions list failed", { error: subsError.message, userId: user.id });
      return NextResponse.json({ error: subsError.message }, { status: 500 });
    }

    podcastIds = (subs ?? []).map((sub) => sub.podcast_id);
  }

  console.log("[ingest] podcasts to process", { count: podcastIds.length, podcastIds });

  if (podcastIds.length === 0) {
    console.log("[ingest] no podcasts found for user", { userId: user.id });
    return NextResponse.json({
      processed: 0,
      failed: 0,
      pendingFound: 0,
      results: [],
    });
  }

  const { data: statusRows, error: statusRowsError } = await admin
    .from("episodes")
    .select("id, status")
    .in("podcast_id", podcastIds);

  if (statusRowsError) {
    console.log("[ingest] failed to read episode statuses", { error: statusRowsError.message, podcastIds });
    return NextResponse.json({ error: statusRowsError.message }, { status: 500 });
  }

  const statusCounts = (statusRows ?? []).reduce<Record<string, number>>((acc, row) => {
    const status = row.status ?? "unknown";
    acc[status] = (acc[status] ?? 0) + 1;
    return acc;
  }, {});
  console.log("[ingest] episode status distribution before processing", statusCounts);

  let { data: episodes, error: episodesError } = await admin
    .from("episodes")
    .select("id, status")
    .in("podcast_id", podcastIds)
    .eq("status", "pending")
    .order("published_at", { ascending: false });

  if (episodesError) {
    console.log("[ingest] failed to load pending episodes", { error: episodesError.message, podcastIds });
    return NextResponse.json({ error: episodesError.message }, { status: 500 });
  }

  if ((episodes ?? []).length === 0 && (statusCounts.failed ?? 0) > 0) {
    console.log("[ingest] no pending episodes found; resetting failed episodes to pending", {
      failedCount: statusCounts.failed,
      podcastIds,
    });

    const { error: resetError } = await admin
      .from("episodes")
      .update({ status: "pending" })
      .in("podcast_id", podcastIds)
      .eq("status", "failed");

    if (resetError) {
      console.log("[ingest] failed to reset failed episodes", { error: resetError.message, podcastIds });
      return NextResponse.json({ error: resetError.message }, { status: 500 });
    }

    const retryFetch = await admin
      .from("episodes")
      .select("id, status")
      .in("podcast_id", podcastIds)
      .eq("status", "pending")
      .order("published_at", { ascending: false });

    episodes = retryFetch.data;
    episodesError = retryFetch.error;
    if (episodesError) {
      console.log("[ingest] failed to load pending episodes after reset", {
        error: episodesError.message,
        podcastIds,
      });
      return NextResponse.json({ error: episodesError.message }, { status: 500 });
    }
  }

  console.log("[ingest] episodes queued for processing", {
    count: (episodes ?? []).length,
    episodeIds: (episodes ?? []).map((episode) => episode.id),
  });

  const results: Array<{ episodeId: string; ok: boolean; error?: string; segmentCount?: number }> = [];
  for (const episode of episodes ?? []) {
    console.log(`[ingest][${episode.id}] status before processEpisode`, { status: episode.status });
    try {
      const result = await processEpisode(episode.id);
      const { data: afterRow, error: afterError } = await admin
        .from("episodes")
        .select("status")
        .eq("id", episode.id)
        .single();
      if (afterError) {
        console.log(`[ingest][${episode.id}] failed to read status after processEpisode`, {
          error: afterError.message,
        });
      } else {
        console.log(`[ingest][${episode.id}] status after processEpisode`, { status: afterRow.status });
      }
      results.push({ episodeId: episode.id, ok: true, segmentCount: result.segmentCount });
    } catch (error) {
      const details = formatErrorDetails(error);
      console.log(`[ingest][${episode.id}] processEpisode error message: ${details.message}`);
      if (details.stack) {
        console.log(`[ingest][${episode.id}] processEpisode error stack:\n${details.stack}`);
      }
      const { data: afterRow, error: afterError } = await admin
        .from("episodes")
        .select("status")
        .eq("id", episode.id)
        .single();
      if (afterError) {
        console.log(`[ingest][${episode.id}] failed to read status after error`, { error: afterError.message });
      } else {
        console.log(`[ingest][${episode.id}] status after error`, { status: afterRow.status });
      }
      results.push({
        episodeId: episode.id,
        ok: false,
        error: details.message,
      });
    }
  }

  console.log("[ingest] processing complete", {
    pendingFound: (episodes ?? []).length,
    processed: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok).length,
  });

  return NextResponse.json({
    pendingFound: (episodes ?? []).length,
    processed: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok).length,
    results,
  });
}

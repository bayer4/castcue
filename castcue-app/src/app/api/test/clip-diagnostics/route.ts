import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getClipDiagnostics } from "@/lib/services/search";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const episodeId = searchParams.get("episodeId")?.trim();
  const topic = searchParams.get("topic")?.trim();

  if (!episodeId || !topic) {
    return NextResponse.json(
      { error: "Missing required query params: episodeId, topic" },
      { status: 400 }
    );
  }

  // Debug endpoint by design: no auth required.
  const admin = createAdminClient();
  const { data: episode, error } = await admin
    .from("episodes")
    .select("id")
    .eq("id", episodeId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!episode?.id) {
    return NextResponse.json({ error: "Episode not found" }, { status: 404 });
  }

  const diagnostics = await getClipDiagnostics(episodeId, topic);
  return NextResponse.json(diagnostics);
}

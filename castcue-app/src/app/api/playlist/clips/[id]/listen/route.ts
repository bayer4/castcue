import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedUser } from "@/lib/supabase/auth-user";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const clipId = Number(id);
  if (!Number.isFinite(clipId)) {
    return NextResponse.json({ error: "Invalid clip id" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("clip_listens")
    .upsert({ user_id: user.id, clip_id: clipId }, { onConflict: "user_id,clip_id", ignoreDuplicates: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

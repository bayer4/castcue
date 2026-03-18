import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedUser } from "@/lib/supabase/auth-user";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const clipId = Number(id);
  if (!Number.isFinite(clipId)) {
    return NextResponse.json({ error: "Invalid clip ID" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Clean up listen markers first
  await admin
    .from("clip_listens")
    .delete()
    .eq("user_id", user.id)
    .eq("clip_id", clipId);

  const { error } = await admin
    .from("clips")
    .delete()
    .eq("id", clipId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ deleted: clipId });
}

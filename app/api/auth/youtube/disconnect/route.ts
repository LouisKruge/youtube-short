import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOwner } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const ownerId = await requireOwner();
  const settings = new URL("/settings", new URL(request.url).origin);

  if (!ownerId) return NextResponse.redirect(new URL("/login", request.url));

  const db = createAdminClient();
  await db.from("youtube_accounts").delete().eq("owner_id", ownerId);

  settings.searchParams.set("disconnected", "1");
  return NextResponse.redirect(settings, { status: 303 });
}

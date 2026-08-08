import { NextResponse } from "next/server";
import { loadClips } from "@/lib/queries";
import { requireOwner } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const ownerId = await requireOwner();
  if (!ownerId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  return NextResponse.json(await loadClips(ownerId));
}

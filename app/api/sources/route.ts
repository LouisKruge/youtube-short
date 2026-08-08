import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOwner } from "@/lib/supabase/server";
import { loadSources } from "@/lib/queries";
import { nudgeWorker } from "@/lib/worker";

export const dynamic = "force-dynamic";

export async function GET() {
  const ownerId = await requireOwner();
  if (!ownerId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  return NextResponse.json(await loadSources(ownerId));
}

export async function POST(request: Request) {
  const ownerId = await requireOwner();
  if (!ownerId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const sourceUrl = typeof body.sourceUrl === "string" ? body.sourceUrl.trim() : "";

  let parsed: URL;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    return NextResponse.json({ error: "That is not a valid URL." }, { status: 400 });
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return NextResponse.json(
      { error: "Only http and https URLs are supported." },
      { status: 400 },
    );
  }

  const db = createAdminClient();
  const { data, error } = await db
    .from("source_videos")
    .insert({ owner_id: ownerId, source_url: parsed.toString() })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Ask the worker to start now rather than waiting for the next cron tick.
  // A failure here is not fatal — the cron will pick the job up.
  void nudgeWorker();

  return NextResponse.json(data, { status: 201 });
}

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

  // Accepts one URL or a batch. The queue is the same either way — the worker
  // takes one source per pass regardless of how they arrived.
  const raw: string[] = Array.isArray(body.sourceUrls)
    ? body.sourceUrls.map((u: unknown) => String(u ?? ""))
    : typeof body.sourceUrl === "string"
      ? [body.sourceUrl]
      : [];

  const urls: string[] = [];
  const rejected: Array<{ input: string; reason: string }> = [];

  for (const entry of raw) {
    const trimmed = entry.trim();
    if (trimmed.length === 0) continue;

    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      rejected.push({ input: trimmed, reason: "Not a valid URL" });
      continue;
    }

    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      rejected.push({ input: trimmed, reason: "Only http and https are supported" });
      continue;
    }

    const normalized = parsed.toString();
    if (!urls.includes(normalized)) urls.push(normalized);
  }

  if (urls.length === 0) {
    return NextResponse.json(
      {
        error:
          rejected[0]?.reason ?? "Paste at least one video URL, one per line.",
        rejected,
      },
      { status: 400 },
    );
  }

  const db = createAdminClient();
  const { data, error } = await db
    .from("source_videos")
    .insert(urls.map((url) => ({ owner_id: ownerId, source_url: url })))
    .select("*");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Ask the worker to start now rather than waiting for its next poll.
  // A failure here is not fatal — the poll will pick the jobs up.
  void nudgeWorker();

  return NextResponse.json(
    { created: data ?? [], rejected },
    { status: 201 },
  );
}

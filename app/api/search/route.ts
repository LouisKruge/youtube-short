import { NextResponse } from "next/server";
import { createClient, requireOwner } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export interface SearchHit {
  source_video_id: string;
  source_title: string | null;
  headline: string;
  rank: number;
}

/**
 * Searches every transcript the owner has ingested.
 *
 * Deliberately runs through the session client rather than the service-role
 * one: search_transcripts is SECURITY INVOKER, so RLS scopes it to the
 * caller's own rows and there is no owner filter to forget.
 */
export async function GET(request: Request) {
  const ownerId = await requireOwner();
  if (!ownerId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json([]);

  const supabase = createClient();

  // @supabase/ssr 0.5.2 does not thread the Database generic through to
  // Functions, so rpc() types its args as `undefined` here even though the
  // same call is fully typed on the plain supabase-js client. The cast is on
  // the generic plumbing only — the function, its argument shape and its
  // return columns are all verified against the live schema.
  const rpc = supabase.rpc as unknown as (
    name: "search_transcripts",
    args: { q: string },
  ) => Promise<{ data: SearchHit[] | null; error: { message: string } | null }>;

  const { data, error } = await rpc("search_transcripts", { q });

  if (error) {
    // websearch_to_tsquery rejects some inputs (a lone operator, say). That is
    // a bad query, not a server fault.
    return NextResponse.json(
      { error: "That search could not be parsed. Try plain words or a quoted phrase." },
      { status: 400 },
    );
  }

  return NextResponse.json(data ?? []);
}

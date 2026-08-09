import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/supabase/server";
import { workerHealth } from "@/lib/worker";

export const dynamic = "force-dynamic";

/**
 * Worker reachability, polled by the sidebar.
 *
 * This exists as its own endpoint rather than as part of the page render
 * because the health check is a network round trip to another host. Blocking
 * every page load on it would make the whole app as slow as the worker's worst
 * response time, and the answer goes stale in seconds anyway.
 */
export async function GET() {
  const ownerId = await requireOwner();
  if (!ownerId) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const configured = Boolean(process.env.WORKER_URL);
  const online = configured ? await workerHealth() : false;

  return NextResponse.json(
    { configured, online },
    { headers: { "cache-control": "no-store" } },
  );
}

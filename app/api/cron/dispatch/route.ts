import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { nudgeWorker } from "@/lib/worker";
import type { AppSettings } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Queue tick. Runs every 5 minutes.
 *
 * Two jobs: advance anything the operator has left implicitly approved (only
 * while auto-upload is on), then wake the worker so it claims pending video
 * work. It deliberately does no heavy lifting itself — see lib/worker.ts.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = createAdminClient();
  const { data: owners } = await db.from("app_settings").select("*");

  let autoApproved = 0;

  for (const row of (owners ?? []) as unknown as AppSettings[]) {
    if (!row.auto_upload_enabled) continue;

    // Fully-automatic mode: pick the default caption style and the top-ranked
    // hook for anything sitting in review, then send it to render. Every one
    // of these decisions is written to the upload log at publish time.
    const { data: clips } = await db
      .from("clips")
      .select("id, caption_style, caption_paths")
      .eq("owner_id", row.owner_id)
      .eq("status", "ready_for_review")
      .limit(50);

    for (const clip of (clips ?? []) as Array<{
      id: string;
      caption_style: string | null;
      caption_paths: Record<string, string>;
    }>) {
      const style = clip.caption_style ?? row.default_caption_style;

      const { data: hooks } = await db
        .from("hooks")
        .select("id, is_selected")
        .eq("clip_id", clip.id)
        .order("created_at", { ascending: true });

      if (!hooks || hooks.length === 0) continue;

      if (!hooks.some((h) => h.is_selected)) {
        // The model orders hooks strongest first, so the first row wins.
        await db.from("hooks").update({ is_selected: true }).eq("id", hooks[0].id);
      }

      const prerendered = clip.caption_paths?.[style];

      await db
        .from("clips")
        .update({
          caption_style: style,
          status: prerendered ? "queued" : "rendering",
          ...(prerendered ? { caption_burned_path: prerendered } : {}),
          error_message: null,
          attempts: 0,
        })
        .eq("id", clip.id);

      autoApproved += 1;
    }
  }

  const worker = await nudgeWorker();

  return NextResponse.json({
    ok: true,
    autoApproved,
    worker: worker.ok ? "nudged" : `unreachable: ${worker.detail}`,
  });
}

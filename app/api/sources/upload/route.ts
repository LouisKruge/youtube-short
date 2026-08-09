import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOwner } from "@/lib/supabase/server";
import { MEDIA_BUCKET } from "@/lib/queries";
import { nudgeWorker } from "@/lib/worker";

export const dynamic = "force-dynamic";

/** Containers ffmpeg will open without a remux dance. */
const ALLOWED = new Set(["mp4", "mov", "mkv", "m4v", "webm"]);

/** 8 GB. Above this a browser upload is the wrong tool — use a URL. */
const MAX_BYTES = 8 * 1024 * 1024 * 1024;

/**
 * Local-file ingest, step one of two.
 *
 * Creates the source row, then mints a signed upload URL so the browser can PUT
 * the file straight into Storage. The bytes never pass through this function —
 * a serverless handler cannot stream a multi-gigabyte body, and proxying it
 * would be slower than the direct path anyway.
 *
 * The signed URL is issued with the service-role key and scoped to one object
 * path, which is why the private bucket needs no browser-facing insert policy.
 */
export async function POST(request: Request) {
  const ownerId = await requireOwner();
  if (!ownerId) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const filename = String(body.filename ?? "").trim();
  const sizeBytes = Number(body.sizeBytes ?? 0);
  const durationSeconds = Number(body.durationSeconds ?? 0);

  if (filename.length === 0) {
    return NextResponse.json({ error: "A filename is required." }, { status: 400 });
  }

  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED.has(extension)) {
    return NextResponse.json(
      {
        error: `${extension ? `.${extension}` : "That file type"} is not supported. Use MP4, MOV, MKV, M4V or WEBM.`,
      },
      { status: 400 },
    );
  }

  if (sizeBytes > MAX_BYTES) {
    return NextResponse.json(
      { error: "That file is over 8 GB. Ingest it by URL instead." },
      { status: 413 },
    );
  }

  const db = createAdminClient();

  const { data: created, error: insertError } = await db
    .from("source_videos")
    .insert({
      owner_id: ownerId,
      // `upload:` marks the provenance without pretending to be a fetchable
      // address. Nothing in the pipeline dereferences it for uploaded files.
      source_url: `upload:${filename}`,
      title: filename.replace(/\.[^.]+$/, ""),
      status: "uploading",
      duration_seconds:
        Number.isFinite(durationSeconds) && durationSeconds > 0
          ? durationSeconds
          : null,
    })
    .select("id")
    .single();

  if (insertError || !created) {
    return NextResponse.json(
      { error: insertError?.message ?? "Could not create the source." },
      { status: 500 },
    );
  }

  // Stored as .mp4 regardless of the container it arrived in: every consumer
  // downstream hands it to ffmpeg, which reads the actual format from the
  // stream rather than the extension.
  const storagePath = `${ownerId}/sources/${created.id}.mp4`;

  const { data: signed, error: signError } = await db.storage
    .from(MEDIA_BUCKET)
    .createSignedUploadUrl(storagePath);

  if (signError || !signed) {
    // Leave nothing half-created — a row with no object would sit in the queue
    // forever waiting for bytes that are never coming.
    await db.from("source_videos").delete().eq("id", created.id);
    return NextResponse.json(
      { error: signError?.message ?? "Could not open an upload channel." },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      sourceId: created.id,
      path: storagePath,
      token: signed.token,
      signedUrl: signed.signedUrl,
    },
    { status: 201 },
  );
}

/**
 * Step two: the browser reports the transfer finished.
 *
 * The object is verified server-side before the row is advanced, so a failed or
 * abandoned upload cannot hand the worker a path with nothing behind it.
 * Advancing to `downloaded` is what puts it in front of the analyze stage —
 * there is no download to do, the file is already in Storage.
 */
export async function PUT(request: Request) {
  const ownerId = await requireOwner();
  if (!ownerId) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const sourceId = String(body.sourceId ?? "");
  const durationSeconds = Number(body.durationSeconds ?? 0);

  if (!sourceId) {
    return NextResponse.json({ error: "A sourceId is required." }, { status: 400 });
  }

  const db = createAdminClient();

  const { data: source } = await db
    .from("source_videos")
    .select("id, owner_id, status")
    .eq("id", sourceId)
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (!source) {
    return NextResponse.json({ error: "No such source." }, { status: 404 });
  }

  const storagePath = `${ownerId}/sources/${sourceId}.mp4`;

  // `list` on the exact name is the cheapest existence check Storage offers.
  const { data: listed } = await db.storage
    .from(MEDIA_BUCKET)
    .list(`${ownerId}/sources`, { search: `${sourceId}.mp4`, limit: 1 });

  const object = listed?.find((entry) => entry.name === `${sourceId}.mp4`);
  if (!object) {
    return NextResponse.json(
      { error: "The upload did not arrive. Try again." },
      { status: 409 },
    );
  }

  const { error: updateError } = await db
    .from("source_videos")
    .update({
      status: "downloaded",
      storage_path: storagePath,
      ...(Number.isFinite(durationSeconds) && durationSeconds > 0
        ? { duration_seconds: durationSeconds }
        : {}),
      error_message: null,
      attempts: 0,
    })
    .eq("id", sourceId)
    .eq("owner_id", ownerId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  void nudgeWorker();

  return NextResponse.json({ ok: true, sourceId });
}

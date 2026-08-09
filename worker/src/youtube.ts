import { google } from "googleapis";
import type { Readable } from "node:stream";
import { config } from "./config.js";
import { db } from "./db.js";

function oauthClient() {
  if (!config.googleClientId || !config.googleClientSecret) {
    throw new Error(
      "YouTube is not configured on the worker. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
    );
  }

  // The redirect URI only matters for the authorization step, which happens
  // in the app. Refreshing an existing token does not use it.
  return new google.auth.OAuth2(
    config.googleClientId,
    config.googleClientSecret,
    config.googleRedirectUri,
  );
}

/**
 * Whether this owner has a channel to publish to.
 *
 * Checked before a clip is claimed for upload rather than after. Discovering
 * this inside `publish` means a clip has already been taken out of the queue
 * and had an upload row written against it, and the only thing left to do with
 * it is record a failure — for a condition that has nothing to do with the clip
 * and will be identical for every other clip in the queue.
 */
export async function hasConnectedChannel(ownerId: string): Promise<boolean> {
  if (!config.googleClientId || !config.googleClientSecret) return false;

  const { data } = await db
    .from("youtube_accounts")
    .select("refresh_token")
    .eq("owner_id", ownerId)
    .maybeSingle();

  return Boolean((data as { refresh_token?: string } | null)?.refresh_token);
}

/** Builds an authorized client from the refresh token the app stored. */
async function authorizedClient(ownerId: string) {
  const { data } = await db
    .from("youtube_accounts")
    .select("refresh_token, access_token, token_expires_at")
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (!data?.refresh_token) {
    throw new Error("No YouTube channel is connected.");
  }

  const auth = oauthClient();
  auth.setCredentials({
    refresh_token: data.refresh_token as string,
    access_token: (data.access_token as string | null) ?? undefined,
    expiry_date: data.token_expires_at
      ? new Date(data.token_expires_at as string).getTime()
      : undefined,
  });

  // Persist rotated access tokens so we are not refreshing on every upload.
  auth.on("tokens", (tokens) => {
    void db
      .from("youtube_accounts")
      .update({
        access_token: tokens.access_token ?? null,
        token_expires_at: tokens.expiry_date
          ? new Date(tokens.expiry_date).toISOString()
          : null,
      })
      .eq("owner_id", ownerId);
  });

  return auth;
}

export interface UploadRequest {
  ownerId: string;
  title: string;
  description: string;
  tags: string[];
  privacyStatus: "public" | "unlisted" | "private";
  body: Readable;
}

export interface UploadResult {
  videoId: string;
  url: string;
}

/**
 * Uploads one clip. Costs 1,600 quota units — the caller must have reserved
 * them first (see quota.ts).
 */
export async function uploadVideo(req: UploadRequest): Promise<UploadResult> {
  const auth = await authorizedClient(req.ownerId);
  const youtube = google.youtube({ version: "v3", auth });

  const { data } = await youtube.videos.insert({
    part: ["snippet", "status"],
    requestBody: {
      snippet: {
        // YouTube rejects titles over 100 characters outright.
        title: req.title.slice(0, 100),
        description: req.description.slice(0, 5000),
        tags: req.tags.slice(0, 30),
      },
      status: {
        privacyStatus: req.privacyStatus,
        selfDeclaredMadeForKids: false,
      },
    },
    media: { body: req.body },
  });

  if (!data.id) {
    throw new Error("YouTube accepted the upload but returned no video ID.");
  }

  return { videoId: data.id, url: `https://www.youtube.com/watch?v=${data.id}` };
}

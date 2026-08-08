import { google } from "googleapis";
import type { Readable } from "node:stream";
import { createAdminClient } from "@/lib/supabase/admin";

export const YOUTUBE_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
];

export function oauthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      "YouTube is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI.",
    );
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function authUrl(state: string): string {
  return oauthClient().generateAuthUrl({
    access_type: "offline",
    // Force the consent screen so Google reliably returns a refresh token,
    // not just on the very first authorization.
    prompt: "consent",
    scope: YOUTUBE_SCOPES,
    state,
  });
}

export interface ConnectedChannel {
  channelId: string | null;
  channelTitle: string | null;
}

/** Exchanges the OAuth code and persists the refresh token for this owner. */
export async function completeConnection(
  ownerId: string,
  code: string,
): Promise<ConnectedChannel> {
  const auth = oauthClient();
  const { tokens } = await auth.getToken(code);

  if (!tokens.refresh_token) {
    throw new Error(
      "Google did not return a refresh token. Revoke the app's access in your Google account and connect again.",
    );
  }

  auth.setCredentials(tokens);

  const youtube = google.youtube({ version: "v3", auth });
  // channels.list costs 1 unit — negligible against the daily allowance.
  const { data } = await youtube.channels.list({ part: ["snippet"], mine: true });
  const channel = data.items?.[0];

  const db = createAdminClient();
  const { error } = await db.from("youtube_accounts").upsert({
    owner_id: ownerId,
    channel_id: channel?.id ?? null,
    channel_title: channel?.snippet?.title ?? null,
    refresh_token: tokens.refresh_token,
    access_token: tokens.access_token ?? null,
    token_expires_at: tokens.expiry_date
      ? new Date(tokens.expiry_date).toISOString()
      : null,
    scope: tokens.scope ?? YOUTUBE_SCOPES.join(" "),
  });

  if (error) throw new Error(`Could not save channel: ${error.message}`);

  return {
    channelId: channel?.id ?? null,
    channelTitle: channel?.snippet?.title ?? null,
  };
}

/** Builds an authorized client from the stored refresh token. */
export async function authorizedClient(ownerId: string) {
  const db = createAdminClient();
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

  // Persist rotated access tokens so we are not refreshing on every call.
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
 * them first (see lib/quota.ts).
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

  if (!data.id) throw new Error("YouTube accepted the upload but returned no video ID.");

  return { videoId: data.id, url: `https://www.youtube.com/watch?v=${data.id}` };
}

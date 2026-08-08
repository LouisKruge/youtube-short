/**
 * The app owns only the OAuth *authorization* flow, because that requires a
 * browser redirect. The upload itself runs on the worker (worker/src/youtube.ts),
 * which reads the refresh token this module stores.
 */
import { google } from "googleapis";
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

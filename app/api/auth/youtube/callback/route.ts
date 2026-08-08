import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { completeConnection } from "@/lib/youtube";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const settings = new URL("/settings", origin);

  const error = searchParams.get("error");
  if (error) {
    settings.searchParams.set("error", `Google returned: ${error}`);
    return NextResponse.redirect(settings);
  }

  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const cookieStore = cookies();
  const stored = cookieStore.get("yt_oauth_state")?.value;
  cookieStore.delete("yt_oauth_state");

  if (!code || !state || !stored) {
    settings.searchParams.set("error", "The authorization link expired. Try again.");
    return NextResponse.redirect(settings);
  }

  const [expectedState, ownerId] = stored.split(":");
  if (state !== expectedState || !ownerId) {
    settings.searchParams.set("error", "Authorization state did not match. Try again.");
    return NextResponse.redirect(settings);
  }

  try {
    const channel = await completeConnection(ownerId, code);
    settings.searchParams.set("connected", channel.channelTitle ?? "channel");
  } catch (err) {
    settings.searchParams.set(
      "error",
      err instanceof Error ? err.message : "Could not connect the channel.",
    );
  }

  return NextResponse.redirect(settings);
}

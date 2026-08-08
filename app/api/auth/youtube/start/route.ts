import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { requireOwner } from "@/lib/supabase/server";
import { authUrl } from "@/lib/youtube";

export const dynamic = "force-dynamic";

export async function GET() {
  const ownerId = await requireOwner();
  if (!ownerId) return NextResponse.redirect(new URL("/login", process.env.APP_URL));

  // CSRF guard: the callback only accepts a state it minted for this browser.
  const state = randomBytes(24).toString("hex");
  cookies().set("yt_oauth_state", `${state}:${ownerId}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });

  try {
    return NextResponse.redirect(authUrl(state));
  } catch (err) {
    const url = new URL("/settings", process.env.APP_URL);
    url.searchParams.set(
      "error",
      err instanceof Error ? err.message : "YouTube is not configured",
    );
    return NextResponse.redirect(url);
  }
}

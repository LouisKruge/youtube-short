import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/supabase/database.types";

type CookieToSet = { name: string; value: string; options: CookieOptions };

/**
 * Exchanges the sign-in link's code for a session cookie.
 *
 * The auth cookies are written directly onto the redirect response rather than
 * through `cookies()` from next/headers. Both work, but this way the Set-Cookie
 * headers are provably on the response the browser receives — there is no
 * dependency on a cookie mutation propagating into a response object that was
 * constructed separately. A session that fails to stick here is indistinguishable
 * from a session that expired, which is a miserable thing to debug.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=link_expired`);
  }

  const response = NextResponse.redirect(`${origin}${next}`);

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(`${origin}/login?error=link_expired`);
  }

  return response;
}

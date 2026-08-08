import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { middlewareCanRun } from "@/lib/config-check";
import type { Database } from "@/lib/supabase/database.types";

type CookieToSet = { name: string; value: string; options: CookieOptions };

/**
 * Refreshes the Supabase session and gates the app behind sign-in.
 *
 * Middleware runs on every request, so anything that throws here takes the
 * whole site down with an opaque MIDDLEWARE_INVOCATION_FAILED. It is written
 * to degrade instead: misconfiguration sends the visitor to /setup, and an
 * unexpected failure lets the request through to be handled by the page.
 */
const PUBLIC_PATHS = [
  "/login",
  "/setup",
  "/auth/callback",
  "/api/auth/youtube/callback",
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Without Supabase credentials there is no session to check and no page
  // that can render. Explain that rather than crashing on every route.
  if (!middlewareCanRun()) {
    if (pathname.startsWith("/setup")) return NextResponse.next();

    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Supabase environment variables are not configured." },
        { status: 503 },
      );
    }

    const url = request.nextUrl.clone();
    url.pathname = "/setup";
    url.search = "";
    return NextResponse.redirect(url);
  }

  try {
    let response = NextResponse.next({ request });

    const supabase = createServerClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet: CookieToSet[]) {
            cookiesToSet.forEach(({ name, value }) =>
              request.cookies.set(name, value),
            );
            response = NextResponse.next({ request });
            cookiesToSet.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, options),
            );
          },
        },
      },
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));

    if (!user && !isPublic) {
      // API callers get a status they can act on. Redirecting them to /login
      // would hand a fetch() an HTML page with a 200 and look like success.
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "Not signed in" }, { status: 401 });
      }

      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }

    if (user && pathname === "/login") {
      const url = request.nextUrl.clone();
      url.pathname = "/";
      url.search = "";
      return NextResponse.redirect(url);
    }

    return response;
  } catch (err) {
    // A bad Supabase URL, an unreachable auth endpoint, a malformed cookie —
    // none of these should blank the whole site. Let the request through and
    // let the page render its own error.
    console.error("middleware: session check failed", err);
    return NextResponse.next({ request });
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|webp)$).*)"],
};

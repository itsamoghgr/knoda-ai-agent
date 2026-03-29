import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  // Skip auth entirely in local dev (no Supabase keys configured)
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return supabaseResponse;
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  // Refresh the session — required for Server Components to have a valid session
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  // Landing page at / is public; redirect authenticated users into the app
  if (pathname === "/") {
    if (user) return NextResponse.redirect(new URL("/overview", request.url));
    return supabaseResponse;
  }

  // Auth pages are always public
  if (pathname.startsWith("/auth/")) {
    // Redirect authenticated users away from auth pages
    if (user && !pathname.startsWith("/auth/callback")) {
      return NextResponse.redirect(new URL("/overview", request.url));
    }
    return supabaseResponse;
  }

  // All other pages require authentication
  if (!user) {
    // Bot mode: skip auth redirect — the Playwright browser authenticates via
    // X-Bot-Session header on API calls instead of a Supabase session.
    if (request.nextUrl.searchParams.get("bot") === "1") {
      return supabaseResponse;
    }
    const loginUrl = new URL("/auth/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    // Run on all paths except static assets and Next.js internals
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

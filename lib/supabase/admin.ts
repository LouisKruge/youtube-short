import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

let cached: ReturnType<typeof createClient<Database>> | null = null;

/**
 * Service-role client. Bypasses RLS entirely — every query made through it
 * must filter by owner_id explicitly. Never import this into a Client
 * Component; it would leak the service key to the browser.
 */
export function createAdminClient() {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    );
  }

  cached = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

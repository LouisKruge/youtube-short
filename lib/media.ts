/**
 * Storage constants, in their own module so client components can import them.
 *
 * `lib/queries` pulls in the service-role Supabase client; importing the bucket
 * name from there would drag a server-only secret path into the browser bundle.
 */
export const MEDIA_BUCKET = "nexus-media";

import { redirect } from "next/navigation";

/**
 * The review grid became the Queue: same clips, arranged for deciding rather
 * than browsing. Kept as a redirect because this path was linked from the old
 * navigation and may sit in a bookmark.
 */
export default function ReviewRedirect() {
  redirect("/queue");
}

import { redirect } from "next/navigation";

/** The upload log is now a section of Analytics. */
export default function LogRedirect() {
  redirect("/analytics");
}

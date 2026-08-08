import { LibraryBrowser } from "@/components/LibraryBrowser";
import { Shell } from "@/components/Shell";
import { pageContext } from "@/lib/page-context";
import { loadLibrary } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function LibraryPage() {
  const { ownerId, settings, quota } = await pageContext();
  const clips = await loadLibrary(ownerId);

  return (
    <Shell
      active="/library"
      quota={quota}
      autoUpload={settings.auto_upload_enabled}
      title="Library"
      subtitle="Every clip ever cut, and full-text search across everything anyone said in every source you have ingested."
    >
      <LibraryBrowser initial={clips} />
    </Shell>
  );
}

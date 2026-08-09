import { AppShell, PageHeader } from "@/components/shell/AppShell";
import { LibraryScreen } from "@/components/screens/LibraryScreen";
import { pageContext } from "@/lib/page-context";
import { loadLibrary } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function LibraryPage() {
  const { ownerId, email, settings, quota, processing } = await pageContext();
  const clips = await loadLibrary(ownerId);

  return (
    <AppShell
      crumbs={[{ label: "Library" }]}
      quota={quota}
      autoUpload={settings.auto_upload_enabled}
      processing={processing}
      email={email}
      width="wide"
    >
      <PageHeader
        title="Library"
        description="Every clip ever cut, and full-text search across everything said in every source."
      />

      <LibraryScreen clips={clips} />
    </AppShell>
  );
}

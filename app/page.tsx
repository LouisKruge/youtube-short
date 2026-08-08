import { IngestPanel } from "@/components/IngestPanel";
import { Shell } from "@/components/Shell";
import { pageContext } from "@/lib/page-context";
import { loadSources } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function IngestPage() {
  const { ownerId, settings, quota } = await pageContext();
  const sources = await loadSources(ownerId);

  return (
    <Shell
      active="/"
      quota={quota}
      autoUpload={settings.auto_upload_enabled}
      title="Ingest"
      subtitle="Paste a video URL. Nexus downloads it, reads the audio for high-energy moments, and cuts a vertical clip around each one."
    >
      <IngestPanel initial={sources} />
    </Shell>
  );
}

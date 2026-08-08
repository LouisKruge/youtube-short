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
      subtitle="Drop in an episode, stream or VOD. Nexus reads the audio, the scene structure and the transcript, ranks every candidate moment against the others, and cuts the best ones to vertical."
    >
      <IngestPanel initial={sources} shortsPerSource={settings.shorts_per_source} />
    </Shell>
  );
}

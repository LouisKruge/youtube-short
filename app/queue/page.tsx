import { AutoRefresh } from "@/components/AutoRefresh";
import { AppShell } from "@/components/shell/AppShell";
import { QueueScreen } from "@/components/screens/QueueScreen";
import { pageContext } from "@/lib/page-context";
import { loadClips } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function QueuePage() {
  const { ownerId, email, settings, quota, processing } = await pageContext();
  const clips = await loadClips(ownerId);

  return (
    <AppShell
      crumbs={[{ label: "Queue" }]}
      quota={quota}
      autoUpload={settings.auto_upload_enabled}
      processing={processing}
      email={email}
      bleed
    >
      <AutoRefresh intervalMs={processing > 0 ? 6000 : 40000} />
      <QueueScreen
        clips={clips}
        quota={quota}
        autoUpload={settings.auto_upload_enabled}
        defaultCaptionStyle={settings.default_caption_style}
      />
    </AppShell>
  );
}

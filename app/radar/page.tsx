import { AutoRefresh } from "@/components/AutoRefresh";
import { AppShell, PageHeader } from "@/components/shell/AppShell";
import { RadarScreen } from "@/components/screens/RadarScreen";
import { pageContext } from "@/lib/page-context";
import { loadSources } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function RadarPage() {
  const { ownerId, email, settings, quota, processing } = await pageContext();
  const sources = await loadSources(ownerId);

  return (
    <AppShell
      crumbs={[{ label: "Radar" }]}
      quota={quota}
      autoUpload={settings.auto_upload_enabled}
      processing={processing}
      email={email}
    >
      {/* This screen exists to be watched, so it refreshes faster than the
          others while work is in flight. */}
      <AutoRefresh intervalMs={processing > 0 ? 4000 : 30000} />

      <PageHeader
        title="Radar"
        description="Candidate moments as they are found, across every source."
      />

      <RadarScreen sources={sources} />
    </AppShell>
  );
}

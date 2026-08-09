import { AutoRefresh } from "@/components/AutoRefresh";
import { AppShell, PageHeader } from "@/components/shell/AppShell";
import { Overview } from "@/components/screens/Overview";
import { pageContext } from "@/lib/page-context";
import { loadOverview } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const { ownerId, email, settings, quota, processing } = await pageContext();
  const data = await loadOverview(ownerId);

  return (
    <AppShell
      crumbs={[{ label: "Overview" }]}
      quota={quota}
      autoUpload={settings.auto_upload_enabled}
      processing={processing}
      email={email}
    >
      {/* Fast while the worker holds something, slow when the board is still. */}
      <AutoRefresh intervalMs={processing > 0 ? 5000 : 30000} />

      <PageHeader
        title="Nexus Clips"
        description="Content intelligence workstation."
      />

      <Overview data={data} shortsPerSource={settings.shorts_per_source} />
    </AppShell>
  );
}

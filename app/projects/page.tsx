import { AutoRefresh } from "@/components/AutoRefresh";
import { AppShell, PageHeader } from "@/components/shell/AppShell";
import { ProjectsList } from "@/components/screens/ProjectsList";
import { pageContext } from "@/lib/page-context";
import { loadSources } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: { add?: string };
}) {
  const { ownerId, email, settings, quota, processing } = await pageContext();
  const sources = await loadSources(ownerId);

  return (
    <AppShell
      crumbs={[{ label: "Projects" }]}
      quota={quota}
      autoUpload={settings.auto_upload_enabled}
      processing={processing}
      email={email}
      width="wide"
    >
      <AutoRefresh intervalMs={processing > 0 ? 6000 : 45000} />

      <PageHeader
        title="Projects"
        description="Every source ingested, with what came out of it."
      />

      <ProjectsList
        sources={sources}
        shortsPerSource={settings.shorts_per_source}
        openAdd={searchParams.add === "1"}
      />
    </AppShell>
  );
}

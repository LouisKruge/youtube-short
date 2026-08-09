import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/AutoRefresh";
import { AppShell } from "@/components/shell/AppShell";
import { ProjectWorkspace } from "@/components/screens/ProjectWorkspace";
import { pageContext } from "@/lib/page-context";
import { loadProject } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { clip?: string };
}) {
  const { ownerId, email, settings, quota, processing } = await pageContext();
  const project = await loadProject(ownerId, params.id);

  if (!project) notFound();

  const working =
    ["pending_download", "downloading", "downloaded", "analyzing"].includes(
      project.source.status,
    ) ||
    project.clips.some((clip) =>
      ["cropping", "transcribing", "rendering", "uploading"].includes(clip.status),
    );

  return (
    <AppShell
      crumbs={[
        { label: "Projects", href: "/projects" },
        { label: project.source.title ?? "Untitled source" },
      ]}
      quota={quota}
      autoUpload={settings.auto_upload_enabled}
      processing={processing}
      email={email}
      bleed
    >
      <AutoRefresh intervalMs={working ? 6000 : 45000} />
      <ProjectWorkspace
        project={project}
        defaultCaptionStyle={settings.default_caption_style}
        initialClipId={searchParams.clip}
      />
    </AppShell>
  );
}

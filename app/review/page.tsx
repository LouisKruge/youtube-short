import { ClipReview } from "@/components/ClipReview";
import { Shell } from "@/components/Shell";
import { pageContext } from "@/lib/page-context";
import { loadClips } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const { ownerId, settings, quota } = await pageContext();
  const clips = await loadClips(ownerId);

  const waiting = clips.filter((c) => c.status === "ready_for_review").length;

  return (
    <Shell
      active="/review"
      quota={quota}
      autoUpload={settings.auto_upload_enabled}
      title="Review"
      subtitle={
        waiting > 0
          ? `${waiting} clip${waiting === 1 ? "" : "s"} need a caption style and a hook before ${waiting === 1 ? "it" : "they"} can be queued.`
          : "Every clip is either queued, publishing, or already out."
      }
    >
      <ClipReview
        initial={clips}
        defaultCaptionStyle={settings.default_caption_style}
        uploadsRemaining={quota.uploadsRemaining}
        autoUpload={settings.auto_upload_enabled}
      />
    </Shell>
  );
}

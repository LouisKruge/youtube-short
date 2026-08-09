import { ButtonLink } from "@/components/ui/Button";
import { Panel, PanelHeader, PanelSection } from "@/components/ui/Panel";
import { Wordmark } from "@/components/shell/Wordmark";

export default function NotFound() {
  return (
    <div className="mx-auto min-h-screen w-full max-w-[560px] px-6 py-16">
      <Wordmark className="mb-10" />

      <Panel>
        <PanelHeader title="Not found" />
        <PanelSection>
          <p className="max-w-prose text-base leading-relaxed text-fg-2">
            There is nothing at this address. If you followed a link to a project,
            the source may have been removed.
          </p>
          <div className="mt-5 flex items-center gap-2">
            <ButtonLink href="/" variant="primary">
              Overview
            </ButtonLink>
            <ButtonLink href="/projects" variant="secondary">
              Projects
            </ButtonLink>
          </div>
        </PanelSection>
      </Panel>
    </div>
  );
}

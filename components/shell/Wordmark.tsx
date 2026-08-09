import { cn } from "@/components/ui/cn";

/**
 * The mark: a 9:16 frame with a cut line through it — a vertical crop and the
 * point where it is sliced. Drawn from strokes so it stays crisp at 14px, and
 * shared by the sidebar and the pre-auth screens so they are recognisably the
 * same product.
 */
export function Mark({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      aria-hidden="true"
      className="shrink-0"
    >
      <rect
        x="4.25"
        y="1"
        width="5.5"
        height="12"
        stroke="var(--fg-3)"
        strokeWidth="1"
        fill="none"
      />
      <path d="M1 8.5 L13 5.5" stroke="var(--fg)" strokeWidth="1" />
    </svg>
  );
}

export function Wordmark({
  size = 14,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <Mark size={size} />
      <span className="leading-[1.05]">
        <span className="block text-[11px] font-medium tracking-[0.16em] text-fg">
          NEXUS
        </span>
        <span className="block text-[11px] tracking-[0.16em] text-fg-3">
          CLIPS
        </span>
      </span>
    </span>
  );
}

/**
 * The frame the pre-auth screens sit in.
 *
 * Same ground, same hairlines, no sidebar — and the panel is placed above centre
 * so it lands where the eye already is on a tall monitor rather than halfway
 * down the glass.
 */
export function AuthFrame({
  children,
  footer,
}: {
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center px-4 pt-[16vh]">
      <div className="w-full max-w-[380px]">
        <Wordmark className="mb-6" />
        {children}
        {footer && <div className="mt-6">{footer}</div>}
      </div>
    </div>
  );
}

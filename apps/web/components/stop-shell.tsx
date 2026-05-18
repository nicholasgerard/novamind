import { requireStop } from "@/lib/stops";
import { cn } from "@/lib/utils";
import { StageHeader } from "@/components/stage-header";

interface Props {
  slug: string;
  wide?: boolean;
  compact?: boolean;
  children: React.ReactNode;
}

const articleSpacing = "space-y-10 sm:space-y-12 lg:space-y-14";
const compactArticleSpacing = "space-y-8 sm:space-y-10 lg:space-y-12";

export function StopShell({ slug, wide, compact, children }: Props) {
  const stop = requireStop(slug);

  return (
    <article
      className={cn(
        "mx-0 w-full min-w-0 soft-enter sm:mx-auto",
        compact ? compactArticleSpacing : articleSpacing,
        wide ? "max-w-full sm:max-w-7xl" : "max-w-full sm:max-w-5xl",
      )}
    >
      <StageHeader title={stop.title} description={stop.description} />
      <div className="min-w-0 space-y-6">{children}</div>
    </article>
  );
}

import { cn } from "@/lib/utils";

export const stageTitleClass =
  "text-balance break-words text-4xl font-semibold leading-[1.05] tracking-normal text-foreground sm:text-5xl lg:text-6xl";

export const stageSubtitleClass =
  "mx-auto max-w-5xl text-balance break-words text-base leading-relaxed text-muted-foreground sm:text-lg lg:text-xl";

export function StageHeader({
  title,
  description,
  className,
}: {
  title: React.ReactNode;
  description: React.ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "mx-auto w-full max-w-5xl space-y-3 text-center sm:space-y-4",
        className,
      )}
    >
      <h1 className={stageTitleClass}>{title}</h1>
      <p className={stageSubtitleClass}>{description}</p>
    </header>
  );
}

import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function TileHoverOverlay({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 rounded-lg bg-primary/[0.06] opacity-0 transition duration-200 group-hover:opacity-100 group-focus-visible:opacity-100",
        className,
      )}
    />
  );
}

export function TileHoverArrow({
  className,
  visibility = "hover",
}: {
  className?: string;
  visibility?: "always" | "hover";
}) {
  return (
    <ArrowUpRight
      aria-hidden
      className={cn(
        "shrink-0 transition duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-focus-visible:translate-x-0.5 group-focus-visible:-translate-y-0.5",
        visibility === "hover" &&
          "text-muted-foreground opacity-0 group-hover:opacity-100 group-hover:text-primary group-focus-visible:opacity-100 group-focus-visible:text-primary",
        visibility === "always" && "opacity-100",
        className,
      )}
    />
  );
}

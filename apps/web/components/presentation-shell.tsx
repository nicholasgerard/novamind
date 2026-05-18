"use client";

import {
  ChevronLeft,
  ChevronRight,
  Menu,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AccessGateProvider } from "@/components/access-gate";
import { isEditableTarget } from "@/lib/dom-targets";
import { adjacentStops, findStop, stops } from "@/lib/stops";
import { cn } from "@/lib/utils";

const MENU_EXIT_ANIMATION_MS = 180;
const STEPPER_SCROLL_THRESHOLD_PX = 8;

function stopHref(slug: string) {
  return `/${slug}`;
}

function chapterNumber(number: number) {
  return String(number).padStart(2, "0");
}

export function PresentationShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const slug = pathname.replace(/^\/+/, "").split("/")[0] ?? "";
  const firstStop = stops[0];
  const current = firstStop ? (findStop(slug) ?? firstStop) : undefined;
  const { prev, next } = current
    ? adjacentStops(current.slug)
    : { next: undefined, prev: undefined };
  const prevHref = prev ? stopHref(prev.slug) : undefined;
  const nextHref = next ? stopHref(next.slug) : undefined;
  const [open, setOpen] = useState(false);
  const [renderMenu, setRenderMenu] = useState(false);
  const [stepperHidden, setStepperHidden] = useState(false);

  const currentIndex = useMemo(
    () => (current ? stops.findIndex((s) => s.slug === current.slug) : -1),
    [current],
  );

  useEffect(() => {
    if (open) {
      setRenderMenu(true);
      return;
    }

    const timer = window.setTimeout(
      () => setRenderMenu(false),
      MENU_EXIT_ANIMATION_MS,
    );
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    setOpen(false);
    setStepperHidden(false);
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [pathname]);

  useEffect(() => {
    if (nextHref) router.prefetch(nextHref);
    if (prevHref) router.prefetch(prevHref);
  }, [nextHref, prevHref, router]);

  useEffect(() => {
    let lastScrollY = window.scrollY;
    let frame = 0;

    function pageCanScroll() {
      return (
        document.documentElement.scrollHeight - window.innerHeight >
        STEPPER_SCROLL_THRESHOLD_PX
      );
    }

    function setHiddenForDelta(deltaY: number) {
      if (!pageCanScroll()) {
        setStepperHidden(false);
        return;
      }
      if (Math.abs(deltaY) < STEPPER_SCROLL_THRESHOLD_PX) return;
      setStepperHidden(deltaY > 0);
    }

    function handleScrollFrame() {
      frame = 0;
      const nextScrollY = window.scrollY;
      setHiddenForDelta(nextScrollY - lastScrollY);
      lastScrollY = nextScrollY;
      if (nextScrollY <= STEPPER_SCROLL_THRESHOLD_PX) setStepperHidden(false);
    }

    function handleScroll() {
      if (frame) return;
      frame = window.requestAnimationFrame(handleScrollFrame);
    }

    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", handleScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && open) {
        event.preventDefault();
        setOpen(false);
        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
        return;
      }
      if (isEditableTarget(event.target)) return;

      if (event.key === "ArrowLeft" && prev) {
        event.preventDefault();
        router.push(stopHref(prev.slug));
      }
      if (event.key === "ArrowRight" && next) {
        event.preventDefault();
        router.push(stopHref(next.slug));
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [next, open, prev, router]);

  if (!current) return null;

  return (
    <AccessGateProvider>
      <div className="relative min-h-dvh overflow-x-clip">
        <div className="letterbox-top" />
        <div className="letterbox-bottom" />

        <button
          type="button"
          aria-label={open ? "Close chapter menu" : "Open chapter menu"}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="group fixed right-6 top-6 z-50 grid size-10 place-items-center rounded-full border border-border bg-card/70 text-foreground/80 backdrop-blur-xl transition hover:text-foreground"
        >
          <span className="absolute inset-0 rounded-full border border-primary/0 transition duration-200 group-hover:-inset-1 group-hover:border-primary/60" />
          <Menu
            className={cn(
              "absolute size-4 transition duration-200",
              open
                ? "rotate-90 scale-75 opacity-0"
                : "rotate-0 scale-100 opacity-100",
            )}
          />
          <X
            className={cn(
              "absolute size-4 transition duration-200",
              open
                ? "rotate-0 scale-100 opacity-100"
                : "-rotate-90 scale-75 opacity-0",
            )}
          />
        </button>

        {renderMenu && (
          <>
            <button
              type="button"
              aria-label="Close chapter menu"
              tabIndex={-1}
              className={cn(
                "fixed inset-0 z-40 cursor-default bg-transparent",
                !open && "pointer-events-none",
              )}
              onClick={() => setOpen(false)}
            />
            <nav
              aria-label="Chapters"
              className={cn(
                "fixed right-6 top-20 z-50 w-[min(24rem,calc(100vw-3rem))] rounded-xl border border-border bg-card/95 p-3 text-sm backdrop-blur-2xl",
                open ? "chapter-menu-enter" : "chapter-menu-exit",
              )}
            >
              <div className="mb-2 flex items-center justify-between px-2">
                <p className="eyebrow">Chapters</p>
                <p className="mono-data text-xs text-muted-foreground">
                  {chapterNumber(current.number)} /{" "}
                  {chapterNumber(stops.length)}
                </p>
              </div>
              <div className="max-h-[68dvh] space-y-1 overflow-auto pr-1">
                {stops.map((stop, index) => {
                  const active = stop.slug === current.slug;
                  return (
                    <Link
                      key={stop.slug}
                      href={stopHref(stop.slug)}
                      prefetch={false}
                      onClick={() => setOpen(false)}
                      className={cn(
                        "grid grid-cols-[2.25rem_1fr] gap-3 rounded-lg px-2 py-2 transition hover:bg-white/[0.035]",
                        active && "bg-primary/[0.055]",
                      )}
                    >
                      <span
                        className={cn(
                          "mono-data relative pt-0.5 text-xs text-[var(--fg-dim)]",
                          active &&
                            "text-primary before:absolute before:-left-2 before:top-0 before:h-full before:w-0.5 before:rounded-full before:bg-primary",
                        )}
                      >
                        {chapterNumber(index + 1)}
                      </span>
                      <span className="min-w-0">
                        <span className="block font-medium text-foreground">
                          {stop.title}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {stop.description}
                        </span>
                      </span>
                    </Link>
                  );
                })}
              </div>
            </nav>
          </>
        )}

        <CornerNav
          direction="prev"
          href={prevHref}
          label={prev ? `${chapterNumber(prev.number)} ${prev.title}` : ""}
          icon={ChevronLeft}
        />
        <CornerNav
          direction="next"
          href={nextHref}
          label={next ? `${chapterNumber(next.number)} ${next.title}` : ""}
          icon={ChevronRight}
        />

        <div
          className={cn(
            "fixed bottom-8 left-1/2 z-[150] hidden items-center gap-2 transition-[opacity,transform] duration-300 ease-out will-change-transform motion-reduce:transition-none md:flex",
            stepperHidden && "pointer-events-none",
          )}
          style={{
            opacity: stepperHidden ? 0 : 1,
            transform: stepperHidden
              ? "translateX(-50%) translateY(calc(100% + 3rem)) scale(0.9)"
              : "translateX(-50%) translateY(0) scale(1)",
          }}
        >
          {stops.map((stop, index) => (
            <Link
              key={stop.slug}
              href={stopHref(stop.slug)}
              prefetch={false}
              aria-current={index === currentIndex ? "step" : undefined}
              aria-label={`${chapterNumber(stop.number)} ${stop.title}`}
              className={cn(
                "h-1 rounded-full transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-4 focus-visible:ring-offset-background",
                index === currentIndex
                  ? "w-8 bg-foreground"
                  : index < currentIndex
                    ? "w-3 bg-foreground/35 hover:w-5 hover:bg-foreground/60 focus-visible:w-5 focus-visible:bg-foreground/60"
                    : "w-3 bg-foreground/15 hover:w-5 hover:bg-foreground/45 focus-visible:w-5 focus-visible:bg-foreground/45",
              )}
            />
          ))}
        </div>

        <main className="relative min-h-dvh px-6 py-28 md:px-10 lg:px-12">
          <div className="mx-auto flex min-h-[calc(100dvh-14rem)] w-full max-w-7xl flex-col justify-center">
            {children}
          </div>
        </main>
      </div>
    </AccessGateProvider>
  );
}

function CornerNav({
  direction,
  href,
  label,
  icon: Icon,
}: {
  direction: "prev" | "next";
  href: string | undefined;
  label: string;
  icon: LucideIcon;
}) {
  const content = (
    <>
      <span
        className={cn(
          "pointer-events-none absolute top-1/2 hidden -translate-y-1/2 whitespace-nowrap rounded-full border border-border bg-card/95 px-3 py-2 text-[0.68rem] font-semibold leading-none tracking-normal text-muted-foreground opacity-0 shadow-2xl shadow-black/20 backdrop-blur-xl transition duration-200 group-hover:translate-x-0 group-hover:opacity-100 md:block",
          direction === "prev"
            ? "left-14 -translate-x-2"
            : "right-14 translate-x-2",
        )}
      >
        {label}
      </span>
      <Icon className="size-5" />
    </>
  );

  const className = cn(
    "group fixed bottom-8 z-50 grid size-[52px] place-items-center rounded-full border border-border bg-card/70 text-foreground/80 backdrop-blur-xl transition hover:text-foreground",
    direction === "prev" ? "left-8" : "right-8",
    !href && "pointer-events-none opacity-35",
  );

  if (!href) {
    return (
      <span aria-hidden className={className}>
        {content}
      </span>
    );
  }

  return (
    <Link href={href} prefetch aria-label={label} className={className}>
      {content}
    </Link>
  );
}

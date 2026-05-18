"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

const EXIT_ANIMATION_MS = 220;

interface ModalTitleProps {
  description?: string;
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
}

interface ModalSectionProps {
  children: React.ReactNode;
  eyebrow?: string;
  title?: string;
}

export function Modal({
  open,
  onClose,
  title,
  children,
  className,
}: ModalProps) {
  const titleId = useId();
  const [mounted, setMounted] = useState(open);
  const [isExiting, setIsExiting] = useState(false);
  const [portalNode, setPortalNode] = useState<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Keep fixed backdrops out of transformed stage containers so every modal
  // blurs the viewport consistently, regardless of where it is opened.
  useEffect(() => {
    setPortalNode(document.body);
  }, []);

  // Track open ↔ mounted with deferred unmount so the exit animation can play.
  useEffect(() => {
    if (open) {
      setMounted(true);
      setIsExiting(false);
      return;
    }
    if (!mounted) return;
    setIsExiting(true);
    const timer = window.setTimeout(() => {
      setMounted(false);
      setIsExiting(false);
    }, EXIT_ANIMATION_MS);
    return () => window.clearTimeout(timer);
  }, [open, mounted]);

  // Lock body scroll and keep keyboard focus inside the active dialog.
  useEffect(() => {
    if (!mounted) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      trapFocus(event, panelRef.current);
    }
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [mounted, onClose]);

  useEffect(() => {
    if (!mounted) return;
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const frame = window.requestAnimationFrame(() => {
      panelRef.current?.focus({ preventScroll: true });
    });
    return () => {
      window.cancelAnimationFrame(frame);
      previousFocusRef.current?.focus({ preventScroll: true });
    };
  }, [mounted]);

  if (!mounted || !portalNode) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title ? undefined : "Dialog"}
      aria-labelledby={title ? titleId : undefined}
      className="fixed inset-0 z-[200] flex items-center justify-center px-4 py-12"
      onClick={onClose}
    >
      <div
        className={cn(
          "absolute inset-0 bg-background/80 backdrop-blur-lg",
          isExiting ? "modal-backdrop-exit" : "modal-backdrop-enter",
        )}
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        className={cn(
          "panel relative max-h-full w-full max-w-2xl overflow-hidden rounded-2xl outline-none",
          isExiting ? "modal-card-exit" : "modal-card-enter",
          className,
        )}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border/40 px-6 py-4">
          <div id={title ? titleId : undefined} className="min-w-0 flex-1">
            {typeof title === "string" ? (
              <h2 className="text-base font-semibold text-foreground">
                {title}
              </h2>
            ) : (
              title
            )}
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="-mr-1 rounded-full p-1.5 text-muted-foreground transition hover:bg-foreground/[0.06] hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>,
    portalNode,
  );
}

export function ModalTitle({
  description,
  icon: Icon,
  title,
}: ModalTitleProps) {
  return (
    <div className="flex items-center gap-3">
      {Icon && (
        <span className="grid size-9 shrink-0 place-items-center rounded-full border border-primary/45 bg-primary/10 text-primary">
          <Icon className="size-4" />
        </span>
      )}
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        {description && (
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
    </div>
  );
}

export function ModalSection({ children, eyebrow, title }: ModalSectionProps) {
  return (
    <section className="rounded-lg border border-border bg-background/35 p-4">
      {(eyebrow || title) && (
        <div className="mb-2">
          {eyebrow && (
            <p className="mono-data text-[10px] uppercase tracking-[0.18em] text-[var(--fg-dim)]">
              {eyebrow}
            </p>
          )}
          {title && (
            <h3 className="mt-1 text-sm font-medium text-foreground">
              {title}
            </h3>
          )}
        </div>
      )}
      {children}
    </section>
  );
}

function trapFocus(event: KeyboardEvent, root: HTMLElement | null): void {
  if (!root) return;
  const focusable = getFocusableElements(root);
  if (focusable.length === 0) {
    event.preventDefault();
    root.focus({ preventScroll: true });
    return;
  }

  const first = focusable[0]!;
  const last = focusable[focusable.length - 1]!;
  const active = document.activeElement;

  if (active === root || !root.contains(active)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus({ preventScroll: true });
    return;
  }
  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus({ preventScroll: true });
    return;
  }
  if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus({ preventScroll: true });
  }
}

function getFocusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      [
        "a[href]",
        "button:not([disabled])",
        "textarea:not([disabled])",
        "input:not([disabled])",
        "select:not([disabled])",
        "[tabindex]:not([tabindex='-1'])",
      ].join(","),
    ),
  ).filter(
    (element) =>
      !element.hasAttribute("disabled") &&
      element.getAttribute("aria-hidden") !== "true",
  );
}

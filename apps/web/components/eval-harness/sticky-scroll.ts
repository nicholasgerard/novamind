export function scrollPromptPanelToStickyStart(panel: HTMLDivElement | null) {
  if (!panel || !window.matchMedia("(min-width: 1280px)").matches) return;

  // Align with the point where the prompt editor's sticky layout takes over,
  // so the editor remains readable while the right column moves under the fade.
  const stickyTop = Number.parseFloat(window.getComputedStyle(panel).top) || 24;
  const targetTop =
    panel.getBoundingClientRect().top + window.scrollY - stickyTop;
  const behavior: ScrollBehavior = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches
    ? "auto"
    : "smooth";

  window.scrollTo({
    behavior,
    top: Math.max(0, targetTop),
  });
}

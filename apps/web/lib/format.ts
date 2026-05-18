export function formatUsd(value: number, opts?: { precise?: boolean }): string {
  if (!Number.isFinite(value)) return "$0.00";
  if (opts?.precise) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

export function formatLatency(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(ms >= 10_000 ? 1 : 2)}s`;
}

export function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value < 1000) return `${value}`;
  return `${(value / 1000).toFixed(1)}k`;
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

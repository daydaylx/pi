/**
 * Development-only render diagnostics for the Aurora activity widget.
 *
 * Activated only when PI_AURORA_DIAG=1 (or "true") is set at session start;
 * otherwise every method is a no-op so normal sessions pay nothing. The
 * counters answer the questions from pi-tui-optimization-package/03:
 * how many renders ran, roughly how long they took, which tick interval was
 * active, and how many dashboard rows were emitted.
 *
 * This module reports only; it never changes rendering decisions.
 */

function envEnabled(): boolean {
  const value = process.env.PI_AURORA_DIAG;
  return value === "1" || value === "true";
}

export interface AuroraDiagOptions {
  /** Overrides env detection; only used by tests. */
  enabled?: boolean;
}

export interface AuroraDiagSnapshot {
  renderCount: number;
  totalRenderMs: number;
  maxRenderMs: number;
  lastDashboardRows: number;
  activeTickIntervalMs: number | null;
}

class AuroraDiagnostics {
  private isEnabled: boolean;
  private renderCount = 0;
  private totalRenderMs = 0;
  private maxRenderMs = 0;
  private lastDashboardRows = 0;
  private activeTickIntervalMs: number | null = null;

  constructor(options?: AuroraDiagOptions) {
    this.isEnabled = options?.enabled ?? envEnabled();
  }

  get enabled(): boolean {
    return this.isEnabled;
  }

  /** Wraps one widget render call; measures wall time around `fn`. */
  measure<R>(fn: () => R): R {
    if (!this.isEnabled) return fn();
    const started = performance.now();
    try {
      return fn();
    } finally {
      const elapsed = performance.now() - started;
      this.renderCount += 1;
      this.totalRenderMs += elapsed;
      if (elapsed > this.maxRenderMs) this.maxRenderMs = elapsed;
    }
  }

  recordDashboardRows(rows: readonly unknown[]): void {
    if (!this.isEnabled) return;
    this.lastDashboardRows = rows.length;
  }

  recordTickInterval(intervalMs: number | null): void {
    if (!this.isEnabled) return;
    this.activeTickIntervalMs = intervalMs;
  }

  snapshot(): AuroraDiagSnapshot {
    return {
      renderCount: this.renderCount,
      totalRenderMs: Math.round(this.totalRenderMs * 1000) / 1000,
      maxRenderMs: Math.round(this.maxRenderMs * 1000) / 1000,
      lastDashboardRows: this.lastDashboardRows,
      activeTickIntervalMs: this.activeTickIntervalMs,
    };
  }

  reset(): void {
    this.renderCount = 0;
    this.totalRenderMs = 0;
    this.maxRenderMs = 0;
    this.lastDashboardRows = 0;
    // The tick interval survives resets: it describes configuration, not load.
  }

  /** One-line summary for manual smoke runs; silent unless enabled. */
  report(): string | undefined {
    if (!this.isEnabled) return undefined;
    const s = this.snapshot();
    const avg =
      s.renderCount > 0 ? Math.round((s.totalRenderMs / s.renderCount) * 1000) / 1000 : 0;
    return (
      `[aurora-diag] renders=${s.renderCount} total=${s.totalRenderMs}ms ` +
      `avg=${avg}ms max=${s.maxRenderMs}ms rows=${s.lastDashboardRows} ` +
      `tick=${s.activeTickIntervalMs ?? "off"}ms`
    );
  }
}

export const auroraDiagnostics = new AuroraDiagnostics();

/** Fresh instance for tests; same semantics as the shared singleton. */
export function createAuroraDiagnostics(options?: AuroraDiagOptions): AuroraDiagnostics {
  return new AuroraDiagnostics(options);
}

import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { NgApexchartsModule } from 'ng-apexcharts';
import { Subject, takeUntil, catchError, of, Subject as RxSubject, debounceTime, distinctUntilChanged } from 'rxjs';
import { DowntimeDashboardService } from './downtime-dashboard.service';
import { ToastService } from '../../core/services/toast.service';

/* ─────────────────────────────────────────────────────────────
   Phase 2 · Screen 6 — Downtime Reason Loss Analysis

   Two sources, deliberately not blended:

     measured   run and idle time from telemetry — availability is this
     declared   reasons operators typed in — the Pareto is this

   The gap between them is shown rather than hidden. It is the number
   that says whether the downtime reporting is worth anything.
───────────────────────────────────────────────────────────── */

@Component({
  selector: 'app-downtime-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, NgApexchartsModule],
  templateUrl: './downtime-dashboard.component.html'
})
export class DowntimeDashboardComponent implements OnInit, OnDestroy {

  machines: any[] = [];
  shifts: any[] = [];
  reasons: any[] = [];
  f: any = this.blankFilters();
  page = 1;
  readonly limit = 20;

  data: any = null;
  loading = false;
  errorMsg = '';
  updatedAt = '';
  exporting = '';

  paretoSeries: any[] = [];
  paretoCategories: string[] = [];
  hourlySeries: any[] = [];
  hourlyCategories: string[] = [];

  readonly CATEGORIES = ['PLANNED', 'UNPLANNED', 'QUALITY', 'CHANGEOVER'];

  private destroy$ = new Subject<void>();
  private search$ = new RxSubject<string>();

  constructor(
    private svc: DowntimeDashboardService,
    private toast: ToastService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.svc.getMeta()
      .pipe(takeUntil(this.destroy$), catchError(() => of(null)))
      .subscribe(res => {
        this.machines = res?.data?.machines ?? [];
        this.shifts   = res?.data?.shifts   ?? [];
        this.cdr.markForCheck();
      });

    this.svc.getReasons()
      .pipe(takeUntil(this.destroy$), catchError(() => of(null)))
      .subscribe(res => {
        this.reasons = res?.data ?? res ?? [];
        this.cdr.markForCheck();
      });

    this.search$
      .pipe(debounceTime(350), distinctUntilChanged(), takeUntil(this.destroy$))
      .subscribe(() => { this.page = 1; this.load(); });

    this.load();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  blankFilters() {
    const today = this.todayStr();
    const weekAgo = new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10);
    return {
      from: weekAgo, to: today,
      machine_id: null, shift_id: null, operator_id: null,
      reason_id: null, category: '', search: ''
    };
  }

  onSearchInput(): void { this.search$.next(this.f.search); }
  submit(): void { this.page = 1; this.load(); }
  reset(): void { this.f = this.blankFilters(); this.page = 1; this.load(); }

  changePage(delta: number): void {
    const next = this.page + delta;
    if (next < 1 || next > (this.data?.events?.totalPages || 1)) return;
    this.page = next;
    this.load();
  }

  load(): void {
    this.loading = true;
    this.errorMsg = '';
    this.cdr.markForCheck();

    this.svc.getDowntime({ ...this.f, page: this.page, limit: this.limit })
      .pipe(takeUntil(this.destroy$), catchError(err => {
        this.errorMsg = err?.error?.message || 'Unable to load downtime data.';
        return of(null);
      }))
      .subscribe(res => this.apply(res));
  }

  private apply(res: any): void {
    this.loading = false;

    if (!res || res.status !== 'success' || !res.data) {
      if (!this.errorMsg) this.errorMsg = 'No downtime data available.';
      this.cdr.markForCheck();
      return;
    }

    const d = this.data = this.normalise(res.data);
    this.updatedAt = d.updated_at
      ? new Date(d.updated_at).toLocaleString('en-IN', { hour12: true })
      : '';

    /* A Pareto is bars plus the cumulative line — the line is the point,
       because it is what shows how few reasons cover most of the loss. */
    this.paretoCategories = (d.by_reason || []).map((r: any) => r.reason);
    this.paretoSeries = [
      { name: 'Hours',        type: 'column', data: (d.by_reason || []).map((r: any) => +(r.seconds / 3600).toFixed(2)) },
      { name: 'Cumulative %', type: 'line',   data: (d.by_reason || []).map((r: any) => r.cumulative_pct) }
    ];

    this.hourlyCategories = (d.hourly || []).map((h: any) => String(h.hour).padStart(2, '0'));
    this.hourlySeries = [{ name: 'Hours down', data: (d.hourly || []).map((h: any) => +(h.seconds / 3600).toFixed(2)) }];

    this.cdr.markForCheck();
  }

  /* A template expression that throws aborts the whole change-detection
     pass, freezing unrelated components. Defend at the boundary. */
  private normalise(d: any): any {
    return {
      ...d,
      kpis: {
        total_downtime_seconds: 0, downtime_events: 0, open_events: 0,
        run_seconds: 0, idle_seconds: 0, alarm_seconds: 0,
        availability_pct: null, unaccounted_seconds: 0, reason_coverage_pct: null,
        ...(d?.kpis ?? {})
      },
      by_reason:   d?.by_reason   ?? [],
      top_reasons: d?.top_reasons ?? [],
      by_category: d?.by_category ?? [],
      by_shift:    d?.by_shift    ?? [],
      hourly:      d?.hourly      ?? [],
      events: { data: [], total: 0, page: 1, limit: this.limit, totalPages: 1, ...(d?.events ?? {}) }
    };
  }

  export(format: 'xlsx' | 'csv' | 'pdf'): void {
    this.exporting = format;
    this.cdr.markForCheck();

    this.svc.exportAs(format, this.f)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: blob => {
          this.exporting = '';
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `downtime_${this.todayStr()}.${format}`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 0);
          this.cdr.markForCheck();
        },
        error: () => {
          this.exporting = '';
          this.cdr.markForCheck();
          this.toast.error('No downtime records match these filters');
        }
      });
  }

  /* ── view helpers ── */

  /** True when telemetry exists but nobody has entered a single reason —
   *  a setup gap, not an empty filter result. */
  get hasNoReasons(): boolean {
    return !!this.data && this.data.kpis.downtime_events === 0 && this.data.kpis.idle_seconds > 0;
  }

  hours(seconds: number | null | undefined): string {
    const n = Number(seconds) || 0;
    if (n < 60) return `${n}s`;
    const h = Math.floor(n / 3600);
    const m = Math.floor((n % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  pct(v: number | null | undefined): string {
    return v === null || v === undefined ? '--' : `${v}%`;
  }

  categoryClass(c: string): string {
    switch (String(c).toUpperCase()) {
      case 'PLANNED':    return 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300';
      case 'UNPLANNED':  return 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300';
      case 'QUALITY':    return 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300';
      case 'CHANGEOVER': return 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300';
      default:           return 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200';
    }
  }

  private todayStr(): string {
    return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
      .toISOString().split('T')[0];
  }

  get paretoChart(): any {
    return {
      chart:  { type: 'line', height: 300, toolbar: { show: false }, fontFamily: 'inherit' },
      stroke: { width: [0, 3], curve: 'straight' },
      plotOptions: { bar: { columnWidth: '55%', borderRadius: 3 } },
      colors: ['#dc2626', '#0f766e'],
      dataLabels: { enabled: false },
      legend: { position: 'top', horizontalAlign: 'right' },
      xaxis:  { categories: this.paretoCategories, labels: { rotate: -35, trim: true } },
      yaxis: [
        { title: { text: 'Hours' }, labels: { formatter: (v: number) => v?.toFixed(1) } },
        { opposite: true, min: 0, max: 100, title: { text: 'Cumulative %' },
          labels: { formatter: (v: number) => v?.toFixed(0) } }
      ],
      grid:   { borderColor: 'rgba(148,163,184,.25)' },
      tooltip:{ theme: 'dark', shared: true, intersect: false },
      noData: { text: 'No downtime reasons recorded for this period' }
    };
  }

  get hourlyChart(): any {
    return {
      chart:  { type: 'bar', height: 240, toolbar: { show: false }, fontFamily: 'inherit' },
      plotOptions: { bar: { columnWidth: '65%', borderRadius: 2 } },
      colors: ['#2563eb'],
      dataLabels: { enabled: false },
      xaxis:  { categories: this.hourlyCategories, title: { text: 'Hour of day' } },
      yaxis:  { title: { text: 'Hours down' }, labels: { formatter: (v: number) => v?.toFixed(1) } },
      grid:   { borderColor: 'rgba(148,163,184,.25)' },
      tooltip:{ theme: 'dark' },
      noData: { text: 'No downtime recorded for this period' }
    };
  }
}

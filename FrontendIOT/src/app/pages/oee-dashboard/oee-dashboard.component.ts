import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { NgApexchartsModule } from 'ng-apexcharts';
import { Subject, takeUntil, catchError, of, Subject as RxSubject, debounceTime, distinctUntilChanged } from 'rxjs';
import { OeeDashboardService } from './oee-dashboard.service';
import { ToastService } from '../../core/services/toast.service';

/* ─────────────────────────────────────────────────────────────
   Phase 2 · Screen 8 — OEE Dashboard

   OEE here is recomputed from totals rather than averaged from the
   stored hourly values. Averaging a ratio across hours with different
   denominators does not give the ratio for the period, and an hour with
   no production scores zero on performance and quality — so averaging
   reports 0% for a fleet that is genuinely running at 19%.

   Where a cycle time is missing, performance and OEE are null rather
   than zero. Zero is a judgement about the machine; null is the truth
   about our configuration.
───────────────────────────────────────────────────────────── */

@Component({
  selector: 'app-oee-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, NgApexchartsModule],
  templateUrl: './oee-dashboard.component.html'
})
export class OeeDashboardComponent implements OnInit, OnDestroy {

  machines: any[] = [];
  shifts: any[] = [];
  f: any = this.blankFilters();
  page = 1;
  readonly limit = 20;

  data: any = null;
  loading = false;
  errorMsg = '';
  updatedAt = '';
  exporting = '';

  trendSeries: any[] = [];
  trendCategories: string[] = [];
  compSeries: any[] = [];
  compCategories: string[] = [];

  private destroy$ = new Subject<void>();
  private search$ = new RxSubject<string>();

  constructor(
    private svc: OeeDashboardService,
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

    this.search$
      .pipe(debounceTime(350), distinctUntilChanged(), takeUntil(this.destroy$))
      .subscribe(() => { this.page = 1; this.load(); });

    this.load();
  }

  ngOnDestroy(): void { this.destroy$.next(); this.destroy$.complete(); }

  blankFilters() {
    const today = this.todayStr();
    const weekAgo = new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10);
    return { from: weekAgo, to: today, machine_id: null, shift_id: null, search: '' };
  }

  onSearchInput(): void { this.search$.next(this.f.search); }
  submit(): void { this.page = 1; this.load(); }
  reset(): void { this.f = this.blankFilters(); this.page = 1; this.load(); }

  changePage(delta: number): void {
    const next = this.page + delta;
    if (next < 1 || next > (this.data?.machines?.totalPages || 1)) return;
    this.page = next;
    this.load();
  }

  load(): void {
    this.loading = true;
    this.errorMsg = '';
    this.cdr.markForCheck();

    this.svc.getOee({ ...this.f, page: this.page, limit: this.limit })
      .pipe(takeUntil(this.destroy$), catchError(err => {
        this.errorMsg = err?.error?.message || 'Unable to load OEE data.';
        return of(null);
      }))
      .subscribe(res => this.apply(res));
  }

  private apply(res: any): void {
    this.loading = false;
    if (!res || res.status !== 'success' || !res.data) {
      if (!this.errorMsg) this.errorMsg = 'No OEE data available.';
      this.cdr.markForCheck();
      return;
    }

    const d = this.data = this.normalise(res.data);
    this.updatedAt = d.updated_at ? new Date(d.updated_at).toLocaleString('en-IN', { hour12: true }) : '';

    this.trendCategories = (d.trend || []).map((t: any) =>
      new Date(t.day).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }));
    this.trendSeries = [{ name: 'Availability %', data: (d.trend || []).map((t: any) => t.availability_pct) }];

    /* Only machines with a computable OEE go on the comparison chart —
       plotting a null as a zero bar would read as a failing machine. */
    const withOee = (d.machines?.data || []).filter((m: any) => m.oee_pct !== null);
    this.compCategories = withOee.map((m: any) => m.machine_serial_no);
    this.compSeries = [
      { name: 'Availability', data: withOee.map((m: any) => m.availability_pct) },
      { name: 'Performance',  data: withOee.map((m: any) => m.performance_pct) },
      { name: 'Quality',      data: withOee.map((m: any) => m.quality_pct) }
    ];

    this.cdr.markForCheck();
  }

  private normalise(d: any): any {
    return {
      ...d,
      thresholds: { good: 85, fair: 60, ...(d?.thresholds ?? {}) },
      kpis: {
        availability_pct: null, performance_pct: null, quality_pct: null, oee_pct: null,
        band: 'UNKNOWN', produced: 0, good: 0, rejected: 0,
        run_seconds: 0, idle_seconds: 0, downtime_seconds: 0, alarm_count: 0,
        machines_measurable: 0, machines_total: 0, ...(d?.kpis ?? {})
      },
      coverage: { machines: 0, with_cycle_time: 0, oee_computable: 0, note: '', ...(d?.coverage ?? {}) },
      status_counts: { RUNNING: 0, IDLE: 0, ALARM: 0, OFFLINE: 0, ...(d?.status_counts ?? {}) },
      top_machines:    d?.top_machines    ?? [],
      bottom_machines: d?.bottom_machines ?? [],
      trend:           d?.trend           ?? [],
      machines: { data: [], total: 0, page: 1, limit: this.limit, totalPages: 1, ...(d?.machines ?? {}) }
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
          a.href = url; a.download = `oee_${this.todayStr()}.${format}`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 0);
          this.cdr.markForCheck();
        },
        error: () => {
          this.exporting = '';
          this.cdr.markForCheck();
          this.toast.error('No machines match these filters');
        }
      });
  }

  /* ── view helpers ── */

  /** Unknown shows as a dash, never 0% — they are different claims. */
  pct(v: number | null | undefined): string {
    return v === null || v === undefined ? '--' : `${v}%`;
  }

  hours(seconds: number | null | undefined): string {
    const n = Number(seconds) || 0;
    if (n < 60) return `${n}s`;
    const h = Math.floor(n / 3600);
    const m = Math.floor((n % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  /* Band carries the meaning; colour only reinforces it. */
  bandClass(band: string): string {
    switch (band) {
      case 'GOOD': return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300';
      case 'FAIR': return 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300';
      case 'POOR': return 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300';
      default:     return 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300';
    }
  }

  statusClass(status: string): string {
    switch (status) {
      case 'RUNNING': return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300';
      case 'ALARM':   return 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300';
      case 'IDLE':    return 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300';
      default:        return 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300';
    }
  }

  private todayStr(): string {
    return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
      .toISOString().split('T')[0];
  }

  get trendChart(): any {
    return {
      chart:  { type: 'area', height: 260, toolbar: { show: false }, fontFamily: 'inherit' },
      stroke: { width: 2, curve: 'smooth' },
      fill:   { type: 'gradient', gradient: { shadeIntensity: 0.3, opacityFrom: 0.35, opacityTo: 0.05 } },
      colors: ['#0f766e'],
      dataLabels: { enabled: false },
      xaxis:  { categories: this.trendCategories },
      yaxis:  { min: 0, max: 100, title: { text: 'Availability %' },
                labels: { formatter: (v: number) => v?.toFixed(0) } },
      grid:   { borderColor: 'rgba(148,163,184,.25)' },
      tooltip:{ theme: 'dark' },
      noData: { text: 'No production recorded for this period' }
    };
  }

  get compChart(): any {
    return {
      chart:  { type: 'bar', height: 320, toolbar: { show: false }, fontFamily: 'inherit' },
      plotOptions: { bar: { columnWidth: '65%', borderRadius: 2 } },
      colors: ['#2563eb', '#7c3aed', '#0f766e'],
      dataLabels: { enabled: false },
      legend: { position: 'top', horizontalAlign: 'right' },
      xaxis:  { categories: this.compCategories, labels: { rotate: -35, trim: true } },
      yaxis:  { min: 0, max: 100, title: { text: '%' }, labels: { formatter: (v: number) => v?.toFixed(0) } },
      grid:   { borderColor: 'rgba(148,163,184,.25)' },
      tooltip:{ theme: 'dark', shared: true, intersect: false },
      noData: { text: 'No machine has a computable OEE for this period' }
    };
  }
}

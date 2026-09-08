import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgApexchartsModule } from 'ng-apexcharts';
import { Subject, interval, startWith, switchMap, takeUntil, catchError, of } from 'rxjs';
import { FactoryService } from './factory.service';

/* ─────────────────────────────────────────────────────────────
   Phase 2 · Screen 1 — Factory Overall Dashboard

   One factory-wide aggregate over GET /dashboard/factory,
   filterable by Shift / Machine / Date. The API already does the
   rollup work; this component only shapes it for the charts and
   re-polls so the board stays current on a shop-floor screen.
───────────────────────────────────────────────────────────── */

const POLL_MS = 60_000;

@Component({
  selector: 'app-factory',
  standalone: true,
  imports: [CommonModule, FormsModule, NgApexchartsModule],
  templateUrl: './factory.component.html'
})
export class FactoryComponent implements OnInit, OnDestroy {

  /* ── filters ── */
  machines: any[] = [];
  shifts:   any[] = [];
  selectedMachine: number | null = null;
  selectedShift:   number | null = null;
  selectedDate = this.todayStr();
  today        = this.todayStr();

  /* ── state ── */
  data: any = null;
  loading = false;
  errorMsg = '';
  updatedAt = '';

  /* ── charts ── */
  shiftSeries:     any[] = [];
  shiftCategories: string[] = [];
  trendSeries:     any[] = [];
  trendCategories: string[] = [];
  downtimeSeries:  number[] = [];
  downtimeLabels:  string[] = [];

  private destroy$ = new Subject<void>();

  constructor(
    private svc: FactoryService,
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

    /* poll so a wall-mounted board stays live without a reload */
    interval(POLL_MS)
      .pipe(
        startWith(0),
        switchMap(() => this.fetch$()),
        takeUntil(this.destroy$)
      )
      .subscribe(res => this.apply(res));
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /** Submit re-runs the query immediately with the current filters. */
  submit(): void {
    this.fetch$().pipe(takeUntil(this.destroy$)).subscribe(res => this.apply(res));
  }

  private fetch$() {
    this.loading = true;
    this.errorMsg = '';
    this.cdr.markForCheck();
    return this.svc.getFactory({
      date:       this.selectedDate,
      shift_id:   this.selectedShift,
      machine_id: this.selectedMachine
    }).pipe(
      catchError(err => {
        this.errorMsg = err?.error?.message || 'Unable to load factory dashboard.';
        return of(null);
      })
    );
  }

  private apply(res: any): void {
    this.loading = false;

    if (!res || res.status !== 'success' || !res.data) {
      if (!this.errorMsg) this.errorMsg = 'No dashboard data available.';
      this.cdr.markForCheck();
      return;
    }

    const d = res.data;
    this.data = d;
    this.updatedAt = d.updated_at
      ? new Date(d.updated_at).toLocaleString('en-IN', { hour12: true })
      : '';

    /* shift-wise production */
    this.shiftCategories = (d.shiftwise || []).map((s: any) => s.shift_code);
    this.shiftSeries = [{
      name: 'Produced',
      data: (d.shiftwise || []).map((s: any) => s.produced)
    }];

    /* hourly energy + production trend */
    const trend = d.trend || [];
    this.trendCategories = trend.map((t: any) =>
      new Date(t.hour).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })
    );
    this.trendSeries = [
      { name: 'Energy (kWh)', type: 'line', data: trend.map((t: any) => t.kwh) },
      { name: 'Produced',     type: 'column', data: trend.map((t: any) => t.produced) }
    ];

    /* downtime split by reason */
    const reasons = d.downtime?.by_reason || [];
    this.downtimeLabels = reasons.map((r: any) => r.reason);
    this.downtimeSeries = reasons.map((r: any) => Math.round(r.seconds / 60));

    this.cdr.markForCheck();
  }

  /* ── view helpers ── */

  /** Seconds → "8h 12m", the format the shop floor reads fastest. */
  hm(seconds: number | null | undefined): string {
    const s = Number(seconds || 0);
    const h = Math.floor(s / 3600);
    const m = Math.round((s % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  /** Cost is null (not 0) when no tariff is configured — say so plainly. */
  money(v: number | null | undefined): string {
    if (v === null || v === undefined) return 'Tariff not set';
    const cur = this.data?.energy?.currency || 'INR';
    const sym = cur === 'INR' ? '₹' : '';
    return `${sym}${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  }

  oeeColor(v: number): string {
    const target = this.data?.oee?.target ?? 85;
    if (v >= target)       return 'text-emerald-600 dark:text-emerald-400';
    if (v >= target * 0.8) return 'text-amber-600 dark:text-amber-400';
    return 'text-red-600 dark:text-red-400';
  }

  private todayStr(): string {
    return new Date(
      new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })
    ).toISOString().split('T')[0];
  }

  /* ── chart option blocks (kept out of the template) ── */

  get shiftChart(): any {
    return {
      chart:  { type: 'bar', height: 260, toolbar: { show: false }, fontFamily: 'inherit' },
      plotOptions: { bar: { borderRadius: 6, columnWidth: '45%' } },
      dataLabels: { enabled: true },
      colors: ['#2B3990'],
      xaxis:  { categories: this.shiftCategories },
      yaxis:  { title: { text: 'Qty' } },
      grid:   { borderColor: 'rgba(148,163,184,.25)' },
      tooltip:{ theme: 'dark' }
    };
  }

  get trendChart(): any {
    return {
      chart:  { height: 260, type: 'line', toolbar: { show: false }, fontFamily: 'inherit' },
      stroke: { width: [3, 0], curve: 'smooth' },
      plotOptions: { bar: { borderRadius: 4, columnWidth: '45%' } },
      colors: ['#9B3F70', '#2B3990'],
      dataLabels: { enabled: false },
      xaxis:  { categories: this.trendCategories },
      yaxis: [
        { title: { text: 'kWh' } },
        { opposite: true, title: { text: 'Produced' } }
      ],
      legend: { position: 'top' },
      grid:   { borderColor: 'rgba(148,163,184,.25)' },
      tooltip:{ theme: 'dark' }
    };
  }

  get downtimeChart(): any {
    return {
      chart:  { type: 'donut', height: 260, fontFamily: 'inherit' },
      labels: this.downtimeLabels,
      colors: ['#e03131', '#f59f00', '#2B3990', '#9B3F70', '#12b886', '#7048e8'],
      legend: { position: 'bottom' },
      dataLabels: { enabled: true },
      tooltip: { y: { formatter: (v: number) => `${v} min` } }
    };
  }
}

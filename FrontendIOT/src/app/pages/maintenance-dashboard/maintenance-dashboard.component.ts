import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { NgApexchartsModule } from 'ng-apexcharts';
import { Subject, interval, startWith, switchMap, takeUntil, catchError, of } from 'rxjs';
import { MaintenanceDashboardService } from './maintenance-dashboard.service';

/* ─────────────────────────────────────────────────────────────
   Phase 2 · Screen 2 — Maintenance Dashboard

   Machine-condition view over GET /dashboard/maintenance,
   filterable by Shift / Machine / Date.

   The agreement also lists servo load per axis, temperature,
   battery voltage, insulation resistance and fan/amplifier
   status. Nothing collects those signals — telemetry_raw has no
   such column and the MQTT collector is a separate service — so
   the API returns their names in `unavailable` and this page
   states the gap rather than drawing empty gauges.
───────────────────────────────────────────────────────────── */

const POLL_MS = 60_000;

/** API key → the words a maintenance engineer would use. */
const SIGNAL_LABELS: Record<string, string> = {
  servo_load_per_axis:   'Servo load per axis',
  machine_temperature:   'Machine temperature',
  battery_status:        'CNC / APC battery status',
  insulation_resistance: 'Insulation resistance',
  fan_amplifier_status:  'Cooling fan & amplifier status'
};

@Component({
  selector: 'app-maintenance-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, NgApexchartsModule],
  templateUrl: './maintenance-dashboard.component.html'
})
export class MaintenanceDashboardComponent implements OnInit, OnDestroy {

  /* ── filters ── */
  machines: any[] = [];
  shifts:   any[] = [];
  selectedMachine: number | null = null;
  selectedShift:   number | null = null;
  selectedDate = this.todayStr();
  today        = this.todayStr();

  /* ── state ── */
  data: any = null;
  loading   = false;
  errorMsg  = '';
  updatedAt = '';

  /* ── chart ── */
  cycleSeries:     any[] = [];
  cycleCategories: string[] = [];

  private destroy$ = new Subject<void>();

  constructor(
    private svc: MaintenanceDashboardService,
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

    /* poll so a wall-mounted board stays current without a reload */
    interval(POLL_MS)
      .pipe(startWith(0), switchMap(() => this.fetch$()), takeUntil(this.destroy$))
      .subscribe(res => this.apply(res));
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  submit(): void {
    this.fetch$().pipe(takeUntil(this.destroy$)).subscribe(res => this.apply(res));
  }

  reset(): void {
    this.selectedMachine = null;
    this.selectedShift   = null;
    this.selectedDate    = this.todayStr();
    this.submit();
  }

  private fetch$() {
    this.loading  = true;
    this.errorMsg = '';
    this.cdr.markForCheck();
    return this.svc.getMaintenance({
      date:       this.selectedDate,
      shift_id:   this.selectedShift,
      machine_id: this.selectedMachine
    }).pipe(
      catchError(err => {
        this.errorMsg = err?.error?.message || 'Unable to load the maintenance dashboard.';
        return of(null);
      })
    );
  }

  private apply(res: any): void {
    this.loading = false;

    if (!res || res.status !== 'success' || !res.data) {
      if (!this.errorMsg) this.errorMsg = 'No maintenance data available for this selection.';
      this.cdr.markForCheck();
      return;
    }

    const d = this.data = res.data;
    this.updatedAt = d.updated_at
      ? new Date(d.updated_at).toLocaleString('en-IN', { hour12: true })
      : '';

    const trend = d.cycle_time_trend || [];
    this.cycleCategories = trend.map((t: any) =>
      new Date(t.hour_start).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })
    );
    // null for hours with no production — Apex leaves a gap rather than
    // dropping the line to zero, which would read as an impossibly fast cycle
    this.cycleSeries = [{
      name: 'Avg cycle time (s)',
      data: trend.map((t: any) => t.avg_cycle_seconds ?? null)
    }];

    this.cdr.markForCheck();
  }

  /* ── view helpers ── */

  get hasCycleData(): boolean {
    return this.cycleSeries.some(s => (s.data || []).some((v: number | null) => v != null));
  }

  /** Signals the API says it cannot supply, in readable form. */
  get missingSignals(): string[] {
    return (this.data?.unavailable || []).map((k: string) => SIGNAL_LABELS[k] || k);
  }

  /** Seconds → "8h 12m", the format the shop floor reads fastest. */
  hm(seconds: number | null | undefined): string {
    const s = Number(seconds || 0);
    const h = Math.floor(s / 3600);
    const m = Math.round((s % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  /** A machine's state, derived the same way the API counts it. */
  rowStatus(r: any): 'RUNNING' | 'IDLE' | 'BREAKDOWN' | 'OFFLINE' {
    if (!r.received_at) return 'OFFLINE';
    const ageSec = (Date.now() - new Date(r.received_at).getTime()) / 1000;
    if (ageSec > 60) return 'OFFLINE';
    if (r.alarm) return 'BREAKDOWN';
    return String(r.machine_status).toUpperCase() === 'RUNNING' ? 'RUNNING' : 'IDLE';
  }

  /* Badge styling. Colour is never the only cue — the badge always carries
     its own text label, so this is reinforcement, not meaning. */
  statusClass(s: string): string {
    switch (s) {
      case 'RUNNING':   return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300';
      case 'IDLE':      return 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300';
      case 'BREAKDOWN': return 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300';
      default:          return 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200';
    }
  }

  /** Health band. Paired with the number itself, never colour alone. */
  healthClass(percent: number): string {
    if (percent >= 85) return 'text-emerald-600 dark:text-emerald-400';
    if (percent >= 60) return 'text-amber-600 dark:text-amber-400';
    return 'text-red-600 dark:text-red-400';
  }

  private todayStr(): string {
    return new Date(
      new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })
    ).toISOString().split('T')[0];
  }

  get cycleChart(): any {
    return {
      chart:  { type: 'line', height: 280, toolbar: { show: false }, fontFamily: 'inherit' },
      stroke: { width: 3, curve: 'smooth' },
      colors: ['#2563eb'],
      dataLabels: { enabled: false },
      markers: { size: 3 },
      xaxis:  { categories: this.cycleCategories, title: { text: 'Hour' } },
      yaxis:  { title: { text: 'Seconds per part' }, labels: { formatter: (v: number) => v?.toFixed(0) } },
      grid:   { borderColor: 'rgba(148,163,184,.25)' },
      tooltip:{ theme: 'dark', y: { formatter: (v: number) => v == null ? 'no production' : `${v.toFixed(1)} s` } },
      noData: { text: 'No production in this window' }
    };
  }
}

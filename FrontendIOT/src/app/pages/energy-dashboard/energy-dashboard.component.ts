import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { NgApexchartsModule } from 'ng-apexcharts';
import { Subject, takeUntil, catchError, of, Subject as RxSubject, debounceTime, distinctUntilChanged } from 'rxjs';
import { EnergyDashboardService } from './energy-dashboard.service';
import { ToastService } from '../../core/services/toast.service';

/* ─────────────────────────────────────────────────────────────
   Phase 2 · Screen 9 — Energy Monitoring

   Devices report energy as a cumulative kWh counter, so consumption is
   a difference between readings, never a sum of them. No machine sends
   that counter yet, so this screen reports "not reporting" rather than
   zeros that would read as a remarkably efficient factory.
───────────────────────────────────────────────────────────── */

@Component({
  selector: 'app-energy-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, NgApexchartsModule],
  templateUrl: './energy-dashboard.component.html'
})
export class EnergyDashboardComponent implements OnInit, OnDestroy {

  machines: any[] = [];
  f: any = this.blankFilters();
  page = 1;
  readonly limit = 20;

  data: any = null;
  loading = false;
  errorMsg = '';
  updatedAt = '';
  exporting = '';

  showSettings = false;
  savingSettings = false;
  settingsForm: any = { machine_id: null, cost_per_kwh: null, currency: 'INR', overload_kw: null };
  settings: any[] = [];

  trendSeries: any[] = [];
  trendCategories: string[] = [];
  machineSeries: any[] = [];
  machineCategories: string[] = [];

  private destroy$ = new Subject<void>();
  private search$ = new RxSubject<string>();

  constructor(
    private svc: EnergyDashboardService,
    private toast: ToastService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.svc.getMeta()
      .pipe(takeUntil(this.destroy$), catchError(() => of(null)))
      .subscribe(res => { this.machines = res?.data?.machines ?? []; this.cdr.markForCheck(); });

    this.search$
      .pipe(debounceTime(350), distinctUntilChanged(), takeUntil(this.destroy$))
      .subscribe(() => { this.page = 1; this.load(); });

    this.loadSettings();
    this.load();
  }

  ngOnDestroy(): void { this.destroy$.next(); this.destroy$.complete(); }

  blankFilters() {
    const today = this.todayStr();
    const weekAgo = new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10);
    return { from: weekAgo, to: today, machine_id: null, search: '' };
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

    this.svc.getEnergy({ ...this.f, page: this.page, limit: this.limit })
      .pipe(takeUntil(this.destroy$), catchError(err => {
        this.errorMsg = err?.error?.message || 'Unable to load energy data.';
        return of(null);
      }))
      .subscribe(res => this.apply(res));
  }

  private apply(res: any): void {
    this.loading = false;
    if (!res || res.status !== 'success' || !res.data) {
      if (!this.errorMsg) this.errorMsg = 'No energy data available.';
      this.cdr.markForCheck();
      return;
    }

    const d = this.data = this.normalise(res.data);
    this.updatedAt = d.updated_at ? new Date(d.updated_at).toLocaleString('en-IN', { hour12: true }) : '';

    this.trendCategories = (d.trend || []).map((t: any) =>
      new Date(t.day).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }));
    this.trendSeries = [{ name: 'kWh', data: (d.trend || []).map((t: any) => t.kwh) }];

    /* Only machines that actually report a counter go on the chart —
       plotting a non-reporting machine as a zero bar would read as a
       machine using no electricity. */
    const reporting = (d.machines?.data || []).filter((m: any) => m.kwh !== null);
    this.machineCategories = reporting.map((m: any) => m.machine_serial_no);
    this.machineSeries = [{ name: 'kWh', data: reporting.map((m: any) => m.kwh) }];

    this.cdr.markForCheck();
  }

  private normalise(d: any): any {
    return {
      ...d,
      currency: d?.currency || 'INR',
      kpis: {
        total_kwh: null, total_operating_seconds: 0, total_produced: 0,
        kwh_per_part: null, total_cost: null, overload_alerts: 0, ...(d?.kpis ?? {})
      },
      coverage: { machines: 0, reporting: 0, tariff_configured: false, note: '', ...(d?.coverage ?? {}) },
      trend:     d?.trend     ?? [],
      by_shift:  d?.by_shift  ?? [],
      by_month:  d?.by_month  ?? [],
      top_consumers: d?.top_consumers ?? [],
      overloads: d?.overloads ?? [],
      machines: { data: [], total: 0, page: 1, limit: this.limit, totalPages: 1, ...(d?.machines ?? {}) }
    };
  }

  loadSettings(): void {
    this.svc.getSettings()
      .pipe(takeUntil(this.destroy$), catchError(() => of(null)))
      .subscribe(res => { this.settings = res?.data ?? []; this.cdr.markForCheck(); });
  }

  saveSettings(): void {
    this.savingSettings = true;
    this.cdr.markForCheck();
    this.svc.saveSettings(this.settingsForm)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.savingSettings = false;
          this.toast.success('Energy settings saved');
          this.loadSettings();
          this.load();
        },
        error: err => {
          this.savingSettings = false;
          this.cdr.markForCheck();
          this.toast.error(err?.error?.message || 'Could not save the settings');
        }
      });
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
          a.href = url; a.download = `energy_${this.todayStr()}.${format}`;
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

  /** True when not one machine reports a counter — a device gap, not an
   *  empty filter result, and worth saying plainly. */
  get noEnergyData(): boolean {
    return !!this.data && this.data.coverage.reporting === 0;
  }

  /** Unknown shows as a dash, never 0 — they are different claims. */
  num(v: number | null | undefined, unit = ''): string {
    return v === null || v === undefined ? '--' : `${v}${unit}`;
  }

  hours(seconds: number | null | undefined): string {
    const n = Number(seconds) || 0;
    const h = Math.floor(n / 3600);
    const m = Math.floor((n % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
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
      colors: ['#b45309'],
      dataLabels: { enabled: false },
      xaxis:  { categories: this.trendCategories },
      yaxis:  { title: { text: 'kWh' }, labels: { formatter: (v: number) => v?.toFixed(1) } },
      grid:   { borderColor: 'rgba(148,163,184,.25)' },
      tooltip:{ theme: 'dark' },
      noData: { text: 'No machine is reporting an energy counter yet' }
    };
  }

  get machineChart(): any {
    return {
      chart:  { type: 'bar', height: 300, toolbar: { show: false }, fontFamily: 'inherit' },
      plotOptions: { bar: { horizontal: true, borderRadius: 3, barHeight: '60%' } },
      colors: ['#b45309'],
      dataLabels: { enabled: true },
      xaxis:  { categories: this.machineCategories, title: { text: 'kWh' } },
      grid:   { borderColor: 'rgba(148,163,184,.25)' },
      tooltip:{ theme: 'dark' },
      noData: { text: 'No machine is reporting an energy counter yet' }
    };
  }
}

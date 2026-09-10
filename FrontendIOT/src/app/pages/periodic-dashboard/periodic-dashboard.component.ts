import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { NgApexchartsModule } from 'ng-apexcharts';
import { Subject, takeUntil, catchError, of, Subject as RxSubject, debounceTime, distinctUntilChanged } from 'rxjs';
import { PeriodicDashboardService } from './periodic-dashboard.service';
import { ToastService } from '../../core/services/toast.service';

/* ─────────────────────────────────────────────────────────────
   Phase 2 · Screen 4 — Periodic Maintenance Dashboard

   The calendar half of maintenance. Screen 3 raises work because a
   machine started alarming; this raises work because the date arrived —
   greasing, filter changes, calibration, the annual service.

   Not polled. The engine evaluates every 15 minutes and the shortest
   frequency is daily, so a 60-second refresh would add load to numbers
   that cannot have moved.
───────────────────────────────────────────────────────────── */

@Component({
  selector: 'app-periodic-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, NgApexchartsModule],
  templateUrl: './periodic-dashboard.component.html'
})
export class PeriodicDashboardComponent implements OnInit, OnDestroy {

  /* ── filters ── */
  machines: any[] = [];
  selectedMachine: number | null = null;
  search = '';
  statusFilter = '';
  page = 1;
  readonly limit = 10;

  /* ── state ── */
  data: any = null;
  loading = false;
  errorMsg = '';
  updatedAt = '';
  running = false;
  exporting = '';

  /* ── the plan ── */
  schedules: any[] = [];
  showPlan = false;
  savingSchedule = false;
  scheduleForm: any = this.blankSchedule();

  /* ── charts ── */
  trendSeries: any[] = [];
  trendCategories: string[] = [];

  readonly FREQUENCIES = ['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY'];
  readonly STATUSES = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];

  private destroy$ = new Subject<void>();
  private search$ = new RxSubject<string>();

  constructor(
    private svc: PeriodicDashboardService,
    private toast: ToastService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.svc.getMeta()
      .pipe(takeUntil(this.destroy$), catchError(() => of(null)))
      .subscribe(res => {
        this.machines = res?.data?.machines ?? [];
        this.cdr.markForCheck();
      });

    /* debounced so typing in the search box does not fire a request per
       keystroke against a paginated endpoint */
    this.search$
      .pipe(debounceTime(350), distinctUntilChanged(), takeUntil(this.destroy$))
      .subscribe(() => { this.page = 1; this.load(); });

    this.loadSchedules();
    this.load();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onSearchInput(): void { this.search$.next(this.search); }

  submit(): void { this.page = 1; this.load(); }

  reset(): void {
    this.selectedMachine = null;
    this.search = '';
    this.statusFilter = '';
    this.page = 1;
    this.loadSchedules();
    this.load();
  }

  changePage(delta: number): void {
    const next = this.page + delta;
    if (next < 1 || next > (this.data?.tickets?.totalPages || 1)) return;
    this.page = next;
    this.load();
  }

  load(): void {
    this.loading = true;
    this.errorMsg = '';
    this.cdr.markForCheck();

    this.svc.getPeriodic({
      machine_id: this.selectedMachine,
      search: this.search,
      status: this.statusFilter,
      page: this.page,
      limit: this.limit
    })
      .pipe(takeUntil(this.destroy$), catchError(err => {
        this.errorMsg = err?.error?.message || 'Unable to load periodic maintenance data.';
        return of(null);
      }))
      .subscribe(res => this.apply(res));
  }

  private apply(res: any): void {
    this.loading = false;

    if (!res || res.status !== 'success' || !res.data) {
      if (!this.errorMsg) this.errorMsg = 'No periodic maintenance data available.';
      this.cdr.markForCheck();
      return;
    }

    const d = this.data = this.normalise(res.data);
    this.updatedAt = d.updated_at
      ? new Date(d.updated_at).toLocaleString('en-IN', { hour12: true })
      : '';

    this.trendCategories = (d.compliance_trend || []).map((t: any) =>
      new Date(t.week_start).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }));
    this.trendSeries = [{
      name: 'Compliance %',
      data: (d.compliance_trend || []).map((t: any) => t.compliance_pct)
    }];

    this.cdr.markForCheck();
  }

  /*
   * Fill in anything the payload is missing before it reaches the template.
   *
   * A template expression that throws does not just blank its own section —
   * the exception aborts the whole change-detection pass, so every other
   * component on the page stops re-rendering too. A partial response once
   * left the header's dropdowns frozen, which read as a broken menu rather
   * than a broken dashboard. Defend at the boundary, not in thirty
   * separate template expressions.
   */
  private normalise(d: any): any {
    return {
      ...d,
      filters: d?.filters ?? { machine_id: null, search: null, status: null },
      kpis: {
        scheduled: 0, due_today: 0, due_this_week: 0, overdue: 0, completed: 0,
        compliance_pct: null, compliance_basis: { on_time: 0, judged: 0 },
        ...(d?.kpis ?? {})
      },
      compliance_trend:    d?.compliance_trend    ?? [],
      by_frequency:        d?.by_frequency        ?? [],
      technician_workload: d?.technician_workload ?? [],
      upcoming:            d?.upcoming            ?? [],
      tickets: { data: [], total: 0, page: 1, limit: this.limit, totalPages: 1, ...(d?.tickets ?? {}) }
    };
  }

  /* ── the plan ── */

  loadSchedules(): void {
    this.svc.getSchedules(this.selectedMachine)
      .pipe(takeUntil(this.destroy$), catchError(() => of(null)))
      .subscribe(res => {
        this.schedules = res?.data ?? [];
        this.cdr.markForCheck();
      });
  }

  blankSchedule() {
    return {
      id: null, machine_id: null, title: '', description: '',
      frequency: 'MONTHLY', next_due_at: this.todayStr(),
      grace_days: 0, assigned_user_id: null, is_active: true
    };
  }

  editSchedule(s: any): void {
    this.scheduleForm = {
      ...s,
      next_due_at: s.next_due_at ? String(s.next_due_at).slice(0, 10) : this.todayStr()
    };
    this.showPlan = true;
    this.cdr.markForCheck();
  }

  saveSchedule(): void {
    const f = this.scheduleForm;
    if (!f.machine_id)      { this.toast.error('Choose a machine'); return; }
    if (!f.title?.trim())   { this.toast.error('A task name is required'); return; }
    if (!f.next_due_at)     { this.toast.error('Set the first due date'); return; }

    this.savingSchedule = true;
    this.cdr.markForCheck();

    this.svc.saveSchedule({ ...f, grace_days: Number(f.grace_days) || 0 })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.savingSchedule = false;
          this.scheduleForm = this.blankSchedule();
          this.toast.success('Schedule saved');
          this.loadSchedules();
          this.load();
        },
        error: err => {
          this.savingSchedule = false;
          this.cdr.markForCheck();
          this.toast.error(err?.error?.message || 'Could not save the schedule');
        }
      });
  }

  deleteSchedule(s: any): void {
    if (!confirm(`Stop scheduling "${s.title}"? Tickets it already raised are kept.`)) return;
    this.svc.deleteSchedule(s.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => { this.toast.success('Schedule stopped'); this.loadSchedules(); this.load(); },
        error: err => this.toast.error(err?.error?.message || 'Could not stop the schedule')
      });
  }

  runEngine(): void {
    this.running = true;
    this.cdr.markForCheck();
    this.svc.runEngine()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: res => {
          this.running = false;
          this.toast.success(res?.message || 'Schedules evaluated');
          this.loadSchedules();
          this.load();
        },
        error: err => {
          this.running = false;
          this.cdr.markForCheck();
          this.toast.error(err?.error?.message || 'Could not run the schedules');
        }
      });
  }

  /* ── export ── */

  export(format: 'xlsx' | 'csv' | 'pdf'): void {
    this.exporting = format;
    this.cdr.markForCheck();

    this.svc.exportAs(format, {
      machine_id: this.selectedMachine, search: this.search, status: this.statusFilter
    })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: blob => {
          this.exporting = '';
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `periodic_maintenance_${this.todayStr()}.${format}`;
          a.click();
          // revoke on the next tick, not immediately — Safari has not
          // started reading the blob when click() returns
          setTimeout(() => URL.revokeObjectURL(url), 0);
          this.cdr.markForCheck();
        },
        error: () => {
          this.exporting = '';
          this.cdr.markForCheck();
          this.toast.error('Nothing to export for these filters');
        }
      });
  }

  /* ── view helpers ── */

  /** True when there is genuinely no plan yet, as opposed to a filter that
   *  happens to match nothing. */
  get isUnconfigured(): boolean {
    return !!this.data && this.schedules.length === 0 && (this.data.kpis?.scheduled ?? 0) === 0;
  }

  /** Compliance has no value until something has actually come due. */
  get complianceLabel(): string {
    const pct = this.data?.kpis?.compliance_pct;
    return pct === null || pct === undefined ? '--' : `${pct}%`;
  }

  frequencyLabel(f: string): string {
    return String(f || '').replace('_', '-').toLowerCase()
      .replace(/^./, c => c.toUpperCase());
  }

  dueLabel(due: string, isOverdue: boolean): string {
    if (!due) return '--';
    const d = new Date(due);
    const days = Math.round((d.getTime() - Date.now()) / 86_400_000);
    if (isOverdue) return `${Math.abs(days)}d overdue`;
    if (days === 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    return `in ${days}d`;
  }

  /* Colour reinforces the text; it is never the only cue. */
  priorityClass(p: string): string {
    switch (String(p).toUpperCase()) {
      case 'CRITICAL': return 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300';
      case 'HIGH':     return 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300';
      case 'MEDIUM':   return 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300';
      default:         return 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200';
    }
  }

  statusClass(s: string): string {
    switch (String(s).toUpperCase()) {
      case 'OPEN':        return 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300';
      case 'ASSIGNED':
      case 'IN_PROGRESS': return 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300';
      default:            return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300';
    }
  }

  private todayStr(): string {
    return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
      .toISOString().split('T')[0];
  }

  get trendChart(): any {
    return {
      chart:  { type: 'line', height: 240, toolbar: { show: false }, fontFamily: 'inherit' },
      stroke: { width: 3, curve: 'smooth' },
      colors: ['#0f766e'],
      markers: { size: 4 },
      dataLabels: { enabled: false },
      xaxis:  { categories: this.trendCategories },
      yaxis:  { min: 0, max: 100, title: { text: 'Compliance %' },
                labels: { formatter: (v: number) => v?.toFixed(0) } },
      grid:   { borderColor: 'rgba(148,163,184,.25)' },
      // a week with nothing due is a gap in the line, not a zero
      tooltip:{ theme: 'dark' },
      noData: { text: 'No completed cycles yet' }
    };
  }
}

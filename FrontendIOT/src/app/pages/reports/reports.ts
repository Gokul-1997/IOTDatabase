import {
  Component,
  OnInit,
  HostListener,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  ElementRef,
  ViewChild
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule }  from '@angular/forms';
import { ReportsService, ReportFilters, ReportType } from './reports.service';
import { AuthService } from '../../core/services/auth.service';

/* ── Column definition ── */
interface ColDef {
  key:      string;
  label:    string;
  align?:   'left' | 'center' | 'right';
  default:  boolean;   // shown by default when tab first loads
}

interface KpiCard {
  label: string;
  value: string | number;
  unit:  string;
  icon:  string;
  color: string;
}

/* ─── ALL available columns per report type ─── */
const COL_DEFS: Record<ReportType, ColDef[]> = {
  'production': [
    { key: 'machine',      label: 'Machine',       align: 'left',   default: true  },
    { key: 'operator',     label: 'Operator',      align: 'left',   default: true  },
    { key: 'shift',        label: 'Shift',         align: 'left',   default: true  },
    { key: 'hour',         label: 'Hour',          align: 'left',   default: true  },
    { key: 'run_time',     label: 'Run Time',      align: 'center', default: true  },
    { key: 'idle_time',    label: 'Idle Time',     align: 'center', default: true  },
    { key: 'setup_time',   label: 'Setup Time',    align: 'center', default: false },
    { key: 'off_time',     label: 'Off Time',      align: 'center', default: false },

    { key: 'produced_qty', label: 'Parts Made',    align: 'center', default: true  },
    { key: 'energy_kwh',   label: 'Energy (kWh)',  align: 'right',  default: true  },
  ],
  'oee-hourly': [
    { key: 'machine',      label: 'Machine',         align: 'left',   default: true },
    { key: 'operator',     label: 'Operator',         align: 'left',   default: true },
    { key: 'hour',         label: 'Hour',             align: 'left',   default: true },
    { key: 'availability', label: 'Availability %',   align: 'center', default: true },
    { key: 'performance',  label: 'Performance %',    align: 'center', default: true },
    { key: 'quality',      label: 'Quality %',        align: 'center', default: true },
    { key: 'oee',          label: 'OEE %',            align: 'center', default: true },
  ],
  'shift-oee': [
    { key: 'machine',      label: 'Machine',         align: 'left',   default: true },
    { key: 'operator',     label: 'Operator',         align: 'left',   default: true },
    { key: 'shift',        label: 'Shift',            align: 'left',   default: true },
    { key: 'date',         label: 'Date',             align: 'left',   default: true },
    { key: 'availability', label: 'Availability %',   align: 'center', default: true },
    { key: 'performance',  label: 'Performance %',    align: 'center', default: true },
    { key: 'quality',      label: 'Quality %',        align: 'center', default: true },
    { key: 'oee',          label: 'OEE %',            align: 'center', default: true },
  ]
};

@Component({
  standalone: true,
  selector: 'app-reports',
  imports: [CommonModule, FormsModule],
  templateUrl: './reports.html',
  styleUrl: './reports.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class Reports implements OnInit {

  @ViewChild('colPanel') colPanelRef?: ElementRef;
  @ViewChild('colBtn')   colBtnRef?:   ElementRef;

  /* ── tabs ── */
  tabs: { id: ReportType; label: string; icon: string }[] = [
    { id: 'production', label: 'Production', icon: '⚙️' },
    { id: 'oee-hourly', label: 'OEE Hourly', icon: '📊' },
    { id: 'shift-oee',  label: 'Shift OEE',  icon: '🔄' },
  ];
  activeTab: ReportType = 'production';

  /* ── filters ── */
  filters: ReportFilters = {
    date_from:   this.todayStr(),
    date_to:     this.todayStr(),
    machine_id:  '',
    shift_id:    '',
    operator_id: ''
  };

  machines:  any[] = [];
  shifts:    any[] = [];
  operators: any[] = [];

  /* ── column builder ── */
  colBuilderOpen  = false;
  selectedColKeys = new Set<string>();   // keys currently selected

  get allColumns(): ColDef[] { return COL_DEFS[this.activeTab]; }

  /** Columns that will actually render (in original order) */
  get activeColumns(): ColDef[] {
    return this.allColumns.filter(c => this.selectedColKeys.has(c.key));
  }

  get selectedCount(): number { return this.selectedColKeys.size; }

  /* ── data state ── */
  loading  = false;
  rows:    any[] = [];
  kpis:    KpiCard[] = [];
  summary: any = {};

  /* ── pagination ── */
  page     = 1;
  pageSize = 15;

  /* ── sort ── */
  sortCol = '';
  sortDir: 'asc' | 'desc' = 'asc';

  constructor(
    private svc: ReportsService,
    private cdr: ChangeDetectorRef,
    public  auth: AuthService
  ) {}

  ngOnInit(): void {
    this.svc.getMachines().subscribe({  next: r => { this.machines  = r.data; this.cdr.markForCheck(); } });
    this.svc.getShifts().subscribe({    next: r => { this.shifts    = r.data; this.cdr.markForCheck(); } });
    this.loadOperators();
    this.resetColSelection();
    this.loadReport();
  }

  loadOperators(machine_id?: string): void {
    this.svc.getOperators(machine_id).subscribe({
      next: r => { this.operators = r.data; this.cdr.markForCheck(); }
    });
  }

  onMachineChange(): void {
    this.filters.operator_id = '';
    this.loadOperators(this.filters.machine_id || undefined);
  }

  /* ── tab switch ── */
  setTab(tab: ReportType): void {
    this.activeTab = tab;
    this.page      = 1;
    this.sortCol   = '';
    this.colBuilderOpen = false;
    this.resetColSelection();
    this.loadReport();
  }

  /* ── column builder ── */
  toggleColBuilder(): void { this.colBuilderOpen = !this.colBuilderOpen; }

  toggleCol(key: string): void {
    this.selectedColKeys.has(key)
      ? this.selectedColKeys.delete(key)
      : this.selectedColKeys.add(key);
    // force OnPush to see the Set mutation
    this.selectedColKeys = new Set(this.selectedColKeys);
  }

  selectAllCols(): void  { this.selectedColKeys = new Set(this.allColumns.map(c => c.key)); }
  clearAllCols(): void   { this.selectedColKeys = new Set(); }

  resetColSelection(): void {
    this.selectedColKeys = new Set(COL_DEFS[this.activeTab].filter(c => c.default).map(c => c.key));
  }

  /** Returns the name of an item by id from a dropdown list */
  labelOf(list: { id: any; name: string }[], id: string): string {
    return list.find(x => String(x.id) === String(id))?.name ?? id;
  }

  /** Close column panel when clicking outside */
  @HostListener('document:click', ['$event'])
  onDocClick(e: MouseEvent): void {
    if (!this.colBuilderOpen) return;
    const panel = this.colPanelRef?.nativeElement;
    const btn   = this.colBtnRef?.nativeElement;
    if (panel && !panel.contains(e.target) && btn && !btn.contains(e.target)) {
      this.colBuilderOpen = false;
      this.cdr.markForCheck();
    }
  }

  /* ── filters ── */
  applyFilters(): void { this.page = 1; this.loadReport(); }

  resetFilters(): void {
    this.filters = {
      date_from: this.todayStr(), date_to: this.todayStr(),
      machine_id: '', shift_id: '', operator_id: ''
    };
    this.page = 1;
    this.loadOperators();
    this.loadReport();
  }

  /* ── load data ── */
  loadReport(): void {
    this.loading = true;
    this.rows    = [];
    this.kpis    = [];
    this.cdr.markForCheck();

    const obs$ =
      this.activeTab === 'production' ? this.svc.getProductionData(this.filters) :
      this.activeTab === 'oee-hourly' ? this.svc.getOeeHourlyData(this.filters)  :
                                        this.svc.getShiftOeeData(this.filters);

    obs$.subscribe({
      next: (res: any) => {
        this.rows    = res.data.rows    || [];
        this.summary = res.data.summary || {};
        this.kpis    = this.buildKpis(this.activeTab, this.summary);
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => { this.loading = false; this.cdr.markForCheck(); }
    });
  }

  /* ── sort ── */
  sort(col: string): void {
    if (this.sortCol === col) {
      this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortCol = col;
      this.sortDir = 'asc';
    }
    this.page = 1;
  }

  get sortedRows(): any[] {
    if (!this.sortCol) return this.rows;
    return [...this.rows].sort((a, b) => {
      const av = a[this.sortCol] ?? '';
      const bv = b[this.sortCol] ?? '';
      const cmp = isNaN(Number(av)) ? String(av).localeCompare(String(bv)) : Number(av) - Number(bv);
      return this.sortDir === 'asc' ? cmp : -cmp;
    });
  }

  get pagedRows(): any[] {
    const start = (this.page - 1) * this.pageSize;
    return this.sortedRows.slice(start, start + this.pageSize);
  }

  get totalPages(): number { return Math.ceil(this.rows.length / this.pageSize); }

  get pageNumbers(): number[] {
    const t = this.totalPages;
    if (t <= 7) return Array.from({ length: t }, (_, i) => i + 1);
    if (this.page <= 4)      return [1, 2, 3, 4, 5, -1, t];
    if (this.page >= t - 3)  return [1, -1, t - 4, t - 3, t - 2, t - 1, t];
    return [1, -1, this.page - 1, this.page, this.page + 1, -1, t];
  }

  /* ── OEE colour ── */
  isOeeCol(key: string): boolean {
    return ['availability', 'performance', 'quality', 'oee'].includes(key);
  }

  oeeColor(val: number): string {
    if (val >= 85) return 'text-green-600 font-semibold';
    if (val >= 60) return 'text-yellow-600 font-semibold';
    return 'text-red-500 font-semibold';
  }

  /* ── export ── */
  exportCsv(): void {
    const filename = `${this.activeTab}_${this.filters.date_from}_to_${this.filters.date_to}.csv`;
    this.svc.exportCsv(filename, this.activeColumns, this.sortedRows);
  }

  downloadFullExcel(): void {
    this.svc.downloadExcel(this.activeTab, this.filters.date_from);
  }

  /* ── KPI cards ── */
  private buildKpis(tab: ReportType, s: any): KpiCard[] {
    if (tab === 'production') return [
      { label: 'Total Parts',  value: s.total_parts    ?? 0,   unit: 'pcs', icon: '🔩', color: 'blue'   },
      { label: 'Run Hours',    value: s.run_hours       ?? '0', unit: 'hrs', icon: '▶️', color: 'green'  },
      { label: 'Total Energy', value: s.total_energy    ?? '0', unit: 'kWh', icon: '⚡', color: 'yellow' },
      { label: 'Efficiency',   value: s.efficiency_pct  ?? '0', unit: '%',   icon: '📈', color: 'purple' },
    ];
    return [
      { label: 'Avg Availability', value: s.avg_availability ?? '0', unit: '%', icon: '🕐', color: 'blue'   },
      { label: 'Avg Performance',  value: s.avg_performance  ?? '0', unit: '%', icon: '⚡', color: 'green'  },
      { label: 'Avg Quality',      value: s.avg_quality      ?? '0', unit: '%', icon: '✅', color: 'yellow' },
      { label: 'Avg OEE',          value: s.avg_oee          ?? '0', unit: '%', icon: '📊', color: 'purple' },
    ];
  }

  kpiColorClass(c: string): string {
    return ({ blue: 'bg-blue-200 border-blue-200', green: 'bg-green-200 border-green-200',
              yellow: 'bg-amber-100 border-amber-100', purple: 'bg-purple-200 border-purple-200' } as any)[c]
      || 'bg-gray-200 border-gray-200';
  }

  kpiTextClass(c: string): string {
    return ({ blue: 'text-blue-700', green: 'text-green-700',
              yellow: 'text-amber-700', purple: 'text-purple-700' } as any)[c]
      || 'text-gray-700';
  }

  /* ── helpers ── */
  minOf(a: number, b: number): number { return Math.min(a, b); }

  private todayStr(): string {
    const d = new Date();
    return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
  }

  nowDisplay(): string {
    return new Date().toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: true
    });
  }
}

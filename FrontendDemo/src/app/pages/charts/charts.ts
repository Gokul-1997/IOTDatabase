import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgApexchartsModule } from 'ng-apexcharts';
import { ChartsService } from './charts.service';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-charts',
  standalone: true,
  imports: [CommonModule, FormsModule, NgApexchartsModule],
  templateUrl: './charts.html',
  styleUrl: './charts.scss'
})
export class Charts implements OnInit, OnDestroy {

  // ── Filters ───────────────────────────────────────────────
  machines: any[] = [];
  shifts:   any[] = [];

  selectedMachine: number | null = null;
  selectedShift:   number | null = null;
  selectedDate = new Date().toISOString().split('T')[0];
  today        = new Date().toISOString().split('T')[0];

  totalProduced  = 0;
  totalRunMin    = 0;
  totalIdleMin   = 0;
  loadingParts   = false;
  loadingHourly  = false;

  partDataLoaded   = false;
  hourlyDataLoaded = false;

  // ── Per-Part Timing (stacked bar) ─────────────────────────
  partSeries:   any[] = [];
  partCategories: string[] = [];
  partChartWidth = '100%';

  // ── Hourly Count (line/bar chart) ─────────────────────────
  hourlySeries:     any[] = [];
  hourlyCategories: string[] = [];

  private readonly MIN_BAR_PX = 24;
  private themeObserver!: MutationObserver;

  partChartOptions:   any = {};
  hourlyChartOptions: any = {};

  private get isDark(): boolean {
    return document.documentElement.classList.contains('dark');
  }

  private buildChartOptions(): void {
    const dark = this.isDark;
    const bg        = dark ? '#1f2937' : '#ffffff';
    const textColor = dark ? '#d1d5db' : '#374151';
    const gridColor = dark ? '#374151' : '#e9ecef';

    
    this.partChartOptions = {
      chart: { type: 'bar', height: 370, stacked: true, toolbar: { show: true },
               background: bg },
      plotOptions: { bar: { horizontal: false, columnWidth: '55%', borderRadius: 4 } },
      dataLabels: {
        enabled: true,
        formatter: (val: number) => val > 0 ? `${val}m` : '',
        style: { fontSize: '11px', colors: ['#fff'] }
      },
      yaxis:  { title: { text: 'Time (minutes)', style: { color: textColor } }, min: 0,
                labels: { style: { colors: textColor } } },
      xaxis:  { labels: { style: { colors: textColor } } },
      legend: { position: 'top', labels: { colors: textColor } },
      fill:   { opacity: 1 },
      colors: ['#51cf66', '#ff6b6b'],
      grid:   { borderColor: gridColor },
      theme:  { mode: dark ? 'dark' : 'light' },
      tooltip: {
        shared: true, intersect: false, theme: dark ? 'dark' : 'light',
        y: {
          formatter: (val: number) => {
            const totalSec = Math.round(val * 60);
            const m = Math.floor(totalSec / 60);
            const s = totalSec % 60;
            return `${m} min ${s} sec`;
          }
        }
      }
    };

    this.hourlyChartOptions = {
      chart: {
        type: 'line', height: 350, toolbar: { show: false }, zoom: { enabled: false },
        background: bg,
        dropShadow: { enabled: true, color: '#000', top: 18, left: 7, blur: 10, opacity: 0.15 }
      },
      colors:     ['#3b5bdb'],
      dataLabels: { enabled: true, formatter: (val: number) => val > 0 ? String(val) : '' },
      stroke:     { curve: 'smooth', width: 3 },
      grid:       { borderColor: gridColor },
      markers:    { size: 5 },
      yaxis:      { min: 0, title: { text: 'Parts Count', style: { color: textColor } },
                    labels: { style: { colors: textColor } } },
      xaxis:      { labels: { style: { colors: textColor } } },
      legend:     { position: 'bottom', labels: { colors: textColor } },
      theme:      { mode: dark ? 'dark' : 'light' },
      tooltip:    { theme: dark ? 'dark' : 'light', y: { formatter: (val: number) => `${val} pcs` } }
    };
  }

  constructor(
    private service: ChartsService,
    private cdr:     ChangeDetectorRef,
    public  auth:    AuthService
  ) {}

  ngOnInit() {
    this.buildChartOptions();

    // Re-build chart options whenever dark class toggles on <html>
    this.themeObserver = new MutationObserver(() => {
      this.buildChartOptions();
      this.cdr.detectChanges();
    });
    this.themeObserver.observe(document.documentElement, {
      attributes: true, attributeFilter: ['class']
    });

    this.service.getMeta().subscribe({
      next: res => {
        this.machines = res.data.machines;
        this.shifts   = res.data.shifts;
        if (this.machines.length) this.selectedMachine = this.machines[0].id;
        if (this.shifts.length)   this.selectedShift   = this.shifts[0].id;
        this.cdr.detectChanges();
        this.loadAll();
      }
    });
  }

  submit() { this.loadAll(); }

  loadAll() {
    // Load hourly first to get authoritative totalProduced, then cap parts to that count
    this.loadHourlyChart(() => this.loadPartChart(this.totalProduced));
  }

  // ── Per-part timing ────────────────────────────────────────
  loadPartChart(maxParts?: number) {
    if (!this.selectedMachine) return;
    this.loadingParts = true;

    this.service.getPartTiming(this.selectedMachine, this.buildShiftStartEpoch(), this.buildShiftEndEpoch(), maxParts).subscribe({
      next: res => {
        const rows: any[] = res.data || [];
        this.totalRunMin  = res.totalRunMin  ?? 0;
        this.totalIdleMin = res.totalIdleMin ?? 0;
        this.partSeries = [
          { name: 'Running', data: rows.map((r: any) => r.run_min)  },
          { name: 'Idle',    data: rows.map((r: any) => r.idle_min) }
        ];
        this.partCategories  = rows.map((r: any) => `Part ${r.part_no}`);
        const needed = rows.length * this.MIN_BAR_PX;
        this.partChartWidth  = needed > window.innerWidth ? `${needed}px` : '100%';
        this.loadingParts    = false;
        this.partDataLoaded  = true;
        this.cdr.detectChanges();
      },
      error: () => {
        this.loadingParts = false;
        this.cdr.detectChanges();
      }
    });
  }

  buildShiftStartEpoch(): number {
    const shift = this.shifts.find(s => s.id === this.selectedShift);
    if (shift) {
      // Use the selected shift's exact start time in IST
      const dt = new Date(`${this.selectedDate}T${shift.start_time}+05:30`);
      return Math.floor(dt.getTime() / 1000);
    }
    // No shift selected: use the earliest shift start of the day (in IST),
    // so night-shift carry-over from the previous day is excluded.
    if (this.shifts.length) {
      const earliest = this.shifts.reduce((min: any, s: any) => {
        const ep = Math.floor(new Date(`${this.selectedDate}T${s.start_time}+05:30`).getTime() / 1000);
        return ep < min ? ep : min;
      }, Infinity);
      return earliest;
    }
    // Fallback: midnight IST of selected date
    return Math.floor(new Date(`${this.selectedDate}T00:00:00+05:30`).getTime() / 1000);
  }

  buildShiftEndEpoch(): number | undefined {
    const shift = this.shifts.find(s => s.id === this.selectedShift);
    if (!shift) return undefined;
    // For overnight shifts (start > end), end is on the next day
    const isOvernight = shift.start_time > shift.end_time;
    const endDate = isOvernight
      ? this.addDays(this.selectedDate, 1)
      : this.selectedDate;
    return Math.floor(new Date(`${endDate}T${shift.end_time}+05:30`).getTime() / 1000);
  }

  private addDays(dateStr: string, days: number): string {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(y, m - 1, d + days);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  }

  // ── Hourly count ───────────────────────────────────────────
  loadHourlyChart(onComplete?: () => void) {
    const params: any = { date: this.selectedDate };
    if (this.selectedMachine) params.machine_id = this.selectedMachine;
    if (this.selectedShift)   params.shift_id   = this.selectedShift;

    this.loadingHourly = true;
    this.service.getChartData(params).subscribe({
      next: res => {
        const rows: any[] = res.data.hourlyCount || [];
        this.totalProduced   = res.data.totalProduced;
        this.hourlySeries    = [{ name: 'Produced', data: rows.map((r: any) => r.produced) }];
        this.hourlyCategories = rows.map((r: any) => r.hour);
        this.loadingHourly   = false;
        this.hourlyDataLoaded = true;
        this.cdr.detectChanges();
        onComplete?.();
      },
      error: () => {
        this.loadingHourly = false;
        this.cdr.detectChanges();
        onComplete?.();
      }
    });
  }

  ngOnDestroy(): void {
    this.themeObserver?.disconnect();
  }
}

import {
  Component,
  OnInit,
  OnDestroy,
  NgZone,
  ChangeDetectorRef,
  ChangeDetectionStrategy
} from '@angular/core';

import { ActivatedRoute, RouterModule } from '@angular/router';
import { NgApexchartsModule } from 'ng-apexcharts';
import { DashboardService } from '../dashboard.service';
import { SocketService } from '../../../core/services/socket.service';
import { AuthService } from '../../../core/services/auth.service';
import {
  Subject,
  interval,
  switchMap,
  startWith,
  takeUntil
} from 'rxjs';
import { CommonModule } from '@angular/common';

/* ─────────────────────────────────────────
   SOCKET  → machine_status, rpm, feed_rate ONLY
             instant live needle updates

   API 30s → run_time, idle_time, utilization,
             achieved_qty, target_qty, oee,
             quality, production data
───────────────────────────────────────── */

const POLL_MS = 30_000;

/* Gauge max values */
const SPINDLE_MAX  = 100;    // spindle load is 0–100 %
const FEED_MAX     = 30000;  // max feed rate (mm/min) — set to match your machine spec

@Component({
  standalone: true,
  selector: 'app-live',
  imports: [NgApexchartsModule, CommonModule, RouterModule],
  templateUrl: './live.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LiveComponent implements OnInit, OnDestroy {

  private destroy$ = new Subject<void>();

  machineId!: number;

  /* ── Gauge scale constants (exposed for template) ── */
  readonly SPINDLE_MAX = SPINDLE_MAX;
  readonly FEED_MAX    = FEED_MAX;

  /* ── API-owned state ── */
  machine:    any = {};
  operator:   any = {};
  job:        any = {};
  oee:        any = {};
  shift:      any = {};
  quality:    any = {};
  power:      any = {};
  production: any = {};

  runTime   = '00:00:00';
  idleTime  = '00:00:00';
  utilization = 0;

  /* ── Socket-owned state ── */
  liveStatus       = 'UNKNOWN';
  liveMode         = '';
  liveSpindleLoad  = 0;
  liveFeed         = 0;
  livePartCount    = 0;


  /* ── UI helpers ── */
  currentDate      = new Date();
  currentTime      = '';
  currentDateStr   = '';
  socketHasUpdated = false;   // true after first socket message for this machine
  private clockInterval: any;

  /* ── Chart series ── */
  utilSeries:    number[] = [0];
  oeeSeries:     number[] = [0];
  spindleSeries: number[] = [0];
  feedSeries:    number[] = [0];
  timePieSeries: number[] = [0, 0];

  /* ── Chart configs ── */
  utilChart:    any;
  oeeChart:     any;
  spindleChart: any;
  feedChart:    any;
  timePieChart: any;

  constructor(
    private route:            ActivatedRoute,
    private dashboardService: DashboardService,
    private socketService:    SocketService,
    private zone:             NgZone,
    private cdr:              ChangeDetectorRef,
    public  auth:             AuthService
  ) {}

  /* ════════════════════════════════════════
     INIT
  ════════════════════════════════════════ */
  async ngOnInit(): Promise<void> {

    const id      = this.route.snapshot.paramMap.get('id');
    this.machineId = Number(id);

    this.initCharts();

    /* ── Connect socket first, then join plant room ──
       Must await connect() before joinPlant() —
       otherwise socket is not ready and join is silently ignored */
    // console.log('[SOCKET] connecting...');
    await this.socketService.connect();
    // console.log('[SOCKET] connected ✅');

    const user    = JSON.parse(localStorage.getItem('user') || '{}');
    const plantId = user?.plant_id;
    if (plantId) {
      this.socketService.joinPlant(plantId);
      // console.log(`[SOCKET] joined plant room: plant:${plantId}`);
    } else {
      console.warn('[SOCKET] ⚠ no plant_id in localStorage — cannot join room');
    }

    // console.log(`[SOCKET] listening for machine_id: ${this.machineId}`);

    /* ── 30s API poll ── */
    interval(POLL_MS)
      .pipe(
        startWith(0),
        switchMap(() => this.dashboardService.getMachineDetail(this.machineId)),
        takeUntil(this.destroy$)
      )
      .subscribe((res: any) => this.applyApiData(res));

    /* ── Socket → status + rpm + feed ONLY ── */
    this.socketService.onMachineUpdate((data: any) => {
      this.handleSocket(data);
    });

    /* ── Live clock (IST) ── */
    const tick = () => {
      const now = new Date();
      this.currentTime = now.toLocaleTimeString('en-IN', {
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: true, timeZone: 'Asia/Kolkata'
      });
      this.currentDateStr = now.toLocaleDateString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric',
        timeZone: 'Asia/Kolkata'
      });
      this.cdr.markForCheck();
    };
    tick();
    this.clockInterval = setInterval(tick, 1000);
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.socketService.offMachineUpdate();
    clearInterval(this.clockInterval);
  }

  /* ════════════════════════════════════════
     API DATA
     ✅ Owns: run_time, idle_time, utilization,
              achieved_qty, target, oee, quality,
              production, operator, job
     ❌ Never touches: liveStatus, liveRPM, liveFeed
  ════════════════════════════════════════ */
  private applyApiData(res: any): void {

    const d = res?.data;
    if (!d) return;

    this.machine    = d.machine    || this.machine;
    this.operator   = d.operator  || this.operator;
    this.job        = d.job       || this.job;
    this.oee        = d.oee       || this.oee;
    this.shift      = d.shift     || this.shift;
    this.quality    = d.quality   || this.quality;
    this.power      = d.power     || this.power;
    this.production = d.production || this.production;

    /* Metric fields — API is source of truth */
    if (d.production) {
      this.runTime  = d.production.run_time  || this.runTime;
      this.idleTime = d.production.idle_time || this.idleTime;
    }

    /* Utilization: achieved/target × 100, capped at 100 */
    const target   = d.job?.target_qty   || 0;
    const achieved = d.job?.achieved_qty || 0;
    this.utilization = target > 0
      ? Math.min(Number(((achieved * 100) / target).toFixed(2)), 100)
      : 0;

    /* Seed live values from API.
       status/rpm/feed: socket owns after first message (instant updates).
       livePartCount:   API owns ALWAYS — socket sends raw counter which
                        doesn't include reset offsets, so would show wrong
                        values (e.g. 29 instead of 59 after a mid-shift reset).
                        30s API refresh is accurate enough for a part counter. */
    if (d.live) {
      if (!this.socketHasUpdated) {
        this.liveStatus      = d.live.machine_status || 'UNKNOWN';
        this.liveMode        = d.live.mode           || '';
        this.liveSpindleLoad = Number(d.live.spindle_load || 0);
        this.liveFeed        = Number(d.live.feed_rate    || 0);
        this.spindleSeries   = [this.spindleLoadToPercent(this.liveSpindleLoad)];
        this.feedSeries      = [this.feedToPercent(this.liveFeed)];
      }

      // Always update from API — adjusted for mid-shift counter resets
      this.livePartCount = Number(d.live.parts_count || 0);
    }

    /* Update chart series */
    this.utilSeries = [this.utilization];
    this.oeeSeries  = [Math.min(Number(this.oee?.oee || 0), 100)];

    this.updateTimePie();
    this.currentDate = new Date();

    this.cdr.markForCheck();
  }

  /* ════════════════════════════════════════
     SOCKET → machine_status, rpm, feed_rate,
              parts_count (achieved_qty)
     ❌ run_time    → NOT touched (API owns)
     ❌ idle_time   → NOT touched (API owns)
     ❌ utilization → NOT touched (API owns)
  ════════════════════════════════════════ */
  handleSocket(data: any): void {

    // console.log('[SOCKET] raw message received:', data);

    /* Ensure Number comparison — socket payload may send id as string */
    if (Number(data.machine_id) !== this.machineId) {
      // console.log(`[SOCKET] ignored — machine_id ${data.machine_id} !== current ${this.machineId}`);
      return;
    }

    // console.log(`[SOCKET] ✅ matched machine ${this.machineId} — applying:`, {
    //   status:      data.machine_status,
    //   rpm:         data.rpm,
    //   feed_rate:   data.feed_rate,
    //   parts_count: data.parts_count,
    //   alarm:       data.alarm
    // });

    this.zone.run(() => {

      /* Mark that socket is now active for this machine —
         API will no longer seed live values after this point */
      this.socketHasUpdated = true;

      /* ── Status + Mode ── */
      if (data.machine_status !== undefined) {
        this.liveStatus = data.machine_status;
      }
      if (data.mode !== undefined) {
        this.liveMode = data.mode || '';
      }

      /* ── Spindle Load → gauge percent ── */
      if (data.spindle_load !== undefined) {
        this.liveSpindleLoad = Number(data.spindle_load);
        this.spindleSeries   = [this.spindleLoadToPercent(this.liveSpindleLoad)];
      }

      /* ── Feed rate → gauge percent ── */
      if (data.feed_rate !== undefined) {
        this.liveFeed   = Number(data.feed_rate);
        this.feedSeries = [this.feedToPercent(this.liveFeed)];
      }

      /* ── Energy → update total_kwh in real-time ── */
      if (data.energy != null) {
        this.power = {
          ...this.power,
          total_kwh: Number(Number(data.energy).toFixed(3))
        };
      }

      /* ── parts_count: API owns this (reset-adjusted) — socket skips ── */

      this.currentDate = new Date();
      this.cdr.markForCheck();

      // console.log('[SOCKET] cdr.markForCheck() called — UI should update');
    });
  }

  /* ════════════════════════════════════════
     GAUGE HELPERS
     Convert raw values to 0–100% for ApexCharts
     radialBar, while keeping true value for display
  ════════════════════════════════════════ */

  /** Spindle load is already 0–100 % — clamp to valid gauge range */
  private spindleLoadToPercent(load: number): number {
    return Math.min(Math.max(Number(load.toFixed(1)), 0), 100);
  }

  /** Feed rate → 0–100% of arc (scale is 0–150% of FEED_MAX).
   *  FEED_MAX = 100% of nominal feed = 66.7% of arc. */
  private feedToPercent(feed: number): number {
    return Math.min(Number(((feed / (FEED_MAX * 1.5)) * 100).toFixed(1)), 99.9);
  }

  /* ════════════════════════════════════════
     PURE-SVG GAUGE HELPERS
     ViewBox "0 0 300 170", center (150,155), r=118
     Half-circle: 0% = left (180°), 100% = right (0°)
  ════════════════════════════════════════ */
  readonly GCX = 150;
  readonly GCY = 155;
  readonly GR  = 118;

  /** Feed override: 0–150% scale labels mapped to 0–100% arc positions */
  readonly feedTicks = [
    { pct:  0,    label: '0'    , red: false },
    { pct: 16.7,  label: '25%'  , red: false },
    { pct: 33.3,  label: '50%'  , red: false },
    { pct: 50.0,  label: '75%'  , red: false },
    { pct: 66.7,  label: '100%' , red: true  },
    { pct: 83.3,  label: '125%' , red: false },
    { pct: 100,   label: '150%' , red: false },
  ];

  private _gaugeAngle(pct: number): number {
    return (180 - Math.max(0, Math.min(pct, 100)) * 1.8) * (Math.PI / 180);
  }

  /** Full background half-arc */
  get bgArc(): string {
    const { GCX: cx, GCY: cy, GR: r } = this;
    return `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
  }

  /** Foreground arc 0% → valuePct. Capped at 99.9 to avoid degenerate semicircle. */
  gaugeArc(valuePct: number): string {
    const pct = Math.max(0, Math.min(valuePct, 99.9));
    if (pct <= 0) return '';
    const { GCX: cx, GCY: cy, GR: r } = this;
    const rad = this._gaugeAngle(pct);
    const ex  = cx + r * Math.cos(rad);
    const ey  = cy - r * Math.sin(rad);
    return `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${ex.toFixed(1)} ${ey.toFixed(1)}`;
  }

  /** Needle tip coords (80% of arc radius) */
  gaugeNeedle(valuePct: number): { x1: number; y1: number; x2: number; y2: number } {
    const { GCX: cx, GCY: cy, GR: r } = this;
    const rad = this._gaugeAngle(Math.max(0, Math.min(valuePct, 100)));
    const len = r * 0.82;
    return {
      x1: cx, y1: cy,
      x2: parseFloat((cx + len * Math.cos(rad)).toFixed(1)),
      y2: parseFloat((cy - len * Math.sin(rad)).toFixed(1))
    };
  }

  /** Point on the arc edge at given pct (for exact marker lines) */
  gaugeArcPt(pct: number): { x: number; y: number } {
    const { GCX: cx, GCY: cy, GR: r } = this;
    const rad = this._gaugeAngle(Math.max(0, Math.min(pct, 100)));
    return {
      x: parseFloat((cx + r * Math.cos(rad)).toFixed(1)),
      y: parseFloat((cy - r * Math.sin(rad)).toFixed(1))
    };
  }

  /** Label position outside arc (default offset=20 px beyond arc edge) */
  gaugeLabel(pct: number, offset = 32): { x: number; y: number } {
    
    const { GCX: cx, GCY: cy, GR: r } = this;
    const rad = this._gaugeAngle(pct);
    const lr  = r + offset;
    return {
      x: parseFloat((cx + lr * Math.cos(rad)).toFixed(1)),
      y: parseFloat((cy - lr * Math.sin(rad)).toFixed(1))
    };
  }

  /* ════════════════════════════════════════
     TIME PIE
  ════════════════════════════════════════ */
  private updateTimePie(): void {

    const r     = this.timeToSec(this.runTime);
    const i     = this.timeToSec(this.idleTime);
    const total = r + i;

    if (total === 0) {
      this.timePieSeries = [0, 100];
      return;
    }

    this.timePieSeries = [
      Number(((r / total) * 100).toFixed(1)),
      Number(((i / total) * 100).toFixed(1))
    ];
  }

  private timeToSec(t: string): number {
    if (!t) return 0;
    const p = t.split(':').map(Number);
    return p[0] * 3600 + p[1] * 60 + (p[2] || 0);
  }

  /** "HH:MM:SS" → "06h 07m 00s" */
  formatDuration(t: string): string {
    if (!t) return '00h 00m 00s';
    const p = t.split(':').map(Number);
    const h = p[0] || 0;
    const m = p[1] || 0;
    const s = p[2] || 0;
    return `${String(h).padStart(2,'0')}h ${String(m).padStart(2,'0')}m ${String(s).padStart(2,'0')}s`;
  }

  get setupTime(): string {
    // Primary: MANUAL-mode seconds accumulated this shift (from production_hourly)
    const manualSec = Number((this.production as any)?.manual_seconds || 0);
    if (manualSec > 0) {
      return this.formatDuration(String(manualSec));
    }
    // Fallback: setting_time_start/end from job
    const start = this.job?.setting_time_start;
    const end   = this.job?.setting_time_end;
    if (start && end) {
      const diffMs = new Date(end).getTime() - new Date(start).getTime();
      if (diffMs > 0) {
        const totalSec = Math.floor(diffMs / 1000);
        return this.formatDuration(
          `${String(Math.floor(totalSec/3600)).padStart(2,'0')}:` +
          `${String(Math.floor((totalSec%3600)/60)).padStart(2,'0')}:` +
          `${String(totalSec%60).padStart(2,'0')}`
        );
      }
    }
    return '--';
  }

  /* ════════════════════════════════════════
     CHART INIT
     Enterprise speedometer style:
     • Utilization / OEE  → full radialBar (–135° to 135°)
     • Spindle / Feed     → half-arc gauge (–90° to 90°)
       with colour zones: green → amber → red
  ════════════════════════════════════════ */
  private initCharts(): void {

    /* ── Utilization ── */
    this.utilChart = {
      chart: { type: 'radialBar', height: 180},
      plotOptions: {
        radialBar: {
          startAngle: -135,
          endAngle:    135,
          hollow: { size: '58%' },
          track: { background: '#e8eaf0', strokeWidth: '97%' },
          dataLabels: {
            name: {
              show: true,
              offsetY: 18,
              fontSize: '11px',
              color: '#6b7280',
              fontFamily: 'inherit'
            },
            value: {
              show: true,
              offsetY: -15,
              fontSize: '24px',
              fontWeight: '700',
              color: '#3B4CCA',
              fontFamily: 'inherit',
              formatter: (val: number) => val + '%'
            }
          }
        }
      },
      colors: ['#3B4CCA'],
      fill: {
        type: 'gradient',
        gradient: {
          shade: 'dark', type: 'horizontal',
          gradientToColors: ['#9B3F70'], stops: [0, 100]
        }
      }
    };

    /* ── OEE — dashed-segment radialBar ── */
    this.oeeChart = {
      chart: { type: 'radialBar', height: 250, sparkline: { enabled: true } },
      labels: ['OEE'],
      plotOptions: {
        radialBar: {
          startAngle: -135,
          endAngle:    135,
          hollow: { size: '42%' },
          track: {
            show: true,
            background: '#E0E0E0', // background: isDark ? '#1f2937' : '#e5e7eb',
            strokeWidth: '100%',
            opacity: 0.5,
            margin: 0
          },
          dataLabels: {
            name:  { show: false },
            value: { show: false }   // value overlaid via HTML
          }
        }
      },
      dataLabels: { enabled: false },
      fill:   { type: 'solid', colors: ['#3B4CCA'] },
      stroke: { dashArray: 4 }
    };

    // const isDark = document.body.classList.contains('dark');
    
    /* ── Time Pie ── */
    this.timePieChart = {
  chart: { type: 'pie', height: 180 },
  labels: ['Running', 'Idle'],
  colors: ['#0CAD5D', '#dfb400'],
  legend: { show: false },
  stroke: { width: 1 },
  dataLabels: {
    minAngleToShowLabel: 15,
    formatter: (v: any) => `${v.toFixed(1)}%`,
    offset: -25,
    style: {
      fontSize: '14px',
      fontWeight: 600,
      colors: ['#fff'],

    }
  }
};
  }
}
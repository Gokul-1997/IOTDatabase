import {
  Component,
  OnInit,
  OnDestroy,
  NgZone,
  ChangeDetectorRef,
  ChangeDetectionStrategy
} from '@angular/core';

import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { DashboardService } from './dashboard.service';
import { SocketService } from '../../core/services/socket.service';
import { AuthService } from '../../core/services/auth.service';
import {
  Subject,
  interval,
  switchMap,
  startWith,
  takeUntil
} from 'rxjs';

/* ─────────────────────────────────────────
   SOCKET  → status (RUNNING / IDLE / OFFLINE)
             + alarm ONLY
             instant visual feedback, no calc

   API 30s → run_time, idle_time,
             utilization, achieved_qty,
             operator, part_name, target_qty
             smooth field-level patch only
───────────────────────────────────────── */

const POLL_MS               = 30_000;
const OFFLINE_THRESHOLD_SEC = 60;   // 60s — tolerate brief network gaps in industrial environments
const STALE_THRESHOLD_SEC   = 60;   // staleness sweep threshold — matches OFFLINE_THRESHOLD_SEC
const ONLINE_CONFIRM_MS     = 5_000; // require 5s of continuous data before exiting OFFLINE
const PAGE_SIZE             = 6;
const AUTO_PAGE_MS          = 10_000;

@Component({
  standalone: true,
  selector: 'app-dashboard',
  imports: [CommonModule],
  templateUrl: './dashboard.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DashboardComponent implements OnInit, OnDestroy {

  /* ── public state ── */
  machines: any[] = [];
  summary:  any   = {};
  shift:    any   = {};
  currentTime    = '';
  currentDateStr = '';

  /* ── pagination ── */
  currentPage = 1;
  readonly pageSize = PAGE_SIZE;

  /* ── status filter ── */
  statusFilter: 'all' | 'running' | 'idle' | 'alarm' = 'all';

  /* ── private ── */
  private destroy$         = new Subject<void>();
  private clockInterval:   any;
  private autoPageTimer:   any;
  private staleCheckTimer: any;
  private machineMap       = new Map<number, any>();
  private updateQueue:     any[]  = [];
  private updateScheduled         = false;
  // machine_id → wall-clock ms when machine first sent data after being OFFLINE
  private pendingOnlineMs  = new Map<number, number>();

  private visibilityHandler = () => {
    if (document.hidden) {
      this.socketService.pauseUpdates();
    } else {
      this.socketService.resumeUpdates();
      this.fetchMetrics(); // immediate re-fetch on tab restore
    }
  };

  constructor(
    private service:       DashboardService,
    private socketService: SocketService,
    private zone:          NgZone,
    private cdr:           ChangeDetectorRef,
    private router:        Router,
    public  auth:          AuthService
  ) {}

  /* ════════════════════════════════════════
     INIT
  ════════════════════════════════════════ */
  async ngOnInit(): Promise<void> {

    const user    = JSON.parse(localStorage.getItem('user') || '{}');
    const plantId = user?.plant_id;

    await this.socketService.connect();

    if (plantId) {
      this.socketService.joinPlant(plantId);
    }

    /* ── 30s API poll ──────────────────────
       startWith(0) → fires instantly on init
       switchMap    → cancels stale request
    ──────────────────────────────────────── */
    interval(POLL_MS)
      .pipe(
        startWith(0),
        switchMap(() => this.service.getLive()),
        takeUntil(this.destroy$)
      )
      .subscribe((res: any) => this.applyApiResponse(res));

    /* ── Socket → status + alarm ONLY ─── */
    this.socketService.onMachineUpdate((data: any) => {
      this.handleSocketUpdate(data);
    });

    document.addEventListener('visibilitychange', this.visibilityHandler);

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

    /* ── Auto page advance every 10s ── */
    this.startAutoPageTimer();

    /* ── Staleness sweep every 3s ──────────────────────────
       Catches machines that stop sending data without a final
       socket event (e.g. network drop, power off). Marks them
       OFFLINE when received_at is older than STALE_THRESHOLD_SEC.
    ──────────────────────────────────────────────────────── */
    this.staleCheckTimer = setInterval(() => {
      this.zone.run(() => this.checkStaleStatus());
    }, 3_000);
  }

  /* ════════════════════════════════════════
     API RESPONSE
     ✅ Owns: run_time, idle_time, utilization,
              achieved_qty, target_qty,
              operator_name, part_name
     ❌ Never touches: status, alarm
  ════════════════════════════════════════ */
  private applyApiResponse(res: any): void {

    const incoming: any[] = res.machines || [];
    this.shift = res.shift || this.shift;

    /* First load — set everything directly */
    if (this.machines.length === 0) {
      this.machines = incoming;
      this.summary  = res.summary || {};
      this.machineMap.clear();
      for (const m of this.machines) {
        this.machineMap.set(m.machine_id, m);
      }
      this.cdr.markForCheck();
      return;
    }

    /* Subsequent polls — patch metric fields only */
    for (const fresh of incoming) {
      const existing = this.machineMap.get(fresh.machine_id);
      if (!existing) {
        this.machines.push(fresh);
        this.machineMap.set(fresh.machine_id, fresh);
        continue;
      }
      this.patchMetrics(existing, fresh);
    }

    // Remove machines that no longer exist
    const freshIds = new Set(incoming.map((m: any) => m.machine_id));
    this.machines  = this.machines.filter(m => freshIds.has(m.machine_id));

    this.summary = res.summary || this.summary;
    this.cdr.markForCheck();
  }

  /**
   * Patch ONLY the fields the API owns.
   * status and alarm are deliberately excluded —
   * the socket owns those and updates them in real-time.
   */
  private patchMetrics(target: any, source: any): void {
    if (source.run_time      !== undefined) target.run_time      = source.run_time;
    if (source.idle_time     !== undefined) target.idle_time     = source.idle_time;
    if (source.run_minutes   !== undefined) target.run_minutes   = source.run_minutes;
    if (source.idle_minutes  !== undefined) target.idle_minutes  = source.idle_minutes;
    if (source.utilization   !== undefined) target.utilization   = source.utilization;
    if (source.achieved_qty  !== undefined) target.achieved_qty  = source.achieved_qty;
    if (source.target_qty    !== undefined) target.target_qty    = source.target_qty;
    if (source.produced_qty  !== undefined) target.produced_qty  = source.produced_qty;
    if (source.operator_name !== undefined) target.operator_name = source.operator_name;
    if (source.part_name     !== undefined) target.part_name     = source.part_name;
    if (source.component_id  !== undefined) target.component_id  = source.component_id;
    // ✅ received_at → copied from API so staleness timer stays accurate between socket events
    if (source.received_at   !== undefined) target.received_at   = source.received_at;
    // ❌ status  → socket owns this (real-time); staleness timer handles offline detection
    // ❌ alarm   → socket owns this
  }

  /* ════════════════════════════════════════
     MANUAL FETCH  (called on tab restore)
  ════════════════════════════════════════ */
  private fetchMetrics(): void {
    this.service.getLive()
      .pipe(takeUntil(this.destroy$))
      .subscribe((res: any) => this.applyApiResponse(res));
  }

  /* ════════════════════════════════════════
     STALENESS SWEEP  (every 3s)

     Marks machines OFFLINE when their last
     received_at is older than STALE_THRESHOLD_SEC.
     Handles machines that die silently (no final
     socket event) — e.g. power cut, network drop.

     received_at is epoch-seconds from deviceTime
     (mqtt.js) or from the API poll (patchMetrics).
  ════════════════════════════════════════ */
  private checkStaleStatus(): void {
    const nowSec = Math.floor(Date.now() / 1000);
    let changed  = false;

    for (const m of this.machines) {
      if (m.status === 'OFFLINE') continue;

      const lastSeen = Number(m.received_at || 0);
      if (!lastSeen) continue; // no timestamp yet — leave as-is

      if (nowSec - lastSeen > STALE_THRESHOLD_SEC) {
        m.status = 'OFFLINE';
        this.pendingOnlineMs.delete(m.machine_id);
        changed = true;
      }
    }

    if (changed) this.cdr.markForCheck();
  }

  /* ════════════════════════════════════════
     SOCKET → status + alarm ONLY

     ❌ achieved_qty  → NOT touched (API owns)
     ❌ run_time      → NOT touched (API owns)
     ❌ utilization   → NOT touched (API owns)
  ════════════════════════════════════════ */
  private handleSocketUpdate(data: any): void {

    this.updateQueue.push(data);

    if (!this.updateScheduled) {
      this.updateScheduled = true;

      requestAnimationFrame(() => {

        const updates        = [...this.updateQueue];
        this.updateQueue     = [];
        this.updateScheduled = false;

        this.zone.run(() => {

          let changed = false;

          for (const update of updates) {

            const machine = this.machineMap.get(update.machine_id);
            if (!machine) continue;

            /* ── Resolve status from socket payload ── */
            const nowSec         = Math.floor(Date.now() / 1000);
            const receivedAtSec  = Number(update.received_at || 0);
            const freshDiff      = receivedAtSec
              ? (nowSec - receivedAtSec)
              : null;

            let newStatus: string;

            if (
              !receivedAtSec ||
              (freshDiff !== null && freshDiff > OFFLINE_THRESHOLD_SEC)
            ) {
              newStatus = 'OFFLINE';
            } else if (
              ['RUN', 'RUNNING', 'CUTTING'].includes(
                (update.machine_status || '').toUpperCase()
              )
            ) {
              newStatus = 'RUNNING';
            } else {
              newStatus = 'IDLE';
            }

            /* ── OFFLINE → RUNNING/IDLE debounce ──────────────────
               Industrial machines can briefly reconnect (1-2 packets)
               then drop again. Require ONLINE_CONFIRM_MS of continuous
               data before exiting OFFLINE, preventing false flickers.
            ──────────────────────────────────────────────────────── */
            if (machine.status === 'OFFLINE' && newStatus !== 'OFFLINE') {
              const now        = Date.now();
              const firstSeen  = this.pendingOnlineMs.get(update.machine_id);

              if (!firstSeen) {
                // First packet after offline — start confirmation window
                this.pendingOnlineMs.set(update.machine_id, now);
                // Keep received_at fresh so staleness timer doesn't re-fire OFFLINE
                machine.received_at = update.received_at ?? machine.received_at;
                continue;
              }

              if (now - firstSeen < ONLINE_CONFIRM_MS) {
                // Still in confirmation window — update staleness clock but hold status
                machine.received_at = update.received_at ?? machine.received_at;
                continue;
              }

              // Confirmation window passed — machine is stably back online
              this.pendingOnlineMs.delete(update.machine_id);
            }

            /* ── Machine going offline — clear any pending confirmation ── */
            if (newStatus === 'OFFLINE') {
              this.pendingOnlineMs.delete(update.machine_id);
            }

            /* ── Apply status / alarm only when value actually changes ── */
            if (machine.status !== newStatus) {
              machine.status      = newStatus;
              machine.received_at = update.received_at ?? machine.received_at;
              changed = true;
            }

            const newAlarm = update.alarm === true;
            if (machine.alarm !== newAlarm) {
              machine.alarm = newAlarm;
              changed       = true;
            }
          }

          if (changed) {
            this.cdr.markForCheck();
          }
        });
      });
    }
  }

  /* ════════════════════════════════════════
     PAGINATION & FILTER
  ════════════════════════════════════════ */

  /* ── Live counts — always derived from machines array (same source as filter)
        so button counts ALWAYS match what the filter actually shows         ── */
  get runningCount(): number {
    return this.machines.filter(m => m.status === 'RUNNING').length;
  }

  get idleCount(): number {
    return this.machines.filter(m => m.status === 'IDLE').length;
  }

  get alarmCount(): number {
    return this.machines.filter(m => m.alarm).length;
  }

  get filteredMachines(): any[] {
    switch (this.statusFilter) {
      case 'running': return this.machines.filter(m => m.status === 'RUNNING');
      case 'idle':    return this.machines.filter(m => m.status === 'IDLE');
      case 'alarm':   return this.machines.filter(m => m.alarm);
      default:        return this.machines;
    }
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.filteredMachines.length / this.pageSize));
  }

  get pagedMachines(): any[] {
    const start = (this.currentPage - 1) * this.pageSize;
    return this.filteredMachines.slice(start, start + this.pageSize);
  }

  get pageNumbers(): number[] {
    return Array.from({ length: this.totalPages }, (_, i) => i + 1);
  }

  setFilter(f: 'all' | 'running' | 'idle' | 'alarm'): void {
    // clicking the already-active filter OR clicking Total → reset to all
    this.statusFilter = (f === 'all' || this.statusFilter === f) ? 'all' : f;
    this.currentPage  = 1;
    this.resetAutoPageTimer();
    this.cdr.markForCheck();
  }

  goToPage(n: number): void {
    if (n < 1 || n > this.totalPages) return;
    this.currentPage = n;
    this.resetAutoPageTimer();
    this.cdr.markForCheck();
  }

  private startAutoPageTimer(): void {
    this.autoPageTimer = setInterval(() => {
      this.zone.run(() => {
        this.currentPage = this.currentPage >= this.totalPages ? 1 : this.currentPage + 1;
        this.cdr.markForCheck();
      });
    }, AUTO_PAGE_MS);
  }

  private resetAutoPageTimer(): void {
    clearInterval(this.autoPageTimer);
    this.startAutoPageTimer();
  }

  /* ════════════════════════════════════════
     HELPERS
  ════════════════════════════════════════ */
  getLastSeen(last: string | null): string {
    if (!last) return 'No Data';
    const diff = (Date.now() - new Date(last).getTime()) / 1000;
    if (diff < 60)   return `${Math.floor(diff)} sec ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
    return `${Math.floor(diff / 3600)} hr ago`;
  }

  /* ════════════════════════════════════════
     NAVIGATION
  ════════════════════════════════════════ */
  goToLive(id: number): void {
    this.router.navigate(['/dashboard/live', id]);
  }

  trackByMachine(_index: number, item: any): number {
    return item.machine_id;
  }

  /* ════════════════════════════════════════
     DESTROY
  ════════════════════════════════════════ */
  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    document.removeEventListener('visibilitychange', this.visibilityHandler);
    this.socketService.offMachineUpdate();
    clearInterval(this.clockInterval);
    clearInterval(this.autoPageTimer);
    clearInterval(this.staleCheckTimer);
  }
}
// Mirrors Backend/src/dashboard/dashboard.service.js `dashboard()` exactly.
export type MachineStatus = 'RUNNING' | 'IDLE' | 'OFFLINE';

export interface DashboardMachine {
  machine_id: number;
  machine_serial_no: string;
  image_url: string | null;
  operator_name: string;
  part_name: string | null;
  component_id: number | null;
  status: MachineStatus;
  alarm: boolean;
  run_minutes: number;
  idle_minutes: number;
  run_time: string; // HH:MM:SS
  idle_time: string; // HH:MM:SS
  produced_qty: number;
  utilization: number; // 0-100
  target_qty: number;
  achieved_qty: number;
}

export interface DashboardShift {
  shift_code: string;
  shiftElapsedMinutes: number;
  plannedMinutes: number;
}

export interface DashboardSummary {
  total: number;
  running: number;
  idle: number;
}

export interface DashboardResponse {
  status: string;
  shift: DashboardShift | null;
  summary: DashboardSummary;
  machines: DashboardMachine[];
}

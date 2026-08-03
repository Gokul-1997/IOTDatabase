// Mirrors Backend/src/dashboard/dashboard.service.js exports.machineDetail exactly.
export interface MachineDetailResponse {
  machine: {
    id: number;
    name: string;
    image: string | null;
  };
  shift: {
    shift_code: string;
  };
  operator: {
    operator_name: string;
    employee_id: string;
  };
  job: {
    part_name: string;
    component_id: string | number;
    target_qty: number;
    achieved_qty: number;
    cycle_time: { hours?: number; minutes?: number; seconds?: number } | null;
  };
  production: {
    run_minutes: number;
    idle_minutes: number;
    manual_seconds: number;
    setup_time: string; // HH:MM:SS
    run_time: string; // HH:MM:SS
    idle_time: string; // HH:MM:SS
  };
  quality: {
    accepted: number;
    rejected: number;
  };
  oee: {
    availability: number;
    performance: number;
    quality: number;
    oee: number;
  };
  power: {
    shift_kwh: number;
    total_kwh: number | null;
  };
  live: {
    machine_status: string;
    mode: string | null;
    spindle_load: number;
    feed_rate: number;
    parts_count: number;
    total_energy: number | null;
  };
}

// Mirrors Backend/src/migrations/007_new_features.sql `machine_alarms` table
// and Backend/src/alarms routes — GET /?machine_id=&is_resolved=&page=&limit=,
// PATCH /:id/resolve. Distinct from `notifications` (types/notification.ts):
// alarms are the machine-alert record with a resolve workflow; notifications
// are the broader per-user inbox (which an alarm also posts into).
export type AlarmType = 'ALARM' | 'OFFLINE' | 'LOW_PERFORMANCE';
export type AlarmSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface MachineAlarm {
  id: number;
  company_id: number;
  machine_id: number;
  machine_serial_no: string;
  alarm_type: AlarmType;
  severity: AlarmSeverity;
  message: string | null;
  is_resolved: boolean;
  resolved_by: number | null;
  resolved_by_name: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  started_at: string;
  created_at: string;
}

export interface AlarmsPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface AlarmsResponse {
  success: boolean;
  data: MachineAlarm[];
  pagination: AlarmsPagination;
}

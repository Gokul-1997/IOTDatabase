import { apiClient } from './client';
import { AlarmsResponse } from '../types/alarm';

export interface GetAlarmsParams {
  machine_id?: number;
  is_resolved?: boolean;
  page?: number;
  limit?: number;
}

export async function getAlarms(params: GetAlarmsParams = {}): Promise<AlarmsResponse> {
  const { data } = await apiClient.get<AlarmsResponse>('/alarms', { params });
  return data;
}

export async function resolveAlarm(id: number, resolutionNote?: string): Promise<void> {
  await apiClient.patch(`/alarms/${id}/resolve`, { resolution_note: resolutionNote });
}

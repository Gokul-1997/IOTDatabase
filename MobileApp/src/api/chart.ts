import { apiClient } from './client';
import { ChartDataResponse } from '../types/chart';

export async function getHourlyProduction(
  machineId: number,
  shiftId: number,
  date: string
): Promise<ChartDataResponse> {
  const { data } = await apiClient.get<{ success: boolean; data: ChartDataResponse }>('/charts/data', {
    params: { machine_id: machineId, shift_id: shiftId, date },
  });
  return data.data;
}

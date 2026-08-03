import { apiClient } from './client';
import { MachineDetailResponse } from '../types/machineDetail';

export async function getMachineDetail(machineId: number): Promise<MachineDetailResponse> {
  const { data } = await apiClient.get<{ status: string; data: MachineDetailResponse }>(`/dashboard/live/${machineId}`);
  return data.data;
}

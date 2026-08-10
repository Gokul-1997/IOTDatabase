import { apiClient } from './client';
import { DashboardResponse } from '../types/dashboard';

export async function getDashboard(): Promise<DashboardResponse> {
  const { data } = await apiClient.get<DashboardResponse>('/dashboard');
  return data;
}

import { apiClient } from './client';
import { AppNotification } from '../types/notification';

interface NotificationsResponse {
  success: boolean;
  data: AppNotification[];
  unread_count: number;
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export async function getNotifications(): Promise<AppNotification[]> {
  const { data } = await apiClient.get<NotificationsResponse>('/notifications');
  return data.data;
}

export async function getUnreadCount(): Promise<number> {
  const { data } = await apiClient.get<{ success: boolean; count: number }>('/notifications/unread-count');
  return data.count;
}

export async function markRead(id: AppNotification['id']): Promise<void> {
  await apiClient.patch(`/notifications/${id}/read`);
}

export async function markAllRead(): Promise<void> {
  await apiClient.post('/notifications/mark-all-read');
}

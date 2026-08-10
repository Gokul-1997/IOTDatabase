// Mirrors Backend/src/migrations/007_new_features.sql `notifications` table
// and Backend/src/notifications routes — GET /, GET /unread-count,
// PATCH /:id/read, POST /mark-all-read
export type NotificationType = 'ALARM' | 'MAINTENANCE' | 'INFO' | 'WARNING';

export interface AppNotification {
  id: number | string;
  company_id: number | string | null;
  user_id: number | string;
  type: NotificationType;
  title: string;
  message: string | null;
  link: string | null;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
}

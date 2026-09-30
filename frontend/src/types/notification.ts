export type NotificationType =
  | "auditComplete"
  | "videoAuditComplete"
  | "thumbnailAuditComplete"
  | "playlistAuditComplete";

export interface NotificationItem {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  link: string;
  read: boolean;
  createdAt: string;
  userId: string;
}

export interface GetNotificationsResponse {
  items: NotificationItem[];
  unreadCount: number;
}

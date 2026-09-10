export interface INotificationCreate {
  user_id: string;
  title: string;
  body?: string;
  type?: string;
  channel?: string;
}

export interface INotificationUpdate {
  title?: string;
  body?: string;
  type?: string;
  channel?: string;
  is_read?: boolean;
  read_at?: Date;
}

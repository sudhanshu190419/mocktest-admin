import { supabase } from '@/config/supabase';

export interface NotificationItem {
  id: string;
  title: string;
  body: string;
  isRead: boolean;
  receivedAt: string;
  referenceType?: string;
  referenceId?: string;
}

export const notificationService = {
  /**
   * Fetch all in-app notifications for a teacher/user.
   */
  async getNotifications(profileId: string): Promise<NotificationItem[]> {
    try {
      const { data, error } = await supabase
        .from('notification_recipients')
        .select('*, notifications(*)')
        .eq('profile_id', profileId)
        .order('created_at', { ascending: false });

      if (error || !data || data.length === 0) {
        // Fallback to local storage notifications in demo mode
        const cached = localStorage.getItem(`EDTECH_NOTIFICATIONS_${profileId}`);
        return cached ? JSON.parse(cached) : [];
      }

      return data.map((item: any) => {
        const n = item.notifications || {};
        return {
          id: item.recipient_id,
          title: n.title || 'System Notification',
          body: n.body || '',
          isRead: item.is_read || false,
          receivedAt: item.received_at || item.created_at || new Date().toISOString(),
          referenceType: n.reference_type,
          referenceId: n.reference_id
        };
      });
    } catch (err) {
      console.error('Error fetching notifications:', err);
      const cached = localStorage.getItem(`EDTECH_NOTIFICATIONS_${profileId}`);
      return cached ? JSON.parse(cached) : [];
    }
  },

  /**
   * Mark a notification as read.
   */
  async markAsRead(recipientId: string, profileId: string): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('notification_recipients')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('recipient_id', recipientId);

      // Also update local storage if in demo mode
      const cached = localStorage.getItem(`EDTECH_NOTIFICATIONS_${profileId}`);
      if (cached) {
        const notifs = JSON.parse(cached);
        const updated = notifs.map((n: any) => n.id === recipientId ? { ...n, isRead: true } : n);
        localStorage.setItem(`EDTECH_NOTIFICATIONS_${profileId}`, JSON.stringify(updated));
      }

      return !error;
    } catch (err) {
      return false;
    }
  }
};

import { useState, useEffect, useCallback, useRef } from 'react';
import { notificationService } from '../../../lib/notification-service';
import { useAuthUser } from '../../../contexts/AuthContext';
import type { UserNotification } from '../../../types/notifications';
import { Bell, CheckCheck, RefreshCw, Sparkles } from 'lucide-react';
import Loader from '../../Loader';
import NotificationCard from './NotificationCard';

const NotificationsLayout = () => {
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillStatus, setBackfillStatus] = useState<string | null>(null);
  const { baseUser, canonicalUserId, authenticated } = useAuthUser();
  const hasBackfilled = useRef(false);

  const loadNotifications = useCallback(async () => {
    if (!authenticated || !canonicalUserId) return;

    setLoading(true);
    const data = await notificationService.getUserNotifications(canonicalUserId);
    setNotifications(data);
    setLoading(false);
    return data;
  }, [authenticated, canonicalUserId]);

  // Backfill notifications from activity history
  const handleBackfill = useCallback(async () => {
    if (!authenticated || !canonicalUserId || backfilling) return;

    setBackfilling(true);
    setBackfillStatus('Loading your activity history...');

    try {
      const result = await notificationService.backfillNotificationsFromActivity(canonicalUserId);
      if (result.created > 0) {
        setBackfillStatus(`Added ${result.created} notification${result.created !== 1 ? 's' : ''} from your history`);
        // Reload notifications to show the new ones
        await loadNotifications();
      } else {
        setBackfillStatus('No new activity to add');
      }
    } catch (err) {
      console.error('[Notifications] Backfill error:', err);
      setBackfillStatus('Could not load activity history');
    } finally {
      setBackfilling(false);
      // Clear status after 3 seconds
      setTimeout(() => setBackfillStatus(null), 3000);
    }
  }, [authenticated, canonicalUserId, backfilling, loadNotifications]);

  useEffect(() => {
    const init = async () => {
      const data = await loadNotifications();

      // Auto-backfill if no notifications exist and we haven't tried yet
      if (data && data.length === 0 && !hasBackfilled.current && authenticated && canonicalUserId) {
        hasBackfilled.current = true;
        await handleBackfill();
      }
    };

    init();
  }, [loadNotifications, handleBackfill, authenticated, canonicalUserId]);

  const handleMarkAsRead = async (id: string) => {
    await notificationService.markAsRead(id);
    await loadNotifications();
  };

  const handleMarkAllAsRead = async () => {
    if (!canonicalUserId) return;
    await notificationService.markAllAsRead(canonicalUserId);
    await loadNotifications();
  };

  const handleDelete = async (id: string) => {
    await notificationService.deleteNotification(id);
    await loadNotifications();
  };



  if (loading) {
    return (
      <div className="py-12">
        <Loader />
      </div>
    );
  }

  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header with gradient and animated background */}
      <div className="relative mb-8 overflow-hidden rounded-2xl">
        <div className="absolute inset-0 bg-gradient-to-r from-[#DDE404]/20 via-purple-500/10 to-[#EF008F]/20 animate-pulse" />
        <div className="relative bg-[#181818]/90 backdrop-blur-sm border-2 border-white/20 rounded-2xl p-6">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div className="flex items-center gap-4">
              <div className="bg-gradient-to-br from-[#DDE404] to-[#B8BE04] p-3 rounded-xl">
                {unreadCount > 0 ? (
                  <Sparkles className="text-black" size={32} />
                ) : (
                  <Bell className="text-black" size={32} />
                )}
              </div>
              <div>
                <h2 className="text-white sequel-95 uppercase text-2xl md:text-3xl flex items-center gap-2">
                  Notifications
                  {unreadCount > 0 && (
                    <span className="bg-red-500 text-white text-sm sequel-75 px-2 py-1 rounded-full animate-pulse">
                      {unreadCount}
                    </span>
                  )}
                </h2>
                <p className="text-white/60 sequel-45 text-sm mt-1">
                  {unreadCount > 0 ? `${unreadCount} unread notification${unreadCount !== 1 ? 's' : ''}` : 'All caught up! 🎉'}
                </p>
              </div>
            </div>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllAsRead}
                className="bg-[#DDE404] hover:bg-[#DDE404]/90 text-[#1A1A1A] sequel-75 uppercase px-5 py-3 rounded-xl transition-all hover:scale-105 active:scale-95 text-sm flex items-center gap-2 shadow-lg shadow-[#DDE404]/30"
              >
                <CheckCheck size={18} />
                Mark All as Read
              </button>
            )}
          </div>
        </div>
      </div>

      {notifications.length === 0 ? (
        <div className="relative overflow-hidden rounded-2xl">
          <div className="absolute inset-0 bg-gradient-to-br from-white/5 via-transparent to-white/5" />
          <div className="relative bg-[#181818]/90 backdrop-blur-sm border-2 border-white/20 rounded-2xl p-12 text-center">
            <div className="inline-block p-6 bg-gradient-to-br from-white/10 to-transparent rounded-full mb-6">
              <Bell className="text-white/30" size={64} />
            </div>
            <h3 className="text-white sequel-75 text-xl mb-2">No notifications yet</h3>
            <p className="text-white/40 sequel-45 text-sm mb-6 max-w-md mx-auto">
              You'll be notified here when you win, competitions end, or we have special offers
            </p>
            {backfillStatus && (
              <p className="text-[#DDE404] sequel-45 text-sm mb-4 animate-pulse">{backfillStatus}</p>
            )}
            <button
              onClick={handleBackfill}
              disabled={backfilling}
              className="bg-gradient-to-r from-[#DDE404] to-[#B8BE04] hover:from-[#B8BE04] hover:to-[#DDE404] text-black sequel-75 uppercase px-6 py-3 rounded-xl transition-all hover:scale-105 active:scale-95 text-sm flex items-center gap-2 mx-auto disabled:opacity-50 shadow-lg shadow-[#DDE404]/30"
            >
              <RefreshCw size={18} className={backfilling ? 'animate-spin' : ''} />
              {backfilling ? 'Loading...' : 'Load Activity History'}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {notifications.map((notification, index) => (
            <div
              key={notification.id}
              style={{
                animation: `fadeInUp 0.5s ease-out ${index * 0.1}s both`
              }}
            >
              <NotificationCard
                notification={notification}
                onMarkAsRead={handleMarkAsRead}
                onDelete={handleDelete}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default NotificationsLayout;

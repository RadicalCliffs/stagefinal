import { useState, useEffect, useCallback, useRef } from 'react';
import { notificationService } from '../../../lib/notification-service';
import { useAuthUser } from '../../../contexts/AuthContext';
import type { UserNotification } from '../../../types/notifications';
import { Bell, Check, CheckCheck, Trash2, Gift, Trophy, Megaphone, AlertCircle, CreditCard, Wallet, Ticket, RefreshCw } from 'lucide-react';
import Loader from '../../Loader';

const NotificationsLayout = () => {
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillStatus, setBackfillStatus] = useState<string | null>(null);
  const { baseUser, authenticated } = useAuthUser();
  const hasBackfilled = useRef(false);

  const loadNotifications = useCallback(async () => {
    if (!authenticated || !baseUser?.id) return;

    setLoading(true);
    const data = await notificationService.getUserNotifications(baseUser.id);
    setNotifications(data);
    setLoading(false);
    return data;
  }, [authenticated, baseUser?.id]);

  // Backfill notifications from activity history
  const handleBackfill = useCallback(async () => {
    if (!authenticated || !baseUser?.id || backfilling) return;

    setBackfilling(true);
    setBackfillStatus('Loading your activity history...');

    try {
      const result = await notificationService.backfillNotificationsFromActivity(baseUser.id);
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
  }, [authenticated, baseUser?.id, backfilling, loadNotifications]);

  useEffect(() => {
    const init = async () => {
      const data = await loadNotifications();

      // Auto-backfill if no notifications exist and we haven't tried yet
      if (data && data.length === 0 && !hasBackfilled.current && authenticated && baseUser?.id) {
        hasBackfilled.current = true;
        await handleBackfill();
      }
    };

    init();
  }, [loadNotifications, handleBackfill, authenticated, baseUser?.id]);

  const handleMarkAsRead = async (id: string) => {
    await notificationService.markAsRead(id);
    await loadNotifications();
  };

  const handleMarkAllAsRead = async () => {
    if (!baseUser?.id) return;
    await notificationService.markAllAsRead(baseUser.id);
    await loadNotifications();
  };

  const handleDelete = async (id: string) => {
    await notificationService.deleteNotification(id);
    await loadNotifications();
  };

  const getNotificationIcon = (type: UserNotification['type']) => {
    switch (type) {
      case 'win':
        return <Trophy className="text-[#DDE404]" size={24} />;
      case 'special_offer':
        return <Gift className="text-purple-400" size={24} />;
      case 'competition_ended':
        return <AlertCircle className="text-blue-400" size={24} />;
      case 'announcement':
        return <Megaphone className="text-white" size={24} />;
      case 'payment':
        return <CreditCard className="text-green-400" size={24} />;
      case 'topup':
        return <Wallet className="text-[#DDE404]" size={24} />;
      case 'entry':
        return <Ticket className="text-[#EF008F]" size={24} />;
      default:
        return <Bell className="text-white" size={24} />;
    }
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
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h2 className="text-white sequel-95 uppercase text-2xl md:text-3xl">Notifications</h2>
          <p className="text-white/60 sequel-45 text-sm mt-1">
            {unreadCount > 0 ? `${unreadCount} unread notification${unreadCount !== 1 ? 's' : ''}` : 'All caught up!'}
          </p>
        </div>
        {unreadCount > 0 && (
          <button
            onClick={handleMarkAllAsRead}
            className="bg-[#DDE404] hover:bg-[#DDE404]/90 text-[#1A1A1A] sequel-75 uppercase px-4 py-2 rounded-lg transition-colors text-sm flex items-center gap-2"
          >
            <CheckCheck size={18} />
            Mark All as Read
          </button>
        )}
      </div>

      {notifications.length === 0 ? (
        <div className="bg-[#181818] border-2 border-white/20 rounded-xl p-12 text-center">
          <Bell className="text-white/30 mx-auto mb-4" size={48} />
          <p className="text-white/60 sequel-45 text-lg">No notifications yet</p>
          <p className="text-white/40 sequel-45 text-sm mt-2 mb-6">
            You'll be notified here when you win, competitions end, or we have special offers
          </p>
          {backfillStatus && (
            <p className="text-[#DDE404] sequel-45 text-sm mb-4">{backfillStatus}</p>
          )}
          <button
            onClick={handleBackfill}
            disabled={backfilling}
            className="bg-[#2A2A2A] hover:bg-[#3A3A3A] text-white sequel-75 uppercase px-4 py-2 rounded-lg transition-colors text-sm flex items-center gap-2 mx-auto disabled:opacity-50"
          >
            <RefreshCw size={18} className={backfilling ? 'animate-spin' : ''} />
            {backfilling ? 'Loading...' : 'Load Activity History'}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {notifications.map((notification) => (
            <div
              key={notification.id}
              className={`bg-[#181818] border-2 ${
                notification.read ? 'border-white/10' : 'border-[#DDE404]/50'
              } rounded-xl p-4 transition-all hover:border-white/30`}
            >
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 mt-1">
                  {getNotificationIcon(notification.type)}
                </div>
                
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <h3 className="text-white sequel-75 text-base md:text-lg">
                      {notification.title}
                    </h3>
                    {!notification.read && (
                      <span className="flex-shrink-0 w-2 h-2 bg-[#DDE404] rounded-full mt-2"></span>
                    )}
                  </div>
                  
                  <p className="text-white/70 sequel-45 text-sm mb-3">
                    {notification.message}
                  </p>
                  
                  <div className="flex flex-wrap items-center gap-2 text-xs text-white/50 sequel-45">
                    <span>
                      {new Date(notification.created_at).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                    {notification.expires_at && (
                      <>
                        <span>•</span>
                        <span>Expires {new Date(notification.expires_at).toLocaleDateString()}</span>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-2 flex-shrink-0">
                  {!notification.read && (
                    <button
                      onClick={() => handleMarkAsRead(notification.id)}
                      className="bg-[#2A2A2A] hover:bg-[#3A3A3A] text-white p-2 rounded-lg transition-colors"
                      title="Mark as read"
                    >
                      <Check size={16} />
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(notification.id)}
                    className="bg-red-500/20 hover:bg-red-500/30 text-red-400 p-2 rounded-lg transition-colors"
                    title="Delete"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default NotificationsLayout;

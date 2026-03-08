import { useState, useEffect, useCallback, useRef } from "react";
import { notificationService } from "../../../lib/notification-service";
import { useAuthUser } from "../../../contexts/AuthContext";
import { supabase } from "../../../lib/supabase";
import type { UserNotification } from "../../../types/notifications";
import { Bell, CheckCheck, RefreshCw, Sparkles } from "lucide-react";
import Loader from "../../Loader";
import NotificationCard from "./NotificationCard";

const NotificationsLayout = () => {
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillStatus, setBackfillStatus] = useState<string | null>(null);
  const { baseUser, canonicalUserId, authenticated } = useAuthUser();
  const hasBackfilled = useRef(false);

  const loadNotifications = useCallback(
    async (isBackgroundRefresh = false) => {
      if (!authenticated || !canonicalUserId) return;

      if (!isBackgroundRefresh) {
        setLoading(true);
      } else {
        setIsRefreshing(true);
      }

      const data =
        await notificationService.getUserNotifications(canonicalUserId);
      setNotifications(data);
      setLoading(false);
      setIsRefreshing(false);
      return data;
    },
    [authenticated, canonicalUserId],
  );

  // Backfill notifications from activity history
  const handleBackfill = useCallback(async () => {
    if (!authenticated || !canonicalUserId || backfilling) return;

    setBackfilling(true);
    setBackfillStatus("Loading your activity history...");

    try {
      const result =
        await notificationService.backfillNotificationsFromActivity(
          canonicalUserId,
        );
      if (result.created > 0) {
        setBackfillStatus(
          `Added ${result.created} notification${result.created !== 1 ? "s" : ""} from your history`,
        );
        // Reload notifications to show the new ones
        await loadNotifications();
      } else {
        setBackfillStatus("No new activity to add");
      }
    } catch (err) {
      console.error("[Notifications] Backfill error:", err);
      setBackfillStatus("Could not load activity history");
    } finally {
      setBackfilling(false);
      // Clear status after 3 seconds
      setTimeout(() => setBackfillStatus(null), 3000);
    }
  }, [authenticated, canonicalUserId, backfilling, loadNotifications]);

  useEffect(() => {
    const init = async () => {
      const data = await loadNotifications(false);

      // Auto-backfill if no notifications exist and we haven't tried yet
      if (
        data &&
        data.length === 0 &&
        !hasBackfilled.current &&
        authenticated &&
        canonicalUserId
      ) {
        hasBackfilled.current = true;
        await handleBackfill();
      }
    };

    init();

    // Set up real-time subscription for user_notifications
    if (!canonicalUserId || !baseUser?.id) return;

    console.log(
      "[Notifications] Setting up real-time subscription for user:",
      baseUser.id,
    );

    // Subscribe to user_notifications table changes for this user
    // The user_id column stores the canonical_users.id (profile ID)
    const channel = supabase
      .channel(`user-notifications-${baseUser.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "user_notifications",
          filter: `user_id=eq.${baseUser.id}`,
        },
        (payload) => {
          console.log(
            "[Notifications] New notification received:",
            payload.new,
          );
          // Add the new notification to state immediately for instant feedback
          const newNotification = payload.new as UserNotification;
          setNotifications((prev) => [newNotification, ...prev]);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "user_notifications",
          filter: `user_id=eq.${baseUser.id}`,
        },
        (payload) => {
          console.log("[Notifications] Notification updated:", payload.new);
          // Update the notification in state
          const updatedNotification = payload.new as UserNotification;
          setNotifications((prev) =>
            prev.map((n) =>
              n.id === updatedNotification.id ? updatedNotification : n,
            ),
          );
        },
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "user_notifications",
          filter: `user_id=eq.${baseUser.id}`,
        },
        (payload) => {
          console.log("[Notifications] Notification deleted:", payload.old);
          // Remove the notification from state
          const deletedId = (payload.old as { id: string }).id;
          setNotifications((prev) => prev.filter((n) => n.id !== deletedId));
        },
      )
      .subscribe((status) => {
        console.log("[Notifications] Subscription status:", status);
      });

    return () => {
      console.log("[Notifications] Cleaning up real-time subscription");
      supabase.removeChannel(channel);
    };
  }, [
    loadNotifications,
    handleBackfill,
    authenticated,
    canonicalUserId,
    baseUser?.id,
  ]);

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

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <div className="max-w-5xl mx-auto">
      {/* Real-time refresh indicator */}
      {isRefreshing && (
        <div className="fixed top-20 right-6 z-50 animate-fade-in">
          <div className="bg-[#DDE404] text-black sequel-75 text-xs px-4 py-2 rounded-lg shadow-lg flex items-center gap-2">
            <RefreshCw size={14} className="animate-spin" />
            <span>Updating...</span>
          </div>
        </div>
      )}

      {/* Header with gradient and animated background */}
      <div className="relative mb-8 overflow-hidden rounded-2xl">
        <div className="absolute inset-0 bg-linear-to-r from-[#DDE404]/20 via-purple-500/10 to-[#EF008F]/20 animate-pulse" />
        <div className="relative bg-[#181818]/90 backdrop-blur-sm border-2 border-white/20 rounded-2xl p-6">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div className="flex items-center gap-4">
              <div className="bg-linear-to-br from-[#DDE404] to-[#B8BE04] p-3 rounded-xl">
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
                  {unreadCount > 0
                    ? `${unreadCount} unread notification${unreadCount !== 1 ? "s" : ""}`
                    : "All caught up! 🎉"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  onClick={handleMarkAllAsRead}
                  className="bg-[#DDE404] hover:bg-[#DDE404]/90 text-[#1A1A1A] sequel-75 uppercase px-5 py-3 rounded-xl transition-all hover:scale-105 active:scale-95 text-sm flex items-center gap-2 shadow-lg shadow-[#DDE404]/30"
                >
                  <CheckCheck size={18} />
                  Mark All as Read
                </button>
              )}
              <button
                onClick={() => loadNotifications(true)}
                disabled={isRefreshing}
                className="bg-white/10 hover:bg-white/20 text-white sequel-75 uppercase px-4 py-3 rounded-xl transition-all hover:scale-105 active:scale-95 text-sm flex items-center gap-2 disabled:opacity-50"
                title="Refresh notifications"
              >
                <RefreshCw
                  size={18}
                  className={isRefreshing ? "animate-spin" : ""}
                />
              </button>
            </div>
          </div>
        </div>
      </div>

      {notifications.length === 0 ? (
        <div className="relative overflow-hidden rounded-2xl">
          <div className="absolute inset-0 bg-linear-to-br from-white/5 via-transparent to-white/5" />
          <div className="relative bg-[#181818]/90 backdrop-blur-sm border-2 border-white/20 rounded-2xl p-12 text-center">
            <div className="inline-block p-6 bg-linear-to-br from-white/10 to-transparent rounded-full mb-6">
              <Bell className="text-white/30" size={64} />
            </div>
            <h3 className="text-white sequel-75 text-xl mb-2">
              No notifications yet
            </h3>
            <p className="text-white/40 sequel-45 text-sm mb-6 max-w-md mx-auto">
              You'll be notified here when you win, competitions end, or we have
              special offers
            </p>
            {backfillStatus && (
              <p className="text-[#DDE404] sequel-45 text-sm mb-4 animate-pulse">
                {backfillStatus}
              </p>
            )}
            <button
              onClick={handleBackfill}
              disabled={backfilling}
              className="bg-linear-to-r from-[#DDE404] to-[#B8BE04] hover:from-[#B8BE04] hover:to-[#DDE404] text-black sequel-75 uppercase px-6 py-3 rounded-xl transition-all hover:scale-105 active:scale-95 text-sm flex items-center gap-2 mx-auto disabled:opacity-50 shadow-lg shadow-[#DDE404]/30"
            >
              <RefreshCw
                size={18}
                className={backfilling ? "animate-spin" : ""}
              />
              {backfilling ? "Loading..." : "Load Activity History"}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {notifications.map((notification, index) => (
            <div
              key={notification.id}
              style={{
                animation: `fadeInUp 0.5s ease-out ${index * 0.1}s both`,
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

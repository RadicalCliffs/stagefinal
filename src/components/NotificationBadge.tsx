import { useState, useEffect } from 'react';
import { notificationService } from '../lib/notification-service';
import { useAuthUser } from '../contexts/AuthContext';

interface NotificationBadgeProps {
  className?: string;
}

const NotificationBadge: React.FC<NotificationBadgeProps> = ({ className = '' }) => {
  const [unreadCount, setUnreadCount] = useState(0);
  const { baseUser, authenticated } = useAuthUser();

  useEffect(() => {
    if (!authenticated || !baseUser?.id) return;

    const fetchUnreadCount = async () => {
      const count = await notificationService.getUnreadCount(baseUser.id);
      setUnreadCount(count);
    };

    fetchUnreadCount();

    const interval = setInterval(fetchUnreadCount, 30000);

    return () => clearInterval(interval);
  }, [authenticated, baseUser]);

  if (!authenticated || unreadCount === 0) {
    return null;
  }

  return (
    <div className={`relative ${className}`}>
      <div className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full min-w-[18px] h-[18px] flex items-center justify-center text-xs sequel-75 px-1">
        {unreadCount > 99 ? '99+' : unreadCount}
      </div>
    </div>
  );
};

export default NotificationBadge;

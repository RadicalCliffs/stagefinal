import { useState } from 'react';
import { Check, Trash2, Trophy, Gift, Megaphone, AlertCircle, CreditCard, Wallet, Ticket, Bell, Sparkles } from 'lucide-react';
import type { UserNotification } from '../../../types/notifications';

interface NotificationCardProps {
  notification: UserNotification;
  onMarkAsRead: (id: string) => void;
  onDelete: (id: string) => void;
}

const NotificationCard = ({ notification, onMarkAsRead, onDelete }: NotificationCardProps) => {
  const [isHovered, setIsHovered] = useState(false);

  // Get notification styling based on type
  const getNotificationStyle = (type: UserNotification['type']) => {
    switch (type) {
      case 'win':
        return {
          gradient: 'from-yellow-500/20 via-amber-500/10 to-orange-500/20',
          borderColor: 'border-yellow-400/50',
          iconBg: 'bg-linear-to-br from-yellow-400 to-orange-500',
          icon: <Trophy className="text-black" size={28} />,
          badge: 'bg-yellow-400 text-black',
          glow: 'shadow-[0_0_30px_rgba(234,179,8,0.3)]',
          accentColor: '#DDE404'
        };
      case 'special_offer':
        return {
          gradient: 'from-purple-500/20 via-pink-500/10 to-fuchsia-500/20',
          borderColor: 'border-purple-400/50',
          iconBg: 'bg-linear-to-br from-purple-500 to-pink-600',
          icon: <Gift className="text-white" size={28} />,
          badge: 'bg-purple-500 text-white',
          glow: 'shadow-[0_0_30px_rgba(168,85,247,0.3)]',
          accentColor: '#A855F7'
        };
      case 'competition_ended':
        return {
          gradient: 'from-blue-500/20 via-cyan-500/10 to-sky-500/20',
          borderColor: 'border-blue-400/50',
          iconBg: 'bg-linear-to-br from-blue-500 to-cyan-600',
          icon: <AlertCircle className="text-white" size={28} />,
          badge: 'bg-blue-500 text-white',
          glow: 'shadow-[0_0_30px_rgba(59,130,246,0.3)]',
          accentColor: '#3B82F6'
        };
      case 'announcement':
        return {
          gradient: 'from-white/10 via-gray-500/5 to-white/10',
          borderColor: 'border-white/50',
          iconBg: 'bg-linear-to-br from-gray-100 to-white',
          icon: <Megaphone className="text-black" size={28} />,
          badge: 'bg-white text-black',
          glow: 'shadow-[0_0_30px_rgba(255,255,255,0.2)]',
          accentColor: '#FFFFFF'
        };
      case 'payment':
        return {
          gradient: 'from-green-500/20 via-emerald-500/10 to-teal-500/20',
          borderColor: 'border-green-400/50',
          iconBg: 'bg-linear-to-br from-green-500 to-emerald-600',
          icon: <CreditCard className="text-white" size={28} />,
          badge: 'bg-green-500 text-white',
          glow: 'shadow-[0_0_30px_rgba(34,197,94,0.3)]',
          accentColor: '#22C55E'
        };
      case 'topup':
        return {
          gradient: 'from-yellow-500/20 via-lime-500/10 to-green-500/20',
          borderColor: 'border-[#DDE404]/50',
          iconBg: 'bg-linear-to-br from-[#DDE404] to-[#B8BE04]',
          icon: <Wallet className="text-black" size={28} />,
          badge: 'bg-[#DDE404] text-black',
          glow: 'shadow-[0_0_30px_rgba(221,228,4,0.3)]',
          accentColor: '#DDE404'
        };
      case 'entry':
        return {
          gradient: 'from-pink-500/20 via-rose-500/10 to-red-500/20',
          borderColor: 'border-[#EF008F]/50',
          iconBg: 'bg-linear-to-br from-[#EF008F] to-[#C7006E]',
          icon: <Ticket className="text-white" size={28} />,
          badge: 'bg-[#EF008F] text-white',
          glow: 'shadow-[0_0_30px_rgba(239,0,143,0.3)]',
          accentColor: '#EF008F'
        };
      default:
        return {
          gradient: 'from-gray-500/20 via-gray-600/10 to-gray-700/20',
          borderColor: 'border-white/20',
          iconBg: 'bg-linear-to-br from-gray-500 to-gray-700',
          icon: <Bell className="text-white" size={28} />,
          badge: 'bg-gray-500 text-white',
          glow: 'shadow-[0_0_20px_rgba(107,114,128,0.2)]',
          accentColor: '#6B7280'
        };
    }
  };

  const style = getNotificationStyle(notification.type);

  // Format notification type for display
  const formatType = (type: UserNotification['type']) => {
    const typeMap: Record<UserNotification['type'], string> = {
      'win': 'Win',
      'special_offer': 'Special Offer',
      'competition_ended': 'Competition Ended',
      'announcement': 'Announcement',
      'payment': 'Payment',
      'topup': 'Top-Up',
      'entry': 'Entry'
    };
    return typeMap[type] || type;
  };

  return (
    <div
      className={`relative overflow-hidden rounded-2xl transition-all duration-300 ${
        isHovered ? 'scale-[1.02]' : 'scale-100'
      }`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Gradient Background */}
      <div className={`absolute inset-0 bg-linear-to-br ${style.gradient} opacity-50`} />
      
      {/* Animated glow effect for unread */}
      {!notification.read && (
        <div className={`absolute inset-0 ${style.glow} animate-pulse`} />
      )}

      {/* Main Card */}
      <div
        className={`relative bg-[#181818]/90 backdrop-blur-sm border-2 ${style.borderColor} rounded-2xl p-5 transition-all duration-300`}
      >
        {/* Sparkle decoration for unread */}
        {!notification.read && (
          <div className="absolute top-3 right-3">
            <Sparkles className="text-[#DDE404] animate-pulse" size={20} />
          </div>
        )}

        <div className="flex items-start gap-4">
          {/* Icon with gradient background */}
          <div className={`shrink-0 ${style.iconBg} p-3 rounded-xl ${!notification.read ? 'animate-bounce' : ''}`}>
            {style.icon}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            {/* Badge and title */}
            <div className="flex items-start gap-2 mb-2 flex-wrap">
              <span className={`${style.badge} sequel-75 text-xs px-2 py-1 rounded uppercase`}>
                {formatType(notification.type)}
              </span>
              {!notification.read && (
                <span className="shrink-0 w-2 h-2 bg-[#DDE404] rounded-full mt-1.5 animate-pulse" />
              )}
            </div>

            <h3 className="text-white sequel-75 text-lg md:text-xl mb-2 leading-tight">
              {notification.title}
            </h3>

            <p className="text-white/80 sequel-45 text-sm mb-3 leading-relaxed">
              {notification.message}
            </p>

            {/* Additional info for specific types */}
            {notification.amount !== undefined && notification.amount !== null && (
              <div className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 mb-3 inline-block">
                <span className="text-[#DDE404] sequel-75 text-base">
                  ${Number(notification.amount).toFixed(2)}
                </span>
              </div>
            )}

            {/* Timestamp and expiration */}
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
                  <span className="text-orange-400">
                    Expires {new Date(notification.expires_at).toLocaleDateString()}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex flex-col gap-2 shrink-0">
            {!notification.read && (
              <button
                onClick={() => onMarkAsRead(notification.id)}
                className="bg-[#2A2A2A] hover:bg-[#3A3A3A] text-white p-2.5 rounded-lg transition-all hover:scale-110 active:scale-95"
                title="Mark as read"
              >
                <Check size={18} />
              </button>
            )}
            <button
              onClick={() => onDelete(notification.id)}
              className="bg-red-500/20 hover:bg-red-500/30 text-red-400 p-2.5 rounded-lg transition-all hover:scale-110 active:scale-95"
              title="Delete"
            >
              <Trash2 size={18} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NotificationCard;

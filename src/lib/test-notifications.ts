// Test utility to create sample notifications
// Run this in the browser console to test the new notification designs

import { notificationService } from './notification-service';

/**
 * Creates sample notifications for testing the UI
 * Usage: In browser console, import this file and call createTestNotifications(userId)
 */
export async function createTestNotifications(userId: string) {
  console.log('Creating test notifications for user:', userId);

  try {
    // Win notification
    await notificationService.notifyWinner(
      userId,
      'comp-123',
      'iPhone 15 Pro Max'
    );
    console.log('✅ Created win notification');

    // Competition ended notification
    await notificationService.notifyCompetitionEnded(
      userId,
      'comp-456',
      'MacBook Pro Giveaway'
    );
    console.log('✅ Created competition ended notification');

    // Entry confirmation notification
    await notificationService.notifyEntry(
      userId,
      'Tesla Model 3 Competition',
      [42, 43, 44],
      'comp-789'
    );
    console.log('✅ Created entry notification');

    // Special offer notification
    await notificationService.notifySpecialOffer(
      userId,
      '🎁 Limited Time Offer!',
      'Get 50% bonus on your next top-up! This exclusive offer expires in 24 hours.',
      new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // Expires in 24 hours
    );
    console.log('✅ Created special offer notification');

    // Payment notification
    await notificationService.notifyPayment(
      userId,
      25.00,
      5,
      'PlayStation 5 Raffle'
    );
    console.log('✅ Created payment notification');

    // Top-up notification
    await notificationService.notifyTopUp(
      userId,
      100.00,
      150.00
    );
    console.log('✅ Created top-up notification');

    // Announcement notification
    await notificationService.createNotification({
      user_id: userId,
      type: 'announcement',
      title: '📢 New Feature Alert!',
      message: 'We have launched instant win competitions! Check them out now for a chance to win amazing prizes instantly.',
      read: false,
    });
    console.log('✅ Created announcement notification');

    console.log('🎉 All test notifications created successfully!');
    console.log('Navigate to the Notifications page to see them.');
  } catch (error) {
    console.error('❌ Error creating test notifications:', error);
  }
}

// Helper to create a specific notification type
export async function createNotification(
  userId: string,
  type: 'win' | 'competition_ended' | 'special_offer' | 'announcement' | 'payment' | 'topup' | 'entry',
  customData?: Partial<{
    title: string;
    message: string;
    competitionId: string;
    prize: string;
    amount: number;
    ticketCount: number;
    ticketNumbers: number[];
    expiresAt: string;
  }>
) {
  switch (type) {
    case 'win':
      await notificationService.notifyWinner(
        userId,
        customData?.competitionId || 'test-comp',
        customData?.prize || 'Test Prize'
      );
      break;
    case 'competition_ended':
      await notificationService.notifyCompetitionEnded(
        userId,
        customData?.competitionId || 'test-comp',
        customData?.title || 'Test Competition'
      );
      break;
    case 'entry':
      await notificationService.notifyEntry(
        userId,
        customData?.title || 'Test Competition',
        customData?.ticketNumbers || [1, 2, 3],
        customData?.competitionId || 'test-comp'
      );
      break;
    case 'special_offer':
      await notificationService.notifySpecialOffer(
        userId,
        customData?.title || 'Test Offer',
        customData?.message || 'Test offer message',
        customData?.expiresAt
      );
      break;
    case 'payment':
      await notificationService.notifyPayment(
        userId,
        customData?.amount || 10.00,
        customData?.ticketCount || 1,
        customData?.title || 'Test Competition'
      );
      break;
    case 'topup':
      await notificationService.notifyTopUp(
        userId,
        customData?.amount || 50.00
      );
      break;
    case 'announcement':
      await notificationService.createNotification({
        user_id: userId,
        type: 'announcement',
        title: customData?.title || 'Test Announcement',
        message: customData?.message || 'Test announcement message',
        read: false,
      });
      break;
  }
  console.log(`✅ Created ${type} notification`);
}

// Export for use in browser console
if (typeof window !== 'undefined') {
  (window as any).createTestNotifications = createTestNotifications;
  (window as any).createNotification = createNotification;
  console.log('Test notification functions loaded!');
  console.log('Usage: createTestNotifications(userId)');
  console.log('Or: createNotification(userId, type, customData)');
}

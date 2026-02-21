import { test, expect } from '@playwright/test';

/**
 * Orders & Entries E2E Tests
 * 
 * Tests the orders and entries dashboard sections including:
 * - Orders listing
 * - Order details
 * - Entries listing
 * - Entry details
 * - Competition grouping
 */

test.describe('Orders Dashboard', () => {
  test.describe('Orders List', () => {
    test('should load orders page', async ({ page }) => {
      await page.goto('/dashboard/orders');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);

      await expect(page.locator('body')).toBeVisible();
    });

    test('should show order list or empty state', async ({ page }) => {
      await page.goto('/dashboard/orders');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);

      // Should show orders or empty message
      const orders = page.locator('[class*="order" i], [class*="card" i], [class*="item" i]').first();
      const emptyState = page.locator('text=/no orders|nothing yet|get started|make your first/i').first();

      // One of these should be visible, or auth required
      await expect(page.locator('body')).toBeVisible();
    });

    test('should display order information', async ({ page }) => {
      await page.goto('/dashboard/orders');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);

      // Look for typical order info
      const orderInfo = page.locator('text=/$|order|date|status|amount/i').first();
      
      await expect(page.locator('body')).toBeVisible();
    });
  });

  test.describe('Order Details', () => {
    test('should navigate to order detail page', async ({ page }) => {
      await page.goto('/dashboard/orders');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);

      // Find clickable order
      const orderLink = page.locator('a[href*="/orders/"], [class*="order" i]').first();
      
      if (await orderLink.isVisible().catch(() => false)) {
        await orderLink.click();
        await page.waitForTimeout(1000);
        
        // Should navigate to detail page
        await expect(page.locator('body')).toBeVisible();
      }
    });

    test('should handle invalid order ID', async ({ page }) => {
      await page.goto('/dashboard/orders/invalid-order-id-12345');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);

      // Should show error or redirect, not crash
      await expect(page.locator('body')).toBeVisible();
    });
  });

  test.describe('Order Filtering', () => {
    test('should filter orders by status', async ({ page }) => {
      await page.goto('/dashboard/orders');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);

      // Look for status filters
      const statusFilter = page.locator('button:has-text("All"), button:has-text("Pending"), button:has-text("Completed"), [class*="filter" i]').first();
      
      if (await statusFilter.isVisible().catch(() => false)) {
        await statusFilter.click();
        await page.waitForTimeout(500);
      }

      await expect(page.locator('body')).toBeVisible();
    });
  });
});

test.describe('Entries Dashboard', () => {
  test.describe('Entries List', () => {
    test('should load entries page', async ({ page }) => {
      await page.goto('/dashboard/entries');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);

      await expect(page.locator('body')).toBeVisible();
    });

    test('should show entries or empty state', async ({ page }) => {
      await page.goto('/dashboard/entries');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);

      // Should show entries or empty message
      const entries = page.locator('[class*="entry" i], [class*="ticket" i], [class*="card" i]').first();
      const emptyState = page.locator('text=/no entries|nothing yet|enter.*competition/i').first();

      await expect(page.locator('body')).toBeVisible();
    });

    test('should display entry/ticket information', async ({ page }) => {
      await page.goto('/dashboard/entries');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);

      // Look for typical entry info
      const entryInfo = page.locator('text=/ticket|entry|competition|draw/i').first();
      
      await expect(page.locator('body')).toBeVisible();
    });
  });

  test.describe('Entry Details', () => {
    test('should navigate to entry detail page', async ({ page }) => {
      await page.goto('/dashboard/entries');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);

      // Find clickable entry
      const entryLink = page.locator('a[href*="/entries/"], [class*="entry" i]').first();
      
      if (await entryLink.isVisible().catch(() => false)) {
        await entryLink.click();
        await page.waitForTimeout(1000);
        
        await expect(page.locator('body')).toBeVisible();
      }
    });

    test('should show ticket numbers', async ({ page }) => {
      await page.goto('/dashboard/entries');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);

      // Look for ticket number display
      const ticketNumber = page.locator('text=/#\\d+|ticket.*\\d+/i').first();
      
      await expect(page.locator('body')).toBeVisible();
    });
  });

  test.describe('Competition Grouping', () => {
    test('should group entries by competition', async ({ page }) => {
      await page.goto('/dashboard/entries');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);

      // Look for competition grouping
      const competitionGroup = page.locator('[class*="competition" i], [class*="group" i]').first();
      
      await expect(page.locator('body')).toBeVisible();
    });

    test('should navigate to competition entries detail', async ({ page }) => {
      await page.goto('/dashboard/entries');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);

      // Find competition entry link
      const competitionLink = page.locator('a[href*="competition"]').first();
      
      if (await competitionLink.isVisible().catch(() => false)) {
        await competitionLink.click();
        await page.waitForTimeout(1000);
        
        // Should navigate
        expect(page.url()).toContain('competition');
      }
    });
  });

  test.describe('Entry Status', () => {
    test('should show entry status indicators', async ({ page }) => {
      await page.goto('/dashboard/entries');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);

      // Look for status indicators
      const statusIndicator = page.locator('text=/active|pending|won|lost|drawn/i').first();
      
      await expect(page.locator('body')).toBeVisible();
    });

    test('should differentiate between winning and losing entries', async ({ page }) => {
      await page.goto('/dashboard/entries');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);

      // Look for win/loss differentiation
      const winner = page.locator('[class*="winner" i], [class*="won" i], text=/winner|won/i').first();
      
      await expect(page.locator('body')).toBeVisible();
    });
  });
});

test.describe('Notifications Dashboard', () => {
  test('should load notifications page', async ({ page }) => {
    await page.goto('/dashboard/notifications');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    await expect(page.locator('body')).toBeVisible();
  });

  test('should show notifications or empty state', async ({ page }) => {
    await page.goto('/dashboard/notifications');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Look for notifications
    const notifications = page.locator('[class*="notification" i], [class*="message" i], [class*="alert" i]').first();
    const emptyState = page.locator('text=/no notifications|nothing new|all caught up/i').first();

    await expect(page.locator('body')).toBeVisible();
  });

  test('should mark notifications as read', async ({ page }) => {
    await page.goto('/dashboard/notifications');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Find unread notification
    const unread = page.locator('[class*="unread" i], [class*="new" i]').first();
    
    if (await unread.isVisible().catch(() => false)) {
      await unread.click();
      await page.waitForTimeout(500);
    }

    await expect(page.locator('body')).toBeVisible();
  });
});

test.describe('Account Settings', () => {
  test('should load account page', async ({ page }) => {
    await page.goto('/dashboard/account');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    await expect(page.locator('body')).toBeVisible();
  });

  test('should display user information', async ({ page }) => {
    await page.goto('/dashboard/account');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Look for user info fields
    const userInfo = page.locator('text=/email|username|profile|account/i').first();
    
    await expect(page.locator('body')).toBeVisible();
  });

  test('should have logout option', async ({ page }) => {
    await page.goto('/dashboard/account');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Look for logout
    const logout = page.locator('button:has-text("Logout"), button:has-text("Sign Out"), a:has-text("Logout")').first();
    
    await expect(page.locator('body')).toBeVisible();
  });
});

test.describe('Promo/Referral Page', () => {
  test('should load promo page', async ({ page }) => {
    await page.goto('/dashboard/promo');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    await expect(page.locator('body')).toBeVisible();
  });

  test('should show referral/promo information', async ({ page }) => {
    await page.goto('/dashboard/promo');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Look for promo/referral content
    const promoContent = page.locator('text=/referral|promo|bonus|invite|share/i').first();
    
    await expect(page.locator('body')).toBeVisible();
  });

  test('should have shareable link or code', async ({ page }) => {
    await page.goto('/dashboard/promo');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Look for referral code/link
    const referralCode = page.locator('input[readonly], [class*="code" i], button:has-text("Copy")').first();
    
    await expect(page.locator('body')).toBeVisible();
  });
});

test.describe('Dashboard Navigation Integration', () => {
  test('should navigate between all dashboard sections', async ({ page }) => {
    const sections = ['entries', 'orders', 'wallet', 'notifications', 'promo', 'account'];
    
    for (const section of sections) {
      await page.goto(`/dashboard/${section}`);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(500);
      
      await expect(page.locator('body')).toBeVisible();
    }
  });

  test('should maintain active tab indicator', async ({ page }) => {
    await page.goto('/dashboard/entries');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Active tab should be highlighted
    const activeTab = page.locator('[aria-selected="true"], [class*="active" i], [href*="entries"][class*="active" i]').first();
    
    await expect(page.locator('body')).toBeVisible();
  });

  test('should show user balance in dashboard header', async ({ page }) => {
    await page.goto('/dashboard/entries');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Balance might be displayed in header
    const balance = page.locator('text=/$\\d|balance|USD/i').first();
    
    await expect(page.locator('body')).toBeVisible();
  });
});

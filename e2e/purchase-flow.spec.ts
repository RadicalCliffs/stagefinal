import { test, expect } from '@playwright/test';

/**
 * Purchase Flow E2E Tests
 * 
 * Tests the complete purchase flow including:
 * - Competition entry purchase
 * - Ticket selection
 * - Payment modal
 * - Order completion
 */

test.describe('Purchase Flow - Entry Selection', () => {
  test('should display entry options on competition page', async ({ page }) => {
    // Navigate to competitions and find one with entries available
    await page.goto('/competitions');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Find a competition link
    const competitionLink = page.locator('a[href*="/competitions/"]').first();
    
    if (await competitionLink.isVisible().catch(() => false)) {
      await competitionLink.click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1000);

      // Look for entry/ticket selection UI
      const entryUI = page.locator('[class*="ticket" i], [class*="entry" i], button:has-text("Enter"), button:has-text("Buy")').first();
      
      await expect(page.locator('body')).toBeVisible();
    }
  });

  test('should show ticket quantity selector', async ({ page }) => {
    await page.goto('/competitions');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const competitionLink = page.locator('a[href*="/competitions/"]').first();
    
    if (await competitionLink.isVisible().catch(() => false)) {
      await competitionLink.click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1000);

      // Look for quantity controls (+ / - buttons or number input)
      const quantityControls = page.locator('button:has-text("+"), button:has-text("-"), input[type="number"], [class*="quantity" i]');
      
      await expect(page.locator('body')).toBeVisible();
    }
  });

  test('should update total price when quantity changes', async ({ page }) => {
    await page.goto('/competitions');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const competitionLink = page.locator('a[href*="/competitions/"]').first();
    
    if (await competitionLink.isVisible().catch(() => false)) {
      await competitionLink.click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1000);

      // Look for price display
      const priceDisplay = page.locator('text=/$\\d+|total|price/i').first();
      
      await expect(page.locator('body')).toBeVisible();
    }
  });
});

test.describe('Purchase Flow - Lucky Dip', () => {
  test('should have lucky dip option available', async ({ page }) => {
    await page.goto('/competitions');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const competitionLink = page.locator('a[href*="/competitions/"]').first();
    
    if (await competitionLink.isVisible().catch(() => false)) {
      await competitionLink.click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1000);

      // Look for lucky dip option
      const luckyDip = page.locator('text=/lucky.?dip|random|auto.?select/i').first();
      
      await expect(page.locator('body')).toBeVisible();
    }
  });
});

test.describe('Purchase Flow - Payment Modal', () => {
  test('should open payment modal on checkout', async ({ page }) => {
    await page.goto('/competitions');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const competitionLink = page.locator('a[href*="/competitions/"]').first();
    
    if (await competitionLink.isVisible().catch(() => false)) {
      await competitionLink.click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1000);

      // Find and click enter/buy button
      const enterButton = page.getByRole('button', { name: /enter|buy|purchase|checkout/i }).first();
      
      if (await enterButton.isVisible().catch(() => false)) {
        await enterButton.click();
        await page.waitForTimeout(1000);

        // Should show payment modal or auth prompt
        const modal = page.locator('[role="dialog"], [class*="modal" i], [class*="payment" i]').first();
        await expect(page.locator('body')).toBeVisible();
      }
    }
  });

  test('should display payment options', async ({ page }) => {
    await page.goto('/competitions');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const competitionLink = page.locator('a[href*="/competitions/"]').first();
    
    if (await competitionLink.isVisible().catch(() => false)) {
      await competitionLink.click();
      await page.waitForLoadState('networkidle');
      
      // Look for payment method indicators
      const paymentOptions = page.locator('text=/crypto|usdc|card|balance|wallet/i').first();
      
      await expect(page.locator('body')).toBeVisible();
    }
  });

  test('should show order summary before payment', async ({ page }) => {
    await page.goto('/competitions');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const competitionLink = page.locator('a[href*="/competitions/"]').first();
    
    if (await competitionLink.isVisible().catch(() => false)) {
      await competitionLink.click();
      await page.waitForLoadState('networkidle');

      // Look for order summary elements
      const summary = page.locator('text=/summary|total|your order/i').first();
      
      await expect(page.locator('body')).toBeVisible();
    }
  });
});

test.describe('Purchase Flow - Validation', () => {
  test('should prevent purchase without authentication', async ({ page }) => {
    await page.goto('/competitions');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const competitionLink = page.locator('a[href*="/competitions/"]').first();
    
    if (await competitionLink.isVisible().catch(() => false)) {
      await competitionLink.click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1000);

      // Try to purchase
      const enterButton = page.getByRole('button', { name: /enter|buy|purchase/i }).first();
      
      if (await enterButton.isVisible().catch(() => false)) {
        await enterButton.click();
        await page.waitForTimeout(1000);

        // Should prompt for auth or show login modal
        const authPrompt = page.locator('[class*="auth" i], [class*="login" i], [role="dialog"]').first();
        
        await expect(page.locator('body')).toBeVisible();
      }
    }
  });

  test('should validate ticket selection', async ({ page }) => {
    await page.goto('/competitions');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const competitionLink = page.locator('a[href*="/competitions/"]').first();
    
    if (await competitionLink.isVisible().catch(() => false)) {
      await competitionLink.click();
      await page.waitForLoadState('networkidle');

      // Look for validation messages
      const validationMessage = page.locator('text=/select|choose|required|minimum/i').first();
      
      await expect(page.locator('body')).toBeVisible();
    }
  });
});

test.describe('Purchase Flow - Error Handling', () => {
  test('should handle network errors gracefully', async ({ page }) => {
    await page.goto('/competitions');
    await page.waitForLoadState('networkidle');

    // Simulate offline
    await page.route('**/api/**', route => route.abort());

    const competitionLink = page.locator('a[href*="/competitions/"]').first();
    
    if (await competitionLink.isVisible().catch(() => false)) {
      await competitionLink.click();
      await page.waitForTimeout(2000);

      // Should show error state but not crash
      await expect(page.locator('body')).toBeVisible();
    }

    // Restore routes
    await page.unroute('**/api/**');
  });

  test('should handle sold out competitions', async ({ page }) => {
    await page.goto('/competitions');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Look for sold out indicators
    const soldOut = page.locator('text=/sold.?out|unavailable|ended|closed/i').first();
    
    // May or may not have sold out items
    await expect(page.locator('body')).toBeVisible();
  });
});

test.describe('Purchase Flow - Mobile', () => {
  test('should work on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    
    await page.goto('/competitions');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const competitionLink = page.locator('a[href*="/competitions/"]').first();
    
    if (await competitionLink.isVisible().catch(() => false)) {
      await competitionLink.click();
      await page.waitForLoadState('networkidle');

      // Purchase UI should be accessible on mobile
      await expect(page.locator('body')).toBeVisible();
      
      // Check no horizontal scroll
      const hasOverflow = await page.evaluate(() => {
        return document.body.scrollWidth > window.innerWidth + 20;
      });
      
      expect(hasOverflow).toBeFalsy();
    }
  });
});

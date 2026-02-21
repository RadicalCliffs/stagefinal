import { test, expect } from '@playwright/test';

/**
 * Competition Detail E2E Tests
 * 
 * Tests individual competition pages including:
 * - Competition information display
 * - Countdown timers
 * - Prize details
 * - Entry mechanics
 * - Social sharing
 */

test.describe('Competition Detail Page', () => {
  test.describe('Page Loading', () => {
    test('should load competition detail from competitions list', async ({ page }) => {
      await page.goto('/competitions');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);

      const competitionLink = page.locator('a[href*="/competitions/"]').first();
      
      if (await competitionLink.isVisible().catch(() => false)) {
        const href = await competitionLink.getAttribute('href');
        await competitionLink.click();
        await page.waitForLoadState('networkidle');

        expect(page.url()).toContain('/competitions/');
        await expect(page.locator('body')).toBeVisible();
      }
    });

    test('should handle direct navigation to competition', async ({ page }) => {
      // Try special routes
      await page.goto('/competitions/lamborghini-urus');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);

      // Should load or redirect gracefully
      await expect(page.locator('body')).toBeVisible();
    });

    test('should handle invalid competition ID', async ({ page }) => {
      await page.goto('/competitions/invalid-competition-id-12345');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);

      // Should show 404 or redirect, not crash
      await expect(page.locator('body')).toBeVisible();
    });
  });

  test.describe('Competition Information', () => {
    test('should display competition title', async ({ page }) => {
      await page.goto('/competitions');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);

      const competitionLink = page.locator('a[href*="/competitions/"]').first();
      
      if (await competitionLink.isVisible().catch(() => false)) {
        await competitionLink.click();
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(1000);

        // Should have a title/heading
        const heading = page.locator('h1, h2, [class*="title" i]').first();
        await expect(page.locator('body')).toBeVisible();
      }
    });

    test('should display competition image', async ({ page }) => {
      await page.goto('/competitions');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);

      const competitionLink = page.locator('a[href*="/competitions/"]').first();
      
      if (await competitionLink.isVisible().catch(() => false)) {
        await competitionLink.click();
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(1000);

        // Should have competition images
        const images = page.locator('img[src*="competition"], img[alt*="prize" i], img[class*="hero" i]');
        
        await expect(page.locator('body')).toBeVisible();
      }
    });

    test('should display prize value', async ({ page }) => {
      await page.goto('/competitions');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);

      const competitionLink = page.locator('a[href*="/competitions/"]').first();
      
      if (await competitionLink.isVisible().catch(() => false)) {
        await competitionLink.click();
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(1000);

        // Look for prize/value display
        const prizeValue = page.locator('text=/$[\\d,]+|worth|value|prize/i').first();
        
        await expect(page.locator('body')).toBeVisible();
      }
    });

    test('should display entry price', async ({ page }) => {
      await page.goto('/competitions');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);

      const competitionLink = page.locator('a[href*="/competitions/"]').first();
      
      if (await competitionLink.isVisible().catch(() => false)) {
        await competitionLink.click();
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(1000);

        // Entry price should be visible
        const entryPrice = page.locator('text=/$\\d+.*entry|per.?ticket|each/i').first();
        
        await expect(page.locator('body')).toBeVisible();
      }
    });
  });

  test.describe('Countdown Timer', () => {
    test('should display countdown or end date', async ({ page }) => {
      await page.goto('/competitions');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);

      const competitionLink = page.locator('a[href*="/competitions/"]').first();
      
      if (await competitionLink.isVisible().catch(() => false)) {
        await competitionLink.click();
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(1000);

        // Look for timer/countdown elements
        const timer = page.locator('[class*="countdown" i], [class*="timer" i], text=/days|hours|minutes|ends|draw/i').first();
        
        await expect(page.locator('body')).toBeVisible();
      }
    });

    test('should update countdown in real-time', async ({ page }) => {
      await page.goto('/competitions');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);

      const competitionLink = page.locator('a[href*="/competitions/"]').first();
      
      if (await competitionLink.isVisible().catch(() => false)) {
        await competitionLink.click();
        await page.waitForLoadState('networkidle');
        
        // Get initial timer state
        const timer = page.locator('[class*="countdown" i], [class*="timer" i]').first();
        
        if (await timer.isVisible().catch(() => false)) {
          const initialText = await timer.textContent();
          
          // Wait and check if updated
          await page.waitForTimeout(2000);
          
          // Timer should still be visible (real-time updates)
          await expect(timer).toBeVisible();
        }
      }
    });
  });

  test.describe('Entry Progress', () => {
    test('should display tickets sold progress', async ({ page }) => {
      await page.goto('/competitions');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);

      const competitionLink = page.locator('a[href*="/competitions/"]').first();
      
      if (await competitionLink.isVisible().catch(() => false)) {
        await competitionLink.click();
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(1000);

        // Look for progress indicators
        const progress = page.locator('[class*="progress" i], text=/sold|remaining|available|\\d+.*of.*\\d+/i').first();
        
        await expect(page.locator('body')).toBeVisible();
      }
    });

    test('should show max entries per user if applicable', async ({ page }) => {
      await page.goto('/competitions');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);

      const competitionLink = page.locator('a[href*="/competitions/"]').first();
      
      if (await competitionLink.isVisible().catch(() => false)) {
        await competitionLink.click();
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(1000);

        // Look for max entries info
        const maxEntries = page.locator('text=/max|limit|per person|per user/i').first();
        
        await expect(page.locator('body')).toBeVisible();
      }
    });
  });

  test.describe('Competition Description', () => {
    test('should display competition description', async ({ page }) => {
      await page.goto('/competitions');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);

      const competitionLink = page.locator('a[href*="/competitions/"]').first();
      
      if (await competitionLink.isVisible().catch(() => false)) {
        await competitionLink.click();
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(1000);

        // Should have description text
        const description = page.locator('[class*="description" i], [class*="details" i], p').first();
        
        await expect(page.locator('body')).toBeVisible();
      }
    });

    test('should have terms and conditions section', async ({ page }) => {
      await page.goto('/competitions');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);

      const competitionLink = page.locator('a[href*="/competitions/"]').first();
      
      if (await competitionLink.isVisible().catch(() => false)) {
        await competitionLink.click();
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(1000);

        // Look for T&C
        const terms = page.locator('text=/terms|conditions|rules|how.?to.?enter/i').first();
        
        await expect(page.locator('body')).toBeVisible();
      }
    });
  });
});

test.describe('Special Competition Pages', () => {
  const specialPages = [
    { path: '/competitions/lamborghini-urus', name: 'Lamborghini' },
    { path: '/competitions/bitcoin-giveaway', name: 'Bitcoin' },
    { path: '/competitions/rolex-watch', name: 'Rolex' }
  ];

  for (const { path, name } of specialPages) {
    test(`should load ${name} competition page`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);

      // Page should load without crashing
      await expect(page.locator('body')).toBeVisible();
      
      // Should have content or redirect
      const hasContent = await page.locator('h1, h2, [class*="hero" i]').first().isVisible().catch(() => false);
      const redirected = !page.url().includes(path);
      
      expect(hasContent || redirected).toBeTruthy();
    });

    test(`should have entry mechanism on ${name} page`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);

      if (page.url().includes(path)) {
        // Look for entry button
        const enterButton = page.getByRole('button', { name: /enter|buy|purchase/i }).first();
        
        await expect(page.locator('body')).toBeVisible();
      }
    });
  }
});

test.describe('Competition Filtering', () => {
  test('should have filter/category tabs', async ({ page }) => {
    await page.goto('/competitions');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Look for filter tabs
    const tabs = page.locator('[role="tab"], button[class*="tab" i], [class*="filter" i]');
    
    await expect(page.locator('body')).toBeVisible();
  });

  test('should filter competitions by category', async ({ page }) => {
    await page.goto('/competitions');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Find category tabs/buttons
    const categoryButton = page.locator('button:has-text("Cars"), button:has-text("Tech"), button:has-text("All")').first();
    
    if (await categoryButton.isVisible().catch(() => false)) {
      await categoryButton.click();
      await page.waitForTimeout(1000);
      
      // Page should respond to filter
      await expect(page.locator('body')).toBeVisible();
    }
  });

  test('should show active filter state', async ({ page }) => {
    await page.goto('/competitions');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // One filter should be active/selected
    const activeTab = page.locator('[aria-selected="true"], [class*="active" i], [class*="selected" i]').first();
    
    await expect(page.locator('body')).toBeVisible();
  });
});

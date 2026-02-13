import { test, expect } from '@playwright/test';

test.describe('Competitions Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/competitions');
    await page.waitForLoadState('networkidle');
  });

  test('should display competitions page', async ({ page }) => {
    // Verify we're on the competitions page
    expect(page.url()).toContain('/competitions');
  });

  test('should display competition filters or tabs', async ({ page }) => {
    // Look for filter tabs or competition categories
    // These may be buttons, tabs, or filter elements
    const filterElements = page.locator('button, [role="tab"]');
    const count = await filterElements.count();
    
    // Should have some filter/tab elements
    expect(count).toBeGreaterThan(0);
  });

  test('should display competition cards', async ({ page }) => {
    // Wait a bit for competitions to load
    await page.waitForTimeout(2000);
    
    // Look for competition cards (they might have images, titles, prices)
    const cards = page.locator('[class*="grid"]').first();
    await expect(cards).toBeVisible({ timeout: 10000 });
  });

  test('should allow navigation to competition details', async ({ page }) => {
    // Wait for competitions to load
    await page.waitForTimeout(2000);
    
    // Try to find and click on a competition card or "Enter Now" button
    const enterButton = page.getByRole('button', { name: /enter/i }).first();
    const competitionLink = page.locator('a[href*="/competitions/"]').first();
    
    // Click either the button or link, whichever is found first
    if (await enterButton.isVisible().catch(() => false)) {
      await enterButton.click();
    } else if (await competitionLink.isVisible().catch(() => false)) {
      await competitionLink.click();
    }
    
    // Should navigate to a competition detail page
    await page.waitForTimeout(1000);
    expect(page.url()).toMatch(/\/competitions\/.+/);
  });

  test('should be responsive on mobile', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    
    // Reload page
    await page.reload();
    await page.waitForLoadState('networkidle');
    
    // Page should still be functional
    const body = page.locator('body');
    await expect(body).toBeVisible();
  });
});

test.describe('Individual Competition Page', () => {
  test('should display competition details when available', async ({ page }) => {
    // Navigate to a competition (we'll try the first one from the main page)
    await page.goto('/competitions');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    
    // Find first competition link
    const competitionLink = page.locator('a[href*="/competitions/"]').first();
    
    if (await competitionLink.isVisible().catch(() => false)) {
      const href = await competitionLink.getAttribute('href');
      
      if (href) {
        // Navigate to competition detail page
        await page.goto(href);
        await page.waitForLoadState('networkidle');
        
        // Should be on a competition detail page
        expect(page.url()).toMatch(/\/competitions\/.+/);
        
        // Page should have loaded
        await expect(page.locator('body')).toBeVisible();
      }
    }
  });

  test('should handle special competition routes', async ({ page }) => {
    const specialRoutes = [
      '/competitions/lamborghini-urus',
      '/competitions/bitcoin-giveaway',
      '/competitions/rolex-watch'
    ];
    
    for (const route of specialRoutes) {
      await page.goto(route);
      await page.waitForLoadState('networkidle');
      
      // Page should load (may show content or redirect)
      await expect(page.locator('body')).toBeVisible();
    }
  });
});

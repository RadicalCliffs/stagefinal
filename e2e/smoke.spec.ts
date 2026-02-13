import { test, expect } from '@playwright/test';

test.describe('Smoke Tests - Critical Functionality', () => {
  test('homepage loads successfully', async ({ page }) => {
    await page.goto('/');
    
    // Wait for page to load
    await page.waitForLoadState('domcontentloaded');
    
    // Check that the page is visible
    await expect(page.locator('body')).toBeVisible();
    
    // Check that title is set
    const title = await page.title();
    expect(title).toBeTruthy();
  });

  test('can navigate to competitions page', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    
    // Navigate to competitions
    await page.goto('/competitions');
    await page.waitForLoadState('domcontentloaded');
    
    // Verify we're on competitions page
    expect(page.url()).toContain('/competitions');
    await expect(page.locator('body')).toBeVisible();
  });

  test('page is responsive', async ({ page }) => {
    // Test mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    
    await expect(page.locator('body')).toBeVisible();
  });
});

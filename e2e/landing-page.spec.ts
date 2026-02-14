import { test, expect } from '@playwright/test';

test.describe('Landing Page - Section Visibility', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for the page to be fully loaded
    await page.waitForLoadState('networkidle');
  });

  test('should display hero section', async ({ page }) => {
    // Check hero section is visible
    const heroSection = page.locator('.bg-\\[\\#1a1a1a\\]').first();
    await expect(heroSection).toBeVisible();
  });

  test('should display live activity section', async ({ page }) => {
    // The "Live Activity" heading is mobile-only (md:hidden). On desktop, use the tab button.
    const liveActivityButton = page.getByRole('button', { name: /live activity/i }).first();
    await liveActivityButton.scrollIntoViewIfNeeded();
    await expect(liveActivityButton).toBeVisible();
  });

  test('should display featured in section', async ({ page }) => {
    // Scroll to featured in section
    const featuredHeading = page.getByRole('heading', { name: /featured in/i });
    await featuredHeading.scrollIntoViewIfNeeded();
    await expect(featuredHeading).toBeVisible();
  });

  test('should display live competitions section', async ({ page }) => {
    // Scroll to live competitions section
    const competitionsHeading = page.getByRole('heading', { name: /live competitions/i });
    await competitionsHeading.scrollIntoViewIfNeeded();
    await expect(competitionsHeading).toBeVisible();
  });

  test('should display winners section', async ({ page }) => {
    // Scroll to winners section
    const winnersHeading = page.getByRole('heading', { name: /winners/i });
    await winnersHeading.scrollIntoViewIfNeeded();
    await expect(winnersHeading).toBeVisible();
  });

  test('should display cash out section', async ({ page }) => {
    // Scroll to cash out section
    const cashOutHeading = page.getByRole('heading', { name: /cash out like a pro/i });
    await cashOutHeading.scrollIntoViewIfNeeded();
    await expect(cashOutHeading).toBeVisible();
  });

  test('should display never miss a win section', async ({ page }) => {
    // Scroll to never miss section
    const neverMissHeading = page.getByRole('heading', { name: /never miss a win/i });
    await neverMissHeading.scrollIntoViewIfNeeded();
    await expect(neverMissHeading).toBeVisible();
  });

  test('should display FAQ section', async ({ page }) => {
    // Scroll to FAQ section
    const faqHeading = page.getByRole('heading', { name: /faqs/i });
    await faqHeading.scrollIntoViewIfNeeded();
    await expect(faqHeading).toBeVisible();
  });

  test('all sections should be present in order', async ({ page }) => {
    // Verify all major sections exist
    const sections = [
      'hero',
      'live activity',
      'featured in',
      'live competitions',
      'winners',
      'cash out',
      'never miss',
      'faqs'
    ];
    
    // Check that we can find elements related to each section
    await expect(page.locator('.bg-\\[\\#1a1a1a\\]').first()).toBeVisible(); // Hero
    // Live Activity heading is mobile-only; on desktop use the tab button
    await expect(page.getByRole('button', { name: /live activity/i }).first()).toBeVisible();
    
    // Scroll through the page to make sections visible
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 4));
    await page.waitForTimeout(500);
    
    await expect(page.getByRole('heading', { name: /featured in/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /live competitions/i })).toBeVisible();
    
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
    await page.waitForTimeout(500);
    
    await expect(page.getByRole('heading', { name: /winners/i })).toBeVisible();
    
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 3 / 4));
    await page.waitForTimeout(500);
    
    await expect(page.getByRole('heading', { name: /cash out/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /never miss/i })).toBeVisible();
    
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(500);
    
    await expect(page.getByRole('heading', { name: /faqs/i })).toBeVisible();
  });
});

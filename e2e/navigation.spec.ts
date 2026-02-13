import { test, expect } from '@playwright/test';

test.describe('Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('should have a header with navigation links', async ({ page }) => {
    // Check header is visible
    const header = page.locator('header').first();
    await expect(header).toBeVisible();
  });

  test('should navigate to competitions page', async ({ page }) => {
    // Find and click the competitions link
    const competitionsLink = page.getByRole('link', { name: /competitions/i }).first();
    await competitionsLink.click();
    
    // Wait for navigation
    await page.waitForURL('**/competitions');
    
    // Verify we're on the competitions page
    expect(page.url()).toContain('/competitions');
  });

  test('should navigate to winners page', async ({ page }) => {
    // Find and click the winners link
    const winnersLink = page.getByRole('link', { name: /winners/i }).first();
    await winnersLink.click();
    
    // Wait for navigation
    await page.waitForURL('**/winners');
    
    // Verify we're on the winners page
    expect(page.url()).toContain('/winners');
  });

  test('should navigate to about page', async ({ page }) => {
    // Find and click the about link
    const aboutLink = page.getByRole('link', { name: /about/i }).first();
    await aboutLink.click();
    
    // Wait for navigation
    await page.waitForURL('**/about');
    
    // Verify we're on the about page
    expect(page.url()).toContain('/about');
  });

  test('should navigate to FAQ page', async ({ page }) => {
    // Find and click the FAQ link
    const faqLink = page.getByRole('link', { name: /faq/i }).first();
    await faqLink.click();
    
    // Wait for navigation
    await page.waitForURL('**/faq');
    
    // Verify we're on the FAQ page
    expect(page.url()).toContain('/faq');
  });

  test('should navigate back to home from other pages', async ({ page }) => {
    // Go to competitions page
    await page.goto('/competitions');
    await page.waitForLoadState('networkidle');
    
    // Click logo or home link to return to homepage
    const logoLink = page.locator('a[href="/"]').first();
    await logoLink.click();
    
    // Wait for navigation
    await page.waitForURL('/');
    
    // Verify we're back on the home page
    expect(page.url()).not.toContain('/competitions');
  });

  test('should have footer with links', async ({ page }) => {
    // Scroll to footer
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(500);
    
    // Check footer is visible
    const footer = page.locator('footer').first();
    await expect(footer).toBeVisible();
  });

  test('should navigate through footer links', async ({ page }) => {
    // Scroll to footer
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(500);
    
    // Find privacy policy link in footer
    const privacyLink = page.getByRole('link', { name: /privacy policy/i }).first();
    await privacyLink.click();
    
    // Wait for navigation
    await page.waitForURL('**/privacy-policy');
    
    // Verify we're on the privacy policy page
    expect(page.url()).toContain('/privacy-policy');
  });
});

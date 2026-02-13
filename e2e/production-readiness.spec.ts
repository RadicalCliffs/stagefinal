import { test, expect } from '@playwright/test';

test.describe('Production Readiness', () => {
  test('should load the homepage without errors', async ({ page }) => {
    // Track console errors
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Should have no critical console errors
    const criticalErrors = errors.filter(err => 
      !err.includes('favicon') && // Ignore favicon errors
      !err.includes('GA_') && // Ignore GA warnings when not configured
      !err.includes('Measurement ID') // Ignore GA measurement ID warnings
    );
    
    expect(criticalErrors.length).toBe(0);
  });

  test('should have proper meta tags', async ({ page }) => {
    await page.goto('/');
    
    // Check for viewport meta tag
    const viewport = await page.locator('meta[name="viewport"]').getAttribute('content');
    expect(viewport).toBeTruthy();
    
    // Check for title
    const title = await page.title();
    expect(title).toBeTruthy();
    expect(title.length).toBeGreaterThan(0);
  });

  test('should load all critical resources', async ({ page }) => {
    const failedRequests: string[] = [];
    
    page.on('requestfailed', request => {
      // Track failed requests
      const url = request.url();
      // Ignore analytics and external resources that may fail
      if (!url.includes('google-analytics') && !url.includes('googletagmanager')) {
        failedRequests.push(url);
      }
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Should have no failed requests for critical resources
    expect(failedRequests.length).toBe(0);
  });

  test('should be accessible with keyboard navigation', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Press Tab to navigate through interactive elements
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');

    // At least one element should be focused
    const focusedElement = await page.evaluate(() => document.activeElement?.tagName);
    expect(focusedElement).toBeTruthy();
  });

  test('should handle responsive layouts', async ({ page }) => {
    const viewports = [
      { width: 375, height: 667, name: 'Mobile' },
      { width: 768, height: 1024, name: 'Tablet' },
      { width: 1920, height: 1080, name: 'Desktop' }
    ];

    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // Check that content is visible
      const body = page.locator('body');
      await expect(body).toBeVisible();

      // Check that layout is not broken (no horizontal scroll on mobile)
      if (viewport.name === 'Mobile') {
        const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
        const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
        // Allow 20px margin for scrollbar width and subpixel rendering differences
        expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 20);
      }
    }
  });

  test('should have working header and footer on all pages', async ({ page }) => {
    const pages = ['/', '/competitions', '/winners', '/about', '/faq'];

    for (const pagePath of pages) {
      await page.goto(pagePath);
      await page.waitForLoadState('networkidle');

      // Check header is visible
      const header = page.locator('header').first();
      await expect(header).toBeVisible();

      // Scroll to footer
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(500);

      // Check footer is visible
      const footer = page.locator('footer').first();
      await expect(footer).toBeVisible();
    }
  });

  test('should handle 404 gracefully', async ({ page }) => {
    await page.goto('/this-page-does-not-exist-12345');
    await page.waitForLoadState('networkidle');

    // Page should load (even if it's a 404 page or redirects to home)
    const body = page.locator('body');
    await expect(body).toBeVisible();
  });

  test('should have no accessibility violations on key pages', async ({ page }) => {
    const pages = ['/', '/competitions', '/winners'];

    for (const pagePath of pages) {
      await page.goto(pagePath);
      await page.waitForLoadState('networkidle');

      // Check for basic accessibility: images should have alt text
      const images = await page.locator('img').all();
      for (const img of images.slice(0, 10)) { // Check first 10 images
        const alt = await img.getAttribute('alt');
        // Alt can be empty string for decorative images, but should exist
        expect(alt !== null).toBe(true);
      }
    }
  });

  test('should load within reasonable time', async ({ page }) => {
    const startTime = Date.now();
    
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    const loadTime = Date.now() - startTime;
    
    // Page should load within 10 seconds (reasonable for development)
    expect(loadTime).toBeLessThan(10000);
  });

  test('should have functional scroll restoration', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Scroll down
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
    await page.waitForTimeout(500);
    
    const scrollPosition = await page.evaluate(() => window.scrollY);
    expect(scrollPosition).toBeGreaterThan(0);

    // Navigate to another page
    await page.goto('/competitions');
    await page.waitForLoadState('networkidle');

    // Navigate back
    await page.goBack();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    // Should be at top (scroll restoration works)
    const newScrollPosition = await page.evaluate(() => window.scrollY);
    expect(newScrollPosition).toBe(0);
  });
});

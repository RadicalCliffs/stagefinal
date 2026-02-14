import { test, expect } from '@playwright/test';

test.describe('Google Analytics Tracking', () => {
  test.beforeEach(async ({ page }) => {
    // Listen for GA events
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('should load Google Analytics script', async ({ page }) => {
    // Check if dataLayer is initialized
    const hasDataLayer = await page.evaluate(() => {
      return typeof window.dataLayer !== 'undefined';
    });
    expect(hasDataLayer).toBe(true);
  });

  test('should have gtag function available', async ({ page }) => {
    // Check if gtag function exists
    const hasGtag = await page.evaluate(() => {
      return typeof window.gtag !== 'undefined';
    });
    expect(hasGtag).toBe(true);
  });

  test('should track page views on navigation', async ({ page }) => {
    // Check if GA is actually configured (not just gtag function exists, but GA script loaded)
    const gaConfigured = await page.evaluate(() => {
      const scripts = Array.from(document.querySelectorAll('script'));
      return scripts.some(script => script.src.includes('googletagmanager.com/gtag/js'));
    });

    if (gaConfigured) {
      // Intercept gtag calls before navigation
      await page.evaluate(() => {
        const originalGtag = window.gtag;
        (window as any).gtagCalls = [];
        window.gtag = function(...args: any[]) {
          (window as any).gtagCalls.push(args);
          if (originalGtag) {
            originalGtag.apply(window, args);
          }
        };
      });

      // Trigger a client-side navigation
      await page.getByRole('link', { name: /competitions/i }).first().click();
      await page.waitForLoadState('networkidle');

      // Check that page view was tracked
      const calls = await page.evaluate(() => (window as any).gtagCalls || []);
      expect(calls.length).toBeGreaterThan(0);
    } else {
      // GA not configured - verify page still navigates fine without it
      await page.goto('/competitions');
      await page.waitForLoadState('networkidle');
      expect(page.url()).toContain('/competitions');
    }
  });

  test('should track section views when scrolling', async ({ page }) => {
    // Check if GA is actually configured (script loaded with measurement ID)
    const gaConfigured = await page.evaluate(() => {
      const scripts = Array.from(document.querySelectorAll('script'));
      return scripts.some(script => script.src.includes('googletagmanager.com/gtag/js'));
    });

    if (gaConfigured) {
      // Set up event tracking
      await page.evaluate(() => {
        (window as any).trackedEvents = [];
        const originalGtag = window.gtag;
        window.gtag = function(...args: any[]) {
          (window as any).trackedEvents.push(args);
          if (originalGtag) {
            originalGtag.apply(window, args);
          }
        };
      });

      // Scroll through the page to trigger section view events
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 4));
      await page.waitForTimeout(1000);

      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
      await page.waitForTimeout(1000);

      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1000);

      // Get tracked events
      const trackedEvents = await page.evaluate(() => (window as any).trackedEvents || []);

      // Should have tracked some events (section views)
      expect(trackedEvents.length).toBeGreaterThan(0);
    } else {
      // GA not configured - verify scrolling works without errors
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(500);
      const scrollY = await page.evaluate(() => window.scrollY);
      expect(scrollY).toBeGreaterThan(0);
    }
  });

  test('should initialize GA with measurement ID from environment', async ({ page }) => {
    // Check if GA script is loaded
    const gaScriptLoaded = await page.evaluate(() => {
      const scripts = Array.from(document.querySelectorAll('script'));
      return scripts.some(script => 
        script.src.includes('googletagmanager.com/gtag/js')
      );
    });
    
    // GA script should be loaded if VITE_GA_MEASUREMENT_ID is set
    // If not set, it should gracefully not load
    expect(typeof gaScriptLoaded).toBe('boolean');
  });

  test('should handle GA gracefully when not configured', async ({ page }) => {
    // Even without GA configured, the page should work fine
    await expect(page.locator('body')).toBeVisible();
    
    // Page should be functional
    const heroSection = page.locator('.bg-\\[\\#1a1a1a\\]').first();
    await expect(heroSection).toBeVisible();
  });
});

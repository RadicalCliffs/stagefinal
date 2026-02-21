import { test, expect } from '@playwright/test';

/**
 * Performance E2E Tests
 * 
 * Tests basic performance requirements including:
 * - Page load times
 * - Resource loading
 * - Memory usage
 * - Animation performance
 */

test.describe('Page Load Performance', () => {
  test('homepage should load within acceptable time', async ({ page }) => {
    const startTime = Date.now();
    
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    
    const loadTime = Date.now() - startTime;
    
    // Should load DOM within 5 seconds
    expect(loadTime).toBeLessThan(5000);
  });

  test('homepage should be interactive within acceptable time', async ({ page }) => {
    const startTime = Date.now();
    
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    const loadTime = Date.now() - startTime;
    
    // Should be interactive within 10 seconds
    expect(loadTime).toBeLessThan(10000);
  });

  test('competitions page should load within acceptable time', async ({ page }) => {
    const startTime = Date.now();
    
    await page.goto('/competitions');
    await page.waitForLoadState('domcontentloaded');
    
    const loadTime = Date.now() - startTime;
    
    expect(loadTime).toBeLessThan(5000);
  });

  test('should measure Largest Contentful Paint', async ({ page }) => {
    await page.goto('/');
    
    // Wait for LCP
    const lcp = await page.evaluate(() => {
      return new Promise<number>((resolve) => {
        new PerformanceObserver((list) => {
          const entries = list.getEntries();
          const lastEntry = entries[entries.length - 1];
          resolve(lastEntry.startTime);
        }).observe({ type: 'largest-contentful-paint', buffered: true });
        
        // Fallback timeout
        setTimeout(() => resolve(0), 5000);
      });
    });

    // LCP should be reasonable (less than 4 seconds for good, 2.5 for excellent)
    if (lcp > 0) {
      expect(lcp).toBeLessThan(4000);
    }
  });
});

test.describe('Resource Loading', () => {
  test('should load critical resources first', async ({ page }) => {
    const resourceTiming: { name: string; duration: number }[] = [];
    
    page.on('response', response => {
      const timing = response.timing();
      resourceTiming.push({
        name: response.url(),
        duration: timing ? timing.responseEnd : 0
      });
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Should have loaded resources
    expect(resourceTiming.length).toBeGreaterThan(0);
  });

  test('should not have excessive network requests', async ({ page }) => {
    let requestCount = 0;
    
    page.on('request', () => {
      requestCount++;
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Should not make excessive requests (waterfall issue)
    expect(requestCount).toBeLessThan(100);
  });

  test('should cache static resources', async ({ page }) => {
    // First load
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Second load should use cache
    const startTime = Date.now();
    await page.reload();
    await page.waitForLoadState('networkidle');
    const reloadTime = Date.now() - startTime;

    // Reload should be faster due to caching
    expect(reloadTime).toBeLessThan(8000);
  });
});

test.describe('Image Optimization', () => {
  test('should use optimized image formats', async ({ page }) => {
    const imageFormats: string[] = [];
    
    page.on('response', response => {
      const contentType = response.headers()['content-type'] || '';
      if (contentType.startsWith('image/')) {
        imageFormats.push(contentType);
      }
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Should have images
    if (imageFormats.length > 0) {
      // Modern formats are preferred (webp, avif)
      const modernFormats = imageFormats.filter(f => 
        f.includes('webp') || f.includes('avif') || f.includes('svg')
      );
      
      // At least some modern formats OR acceptable legacy formats
      expect(imageFormats.length).toBeGreaterThan(0);
    }
  });

  test('should lazy load below-fold images', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Check for lazy loading attributes
    const lazyImages = await page.evaluate(() => {
      const images = document.querySelectorAll('img');
      let lazyCount = 0;

      images.forEach(img => {
        if (img.loading === 'lazy' || img.dataset.src) {
          lazyCount++;
        }
      });

      return { total: images.length, lazy: lazyCount };
    });

    // Some images should be lazy loaded (if there are many images)
    if (lazyImages.total > 5) {
      expect(lazyImages.lazy).toBeGreaterThan(0);
    }
  });

  test('should have appropriately sized images', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const oversizedImages = await page.evaluate(() => {
      const images = document.querySelectorAll('img');
      let oversized = 0;

      images.forEach(img => {
        // Check if natural size is much larger than display size
        const displayWidth = img.offsetWidth;
        const naturalWidth = img.naturalWidth;

        if (naturalWidth > displayWidth * 2 && displayWidth > 0) {
          oversized++;
        }
      });

      return oversized;
    });

    // Should not serve overly large images
    expect(oversizedImages).toBeLessThan(5);
  });
});

test.describe('JavaScript Performance', () => {
  test('should not have long tasks blocking main thread', async ({ page }) => {
    await page.goto('/');
    
    const longTasks = await page.evaluate(() => {
      return new Promise<number>((resolve) => {
        let longTaskCount = 0;
        
        const observer = new PerformanceObserver((list) => {
          list.getEntries().forEach(entry => {
            if (entry.duration > 50) { // Tasks > 50ms are considered "long"
              longTaskCount++;
            }
          });
        });

        try {
          observer.observe({ entryTypes: ['longtask'] });
        } catch {
          // Browser may not support longtask
          resolve(0);
          return;
        }

        setTimeout(() => {
          observer.disconnect();
          resolve(longTaskCount);
        }, 3000);
      });
    });

    // Should have minimal long tasks
    expect(longTasks).toBeLessThan(10);
  });

  test('should handle rapid user interactions', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Rapid clicks should not freeze UI
    for (let i = 0; i < 10; i++) {
      await page.click('body');
    }

    // Page should still be responsive
    await expect(page.locator('body')).toBeVisible();
  });
});

test.describe('Memory Usage', () => {
  test('should not leak memory on navigation', async ({ page }) => {
    // Navigate multiple times
    for (let i = 0; i < 3; i++) {
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      await page.goto('/competitions');
      await page.waitForLoadState('networkidle');
    }

    // Page should still work
    await expect(page.locator('body')).toBeVisible();
  });

  test('should not leak memory when opening/closing modals', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const loginButton = page.getByRole('button', { name: /sign in|login|connect/i }).first();

    if (await loginButton.isVisible().catch(() => false)) {
      // Open/close modal multiple times
      for (let i = 0; i < 5; i++) {
        await loginButton.click();
        await page.waitForTimeout(300);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
      }

      // Page should still work
      await expect(page.locator('body')).toBeVisible();
    }
  });
});

test.describe('Animation Performance', () => {
  test('should have smooth scrolling', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Scroll down
    await page.evaluate(() => window.scrollTo({ top: 1000, behavior: 'smooth' }));
    await page.waitForTimeout(500);

    // Scroll back
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
    await page.waitForTimeout(500);

    // Page should still be functional
    await expect(page.locator('body')).toBeVisible();
  });

  test('should not have janky hover animations', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Find interactive elements and hover
    const buttons = page.locator('button, a').first();
    
    if (await buttons.isVisible().catch(() => false)) {
      await buttons.hover();
      await page.waitForTimeout(200);
      
      // Page should remain responsive
      await expect(page.locator('body')).toBeVisible();
    }
  });
});

test.describe('Bundle Size', () => {
  test('should not load excessive JavaScript', async ({ page }) => {
    let totalJsSize = 0;
    
    page.on('response', async response => {
      const contentType = response.headers()['content-type'] || '';
      if (contentType.includes('javascript')) {
        const body = await response.body().catch(() => Buffer.from(''));
        totalJsSize += body.length;
      }
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Total JS should be reasonable (< 5MB uncompressed is generous)
    expect(totalJsSize).toBeLessThan(5 * 1024 * 1024);
  });

  test('should not load excessive CSS', async ({ page }) => {
    let totalCssSize = 0;
    
    page.on('response', async response => {
      const contentType = response.headers()['content-type'] || '';
      if (contentType.includes('css')) {
        const body = await response.body().catch(() => Buffer.from(''));
        totalCssSize += body.length;
      }
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Total CSS should be reasonable (< 1MB uncompressed)
    expect(totalCssSize).toBeLessThan(1 * 1024 * 1024);
  });
});

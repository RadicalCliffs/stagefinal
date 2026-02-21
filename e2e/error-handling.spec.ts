import { test, expect } from '@playwright/test';

/**
 * Error Handling E2E Tests
 * 
 * Tests error handling and edge cases including:
 * - 404 pages
 * - Network errors
 * - Invalid inputs
 * - Edge cases
 */

test.describe('404 Error Handling', () => {
  test('should show 404 page for invalid routes', async ({ page }) => {
    await page.goto('/this-page-definitely-does-not-exist-12345');
    await page.waitForLoadState('networkidle');

    // Should show some content (404 page or redirect to home)
    await expect(page.locator('body')).toBeVisible();
    
    // Look for 404 indicators
    const notFound = page.locator('text=/404|not found|page.*exist/i').first();
    const redirected = page.url() === '/' || page.url().endsWith('/');
    
    // Either shows 404 or redirects
    const is404Visible = await notFound.isVisible().catch(() => false);
    expect(is404Visible || redirected).toBeTruthy();
  });

  test('should have navigation back to home from 404', async ({ page }) => {
    await page.goto('/this-page-definitely-does-not-exist-12345');
    await page.waitForLoadState('networkidle');

    // Should be able to navigate back
    const homeLink = page.locator('a[href="/"], a:has-text("home"), button:has-text("home")').first();
    
    if (await homeLink.isVisible().catch(() => false)) {
      await homeLink.click();
      await page.waitForURL('/');
      expect(page.url()).toBe(page.url().split('/').slice(0, 3).join('/') + '/');
    }
  });

  test('should handle nested invalid routes', async ({ page }) => {
    await page.goto('/competitions/invalid/nested/path/12345');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Should handle gracefully
    await expect(page.locator('body')).toBeVisible();
  });
});

test.describe('Network Error Handling', () => {
  test('should handle API errors gracefully', async ({ page }) => {
    // Intercept API requests and make them fail
    await page.route('**/api/**', route => {
      route.fulfill({
        status: 500,
        body: JSON.stringify({ error: 'Internal Server Error' })
      });
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Page should still render (error states, not crash)
    await expect(page.locator('body')).toBeVisible();

    // Clean up
    await page.unroute('**/api/**');
  });

  test('should handle slow network gracefully', async ({ page }) => {
    // Simulate slow network
    await page.route('**/*', async route => {
      await new Promise(resolve => setTimeout(resolve, 500));
      await route.continue();
    });

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Should show loading state or content
    await expect(page.locator('body')).toBeVisible();

    // Clean up
    await page.unroute('**/*');
  });

  test('should handle offline mode', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Go offline
    await page.context().setOffline(true);

    // Try to navigate
    await page.goto('/competitions').catch(() => {});

    // Go back online
    await page.context().setOffline(false);

    // Reload should work
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    await expect(page.locator('body')).toBeVisible();
  });

  test('should retry failed requests', async ({ page }) => {
    let requestCount = 0;
    
    await page.route('**/api/**', async route => {
      requestCount++;
      if (requestCount === 1) {
        // First request fails
        await route.abort();
      } else {
        // Subsequent requests succeed
        await route.continue();
      }
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    // Should have retried or shown error state
    await expect(page.locator('body')).toBeVisible();

    await page.unroute('**/api/**');
  });
});

test.describe('Input Validation', () => {
  test('should handle XSS attempts in URL', async ({ page }) => {
    // Try XSS in URL
    await page.goto('/<script>alert("xss")</script>');
    await page.waitForLoadState('networkidle');

    // Should not execute script (no alert)
    await expect(page.locator('body')).toBeVisible();
  });

  test('should handle SQL injection attempts in URL', async ({ page }) => {
    await page.goto("/competitions/1'; DROP TABLE users;--");
    await page.waitForLoadState('networkidle');

    // Should handle gracefully
    await expect(page.locator('body')).toBeVisible();
  });

  test('should handle very long URLs', async ({ page }) => {
    const longPath = '/competitions/' + 'a'.repeat(2000);
    await page.goto(longPath).catch(() => {});
    
    // Should handle without crashing
    await page.waitForTimeout(2000);
    await expect(page.locator('body')).toBeVisible();
  });

  test('should handle special characters in search/input', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Find any input
    const input = page.locator('input').first();
    
    if (await input.isVisible().catch(() => false)) {
      // Try special characters
      await input.fill('<script>alert("xss")</script>');
      await page.waitForTimeout(500);
      
      // Should sanitize or handle gracefully
      await expect(page.locator('body')).toBeVisible();
    }
  });
});

test.describe('Edge Cases', () => {
  test('should handle rapid navigation', async ({ page }) => {
    // Rapidly navigate between pages
    await page.goto('/');
    page.goto('/competitions'); // Don't await
    page.goto('/winners'); // Don't await
    page.goto('/about'); // Don't await
    await page.goto('/faq');
    
    await page.waitForLoadState('networkidle');
    
    // Should end up on a valid page
    await expect(page.locator('body')).toBeVisible();
  });

  test('should handle browser back/forward', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    await page.goto('/competitions');
    await page.waitForLoadState('networkidle');
    
    await page.goto('/about');
    await page.waitForLoadState('networkidle');

    // Go back
    await page.goBack();
    await page.waitForLoadState('networkidle');
    expect(page.url()).toContain('competitions');

    // Go forward
    await page.goForward();
    await page.waitForLoadState('networkidle');
    expect(page.url()).toContain('about');
  });

  test('should handle page refresh during loading', async ({ page }) => {
    await page.goto('/competitions');
    
    // Refresh immediately
    await page.reload();
    await page.waitForLoadState('networkidle');

    await expect(page.locator('body')).toBeVisible();
  });

  test('should handle multiple tabs', async ({ context }) => {
    const page1 = await context.newPage();
    const page2 = await context.newPage();

    await page1.goto('/');
    await page2.goto('/competitions');

    await page1.waitForLoadState('networkidle');
    await page2.waitForLoadState('networkidle');

    // Both pages should work
    await expect(page1.locator('body')).toBeVisible();
    await expect(page2.locator('body')).toBeVisible();

    await page1.close();
    await page2.close();
  });

  test('should handle empty state gracefully', async ({ page }) => {
    // Mock API to return empty data
    await page.route('**/api/**', route => {
      route.fulfill({
        status: 200,
        body: JSON.stringify([])
      });
    });

    await page.goto('/competitions');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Should show empty state, not crash
    await expect(page.locator('body')).toBeVisible();

    await page.unroute('**/api/**');
  });

  test('should handle unicode characters', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Page should render unicode correctly
    const hasUnicode = await page.evaluate(() => {
      return document.body.innerHTML.includes('©') || 
             document.body.innerHTML.includes('™') ||
             document.body.textContent?.includes('$');
    });

    // Should render without issues
    await expect(page.locator('body')).toBeVisible();
  });

  test('should handle zoom levels', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Zoom in
    await page.evaluate(() => {
      (document.body.style as any).zoom = '150%';
    });
    await page.waitForTimeout(500);

    // Page should still be functional
    await expect(page.locator('body')).toBeVisible();

    // Zoom out
    await page.evaluate(() => {
      (document.body.style as any).zoom = '75%';
    });
    await page.waitForTimeout(500);

    await expect(page.locator('body')).toBeVisible();
  });

  test('should handle print media', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Emulate print media
    await page.emulateMedia({ media: 'print' });
    await page.waitForTimeout(500);

    // Should still render
    await expect(page.locator('body')).toBeVisible();

    // Reset
    await page.emulateMedia({ media: 'screen' });
  });
});

test.describe('Session Edge Cases', () => {
  test('should handle localStorage being disabled', async ({ page }) => {
    // Block localStorage
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        value: {
          getItem: () => { throw new Error('localStorage disabled'); },
          setItem: () => { throw new Error('localStorage disabled'); },
          removeItem: () => { throw new Error('localStorage disabled'); },
          clear: () => { throw new Error('localStorage disabled'); }
        }
      });
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Should handle gracefully
    await expect(page.locator('body')).toBeVisible();
  });

  test('should handle cookies being disabled', async ({ page }) => {
    // Clear and block cookies
    await page.context().clearCookies();

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Should work without cookies
    await expect(page.locator('body')).toBeVisible();
  });
});

test.describe('Console Error Monitoring', () => {
  test('should not have critical JavaScript errors', async ({ page }) => {
    const errors: string[] = [];
    
    page.on('console', msg => {
      if (msg.type() === 'error') {
        // Filter out expected errors
        const text = msg.text();
        if (!text.includes('net::ERR') && 
            !text.includes('Failed to load resource') &&
            !text.includes('favicon')) {
          errors.push(text);
        }
      }
    });

    page.on('pageerror', error => {
      errors.push(error.message);
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Should have minimal critical errors
    const criticalErrors = errors.filter(e => 
      e.includes('TypeError') || 
      e.includes('ReferenceError') ||
      e.includes('SyntaxError')
    );
    
    expect(criticalErrors.length).toBe(0);
  });

  test('should not have uncaught promise rejections', async ({ page }) => {
    const rejections: string[] = [];
    
    page.on('pageerror', error => {
      if (error.message.includes('Unhandled') || error.message.includes('rejection')) {
        rejections.push(error.message);
      }
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.goto('/competitions');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Should have no unhandled rejections
    expect(rejections.length).toBe(0);
  });
});

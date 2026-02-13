# Google Analytics Implementation & E2E Testing

## Overview

This implementation adds comprehensive Google Analytics tracking to all major sections of ThePrize.io and includes a complete end-to-end testing suite to ensure production readiness.

## Google Analytics Implementation

### Configuration

1. **Environment Variable**: Add your Google Analytics Measurement ID to `.env`:
   ```
   VITE_GA_MEASUREMENT_ID=G-XXXXXXXXXX
   ```

2. **Initialization**: GA is automatically initialized when the app starts (see `src/main.tsx`)

### Tracking Features

#### 1. Automatic Page View Tracking
- Tracks all route changes automatically via `usePageTracking` hook in App component
- Records page path and title for each navigation

#### 2. Section Visibility Tracking
The following sections are tracked when they become visible (50% threshold):

- **Hero Section** - Main landing page hero
- **Live Activity** - Real-time activity feed
- **Featured In** - Press/media logos
- **Live Competitions** - Active competitions grid
- **Winners** - Recent winners showcase
- **Cash Out** - Bitget wallet card promotion
- **Never Miss Game** - Telegram/app promotion
- **FAQ Section** - Frequently asked questions

#### 3. Custom Event Tracking
Available utility functions in `src/lib/analytics.ts`:

```typescript
// Track custom events
trackEvent(eventName: string, params?: object)

// Track section views
trackSectionView(sectionName: string, additionalData?: object)

// Track user interactions
trackInteraction(action: string, category: string, label?: string, value?: number)

// Track competition-specific events
trackCompetitionEvent(action: 'view' | 'enter' | 'share', competitionId: string, competitionName?: string)
```

### Implementation Details

- **`src/lib/analytics.ts`**: Core GA utilities
- **`src/hooks/usePageTracking.ts`**: Automatic page view tracking hook
- **`src/hooks/useSectionTracking.ts`**: Section visibility tracking hook using Intersection Observer
- **`index.html`**: GA script initialization
- **`src/main.tsx`**: GA initialization on app load
- **`src/App.tsx`**: Page tracking integration

## E2E Testing Suite

### Test Framework
- **Playwright** for end-to-end testing
- **Chromium** as primary test browser
- **Configuration**: `playwright.config.ts`

### Test Suites

#### 1. Landing Page Tests (`e2e/landing-page.spec.ts`)
Tests all major sections are visible:
- Hero section
- Live activity section
- Featured in section
- Live competitions section
- Winners section
- Cash out section
- Never miss a win section
- FAQ section
- Verifies sections appear in correct order

#### 2. Navigation Tests (`e2e/navigation.spec.ts`)
Tests site navigation:
- Header navigation links
- Footer navigation links
- Navigation to: competitions, winners, about, FAQ
- Back navigation
- Logo/home link functionality

#### 3. Analytics Tests (`e2e/analytics.spec.ts`)
Verifies GA tracking:
- GA script loads correctly
- `gtag` function is available
- `dataLayer` is initialized
- Page views are tracked on navigation
- Section views are tracked on scroll
- Graceful handling when GA not configured

#### 4. Competitions Tests (`e2e/competitions.spec.ts`)
Tests competition pages:
- Competitions page loads
- Filter/tab functionality
- Competition cards display
- Navigation to competition details
- Responsive layout on mobile
- Special competition routes (Lamborghini, Bitcoin, Rolex)

#### 5. Production Readiness Tests (`e2e/production-readiness.spec.ts`)
Comprehensive production checks:
- No console errors on load
- Proper meta tags configured
- All critical resources load successfully
- Keyboard navigation works
- Responsive layouts (mobile, tablet, desktop)
- Header and footer on all pages
- 404 handling
- Basic accessibility checks
- Page load performance
- Scroll restoration

#### 6. Smoke Tests (`e2e/smoke.spec.ts`)
Quick critical functionality tests:
- Homepage loads
- Can navigate to competitions
- Responsive on mobile

### Running Tests

```bash
# Install Playwright browsers (first time only)
npm run test:install
# or
npx playwright install

# Run all e2e tests
npm run test:e2e

# Run specific test file
npx playwright test e2e/smoke.spec.ts

# Run with UI mode (interactive)
npm run test:e2e:ui

# Run headed (visible browser)
npm run test:e2e:headed

# Debug mode
npm run test:e2e:debug
```

### Test Configuration

- **Base URL**: Defaults to `http://localhost:5173` (Vite dev server)
- **Retries**: 2 retries on CI, 0 locally
- **Parallel**: Tests run in parallel locally, sequential on CI
- **Reports**: HTML, JSON, and list reporters
- **Screenshots**: Captured on failure
- **Videos**: Recorded on failure
- **Traces**: Collected on retry

### CI/CD Integration

The tests are configured for CI environments:
- Set `PLAYWRIGHT_TEST_BASE_URL` to your deployed URL
- Tests will automatically use production settings on CI
- Automatic browser installation on CI

## Production Readiness Checklist

✅ **Google Analytics Tracking**
- [x] GA configured and initialized
- [x] Page view tracking implemented
- [x] Section visibility tracking on 8+ major sections
- [x] Custom event tracking utilities available
- [x] Graceful handling when GA not configured

✅ **End-to-End Testing**
- [x] 6 comprehensive test suites created
- [x] 40+ individual test cases
- [x] Landing page section visibility tests
- [x] Navigation and routing tests
- [x] Analytics tracking verification
- [x] Competition page tests
- [x] Production readiness checks
- [x] Responsive design tests
- [x] Accessibility tests
- [x] Performance tests

✅ **Code Quality**
- [x] TypeScript - no compilation errors
- [x] All tracking hooks properly typed
- [x] Minimal code changes (surgical implementation)
- [x] No breaking changes to existing functionality

## Next Steps for Deployment

1. **Add GA Measurement ID** to production environment variables
2. **Run tests against staging** environment before production
3. **Monitor GA Real-Time reports** after deployment
4. **Set up GA goals** for key user actions (competition entries, etc.)
5. **Configure GA Enhanced Ecommerce** if tracking purchases
6. **Set up conversion tracking** for business KPIs

## Monitoring & Analytics

After deployment, you can track:
- Page views by route
- Section engagement (which sections users scroll to)
- User journey through the site
- Competition page interactions
- Conversion funnels
- User demographics and behavior

Access your analytics at: https://analytics.google.com/

## Support & Maintenance

- **Analytics issues**: Check browser console for GA warnings
- **Test failures**: Review screenshots/videos in `test-results/`
- **CI/CD**: Ensure Playwright browsers are installed in your CI environment
- **Performance**: Monitor bundle size impact (GA adds ~30KB gzipped)

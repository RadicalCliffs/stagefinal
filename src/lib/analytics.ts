/**
 * Google Analytics utilities for tracking user interactions and page views
 * 
 * This module provides type-safe wrappers around Google Analytics (gtag.js)
 * for tracking events, page views, and user interactions across the site.
 */

// Extend the Window interface to include gtag
declare global {
  interface Window {
    gtag?: (
      command: 'config' | 'event' | 'js' | 'set',
      targetId: string | Date,
      config?: Record<string, any>
    ) => void;
    dataLayer?: any[];
  }
}

/**
 * Initialize Google Analytics with the measurement ID
 * This should be called once when the app loads
 */
export function initGA() {
  const measurementId = import.meta.env.VITE_GA_MEASUREMENT_ID;
  
  if (!measurementId) {
    console.warn('[GA] Measurement ID not configured - analytics disabled');
    return false;
  }

  // Load the GA script dynamically
  const script = document.createElement('script');
  script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
  script.async = true;
  document.head.appendChild(script);

  // Configure GA
  script.onload = () => {
    if (window.gtag) {
      window.gtag('config', measurementId, {
        send_page_view: false, // We'll handle page views manually
      });
      console.log('[GA] Initialized with ID:', measurementId);
    }
  };

  return true;
}

/**
 * Track a page view
 */
export function trackPageView(pagePath: string, pageTitle?: string) {
  const measurementId = import.meta.env.VITE_GA_MEASUREMENT_ID;
  
  if (!window.gtag || !measurementId) {
    return;
  }

  window.gtag('config', measurementId, {
    page_path: pagePath,
    page_title: pageTitle || document.title,
  });
}

/**
 * Track a custom event
 */
export function trackEvent(
  eventName: string,
  eventParams?: Record<string, any>
) {
  if (!window.gtag) {
    return;
  }

  window.gtag('event', eventName, eventParams);
}

/**
 * Track section visibility (when a section comes into view)
 */
export function trackSectionView(sectionName: string, additionalData?: Record<string, any>) {
  trackEvent('section_view', {
    section_name: sectionName,
    ...additionalData,
  });
}

/**
 * Track user interactions (button clicks, form submissions, etc.)
 */
export function trackInteraction(
  action: string,
  category: string,
  label?: string,
  value?: number
) {
  trackEvent(action, {
    event_category: category,
    event_label: label,
    value,
  });
}

/**
 * Track competition interactions
 */
export function trackCompetitionEvent(
  action: 'view' | 'enter' | 'share',
  competitionId: string,
  competitionName?: string
) {
  trackEvent(`competition_${action}`, {
    competition_id: competitionId,
    competition_name: competitionName,
  });
}

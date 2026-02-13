import { useEffect, useRef } from 'react';
import { trackSectionView } from '../lib/analytics';

/**
 * Custom hook to track when a section becomes visible on the screen
 * Uses Intersection Observer to detect when the section enters the viewport
 * 
 * @param sectionName - The name of the section to track
 * @param options - Intersection Observer options
 * @returns A ref to attach to the section element
 * 
 * @example
 * function HeroSection() {
 *   const sectionRef = useSectionTracking('hero_section');
 *   return <div ref={sectionRef}>...</div>
 * }
 */
export function useSectionTracking(
  sectionName: string,
  options?: IntersectionObserverInit
) {
  const sectionRef = useRef<HTMLDivElement>(null);
  const hasTracked = useRef(false);

  useEffect(() => {
    const element = sectionRef.current;
    if (!element) return;

    // Default options: trigger when 50% of the section is visible
    const observerOptions: IntersectionObserverInit = {
      threshold: 0.5,
      ...options,
    };

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        // Track only once when the section becomes visible
        if (entry.isIntersecting && !hasTracked.current) {
          trackSectionView(sectionName);
          hasTracked.current = true;
        }
      });
    }, observerOptions);

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [sectionName, options]);

  return sectionRef;
}

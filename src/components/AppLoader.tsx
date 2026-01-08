import { useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import loadingImage from '../assets/images/we\'re working on it.png';

interface AppLoaderProps {
  children: ReactNode;
}

const AppLoader = ({ children }: AppLoaderProps) => {
  const [isReady, setIsReady] = useState(false);
  const [isFadingOut, setIsFadingOut] = useState(false);

  useEffect(() => {
    // document.body.classList.add('loading');

    const minDisplayTime = 1800;
    const startTime = Date.now();
    let rafId: number;

    const checkImagesLoaded = () => {
      const images = Array.from(document.images);
      if (images.length === 0) return true;
      return images.every(img => img.complete && img.naturalHeight !== 0);
    };

    const checkContentReady = () => {
      const hasMainContent = document.querySelector('header, main, [class*="landing"], [class*="competition"], footer');
      const rootHasChildren = document.getElementById('root')?.childNodes.length || 0;
      const imagesLoaded = checkImagesLoaded();

      const hasVisibleContent = rootHasChildren > 2;

      return hasMainContent && hasVisibleContent && imagesLoaded;
    };

    const waitForPaint = () => {
      return new Promise<void>((resolve) => {
        rafId = requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve();
          });
        });
      });
    };

    let checkCount = 0;
    const maxChecks = 100;

    const checkInterval = setInterval(async () => {
      checkCount++;

      if (checkContentReady() || checkCount >= maxChecks) {
        clearInterval(checkInterval);

        await waitForPaint();

        const elapsedTime = Date.now() - startTime;
        const remainingTime = Math.max(0, minDisplayTime - elapsedTime);

        setTimeout(() => {
          setIsFadingOut(true);
          setTimeout(() => {
            setIsReady(true);
            document.body.classList.remove('loading');
          }, 700);
        }, remainingTime);
      }
    }, 100);

    return () => {
      clearInterval(checkInterval);
      if (rafId) cancelAnimationFrame(rafId);
      document.body.classList.remove('loading');
    };
  }, []);

  return (
    <>
    {children}
      {/* {children}
      {!isReady && (
        <div className={`global-loader ${isFadingOut ? 'global-loader-fade-out' : ''}`}>
          <div className="global-loader-backdrop" />
          <div className="global-loader-content">
            <img
              src={loadingImage}
              alt="Loading"
              className="global-loader-image"
            />
          </div>
        </div>
      )} */}
    </>
  );
};

export default AppLoader;
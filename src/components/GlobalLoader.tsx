import { useState, useEffect } from 'react';
import loadingImage from '../assets/images/we\'re working on it.png';

const GlobalLoader = () => {
  const [isLoading, setIsLoading] = useState(true);
  const [isFadingOut, setIsFadingOut] = useState(false);

  useEffect(() => {
    document.body.classList.add('loading');

    const minDisplayTime = 1000;
    const startTime = Date.now();

    const handleLoad = () => {
      const elapsedTime = Date.now() - startTime;
      const remainingTime = Math.max(0, minDisplayTime - elapsedTime);

      setTimeout(() => {
        setIsFadingOut(true);
        setTimeout(() => {
          setIsLoading(false);
          document.body.classList.remove('loading');
        }, 500);
      }, remainingTime);
    };

    if (document.readyState === 'complete') {
      handleLoad();
    } else {
      window.addEventListener('load', handleLoad);
      return () => {
        window.removeEventListener('load', handleLoad);
        document.body.classList.remove('loading');
      };
    }
  }, []);

  if (!isLoading) return null;

  return (
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
  );
};

export default GlobalLoader;

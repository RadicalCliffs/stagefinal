import { useState, useEffect } from 'react';

/**
 * OnchainKit configuration from server
 */
export interface OnchainKitConfig {
  apiKey: string;
  projectId: string | null;
  network: 'base' | 'base-sepolia';
  chainId: number;
}

interface OnchainKitConfigState {
  config: OnchainKitConfig | null;
  isLoading: boolean;
  error: string | null;
}

/**
 * Cache for the OnchainKit configuration
 * This prevents multiple fetches across component renders
 */
let cachedConfig: OnchainKitConfig | null = null;
let configPromise: Promise<OnchainKitConfig | null> | null = null;

/**
 * Fetch OnchainKit configuration from the server
 *
 * This function fetches the API key and configuration from a secure
 * server-side endpoint instead of relying on VITE_* environment variables
 * that get bundled into the client code.
 */
async function fetchOnchainKitConfig(): Promise<OnchainKitConfig | null> {
  // Return cached config if available
  if (cachedConfig) {
    return cachedConfig;
  }

  // Return existing promise if a fetch is already in progress
  if (configPromise) {
    return configPromise;
  }

  // Start a new fetch
  configPromise = (async () => {
    try {
      const response = await fetch('/api/onchainkit/config');

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('[useOnchainKitConfig] Failed to fetch config:', errorData);
        return null;
      }

      const data = await response.json();

      if (data.success && data.config) {
        cachedConfig = data.config;
        console.log('[useOnchainKitConfig] Loaded config from server:', {
          hasApiKey: !!data.config.apiKey,
          projectId: data.config.projectId,
          network: data.config.network,
        });
        return data.config;
      }

      console.error('[useOnchainKitConfig] Invalid response format:', data);
      return null;
    } catch (error) {
      console.error('[useOnchainKitConfig] Error fetching config:', error);
      return null;
    } finally {
      // Clear the promise after completion
      configPromise = null;
    }
  })();

  return configPromise;
}

/**
 * Get the cached OnchainKit config synchronously
 * Returns null if not yet loaded
 */
export function getCachedOnchainKitConfig(): OnchainKitConfig | null {
  return cachedConfig;
}

/**
 * Clear the cached OnchainKit config (useful for testing or refresh)
 */
export function clearOnchainKitConfigCache(): void {
  cachedConfig = null;
  configPromise = null;
}

/**
 * Preload the OnchainKit config (call early in app initialization)
 */
export async function preloadOnchainKitConfig(): Promise<OnchainKitConfig | null> {
  return fetchOnchainKitConfig();
}

/**
 * Hook to get OnchainKit configuration from server
 *
 * This hook fetches the OnchainKit API key and configuration from a secure
 * server-side endpoint. The configuration is cached after the first successful fetch.
 *
 * Usage:
 * ```tsx
 * const { config, isLoading, error } = useOnchainKitConfig();
 *
 * if (isLoading) return <LoadingSpinner />;
 * if (error || !config) return <ErrorMessage />;
 *
 * return <OnchainKitProvider apiKey={config.apiKey} chain={...} />;
 * ```
 */
export function useOnchainKitConfig(): OnchainKitConfigState {
  const [state, setState] = useState<OnchainKitConfigState>({
    config: cachedConfig,
    isLoading: !cachedConfig,
    error: null,
  });

  useEffect(() => {
    // If we already have cached config, no need to fetch
    if (cachedConfig) {
      setState({
        config: cachedConfig,
        isLoading: false,
        error: null,
      });
      return;
    }

    // Fetch the config
    let mounted = true;

    fetchOnchainKitConfig()
      .then((config) => {
        if (mounted) {
          if (config) {
            setState({
              config,
              isLoading: false,
              error: null,
            });
          } else {
            setState({
              config: null,
              isLoading: false,
              error: 'Failed to load OnchainKit configuration',
            });
          }
        }
      })
      .catch((error) => {
        if (mounted) {
          setState({
            config: null,
            isLoading: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  return state;
}

export default useOnchainKitConfig;

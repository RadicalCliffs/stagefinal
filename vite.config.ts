import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    react({
      // React Compiler disabled: was causing "Cannot access 'c' before initialization" errors
      // The experimental compiler creates variable initialization order issues in the bundled code
      // Related to temporal dead zone issues with const/let in optimized React components
      // babel: {
      //   plugins: ['babel-plugin-react-compiler'],
      // },
    }),
    tailwindcss(),
  ],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/e2e/**', // Exclude Playwright E2E tests from vitest
      '**/.{idea,git,cache,output,temp}/**',
    ],
  },
  resolve: {
    alias: {
      // Path aliases for cleaner imports
      '@': path.resolve(__dirname, './src'),
      '@/supabase': path.resolve(__dirname, './supabase'),
      // Resolve buffer to the polyfill for browser environment (required by wallet SDKs)
      buffer: 'buffer',
    },
  },
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-router',
      'buffer',
      '@supabase/supabase-js',
      'swiper',
      'wagmi',
      'viem',
      'bs58',
    ],
  },
  build: {
    rollupOptions: {
      onwarn(warning, warn) {
        if (
          warning.code === 'INVALID_ANNOTATION' &&
          warning.message.includes('/*#__PURE__*/')
        ) {
          return
        }
        warn(warning)
      },
      output: {
        // Use a function-based manualChunks to avoid circular dependency issues
        // between wagmi/viem and coinbase packages that share transitive dependencies.
        // The object-based syntax caused "Cannot access 'Z' before initialization" errors
        // because wagmi, viem, and coinbase packages have overlapping dependencies
        // (e.g., @walletconnect brings in its own viem version) that created circular
        // chunk references during Rollup bundling.
        manualChunks(id) {
          // React core - no dependencies on other chunks
          if (id.includes('node_modules/react-dom') ||
              id.includes('node_modules/react/') ||
              id.includes('node_modules/scheduler')) {
            return 'vendor-react'
          }
          // React Router - depends on React
          if (id.includes('node_modules/react-router')) {
            return 'vendor-react-router'
          }
          // UI libraries - minimal dependencies
          if (id.includes('node_modules/swiper') ||
              id.includes('node_modules/lucide-react') ||
              id.includes('node_modules/react-range-slider-input')) {
            return 'vendor-ui'
          }
          // Supabase - standalone
          if (id.includes('node_modules/@supabase')) {
            return 'vendor-supabase'
          }
          // Note: Form libraries (react-hook-form, yup, @hookform) are intentionally NOT
          // in a separate chunk. Yup's transitive dependencies (type-fest) share utility
          // functions that Rollup also uses for React, causing circular chunk references
          // and "Cannot access 'Y' before initialization" errors at runtime.

          // Web3 bundle: Group ALL web3-related packages together to avoid circular deps
          // This includes wagmi, viem, coinbase SDKs, walletconnect, and their dependencies
          // Keeping them in one chunk prevents initialization order issues
          if (id.includes('node_modules/wagmi') ||
              id.includes('node_modules/viem') ||
              id.includes('node_modules/@wagmi') ||
              id.includes('node_modules/@coinbase') ||
              id.includes('node_modules/@walletconnect') ||
              id.includes('node_modules/@reown') ||
              id.includes('node_modules/@tanstack/react-query') ||
              id.includes('node_modules/@safe-global') ||
              id.includes('node_modules/@farcaster') ||
              id.includes('node_modules/abitype') ||
              id.includes('node_modules/ox') ||
              id.includes('node_modules/porto')) {
            return 'vendor-web3'
          }
        },
      },
    },
    chunkSizeWarningLimit: 1000,
  },
})

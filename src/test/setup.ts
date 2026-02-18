import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock environment variables for tests using Vitest's stubEnv
// This ensures tests can run without real Supabase credentials
vi.stubEnv('VITE_SUPABASE_URL', 'https://test.supabase.co');
vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key');

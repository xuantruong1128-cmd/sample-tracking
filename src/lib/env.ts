/**
 * Application environment configuration
 */

const isSupabaseConfigured = Boolean(
  import.meta.env.VITE_SUPABASE_URL &&
  import.meta.env.VITE_SUPABASE_ANON_KEY &&
  !import.meta.env.VITE_SUPABASE_URL.includes('your-project-id')
);

export const ENV = {
  SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL || '',
  SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY || '',
  IS_CONFIGURED: isSupabaseConfigured,
  // F-09: Explicit development/demo mode flag only. Default false in production.
  IS_DEMO_MODE: import.meta.env.VITE_DEMO_MODE === 'true' || !isSupabaseConfigured,
};

const { execSync } = require('child_process');

const prodUrl = 'https://uqvxtgvdmdfgtjwzsxlj.supabase.co';
const prodServiceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVxdnh0Z3ZkbWRmZ3Rqd3pzeGxqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MjEyMTY0MiwiZXhwIjoyMTA3Njk3NjQyfQ.QNTFcx7vdqnQrQYQv5YR8_e3xN8O_KKuJsBWiMzzFOc';
const prodAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVxdnh0Z3ZkbWRmZ3Rqd3pzeGxqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIxMjE2NDIsImV4cCI6MjEwNzY5NzY0Mn0.jpdUQXKlasdb5QdHi3mOoLLbTwC1swXJfBftg-lwmkg';

console.log('=== STEP 4: RUNNING PRODUCTION INITIALIZATION & VERIFICATION ===\n');

const env = {
  ...process.env,
  PROD_SUPABASE_URL: prodUrl,
  PROD_SUPABASE_SERVICE_ROLE_KEY: prodServiceKey,
  SUPABASE_URL: prodUrl,
  SUPABASE_SERVICE_ROLE_KEY: prodServiceKey,
  VITE_SUPABASE_URL: prodUrl,
  VITE_SUPABASE_ANON_KEY: prodAnonKey,
};

try {
  console.log('[RUN] Executing node scripts/initialize-production-db.cjs ...');
  const initOut = execSync('node scripts/initialize-production-db.cjs', { env, encoding: 'utf-8', timeout: 60000 });
  console.log(initOut);
  
  console.log('\n[RUN] Executing node scripts/production-smoke-test.cjs ...');
  const smokeOut = execSync('node scripts/production-smoke-test.cjs', { env, encoding: 'utf-8', timeout: 60000 });
  console.log(smokeOut);

  console.log('\n[ALL PRODUCTION INITIALIZATION CHECKS COMPLETED SUCCESSFULLY]');
} catch (err) {
  console.error('[ERROR] Failed during initialization/smoke test:', err.message);
  if (err.stdout) console.error('[STDOUT]', err.stdout);
  if (err.stderr) console.error('[STDERR]', err.stderr);
  process.exit(1);
}

const fs = require('fs');
const content = fs.readFileSync('supabase/migrations/00026_production_ux_and_permission_r1.sql', 'utf8');
const lines = content.split('\n');
lines.forEach((l, i) => {
  if (l.includes('has_completed_password_change')) {
    console.log(lines.slice(Math.max(0, i - 2), Math.min(lines.length, i + 15)).join('\n'));
  }
});

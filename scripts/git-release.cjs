const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Locate git
const gitPath = path.join(process.env.LOCALAPPDATA, 'Programs', 'Git', 'cmd', 'git.exe');
if (!fs.existsSync(gitPath)) {
  console.error('git.exe not found at', gitPath);
  process.exit(1);
}

function runGit(args) {
  const cmd = `"${gitPath}" ${args}`;
  console.log('>', cmd);
  try {
    const out = execSync(cmd, { cwd: process.cwd(), stdio: 'pipe' });
    console.log(out.toString());
    return out.toString();
  } catch (err) {
    console.error('Error running git:', err.stderr ? err.stderr.toString() : err.message);
    throw err;
  }
}

async function main() {
  console.log('=== CREATING GIT RELEASE BASELINE V1.0.0 ===');
  runGit('--version');

  // 1. git init if needed
  if (!fs.existsSync('.git')) {
    runGit('init');
  }

  // 2. Configure identity for this repo if needed
  runGit('config user.name "Sample Tracking Team"');
  runGit('config user.email "admin@sampletracking.local"');

  // 3. Check git status
  runGit('status --short');

  // 4. git add
  runGit('add .');

  // 5. git commit
  try {
    runGit('commit -m "chore(release): Production Go-Live V1.0.0"');
  } catch (e) {
    console.log('Commit already up to date or nothing to commit.');
  }

  // 6. git tag v1.0.0
  try {
    runGit('tag -a v1.0.0 -m "Release version 1.0.0 for Production Go-Live" -f');
    console.log('✅ Tagged v1.0.0 successfully!');
  } catch (e) {
    console.error('Error tagging:', e.message);
  }

  // 7. Verification
  console.log('\n--- Git Release Verification ---');
  runGit('log -1 --oneline');
  runGit('tag -l -n1');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

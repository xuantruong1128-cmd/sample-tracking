const fs = require('fs');
const path = require('path');

const srcDir = path.resolve(__dirname, '../uat_output');
const destDir = 'C:\\Users\\xuantruong do\\.gemini\\antigravity\\brain\\078bd566-721e-46b9-8787-668467504479';

const filesToCopy = [
  'bd_01_login.png',
  'bd_02_dashboard.png',
  'bd_03_create_issue_form.png',
  'bd_04_issue_created.png',
  'pemfg_05_workspace_v1_issued.png',
  'pemfg_06_drawing_viewer_zoom.png',
  'pemfg_07_avatar_crop.png',
  'pemfg_08_routing_subcon_operations.png',
  'pemfg_09_photo_attachment.png',
  'pemfg_10_draft_saved.png',
  'bd_11_view_draft_readonly.png',
  'pemfg_12_v1_completed_report.png',
  'pemfg_13_create_v2.png',
  'pemfg_14_v2_routing_diff.png',
  'pemfg_15_v2_completed_report.png',
  'mobile_01_dashboard.png',
  'mobile_02_review_workspace.png',
  'mobile_03_completed_report.png',
  '261103-N011_V1_Drawing_Review.pdf',
  '261103-N011_V2_Drawing_Review.pdf',
];

for (const file of filesToCopy) {
  const src = path.join(srcDir, file);
  const dest = path.join(destDir, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`Copied: ${file}`);
  } else {
    console.warn(`File not found: ${src}`);
  }
}
console.log('✅ All UAT files copied to artifact directory!');

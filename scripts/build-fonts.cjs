const fs = require('fs');
const path = require('path');

const regPath = path.resolve(__dirname, '../supabase/functions/generate-final-report/fonts/Roboto-Regular.ttf');
const boldPath = path.resolve(__dirname, '../supabase/functions/generate-final-report/fonts/Roboto-Bold.ttf');

const regB64 = fs.readFileSync(regPath).toString('base64');
const boldB64 = fs.readFileSync(boldPath).toString('base64');

const tsContent = `// Auto-generated Unicode fonts for PDF generation (Roboto Regular & Bold)
// Full Vietnamese diacritics and Basic Latin support

function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

const ROBOTO_REGULAR_B64 = '${regB64}';
const ROBOTO_BOLD_B64 = '${boldB64}';

let cachedRegularBytes: Uint8Array | null = null;
let cachedBoldBytes: Uint8Array | null = null;

export function getRobotoRegularFontBytes(): Uint8Array {
  if (!cachedRegularBytes) {
    cachedRegularBytes = base64ToUint8Array(ROBOTO_REGULAR_B64);
  }
  return cachedRegularBytes;
}

export function getRobotoBoldFontBytes(): Uint8Array {
  if (!cachedBoldBytes) {
    cachedBoldBytes = base64ToUint8Array(ROBOTO_BOLD_B64);
  }
  return cachedBoldBytes;
}
`;

const outputPath = path.resolve(__dirname, '../supabase/functions/generate-final-report/fonts.ts');
fs.writeFileSync(outputPath, tsContent, 'utf8');
console.log('Generated fonts.ts successfully! File size:', fs.statSync(outputPath).size, 'bytes');

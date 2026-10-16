const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

const pdfPath = path.resolve(__dirname, '../uat_output/BRACKET-500-F7 - JOB-F7-REAL-275197.pdf');
const buf = fs.readFileSync(pdfPath);
console.log('PDF File Size:', buf.length, 'bytes');

let pos = 0;
let streamIndex = 0;

while (pos < buf.length) {
  const streamStartMarker = buf.indexOf('stream', pos);
  if (streamStartMarker === -1) break;

  let streamDataStart = streamStartMarker + 6;
  if (buf[streamDataStart] === 0x0d && buf[streamDataStart + 1] === 0x0a) {
    streamDataStart += 2;
  } else if (buf[streamDataStart] === 0x0a) {
    streamDataStart += 1;
  }

  const streamEndMarker = buf.indexOf('endstream', streamDataStart);
  if (streamEndMarker === -1) break;

  const streamData = buf.subarray(streamDataStart, streamEndMarker);

  try {
    const inflated = zlib.inflateSync(streamData);
    streamIndex++;
    const text = inflated.toString('latin1');
    if (text.includes('Tj') || text.includes('Tm')) {
      console.log(`\n================ HUMAN-READABLE TEXT IN PDF CONTENT STREAM ${streamIndex} ================`);
      const extractedLines = [];
      const regex = /<([0-9A-Fa-f]+)>\s*Tj/g;
      let match;
      while ((match = regex.exec(text)) !== null) {
        extractedLines.push(Buffer.from(match[1], 'hex').toString('latin1'));
      }
      console.log(extractedLines.join('\n'));
    }
  } catch (err) {}

  pos = streamEndMarker + 9;
}

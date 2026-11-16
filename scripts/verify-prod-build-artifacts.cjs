#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const distDir = path.resolve(__dirname, '..', 'dist', 'assets');
if (!fs.existsSync(distDir)) {
  console.log('dist/assets does not exist');
  process.exit(1);
}

const files = fs.readdirSync(distDir).filter(f => f.endsWith('.js'));
let hasProdRef = false;
let hasTestRef = false;
let hasServiceKey = false;

for (const file of files) {
  const content = fs.readFileSync(path.join(distDir, file), 'utf8');
  if (content.includes('uqvxtgvdmdfgtjwzsxlj')) hasProdRef = true;
  if (content.includes('hosppagbopdghlupnhlr')) hasTestRef = true;
  if (content.includes('service_role')) hasServiceKey = true;
}

console.log('--- Production Build Scan ---');
console.log('Contains Production Ref (uqvxtgvdmdfgtjwzsxlj):', hasProdRef);
console.log('Contains TEST Ref (hosppagbopdghlupnhlr):', hasTestRef);
console.log('Contains service_role key:', hasServiceKey);

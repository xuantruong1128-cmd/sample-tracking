const fs = require('fs');
const modules = fs.readdirSync('node_modules');
const relevant = modules.filter(m => m.includes('chrome') || m.includes('puppeteer') || m.includes('playwright') || m.includes('selenium') || m.includes('cdp'));
console.log('Relevant modules:', relevant);

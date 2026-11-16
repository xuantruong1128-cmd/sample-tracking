const https = require('https');

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: data }));
    }).on('error', reject);
  });
}

async function verify() {
  console.log('Verifying https://sample-tracking-89b.pages.dev ...');
  const res = await fetchUrl('https://sample-tracking-89b.pages.dev');
  console.log('Status code:', res.statusCode);
  if (res.body.includes('<div id="root"></div>')) {
    console.log('✅ Found root element in HTML');
  }

  // Find bundle script
  const scriptMatch = res.body.match(/src="(\/assets\/index-[^"]+\.js)"/);
  if (scriptMatch) {
    const bundleUrl = 'https://sample-tracking-89b.pages.dev' + scriptMatch[1];
    console.log('Fetching bundle:', bundleUrl);
    const bundleRes = await fetchUrl(bundleUrl);
    console.log('Bundle status:', bundleRes.statusCode);
    const hasTestRef = bundleRes.body.includes('hosppagbopdghlupnhlr');
    const hasProdRef = bundleRes.body.includes('uqvxtgvdmdfgtjwzsxlj');
    const hasDrawingReview = bundleRes.body.includes('DrawingReview') || bundleRes.body.includes('drawing-review') || bundleRes.body.includes('bản vẽ');
    console.log('Contains TEST Supabase (hosppagbopdghlupnhlr):', hasTestRef);
    console.log('Contains PROD Supabase (uqvxtgvdmdfgtjwzsxlj):', hasProdRef);
    console.log('Contains Drawing Review Module code:', hasDrawingReview);
    if (hasTestRef && !hasProdRef && hasDrawingReview) {
      console.log('🎉 LIVE TEST DEPLOYMENT 100% VERIFIED!');
    } else {
      console.error('❌ Bundle verification failed!');
      process.exit(1);
    }
  } else {
    console.error('Could not find bundle script tag');
    process.exit(1);
  }
}

verify().catch(console.error);

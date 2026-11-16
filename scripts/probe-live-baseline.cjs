const https = require('https');

function fetchHtml(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ status: res.statusCode, data }));
    }).on('error', reject);
  });
}

async function main() {
  const prod = await fetchHtml('https://sample-tracking-prod.pages.dev');
  const newDeploy = await fetchHtml('https://bee00b1b.sample-tracking-prod.pages.dev');
  const oldBase = await fetchHtml('https://fdc594d0.sample-tracking-prod.pages.dev');

  console.log('Production URL HTTP status:    ', prod.status);
  console.log('New Deploy bee00b1b HTTP status:', newDeploy.status);
  console.log('Old Base fdc594d0 HTTP status:  ', oldBase.status);

  const prodScript = (prod.data.match(/src="\/assets\/index-[^"]+\.js"/) || [])[0];
  const newScript = (newDeploy.data.match(/src="\/assets\/index-[^"]+\.js"/) || [])[0];
  const oldScript = (oldBase.data.match(/src="\/assets\/index-[^"]+\.js"/) || [])[0];

  console.log('Prod script tag:       ', prodScript);
  console.log('New deploy script tag: ', newScript);
  console.log('Old baseline script tag:', oldScript);
  console.log('Is Prod serving new bundle?:', prodScript === newScript);
  console.log('Is old baseline still preserved for rollback?:', oldScript === 'src="/assets/index-C2SNZEZ7.js"');
}

main().catch(console.error);

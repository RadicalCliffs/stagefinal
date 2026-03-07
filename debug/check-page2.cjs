const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  // Listen for page errors
  page.on('pageerror', err => console.log('Page error:', err.message));
  page.on('console', msg => {
    if (msg.type() === 'error') console.log('Console error:', msg.text());
  });
  
  await page.goto('http://localhost:5173');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000); // Give React time to hydrate
  
  const html = await page.content();
  console.log('Page title:', await page.title());
  console.log('HTML length:', html.length);
  console.log('Has #root:', html.includes('id="root"'));
  
  // Check what's inside root
  const rootContent = await page.evaluate(() => {
    const root = document.getElementById('root');
    return root ? root.innerHTML.substring(0, 500) : 'No root element';
  });
  console.log('Root content preview:', rootContent);
  
  await browser.close();
})();

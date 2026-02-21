const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://localhost:5173');
  await page.waitForLoadState('domcontentloaded');
  const html = await page.content();
  console.log('Page title:', await page.title());
  console.log('Has bg-[#1a1a1a]:', html.includes('bg-[#1a1a1a]'));
  console.log('Has main:', html.includes('<main'));
  console.log('Has header:', html.includes('<header'));
  const classes = await page.evaluate(() => document.body.className);
  console.log('Body classes:', classes);
  const firstSection = await page.locator('section').first().getAttribute('class');
  console.log('First section classes:', firstSection);
  await browser.close();
})();

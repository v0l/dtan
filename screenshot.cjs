const { chromium } = require('playwright');
const path = require('path');

async function takeScreenshots() {
  const browser = await chromium.launch();
  
  const sizes = [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'mobile', width: 375, height: 812 }
  ];
  
  for (const size of sizes) {
    const page = await browser.newPage();
    await page.setViewportSize({ width: size.width, height: size.height });
    
    await page.goto(`file://${path.join(__dirname, 'screenshots/demo.html')}`);
    
    const screenshotPath = path.join(__dirname, `screenshots/mobile-layout-${size.name}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    
    console.log(`Saved: ${screenshotPath}`);
    await page.close();
  }
  
  await browser.close();
  console.log('All screenshots captured!');
}

takeScreenshots().catch(console.error);

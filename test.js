/**
 * Test script for the Google Ads Transparency scraper
 * Run with: node test.js
 */

const { scrapeAdTransparency } = require('./scraper');
const fs = require('fs');

async function runTest() {
  const testDomain = process.argv[2] || 'gotofilejet.com';

  console.log('='.repeat(60));
  console.log(`Testing Google Ads Transparency Scraper`);
  console.log(`Domain: ${testDomain}`);
  console.log('='.repeat(60));
  console.log('');

  const startTime = Date.now();
  const result = await scrapeAdTransparency(testDomain);
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log(`\nScraping completed in ${duration}s`);
  console.log('');

  if (result.success) {
    console.log('STATUS: SUCCESS');
    console.log('-'.repeat(40));

    const data = result.data;

    console.log(`Has Results: ${data.hasResults}`);
    console.log(`Total Ads: ${data.totalAds || 'N/A'} ${data.totalAdsText ? `(${data.totalAdsText})` : ''}`);
    console.log(`Ads in View: ${data.totalAdsInView || 'N/A'}`);
    console.log(`Ad Previews Captured: ${data.ads?.length || 0}`);

    if (data.advertiser) {
      console.log(`\n--- ADVERTISER ---`);
      console.log(`  Name: ${data.advertiser.name}`);
      console.log(`  ID: ${data.advertiser.id}`);
      console.log(`  Verified: ${data.advertiser.verified ? 'Yes' : 'No'}`);
    }

    if (data.ads && data.ads.length > 0) {
      console.log(`\n--- AD CREATIVES ---`);
      data.ads.forEach(ad => {
        console.log(`  [${ad.position}] ${ad.creativeId}`);
        console.log(`      Advertiser: ${ad.advertiserName}`);
        console.log(`      URL: ${ad.url}`);
      });

      // Save HTML for inspection
      const htmlPath = `ads_html_${testDomain.replace(/\./g, '_')}.html`;
      const htmlContent = data.ads.map((ad, i) =>
        `<!-- AD ${i + 1} -->\n${ad.html}\n\n`
      ).join('<hr>\n');
      fs.writeFileSync(htmlPath, `<html><body>\n${htmlContent}\n</body></html>`);
      console.log(`\nAd HTML saved: ${htmlPath}`);
    }

    // Save screenshot if available
    if (data.screenshot) {
      const screenshotPath = `screenshot_${testDomain.replace(/\./g, '_')}.png`;
      fs.writeFileSync(screenshotPath, Buffer.from(data.screenshot, 'base64'));
      console.log(`\nScreenshot saved: ${screenshotPath}`);
    }

    // Show raw text excerpt
    console.log('\n--- RAW TEXT EXCERPT (first 1500 chars) ---');
    console.log(data.rawText.substring(0, 1500));
    console.log('--- END EXCERPT ---\n');

    // Save full result to JSON
    const jsonPath = `result_${testDomain.replace(/\./g, '_')}.json`;
    const saveData = { ...result.data };
    delete saveData.screenshot; // Don't include base64 in JSON
    delete saveData.rawText; // Keep JSON cleaner
    fs.writeFileSync(jsonPath, JSON.stringify(saveData, null, 2));
    console.log(`Full result saved: ${jsonPath}`);

  } else {
    console.log('STATUS: FAILED');
    console.log(`Error: ${result.error}`);
  }
}

runTest().catch(console.error);

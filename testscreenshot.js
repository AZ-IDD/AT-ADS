/**
 * Test: Take a full-page screenshot of Google Ads Transparency Center
 * Domain: gotofilejet.com
 *
 * Clicks "See all ads" to show more ads, then takes a full-page screenshot.
 * Does NOT try to load all 1000+ ads (page would be too tall for a screenshot).
 * Instead captures the initial batch (~80 ads) which gives a good overview.
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

async function testScreenshot() {
  const domain = 'gotofilejet.com';
  const url = `https://adstransparency.google.com/?region=anywhere&domain=${encodeURIComponent(domain)}`;

  let browser;
  try {
    console.log('='.repeat(50));
    console.log('Screenshot Test — See All Ads');
    console.log('='.repeat(50));
    console.log(`Domain: ${domain}`);
    console.log(`URL: ${url}`);
    console.log('');

    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1920, height: 1080 });

    // --- PAGE 1: Domain search page ---
    console.log('1. Navigating to domain search page...');
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    console.log('2. Waiting for initial content...');
    await page.waitForFunction(() => {
      const ads = document.querySelectorAll('creative-preview');
      const noResults = document.body.innerText.includes('No ads match');
      return ads.length > 0 || noResults;
    }, { timeout: 30000 }).catch(() => {
      console.log('   Timeout waiting for elements, proceeding...');
    });

    await new Promise(resolve => setTimeout(resolve, 2000));

    let adsCount = await page.evaluate(() => document.querySelectorAll('creative-preview').length);
    console.log(`   Ads on search page: ${adsCount}`);

    // --- Click "See all ads" link ---
    console.log('3. Looking for "See all ads" link...');
    const seeAllClicked = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a'));
      for (const link of links) {
        const text = link.textContent.trim().toLowerCase();
        if (text.includes('see all ads') || text.includes('ראו את כל המודעות') ||
            text.includes('see all') || text.includes('כל המודעות')) {
          link.click();
          return { clicked: true, text: link.textContent.trim() };
        }
      }
      const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
      for (const btn of buttons) {
        const text = btn.textContent.trim().toLowerCase();
        if (text.includes('see all') || text.includes('כל המודעות')) {
          btn.click();
          return { clicked: true, text: btn.textContent.trim() };
        }
      }
      return { clicked: false };
    });

    if (seeAllClicked.clicked) {
      console.log(`   Clicked: "${seeAllClicked.text}"`);

      // Wait for new content to load
      await new Promise(resolve => setTimeout(resolve, 5000));
      await page.waitForFunction(() => {
        const ads = document.querySelectorAll('creative-preview');
        return ads.length > 10;
      }, { timeout: 15000 }).catch(() => {
        console.log('   Timeout waiting for more ads...');
      });

      await new Promise(resolve => setTimeout(resolve, 2000));
    } else {
      console.log('   "See all ads" link not found, staying on current page');
    }

    adsCount = await page.evaluate(() => document.querySelectorAll('creative-preview').length);
    console.log(`   Ads visible after "See all ads": ${adsCount}`);

    // Scroll back to top
    await page.evaluate(() => window.scrollTo(0, 0));
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Final page info
    const pageInfo = await page.evaluate(() => {
      const ads = document.querySelectorAll('creative-preview');
      return {
        adsCount: ads.length,
        bodyHeight: document.body.scrollHeight,
        title: document.title
      };
    });

    console.log(`   Page height: ${pageInfo.bodyHeight}px`);

    // --- Take full-page screenshot ---
    console.log('4. Taking full-page screenshot...');
    const screenshotFilename = `screenshot_${domain.replace(/\./g, '_')}.png`;
    const screenshotPath = path.join(__dirname, screenshotFilename);

    await page.screenshot({
      path: screenshotPath,
      fullPage: true
    });

    const stats = fs.statSync(screenshotPath);
    const fileSizeKB = (stats.size / 1024).toFixed(1);
    const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);

    console.log(`   Saved: ${screenshotFilename}`);
    console.log(`   Size: ${fileSizeKB} KB (${fileSizeMB} MB)`);

    // --- Test base64 ---
    console.log('5. Testing base64 encoding...');
    const base64 = await page.screenshot({
      encoding: 'base64',
      fullPage: true
    });

    const base64SizeMB = (base64.length / (1024 * 1024)).toFixed(2);
    const withinLimit = base64.length < 6 * 1024 * 1024;

    console.log(`   Base64 size: ${base64SizeMB} MB`);
    console.log(`   Within Apps Script limit (< 6MB): ${withinLimit ? 'YES' : 'NO - may need compression'}`);

    console.log('');
    console.log('='.repeat(50));
    console.log('Result: PASSED');
    console.log('='.repeat(50));
    console.log(`Ads in screenshot: ${pageInfo.adsCount}`);
    console.log(`Screenshot file: ${screenshotPath}`);
    console.log(`File size: ${fileSizeKB} KB (${fileSizeMB} MB)`);
    console.log(`Base64 size: ${base64SizeMB} MB`);
    console.log(`Ready for Drive upload: ${withinLimit ? 'Yes' : 'Needs optimization'}`);

  } catch (error) {
    console.error('');
    console.error('='.repeat(50));
    console.error('Result: FAILED');
    console.error('='.repeat(50));
    console.error('Error:', error.message);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

testScreenshot();

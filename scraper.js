const puppeteer = require('puppeteer');

/**
 * Scrape Google Ads Transparency Center for a given domain
 * @param {string} domain - The domain to search for
 * @param {object} options - Optional settings
 * @returns {object} - Scraped ad data
 */
async function scrapeAdTransparency(domain, options = {}) {
  const { region = 'anywhere', timeout = 30000 } = options;

  const url = `https://adstransparency.google.com/?region=${region}&domain=${encodeURIComponent(domain)}`;

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process'
      ]
    });

    const page = await browser.newPage();

    // Set a realistic user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Set viewport
    await page.setViewport({ width: 1920, height: 1080 });

    console.log(`Navigating to: ${url}`);
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: timeout
    });

    // Wait for content to load - the page uses dynamic rendering
    // Wait for either results or "no results" message
    await page.waitForFunction(() => {
      // Check if ads are loaded or no results message appears
      const ads = document.querySelectorAll('creative-preview');
      const noResults = document.body.innerText.includes('No ads match');
      const advertiserInfo = document.querySelector('[data-advertiser-name]');
      return ads.length > 0 || noResults || advertiserInfo;
    }, { timeout: timeout }).catch(() => {
      console.log('Timeout waiting for specific elements, proceeding with available content');
    });

    // Additional wait to ensure dynamic content loads
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Extract data from the page
    const data = await page.evaluate((searchDomain) => {
      const result = {
        domain: searchDomain,
        scrapedAt: new Date().toISOString(),
        advertiser: null,
        totalAds: 0,
        totalAdsText: '',
        ads: [],
        rawText: '',
        hasResults: false
      };

      // Get the full page text for debugging/analysis
      result.rawText = document.body.innerText;

      // Check for "no ads" message
      if (result.rawText.includes('No ads match') ||
          result.rawText.includes('No results') ||
          result.rawText.includes('אין מודעות')) {
        result.hasResults = false;
        return result;
      }

      // Extract ad count - handles formats like "2K ads", "בערך 2K מודעות", "About 2K ads"
      // Note: Hebrew text may have RTL Unicode markers (U+200F)
      const cleanText = result.rawText.replace(/[\u200F\u200E]/g, ''); // Remove RTL/LTR marks

      const adCountPatterns = [
        /(\d+(?:\.\d+)?)\s*K\s*(?:ads?|מודעות)/i,  // "2K ads" or "2K מודעות"
        /(?:about|בערך|approximately)\s*(\d+(?:\.\d+)?)\s*K/i,  // "About 2K"
        /(\d+(?:,\d+)?)\s*(?:ads?|מודעות)/i  // "2000 ads"
      ];

      for (const pattern of adCountPatterns) {
        const match = cleanText.match(pattern);
        if (match) {
          let count = match[1].replace(/,/g, '');
          // Check if this was a K (thousands) match
          if (pattern.source.includes('K')) {
            count = parseFloat(count) * 1000;
          }
          result.totalAds = Math.round(parseFloat(count));
          result.totalAdsText = match[0].trim();
          break;
        }
      }

      // Extract advertiser info from creative-preview elements
      const creativeElements = document.querySelectorAll('creative-preview');
      if (creativeElements.length > 0) {
        const firstCreative = creativeElements[0];
        const link = firstCreative.querySelector('a[href*="/advertiser/"]');
        if (link) {
          const href = link.getAttribute('href');
          const advertiserMatch = href.match(/\/advertiser\/(AR\d+)/);
          const creativeMatch = href.match(/\/creative\/(CR\d+)/);

          result.advertiser = {
            id: advertiserMatch ? advertiserMatch[1] : null,
            name: null,
            verified: false
          };

          // Get advertiser name from the creative preview text
          const nameEl = firstCreative.querySelector('.advertiser-name, [class*="advertiser"]');
          if (nameEl) {
            result.advertiser.name = nameEl.textContent.trim();
          }
        }
      }

      // Also look for advertiser name in the page text
      const advertiserNameMatch = cleanText.match(/\n([A-Za-z0-9][A-Za-z0-9\s]+(?:LTD|LLC|Inc|Corp|Ltd)\.?)\s*\n\s*(?:מאומת|Verified)/i);
      if (advertiserNameMatch) {
        if (!result.advertiser) {
          result.advertiser = { id: null, name: null, verified: false };
        }
        result.advertiser.name = advertiserNameMatch[1].trim();
        result.advertiser.verified = true;
      }

      // Extract ad creative details
      const adElements = document.querySelectorAll('creative-preview');
      result.ads = Array.from(adElements).map((el, index) => {
        const link = el.querySelector('a[href*="/creative/"]');
        const href = link ? link.getAttribute('href') : '';
        const creativeMatch = href.match(/\/creative\/(CR\d+)/);
        const ariaLabel = link ? link.getAttribute('aria-label') : '';

        // Parse "מודעה (1 מתוך 80)" or "Ad (1 of 80)"
        const positionMatch = ariaLabel.match(/(\d+)\s*(?:מתוך|of)\s*(\d+)/);

        // Extract advertiser name from the ad card using CSS selector
        const advertiserEl = el.querySelector('.advertiser-name');
        const advertiserName = advertiserEl ? advertiserEl.textContent.trim() : null;
        const isVerified = el.querySelector('.verified') !== null ||
                           el.querySelector('.advertiser-name-verified') !== null;

        // Get the ad image URL
        const imgEl = el.querySelector('img[src*="googlesyndication"]');
        const imageUrl = imgEl ? imgEl.src : null;

        const fullText = el.innerText.trim();

        return {
          index: index,
          creativeId: creativeMatch ? creativeMatch[1] : null,
          position: positionMatch ? parseInt(positionMatch[1]) : index + 1,
          totalInView: positionMatch ? parseInt(positionMatch[2]) : null,
          url: href ? `https://adstransparency.google.com${href}` : null,
          advertiserName: advertiserName,
          verified: isVerified,
          imageUrl: imageUrl,
          text: fullText.substring(0, 300),
          html: el.outerHTML
        };
      });

      // Update total if we found it in aria-label
      if (result.ads.length > 0 && result.ads[0].totalInView) {
        result.totalAdsInView = result.ads[0].totalInView;
      }

      // Look for any image sources that might be ad creatives
      const images = document.querySelectorAll('img[src*="googleusercontent"], img[src*="creative"]');
      result.adImages = Array.from(images).map(img => ({
        src: img.src,
        alt: img.alt
      })).filter(img => img.src);

      result.hasResults = result.ads.length > 0 || result.totalAds > 0;

      return result;
    }, domain);

    // Take a screenshot for debugging
    const screenshot = await page.screenshot({
      encoding: 'base64',
      fullPage: false
    });
    data.screenshot = screenshot;

    return {
      success: true,
      data: data
    };

  } catch (error) {
    console.error('Scraping error:', error.message);
    return {
      success: false,
      error: error.message,
      domain: domain
    };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

module.exports = { scrapeAdTransparency };

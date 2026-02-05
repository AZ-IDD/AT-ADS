const puppeteer = require('puppeteer');

/**
 * Translate Hebrew values to English
 */
const hebrewToEnglish = {
  // Countries
  'הולנד': 'Netherlands',
  'ישראל': 'Israel',
  'ארצות הברית': 'United States',
  'בריטניה': 'United Kingdom',
  'גרמניה': 'Germany',
  'צרפת': 'France',
  'ספרד': 'Spain',
  'איטליה': 'Italy',
  'קנדה': 'Canada',
  'אוסטרליה': 'Australia',
  'יפן': 'Japan',
  'סין': 'China',
  'הודו': 'India',
  'ברזיל': 'Brazil',
  'רוסיה': 'Russia',
  'מקסיקו': 'Mexico',
  'פולין': 'Poland',
  'טורקיה': 'Turkey',
  'אוקראינה': 'Ukraine',
  'שוויץ': 'Switzerland',
  'אוסטריה': 'Austria',
  'בלגיה': 'Belgium',
  'שוודיה': 'Sweden',
  'נורבגיה': 'Norway',
  'דנמרק': 'Denmark',
  'פינלנד': 'Finland',
  'פורטוגל': 'Portugal',
  'יוון': 'Greece',
  'צ\'כיה': 'Czech Republic',
  'רומניה': 'Romania',
  'הונגריה': 'Hungary',
  'אירלנד': 'Ireland',
  'ניו זילנד': 'New Zealand',
  'סינגפור': 'Singapore',
  'הונג קונג': 'Hong Kong',
  'דרום קוריאה': 'South Korea',
  'תאילנד': 'Thailand',
  'מלזיה': 'Malaysia',
  'אינדונזיה': 'Indonesia',
  'פיליפינים': 'Philippines',
  'וייטנאם': 'Vietnam',
  'ארגנטינה': 'Argentina',
  'קולומביה': 'Colombia',
  'צ\'ילה': 'Chile',
  'פרו': 'Peru',
  'מצרים': 'Egypt',
  'דרום אפריקה': 'South Africa',
  'איחוד האמירויות': 'United Arab Emirates',
  'סעודיה': 'Saudi Arabia',
  // Regions/Shown in
  'בכל מקום': 'Everywhere',
  'כל המקומות': 'All locations',
  // Hebrew months
  'בינו׳': 'Jan',
  'בפבר׳': 'Feb',
  'במרץ': 'Mar',
  'באפר׳': 'Apr',
  'במאי': 'May',
  'ביוני': 'Jun',
  'ביולי': 'Jul',
  'באוג׳': 'Aug',
  'בספט׳': 'Sep',
  'באוק׳': 'Oct',
  'בנוב׳': 'Nov',
  'בדצמ׳': 'Dec'
};

function translateToEnglish(text) {
  if (!text) return text;
  let result = text;
  for (const [hebrew, english] of Object.entries(hebrewToEnglish)) {
    result = result.replace(new RegExp(hebrew, 'g'), english);
  }
  return result;
}

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
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
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
    const data = await page.evaluate((searchDomain, searchRegion) => {
      const result = {
        domain: searchDomain,
        region: searchRegion,
        scrapedAt: new Date().toISOString(),
        advertiser: null,
        totalAds: 0,
        totalAdsText: '',
        ads: [],
        adFormats: [],
        lastSeenDate: null,
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

          result.advertiser = {
            id: advertiserMatch ? advertiserMatch[1] : null,
            name: null,
            legalName: null,
            verified: false,
            location: null
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
          result.advertiser = { id: null, name: null, legalName: null, verified: false, location: null };
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
        const imgEl = el.querySelector('img[src*="googlesyndication"], img[src*="googleusercontent"]');
        const imageUrl = imgEl ? imgEl.src : null;

        // Get video URL if present
        const videoEl = el.querySelector('video');
        let videoUrl = null;
        if (videoEl) {
          videoUrl = videoEl.src || videoEl.querySelector('source')?.src || null;
        }

        // Detect ad format for this specific ad
        const hasVideo = videoEl !== null;
        const hasImage = imgEl !== null;
        let adFormat = 'Text';
        if (hasVideo) adFormat = 'Video';
        else if (hasImage) adFormat = 'Image';

        // Try to get ad dimensions
        const adWidth = imgEl ? imgEl.naturalWidth || imgEl.width : null;
        const adHeight = imgEl ? imgEl.naturalHeight || imgEl.height : null;

        const fullText = el.innerText.trim();

        return {
          index: index,
          creativeId: creativeMatch ? creativeMatch[1] : null,
          position: positionMatch ? parseInt(positionMatch[1]) : index + 1,
          totalInView: positionMatch ? parseInt(positionMatch[2]) : null,
          url: href ? `https://adstransparency.google.com${href}` : null,
          advertiserName: advertiserName,
          verified: isVerified,
          format: adFormat,
          dimensions: (adWidth && adHeight) ? { width: adWidth, height: adHeight } : null,
          imageUrl: imageUrl,
          videoUrl: videoUrl,
          adText: fullText.substring(0, 500)
        };
      });

      // Collect detected formats from ads
      const formats = new Set();
      result.ads.forEach(ad => {
        if (ad.format) formats.add(ad.format);
      });
      result.adFormats = Array.from(formats);

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
    }, domain, region);

    // If we have an advertiser ID, fetch additional details from advertiser page
    if (data.advertiser?.id) {
      console.log(`Fetching advertiser details for: ${data.advertiser.id}`);
      const advertiserUrl = `https://adstransparency.google.com/advertiser/${data.advertiser.id}?region=${region}`;

      await page.goto(advertiserUrl, {
        waitUntil: 'networkidle2',
        timeout: timeout
      });
      await new Promise(resolve => setTimeout(resolve, 2000));

      const advertiserDetails = await page.evaluate(() => {
        const text = document.body.innerText;
        const cleanText = text.replace(/[\u200F\u200E]/g, '');

        const details = {
          legalName: null,
          location: null,
          verified: false
        };

        // Extract legal name - "שם חוקי: ToGo Networks LTD" or "Legal name: ..."
        const legalNameMatch = cleanText.match(/(?:שם חוקי|Legal name)[:\s]+([^\n]+)/i);
        if (legalNameMatch) {
          details.legalName = legalNameMatch[1].trim();
        }

        // Extract country - "מדינה: Israel" or "Country: ..."
        const countryMatch = cleanText.match(/(?:מדינה|Country)[:\s]+([^\n]+)/i);
        if (countryMatch) {
          details.location = countryMatch[1].trim();
        }

        // Check verified status
        if (cleanText.includes('המפרסם אימת את הזהות') ||
            cleanText.includes('verified') ||
            cleanText.includes('מאומת')) {
          details.verified = true;
        }

        return details;
      });

      // Merge advertiser details
      if (advertiserDetails.legalName) {
        data.advertiser.legalName = advertiserDetails.legalName;
      }
      if (advertiserDetails.location) {
        data.advertiser.location = translateToEnglish(advertiserDetails.location);
      }
      if (advertiserDetails.verified) {
        data.advertiser.verified = true;
      }
    }

    // If we have ads, fetch details from the first ad to get lastSeenDate and format
    if (data.ads.length > 0 && data.ads[0].creativeId && data.advertiser?.id) {
      console.log(`Fetching ad details for: ${data.ads[0].creativeId}`);
      const creativeUrl = `https://adstransparency.google.com/advertiser/${data.advertiser.id}/creative/${data.ads[0].creativeId}?region=${region}`;

      await page.goto(creativeUrl, {
        waitUntil: 'networkidle2',
        timeout: timeout
      });
      await new Promise(resolve => setTimeout(resolve, 2000));

      const adDetails = await page.evaluate(() => {
        const text = document.body.innerText;
        const cleanText = text.replace(/[\u200F\u200E]/g, '');

        const details = {
          lastSeenDate: null,
          format: null,
          shownIn: null
        };

        // Extract last shown date - "הוצגה בפעם האחרונה: 4 בפבר׳ 2026" or "Last shown: ..."
        const lastShownMatch = cleanText.match(/(?:הוצגה בפעם האחרונה|Last shown)[:\s]+([^\n]+)/i);
        if (lastShownMatch) {
          details.lastSeenDate = lastShownMatch[1].trim();
        }

        // Extract format - "פורמט: תמונה" or "Format: Image"
        const formatMatch = cleanText.match(/(?:פורמט|Format)[:\s]+([^\n]+)/i);
        if (formatMatch) {
          let format = formatMatch[1].trim();
          // Translate Hebrew to English
          if (format === 'תמונה') format = 'Image';
          else if (format === 'טקסט') format = 'Text';
          else if (format === 'סרטון' || format === 'וידאו') format = 'Video';
          details.format = format;
        }

        // Extract shown in regions - "הופיעו ב: בכל מקום" or "Shown in: ..."
        const shownInMatch = cleanText.match(/(?:הופיעו ב|Shown in)[:\s]+([^\n]+)/i);
        if (shownInMatch) {
          details.shownIn = shownInMatch[1].trim();
        }

        return details;
      });

      // Update data with ad details (translate Hebrew to English)
      if (adDetails.lastSeenDate) {
        data.lastSeenDate = translateToEnglish(adDetails.lastSeenDate);
      }
      if (adDetails.format && !data.adFormats.includes(adDetails.format)) {
        data.adFormats.push(adDetails.format);
      }
      if (adDetails.shownIn) {
        data.shownInRegions = translateToEnglish(adDetails.shownIn);
      }
    }

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

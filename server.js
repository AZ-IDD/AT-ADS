/**
 * Express server for Google Ads Transparency proxy
 * Provides HTTP API for Apps Script to call
 */

const express = require('express');
const path = require('path');
const { scrapeAdTransparency } = require('./scraper');
const { getAuthUrl, handleAuthCallback, isAuthenticated, uploadToDrive } = require('./drive-uploader');

const app = express();
const PORT = process.env.PORT || 3000;

// Auto-run scheduler state
let autoRunState = {
  enabled: false,
  intervalMinutes: 1,
  isRunning: false,
  lastRunTime: null,
  nextRunTime: null,
  lastResults: null,
  scheduledTask: null,
  appsScriptUrl: null,
  domains: [],
  batchSize: 5
};

// Format date in Israeli timezone with timezone indicator (same as frontend)
function formatIsraeliDate(date) {
  const options = {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  };
  const formatted = date.toLocaleString('he-IL', options);

  // Determine if it's IST (winter) or IDT (summer)
  const israelOffset = date.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem', timeZoneName: 'short' });
  const tzMatch = israelOffset.match(/([A-Z]{2,4})$/);
  const tz = tzMatch ? tzMatch[1] : 'IST';

  return `${formatted} (${tz})`;
}

// Middleware
app.use(express.json({ limit: '50mb' }));

// Serve static files (HTML, screenshots, JSON results)
app.use(express.static(path.join(__dirname)));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * GET /auth
 * Redirect to Google OAuth2 consent screen for Drive access
 */
app.get('/auth', (req, res) => {
  const authUrl = getAuthUrl();
  res.redirect(authUrl);
});

/**
 * GET /auth/callback
 * Handle OAuth2 callback from Google
 */
app.get('/auth/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) {
    return res.status(400).send('Missing authorization code');
  }

  try {
    await handleAuthCallback(code);
    res.send('<html><body style="font-family:sans-serif;text-align:center;padding:3rem;background:#0f172a;color:#e2e8f0;"><h1 style="color:#22c55e;">Google Drive Authorized!</h1><p>You can close this tab and return to the scanner.</p><script>setTimeout(()=>window.close(),3000)</script></body></html>');
  } catch (error) {
    console.error('Auth callback error:', error.message);
    res.status(500).send('Authorization failed: ' + error.message);
  }
});

/**
 * GET /drive-status
 * Check if Google Drive API is authenticated
 */
app.get('/drive-status', (req, res) => {
  res.json({ authenticated: isAuthenticated() });
});

/**
 * GET /proxy?url=<apps-script-url>
 * Proxy requests to Google Apps Script to avoid CORS issues
 */
app.get('/proxy', async (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  try {
    // Google Apps Script redirects - need to follow redirects
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0'
      }
    });

    const text = await response.text();

    // Try to parse as JSON
    try {
      const data = JSON.parse(text);
      res.json(data);
    } catch (parseError) {
      // If not JSON, return error with first 200 chars of response
      console.error('Proxy received non-JSON:', text.substring(0, 200));
      res.status(500).json({
        error: 'Apps Script returned non-JSON response. Make sure the script is deployed correctly.',
        hint: 'Check that "Who has access" is set to "Anyone"'
      });
    }
  } catch (error) {
    console.error('Proxy error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /proxy
 * Proxy POST requests to Google Apps Script (for saving results)
 *
 * Note: Google Apps Script redirects POST requests (302), which can lose the body.
 * We handle this by manually following the redirect and re-posting the body.
 */
app.post('/proxy', async (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  try {
    const bodyStr = JSON.stringify(req.body);

    // First request - don't follow redirect automatically
    let response = await fetch(url, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0'
      },
      body: bodyStr
    });

    // Handle Google's redirect (302/307) - GET the redirect location to retrieve response
    // Google Apps Script processes the POST, then redirects to a URL that serves the JSON response
    if (response.status === 302 || response.status === 307) {
      const redirectUrl = response.headers.get('location');
      if (redirectUrl) {
        console.log('Following redirect (GET) to:', redirectUrl);
        response = await fetch(redirectUrl, {
          method: 'GET',
          redirect: 'follow',
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0'
          }
        });
      }
    }

    const text = await response.text();

    // Try to parse as JSON
    let data;
    try {
      data = JSON.parse(text);
    } catch (parseError) {
      // Try to extract JSON from HTML (Apps Script sometimes wraps JSON in HTML)
      const jsonMatch = text.match(/\{[\s\S]*"success"[\s\S]*\}/);
      if (jsonMatch) {
        try {
          data = JSON.parse(jsonMatch[0]);
        } catch (e) {
          // Couldn't extract JSON
        }
      }
    }

    if (data) {
      res.json(data);
    } else if (response.ok) {
      // Google Apps Script sometimes returns HTML even on success
      // If we got a 200 response, treat as success since data was likely saved
      console.log('Proxy POST: Got non-JSON response but request was OK, assuming success');
      res.json({ success: true, message: 'Data sent successfully' });
    } else {
      console.error('Proxy POST received non-JSON:', text.substring(0, 500));
      res.status(500).json({
        error: 'Apps Script returned non-JSON response.',
        response: text.substring(0, 200),
        hint: 'Check deployment permissions'
      });
    }
  } catch (error) {
    console.error('Proxy POST error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /scrape?domain=example.com&region=anywhere
 * Query a single domain
 */
app.get('/scrape', async (req, res) => {
  const { domain, region = 'anywhere' } = req.query;

  if (!domain) {
    return res.status(400).json({
      success: false,
      error: 'Missing required parameter: domain'
    });
  }

  console.log(`[${new Date().toISOString()}] Scraping: ${domain}`);

  try {
    const result = await scrapeAdTransparency(domain, { region });

    res.json(result);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /scrape-batch
 * Body: { domains: ["domain1.com", "domain2.com"], region: "anywhere" }
 * Scrape multiple domains
 */
app.post('/scrape-batch', async (req, res) => {
  const { domains, region = 'anywhere' } = req.body;

  if (!domains || !Array.isArray(domains) || domains.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Missing or invalid domains array'
    });
  }

  if (domains.length > 10) {
    return res.status(400).json({
      success: false,
      error: 'Maximum 10 domains per batch request'
    });
  }

  console.log(`[${new Date().toISOString()}] Batch scraping ${domains.length} domains`);

  const results = [];

  for (const domain of domains) {
    console.log(`  Processing: ${domain}`);
    const result = await scrapeAdTransparency(domain, { region });

    results.push({
      domain,
      ...result
    });

    // Small delay between requests to be respectful
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  res.json({
    success: true,
    count: results.length,
    results: results
  });
});

/**
 * POST /upload-screenshot
 * Upload a screenshot to Google Drive via Drive API
 * Body: { base64, domain }
 */
app.post('/upload-screenshot', async (req, res) => {
  const { base64, domain } = req.body;

  if (!base64) {
    return res.status(400).json({ success: false, error: 'Missing base64 data' });
  }

  try {
    const result = await uploadScreenshotToDriveAPI(base64, domain);
    res.json(result);
  } catch (error) {
    console.error('Screenshot upload error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Upload screenshot to Drive via Google Drive API
 */
async function uploadScreenshotToDriveAPI(base64, domain) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  const filename = `screenshot_${(domain || 'unknown').replace(/\./g, '_')}_${timestamp}.png`;

  return await uploadToDrive(base64, filename, 'image/png');
}

/**
 * Auto-run scheduler functions
 */

// Send a single batch to Google Sheets
async function sendBatchToSheets(batch) {
  try {
    const bodyStr = JSON.stringify({
      action: 'saveResults',
      results: batch
    });

    let response = await fetch(autoRunState.appsScriptUrl, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: bodyStr
    });

    if (response.status === 302 || response.status === 307) {
      const redirectUrl = response.headers.get('location');
      if (redirectUrl) {
        response = await fetch(redirectUrl, {
          method: 'POST',
          redirect: 'follow',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: bodyStr
        });
      }
    }

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      const jsonMatch = text.match(/\{[\s\S]*"success"[\s\S]*\}/);
      if (jsonMatch) {
        try { data = JSON.parse(jsonMatch[0]); } catch (e2) {}
      }
    }

    if (data && data.success) {
      return { success: true, savedCount: data.savedCount || batch.length };
    } else if (response.ok) {
      return { success: true, savedCount: batch.length };
    } else {
      return { success: false, savedCount: 0 };
    }
  } catch (error) {
    console.error('[Auto-Run]   Send error:', error.message);
    return { success: false, savedCount: 0 };
  }
}

// Run a batch scan on the server
async function runScheduledScan() {
  if (autoRunState.isRunning) {
    console.log('[Auto-Run] Scan already in progress, skipping...');
    return;
  }

  if (!autoRunState.domains || autoRunState.domains.length === 0) {
    console.log('[Auto-Run] No domains configured, skipping...');
    return;
  }

  autoRunState.isRunning = true;
  autoRunState.lastRunTime = new Date().toISOString();

  const batchSize = autoRunState.batchSize || 5;
  const totalDomains = autoRunState.domains.length;
  const totalBatches = Math.ceil(totalDomains / batchSize);
  const allResults = [];
  let savedTotal = 0;
  let failedBatches = 0;

  console.log(`[Auto-Run] Starting scan: ${totalDomains} domains, ${totalBatches} batches (size: ${batchSize})`);

  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
    const start = batchIndex * batchSize;
    const end = Math.min(start + batchSize, totalDomains);
    const batchDomains = autoRunState.domains.slice(start, end);
    const batchNum = batchIndex + 1;
    const batchResults = [];

    console.log(`[Auto-Run] Batch ${batchNum}/${totalBatches} — Scanning ${batchDomains.length} domains...`);

    // Scan this batch
    for (const domain of batchDomains) {
      console.log(`[Auto-Run]   Scanning: ${domain}`);
      try {
        const result = await scrapeAdTransparency(domain, { region: 'anywhere' });

        if (result.success && result.data) {
          // Upload screenshot to Drive via Drive API
          let screenshotDriveUrl = '-';
          if (result.data.screenshot && isAuthenticated()) {
            console.log(`[Auto-Run]   Uploading screenshot for ${domain} to Drive...`);
            try {
              const uploadResult = await uploadScreenshotToDriveAPI(result.data.screenshot, domain);
              if (uploadResult.success && uploadResult.downloadUrl) {
                screenshotDriveUrl = uploadResult.downloadUrl;
                console.log(`[Auto-Run]   Screenshot uploaded: ${screenshotDriveUrl}`);
              }
            } catch (uploadErr) {
              console.error(`[Auto-Run]   Screenshot upload failed: ${uploadErr.message}`);
            }
            // Free memory
            delete result.data.screenshot;
          }

          const publishers = result.data.publishers || [];
          const adsInView = result.data.ads?.length || 0;

          if (publishers.length > 0) {
            // Create one row per unique publisher
            for (const pub of publishers) {
              const firstAd = pub.ads?.[0];
              const crId = firstAd?.creativeId;
              const rawAdText = firstAd?.adText || '-';
              const cleanAdText = rawAdText !== '-' ? rawAdText.replace(/מאומת/g, '').trim() : '-';
              const row = {
                domain,
                publisherName: pub.name || '-',
                publisherId: pub.id || '-',
                creativeId: crId || '-',
                publisherVerified: pub.verified || false,
                publisherLocation: pub.location || '-',
                totalAds: result.data.totalAds || 0,
                adsInView: adsInView,
                adFormats: pub.adFormats || [],
                lastSeenDate: pub.lastSeenDate || '-',
                adImageUrl: screenshotDriveUrl,
                adText: cleanAdText,
                adsTransparencyUrl: `https://adstransparency.google.com/?region=anywhere&domain=${domain}`,
                scanDate: formatIsraeliDate(new Date()),
                status: 'success'
              };
              batchResults.push(row);
              allResults.push(row);
            }
          } else {
            // Fallback: single row (no publishers found)
            const rawAdText = result.data.ads?.[0]?.adText || '-';
            const cleanAdText = rawAdText !== '-' ? rawAdText.replace(/מאומת/g, '').trim() : '-';
            const firstAd = result.data.ads?.[0];
            const pubId = result.data.advertiser?.id;
            const crId = firstAd?.creativeId;
            const row = {
              domain,
              publisherName: result.data.advertiser?.name || '-',
              publisherId: pubId || '-',
              creativeId: crId || '-',
              publisherVerified: result.data.advertiser?.verified || false,
              publisherLocation: result.data.advertiser?.location || '-',
              totalAds: result.data.totalAds || 0,
              adsInView: adsInView,
              adFormats: result.data.adFormats || [],
              lastSeenDate: result.data.lastSeenDate || '-',
              adImageUrl: screenshotDriveUrl,
              adText: cleanAdText,
              adsTransparencyUrl: `https://adstransparency.google.com/?region=anywhere&domain=${domain}`,
              scanDate: formatIsraeliDate(new Date()),
              status: 'success'
            };
            batchResults.push(row);
            allResults.push(row);
          }
        } else {
          const row = {
            domain,
            publisherName: '-', publisherId: '-', creativeId: '-',
            publisherVerified: false, publisherLocation: '-',
            totalAds: 0, adsInView: 0, adFormats: [],
            lastSeenDate: '-', adImageUrl: '-', adText: '-',
            adsTransparencyUrl: `https://adstransparency.google.com/?region=anywhere&domain=${domain}`,
            scanDate: formatIsraeliDate(new Date()),
            status: 'error', error: result.error
          };
          batchResults.push(row);
          allResults.push(row);
        }
      } catch (error) {
        const row = {
          domain,
          publisherName: '-', publisherId: '-', creativeId: '-',
          publisherVerified: false, publisherLocation: '-',
          totalAds: 0, adsInView: 0, adFormats: [],
          lastSeenDate: '-', adImageUrl: '-', adText: '-',
          adsTransparencyUrl: `https://adstransparency.google.com/?region=anywhere&domain=${domain}`,
          scanDate: formatIsraeliDate(new Date()),
          status: 'error', error: error.message
        };
        batchResults.push(row);
        allResults.push(row);
      }

      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Send this batch to Sheets immediately
    if (autoRunState.appsScriptUrl && batchResults.length > 0) {
      console.log(`[Auto-Run] Batch ${batchNum}/${totalBatches} — Sending ${batchResults.length} results to Sheets...`);
      const sendResult = await sendBatchToSheets(batchResults);
      if (sendResult.success) {
        savedTotal += sendResult.savedCount;
        console.log(`[Auto-Run]   Batch ${batchNum}: Success (${sendResult.savedCount} saved)`);
      } else {
        failedBatches++;
        console.log(`[Auto-Run]   Batch ${batchNum}: Failed`);
      }
    }

    // Delay between batches
    if (batchIndex < totalBatches - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  autoRunState.lastResults = allResults;
  console.log(`[Auto-Run] Done! ${allResults.length} domains, ${savedTotal} saved to Sheets, ${failedBatches} failed batches.`);

  autoRunState.isRunning = false;
  updateNextRunTime();
  scheduleNextRun();
}

function updateNextRunTime() {
  if (autoRunState.enabled && autoRunState.intervalMinutes > 0) {
    const next = new Date();
    next.setMinutes(next.getMinutes() + autoRunState.intervalMinutes);
    autoRunState.nextRunTime = next.toISOString();
  } else {
    autoRunState.nextRunTime = null;
  }
}

function scheduleNextRun() {
  if (!autoRunState.enabled) {
    return;
  }

  // Clear any existing scheduled task
  if (autoRunState.scheduledTask) {
    clearTimeout(autoRunState.scheduledTask);
    autoRunState.scheduledTask = null;
  }

  const intervalMs = autoRunState.intervalMinutes * 60 * 1000;

  autoRunState.scheduledTask = setTimeout(() => {
    runScheduledScan();
  }, intervalMs);
}

function startAutoRun() {
  stopAutoRun(); // Clear any existing

  if (autoRunState.intervalMinutes < 1) {
    return { success: false, error: 'Interval must be at least 1 minute' };
  }

  autoRunState.enabled = true;

  console.log(`[Auto-Run] Scheduler started. Running every ${autoRunState.intervalMinutes} minutes (after each scan completes).`);

  // Run immediately on start
  runScheduledScan();

  return { success: true };
}

function stopAutoRun() {
  if (autoRunState.scheduledTask) {
    clearTimeout(autoRunState.scheduledTask);
    autoRunState.scheduledTask = null;
  }
  autoRunState.enabled = false;
  autoRunState.nextRunTime = null;
  console.log('[Auto-Run] Scheduler stopped.');
}

/**
 * GET /auto-run/status
 * Get current auto-run status
 */
app.get('/auto-run/status', (req, res) => {
  res.json({
    enabled: autoRunState.enabled,
    intervalMinutes: autoRunState.intervalMinutes,
    isRunning: autoRunState.isRunning,
    lastRunTime: autoRunState.lastRunTime,
    nextRunTime: autoRunState.nextRunTime,
    domainsCount: autoRunState.domains?.length || 0
  });
});

/**
 * POST /auto-run/start
 * Start auto-run scheduler
 * Body: { intervalMinutes: 60, appsScriptUrl: "...", domains: [...] }
 */
app.post('/auto-run/start', (req, res) => {
  const { intervalMinutes, appsScriptUrl, domains, batchSize } = req.body;

  if (!domains || !Array.isArray(domains) || domains.length === 0) {
    return res.status(400).json({ success: false, error: 'No domains provided' });
  }

  if (!intervalMinutes || intervalMinutes < 1) {
    return res.status(400).json({ success: false, error: 'Interval must be at least 1 minute' });
  }

  autoRunState.intervalMinutes = intervalMinutes;
  autoRunState.appsScriptUrl = appsScriptUrl;
  autoRunState.domains = domains;
  autoRunState.batchSize = batchSize || 5;

  const result = startAutoRun();

  res.json({
    ...result,
    intervalMinutes: autoRunState.intervalMinutes,
    nextRunTime: autoRunState.nextRunTime,
    domainsCount: autoRunState.domains.length
  });
});

/**
 * POST /auto-run/stop
 * Stop auto-run scheduler
 */
app.post('/auto-run/stop', (req, res) => {
  stopAutoRun();
  res.json({ success: true, enabled: false });
});

/**
 * GET /auto-run/results
 * Get last auto-run results
 */
app.get('/auto-run/results', (req, res) => {
  res.json({
    success: true,
    lastRunTime: autoRunState.lastRunTime,
    results: autoRunState.lastResults || []
  });
});

// Start server
app.listen(PORT, () => {
  console.log('='.repeat(50));
  console.log('Google Ads Transparency Proxy Server');
  console.log('='.repeat(50));
  console.log(`Server running on http://localhost:${PORT}`);
  console.log('');
  console.log('Endpoints:');
  console.log(`  GET  /health`);
  console.log(`  GET  /auth                  — Authorize Google Drive`);
  console.log(`  GET  /drive-status          — Check Drive auth status`);
  console.log(`  GET  /scrape?domain=example.com`);
  console.log(`  POST /scrape-batch  { domains: [...] }`);
  console.log(`  POST /upload-screenshot  { base64, domain }`);
  console.log(`  GET  /auto-run/status`);
  console.log(`  POST /auto-run/start  { intervalMinutes, appsScriptUrl, domains }`);
  console.log(`  POST /auto-run/stop`);
  console.log(`  GET  /auto-run/results`);
  console.log('');
  console.log(`Drive Auth: ${isAuthenticated() ? 'Authenticated' : 'Not authenticated — visit http://localhost:${PORT}/auth'}`);
  console.log('='.repeat(50));
});

/**
 * Express server for Google Ads Transparency proxy
 * Provides HTTP API for Apps Script to call
 */

const express = require('express');
const path = require('path');
const { scrapeAdTransparency } = require('./scraper');

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
  domains: []
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
app.use(express.json());

// Serve static files (HTML, screenshots, JSON results)
app.use(express.static(path.join(__dirname)));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
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
 */
app.post('/proxy', async (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      redirect: 'follow',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0'
      },
      body: JSON.stringify(req.body)
    });

    const text = await response.text();

    try {
      const data = JSON.parse(text);
      res.json(data);
    } catch (parseError) {
      console.error('Proxy POST received non-JSON:', text.substring(0, 200));
      res.status(500).json({
        error: 'Apps Script returned non-JSON response.',
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

    // Remove screenshot from response to reduce payload (optional)
    if (result.data?.screenshot) {
      delete result.data.screenshot;
    }

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

    // Remove screenshot to reduce payload
    if (result.data?.screenshot) {
      delete result.data.screenshot;
    }

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
 * Auto-run scheduler functions
 */

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
  console.log(`[Auto-Run] Starting scheduled scan of ${autoRunState.domains.length} domains...`);

  const results = [];

  for (const domain of autoRunState.domains) {
    console.log(`[Auto-Run]   Scanning: ${domain}`);
    try {
      const result = await scrapeAdTransparency(domain, { region: 'anywhere' });

      if (result.success && result.data) {
        results.push({
          domain,
          publisherName: result.data.advertiser?.name || '-',
          totalAds: result.data.totalAds || 0,
          scanDate: formatIsraeliDate(new Date()),
          status: 'success'
        });
      } else {
        results.push({
          domain,
          publisherName: '-',
          totalAds: 0,
          scanDate: formatIsraeliDate(new Date()),
          status: 'error',
          error: result.error
        });
      }
    } catch (error) {
      results.push({
        domain,
        publisherName: '-',
        totalAds: 0,
        scanDate: formatIsraeliDate(new Date()),
        status: 'error',
        error: error.message
      });
    }

    // Small delay between requests
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  autoRunState.lastResults = results;
  console.log(`[Auto-Run] Scan completed. ${results.length} domains processed.`);

  // Send results to Google Sheets if configured
  if (autoRunState.appsScriptUrl) {
    try {
      const response = await fetch(autoRunState.appsScriptUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        redirect: 'follow',
        body: JSON.stringify({
          action: 'saveResults',
          results: results
        })
      });
      const data = await response.json();
      console.log(`[Auto-Run] Results sent to Sheets: ${data.success ? 'Success' : 'Failed'}`);
    } catch (error) {
      console.error('[Auto-Run] Failed to send to Sheets:', error.message);
    }
  }

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
  const { intervalMinutes, appsScriptUrl, domains } = req.body;

  if (!domains || !Array.isArray(domains) || domains.length === 0) {
    return res.status(400).json({ success: false, error: 'No domains provided' });
  }

  if (!intervalMinutes || intervalMinutes < 1) {
    return res.status(400).json({ success: false, error: 'Interval must be at least 1 minute' });
  }

  autoRunState.intervalMinutes = intervalMinutes;
  autoRunState.appsScriptUrl = appsScriptUrl;
  autoRunState.domains = domains;

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
  console.log(`  GET  /scrape?domain=example.com`);
  console.log(`  POST /scrape-batch  { domains: [...] }`);
  console.log(`  GET  /auto-run/status`);
  console.log(`  POST /auto-run/start  { intervalMinutes, appsScriptUrl, domains }`);
  console.log(`  POST /auto-run/stop`);
  console.log(`  GET  /auto-run/results`);
  console.log('='.repeat(50));
});

/**
 * Express server for Google Ads Transparency proxy
 * Provides HTTP API for Apps Script to call
 */

const express = require('express');
const path = require('path');
const { scrapeAdTransparency } = require('./scraper');

const app = express();
const PORT = process.env.PORT || 3000;

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
  console.log('='.repeat(50));
});

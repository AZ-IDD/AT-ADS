# Google Ads Transparency Scanner

A web application that scans domains on the Google Ads Transparency Center to check advertiser information and ad counts. Features both manual scanning and automated scheduled scans with Google Sheets integration.

## Features

- **Single Domain Scanning** - Scan individual domains for ad transparency data
- **Batch Scanning** - Scan multiple domains at once
- **Auto-Run Scheduler** - Automatically scan domains at configurable intervals
- **Google Sheets Integration** - Load domains from and save results to Google Sheets via Apps Script
- **Real-time Status** - Live progress tracking and scan status
- **Screenshot Capture** - Saves screenshots of scanned pages
- **Israeli Timezone Support** - All timestamps in IST/IDT format

## Tech Stack

- **Backend**: Node.js, Express
- **Scraping**: Puppeteer (headless Chrome)
- **Frontend**: Vanilla HTML/CSS/JavaScript
- **Integration**: Google Apps Script for Sheets connectivity

## Installation

### Prerequisites

- Node.js 18+ installed
- Google Chrome (Puppeteer will use its own bundled Chromium)

### Setup

1. Clone the repository:
```bash
git clone https://github.com/your-username/ads-transparency-scanner.git
cd ads-transparency-scanner
```

2. Install dependencies:
```bash
npm install
```

3. Start the server:
```bash
npm start
```

4. Open your browser to `http://localhost:3000`

## Usage

### Manual Scanning

1. Configure your Google Apps Script URL in Settings
2. Load domains from your Google Sheet
3. Click "START" to begin scanning
4. View results in the table below

### Auto-Run Scheduler

1. Go to Settings tab
2. Enable "Auto-Run" checkbox
3. Set the interval (in minutes)
4. The scanner will automatically run at the specified interval
5. Results are sent to Google Sheets after each scan

### Google Sheets Setup

1. Create a Google Sheet with a tab named `CONFIG`
2. Add domains in column A (starting from row 2)
3. Create an Apps Script with the provided `apps-script.js` code
4. Deploy as Web App and copy the URL to Settings

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/scrape?domain=example.com` | GET | Scan single domain |
| `/scrape-batch` | POST | Scan multiple domains |
| `/auto-run/status` | GET | Get auto-run status |
| `/auto-run/start` | POST | Start auto-run scheduler |
| `/auto-run/stop` | POST | Stop auto-run scheduler |
| `/auto-run/results` | GET | Get last auto-run results |

## Project Structure

```
ads-transparency-scanner/
├── server.js          # Express server & API endpoints
├── scraper.js         # Puppeteer scraping logic
├── index.html         # Frontend UI
├── apps-script.js     # Google Apps Script code (copy to your Sheet)
├── package.json       # Dependencies
├── UPLOAD.MD          # Deployment guide
└── README.md          # This file
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | Server port |

### Auto-Run Settings

- **Interval**: 1-1440 minutes (default: 1)
- **Timing**: Next run starts after previous scan completes

## Deployment

See [UPLOAD.MD](UPLOAD.MD) for detailed deployment instructions.

### Recommended Platforms

- **Railway** - Easiest, Puppeteer works out of box
- **DigitalOcean/Hostinger VPS** - More control, ~$5-6/mo

### Not Recommended

- Vercel, Netlify, Cloudflare Workers (serverless - Puppeteer won't work)

## Screenshots

The scanner saves screenshots to the project directory:
- `screenshot_[domain].png` - Visual capture of the transparency page
- `result_[domain].json` - Raw JSON data from the scan

## Troubleshooting

### Puppeteer Issues on Linux Server

Add these launch arguments in `scraper.js`:
```javascript
puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox']
})
```

### Port Already in Use

```bash
# Find process using port 3000
netstat -aon | grep :3000

# Kill the process (Windows)
taskkill /F /PID <pid>

# Kill the process (Linux/Mac)
kill -9 <pid>
```

### Memory Issues

Puppeteer uses significant memory. Ensure your server has at least 1GB RAM.

## License

MIT

## Author

Built with Puppeteer and Express.js

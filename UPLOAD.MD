# Deployment Options for Ads Transparency Scanner

## NOT Recommended

| Platform | Why Not |
|----------|---------|
| **Vercel** | Serverless - no persistent processes, Puppeteer fails, 10-60s timeout limits |
| **Netlify** | Same issues as Vercel - serverless, not for scraping |
| **Cloudflare Workers** | No Puppeteer support, timeout limits |

These platforms are for frontend apps and serverless functions, NOT for apps that need:
- Long-running Puppeteer/browser automation
- Persistent scheduled tasks (auto-run)
- Continuous server processes

---

## Easiest Options (PaaS)

| Platform | Pros | Cons | Cost |
|----------|------|------|------|
| **Railway** | Easy deploy, Puppeteer works out of box | Limited free tier | ~$5/mo |
| **Render** | Free tier, good for Node.js | Needs Puppeteer buildpack | Free / $7/mo |
| **Fly.io** | Good performance, global | Needs Dockerfile | ~$5/mo |

## More Control (VPS)

| Platform | Pros | Cons | Cost |
|----------|------|------|------|
| **Hostinger VPS** | Affordable, good support, easy panel | Less documentation | $5-10/mo |
| **DigitalOcean** | Simple, reliable, good docs | Manual setup | $6/mo |
| **Linode** | Affordable, fast | Manual setup | $5/mo |
| **Vultr** | Cheap, many locations | Manual setup | $5/mo |
| **Hetzner** | Very cheap in EU | EU-focused | €4/mo |

---

## Recommended: Railway (Easiest)

### Steps:
1. Push your code to GitHub
2. Go to [railway.app](https://railway.app)
3. Click "New Project" > "Deploy from GitHub repo"
4. Select your repository
5. Railway auto-detects Node.js and deploys
6. Get your public URL from the dashboard

### Environment Variables (if needed):
```
PORT=3000
```

---

## Alternative: Hostinger VPS

### 1. Purchase VPS
- Go to [hostinger.com](https://hostinger.com/vps-hosting)
- Choose KVM 1 plan (~$5-6/mo) - 1GB RAM minimum
- Select Ubuntu 22.04

### 2. Access via SSH
- Get your IP and root password from Hostinger panel
- Connect: `ssh root@your-server-ip`

### 3. Follow the same setup steps as DigitalOcean below

---

## Alternative: DigitalOcean Droplet (More Control)

### 1. Create Droplet
- Choose Ubuntu 22.04
- Select $6/mo plan (1GB RAM)
- Choose datacenter region

### 2. Connect via SSH
```bash
ssh root@your-server-ip
```

### 3. Install Node.js
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### 4. Install Chrome dependencies (for Puppeteer)
```bash
sudo apt-get install -y \
  ca-certificates \
  fonts-liberation \
  libasound2 \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libcups2 \
  libdbus-1-3 \
  libdrm2 \
  libgbm1 \
  libgtk-3-0 \
  libnspr4 \
  libnss3 \
  libxcomposite1 \
  libxdamage1 \
  libxfixes3 \
  libxkbcommon0 \
  libxrandr2 \
  xdg-utils \
  wget
```

### 5. Upload your code
```bash
# Option A: Clone from GitHub
git clone https://github.com/your-username/your-repo.git
cd your-repo

# Option B: Use SCP to upload
scp -r /path/to/project root@your-server-ip:/root/
```

### 6. Install dependencies
```bash
cd your-project
npm install
```

### 7. Install PM2 (keeps app running)
```bash
npm install -g pm2
pm2 start server.js --name "ads-scanner"
pm2 startup
pm2 save
```

### 8. Setup Nginx (optional, for domain)
```bash
sudo apt install nginx
sudo nano /etc/nginx/sites-available/default
```

Add:
```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
sudo systemctl restart nginx
```

### 9. Setup SSL (optional)
```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

---

## Useful Commands

### PM2 Commands
```bash
pm2 list              # Show running apps
pm2 logs ads-scanner  # View logs
pm2 restart ads-scanner
pm2 stop ads-scanner
pm2 delete ads-scanner
```

### Check if app is running
```bash
curl http://localhost:3000/health
```

---

## Important Notes

1. **Puppeteer on servers**: Make sure your `scraper.js` has these Puppeteer options:
   ```javascript
   puppeteer.launch({
     headless: true,
     args: ['--no-sandbox', '--disable-setuid-sandbox']
   })
   ```

2. **Firewall**: Open port 3000 (or use Nginx on port 80/443)
   ```bash
   sudo ufw allow 3000
   sudo ufw allow 80
   sudo ufw allow 443
   ```

3. **Memory**: Puppeteer uses significant memory. 1GB RAM minimum recommended.

4. **Auto-restart**: PM2 will restart your app if it crashes or server reboots.

# MVP Improvements Plan — Scaling & Performance

## The Problem

- Current scan time: **~3 minutes per batch** (5 domains)
- With large domain lists (e.g., 200 domains), a full scan takes **~2 hours**
- The bottleneck is Puppeteer: each domain opens a browser, navigates multiple pages, waits for dynamic content, takes screenshots
- Everything runs **sequentially** — one domain at a time, one batch at a time

---

## Option 1: Multiple Machines, Separate Sheets

> Run the software on several machines, each with a different Google Sheet and a different group of domains.

### How It Works
- Machine A runs `server.js` scanning domains 1–100
- Machine B runs `server.js` scanning domains 101–200
- Each machine has its own Apps Script URL pointing to a different Sheet (or different tab)

### Pros
- Zero code changes needed — works today
- True hardware parallelism (separate CPU, RAM, network)
- No resource contention between scanners
- Simple to set up and manage

### Cons
- Manual domain splitting — need to divide domains across Sheets
- Results are split across multiple Sheets (need to merge later)
- Requires access to multiple machines
- Each machine needs Node.js + Puppeteer + Chrome installed

### Effort: **None (ready now)**

---

## Option 2: Multiple Ports on Same Machine (Preferred)

> Run multiple instances of the server on different ports, each scanning a subset of domains simultaneously.

### How It Works
- Instance 1: `PORT=3000` → scans domains 1–100
- Instance 2: `PORT=3001` → scans domains 101–200
- Instance 3: `PORT=3002` → scans domains 201–300
- All instances write to the **same Google Sheet** via the same Apps Script URL

### Architecture
```
                    ┌─────────────────────┐
                    │   Google Sheet      │
                    │   (RESULTS tab)     │
                    └──────▲──▲──▲────────┘
                           │  │  │
              ┌────────────┘  │  └────────────┐
              │               │               │
     ┌────────┴───────┐ ┌────┴────────┐ ┌────┴────────────┐
     │ :3000          │ │ :3001       │ │ :3002           │
     │ domains 1-100  │ │ domains     │ │ domains         │
     │                │ │ 101-200     │ │ 201-300         │
     └────────────────┘ └─────────────┘ └─────────────────┘
            Same Machine (separate Chrome processes)
```

### Implementation Steps
1. Create a **launcher script** (`parallel-run.js`) that:
   - Fetches all domains from the Sheet (single call)
   - Splits domains into N groups
   - Spawns N child processes of `server.js` on different ports
   - Monitors progress from all instances
2. Each instance runs independently with its own Puppeteer browser
3. All instances share the same Apps Script URL and Drive API credentials

### Pros
- Significant speedup: **N instances ≈ N× faster** (limited by CPU/RAM)
- Single machine — no extra hardware needed
- Results go to the same Sheet — no merging
- Can be launched with a single command

### Cons
- Each Chrome instance uses ~300–500 MB RAM
- CPU-bound: 3 instances on a 4-core machine is practical; 10 might not be
- Need to be careful with Google API rate limits (Drive uploads, Apps Script calls)

### Practical Limits
| Instances | RAM Needed | Speedup | Good For              |
|-----------|------------|---------|----------------------|
| 2         | ~1 GB      | ~2×     | Most laptops         |
| 3         | ~1.5 GB    | ~3×     | 8 GB+ RAM machines   |
| 4–5       | ~2–2.5 GB  | ~4–5×  | 16 GB+ RAM machines  |

### Effort: **Medium (1–2 hours)**

---

## Option 3: Parallel Browser Tabs (Recommended Addition)

> Instead of scanning one domain at a time, open multiple browser tabs in a single Puppeteer instance.

### How It Works
- Current: 1 browser → 1 tab → scan domain → close tab → next domain
- Proposed: 1 browser → 3 tabs → scan 3 domains simultaneously → next 3

### Implementation
- Modify `scraper.js` to accept a shared `browser` instance
- In the batch loop, launch N `page` objects in parallel using `Promise.all()`
- Control concurrency (e.g., 3 tabs at a time) to avoid overloading

### Pros
- **Simplest code change** — only modify the scan loop
- Single browser process = less RAM overhead than Option 2
- Works alongside Option 2 for even more speedup
- No infrastructure changes

### Cons
- Tabs share the same browser process — one crash affects all
- Diminishing returns past 3–4 tabs (single browser bottleneck)
- Network bandwidth becomes the bottleneck with many tabs

### Expected Speedup: **2–3× with 3 parallel tabs**
### Effort: **Small (30 min – 1 hour)**

---

## Option 4: Headless API / Lightweight Scraping

> Replace Puppeteer full-page rendering with lighter-weight data fetching where possible.

### How It Works
- The Google Ads Transparency Center has internal API calls (visible in Network tab)
- Intercept or replicate those API calls directly instead of rendering the full page
- Use Puppeteer only for the screenshot, fetch data via HTTP

### Pros
- Dramatically faster — API calls take seconds, not minutes
- Much less resource usage
- Could scan 10–50 domains per minute

### Cons
- Google's internal APIs are undocumented and may change
- May require reverse-engineering request signatures
- Higher risk of being blocked
- Screenshot still requires Puppeteer

### Effort: **High (research + implementation)**

---

## Option 5: Queue-Based Architecture (Future Scale)

> Central queue distributes work to multiple scanner workers.

### How It Works
```
Sheet → Queue (Redis/file) → Worker 1 (port 3000)
                            → Worker 2 (port 3001)
                            → Worker 3 (port 3002)
                            → Results → Sheet
```
- A master process reads domains and pushes to a queue
- Workers pull from the queue and scan independently
- Workers auto-balance load (fast workers do more)

### Pros
- Scales to any number of workers (local or remote)
- Auto load-balancing — no manual domain splitting
- Workers can be added/removed dynamically
- Fault-tolerant — failed domains get re-queued

### Cons
- More complex architecture
- Needs a queue system (Redis, or simple file-based)
- Overkill for < 500 domains

### Effort: **High (half day)**

---

## Recommended Approach (Phased)

### Phase 1 — Quick Win (Today)
**Option 3: Parallel Browser Tabs**
- Modify the scan loop to run 3 domains in parallel per batch
- Minimal code change, immediate ~2–3× speedup
- 3 min per batch → ~1 min per batch

### Phase 2 — Major Speedup (Next)
**Option 2: Multiple Ports**
- Create `parallel-run.js` launcher
- Run 2–3 instances on different ports
- Combined with Phase 1: **~6–9× total speedup**
- 200 domains: from ~2 hours → ~15–20 minutes

### Phase 3 — Future Scale (If Needed)
**Option 5: Queue-Based**
- Only if domain count grows to 500+
- Or if deploying across multiple machines

---

## Time Estimates (200 Domains)

| Setup                              | Time Estimate |
|------------------------------------|---------------|
| Current (sequential)               | ~120 min      |
| + Parallel tabs (3)                | ~40 min       |
| + Multi-port (3 instances)         | ~15 min       |
| + Parallel tabs + Multi-port       | ~10–15 min    |
| + Lightweight API (Option 4)       | ~5 min        |

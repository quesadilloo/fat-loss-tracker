# Fat Loss Tracker

A self-contained, mobile-friendly web app for tracking weight, measurements, workouts,
milestones, and projections. No build step, no framework — just static HTML/CSS/JS.

## Run locally

Open `index.html` directly, or serve the folder:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Where your data lives

All data is stored in your browser's **localStorage** (keys prefixed `flt_`). It persists
across reloads and reopening the app on the **same device + browser**. Nothing is uploaded.

- **Back up / move devices:** Settings → *Export all data (JSON)* gives you a file you can
  *Import* on another device (e.g. phone ↔ laptop).
- localStorage is per-device, so logging on your phone and laptop keeps two separate copies
  unless you export/import between them.

## Deploy to Vercel (free)

1. Create a GitHub repo and push this folder:
   ```bash
   git add -A
   git commit -m "Fat loss tracker"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<repo-name>.git
   git push -u origin main
   ```
2. Go to https://vercel.com → **Add New… → Project** → import the repo.
3. Framework preset: **Other** (static site — no build command, no output dir).
4. Click **Deploy**. You'll get a URL like `https://<repo-name>.vercel.app`.
5. On your phone, open that URL and use **Share → Add to Home Screen** for an app-like icon.

Every `git push` to `main` auto-deploys the update.

## Screens

Dashboard · Milestones · Log & Measure · Workouts · Diary · Projection · Settings

## The maths (Mifflin–St Jeor)

- **Maintenance:** `(10·wt + 6.25·ht − 5·age + s) × activity_multiplier`, `s = −161` (female) /
  `+5` (male). Recalculates from your current 7-day-avg weight.
- **Deficit-day intake:** `maintenance − daily_deficit`
- **7-day average:** mean of the last 7 logged weights.
- **Implied loss rate:** `daily_deficit × 7 ÷ 7700` kg/week.

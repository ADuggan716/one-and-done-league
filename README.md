# One and Done League

Local-first One and Done toolkit for:
- Public dashboard (`/public/index.html`) with standings and golfer availability
- Weekly pick support (`/private/recommendations.html`)
- Automated data refresh from Splash Sports + online sources

## Free Hosting (Recommended)

You can host this for **$0** using GitHub + Netlify free tiers.

### What you’ll get
- One shareable URL that always works
- Data auto-refreshes on:
  - Thursday 9:00 AM ET (pick refresh)
  - Sunday 8:00 PM ET (results refresh)

### Step 1: Push this folder to GitHub
1. Create a new GitHub repo.
2. Push `/Users/andrew/Projects/Misc` to it.

### Step 2: Connect repo to Netlify
1. In Netlify, click **Add new site** -> **Import an existing project**.
2. Pick your GitHub repo.
3. Build settings:
   - Build command: *(leave blank)*
   - Publish directory: `.`
4. Deploy.

`netlify.toml` is already included and routes `/` to the standings page.

### Step 3: Add GitHub repo secrets (for real data)
In GitHub repo -> **Settings** -> **Secrets and variables** -> **Actions** -> **New repository secret**, add:
- `RYP_LEAGUE_ID` (set this to your Splash league path, e.g. `/Golf/PickX/multiple_entries.cfm`)
- `RYP_COOKIE`
- `FORM_SOURCE_URL`
- `FORM_SOURCE_API_KEY`
- `COURSE_SOURCE_URL`
- `COURSE_SOURCE_API_KEY`

### Step 4: Enable auto refresh workflow
The workflow is already included at:
- `.github/workflows/sync-data.yml`

It runs hourly but only executes sync during your two New York time windows.

### Step 5: First manual refresh
In GitHub -> **Actions** -> **Sync League Data** -> **Run workflow**.

After it runs, Netlify auto-redeploys and your shared link shows fresh data.

## Local preview

```bash
cd /Users/andrew/Projects/Misc
python3 -m http.server 8080
```

Open:
- `http://127.0.0.1:8080/public/index.html`
- `http://127.0.0.1:8080/private/recommendations.html`

# One and Done League

Local-first One and Done toolkit for:
- Public dashboard (`/public/index.html`) with standings and golfer availability
- Weekly pick support (`/private/recommendations.html`)
- Automated data refresh from Splash Sports + online sources

## Free Hosting (Recommended)

Use **GitHub Pages** for the public site and **GitHub Actions** for data refreshes.

### What you’ll get
- One shareable URL from GitHub Pages
- Public dashboard at `/`
- Weekly pick support at `/private/`
- Data auto-refreshes on:
  - Thursday 9:00 AM ET (pick refresh)
  - Sunday 8:00 PM ET (results refresh)

### Step 1: Push this folder to GitHub
1. Create a new GitHub repo.
2. Push `/Users/andrew/Projects/Misc` to it.

### Step 2: Add GitHub repo secrets (for real data)
In GitHub repo -> **Settings** -> **Secrets and variables** -> **Actions** -> **New repository secret**, add:
- `RYP_LEAGUE_ID` (set this to your Splash league path, e.g. `/Golf/PickX/multiple_entries.cfm`)
- `RYP_COOKIE`
- `FORM_SOURCE_URL`
- `FORM_SOURCE_API_KEY`
- `COURSE_SOURCE_URL`
- `COURSE_SOURCE_API_KEY`

### Step 3: Enable workflows
The workflows are already included at:
- `.github/workflows/sync-data.yml`
- `.github/workflows/deploy-pages.yml`

`sync-data.yml` runs hourly but only executes sync during your two New York time windows. `deploy-pages.yml` publishes the site to GitHub Pages whenever `main` changes.

### Step 4: Turn on GitHub Pages
In GitHub repo -> **Settings** -> **Pages**:
1. Source: **GitHub Actions**
2. Save

### Step 5: First manual refresh
In GitHub -> **Actions** -> **Sync League Data** -> **Run workflow**.

After it runs, GitHub commits updated JSON and the Pages deploy workflow republishes the site.

## Local preview

```bash
cd /Users/andrew/Projects/Misc
python3 -m http.server 8080
```

Open:
- `http://127.0.0.1:8080/public/index.html`
- `http://127.0.0.1:8080/private/recommendations.html`

Build the GitHub Pages output locally:

```bash
cd /Users/andrew/Projects/Misc
npm run build:site
```

The publishable site is written to `dist/`.

## Faster ship loop (automated)

Run one command to:
1. run tests
2. commit and push your branch
3. trigger GitHub `sync-data.yml` (`force_run=true`) and wait for completion (if `gh` CLI is installed + authenticated)
4. verify live site response (if `SITE_URL` is set)

```bash
cd /Users/andrew/Projects/Misc
SITE_URL="https://<your-github-username>.github.io/<repo-name>/" npm run release:sync:check -- "feat: update standings layout"
```

If you want to skip tests:

```bash
cd /Users/andrew/Projects/Misc
SKIP_TESTS=1 SITE_URL="https://<your-github-username>.github.io/<repo-name>/" npm run release:sync:check -- "chore: content tweak"
```

Prerequisites for GitHub workflow automation:
- `gh` installed (example: `brew install gh`)
- authenticated (`gh auth login`)

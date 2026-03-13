# One and Done League

Local-first One and Done toolkit for:
- Public dashboard (`/public/index.html`) with standings and golfer availability
- Weekly pick support (`/private/recommendations.html`)
- Automated data refresh from Splash Sports + online sources

## Free Hosting (Recommended)

Use **GitHub Pages** for the public site. For Splash data refreshes, use your **local Mac session** and push the updated JSON to GitHub.

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

### Step 2: Turn on GitHub Pages
In GitHub repo -> **Settings** -> **Pages**:
1. Source: **GitHub Actions**
2. Save

### Step 3: Local config for Splash sync
Keep your working Splash cookie locally in:
- `config/runyourpool.cookie`

Keep your local settings in:
- `config/config.json`

### Step 4: First local sync + publish
Run:

```bash
cd /Users/andrew/Projects/Misc
npm run sync:local:publish
```

That will:
1. pull online signals
2. sync Splash data using your local cookie
3. update JSON files in `data/`
4. commit the changed data
5. push to GitHub

GitHub Pages will then republish the site automatically.

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

## Local scheduled refresh on your Mac

If you want the Thursday/Sunday refresh to happen automatically from your own machine:

```bash
cd /Users/andrew/Projects/Misc
bash scripts/install_launchd.sh
```

That installs a macOS `launchd` agent that runs:
- Thursday at 9:00 AM local time
- Sunday at 8:00 PM local time

Important:
- your Mac needs to be on
- your local Splash cookie in `config/runyourpool.cookie` needs to still be valid
- Git needs to already be authenticated on your Mac

## Faster ship loop (automated)

Run one command to:
1. run tests
2. commit and push your branch
3. verify the live GitHub Pages site (if `SITE_URL` is set)

```bash
cd /Users/andrew/Projects/Misc
SITE_URL="https://<your-github-username>.github.io/<repo-name>/" npm run release:sync:check -- "feat: update standings layout"
```

If you want to skip tests:

```bash
cd /Users/andrew/Projects/Misc
SKIP_TESTS=1 SITE_URL="https://<your-github-username>.github.io/<repo-name>/" npm run release:sync:check -- "chore: content tweak"
```

Prerequisites for local automation:
- `gh` installed (example: `brew install gh`)
- authenticated (`gh auth login`)

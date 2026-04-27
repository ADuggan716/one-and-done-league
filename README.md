# One and Done League

Local-first One and Done toolkit for:
- League Dashboard (`app/league/index.html`) with standings and golfer availability
- Selector (`app/selector/recommendations.html`)
- Automated data refresh from Splash Sports + online sources

## Free Hosting (Recommended)

Use **GitHub Pages** for the league site. For Splash data refreshes, use your **local Mac session** and push the updated JSON to GitHub.
The recurring Thursday/Sunday sync should run from your Mac, not from GitHub Actions.

### What you’ll get
- One shareable URL from GitHub Pages
- League Dashboard at `/`
- Selector at `/selector/`
- Data auto-refreshes on:
  - Thursday 8:00 AM ET (pick refresh)
  - Thursday 8:00 PM ET (evening refresh)
  - Friday 8:00 PM ET (evening refresh)
  - Saturday 8:00 PM ET (evening refresh)
  - Sunday 8:00 PM ET (results refresh)

### Step 1: Push this folder to GitHub
1. Create a new GitHub repo.
2. Push `/Users/androo/Codex/projects/golf` to it.

### Step 2: Turn on GitHub Pages
In GitHub repo -> **Settings** -> **Pages**:
1. Source: **GitHub Actions**
2. Save

### Step 3: Local config for Splash sync
Keep your working Splash cookie locally in:
- `config/runyourpool.cookie`

Keep your local settings in:
- `config/config.json`

`config/runyourpool.cookie` can now be any of these formats:
- a raw `Cookie: ...` header copied from a working browser request
- plain `name=value; name2=value2` cookie pairs
- a Netscape cookie-jar export
- a JSON array export from a browser cookie extension

Validate the cookie before a full sync:

```bash
cd /Users/androo/Codex/projects/golf
npm run check:cookie
```

If that prints `AUTH_EXPIRED`, `COOKIE_PLACEHOLDER`, or returns the Splash `/sign-in` page, the cookie input is not usable yet.

### Step 4: First local sync + publish
Run:

```bash
cd /Users/androo/Codex/projects/golf
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
cd /Users/androo/Codex/projects/golf
python3 -m http.server 8080
```

Open:
- `http://127.0.0.1:8080/app/league/index.html`
- `http://127.0.0.1:8080/app/selector/recommendations.html`

Build the GitHub Pages output locally:

```bash
cd /Users/androo/Codex/projects/golf
npm run build:site
```

The publishable site is written to `dist/`.

## Local scheduled refresh on your Mac

If you want the Thursday/Sunday refresh to happen automatically from your own machine:

```bash
cd /Users/androo/Codex/projects/golf
bash scripts/install_launchd.sh
```

That installs a macOS `launchd` agent that runs:
- Thursday at 8:00 AM local time
- Thursday at 8:00 PM local time
- Friday at 8:00 PM local time
- Saturday at 8:00 PM local time
- Sunday at 8:00 PM local time

The scheduled flow uses direct Splash cookie sync with retries.
Chrome automation is not the default scheduled path because AppleScript/Chrome settings can break unattended runs.
If you want to try Chrome as a manual fallback, run:

```bash
cd /Users/androo/Codex/projects/golf
ALLOW_CHROME_FALLBACK=1 npm run sync:local:publish
```

Important:
- your Mac needs to be on
- your local Splash cookie in `config/runyourpool.cookie` needs to still be valid
- Git needs to already be authenticated on your Mac
- `scripts/install_launchd.sh` reads `config/config.json` and installs those windows into `launchd`
- your Mac timezone should be set to Eastern Time if you want exact 8:00 AM ET / 8:00 PM ET execution

Practical note:
- both the League Dashboard and Selector use the same generated JSON in `data/`
- fixing the Splash cookie/sync path fixes both sites at once

Verify the installed schedule:

```bash
launchctl print gui/$(id -u)/com.andrew.oneanddone.sync
```

Watch the sync logs:

```bash
tail -f /Users/androo/Codex/projects/golf/logs/launchd.out.log
tail -f /Users/androo/Codex/projects/golf/logs/launchd.err.log
tail -f /Users/androo/Codex/projects/golf/logs/sync.log
```

The install script also adds a daily health check at 9:15 AM local time.
That health check will:
- verify the main `launchd` sync job is still installed and loaded
- verify a successful sync heartbeat exists after the most recent scheduled sync window
- send an email alert using the same `~/.config/golf-sync-alert.env` SMTP settings if the scheduler disappears or misses a scheduled run

Run the health check manually:

```bash
cd /Users/androo/Codex/projects/golf
npm run check:sync-health
```

## GitHub Actions sync

`/.github/workflows/sync-data.yml` is kept as a manual-only backup path.
Do not rely on GitHub-hosted scheduled sync for Splash because a static secret cookie cannot be refreshed there and Splash can return empty-but-parseable HTML that is not dependable for unattended updates.

## Faster ship loop (automated)

Run one command to:
1. run tests
2. commit and push your branch
3. verify the live GitHub Pages site (if `SITE_URL` is set)

```bash
cd /Users/androo/Codex/projects/golf
SITE_URL="https://<your-github-username>.github.io/<repo-name>/" npm run release:sync:check -- "feat: update standings layout"
```

If you want to skip tests:

```bash
cd /Users/androo/Codex/projects/golf
SKIP_TESTS=1 SITE_URL="https://<your-github-username>.github.io/<repo-name>/" npm run release:sync:check -- "chore: content tweak"
```

Prerequisites for local automation:
- `gh` installed (example: `brew install gh`)
- authenticated (`gh auth login`)

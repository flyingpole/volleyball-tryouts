# Volleyball Tryouts

A no-database tryout evaluation app. Coaches score players on skills (starting
with Serving) from their phone; every attempt writes straight into a Google
Sheet you can watch update live during tryouts.

- **Frontend**: static HTML/CSS/JS, hosted free on GitHub Pages.
- **Backend**: a Google Apps Script Web App bound to one Google Sheet — no
  database, no server to run.

## How scoring works (Serving)

Each attempt is one button press from **Result**, plus an optional bonus:

- **Missed** — 0 points, but still logged as an attempt.
- **&lt;30 mph** (made it) — 1 point.
- **30–35 mph** (made it) — 2 points.
- **&gt;35 mph** (made it) — 3 points.
- **Hit Target** bonus — +1 point, only selectable if the serve wasn't missed.

Max 4 points per attempt. Scores are computed server-side in `Code.gs` (the
web app never trusts a client-sent score).

## One-time setup

### 1. Paste the backend into your Google Sheet
1. Open the Google Sheet you want to use for tryouts.
2. Open **Extensions → Apps Script**.
3. Delete whatever is in the default `Code.gs` file and paste in the full
   contents of this repo's [`Code.gs`](Code.gs) — replace everything, don't
   merge.
4. Save the project (▤ icon or Ctrl/Cmd+S; any project name is fine).

### 2. Run the one-time setup function
1. In the Apps Script editor toolbar, select `setupSheet` from the function
   dropdown next to the Run button, and click **Run**.
2. Approve the permissions prompt (it needs to edit the spreadsheet it's
   bound to). This creates/rebuilds the `Roster`, `Log`, `Master`, and
   `Serving Rankings` tabs.
3. **If you already have a tab with columns like `Player #, Name, Positions,
   Grade, Serving, Passing, Attacking Pin, Attacking MB, Blocking`** — rename
   that tab to exactly `Master` before running `setupSheet`. The script will
   overwrite its Player #/Name/Positions/Grade/skill columns with formulas
   that pull live from `Roster` and `Log`, so copy any player data you'd
   already typed into it over to the `Roster` tab first (see step 3).
4. `setupSheet` is safe to re-run any time — it rebuilds `Master` and
   `Serving Rankings` from scratch. It never touches `Roster`, `Log`, or coach
   tabs, so re-running won't lose data.

### 3. Fill in the roster
Open the `Roster` tab and fill in each player: **Player #**, **Name**,
**Positions** (free text, e.g. `OH, MB`), **Grade**. Add more players any time
before or during tryouts. If a coach evaluates a player number that isn't
listed yet, the app adds a bare row for them automatically — no attempt is
lost, though Positions/Grade will be blank until you fill them in.

`Master` and every coach's tab mirror the same columns — Player #, Name,
Positions, Grade, then one average-score column per skill (Serving, Passing,
Attacking Pin, Attacking MB, Blocking). Only Serving has a scoring UI so far;
the other skill columns will just stay blank until those pages exist.

### 4. Deploy the Web App
1. In the Apps Script editor, click **Deploy → New deployment**.
2. Click the gear icon next to "Select type" and choose **Web app**.
3. Set:
   - **Execute as**: Me
   - **Who has access**: Anyone
4. Click **Deploy**, approve any prompts, and copy the **Web app URL**
   (looks like `https://script.google.com/macros/s/AKfycb.../exec`).

If you ever edit `Code.gs` again, use **Deploy → Manage deployments → Edit →
New version** so the live URL picks up the changes (a plain save is not
enough).

### 5. Wire up the frontend
1. Open [`config.js`](config.js) in this repo and replace
   `PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE` with the Web app URL from step 4.
2. Commit and push.

### 6. GitHub Pages
Already enabled — the app is live at
`https://flyingpole.github.io/volleyball-tryouts/`. Share that link with
coaches (they'll land on the skill picker; tap **Serving**). It picks up
`config.js` changes as soon as you push them (usually within a minute).

## The rankings tab

`Serving Rankings` shows every player sorted by average Serving score (filter
by position with the dropdown in B1), with attempt count, distinct-coach
count, and a **⚠ Needs more looks** flag. A player is flagged if they have
fewer than 3 attempts, fewer than 2 coaches have evaluated them, or their
score is within 0.3 of the next-ranked player — tune these in `Code.gs`
(`FLAG_MIN_ATTEMPTS`, `FLAG_MIN_COACHES`, `FLAG_SCORE_GAP`).

## Adding a new skill later

1. Decide that skill's button set and point values, then add a
   `computeXScore`-style function in `Code.gs` alongside `computeServingScore`.
2. In `setupSheet()`, add a call to `buildSkillRankingsSheet(sheet, "Passing",
   "F")` (column letter from the `SKILLS` list at the top of `Code.gs`) — the
   `Master`/coach tab columns are already generic and pick up any skill name
   found in `Log` automatically.
3. Duplicate `serving.html` / `serving.js` into e.g. `passing.html` /
   `passing.js` with buttons matching that skill's scoring rules, and enable
   its link on `index.html`.

## Local development

These are static files — no build step. Open `index.html` directly in a
browser, or serve the folder with any static file server, to work on the UI.
Until `config.js` has a real Web App URL, the app shows a banner and the
roster/submit features are disabled so you can still exercise the button
logic and score preview offline.

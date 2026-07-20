# Volleyball Tryouts

A no-database tryout evaluation app. Coaches score players on skills (starting
with Serving) from their phone; every attempt writes straight into a Google
Sheet you can watch update live during tryouts.

- **Frontend**: static HTML/CSS/JS, hosted free on GitHub Pages.
- **Backend**: a Google Apps Script Web App bound to one Google Sheet — no
  database, no server to run.

## How scoring works (Serving)

Per serve attempt:
- **In** (serve lands in play): 1 point
- **Hit the specified spot**: 1 point (bonus)
- **Velocity**, only if the serve is In:
  - Under 30 mph → 1 point
  - 30–35 mph → 2 points
  - Over 35 mph → 3 points

Max 5 points per attempt. Scores are computed server-side in `Code.gs` (the
web app never trusts a client-sent score).

## One-time setup

### 1. Create the Google Sheet
1. Go to [sheets.google.com](https://sheets.google.com) and create a new blank
   spreadsheet. Name it e.g. **"Volleyball Tryouts"**.
2. Open **Extensions → Apps Script**.
3. Delete the default `Code.gs` contents and paste in the contents of this
   repo's [`Code.gs`](Code.gs).
4. Save the project (any name is fine, e.g. "Tryouts Backend").

### 2. Run the one-time setup function
1. In the Apps Script editor toolbar, select the `setupSheet` function from
   the dropdown next to the Run button, and click **Run**.
2. Approve the permissions prompt (it needs to edit the spreadsheet it's
   bound to). This creates the `Roster`, `Log`, `Master`, and
   `Serving Rankings` tabs with headers, checkboxes, and formulas already in
   place.
3. `setupSheet` is safe to re-run any time — it rebuilds those four tabs from
   scratch (coach tabs and your `Roster` data are left alone).

### 3. Fill in the roster
Open the `Roster` tab and fill in each player: **Player #**, **Player Name**,
then check the boxes for every position they play (OH, OPP, MB, S, D). You
can add more players any time before or during tryouts. If a coach evaluates
a player number that isn't listed yet, the app adds a bare row for them
automatically — no attempt is lost.

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

### 6. Enable GitHub Pages
Repo → **Settings → Pages** → Source: **Deploy from a branch** → Branch:
`master` / `(root)` → Save. GitHub gives you a URL like
`https://flyingpole.github.io/volleyball-tryouts/`. Share that link with
coaches (they'll land on the skill picker; tap **Serving**).

## Adding a new skill later

1. Add scoring logic to `computeServingScore`-style function in `Code.gs`
   (rename per-skill, e.g. `computePassingScore`), and a matching skill entry
   in `Log`'s `Skill` column values.
2. Duplicate `buildServingRankingsSheet` for the new skill, extend
   `setupSheet()` to call it, and re-run `setupSheet` (Master's formulas
   already read any `Skill` value from `Log`, so add the new skill's Avg/
   Attempts columns to `buildAggregateSheet` following the same pattern).
3. Duplicate `serving.html` / `serving.js` into e.g. `passing.html` /
   `passing.js` with buttons matching that skill's scoring rules, and enable
   its link on `index.html`.

## Local development

These are static files — no build step. Open `index.html` directly in a
browser, or serve the folder with any static file server, to work on the UI.
Until `config.js` has a real Web App URL, the app shows a banner and the
roster/submit features are disabled so you can still exercise the button
logic and score preview offline.

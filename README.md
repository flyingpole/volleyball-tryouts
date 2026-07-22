# Volleyball Tryouts

A no-database tryout evaluation app. Coaches score players on skills (starting
with Serving) from their phone; every attempt writes straight into a Google
Sheet you can watch update live during tryouts.

- **Frontend**: static HTML/CSS/JS, hosted free on GitHub Pages.
- **Backend**: a Google Apps Script Web App bound to one Google Sheet — no
  database, no server to run.

## How the Serving page works

1. Pick your name from the **Coach** dropdown (fixed list in `Code.gs` —
   `COACHES`). Remembered on your device after the first pick.
2. Type the player number you're starting with (e.g. `11`) and tap **Load**.
   The app shows every roster player from that number up to 9 higher (e.g.
   11–20) as a stack of rows, in numerical order — however many of those
   actually exist on the roster.
3. Tap a player's row to make them the active player (it highlights). The
   first player in the group is selected automatically after Load.

### Scoring

There's no separate "log" step — tapping an outcome logs the attempt
immediately and auto-advances to the *next* player in the group (players
serve in numerical order; tap a different row any time to override, e.g. a
player skipped this rotation):

- **Missed** — logs instantly, 0 points (still counted as an attempt).
- Tap a velocity — **Slow** (&lt;30 mph, 1pt), **Average** (30-35 mph, 2pt), or
  **Fast** (&gt;35 mph, 3pt) — to select it. This doesn't log yet, since target
  still needs a decision.
- Tap **Target ✓** or **Target ✗** to log that attempt: the velocity's base
  points plus +1 if the target was hit. The Log sheet's Result column records
  "Slow"/"Average"/"Fast"/"Missed", not raw mph ranges.

Max 4 points per attempt. Scores are computed server-side in `Code.gs` (the
web app never trusts a client-sent score). The screen updates immediately on
tap and confirms with the Sheet in the background, so a slow Apps Script
round-trip doesn't block you from moving on to the next player.

**UNDO** (top of the scoring rail) reverts your most recent attempt, and can
be tapped repeatedly to walk back up to 5 attempts — it survives a page
reload too. Undoing soft-deletes the Log row (flags it rather than removing
it) so row numbers never shift under other coaches' concurrent submissions.

## How the Passing page works

Same player list, jog wheel, coach picker, and Undo as Serving. Scoring is
simpler — every button IS the score, so tapping one logs immediately with no
separate confirm step:

- **0-Pass**, **1-Pass**, **2-Pass**, or **3-Pass** — logs that grade and
  auto-advances to the next player.

A player's Passing score is the *average* of all their pass grades (e.g.
0, 3, 1 averages to 1.33) — computed server-side the same way as every other
skill. `Passing Rankings` also tracks **0-Pass %** (their share of passes
graded 0) and uses it as a tie-breaker: among players with an equal average,
the one with the lower 0-Pass % ranks higher.

## One-time setup

### 1. Paste the backend into your Google Sheet
1. Open the Google Sheet you want to use for tryouts.
2. Open **Extensions → Apps Script**.
3. Delete whatever is in the default `Code.gs` file and paste in the full
   contents of this repo's [`Code.gs`](Code.gs) — replace everything, don't
   merge.
4. Save the project (▤ icon or Ctrl/Cmd+S; any project name is fine).

### 2. Set your coach list
At the top of `Code.gs`, edit the `COACHES` array to match your evaluators —
it currently has `Darin, Karen, Morgan, Tahya, David, Evaluator 1, Evaluator
2, Evaluator 3`. Each name gets its own tab and shows up in the app's Coach
dropdown.

### 3. Run the one-time setup function
1. In the Apps Script editor toolbar, select `setupSheet` from the function
   dropdown next to the Run button, and click **Run**.
2. Approve the permissions prompt (it needs to edit the spreadsheet it's
   bound to). This creates/rebuilds `Roster`, `Log`, `Summary Sheet`, one tab
   per name in `COACHES`, `Serving Rankings`, `Passing Rankings`, and a
   hidden `Passing Data` helper tab (used internally for Passing's 0-Pass %
   tie-break sort — no need to open it).
3. **If you already have a tab with columns like `Player #, Name, Positions,
   Grade, Serving, Passing, Attacking Pin, Attacking MB, Blocking`** — rename
   that tab to exactly `Summary Sheet` before running `setupSheet`. The script
   will overwrite its Player #/Name/Positions/Grade/skill columns with
   formulas that pull live from `Roster` and `Log`, so copy any player data
   you'd already typed into it over to the `Roster` tab first (see step 4).
   Same goes for any coach tabs you already created by hand — as long as
   they're named to exactly match an entry in `COACHES`, `setupSheet` rebuilds
   them in place with live formulas.
4. `setupSheet` is safe to re-run any time — it rebuilds `Summary Sheet`,
   every coach tab, and `Serving Rankings` from scratch. It never touches
   `Roster` or `Log`, so re-running won't lose data.

### 4. Fill in the roster
Open the `Roster` tab and fill in each player: **Player #**, **Name**,
**Positions** (free text, e.g. `OH, MB`), **Grade**. Add more players any time
before or during tryouts. If a coach evaluates a player number that isn't
listed yet, the app adds a bare row for them automatically — no attempt is
lost, though Positions/Grade will be blank until you fill them in.

`Summary Sheet` and every coach's tab mirror the same columns — Player #,
Name, Positions, Grade, then one average-score column per skill (Serving,
Passing, Attacking Pin, Attacking MB, Blocking). Serving and Passing have a
scoring UI so far; the other skill columns will just stay blank until those
pages exist.

### 5. Deploy the Web App
1. In the Apps Script editor, click **Deploy → New deployment**.
2. Click the gear icon next to "Select type" and choose **Web app**.
3. Set:
   - **Execute as**: Me
   - **Who has access**: Anyone
4. Click **Deploy**, approve any prompts, and copy the **Web app URL**
   (looks like `https://script.google.com/macros/s/AKfycb.../exec`).

If you ever edit `Code.gs` again (e.g. changing `COACHES`), use **Deploy →
Manage deployments → Edit → New version** so the live URL picks up the
changes — a plain save is not enough.

### 6. Wire up the frontend
1. Open [`config.js`](config.js) in this repo and replace
   `PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE` with the Web app URL from step 5.
2. Commit and push.

### 7. GitHub Pages
Already enabled — the app is live at
`https://flyingpole.github.io/volleyball-tryouts/`. Share that link with
coaches (they'll land on the skill picker; tap **Serving**). It picks up
`config.js` changes as soon as you push them (usually within a minute).

## The rankings tabs

Both `Serving Rankings` and `Passing Rankings` show every player sorted by
that skill's average score (filter by position with the dropdown in B1),
with attempt count, distinct-coach count, and a **⚠ Needs more looks** flag.
A player is flagged if they have fewer than 3 attempts, fewer than 2 coaches
have evaluated them, or their score is within 0.3 of the next-ranked player —
tune these in `Code.gs` (`FLAG_MIN_ATTEMPTS`, `FLAG_MIN_COACHES`,
`FLAG_SCORE_GAP`). `Passing Rankings` additionally breaks ties by 0-Pass %
(lower is better) via the hidden `Passing Data` helper tab.

## Adding a new skill later

1. Decide that skill's button set and point values, then add a
   `computeXScore`-style function in `Code.gs`, and a branch for it in
   `computePoints()`.
2. In `setupSheet()`, add a rankings sheet for it:
   - No tie-break needed → `buildSkillRankingsSheet(sheet, "SkillName", "F")`
     (column letter from the `SKILLS` list at the top of `Code.gs`), same
     pattern as Serving.
   - Need a secondary sort key not on Summary Sheet (like Passing's 0-Pass %)
     → `buildSkillDataSheet(...)` + `buildTieBreakRankingsSheet(...)`, same
     pattern as Passing.
   The `Summary Sheet`/coach tab columns are already generic and pick up any
   skill name found in `Log` automatically — no changes needed there.
3. Duplicate `serving.html` / `serving.js` (or the simpler `passing.html` /
   `passing.js`, if the new skill has no multi-step scoring like Serving's
   velocity-then-target flow) into e.g. `blocking.html` / `blocking.js` with
   buttons matching that skill's scoring rules, and enable its link on
   `index.html`.

## Local development

These are static files — no build step. Open `index.html` directly in a
browser, or serve the folder with any static file server, to work on the UI.
Until `config.js` has a real Web App URL, the app shows a banner and the
roster/submit features are disabled so you can still exercise the button
logic and score preview offline.

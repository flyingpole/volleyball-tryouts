# Volleyball Tryouts

A no-database tryout evaluation app. Coaches score players on six skills
(Serving, Passing, Attacking, Blocking, Setting, Game Play) from their phone;
every attempt writes straight into a Google Sheet you can watch update live
during tryouts.

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
the one with the lower 0-Pass % ranks higher. Its **Sequence** column shows
every grade a player got, in the order it happened (e.g. `013233110032311121`)
— a quick visual read on whether they're trending up or down.

## How the Attacking page works

Same player list, jog wheel, coach picker, and Undo as the other pages.
Three buttons, each logging immediately:

- **Kill (+)** — 1 point. **Attempt (.)** — 0 points. **Error (-)** — -1 point.

A player's Attacking score is the *average* of those values, which is also
their hitting efficiency: (Kills − Errors) ÷ (Kills + Errors + Attempts).
`Attacking Rankings` sorts by that average and shows a **Sequence** column —
every symbol in order (e.g. `++.-+..+-`) — for a quick read on their attack
pattern.

## How the Blocking page works

Same player list, jog wheel, coach picker, and Undo. Scoring has two parts
per attempt:

1. Type the **circuit time** in seconds into the field on the scoring rail.
2. Tap a quality button — **Red** (1), **Yellow** (2), or **Green** (3) — to
   log that attempt. The quality buttons stay disabled until a valid time
   (a positive number) is typed, and the time field clears after each log so
   you can't accidentally reuse the last player's time.

Lower time is better here, so `Blocking Rankings` sorts by **Avg Time**
ascending, breaking ties by **Best Time** (also ascending). It also shows
Worst Time and Attempts, plus an **Avg Quality** column shaded on a
red→yellow→green gradient — a fast player with weak technique stands out
visually even though their time rank looks good.

## How the Setting page works

Same player list, jog wheel, coach picker, and Undo. Four buttons — logging
immediately:

- **Front Hit ✓** / **Front Miss ✗** / **Back Hit ✓** / **Back Miss ✗**.

A player's Setting score is their overall hit rate (hits ÷ attempts, combining
front and back). `Setting Rankings` additionally breaks it out into **Front
%** and **Back %** so you can see whether a player struggles with one type of
set specifically, even though ranking itself uses the combined rate.

## How the Game Play page works

Same player list, jog wheel, coach picker, and Undo. Nine buttons, grouped
into five play types, each logging immediately:

- **Serve**: Service Ace (+1) / Serve Error (-1)
- **Serve Receive**: Serve Receive (+1) / Serve Receive Error (-1)
- **Attack**: Attack Kill (+1) / Attack Error (-1)
- **Dig**: Dig Error (-1) — no positive Dig button
- **Block**: Block (+1) / Block Error (-1)

Unlike the other skills, a player's Game Play score is a running *total* of
every +1/-1, not an average — shown live on their row instead of an attempt
count. `Game Play Rankings` sorts by that total, highest first, and also
breaks it down into one column per play type (e.g. an "Attack" column reading
`+-++--+`) so a coach can see which specific skill is driving a player's
total up or down.

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
   per name in `COACHES`, a rankings tab per skill (`Serving Rankings`,
   `Passing Rankings`, `Attacking Rankings`, `Blocking Rankings`, `Setting
   Rankings`, `Game Play Rankings`), `Position Rankings`, and hidden helper
   tabs (`Passing Data`, `Blocking Data`) used internally for tie-break/stat
   sorting — no need to open them.
3. **If you already have a tab with columns like `Player #, Name, Positions,
   Grade, Serving, Passing, Attacking, Blocking, Setting, Game Play`** —
   rename that tab to exactly `Summary Sheet` before running `setupSheet`. The
   script will overwrite its Player #/Name/Positions/Grade/skill columns with
   formulas that pull live from `Roster` and `Log`, so copy any player data
   you'd already typed into it over to the `Roster` tab first (see step 4).
   Same goes for any coach tabs you already created by hand — as long as
   they're named to exactly match an entry in `COACHES`, `setupSheet` rebuilds
   them in place with live formulas.
4. `setupSheet` is safe to re-run any time — it rebuilds `Summary Sheet`,
   every coach tab, and every rankings tab from scratch. It never touches
   `Roster` or `Log`, so re-running won't lose data.

### 4. Fill in the roster
Open the `Roster` tab and fill in each player: **Player #**, **Name**,
**Positions** (free text, e.g. `OH, MB`), **Grade**. Add more players any time
before or during tryouts. If a coach evaluates a player number that isn't
listed yet, the app adds a bare row for them automatically — no attempt is
lost, though Positions/Grade will be blank until you fill them in.

Every coach's tab has: Player #, Name, Positions, Grade, then one score column
per skill (Serving, Passing, Attacking, Blocking, Setting, Game Play — Game
Play's is a running total, Blocking's is average circuit time in seconds,
everything else is an average score).

`Summary Sheet` has those same columns (combining every coach), plus a **Rank**
next to each skill average (1 = best — Blocking ranks ascending since a lower
time is better, everything else ranks descending), and two summary columns at
the end: **Avg Rank** (the mean of whichever skill ranks a player actually
has — a skill they haven't been evaluated in doesn't drag it down) and
**Overall Rank**, sorting players by that Avg Rank ascending. That's the
single number for "who's the best all-around player so far."

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
coaches (they'll land on the skill picker; tap whichever skill they're
evaluating). It picks up `config.js` changes as soon as you push them
(usually within a minute).

## The rankings tabs

Every skill's rankings tab shows players sorted best-first for that skill
(filter by position with the dropdown in B1), with attempt count,
distinct-coach count, and a **⚠ Needs more looks** flag. A player is flagged
if they have fewer than 3 attempts, fewer than 2 coaches have evaluated them,
or their score is within 0.3 of the next-ranked player — tune these in
`Code.gs` (`FLAG_MIN_ATTEMPTS`, `FLAG_MIN_COACHES`, `FLAG_SCORE_GAP`).

A few tabs add skill-specific columns on top of that:
- `Passing Rankings` breaks ties by 0-Pass % (lower is better) via the hidden
  `Passing Data` helper tab, and shows a **Sequence** of every grade in order.
- `Attacking Rankings` shows a **Sequence** of every +/./- symbol in order.
- `Blocking Rankings` sorts by Avg Time ascending (tie-broken by Best Time
  ascending) via the hidden `Blocking Data` helper tab, and shows Best/Worst/
  Avg Time plus a red→yellow→green gradient-shaded Avg Quality column.
- `Setting Rankings` shows separate Front % and Back % columns alongside the
  combined hit rate used for ranking.
- `Game Play Rankings` sorts by total points (a sum, not an average) since
  that skill scores +1/-1 per play rather than grading each attempt, and adds
  a per-play-type column (Serve, Serve Receive, Attack, Dig, Block) showing
  that type's own +/- sequence in order.

`Position Rankings` shows five ranked lists side by side, one per position
(`POSITION_FILTER_OPTIONS` in `Code.gs` — currently OH, RS, MB, Def, S),
sorted by Summary Sheet's Avg Rank ascending — the cross-skill composite, not
any single skill. Scan across the row to see the best available player at
each position. Position matching everywhere in the app checks for an exact,
comma-separated code (so filtering by "S" won't also match "RS") — if you use
different position codes, editing `POSITION_FILTER_OPTIONS` updates every
rankings tab's filter dropdown and Position Rankings' columns together.

## Adding a new skill later

1. Add an entry to the `SKILLS` array at the top of `Code.gs` — `{ name, col
   }`, plus `agg: "sum"` if the score should total rather than average (like
   Game Play) and `lowerIsBetter: true` if a smaller number ranks higher
   (like Blocking's time). This column drives `Summary Sheet`, every coach
   tab, and `Position Rankings` automatically — no other changes needed there.
2. Decide the button set and point values, then add a `computeXScore`-style
   function in `Code.gs` and a branch for it in `computeScoreDetails()`. Most
   skills only need a `points` number; if a second metric is needed per
   attempt (like Blocking's quality alongside time), return `{ points,
   value2 }` — `value2` is a spare column on the `Log` sheet with no meaning
   of its own until a skill uses it.
3. In `setupSheet()`, add a rankings sheet for it:
   - No tie-break, no extra columns → `buildSkillRankingsSheet(sheet,
     "SkillName", "F")` (column letter from `SKILLS`), same pattern as
     Serving. Pass `{ label, sourceColumnLetter }` as a fourth argument for a
     concatenated-symbol "Sequence" column, like Attacking's.
   - Need a secondary sort key not on Summary Sheet (like Passing's 0-Pass %)
     → `buildSkillDataSheet(...)` + `buildTieBreakRankingsSheet(...)`, same
     pattern as Passing.
   - Need bespoke stats/columns (like Blocking's time stats + quality
     gradient, or Setting's Front/Back breakdown) → write a dedicated pair of
     builder functions, same pattern as `buildBlockingDataSheet` /
     `buildBlockingRankingsSheet` or `buildSettingRankingsSheet`.
4. Duplicate an existing skill page closest to the new one's interaction
   pattern (`passing.html`/`.js` for simple tap-to-log buttons, `blocking.js`
   for a text-entry-plus-buttons flow) into e.g. `blocking.html` /
   `blocking.js` with buttons matching that skill's scoring rules, and enable
   its link on `index.html`.
5. After pasting the updated `Code.gs` into the Sheet's Apps Script editor,
   redeploy (**Deploy → Manage deployments → Edit → New version**) and re-run
   `setupSheet()` to build the new tabs.

## Local development

These are static files — no build step. Open `index.html` directly in a
browser, or serve the folder with any static file server, to work on the UI.
Until `config.js` has a real Web App URL, the app shows a banner and the
roster/submit features are disabled so you can still exercise the button
logic and score preview offline.

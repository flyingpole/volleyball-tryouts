// Volleyball Tryouts — Apps Script backend.
// This file is version-controlled for reference; the copy that actually runs
// lives in the bound Google Sheet's Apps Script editor (Extensions > Apps Script).
// See README.md for deployment steps.

// Bump this string whenever this file changes, using TODAY'S actual date
// (not the date of some earlier edit, incremented by guesswork) — it's the
// only way to tell whether a pasted-in copy is current. After redeploying
// (Deploy > Manage deployments > Edit > New version > Deploy), open the Web
// app URL directly in a browser with no query string — the JSON response's
// "version" field should match this, confirming the redeploy actually took.
const CODE_VERSION = "2026-08-10-live-attempts-all-skills";

const SHEETS = {
  ROSTER: "Roster",
  LOG: "Log",
  SUMMARY: "Summary Sheet",
  SERVING_RANKINGS: "Serving Rankings",
  PASSING_RANKINGS: "Passing Rankings",
  PASSING_DATA: "Passing Data", // hidden helper sheet, not for manual editing
  ATTACKING_RANKINGS: "Attacking Rankings",
  BLOCKING_DATA: "Blocking Data", // hidden helper sheet, not for manual editing
  BLOCKING_RANKINGS: "Blocking Rankings",
  SETTING_RANKINGS: "Setting Rankings",
  GAME_PLAY_RANKINGS: "Game Play Rankings",
  DIGGING_RANKINGS: "Digging Rankings",
  POSITION_RANKINGS: "Position Rankings",
};

// Fixed list of coaches/evaluators — each gets their own tab, and the app's
// coach picker is a dropdown built from this list (no free-text typing).
// Add or rename names here, then re-run setupSheet() to build/rebuild tabs.
const COACHES = [
  "Darin", "Karen", "Morgan", "Tahya", "David",
  "Evaluator 1", "Evaluator 2", "Evaluator 3",
];

const RESERVED_SHEETS = Object.values(SHEETS);

// Setting logs a whole batch of balls at once (fixed count + how many hit
// the target) instead of one attempt per tap — this is the server-side
// allowlist for that fixed count, mirrored by the <select> options in
// setting.html. Never trust the client's count beyond this list.
const SETTING_BATCH_SIZES = [5, 10, 15, 20, 25];

// Skill columns on Summary Sheet / each coach tab, in sheet order (E onward).
// agg: "avg" (default) or "sum" — Game Play's score is a running total, not
// an average. lowerIsBetter: Blocking's time is better when smaller, so its
// Summary Sheet Rank is ascending instead of the usual descending.
// Add an entry here (and a matching *Rankings sheet) when a new skill's
// scoring UI ships — Summary Sheet/coach tab formulas pick it up automatically.
const SKILLS = [
  { name: "Serving", col: "E" },
  { name: "Passing", col: "F" },
  { name: "Attacking", col: "G" },
  { name: "Blocking", col: "H", lowerIsBetter: true },
  { name: "Setting", col: "I" },
  { name: "Game Play", col: "J", agg: "sum" },
  { name: "Digging", col: "K" },
];

// Position codes used on Roster's free-text Positions field (e.g. "OH, MB")
// — drives the filter dropdown on ranking sheets AND the per-position blocks
// on Position Rankings. Edit this if your team uses different codes.
const POSITION_FILTER_OPTIONS = ["OH", "RS", "MB", "Def", "S"];

const ROSTER_MAX_ROWS = 250; // headroom for players; raise if a tryout group is bigger
const LOG_MAX_ROWS = 10000; // headroom for Game Play Rankings' bounded array-formula ranges

// "Needs more looks" thresholds for the rankings tabs — tune freely.
const FLAG_MIN_ATTEMPTS = 3;
const FLAG_MIN_COACHES = 2;
const FLAG_SCORE_GAP = 0.3;

// Game Play's 9 buttons. Each action's point value is fixed, so the Result
// column stores the action name itself (e.g. "Service Ace") and points are
// looked up server-side — same pattern as Blocking's Red/Yellow/Green.
// category groups the buttons for Game Play Rankings' per-category +/-
// sequence columns (e.g. an "Attack" column reading "+-++--+"), so a coach
// can see which specific play type is driving a player's total up or down.
const GAME_PLAY_ACTIONS = [
  { result: "Service Ace", points: 1, category: "Serve" },
  { result: "Serve Error", points: -1, category: "Serve" },
  { result: "Serve Receive", points: 1, category: "Serve Receive" },
  { result: "Serve Receive Error", points: -1, category: "Serve Receive" },
  { result: "Attack Kill", points: 1, category: "Attack" },
  { result: "Attack Error", points: -1, category: "Attack" },
  { result: "Dig Error", points: -1, category: "Dig" },
  { result: "Block", points: 1, category: "Block" },
  { result: "Block Error", points: -1, category: "Block" },
];
const GAME_PLAY_CATEGORIES = [...new Set(GAME_PLAY_ACTIONS.map((a) => a.category))];

// ---------------------------------------------------------------------------
// One-time setup. Run this manually from the Apps Script editor after pasting
// this file in. Safe to re-run (it rebuilds every computed tab from scratch —
// only Roster's player data is left alone).
// ---------------------------------------------------------------------------
function setupSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  setupRosterSheet(ss);
  setupLogSheet(ss);
  buildAggregateSheet(getOrCreateSheet(ss, SHEETS.SUMMARY), null);
  COACHES.forEach((coach) => {
    buildAggregateSheet(getOrCreateSheet(ss, coach), coach);
  });

  buildSkillRankingsSheet(getOrCreateSheet(ss, SHEETS.SERVING_RANKINGS), "Serving", "E");

  buildSkillDataSheet(getOrCreateSheet(ss, SHEETS.PASSING_DATA), "Passing", "F", "0-Pass");
  buildTieBreakRankingsSheet(getOrCreateSheet(ss, SHEETS.PASSING_RANKINGS), "Passing", SHEETS.PASSING_DATA, "0-Pass %");

  buildSkillRankingsSheet(getOrCreateSheet(ss, SHEETS.ATTACKING_RANKINGS), "Attacking", "G", { label: "Sequence", sourceColumnLetter: "F" });

  buildSkillRankingsSheet(getOrCreateSheet(ss, SHEETS.DIGGING_RANKINGS), "Digging", "K", { label: "Sequence", sourceColumnLetter: "F" });

  buildBlockingDataSheet(getOrCreateSheet(ss, SHEETS.BLOCKING_DATA));
  buildBlockingRankingsSheet(getOrCreateSheet(ss, SHEETS.BLOCKING_RANKINGS), SHEETS.BLOCKING_DATA);

  buildSettingRankingsSheet(getOrCreateSheet(ss, SHEETS.SETTING_RANKINGS), "I");

  buildGamePlayRankingsSheet(getOrCreateSheet(ss, SHEETS.GAME_PLAY_RANKINGS), "J");

  buildPositionRankingsSheet(getOrCreateSheet(ss, SHEETS.POSITION_RANKINGS));

  restoreColumnWidths(ss);
}

// How many columns (from A) to capture/restore widths for on every sheet —
// generous enough to cover a manually-widened trailing column even past
// where content ends (Position Rankings alone uses up to 20).
const COLUMN_WIDTH_CAPTURE_COLS = 25;

// Every builder function above rebuilds its sheet's content and formatting
// from scratch on each setupSheet() run, which is also what was quietly
// resetting any column width you'd manually adjusted — this runs last and
// puts your widths back afterward, for every sheet setupSheet() manages
// (see captureColumnWidths() below). Does nothing until you've captured at
// least once.
function restoreColumnWidths(ss) {
  const saved = PropertiesService.getScriptProperties().getProperty("COLUMN_WIDTHS");
  if (!saved) return;
  const widthsBySheet = JSON.parse(saved);
  Object.keys(widthsBySheet).forEach((sheetName) => {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) return;
    widthsBySheet[sheetName].forEach((width, idx) => {
      if (width) sheet.setColumnWidth(idx + 1, width);
    });
  });
}

// Run this manually from the Apps Script editor's function dropdown any
// time after you've resized columns to your liking — it snapshots every
// managed sheet's current column widths so setupSheet() can restore them
// on every future rebuild instead of resetting to default. Re-run it
// whenever you adjust widths again to update what gets restored.
function captureColumnWidths() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetNames = RESERVED_SHEETS.concat(COACHES);
  const widthsBySheet = {};
  sheetNames.forEach((name) => {
    const sheet = ss.getSheetByName(name);
    if (!sheet) return;
    const widths = [];
    for (let col = 1; col <= COLUMN_WIDTH_CAPTURE_COLS; col++) {
      widths.push(sheet.getColumnWidth(col));
    }
    widthsBySheet[name] = widths;
  });
  PropertiesService.getScriptProperties().setProperty("COLUMN_WIDTHS", JSON.stringify(widthsBySheet));
  Logger.log(`Captured column widths for ${Object.keys(widthsBySheet).length} sheet(s). Re-run setupSheet() any time — your widths will now be restored automatically.`);
}

function getOrCreateSheet(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function setupRosterSheet(ss) {
  const sheet = getOrCreateSheet(ss, SHEETS.ROSTER);
  if (sheet.getRange(1, 1).getValue() !== "") return; // don't clobber existing roster data
  const headers = ["Player #", "Name", "Positions", "Grade"];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold").setWrap(true).setHorizontalAlignment("center");
  sheet.setFrozenRows(1);
}

// Log columns: Timestamp, Coach, Player #, Player Name, Skill, Result, Hit
// Target, Points, Value 2, Deleted. "Points" is each skill's primary number
// (serve/pass grade, attack +1/0/-1, block TIME in seconds, set 1/0, game
// play +1/-1). "Value 2" is a secondary number only Blocking uses so far
// (quality 1-3) — kept generic so a future skill can reuse it.
function setupLogSheet(ss) {
  const sheet = getOrCreateSheet(ss, SHEETS.LOG);
  const headers = [
    "Timestamp", "Coach", "Player #", "Player Name", "Skill",
    "Result", "Hit Target", "Points", "Value 2", "Deleted",
  ];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold").setWrap(true).setHorizontalAlignment("center");
  sheet.setFrozenRows(1);

  // Every attempt is appended with a real JS Date() (date AND time), but
  // this column was never given an explicit format — left on "Automatic",
  // Sheets infers a display format per cell, which is how some rows ended
  // up showing only the date. Forcing one consistent format fixes existing
  // rows immediately (this only changes display, not the underlying value)
  // and keeps future appends consistent too.
  //
  // Bounded to LOG_MAX_ROWS explicitly (not the open-ended "A2:A" notation)
  // — that shorthand only formats up to the sheet's row count AT THE MOMENT
  // this runs, so anything Sheets later auto-grows past that (new rows
  // appended beyond the current bottom) silently comes out unformatted
  // again. Setting writes 5-25 rows per single batch submission, so it hit
  // this far sooner than every other skill's one-row-at-a-time appends —
  // that's why Setting rows specifically kept showing date-only.
  sheet.getRange(2, 1, LOG_MAX_ROWS, 1).setNumberFormat("M/d/yyyy h:mm:ss AM/PM");

  // Attacking's Result values ("+"/"-"/".") get appended as plain strings,
  // but Sheets' normal value inference treats a leading "+" or "-" as the
  // start of a number/formula — a lone "+" or "-" has nothing to complete
  // it, so it throws a parse error instead of just storing the symbol.
  // Forcing this column to Plain Text turns that inference off, so appended
  // values are always stored literally regardless of what they start with.
  // Same LOG_MAX_ROWS bound as above, for the same reason.
  sheet.getRange(2, 6, LOG_MAX_ROWS, 1).setNumberFormat("@");
}

// Skills whose Result is the raw "+"/"."/"-" symbol (rather than a word like
// "Slow" or a whole-number grade) — every one of these is exposed to the
// leading-+/- parse-error bug repairPlusMinusResultCells() fixes below.
// Add a skill's name here if it reuses this same scoring convention.
const PLUS_MINUS_SKILLS = ["Attacking", "Digging"];

// One-time repair for rows logged before setupLogSheet() started formatting
// Result as Plain Text — those cells show a parse error instead of
// "+"/"."/"-" (a lone leading "+" or "-" looks like the start of a
// number/formula to Sheets, with nothing to complete it). Points (a real
// number, never a coerced string) was never affected and uniquely
// determines what Result should have been, so this looks up each broken
// row's Points and rewrites Result from it. Safe to run more than once — it
// only touches rows that still need fixing. Run it once from the Apps
// Script editor's function dropdown after pasting this file in and saving
// (no redeploy needed; this doesn't touch the Web App). If you're still
// seeing the parse error on a FRESH attempt (not an old row), the fix in
// setupLogSheet() hasn't actually taken effect yet — re-run setupSheet()
// first (safe to re-run any time), then try logging that attempt again.
function repairPlusMinusResultCells() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.LOG);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const numRows = lastRow - 1;

  const skillValues = sheet.getRange(2, 5, numRows, 1).getValues(); // E: Skill
  const pointsValues = sheet.getRange(2, 8, numRows, 1).getValues(); // H: Points
  // Display values never throw even for a cell stuck showing a parse error.
  const resultDisplay = sheet.getRange(2, 6, numRows, 1).getDisplayValues(); // F: Result
  const pointsToSymbol = { 1: "+", 0: ".", "-1": "-" };

  let fixed = 0;
  for (let i = 0; i < numRows; i++) {
    const current = resultDisplay[i][0];
    if (PLUS_MINUS_SKILLS.indexOf(skillValues[i][0]) === -1 || current === "+" || current === "." || current === "-") continue;
    const symbol = pointsToSymbol[pointsValues[i][0]];
    if (symbol === undefined) continue; // unexpected Points value — leave for manual review
    sheet.getRange(i + 2, 6).setValue(symbol);
    fixed++;
  }
  Logger.log(`Repaired ${fixed} Result cell(s).`);
}

// Builds a formula fragment that checks whether a comma-separated Positions
// cell contains an exact position code — e.g. "S" must match "OH, S" but NOT
// "RS" (a naive contains/SEARCH would wrongly match "RS" too, since it
// contains the letter "S"). positionsRange is a sheet range reference (e.g.
// "'Summary Sheet'!$C$2:$C$251"); positionExpr is either a quoted literal
// (e.g. '"OH"') or a cell reference (e.g. "$B$1").
function positionMatchFormula(positionsRange, positionExpr) {
  return `ISNUMBER(SEARCH(","&${positionExpr}&",",","&SUBSTITUTE(${positionsRange}," ","")&","))`;
}

// Converts a 1-based column index to its spreadsheet letter (1 -> A, 27 -> AA).
function columnLetter(index) {
  let letter = "";
  while (index > 0) {
    const rem = (index - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    index = Math.floor((index - 1) / 26);
  }
  return letter;
}

// Builds (or rebuilds) a per-player summary sheet: the Summary Sheet when
// coachFilter is null (aggregates every coach), or a single coach's tab when
// coachFilter is that coach's name. Every cell is a plain formula tied to a
// specific row, so the sheet stays live as the Log tab grows — no script
// recompute needed. Columns: Player #, Name, Positions, Grade, then one
// avg/sum-score column per skill in SKILLS (E onward — kept in this fixed
// spot so buildSkillDataSheet's summaryColLetter references keep working).
//
// The Summary Sheet ONLY (not coach tabs) gets extra columns appended after
// that: one Rank per skill (1 = best — highest value, unless the skill sets
// lowerIsBetter), an Avg Rank (the mean of whichever skill ranks a player
// actually has — skills they haven't been evaluated in don't drag it down),
// and an Overall Rank from sorting players by that Avg Rank ascending.
function buildAggregateSheet(sheet, coachFilter) {
  sheet.clear();
  // This is a computed, read-only view — any data validation left over on it
  // (e.g. copied from Roster's Positions dropdown) would reject formula
  // results that don't happen to match that list, like "" for a blank row.
  sheet.getRange(1, 1, ROSTER_MAX_ROWS + 5, 24).clearDataValidations();

  const isSummary = coachFilter === null;
  const headers = ["Player #", "Name", "Positions", "Grade"].concat(SKILLS.map((s) => `${s.name} Avg`));
  if (isSummary) {
    headers.push(...SKILLS.map((s) => `${s.name} Rank`));
    headers.push("Avg Rank", "Overall Rank");
  }
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold").setWrap(true).setHorizontalAlignment("center");
  sheet.setFrozenRows(1);

  const startRow = 2;
  const lastDataRow = startRow + ROSTER_MAX_ROWS - 1;
  const coachCriteria = coachFilter
    ? `,Log!$B:$B,"${coachFilter.replace(/"/g, '""')}"`
    : "";

  const baseCols = [[], [], [], []]; // Player #, Name, Positions, Grade
  const skillCols = SKILLS.map(() => []);
  const rankCols = SKILLS.map(() => []);
  const avgRankCol = [];
  const overallRankCol = [];

  const rankStartCol = 5 + SKILLS.length; // first Rank column
  const avgRankColIdx = 5 + SKILLS.length * 2;
  const avgRankLetter = columnLetter(avgRankColIdx);

  for (let i = 0; i < ROSTER_MAX_ROWS; i++) {
    const r = startRow + i;
    baseCols[0].push([`=IF(Roster!A${r}="","",Roster!A${r})`]);
    baseCols[1].push([`=IF(Roster!A${r}="","",Roster!B${r})`]);
    baseCols[2].push([`=IF(Roster!A${r}="","",Roster!C${r})`]);
    baseCols[3].push([`=IF(Roster!A${r}="","",Roster!D${r})`]);
    SKILLS.forEach((skill, idx) => {
      // AVERAGEIFS already blanks itself out on zero attempts (it throws
      // #DIV/0!, caught by IFERROR below). SUMIFS doesn't — a sum-aggregated
      // skill like Game Play with zero attempts legitimately sums to 0, which
      // IFERROR can't distinguish from "hasn't been evaluated yet", so those
      // need an explicit attempt-count check to blank out instead of showing
      // a real (and rankable) 0.
      const criteria = `Log!$C:$C,$A${r},Log!$E:$E,"${skill.name}",Log!$J:$J,"<>TRUE"${coachCriteria}`;
      if (skill.agg === "sum") {
        skillCols[idx].push([`=IF($A${r}="","",IF(COUNTIFS(${criteria})=0,"",SUMIFS(Log!$H:$H,${criteria})))`]);
      } else {
        skillCols[idx].push([`=IF($A${r}="","",IFERROR(AVERAGEIFS(Log!$H:$H,${criteria}),""))`]);
      }
    });
    if (isSummary) {
      SKILLS.forEach((skill, idx) => {
        const avgLetter = columnLetter(5 + idx);
        const ascArg = skill.lowerIsBetter ? ",TRUE" : "";
        rankCols[idx].push([`=IF(${avgLetter}${r}="","",RANK(${avgLetter}${r},$${avgLetter}$${startRow}:$${avgLetter}$${lastDataRow}${ascArg}))`]);
      });
      const firstRankLetter = columnLetter(rankStartCol);
      const lastRankLetter = columnLetter(rankStartCol + SKILLS.length - 1);
      avgRankCol.push([`=IF($A${r}="","",IFERROR(AVERAGE(${firstRankLetter}${r}:${lastRankLetter}${r}),""))`]);
      overallRankCol.push([`=IF(${avgRankLetter}${r}="","",RANK(${avgRankLetter}${r},$${avgRankLetter}$${startRow}:$${avgRankLetter}$${lastDataRow},TRUE))`]);
    }
  }

  baseCols.forEach((col, idx) => {
    sheet.getRange(startRow, idx + 1, ROSTER_MAX_ROWS, 1).setFormulas(col);
  });
  skillCols.forEach((col, idx) => {
    sheet.getRange(startRow, 5 + idx, ROSTER_MAX_ROWS, 1).setFormulas(col);
  });
  if (isSummary) {
    rankCols.forEach((col, idx) => {
      sheet.getRange(startRow, rankStartCol + idx, ROSTER_MAX_ROWS, 1).setFormulas(col);
    });
    sheet.getRange(startRow, avgRankColIdx, ROSTER_MAX_ROWS, 1).setFormulas(avgRankCol);
    sheet.getRange(startRow, avgRankColIdx + 1, ROSTER_MAX_ROWS, 1).setFormulas(overallRankCol);
  }
}

// Builds a ranking/triage sheet for one skill: sorted by that skill's Summary
// Sheet value descending (optionally filtered by position), with attempt/
// coach counts and a "needs more looks" flag. sequenceOptions (optional):
// { label, sourceColumnLetter } adds a column showing every attempt's Result
// or Points value concatenated in order (e.g. Attacking's "+.-..+" sequence)
// — sourceColumnLetter is "F" (Result) if the Result itself is the symbol to
// show, or "H" (Points) if the raw score is (like Passing's 0-3 grades).
function buildSkillRankingsSheet(sheet, skillName, summaryColLetter, sequenceOptions) {
  sheet.clear();
  // Same reasoning as buildAggregateSheet — clear any leftover validation
  // before adding back the one dropdown this sheet actually needs (B1).
  sheet.getRange(1, 1, ROSTER_MAX_ROWS + 5, 12).clearDataValidations();
  sheet.getRange("A1").setValue("Position filter:").setFontWeight("bold");
  sheet.getRange("B1").setValue("All");
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(["All"].concat(POSITION_FILTER_OPTIONS), true)
    .build();
  sheet.getRange("B1").setDataValidation(rule);

  const headers = ["Rank", "Player #", "Name", "Positions", "Grade", `${skillName} Avg`, "Attempts", "Coaches", "Flag"];
  if (sequenceOptions) headers.push(sequenceOptions.label || "Sequence");
  sheet.getRange(3, 1, 1, headers.length).setValues([headers]).setFontWeight("bold").setWrap(true).setHorizontalAlignment("center");
  sheet.setFrozenRows(3);

  const lastRow = 1 + ROSTER_MAX_ROWS;
  // Built from an array literal (not a plain A:D range) so summaryColLetter
  // can be any skill column regardless of adjacency to D. FILTER's condition
  // args must each be a full boolean array, not a scalar, so the "All"
  // branch reuses the has-a-player array instead of a bare TRUE.
  const hasPlayer = `'${SHEETS.SUMMARY}'!$A$2:$A$${lastRow}<>""`;
  // Excludes players with no score in this skill entirely, rather than
  // showing them with a blank cell — SORT's descending order flips blank/
  // text cells to the FRONT (the reverse of ascending, where they'd trail),
  // so leaving them in would bury real scores below a wall of blanks.
  const hasScore = `'${SHEETS.SUMMARY}'!$${summaryColLetter}$2:$${summaryColLetter}$${lastRow}<>""`;
  const positionMatch = positionMatchFormula(`'${SHEETS.SUMMARY}'!$C$2:$C$${lastRow}`, "$B$1");
  sheet.getRange("B4").setFormula(
    `=IFERROR(SORT(FILTER({'${SHEETS.SUMMARY}'!$A$2:$D$${lastRow},'${SHEETS.SUMMARY}'!$${summaryColLetter}$2:$${summaryColLetter}$${lastRow}}, ${hasPlayer}, ${hasScore}, IF($B$1="All", ${hasPlayer}, ${positionMatch})), 5, FALSE), "")`
  );

  const colA = [], colG = [], colH = [], colI = [], colSeq = [];
  for (let i = 0; i < ROSTER_MAX_ROWS; i++) {
    const r = 4 + i;
    colA.push([`=IF(B${r}="","",ROW()-3)`]);
    colG.push([`=IF(B${r}="","",COUNTIFS(Log!$C:$C,B${r},Log!$E:$E,"${skillName}",Log!$J:$J,"<>TRUE"))`]);
    colH.push([`=IF(B${r}="","",IFERROR(COUNTA(UNIQUE(FILTER(Log!$B:$B,Log!$C:$C=B${r},Log!$E:$E="${skillName}",Log!$J:$J<>true))),0))`]);
    colI.push([`=IF(B${r}="","",IFERROR(IF(OR(G${r}<${FLAG_MIN_ATTEMPTS},H${r}<${FLAG_MIN_COACHES},ABS(F${r}-F${r + 1})<${FLAG_SCORE_GAP}),"⚠ Needs more looks",""),""))`]);
    if (sequenceOptions) {
      colSeq.push([`=IF(B${r}="","",IFERROR(JOIN("",QUERY(Log!$A:$J,"select ${sequenceOptions.sourceColumnLetter} where C='"&B${r}&"' and E='${skillName}' and J!=true order by A asc",0)),""))`]);
    }
  }
  sheet.getRange(4, 1, ROSTER_MAX_ROWS, 1).setFormulas(colA);
  sheet.getRange(4, 7, ROSTER_MAX_ROWS, 1).setFormulas(colG);
  sheet.getRange(4, 8, ROSTER_MAX_ROWS, 1).setFormulas(colH);
  sheet.getRange(4, 9, ROSTER_MAX_ROWS, 1).setFormulas(colI);
  if (sequenceOptions) sheet.getRange(4, 10, ROSTER_MAX_ROWS, 1).setFormulas(colSeq);
}

// Hidden helper sheet, one row per roster row (same alignment as Summary
// Sheet): Player #, Name, Positions, Grade, Avg, Attempts, Coaches, and the
// rate of "zeroResultValue" results (e.g. 0-Pass %). Exists so a rankings
// sheet can sort by a secondary key that isn't on Summary Sheet — see
// buildTieBreakRankingsSheet. Not meant to be opened/edited manually.
function buildSkillDataSheet(sheet, skillName, summaryColLetter, zeroResultValue) {
  sheet.clear();
  sheet.getRange(1, 1, ROSTER_MAX_ROWS + 5, 12).clearDataValidations();
  const headers = ["Player #", "Name", "Positions", "Grade", "Avg", "Attempts", "Coaches", "Zero Rate"];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold").setWrap(true).setHorizontalAlignment("center");
  sheet.setFrozenRows(1);

  const startRow = 2;
  const colA = [], colB = [], colC = [], colD = [], colE = [], colF = [], colG = [], colH = [];
  for (let i = 0; i < ROSTER_MAX_ROWS; i++) {
    const r = startRow + i;
    colA.push([`=IF(Roster!A${r}="","",Roster!A${r})`]);
    colB.push([`=IF(Roster!A${r}="","",Roster!B${r})`]);
    colC.push([`=IF(Roster!A${r}="","",Roster!C${r})`]);
    colD.push([`=IF(Roster!A${r}="","",Roster!D${r})`]);
    colE.push([`=IF($A${r}="","",'${SHEETS.SUMMARY}'!${summaryColLetter}${r})`]);
    colF.push([`=IF($A${r}="","",COUNTIFS(Log!$C:$C,$A${r},Log!$E:$E,"${skillName}",Log!$J:$J,"<>TRUE"))`]);
    colG.push([`=IF($A${r}="","",IFERROR(COUNTA(UNIQUE(FILTER(Log!$B:$B,Log!$C:$C=$A${r},Log!$E:$E="${skillName}",Log!$J:$J<>true))),0))`]);
    colH.push([`=IF($A${r}="","",IFERROR(COUNTIFS(Log!$C:$C,$A${r},Log!$E:$E,"${skillName}",Log!$F:$F,"${zeroResultValue}",Log!$J:$J,"<>TRUE")/$F${r},""))`]);
  }
  [colA, colB, colC, colD, colE, colF, colG, colH].forEach((col, idx) => {
    sheet.getRange(startRow, idx + 1, ROSTER_MAX_ROWS, 1).setFormulas(col);
  });

  sheet.hideSheet();
}

// Like buildSkillRankingsSheet, but sorts by avg score descending with a
// secondary tie-break (ascending) on the "zero rate" column from the given
// data sheet (see buildSkillDataSheet) — e.g. among players tied on Passing
// average, the one with the lower 0-Pass % ranks higher. QUERY's single
// "order by" can't do this since the tie-break value isn't on Summary Sheet,
// so this uses SORT+FILTER over the hidden data sheet instead.
function buildTieBreakRankingsSheet(sheet, skillName, dataSheetName, zeroRateLabel) {
  sheet.clear();
  sheet.getRange(1, 1, ROSTER_MAX_ROWS + 5, 12).clearDataValidations();
  sheet.getRange("A1").setValue("Position filter:").setFontWeight("bold");
  sheet.getRange("B1").setValue("All");
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(["All"].concat(POSITION_FILTER_OPTIONS), true)
    .build();
  sheet.getRange("B1").setDataValidation(rule);

  const headers = ["Rank", "Player #", "Name", "Positions", "Grade", `${skillName} Avg`, "Attempts", "Coaches", zeroRateLabel, "Flag", "Sequence"];
  sheet.getRange(3, 1, 1, headers.length).setValues([headers]).setFontWeight("bold").setWrap(true).setHorizontalAlignment("center");
  sheet.setFrozenRows(3);

  const lastRow = 1 + ROSTER_MAX_ROWS;
  // Sort columns are 1-based indices into the FILTER's own output (A-H of
  // the data sheet): 5 = Avg, 8 = Zero Rate. FILTER's condition args must
  // each be a full boolean array, not a scalar — so the "All" branch reuses
  // the has-a-player array instead of a bare TRUE, which FILTER would reject.
  const hasPlayer = `'${dataSheetName}'!A2:A${lastRow}<>""`;
  // Same reasoning as buildSkillRankingsSheet — exclude players with no
  // score (col E, Avg) rather than let SORT's descending order flip their
  // blank cells to the front.
  const hasScore = `'${dataSheetName}'!E2:E${lastRow}<>""`;
  const positionMatch = positionMatchFormula(`'${dataSheetName}'!C2:C${lastRow}`, "$B$1");
  sheet.getRange("B4").setFormula(
    `=IFERROR(SORT(FILTER('${dataSheetName}'!A2:H${lastRow}, ${hasPlayer}, ${hasScore}, IF($B$1="All", ${hasPlayer}, ${positionMatch})), 5, FALSE, 8, TRUE), "")`
  );

  // Spilled columns land at B..I: Player#, Name, Positions, Grade, Avg,
  // Attempts, Coaches, ZeroRate. K (Sequence) shows every grade this player
  // got, in the order it happened (e.g. "013233110032311121") — a quick
  // visual read on whether they're trending up or down over the tryout.
  const colA = [], colJ = [], colK = [];
  for (let i = 0; i < ROSTER_MAX_ROWS; i++) {
    const r = 4 + i;
    colA.push([`=IF(B${r}="","",ROW()-3)`]);
    colJ.push([`=IF(B${r}="","",IFERROR(IF(OR(G${r}<${FLAG_MIN_ATTEMPTS},H${r}<${FLAG_MIN_COACHES},ABS(F${r}-F${r + 1})<${FLAG_SCORE_GAP}),"⚠ Needs more looks",""),""))`]);
    colK.push([`=IF(B${r}="","",IFERROR(JOIN("",QUERY(Log!$A:$J,"select H where C='"&B${r}&"' and E='${skillName}' and J!=true order by A asc",0)),""))`]);
  }
  sheet.getRange(4, 1, ROSTER_MAX_ROWS, 1).setFormulas(colA);
  sheet.getRange(4, 10, ROSTER_MAX_ROWS, 1).setFormulas(colJ);
  sheet.getRange(4, 11, ROSTER_MAX_ROWS, 1).setFormulas(colK);
  sheet.getRange(4, 9, ROSTER_MAX_ROWS, 1).setNumberFormat("0.0%");
}

// Hidden helper sheet for Blocking: one row per roster row with Best/Worst/
// Avg Time (Points column, seconds) and Avg Quality (Value 2 column, 1-3).
// Separate from buildSkillDataSheet because Blocking's shape (two metrics,
// min/max/avg rather than one avg + a rate) doesn't fit that pattern.
function buildBlockingDataSheet(sheet) {
  sheet.clear();
  sheet.getRange(1, 1, ROSTER_MAX_ROWS + 5, 12).clearDataValidations();
  const headers = ["Player #", "Name", "Positions", "Grade", "Best Time", "Worst Time", "Avg Time", "Avg Quality", "Attempts", "Coaches"];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold").setWrap(true).setHorizontalAlignment("center");
  sheet.setFrozenRows(1);

  const startRow = 2;
  const cols = Array.from({ length: 10 }, () => []);
  for (let i = 0; i < ROSTER_MAX_ROWS; i++) {
    const r = startRow + i;
    cols[0].push([`=IF(Roster!A${r}="","",Roster!A${r})`]);
    cols[1].push([`=IF(Roster!A${r}="","",Roster!B${r})`]);
    cols[2].push([`=IF(Roster!A${r}="","",Roster!C${r})`]);
    cols[3].push([`=IF(Roster!A${r}="","",Roster!D${r})`]);
    cols[4].push([`=IF($A${r}="","",IFERROR(MINIFS(Log!$H:$H,Log!$C:$C,$A${r},Log!$E:$E,"Blocking",Log!$J:$J,"<>TRUE"),""))`]);
    cols[5].push([`=IF($A${r}="","",IFERROR(MAXIFS(Log!$H:$H,Log!$C:$C,$A${r},Log!$E:$E,"Blocking",Log!$J:$J,"<>TRUE"),""))`]);
    cols[6].push([`=IF($A${r}="","",IFERROR(AVERAGEIFS(Log!$H:$H,Log!$C:$C,$A${r},Log!$E:$E,"Blocking",Log!$J:$J,"<>TRUE"),""))`]);
    cols[7].push([`=IF($A${r}="","",IFERROR(AVERAGEIFS(Log!$I:$I,Log!$C:$C,$A${r},Log!$E:$E,"Blocking",Log!$J:$J,"<>TRUE"),""))`]);
    cols[8].push([`=IF($A${r}="","",COUNTIFS(Log!$C:$C,$A${r},Log!$E:$E,"Blocking",Log!$J:$J,"<>TRUE"))`]);
    cols[9].push([`=IF($A${r}="","",IFERROR(COUNTA(UNIQUE(FILTER(Log!$B:$B,Log!$C:$C=$A${r},Log!$E:$E="Blocking",Log!$J:$J<>true))),0))`]);
  }
  cols.forEach((col, idx) => {
    sheet.getRange(startRow, idx + 1, ROSTER_MAX_ROWS, 1).setFormulas(col);
  });
  sheet.hideSheet();
}

// Ranked by Avg Time ascending (faster is better), tie-broken by Best Time
// ascending, pulling from the hidden Blocking Data sheet. Avg Quality gets a
// red -> yellow -> green conditional-format gradient so a fast-but-sloppy
// blocker stands out visually against a slower-but-clean one.
function buildBlockingRankingsSheet(sheet, dataSheetName) {
  sheet.clear();
  sheet.getRange(1, 1, ROSTER_MAX_ROWS + 5, 14).clearDataValidations();
  sheet.getRange("A1").setValue("Position filter:").setFontWeight("bold");
  sheet.getRange("B1").setValue("All");
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(["All"].concat(POSITION_FILTER_OPTIONS), true)
    .build();
  sheet.getRange("B1").setDataValidation(rule);

  const headers = ["Rank", "Player #", "Name", "Positions", "Grade", "Best Time", "Worst Time", "Avg Time", "Avg Quality", "Attempts", "Coaches", "Flag"];
  sheet.getRange(3, 1, 1, headers.length).setValues([headers]).setFontWeight("bold").setWrap(true).setHorizontalAlignment("center");
  sheet.setFrozenRows(3);

  const lastRow = 1 + ROSTER_MAX_ROWS;
  const hasPlayer = `'${dataSheetName}'!A2:A${lastRow}<>""`;
  const positionMatch = positionMatchFormula(`'${dataSheetName}'!C2:C${lastRow}`, "$B$1");
  // Sort indices are 1-based within the data sheet's own A:J columns:
  // 7 = Avg Time, 5 = Best Time. Both ascending — lower time is better.
  sheet.getRange("B4").setFormula(
    `=IFERROR(SORT(FILTER('${dataSheetName}'!A2:J${lastRow}, ${hasPlayer}, IF($B$1="All", ${hasPlayer}, ${positionMatch})), 7, TRUE, 5, TRUE), "")`
  );

  // Spilled columns land at B..K: Player#, Name, Positions, Grade, BestTime,
  // WorstTime, AvgTime, AvgQuality, Attempts, Coaches.
  const colA = [], colL = [];
  for (let i = 0; i < ROSTER_MAX_ROWS; i++) {
    const r = 4 + i;
    colA.push([`=IF(B${r}="","",ROW()-3)`]);
    colL.push([`=IF(B${r}="","",IFERROR(IF(OR(J${r}<${FLAG_MIN_ATTEMPTS},K${r}<${FLAG_MIN_COACHES},ABS(H${r}-H${r + 1})<${FLAG_SCORE_GAP}),"⚠ Needs more looks",""),""))`]);
  }
  sheet.getRange(4, 1, ROSTER_MAX_ROWS, 1).setFormulas(colA);
  sheet.getRange(4, 12, ROSTER_MAX_ROWS, 1).setFormulas(colL);

  const qualityRange = sheet.getRange(4, 9, ROSTER_MAX_ROWS, 1);
  const gradientRule = SpreadsheetApp.newConditionalFormatRule()
    .setGradientMinpointWithValue("#d64545", SpreadsheetApp.InterpolationType.NUMBER, "1")
    .setGradientMidpointWithValue("#f5c518", SpreadsheetApp.InterpolationType.NUMBER, "2")
    .setGradientMaxpointWithValue("#1fa774", SpreadsheetApp.InterpolationType.NUMBER, "3")
    .setRanges([qualityRange])
    .build();
  sheet.setConditionalFormatRules([gradientRule]);
}

// Setting's overall % (on Summary Sheet, via the generic mechanism) combines
// front and back sets together. This sheet additionally breaks that out into
// Front % and Back % so a coach can spot a player who struggles on one type,
// computed directly off Log (Result is "Front" or "Back"; Points is 1 for a
// hit, 0 for a miss, so AVERAGEIFS on Points already IS the hit rate).
function buildSettingRankingsSheet(sheet, summaryColLetter) {
  sheet.clear();
  sheet.getRange(1, 1, ROSTER_MAX_ROWS + 5, 20).clearDataValidations();
  sheet.getRange("A1").setValue("Position filter:").setFontWeight("bold");
  sheet.getRange("B1").setValue("All");
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(["All"].concat(POSITION_FILTER_OPTIONS), true)
    .build();
  sheet.getRange("B1").setDataValidation(rule);

  const headers = [
    "Rank", "Player #", "Name", "Positions", "Grade", "Overall %", "Front %", "Back %", "Attempts", "Coaches", "Flag",
    "Front Made", "Front Avg Quality", "Front Set Score", "Back Made", "Back Avg Quality", "Back Set Score",
  ];
  sheet.getRange(3, 1, 1, headers.length).setValues([headers]).setFontWeight("bold").setWrap(true).setHorizontalAlignment("center");
  sheet.setFrozenRows(3);

  const lastRow = 1 + ROSTER_MAX_ROWS;
  const hasPlayer = `'${SHEETS.SUMMARY}'!$A$2:$A$${lastRow}<>""`;
  // Excludes players with no score in this skill entirely, rather than
  // showing them with a blank cell — SORT's descending order flips blank/
  // text cells to the FRONT (the reverse of ascending, where they'd trail),
  // so leaving them in would bury real scores below a wall of blanks.
  const hasScore = `'${SHEETS.SUMMARY}'!$${summaryColLetter}$2:$${summaryColLetter}$${lastRow}<>""`;
  const positionMatch = positionMatchFormula(`'${SHEETS.SUMMARY}'!$C$2:$C$${lastRow}`, "$B$1");
  sheet.getRange("B4").setFormula(
    `=IFERROR(SORT(FILTER({'${SHEETS.SUMMARY}'!$A$2:$D$${lastRow},'${SHEETS.SUMMARY}'!$${summaryColLetter}$2:$${summaryColLetter}$${lastRow}}, ${hasPlayer}, ${hasScore}, IF($B$1="All", ${hasPlayer}, ${positionMatch})), 5, FALSE), "")`
  );

  const colA = [], colG = [], colH = [], colI = [], colJ = [], colK = [];
  // Front/Back Made + Avg Quality + Set Score (made + avg quality) — a
  // supplementary stat alongside the hit-rate-based Overall %/Front %/Back %
  // that actually drives ranking, same non-ranking role Blocking's Avg
  // Quality plays. Made is a cumulative SUMIFS over every batch ever logged
  // for that side (Points is 1 per made ball), and Avg Quality averages the
  // coach's 0-5 rating across every ball row in those batches (each batch
  // writes the same rating across all its rows — see handleSettingBatch —
  // so a bigger batch counts proportionally more toward the average, same
  // as Blocking's per-attempt Avg Quality).
  const colL = [], colM = [], colN = [], colO = [], colP = [], colQ = [];
  for (let i = 0; i < ROSTER_MAX_ROWS; i++) {
    const r = 4 + i;
    colA.push([`=IF(B${r}="","",ROW()-3)`]);
    colG.push([`=IF(B${r}="","",IFERROR(AVERAGEIFS(Log!$H:$H,Log!$C:$C,B${r},Log!$E:$E,"Setting",Log!$F:$F,"Front",Log!$J:$J,"<>TRUE"),""))`]);
    colH.push([`=IF(B${r}="","",IFERROR(AVERAGEIFS(Log!$H:$H,Log!$C:$C,B${r},Log!$E:$E,"Setting",Log!$F:$F,"Back",Log!$J:$J,"<>TRUE"),""))`]);
    colI.push([`=IF(B${r}="","",COUNTIFS(Log!$C:$C,B${r},Log!$E:$E,"Setting",Log!$J:$J,"<>TRUE"))`]);
    colJ.push([`=IF(B${r}="","",IFERROR(COUNTA(UNIQUE(FILTER(Log!$B:$B,Log!$C:$C=B${r},Log!$E:$E="Setting",Log!$J:$J<>true))),0))`]);
    colK.push([`=IF(B${r}="","",IFERROR(IF(OR(I${r}<${FLAG_MIN_ATTEMPTS},J${r}<${FLAG_MIN_COACHES},ABS(F${r}-F${r + 1})<${FLAG_SCORE_GAP}),"⚠ Needs more looks",""),""))`]);

    const frontCriteria = `Log!$C:$C,B${r},Log!$E:$E,"Setting",Log!$F:$F,"Front",Log!$J:$J,"<>TRUE"`;
    colL.push([`=IF(B${r}="","",IF(COUNTIFS(${frontCriteria})=0,"",SUMIFS(Log!$H:$H,${frontCriteria})))`]);
    colM.push([`=IF(B${r}="","",IFERROR(AVERAGEIFS(Log!$I:$I,${frontCriteria}),""))`]);
    colN.push([`=IF(OR(L${r}="",M${r}=""),"",L${r}+M${r})`]);

    const backCriteria = `Log!$C:$C,B${r},Log!$E:$E,"Setting",Log!$F:$F,"Back",Log!$J:$J,"<>TRUE"`;
    colO.push([`=IF(B${r}="","",IF(COUNTIFS(${backCriteria})=0,"",SUMIFS(Log!$H:$H,${backCriteria})))`]);
    colP.push([`=IF(B${r}="","",IFERROR(AVERAGEIFS(Log!$I:$I,${backCriteria}),""))`]);
    colQ.push([`=IF(OR(O${r}="",P${r}=""),"",O${r}+P${r})`]);
  }
  sheet.getRange(4, 1, ROSTER_MAX_ROWS, 1).setFormulas(colA);
  sheet.getRange(4, 7, ROSTER_MAX_ROWS, 1).setFormulas(colG);
  sheet.getRange(4, 8, ROSTER_MAX_ROWS, 1).setFormulas(colH);
  sheet.getRange(4, 9, ROSTER_MAX_ROWS, 1).setFormulas(colI);
  sheet.getRange(4, 10, ROSTER_MAX_ROWS, 1).setFormulas(colJ);
  sheet.getRange(4, 11, ROSTER_MAX_ROWS, 1).setFormulas(colK);
  sheet.getRange(4, 12, ROSTER_MAX_ROWS, 1).setFormulas(colL);
  sheet.getRange(4, 13, ROSTER_MAX_ROWS, 1).setFormulas(colM);
  sheet.getRange(4, 14, ROSTER_MAX_ROWS, 1).setFormulas(colN);
  sheet.getRange(4, 15, ROSTER_MAX_ROWS, 1).setFormulas(colO);
  sheet.getRange(4, 16, ROSTER_MAX_ROWS, 1).setFormulas(colP);
  sheet.getRange(4, 17, ROSTER_MAX_ROWS, 1).setFormulas(colQ);
}

// Ranked by total points descending (Summary Sheet's SUMIFS column, same
// generic mechanism as every other skill). Adds one column per category in
// GAME_PLAY_CATEGORIES showing that category's own +/- sequence in
// chronological order (e.g. "Attack" might read "+-++--+"), computed
// directly off Log rather than a hidden data sheet — each cell is a
// TEXTJOIN/IF array formula bounded to LOG_MAX_ROWS rows: mask in only this
// player's non-deleted Game Play rows whose Result is one of that category's
// actions, then map each to "+"/"-" by sign and join with no separator.
function buildGamePlayRankingsSheet(sheet, summaryColLetter) {
  sheet.clear();
  sheet.getRange(1, 1, ROSTER_MAX_ROWS + 5, 20).clearDataValidations();
  sheet.getRange("A1").setValue("Position filter:").setFontWeight("bold");
  sheet.getRange("B1").setValue("All");
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(["All"].concat(POSITION_FILTER_OPTIONS), true)
    .build();
  sheet.getRange("B1").setDataValidation(rule);

  const headers = ["Rank", "Player #", "Name", "Positions", "Grade", "Total", "Attempts", "Coaches", "Flag"].concat(GAME_PLAY_CATEGORIES);
  sheet.getRange(3, 1, 1, headers.length).setValues([headers]).setFontWeight("bold").setWrap(true).setHorizontalAlignment("center");
  sheet.setFrozenRows(3);

  const lastRow = 1 + ROSTER_MAX_ROWS;
  const hasPlayer = `'${SHEETS.SUMMARY}'!$A$2:$A$${lastRow}<>""`;
  // Excludes players with no score in this skill entirely, rather than
  // showing them with a blank cell — SORT's descending order flips blank/
  // text cells to the FRONT (the reverse of ascending, where they'd trail),
  // so leaving them in would bury real scores below a wall of blanks.
  const hasScore = `'${SHEETS.SUMMARY}'!$${summaryColLetter}$2:$${summaryColLetter}$${lastRow}<>""`;
  const positionMatch = positionMatchFormula(`'${SHEETS.SUMMARY}'!$C$2:$C$${lastRow}`, "$B$1");
  sheet.getRange("B4").setFormula(
    `=IFERROR(SORT(FILTER({'${SHEETS.SUMMARY}'!$A$2:$D$${lastRow},'${SHEETS.SUMMARY}'!$${summaryColLetter}$2:$${summaryColLetter}$${lastRow}}, ${hasPlayer}, ${hasScore}, IF($B$1="All", ${hasPlayer}, ${positionMatch})), 5, FALSE), "")`
  );

  const lastLogRow = LOG_MAX_ROWS + 1;
  const colA = [], colG = [], colH = [], colI = [];
  const categoryCols = GAME_PLAY_CATEGORIES.map(() => []);
  for (let i = 0; i < ROSTER_MAX_ROWS; i++) {
    const r = 4 + i;
    colA.push([`=IF(B${r}="","",ROW()-3)`]);
    colG.push([`=IF(B${r}="","",COUNTIFS(Log!$C:$C,B${r},Log!$E:$E,"Game Play",Log!$J:$J,"<>TRUE"))`]);
    colH.push([`=IF(B${r}="","",IFERROR(COUNTA(UNIQUE(FILTER(Log!$B:$B,Log!$C:$C=B${r},Log!$E:$E="Game Play",Log!$J:$J<>true))),0))`]);
    colI.push([`=IF(B${r}="","",IFERROR(IF(OR(G${r}<${FLAG_MIN_ATTEMPTS},H${r}<${FLAG_MIN_COACHES}),"⚠ Needs more looks",""),""))`]);
    GAME_PLAY_CATEGORIES.forEach((cat, catIdx) => {
      const resultMatch = GAME_PLAY_ACTIONS
        .filter((a) => a.category === cat)
        .map((a) => `(Log!$F$2:$F$${lastLogRow}="${a.result}")`)
        .join("+");
      categoryCols[catIdx].push([
        `=IF(B${r}="","",IFERROR(TEXTJOIN("",TRUE,ARRAYFORMULA(IF((Log!$C$2:$C$${lastLogRow}=B${r})*(${resultMatch})*(Log!$J$2:$J$${lastLogRow}<>TRUE),IF(Log!$H$2:$H$${lastLogRow}>0,"+","-"),""))),""))`,
      ]);
    });
  }
  sheet.getRange(4, 1, ROSTER_MAX_ROWS, 1).setFormulas(colA);
  sheet.getRange(4, 7, ROSTER_MAX_ROWS, 1).setFormulas(colG);
  sheet.getRange(4, 8, ROSTER_MAX_ROWS, 1).setFormulas(colH);
  sheet.getRange(4, 9, ROSTER_MAX_ROWS, 1).setFormulas(colI);
  categoryCols.forEach((col, idx) => {
    sheet.getRange(4, 10 + idx, ROSTER_MAX_ROWS, 1).setFormulas(col);
  });
}

// One tab, side by side: a separate ranked list (best to worst) for each
// position in POSITION_FILTER_OPTIONS, so you can scan across and pick the
// best available OH, RS, MB, Def, and Setter at a glance. Ranked by Summary
// Sheet's Avg Rank ascending (lower is better — that's the cross-skill
// composite, not any single skill), which only includes players with at
// least one ranked skill.
function buildPositionRankingsSheet(sheet) {
  sheet.clear();
  sheet.getRange(1, 1, ROSTER_MAX_ROWS + 5, 30).clearDataValidations();

  const lastRow = 1 + ROSTER_MAX_ROWS;
  const groupWidth = 4; // Rank, Player #, Name, Avg Rank
  const gap = 1;
  const dataStartRow = 3;
  const avgRankColLetter = columnLetter(5 + SKILLS.length * 2); // Summary Sheet's Avg Rank column

  POSITION_FILTER_OPTIONS.forEach((pos, groupIdx) => {
    const groupStart = groupIdx * (groupWidth + gap) + 1;
    const rankCol = groupStart;
    const playerCol = groupStart + 1;
    const avgRankCol = groupStart + 3;
    const playerLetter = columnLetter(playerCol);

    sheet.getRange(1, groupStart, 1, groupWidth).merge()
      .setValue(pos).setFontWeight("bold").setHorizontalAlignment("center")
      .setBackground("#0b2545").setFontColor("#ffffff");
    sheet.getRange(2, groupStart, 1, groupWidth)
      .setValues([["Rank", "Player #", "Name", "Avg Rank"]]).setFontWeight("bold").setWrap(true).setHorizontalAlignment("center");

    const escapedPos = `"${pos.replace(/"/g, '""')}"`;
    const positionMatch = positionMatchFormula(`'${SHEETS.SUMMARY}'!$C$2:$C$${lastRow}`, escapedPos);
    const hasRank = `'${SHEETS.SUMMARY}'!$${avgRankColLetter}$2:$${avgRankColLetter}$${lastRow}<>""`;
    sheet.getRange(dataStartRow, playerCol).setFormula(
      `=IFERROR(SORT(FILTER({'${SHEETS.SUMMARY}'!$A$2:$B$${lastRow},'${SHEETS.SUMMARY}'!$${avgRankColLetter}$2:$${avgRankColLetter}$${lastRow}}, ${hasRank}, ${positionMatch}), 3, TRUE), "")`
    );

    const rankFormulas = [];
    for (let i = 0; i < ROSTER_MAX_ROWS; i++) {
      const r = dataStartRow + i;
      rankFormulas.push([`=IF(${playerLetter}${r}="","",ROW()-${dataStartRow - 1})`]);
    }
    sheet.getRange(dataStartRow, rankCol, ROSTER_MAX_ROWS, 1).setFormulas(rankFormulas);
    sheet.getRange(dataStartRow, avgRankCol, ROSTER_MAX_ROWS, 1).setNumberFormat("0.0");
  });

  sheet.setFrozenRows(2);
}

// ---------------------------------------------------------------------------
// Web app entry points
// ---------------------------------------------------------------------------
function doGet(e) {
  const action = e.parameter.action;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (action === "roster") return jsonResponse({ players: readRoster(ss) });
  if (action === "coaches") return jsonResponse({ coaches: COACHES });
  if (action === "skillStatus") return jsonResponse({ status: computeSkillStatus(ss, e.parameter.skill) });
  return jsonResponse({ status: "ok", version: CODE_VERSION });
}

// Skills whose page is simple tap-and-log buttons with no persistent field
// worth pre-filling — they still need a live, all-coaches attempt count
// (see SIMPLE_ATTEMPT_SKILLS branch below), just not the fuller
// pre-fill/highlight Blocking and Setting get. Game Play is deliberately
// excluded from all of this: multiple coaches are meant to add running +/-
// log entries for the same on-court player there, not evaluate them once.
const SIMPLE_ATTEMPT_SKILLS = ["Serving", "Passing", "Attacking", "Digging"];

// Live, all-coaches "has this player already been evaluated on this skill"
// status, read fresh from Log on every request (not cached) so one coach's
// just-submitted attempt shows up for another coach's device on their next
// poll. Every skill page except Game Play polls this — see README's
// "Already logged" section.
function computeSkillStatus(ss, skill) {
  const logSheet = ss.getSheetByName(SHEETS.LOG);
  const lastRow = logSheet.getLastRow();
  if (lastRow < 2) return {};
  const rows = logSheet.getRange(2, 1, lastRow - 1, 10).getValues();

  if (skill === "Blocking") {
    const byPlayer = {};
    rows.forEach((row) => {
      const [, , playerNumber, , rowSkill, , , points, value2, deleted] = row;
      if (rowSkill !== "Blocking" || deleted === true) return;
      const key = String(playerNumber);
      if (!byPlayer[key]) byPlayer[key] = { timeSum: 0, qualitySum: 0, attempts: 0 };
      byPlayer[key].timeSum += Number(points) || 0;
      byPlayer[key].qualitySum += Number(value2) || 0;
      byPlayer[key].attempts += 1;
    });
    const result = {};
    Object.keys(byPlayer).forEach((key) => {
      const p = byPlayer[key];
      result[key] = { avgTime: p.timeSum / p.attempts, avgQuality: p.qualitySum / p.attempts, attempts: p.attempts };
    });
    return result;
  }

  if (skill === "Setting") {
    // Grouped by (player, side, timestamp) to reconstruct batch boundaries —
    // handleSettingBatch writes every row in one batch with the exact same
    // Date() instance, so rows sharing a timestamp came from the same
    // submission. "last" is the most recent batch's own balls/made/quality
    // (always one of the fixed dropdown options, unlike a cumulative total),
    // so the frontend can pre-fill the balls/made dropdowns with it directly.
    const byPlayer = {};
    rows.forEach((row) => {
      const [timestamp, , playerNumber, , rowSkill, side, , points, value2, deleted] = row;
      if (rowSkill !== "Setting" || deleted === true) return;
      if (side !== "Front" && side !== "Back") return;
      const key = String(playerNumber);
      if (!byPlayer[key]) byPlayer[key] = { Front: {}, Back: {} };
      const batchKey = String(timestamp.getTime());
      const batches = byPlayer[key][side];
      if (!batches[batchKey]) batches[batchKey] = { time: timestamp.getTime(), balls: 0, made: 0, quality: value2 };
      batches[batchKey].balls += 1;
      batches[batchKey].made += Number(points) || 0;
    });
    const result = {};
    Object.keys(byPlayer).forEach((key) => {
      const sides = {};
      ["Front", "Back"].forEach((side) => {
        const batchList = Object.values(byPlayer[key][side]);
        if (!batchList.length) return;
        batchList.sort((a, b) => b.time - a.time);
        const last = batchList[0];
        const totalBalls = batchList.reduce((sum, b) => sum + b.balls, 0);
        const totalMade = batchList.reduce((sum, b) => sum + b.made, 0);
        const avgQuality = batchList.reduce((sum, b) => sum + b.quality, 0) / batchList.length;
        sides[side] = {
          balls: last.balls, made: last.made, quality: last.quality,
          batches: batchList.length, totalBalls, totalMade, avgQuality,
        };
      });
      result[key] = sides;
    });
    return result;
  }

  if (SIMPLE_ATTEMPT_SKILLS.indexOf(skill) !== -1) {
    // No averaged value worth pre-filling (these are all one-tap buttons,
    // not a persistent field), but a coach on one device still needs to
    // know how many attempts ANY coach has already logged for a player —
    // otherwise two coaches can each independently run a player through a
    // full set of reps, doubling up when one pass was enough.
    const byPlayer = {};
    rows.forEach((row) => {
      const [, , playerNumber, , rowSkill, , , , , deleted] = row;
      if (rowSkill !== skill || deleted === true) return;
      const key = String(playerNumber);
      byPlayer[key] = (byPlayer[key] || 0) + 1;
    });
    const result = {};
    Object.keys(byPlayer).forEach((key) => { result[key] = { attempts: byPlayer[key] }; });
    return result;
  }

  throw new Error(`Unsupported skill "${skill}" for status`);
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (body.action === "undo") return handleUndo(ss, body);
    if (body.action === "undoBatch") return handleUndoBatch(ss, body);
    if (body.action === "logSettingBatch") return handleSettingBatch(ss, body);
    return handleLogAttempt(ss, body);
  } catch (err) {
    return jsonResponse({ success: false, error: String(err) });
  }
}

function handleLogAttempt(ss, body) {
  const coach = String(body.coach || "").trim();
  const skill = String(body.skill || "").trim();
  const playerNumber = String(body.playerNumber || "").trim();
  const result = String(body.result || "").trim();
  if (!coach || !skill || !playerNumber || !result) {
    throw new Error("Missing coach, skill, playerNumber, or result");
  }
  if (RESERVED_SHEETS.indexOf(coach) !== -1) {
    throw new Error(`Coach name "${coach}" conflicts with a reserved sheet name`);
  }

  const hitTarget = !!body.hitTarget;
  const { points, value2 } = computeScoreDetails(skill, result, hitTarget, body.time);

  // Multiple coaches submit concurrently during tryouts, so the append +
  // "which row did I just write" read has to be atomic across requests.
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  let playerName, rowNumber;
  try {
    playerName = ensureRosterRow(ss, playerNumber, body.playerName || "");
    const logSheet = ss.getSheetByName(SHEETS.LOG);
    logSheet.appendRow([
      new Date(), coach, playerNumber, playerName, skill,
      result, hitTarget, points, value2, false,
    ]);
    rowNumber = logSheet.getLastRow();
  } finally {
    lock.releaseLock();
  }

  try {
    // Coaches normally already have a tab from setupSheet(); this is just a
    // safety net if a name outside the COACHES list ever posts an attempt.
    ensureCoachSheet(ss, coach);
  } catch (err) {
    // Non-fatal — the attempt above is already safely logged. A concurrent
    // request may have just created this same tab.
  }

  return jsonResponse({ success: true, points, rowNumber });
}

// Marks one Log row as Deleted by its exact row number, only if it still
// belongs to the requesting coach and hasn't already been undone. This is a
// soft delete (flag a column, never shift rows) on purpose: coaches submit
// concurrently, and an actual deleteRow() would shift every row below it,
// silently invalidating any row numbers other in-flight requests are holding
// onto for their own undo. Summary Sheet / coach tabs / Rankings formulas all
// exclude Deleted=TRUE rows, so this recomputes automatically.
function handleUndo(ss, body) {
  const coach = String(body.coach || "").trim();
  const rowNumber = parseInt(body.rowNumber, 10);
  if (!coach || !Number.isInteger(rowNumber) || rowNumber < 2) {
    throw new Error("Missing coach or rowNumber for undo");
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const logSheet = ss.getSheetByName(SHEETS.LOG);
    if (rowNumber > logSheet.getLastRow()) {
      throw new Error("That attempt is no longer there to undo");
    }
    const row = logSheet.getRange(rowNumber, 1, 1, 10).getValues()[0];
    const [, rowCoach, playerNumber, playerName, , , , points, , deleted] = row;
    if (String(rowCoach) !== coach) {
      throw new Error("That attempt no longer matches — can't undo");
    }
    if (deleted === true) {
      throw new Error("That attempt was already undone");
    }
    logSheet.getRange(rowNumber, 10).setValue(true);
    return jsonResponse({ success: true, playerNumber, playerName, points });
  } finally {
    lock.releaseLock();
  }
}

// Setting logs a whole batch of balls at once: a fixed count (5/10/15/20/25),
// how many hit the target, and a 0-5 set-quality rating, for one side (Front
// or Back). Rather than changing the Log schema, this just writes `balls`
// individual rows in one shot — `made` rows with hitTarget=true, the rest
// with hitTarget=false, every row carrying the same quality rating in Value
// 2 (same column Blocking's per-attempt quality uses) — so every other
// formula (Summary Sheet, coach tabs, Setting Rankings' hit-rate columns)
// keeps working unchanged; they already average one row per attempt. Returns
// the contiguous row range so the frontend can undo the whole batch as one
// unit.
function handleSettingBatch(ss, body) {
  const coach = String(body.coach || "").trim();
  const playerNumber = String(body.playerNumber || "").trim();
  const side = String(body.side || "").trim();
  const balls = parseInt(body.balls, 10);
  const made = parseInt(body.made, 10);
  const quality = parseInt(body.quality, 10);
  if (!coach || !playerNumber || !side) {
    throw new Error("Missing coach, playerNumber, or side");
  }
  if (RESERVED_SHEETS.indexOf(coach) !== -1) {
    throw new Error(`Coach name "${coach}" conflicts with a reserved sheet name`);
  }
  if (SETTING_BATCH_SIZES.indexOf(balls) === -1) {
    throw new Error(`Invalid balls count "${body.balls}"`);
  }
  if (!Number.isInteger(made) || made < 0 || made > balls) {
    throw new Error(`Invalid made count "${body.made}"`);
  }
  if (!Number.isInteger(quality) || quality < 0 || quality > 5) {
    throw new Error(`Invalid quality "${body.quality}"`);
  }
  const missed = balls - made;
  const hitPoints = computeSettingScore(side, true);
  const missPoints = computeSettingScore(side, false);

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  let playerName, startRow;
  try {
    playerName = ensureRosterRow(ss, playerNumber, body.playerName || "");
    const logSheet = ss.getSheetByName(SHEETS.LOG);
    const timestamp = new Date();
    const rows = [];
    for (let i = 0; i < made; i++) {
      rows.push([timestamp, coach, playerNumber, playerName, "Setting", side, true, hitPoints, quality, false]);
    }
    for (let i = 0; i < missed; i++) {
      rows.push([timestamp, coach, playerNumber, playerName, "Setting", side, false, missPoints, quality, false]);
    }
    startRow = logSheet.getLastRow() + 1;
    if (rows.length) {
      logSheet.getRange(startRow, 1, rows.length, 10).setValues(rows);
    }
  } finally {
    lock.releaseLock();
  }

  try {
    ensureCoachSheet(ss, coach);
  } catch (err) {
    // Non-fatal — the batch above is already safely logged.
  }

  return jsonResponse({ success: true, playerNumber, playerName, startRow, rowCount: balls, made, missed });
}

// Undoes a whole handleSettingBatch() submission as one unit — every row in
// [startRow, startRow + rowCount) must still belong to the requesting coach
// and not already be undone, or nothing is touched (same all-or-nothing
// safety as the single-row undo above). Soft-deletes the whole range in one
// call rather than rowCount separate ones.
function handleUndoBatch(ss, body) {
  const coach = String(body.coach || "").trim();
  const startRow = parseInt(body.startRow, 10);
  const rowCount = parseInt(body.rowCount, 10);
  if (!coach || !Number.isInteger(startRow) || startRow < 2 || !Number.isInteger(rowCount) || rowCount < 1) {
    throw new Error("Missing coach, startRow, or rowCount for undo");
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const logSheet = ss.getSheetByName(SHEETS.LOG);
    if (startRow + rowCount - 1 > logSheet.getLastRow()) {
      throw new Error("That batch is no longer there to undo");
    }
    const rows = logSheet.getRange(startRow, 1, rowCount, 10).getValues();
    const playerNumber = rows[0][2];
    const playerName = rows[0][3];
    for (const row of rows) {
      const [, rowCoach, , , , , , , , deleted] = row;
      if (String(rowCoach) !== coach) {
        throw new Error("That batch no longer matches — can't undo");
      }
      if (deleted === true) {
        throw new Error("That batch was already undone");
      }
    }
    logSheet.getRange(startRow, 10, rowCount, 1).setValue(true);
    return jsonResponse({ success: true, playerNumber, playerName });
  } finally {
    lock.releaseLock();
  }
}

// Dispatches to the right scoring function for the skill being logged,
// returning { points, value2 }. value2 is null except for Blocking. Add a
// branch here (and a compute*Score function) when a new skill's evaluation
// UI ships.
function computeScoreDetails(skill, result, hitTarget, time) {
  if (skill === "Serving") return { points: computeServingScore(result, hitTarget), value2: null };
  if (skill === "Passing") return { points: computePassingScore(result), value2: null };
  if (skill === "Attacking") return { points: computeAttackingScore(result), value2: null };
  if (skill === "Blocking") return computeBlockingScore(result, time);
  if (skill === "Setting") return { points: computeSettingScore(result, hitTarget), value2: null };
  if (skill === "Game Play") return { points: computeGamePlayScore(result), value2: null };
  if (skill === "Digging") return { points: computeDiggingScore(result), value2: null };
  throw new Error(`Unsupported skill "${skill}"`);
}

// Missed: 0 points (still logged as an attempt for stats).
// Otherwise: velocity tier (Slow <30mph, Average 30-35mph, Fast >35mph) sets
// the base score, +1 more if the target was hit.
function computeServingScore(result, hitTarget) {
  if (result === "Missed") return 0;
  let score;
  if (result === "Slow") score = 1;
  else if (result === "Average") score = 2;
  else if (result === "Fast") score = 3;
  else throw new Error(`Unknown result "${result}"`);
  if (hitTarget) score += 1;
  return score;
}

// Each pass grade is its own score, 0-3 — no bonus step.
function computePassingScore(result) {
  if (result === "0-Pass") return 0;
  if (result === "1-Pass") return 1;
  if (result === "2-Pass") return 2;
  if (result === "3-Pass") return 3;
  throw new Error(`Unknown result "${result}"`);
}

// Result IS the symbol shown in the Sequence column: "+" kill, "." neutral
// attempt, "-" error. Hitting efficiency = (Kills-Errors)/(Kills+Errors+
// Attempts), which is exactly what AVERAGEIFS on these points already
// computes, so Summary Sheet needs no special-casing for this skill.
function computeAttackingScore(result) {
  if (result === "+") return 1;
  if (result === ".") return 0;
  if (result === "-") return -1;
  throw new Error(`Unknown result "${result}"`);
}

// Result is "Red"/"Yellow"/"Green" (quality). Points = the coach-entered
// circuit time in seconds (validated here, never trusted from the client
// beyond this check) — that's the primary, ranked metric. Value 2 = quality
// 1-3, shown/averaged separately (see buildBlockingRankingsSheet).
function computeBlockingScore(result, time) {
  const seconds = Number(time);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`Invalid time "${time}"`);
  }
  let quality;
  if (result === "Red") quality = 1;
  else if (result === "Yellow") quality = 2;
  else if (result === "Green") quality = 3;
  else throw new Error(`Unknown result "${result}"`);
  return { points: seconds, value2: quality };
}

// Result is "Front" or "Back" (which type of set); hitTarget marks whether
// it reached the target. Points = 1/0, so AVERAGEIFS filtered by Result
// already gives Front %/Back % (see buildSettingRankingsSheet), and
// unfiltered gives the combined overall % Summary Sheet uses.
function computeSettingScore(result, hitTarget) {
  if (result !== "Front" && result !== "Back") {
    throw new Error(`Unknown result "${result}"`);
  }
  return hitTarget ? 1 : 0;
}

// Result is one of GAME_PLAY_ACTIONS' names (e.g. "Service Ace"); its point
// value is fixed there. Summary Sheet totals these with SUMIFS instead of
// the usual AVERAGEIFS (see SKILLS' agg: "sum").
function computeGamePlayScore(result) {
  const action = GAME_PLAY_ACTIONS.find((a) => a.result === result);
  if (!action) throw new Error(`Unknown result "${result}"`);
  return action.points;
}

// Result IS the symbol shown in the Sequence column, same convention as
// Attacking: "+" on target, "." neutral attempt, "-" error.
function computeDiggingScore(result) {
  if (result === "+") return 1;
  if (result === ".") return 0;
  if (result === "-") return -1;
  throw new Error(`Unknown result "${result}"`);
}

function ensureCoachSheet(ss, coach) {
  if (ss.getSheetByName(coach)) return;
  buildAggregateSheet(ss.insertSheet(coach), coach);
}

// Returns the player's name, adding a bare roster row first if this player
// number hasn't been seen yet (e.g. a walk-on not pre-loaded by the admin).
// Scans the FULL range for an exact match before ever inserting — a roster
// with any gap (a blank row before a later player's real row) would
// otherwise make an existing player look "not found yet" at the first blank
// cell, wrongly trying to insert a duplicate there instead of matching them
// further down.
function ensureRosterRow(ss, playerNumber, fallbackName) {
  const sheet = ss.getSheetByName(SHEETS.ROSTER);
  const numbers = sheet.getRange(2, 1, ROSTER_MAX_ROWS, 2).getValues();
  let firstBlankIndex = -1;
  for (let i = 0; i < numbers.length; i++) {
    const cell = numbers[i][0];
    if (String(cell) === playerNumber) {
      return numbers[i][1] || fallbackName;
    }
    if (firstBlankIndex === -1 && (cell === "" || cell === null)) {
      firstBlankIndex = i;
    }
  }
  if (firstBlankIndex !== -1) {
    try {
      sheet.getRange(2 + firstBlankIndex, 1, 1, 2).setValues([[playerNumber, fallbackName]]);
      return fallbackName;
    } catch (err) {
      // That row likely has a stale/invalid data-validation conflict (e.g. an
      // old Positions value that no longer matches the dropdown) — fall
      // through to appendRow rather than losing this attempt entirely.
    }
  }
  // Roster range is full (more than ROSTER_MAX_ROWS players), or the first
  // blank row rejected the write — append past it. If this is from a full
  // range, raise ROSTER_MAX_ROWS and re-run setupSheet().
  sheet.appendRow([playerNumber, fallbackName]);
  return fallbackName;
}

function readRoster(ss) {
  const sheet = ss.getSheetByName(SHEETS.ROSTER);
  const values = sheet.getRange(2, 1, ROSTER_MAX_ROWS, 4).getValues();
  const players = [];
  values.forEach(([playerNumber, playerName, positions, grade]) => {
    if (playerNumber === "" || playerNumber === null) return;
    players.push({ playerNumber, playerName, positions: positions || "", grade: grade || "" });
  });
  return players;
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

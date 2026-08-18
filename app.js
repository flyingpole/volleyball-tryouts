// Shared helpers used across skill pages.
//
// CACHE-BUSTING: every HTML page loads this file (and its own JS, and
// styles.css) with a "?v=N" query string. Browsers cache each resource
// independently, so it's possible for a phone to have a stale app.js
// cached alongside a fresh page-specific JS (or vice versa) — if a page's
// JS calls a function this file doesn't have yet, that's a silent
// ReferenceError that breaks the whole click handler, not just a missing
// visual touch. Bumping the shared version number forces every page to
// refetch everything together as one consistent set. Whenever ANY of
// app.js, styles.css, or a page's own .js file changes, bump "?v=N" in
// every <script>/<link> tag that references it, across every HTML file
// (not just the one you edited) — grep for "?v=" to find them all.

const COACH_KEY = "vbtryouts_coach";

function isScriptConfigured() {
  return (
    typeof CONFIG !== "undefined" &&
    CONFIG.SCRIPT_URL &&
    !CONFIG.SCRIPT_URL.startsWith("PASTE_")
  );
}

// Most scoring buttons across the app auto-submit on tap with no separate
// confirm step, so it's hard to tell a tap actually registered without
// reading the small toast text. These two give an immediate tap
// confirmation instead. Call both right after the disabled-check in a
// button's click handler, before doing the actual submit.
//
// navigator.vibrate is unsupported on iOS — Apple has never implemented the
// Vibration API in WebKit (Safari or Chrome-on-iOS, same engine) — so this
// silently no-ops there. The color flash still works everywhere.
function hapticTap() {
  if (navigator.vibrate) {
    try { navigator.vibrate(15); } catch (err) {
      // Some browsers throw if called outside a user gesture — harmless to ignore.
    }
  }
}

function flashButton(btn) {
  btn.classList.add("tap-flash");
  setTimeout(() => btn.classList.remove("tap-flash"), 180);
}

// Wires the header's kebab-menu (Coach select + Reset), shared by every
// skill page. onReset is called only after the user confirms, and only
// clears THIS device's local state (undo stack, tallies, saved
// selection) — each page passes its own reset function since local state
// shape differs per skill. Never touches the Google Sheet.
function initHeaderMenu(onReset) {
  const menuBtn = document.getElementById("menuBtn");
  const menuPanel = document.getElementById("menuPanel");
  const resetBtn = document.getElementById("resetBtn");
  if (!menuBtn || !menuPanel) return;

  function closeMenu() {
    menuPanel.hidden = true;
    menuBtn.setAttribute("aria-expanded", "false");
  }

  menuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    menuPanel.hidden = !menuPanel.hidden;
    menuBtn.setAttribute("aria-expanded", String(!menuPanel.hidden));
  });

  document.addEventListener("click", (e) => {
    if (!menuPanel.hidden && !menuPanel.contains(e.target) && e.target !== menuBtn) closeMenu();
  });

  if (resetBtn && onReset) {
    resetBtn.addEventListener("click", () => {
      if (window.confirm("Reset this page's local data? This clears your undo history and on-screen tallies on THIS device only — it does not affect the Google Sheet.")) {
        onReset();
        closeMenu();
      }
    });
  }
}

function updateHeaderCoach(name) {
  const el = document.getElementById("headerCoach");
  if (el) el.textContent = name ? ` — ${name}` : "";
}

// Wrapped in try/catch: private-browsing modes can throw on localStorage
// access instead of just no-opping, which would otherwise take the whole
// page down.
function getSavedCoach() {
  try {
    return localStorage.getItem(COACH_KEY) || "";
  } catch (err) {
    return "";
  }
}

function saveCoach(name) {
  try {
    localStorage.setItem(COACH_KEY, name.trim());
  } catch (err) {
    // Ignore — nothing to persist to.
  }
}

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (err) {
    return fallback;
  }
}

function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    // Ignore — nothing to persist to.
  }
}

async function fetchRoster() {
  const res = await fetch(`${CONFIG.SCRIPT_URL}?action=roster`);
  if (!res.ok) throw new Error(`Roster fetch failed (${res.status})`);
  const data = await res.json();
  return data.players || [];
}

async function fetchCoaches() {
  const res = await fetch(`${CONFIG.SCRIPT_URL}?action=coaches`);
  if (!res.ok) throw new Error(`Coach list fetch failed (${res.status})`);
  const data = await res.json();
  return data.coaches || [];
}

// Live, all-coaches "who's already been evaluated on this skill" data —
// used by Blocking and Setting to pre-fill/highlight their input fields.
// Callers poll this periodically; a failure here should just skip that
// refresh rather than interrupt scoring, so callers should catch it
// themselves rather than let it propagate into the main init() error path.
async function fetchSkillStatus(skill) {
  const res = await fetch(`${CONFIG.SCRIPT_URL}?action=skillStatus&skill=${encodeURIComponent(skill)}`);
  if (!res.ok) throw new Error(`Skill status fetch failed (${res.status})`);
  const data = await res.json();
  return data.status || {};
}

// Apps Script Web Apps don't send CORS headers for JSON content types,
// so we POST as text/plain (the default) to avoid a preflight request.
// doPost() on the server reads e.postData.contents and JSON.parses it.
//
// Errors are marked .confirmed = true only when the SERVER explicitly told us
// it rejected the request (a clean JSON response with success:false) — that
// means nothing was written, safe to treat as a real failure. Apps Script Web
// Apps are known to sometimes fail the client-side fetch (redirect/CORS
// quirks) even though doPost ran to completion and wrote the row, so a
// network-level error (.confirmed = false) must NOT be treated the same way:
// the caller shouldn't assume the write didn't happen.
async function postJSON(payload) {
  let res;
  try {
    res = await fetch(CONFIG.SCRIPT_URL, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  } catch (err) {
    const wrapped = new Error(`Network error: ${err.message}`);
    wrapped.confirmed = false;
    throw wrapped;
  }
  if (!res.ok) {
    const err = new Error(`Request failed (${res.status})`);
    err.confirmed = false;
    throw err;
  }
  let data;
  try {
    data = await res.json();
  } catch (err) {
    const wrapped = new Error(`Couldn't read response: ${err.message}`);
    wrapped.confirmed = false;
    throw wrapped;
  }
  if (!data.success) {
    const err = new Error(data.error || "Request failed");
    err.confirmed = true;
    throw err;
  }
  return data;
}

// ---------------------------------------------------------------------------
// Send queue — every mutating request (logging an attempt, an undo, a
// Setting batch) goes through this instead of hitting the network directly.
// A tap enqueues instantly (always succeeds — localStorage-backed, so it
// survives a reload) and a background loop drains the queue with retries,
// so a slow or temporarily unreachable Apps Script never blocks the next
// entry. See README's "Send queue" section for the full design.
//
// Each queued item carries a client-generated ID that the server uses to
// dedupe (see computeSkillStatus/withIdempotency in Code.gs) — a retried
// request that actually succeeded the first time returns the same cached
// response instead of writing a second row, which is what makes retrying
// safe at all.
// ---------------------------------------------------------------------------
const QUEUE_KEY = "vbtryouts_send_queue";
const QUEUE_BASE_DELAY_MS = 2000;
const QUEUE_MAX_DELAY_MS = 30000;
const QUEUE_STUCK_AFTER_ATTEMPTS = 8; // show a "not syncing" warning after this many consecutive failures on the item currently at the front
const QUEUE_SEND_DELAY_MS = 1200; // brief pre-send grace period, see drainQueue

let queueDraining = false;
let queueConsecutiveFailures = 0;
const queueCallbacks = {}; // clientId -> { onConfirmed, onRejected } — in-memory only, so callbacks from a previous page load don't survive a reload (see resumeQueue)

function loadQueue() {
  return loadJSON(QUEUE_KEY, []);
}

function saveQueue(queue) {
  saveJSON(QUEUE_KEY, queue);
}

function makeClientId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return `c${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// Shows/hides a small "N pending" (or "N not syncing" once stuck) badge —
// present on every skill page's header if a #queueStatus element exists.
// Purely informational: lets a coach see the app is behind rather than
// assume it's broken and revert to paper.
function refreshQueueStatusUI() {
  const el = document.getElementById("queueStatus");
  if (!el) return;
  const count = loadQueue().length;
  if (count === 0) {
    el.hidden = true;
    el.classList.remove("queue-status-stuck");
    return;
  }
  el.hidden = false;
  const stuck = queueConsecutiveFailures >= QUEUE_STUCK_AFTER_ATTEMPTS;
  el.textContent = stuck ? `⚠ ${count} not syncing` : `↻ ${count} pending`;
  el.classList.toggle("queue-status-stuck", stuck);
}

// Enqueues a mutating request (payload already shaped exactly like what
// postJSON expects, action field included where needed — see
// enqueueAttempt/enqueueUndo/enqueueSettingBatch/enqueueUndoBatch below) and
// returns its clientId immediately, before anything has been sent. Never
// throws, never waits on the network. callbacks.onConfirmed(response) fires
// once the server actually processes it; callbacks.onRejected(err) fires
// only if the server explicitly rejects it (a validation error — retrying
// that would fail identically forever, so it's surfaced instead of retried).
function enqueue(payload, callbacks) {
  const clientId = makeClientId();
  const queue = loadQueue();
  queue.push({ clientId, payload: { ...payload, clientId } });
  saveQueue(queue);
  refreshQueueStatusUI();
  if (callbacks) queueCallbacks[clientId] = callbacks;
  drainQueue();
  return clientId;
}

// Not async — enqueue() itself never awaits anything, so these stay
// synchronous on purpose. Callers rely on getting the real clientId back
// immediately (not a Promise) so they can record a pending undo-stack entry
// in the same tick as the tap, before anything has been sent.
function enqueueAttempt(payload, callbacks) {
  return enqueue(payload, callbacks);
}

function enqueueUndo(payload, callbacks) {
  return enqueue({ ...payload, action: "undo" }, callbacks);
}

function enqueueSettingBatch(payload, callbacks) {
  return enqueue({ ...payload, action: "logSettingBatch" }, callbacks);
}

function enqueueUndoBatch(payload, callbacks) {
  return enqueue({ ...payload, action: "undoBatch" }, callbacks);
}

// Tracks whichever clientId is currently mid-flight (request sent, response
// not back yet) so cancelQueued can refuse to touch it. Once a request is
// actually in flight it may have already reached the server — removing it
// from the local queue at that point wouldn't stop the write, it would just
// desync the local queue from what the server has (see cancelQueued).
let inFlightClientId = null;

// Removes a not-yet-sent item from the queue — used when a coach undoes an
// attempt before it's even reached the server (very likely exactly when the
// queue is backed up, i.e. exactly when this matters most), so nothing
// needs to be sent for it at all. Returns true if it was still queued and
// got removed; false if it's currently in flight or already gone (sent,
// confirmed, or rejected), meaning the caller can't cancel it locally and
// must wait for its onConfirmed/onRejected callback to settle first.
function cancelQueued(clientId) {
  if (clientId === inFlightClientId) return false;
  const queue = loadQueue();
  const idx = queue.findIndex((item) => item.clientId === clientId);
  if (idx === -1) return false;
  queue.splice(idx, 1);
  saveQueue(queue);
  refreshQueueStatusUI();
  delete queueCallbacks[clientId];
  return true;
}

// Drains the queue one item at a time (never concurrently — this preserves
// submission order, which undo's "most recent" semantics depend on, and
// avoids piling parallel requests onto Apps Script's single script-wide
// lock from this same device). A transient failure (network/timeout) backs
// off and retries the SAME item rather than advancing past it; a permanent
// rejection from the server drops it and calls onRejected instead of
// retrying forever.
async function drainQueue() {
  if (queueDraining) return;
  queueDraining = true;
  const graced = new Set(); // clientIds that already had their pre-send grace period this drain session — retries after a transient failure skip it (the backoff delay already gives cancelQueued a window)
  try {
    for (;;) {
      const queue = loadQueue();
      if (!queue.length) break;
      const item = queue[0];

      if (!graced.has(item.clientId)) {
        graced.add(item.clientId);
        // A freshly-enqueued item would otherwise start sending
        // synchronously as part of the very same call stack as enqueue()
        // itself — before the tap's click handler even finishes running —
        // leaving no real window for cancelQueued to ever succeed. This
        // brief pause is what actually creates that window.
        await new Promise((resolve) => setTimeout(resolve, QUEUE_SEND_DELAY_MS));
        const stillQueued = loadQueue();
        if (!stillQueued.some((q) => q.clientId === item.clientId)) continue; // cancelled during the grace period
      }

      inFlightClientId = item.clientId;
      try {
        const response = await postJSON(item.payload);
        inFlightClientId = null;
        queueConsecutiveFailures = 0;
        const cb = queueCallbacks[item.clientId];
        delete queueCallbacks[item.clientId];
        const remaining = loadQueue();
        const idx = remaining.findIndex((q) => q.clientId === item.clientId);
        if (idx !== -1) remaining.splice(idx, 1);
        saveQueue(remaining);
        refreshQueueStatusUI();
        if (cb && cb.onConfirmed) cb.onConfirmed(response);
      } catch (err) {
        inFlightClientId = null;
        if (err.confirmed) {
          const cb = queueCallbacks[item.clientId];
          delete queueCallbacks[item.clientId];
          const remaining = loadQueue();
          const idx = remaining.findIndex((q) => q.clientId === item.clientId);
          if (idx !== -1) remaining.splice(idx, 1);
          saveQueue(remaining);
          queueConsecutiveFailures = 0;
          refreshQueueStatusUI();
          if (cb && cb.onRejected) cb.onRejected(err);
          continue;
        }
        queueConsecutiveFailures += 1;
        refreshQueueStatusUI();
        const delay = Math.min(QUEUE_BASE_DELAY_MS * Math.pow(1.6, queueConsecutiveFailures - 1), QUEUE_MAX_DELAY_MS);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  } finally {
    queueDraining = false;
  }
}

// Resumes draining anything left over from a previous page load (e.g. the
// coach closed the tab mid-sync) — call once from each page's init(). These
// leftover items have no callbacks (that page session is gone), so they're
// sent silently in the background; the live skillStatus poll picks up their
// effect within its own refresh interval regardless of whether this exact
// tab is still open.
function resumeQueue() {
  refreshQueueStatusUI();
  drainQueue();
}

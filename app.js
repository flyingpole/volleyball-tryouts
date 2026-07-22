// Shared helpers used across skill pages.

const COACH_KEY = "vbtryouts_coach";

function isScriptConfigured() {
  return (
    typeof CONFIG !== "undefined" &&
    CONFIG.SCRIPT_URL &&
    !CONFIG.SCRIPT_URL.startsWith("PASTE_")
  );
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

async function postAttempt(payload) {
  return postJSON(payload);
}

async function postUndo(payload) {
  return postJSON({ ...payload, action: "undo" });
}

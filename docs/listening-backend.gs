/***** RVOCA backend (Listening module) *****/
const TOKEN = "rvo-2025-chiuchiou";
const ADMIN_KEY = "5499";
const SHEET_ID = "1emt7RnCCnhwSOfkiUTOCIvlWBXtVJrvG2al1V6IIaR0";

const LS_CFG = Object.freeze({
  SHEET: "ls_db",
  STATUS_DELETED: "deleted",
  ROUND_DEFAULT: 5,
});

/* shared helpers — 可原封複製 */
function openSheet(sheetName) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = ss.getSheetByName(sheetName);
  if (!sh) throw new Error("找不到工作表分頁：" + sheetName);
  return sh;
}

function nowISO() {
  return new Date().toISOString();
}

function jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function jsOutput(js) {
  return ContentService.createTextOutput(js).setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function respond(e, payload) {
  const cb = e && e.parameter && e.parameter.callback;
  return cb ? jsOutput(cb + "(" + JSON.stringify(payload) + ");") : jsonOutput(payload);
}

function guardToken(e) {
  if (!e || e.parameter.token !== TOKEN) throw new Error("Unauthorized");
}

function hasAdmin(e) {
  return e && e.parameter && e.parameter.adminKey === ADMIN_KEY;
}

/* listening data helpers */
function ls_sheet() {
  return openSheet(LS_CFG.SHEET);
}

function ls_loadRows() {
  const sh = ls_sheet();
  const values = sh.getDataRange().getValues();
  if (!values || values.length < 2) return { rows: [], idx: {} };

  const headers = values[0];
  const idx = {
    id: headers.indexOf("id"),
    en: headers.indexOf("en"),
    zh: headers.indexOf("zh"),
    status: headers.indexOf("status"),
    updatedAt: headers.indexOf("updatedAt"),
  };

  ["id", "en", "zh", "status", "updatedAt"].forEach((key) => {
    if (idx[key] === -1) throw new Error("缺少欄位：" + key);
  });

  const rows = [];
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    if (!row[idx.en]) continue;
    rows.push({
      _r: r + 1,
      id: row[idx.id],
      en: row[idx.en],
      zh: row[idx.zh] || "",
      status: row[idx.status] || "",
      updatedAt: row[idx.updatedAt] || "",
    });
  }

  return { rows, idx };
}

function ls_remainingCount() {
  const { rows } = ls_loadRows();
  return rows.filter((r) => r.status !== LS_CFG.STATUS_DELETED).length;
}

function ls_pickBatch(n) {
  const { rows } = ls_loadRows();
  const pool = rows.filter((r) => r.status !== LS_CFG.STATUS_DELETED);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n).map((r) => ({ id: r.id, en: r.en, zh: r.zh }));
}

function ls_markDeletedByIds(ids) {
  if (!ids || !ids.length) return 0;
  const sh = ls_sheet();
  const { rows, idx } = ls_loadRows();
  const map = new Map(rows.map((r) => [String(r.id), r]));
  let changed = 0;

  ids.forEach((id) => {
    const row = map.get(String(id));
    if (row && row.status !== LS_CFG.STATUS_DELETED) {
      sh.getRange(row._r, idx.status + 1).setValue(LS_CFG.STATUS_DELETED);
      sh.getRange(row._r, idx.updatedAt + 1).setValue(nowISO());
      changed++;
    }
  });

  return changed;
}

/* API */
function doGet(e) {
  try {
    guardToken(e);
    const action = String(e.parameter.action || "ping").toLowerCase();

    if (action === "ping") return respond(e, { ok: true, service: "listening-db", time: nowISO() });
    if (action === "count") return respond(e, { ok: true, remaining: ls_remainingCount() });
    if (action === "nextbatch") {
      const n = Math.max(1, Number(e.parameter.count || LS_CFG.ROUND_DEFAULT));
      const items = ls_pickBatch(n);
      return respond(e, { ok: true, items, remaining: ls_remainingCount() });
    }
    if (action === "markknown") {
      if (!hasAdmin(e)) return respond(e, { ok: false, error: "No permission" });
      const ids = e.parameter.ids
        ? String(e.parameter.ids).split(",").map((s) => s.trim()).filter(Boolean)
        : e.parameter.id
          ? [String(e.parameter.id)]
          : [];
      const changed = ls_markDeletedByIds(ids);
      return respond(e, { ok: true, changed, remaining: ls_remainingCount() });
    }
    if (action === "whoami") {
      return respond(e, { ok: true, params: e.parameter, tokenOnServer: TOKEN, time: nowISO() });
    }

    return respond(e, { ok: false, error: "Unknown action" });
  } catch (err) {
    return respond(e, { ok: false, error: String(err) });
  }
}

function doPost() {
  return jsonOutput({ ok: false, error: "Use GET with ?callback=..." });
}

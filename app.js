import { openDb, getMeta, setMeta, clearAll, bulkPutItems, countItems, getItem, listBySupplier, listBySupplierRange } from "./db.js";

const DISPLAY_COLS = ["ItemID", "ModelNum", "Description", "Description2", "Description3", "Cost", "Mrp", "Sell", "$Sell2", "$Sell3", "$Trade1", "$Trade2", "$Trade3", "DC", "SC", "RC", "IC", "GC", "CC", "ItemDescription", "GradeDescription", "ColourDescription", "Op1", "Op2", "Op3", "Op4", "Op5", "Delivery", "SKU", "Group", "Feature1", "Feature2", "Feature3", "SupplierName", "SupplierDebrand", "Range", "Renamed"];
const HIDDEN_COLS = ["Barcode"];

// Elements
const supplierSel = document.getElementById("supplierSel");
const rangeSel = document.getElementById("rangeSel");
const searchBox = document.getElementById("searchBox");
const btnClear = document.getElementById("btnClear");
const statusBox = document.getElementById("statusBox");
const theadRow = document.getElementById("theadRow");
const tbody = document.getElementById("tbody");
const resultsList = document.getElementById("resultsList");
const detailPane = document.getElementById("detailPane");
const resultsFooter = document.getElementById("resultsFooter");
const btnManage = document.getElementById("btnManage");
const btnHelp = document.getElementById("btnHelp");

let db;
let metaSuppliers = []; // array of {SupplierName, SupplierDebrand}
let metaRangesBySupplier = new Map(); // SupplierName -> array of {Range, Renamed}
let selectedItemId = null;

function setStatus(msg) {
  statusBox.textContent = msg;
}

function safe(v) {
  if (v === undefined || v === null) return "";
  return String(v);
}

function normalize(s) {
  return safe(s).toLowerCase();
}

function buildTableHeader() {
  theadRow.innerHTML = "";
  for (const c of DISPLAY_COLS) {
    const th = document.createElement("th");
    th.textContent = c;
    theadRow.appendChild(th);
  }
}

function renderDetail(item) {
  if (!item) {
    detailPane.innerHTML = '<div class="small">Select an item to view all fields.</div>';
    return;
  }

  // show supplier debrand + renamed as "selected context"
  const sup = metaSuppliers.find(x => x.SupplierName === item.SupplierName);
  const supplierLabel = sup ? `${sup.SupplierName} — ${sup.SupplierDebrand || ""}` : safe(item.SupplierName);

  const ranges = metaRangesBySupplier.get(item.SupplierName) || [];
  const r = ranges.find(x => x.Range === item.Range && x.Renamed === item.Renamed) || ranges.find(x => x.Range === item.Range);
  const rangeLabel = r ? `${r.Range} — ${r.Renamed || ""}` : safe(item.Range);

  let html = "";
  html += `<div class="section"><div class="small"><b>Supplier</b>: ${escapeHtml(supplierLabel)}<br/><b>Range</b>: ${escapeHtml(rangeLabel)}</div></div>`;
  html += `<div class="section"><div class="kv">`;
  for (const c of DISPLAY_COLS) {
    const k = escapeHtml(c);
    const v = escapeHtml(safe(item[c]));
    html += `<div class="k">${k}</div><div class="v">${v}</div>`;
  }
  html += `</div></div>`;
  detailPane.innerHTML = html;
}

function escapeHtml(str) {
  return safe(str)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#39;");
}

function populateSupplierDropdown() {
  supplierSel.innerHTML = '<option value="">Select supplier…</option>';
  for (const s of metaSuppliers) {
    const opt = document.createElement("option");
    opt.value = s.SupplierName;
    const label = s.SupplierDebrand ? `${s.SupplierName} — ${s.SupplierDebrand}` : s.SupplierName;
    opt.textContent = label;
    supplierSel.appendChild(opt);
  }
}

function populateRangeDropdown(supplierName) {
  rangeSel.innerHTML = '<option value="">All ranges…</option>';
  if (!supplierName) return;

  const ranges = metaRangesBySupplier.get(supplierName) || [];
  // de-dupe by Range+Renamed
  const seen = new Set();
  for (const rr of ranges) {
    const key = `${rr.Range}|||${rr.Renamed}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const opt = document.createElement("option");
    opt.value = rr.Range; // filter by Range
    opt.textContent = rr.Renamed ? `${rr.Range} — ${rr.Renamed}` : rr.Range;
    rangeSel.appendChild(opt);
  }
}

async function loadMeta() {
  metaSuppliers = (await getMeta(db, "suppliers")) || [];
  const rangesArr = (await getMeta(db, "rangesBySupplier")) || [];
  metaRangesBySupplier = new Map(rangesArr);
}

function rowMatchesSearch(item, q) {
  if (!q) return true;
  // Search everything EXCEPT Barcode display; still allow matching barcode? user said no barcode display; safest: don't search it either.
  const fields = ["ItemID","ModelNum","Description","Description2","Description3","SKU"];
  const hay = fields.map(f => normalize(item[f])).join(" | ");
  return hay.includes(q);
}

function renderResults(items) {
  // Table (iPad / desktop)
  tbody.innerHTML = "";
  for (const it of items) {
    const tr = document.createElement("tr");
    tr.dataset.itemid = safe(it.ItemID);
    tr.addEventListener("click", async () => {
      selectedItemId = safe(it.ItemID);
      const full = await getItem(db, selectedItemId);
      renderDetail(full);
      highlightSelected();
    });
    for (const c of DISPLAY_COLS) {
      const td = document.createElement("td");
      td.textContent = safe(it[c]);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }

  // Phone list
  resultsList.innerHTML = "";
  for (const it of items) {
    const div = document.createElement("div");
    div.className = "item";
    div.dataset.itemid = safe(it.ItemID);
    div.addEventListener("click", async () => {
      selectedItemId = safe(it.ItemID);
      const full = await getItem(db, selectedItemId);
      renderDetail(full);
      highlightSelected();
    });

    // Compact summary: ItemID, ModelNum, Sell, Cost, Description, SKU, Delivery
    const line1Left = `${safe(it.ItemID)} | ${safe(it.ModelNum)}`;
    const sell = safe(it.Sell);
    const cost = safe(it.Cost);
    const desc = safe(it.Description);
    const sku = safe(it.SKU);
    const delivery = safe(it.Delivery);

    div.innerHTML = `
      <div class="top">
        <div>
          <div class="title">${escapeHtml(line1Left)}</div>
          <div class="meta">${escapeHtml(desc)}</div>
          <div class="meta">Cost: ${escapeHtml(cost)} · Sell: ${escapeHtml(sell)} · SKU: ${escapeHtml(sku)} · Delivery: ${escapeHtml(delivery)}</div>
        </div>
        <div class="price">${escapeHtml(sell)}</div>
      </div>
    `;
    resultsList.appendChild(div);
  }

  resultsFooter.textContent = `Showing ${items.length} results (use Supplier + Range + Search to narrow).`;
  highlightSelected();
}

function highlightSelected() {
  for (const tr of tbody.querySelectorAll("tr")) {
    tr.style.outline = (tr.dataset.itemid === selectedItemId) ? "2px solid #000" : "none";
  }
  for (const div of resultsList.querySelectorAll(".item")) {
    div.style.outline = (div.dataset.itemid === selectedItemId) ? "2px solid #000" : "none";
  }
}

async function refreshResults() {
  const supplier = supplierSel.value;
  const range = rangeSel.value;
  const q = normalize(searchBox.value).trim();

  if (!supplier) {
    renderResults([]);
    renderDetail(null);
    setStatus("Select a supplier. (If you haven’t imported data yet, tap Import / Replace.)");
    return;
  }

  setStatus("Searching…");
  let base = [];
  if (range) {
    base = await listBySupplierRange(db, supplier, range, 800);
  } else {
    base = await listBySupplier(db, supplier, 800);
  }

  const filtered = q ? base.filter(it => rowMatchesSearch(it, q)) : base;
  renderResults(filtered);
  setStatus(`Loaded. Supplier: ${supplier}${range ? " · Range: " + range : ""} · Records scanned: ${base.length} (showing up to 800)`);
}

function showHelp() {
  alert(
`Offline use:
1) Open this app once while online (so it can cache itself).
2) Tap "Import / Replace" and choose your XLSX file.
3) After import, it works offline.

Filtering:
- Supplier shows "SupplierName — SupplierDebrand"
- Range shows "Range — Renamed" and filters by Range
- Barcode is hidden and not searched.

Updating data:
Export a fresh XLSX from Windows, then Import / Replace again.`
  );
}

async function importXlsxFlow() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".xlsx";
  input.onchange = async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    await importXlsxFile(file);
  };
  input.click();
}

async function importXlsxFile(file) {
  if (!window.XLSX) {
    alert("XLSX parser library didn’t load. Open once while online, then try again.");
    return;
  }

  setStatus("Reading XLSX…");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });

  // Prefer Sheet2 as you said
  let sheetName = wb.SheetNames.find(n => n.toLowerCase() === "sheet2") || wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  if (!ws) {
    alert("Could not find the sheet to import.");
    return;
  }

  setStatus(`Parsing ${sheetName}…`);
  const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });

  // Normalize keys to match expected columns
  // Some exports may include weird whitespace in headers; attempt to map exact names.
  const headerMap = buildHeaderMap(rows);

  const items = [];
  const suppliersMap = new Map(); // SupplierName -> SupplierDebrand
  const rangesMap = new Map(); // SupplierName -> Map(rangeKey -> {Range,Renamed})

  for (const r of rows) {
    const it = {};
    for (const col of DISPLAY_COLS.concat(Array.from(HIDDEN_COLS))) {
      const key = headerMap.get(col) || col;
      it[col] = safe(r[key]);
    }

    // Require ItemID
    if (!it.ItemID) continue;

    // Track supplier + range
    const sName = safe(it.SupplierName);
    const sDeb = safe(it.SupplierDebrand);
    if (sName) {
      if (!suppliersMap.has(sName)) suppliersMap.set(sName, sDeb);
    }
    const rangeVal = safe(it.Range);
    const renamed = safe(it.Renamed);

    if (sName) {
      if (!rangesMap.has(sName)) rangesMap.set(sName, new Map());
      const k = `${rangeVal}|||${renamed}`;
      if (!rangesMap.get(sName).has(k)) rangesMap.get(sName).set(k, { Range: rangeVal, Renamed: renamed });
    }

    items.push(it);
  }

  // Write to DB
  setStatus("Saving offline database…");
  await clearAll(db);

  // chunk inserts to keep UI responsive
  const chunkSize = 1500;
  for (let i=0;i<items.length;i+=chunkSize) {
    await bulkPutItems(db, items.slice(i, i+chunkSize));
    setStatus(`Saving… ${Math.min(i+chunkSize, items.length)} / ${items.length}`);
    await new Promise(r => setTimeout(r, 0));
  }

  // Save meta
  const suppliers = Array.from(suppliersMap.entries())
    .map(([SupplierName, SupplierDebrand]) => ({ SupplierName, SupplierDebrand }))
    .sort((a,b)=> (a.SupplierDebrand||a.SupplierName).localeCompare(b.SupplierDebrand||b.SupplierName));

  const rangesBySupplier = Array.from(rangesMap.entries()).map(([sName, m]) => {
    const arr = Array.from(m.values())
      .filter(x => x.Range)  // ignore blanks
      .sort((a,b)=> (a.Range||"").localeCompare(b.Range||""));
    return [sName, arr];
  });

  await setMeta(db, "suppliers", suppliers);
  await setMeta(db, "rangesBySupplier", rangesBySupplier);
  await setMeta(db, "lastImported", new Date().toISOString());
  await setMeta(db, "sheetImported", sheetName);

  await loadMeta();
  populateSupplierDropdown();
  supplierSel.value = "";
  populateRangeDropdown("");
  renderResults([]);
  renderDetail(null);

  const n = await countItems(db);
  setStatus(`Import complete. ${n} items saved for offline use.`);
  alert(`Imported ${n} items from "${sheetName}". You can now use the app offline.`);
}

function buildHeaderMap(rows) {
  // Build a mapping from canonical col name to actual key in rows
  const map = new Map();
  if (!rows || rows.length === 0) return map;

  const keys = Object.keys(rows[0] || {});
  // Normalize keys by trimming
  const normToActual = new Map(keys.map(k => [k.trim(), k]));

  for (const col of DISPLAY_COLS.concat(Array.from(HIDDEN_COLS))) {
    if (normToActual.has(col)) map.set(col, normToActual.get(col));
  }
  return map;
}

async function init() {
  // service worker
  if ("serviceWorker" in navigator) {
    try {
      await navigator.serviceWorker.register("./sw.js");
    } catch (e) {
      // ignore
    }
  }

  buildTableHeader();
  db = await openDb();
  await loadMeta();
  populateSupplierDropdown();
  populateRangeDropdown("");

  const n = await countItems(db);
  const last = await getMeta(db, "lastImported");
  if (n > 0) {
    setStatus(`Ready offline. ${n} items stored. Last import: ${last ? last : "unknown"}`);
  } else {
    setStatus("No offline data yet. Tap Import / Replace and select your XLSX (Sheet2).");
  }

  // Events
  supplierSel.addEventListener("change", async () => {
    populateRangeDropdown(supplierSel.value);
    rangeSel.value = "";
    selectedItemId = null;
    searchBox.value = "";
    await refreshResults();
  });

  rangeSel.addEventListener("change", async () => {
    selectedItemId = null;
    await refreshResults();
  });

  searchBox.addEventListener("input", async () => {
    selectedItemId = null;
    await refreshResults();
  });

  btnClear.addEventListener("click", async () => {
    rangeSel.value = "";
    searchBox.value = "";
    selectedItemId = null;
    await refreshResults();
  });

  btnManage.addEventListener("click", async () => {
    const nNow = await countItems(db);
    const ok = confirm(
      "Import / Replace will rebuild the offline database from an XLSX file. Continue?"
    );
    if (!ok) return;
    await importXlsxFlow();
  });

  btnHelp.addEventListener("click", showHelp);

  // If supplier already chosen in a previous session, could restore; keeping simple.
}

init();

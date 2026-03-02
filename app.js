import { openDb, getMeta, setMeta, clearAll, bulkPutItems, countItems, getItem, listBySupplier, listBySupplierRange, listByRange } from "./db.js";

const DISPLAY_COLS = ["ItemID", "ModelNum", "Description", "Description2", "Description3", "Cost", "Mrp", "Sell", "$Sell2", "$Sell3", "$Trade1", "$Trade2", "$Trade3", "DC", "SC", "RC", "IC", "GC", "CC", "ItemDescription", "GradeDescription", "ColourDescription", "Op1", "Op2", "Op3", "Op4", "Op5", "Delivery", "SKU", "Group", "Feature1", "Feature2", "Feature3", "SupplierName", "SupplierDebrand", "Range", "Renamed"];
const HIDDEN_COLS = ["Barcode"];

const supplierInput = document.getElementById("supplierInput");
const supplierList = document.getElementById("supplierList");
const rangeInput = document.getElementById("rangeInput");
const rangeList = document.getElementById("rangeList");
const searchBox = document.getElementById("searchBox");
const btnClear = document.getElementById("btnClear");
const statusBox = document.getElementById("statusBox");
const theadRow = document.getElementById("theadRow");
const tbody = document.getElementById("tbody");
const resultsList = document.getElementById("resultsList");
const detailPane = document.getElementById("detailPane");
const detailOverlay = document.getElementById("detailOverlay");
const btnCloseDetail = document.getElementById("btnCloseDetail");
const resultsFooter = document.getElementById("resultsFooter");
const btnManage = document.getElementById("btnManage");
const btnHelp = document.getElementById("btnHelp");

let db;
let metaSuppliers = [];
let metaRangesBySupplier = new Map();
let selectedPk = null;

function setStatus(msg) { statusBox.textContent = msg; }
function safe(v) { return (v === undefined || v === null) ? "" : String(v); }
function normalize(s) { return safe(s).toLowerCase(); }
function trimVal(v) { return safe(v).trim(); }

function parseLabelValue(v){
  const s = trimVal(v);
  const parts = s.split('—');
  return trimVal(parts[0]);
}

function escapeHtml(str) {
  return safe(str)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#39;");
}

function buildTableHeader() {
  theadRow.innerHTML = "";
  for (const c of DISPLAY_COLS) {
    const th = document.createElement("th");
    th.textContent = c;
    theadRow.appendChild(th);
  }
}


function openDetailOverlay(){
  if (detailOverlay) detailOverlay.style.display = "block";
}
function closeDetailOverlay(){
  if (detailOverlay) detailOverlay.style.display = "none";
}
function renderDetail(item) {
  if (!item) {
    detailPane.innerHTML = '<div class="small">Select an item to view all fields.</div>';
    return;
  }
  const sup = metaSuppliers.find(x => x.SupplierName === item.SupplierName);
  const supplierLabel = sup ? `${sup.SupplierName} — ${sup.SupplierDebrand || ""}` : safe(item.SupplierName);

  const ranges = metaRangesBySupplier.get(item.SupplierName) || [];
  const r = ranges.find(x => x.Range === item.Range && x.Renamed === item.Renamed) || ranges.find(x => x.Range === item.Range);
  const rangeLabel = r ? `${r.Range} — ${r.Renamed || ""}` : safe(item.Range);

  let html = "";
  html += `<div class="section"><div class="small"><b>Supplier</b>: ${escapeHtml(supplierLabel)}<br/><b>Range</b>: ${escapeHtml(rangeLabel)}</div></div>`;
  html += `<div class="section"><div class="kv">`;
  for (const c of DISPLAY_COLS) {
    html += `<div class="k">${escapeHtml(c)}</div><div class="v">${escapeHtml(safe(item[c]))}</div>`;
  }
  html += `</div></div>`;
  detailPane.innerHTML = html;
}

function populateSupplierList() {
  supplierList.innerHTML = "";
  for (const s of metaSuppliers) {
    const opt = document.createElement("option");
    opt.value = s.SupplierDebrand ? `${s.SupplierName} — ${s.SupplierDebrand}` : s.SupplierName;
    supplierList.appendChild(opt);
  }
}
}

function populateRangeList(supplierName) {
  rangeList.innerHTML = "";
  const addOpt = (rangeVal, renamedVal) => {
    if (!rangeVal) return;
    const opt = document.createElement("option");
    opt.value = renamedVal ? `${rangeVal} — ${renamedVal}` : rangeVal;
    rangeList.appendChild(opt);
  };

  if (supplierName) {
    const ranges = metaRangesBySupplier.get(supplierName) || [];
    const seen = new Set();
    for (const rr of ranges) {
      const k = `${rr.Range}|||${rr.Renamed}`;
      if (seen.has(k)) continue;
      seen.add(k);
      addOpt(rr.Range, rr.Renamed);
    }
  } else {
    const seen = new Set();
    for (const [sName, ranges] of metaRangesBySupplier.entries()) {
      for (const rr of (ranges || [])) {
        const k = `${rr.Range}|||${rr.Renamed}`;
        if (seen.has(k)) continue;
        seen.add(k);
        addOpt(rr.Range, rr.Renamed);
      }
    }
  }
}
}

async function loadMeta() {
  metaSuppliers = (await getMeta(db, "suppliers")) || [];
  const rangesArr = (await getMeta(db, "rangesBySupplier")) || [];
  metaRangesBySupplier = new Map(rangesArr);
}

function itemIdSortKey(v){
  const s = safe(v).trim();
  const n = parseInt(s, 10);
  if (!isNaN(n) && String(n) === s.replace(/^0+/, "") || s.match(/^0+\d+$/)) return {type:0, n:n, s:s};
  if (!isNaN(n)) return {type:0, n:n, s:s};
  return {type:1, n:0, s:s.toLowerCase()};
}

function rowMatchesSearch(item, q) {
  if (!q) return true;
  const fields = ["ItemID","ModelNum","Description","Description2","Description3","SKU"];
  const hay = fields.map(f => normalize(item[f])).join(" | ");
  return hay.includes(q);
}

function highlightSelected() {
  for (const tr of tbody.querySelectorAll("tr")) {
    tr.style.outline = (tr.dataset.pk === selectedPk) ? "2px solid #000" : "none";
  }
  for (const div of resultsList.querySelectorAll(".item")) {
    div.style.outline = (div.dataset.pk === selectedPk) ? "2px solid #000" : "none";
  }
}

function renderResults(items, groupBySupplier=false) {
  tbody.innerHTML = "";
  for (const it of items) {
    const tr = document.createElement("tr");
    tr.dataset.pk = safe(it._pk);
    tr.addEventListener("click", async () => {
      selectedPk = safe(it._pk);
      renderDetail(await getItem(db, selectedPk));
      openDetailOverlay();
      openDetailOverlay();
      highlightSelected();
    });
    for (const c of DISPLAY_COLS) {
      const td = document.createElement("td");
      td.textContent = safe(it[c]);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }

  resultsList.innerHTML = "";
  let lastSup2 = null;
  for (const it of items) {
    if (groupBySupplier) {
      const sup = safe(it.SupplierName);
      if (sup && sup !== lastSup2) {
        lastSup2 = sup;
        const h = document.createElement('div');
        h.className = 'groupTitle';
        const supMeta = metaSuppliers.find(x => x.SupplierName === sup);
        h.textContent = (supMeta && supMeta.SupplierDebrand) ? `${supMeta.SupplierName} — ${supMeta.SupplierDebrand}` : sup;
        resultsList.appendChild(h);
      }
    }

    const div = document.createElement("div");
    div.className = "item";
    div.dataset.pk = safe(it._pk);
    div.addEventListener("click", async () => {
      selectedPk = safe(it._pk);
      renderDetail(await getItem(db, selectedPk));
      openDetailOverlay();
      openDetailOverlay();
      highlightSelected();
    });

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

async function refreshResults() {
  const supplierLabel = supplierInput.value;
  const rangeLabel = rangeInput.value;
  const supplier = parseLabelValue(supplierLabel);
  const range = parseLabelValue(rangeLabel);
  const q = normalize(searchBox.value).trim();

  if (!supplier) {
    renderResults([]);
    renderDetail(null);
    setStatus("Select a supplier. (If you haven’t imported data yet, tap Import / Replace.)");
    return;
  }

  setStatus("Searching…");
  let base = [];
  let groupBySupplier = false;
  if (supplier && range) {
    base = await listBySupplierRange(db, supplier, range, 5000);
  } else if (supplier && !range) {
    base = await listBySupplier(db, supplier, 5000);
  } else if (!supplier && range) {
    base = await listByRange(db, range, 5000);
    groupBySupplier = true;
  }

  // Default sort: ItemID numeric ascending (non-numeric at the end)
  base.sort((a,b)=>{
    const ka=itemIdSortKey(a.ItemID);
    const kb=itemIdSortKey(b.ItemID);
    if (ka.type !== kb.type) return ka.type - kb.type;
    if (ka.type === 0) return ka.n - kb.n;
    return ka.s.localeCompare(kb.s);
  });

  const filtered = q ? base.filter(it => rowMatchesSearch(it, q)) : base;
  renderResults(filtered, groupBySupplier);
  setStatus(`Loaded.${supplier ? " Supplier: " + supplier : ""}${range ? " Range: " + range : ""} · Records scanned: ${base.length} (showing up to 5000)`);
}

function showHelp() {
  alert(
`If you ever see 0 results:
Tap Import / Replace and re-import the XLSX. This version uses a safer unique key so items are not overwritten.

Filtering:
- Supplier is sorted by SupplierName and shows "SupplierName — SupplierDebrand"
- Range shows "Range — Renamed" and filters by Range
- Barcode is hidden and not searched.`
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

function buildHeaderMap(rows) {
  const map = new Map();
  if (!rows || rows.length === 0) return map;
  const keys = Object.keys(rows[0] || {});
  const normToActual = new Map(keys.map(k => [k.trim(), k]));
  for (const col of DISPLAY_COLS.concat(Array.from(HIDDEN_COLS))) {
    if (normToActual.has(col)) map.set(col, normToActual.get(col));
  }
  return map;
}

async function importXlsxFile(file) {
  if (!window.XLSX) {
    alert("XLSX parser library didn’t load. Open once while online, then try again.");
    return;
  }

  setStatus("Reading XLSX…");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheetName = wb.SheetNames.find(n => n.toLowerCase() === "sheet2") || wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  if (!ws) {
    alert("Could not find the sheet to import.");
    return;
  }

  setStatus(`Parsing ${sheetName}…`);
  const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
  const headerMap = buildHeaderMap(rows);

  const items = [];
  const suppliersMap = new Map();
  const rangesMap = new Map();

  for (const r of rows) {
    const it = {};
    for (const col of DISPLAY_COLS.concat(Array.from(HIDDEN_COLS))) {
      const key = headerMap.get(col) || col;
      it[col] = safe(r[key]);
    }

    // Trim key fields so filters match exactly
    it.SupplierName = trimVal(it.SupplierName);
    it.SupplierDebrand = trimVal(it.SupplierDebrand);
    it.Range = trimVal(it.Range);
    it.Renamed = trimVal(it.Renamed);
    it.ItemID = trimVal(it.ItemID);
    it.ModelNum = trimVal(it.ModelNum);
    it.SKU = trimVal(it.SKU);

    if (!it.SupplierName || !it.ItemID) continue;

    // Create a unique primary key so items from different suppliers don't overwrite each other
    it._pk = `${it.SupplierName}||${it.ItemID}`;

    // Meta
    if (!suppliersMap.has(it.SupplierName)) suppliersMap.set(it.SupplierName, it.SupplierDebrand);

    if (!rangesMap.has(it.SupplierName)) rangesMap.set(it.SupplierName, new Map());
    const rk = `${it.Range}|||${it.Renamed}`;
    if (it.Range && !rangesMap.get(it.SupplierName).has(rk)) {
      rangesMap.get(it.SupplierName).set(rk, { Range: it.Range, Renamed: it.Renamed });
    }

    items.push(it);
  }

  setStatus("Saving offline database…");
  await clearAll(db);

  const chunkSize = 1500;
  for (let i=0;i<items.length;i+=chunkSize) {
    await bulkPutItems(db, items.slice(i, i+chunkSize));
    setStatus(`Saving… ${Math.min(i+chunkSize, items.length)} / ${items.length}`);
    await new Promise(r => setTimeout(r, 0));
  }

  const suppliers = Array.from(suppliersMap.entries())
    .map(([SupplierName, SupplierDebrand]) => ({ SupplierName, SupplierDebrand }))
    .sort((a,b)=> (a.SupplierName||"").localeCompare(b.SupplierName||""));

  const rangesBySupplier = Array.from(rangesMap.entries()).map(([sName, m]) => {
    const arr = Array.from(m.values()).sort((a,b)=> (a.Range||"").localeCompare(b.Range||""));
    return [sName, arr];
  });

  await setMeta(db, "suppliers", suppliers);
  await setMeta(db, "rangesBySupplier", rangesBySupplier);
  await setMeta(db, "lastImported", new Date().toISOString());
  await setMeta(db, "sheetImported", sheetName);

  await loadMeta();
  populateSupplierList();
  supplierInput.value = "";
  populateRangeList("");
  renderResults([]);
  renderDetail(null);

  const n = await countItems(db);
  setStatus(`Import complete. ${n} items saved for offline use.`);
  alert(`Imported ${n} items from "${sheetName}". You can now use the app offline.`);
}

async function init() {
  if ("serviceWorker" in navigator) {
    try { await navigator.serviceWorker.register("./sw.js"); } catch (e) {}
  }

  buildTableHeader();
  db = await openDb();
  await loadMeta();
  populateSupplierList();
  populateRangeList("");

  const n = await countItems(db);
  const last = await getMeta(db, "lastImported");
  if (n > 0) {
    setStatus(`Ready offline. ${n} items stored. Last import: ${last ? last : "unknown"}`);
  } else {
    setStatus("No offline data yet. Tap Import / Replace and select your XLSX (Sheet2).");
  }

  supplierSel.addEventListener("change", async () => {
    populateRangeList(supplierInput.value);
    rangeInput.value = "";
    selectedPk = null;
    searchBox.value = "";
    await refreshResults();
  });

  rangeSel.addEventListener("change", async () => {
    selectedPk = null;
    await refreshResults();
  });

  searchBox.addEventListener("input", async () => {
    selectedPk = null;
    await refreshResults();
  });

  btnClear.addEventListener("click", async () => {
    supplierInput.value = "";
    rangeInput.value = "";
    searchBox.value = "";
    selectedPk = null;
    populateRangeList("");
    await refreshResults();
  });


  const onFiltersChanged = async () => {
    populateRangeList(parseLabelValue(supplierInput.value));
    selectedPk = null;
    await refreshResults();
  };
  if (supplierInput) {
    supplierInput.addEventListener("input", onFiltersChanged);
    supplierInput.addEventListener("change", onFiltersChanged);
  }
  if (rangeInput) {
    rangeInput.addEventListener("input", async () => { selectedPk = null; await refreshResults(); });
    rangeInput.addEventListener("change", async () => { selectedPk = null; await refreshResults(); });
  }

  btnManage.addEventListener("click", async () => {
    const ok = confirm("Import / Replace will rebuild the offline database from an XLSX file. Continue?");
    if (!ok) return;
    await importXlsxFlow();
  });

  btnHelp.addEventListener("click", showHelp);
}

init();

const SUPABASE_URL = 'https://gghfgkzkgzfurbhwdbgv.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdnaGZna3prZ3pmdXJiaHdkYmd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyNDA3NjEsImV4cCI6MjA5MDgxNjc2MX0.Bn4mwiEbvlkPySs8ewZiH4NGi_2k6_Yciv1tscvW20o';

const sb = (path, opts = {}) => fetch(SUPABASE_URL + '/rest/v1/' + path, {
  headers: {
    'apikey': SUPABASE_KEY,
    'Authorization': 'Bearer ' + SUPABASE_KEY,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
    ...opts.headers
  },
  ...opts
}).then(r => r.json());

const PRODUCTS = ['Wet distillers','Modified distillers','Dry distillers','Loosehulls','Soyhull pellets','Syrup','Corn screenings','Gluten'];

// Column index map — offset by 2 for rownum + checkbox cols
const COL_MAP = {
  notes:2, delivery_date:3, product:4, load_number:5, customer_name:6,
  plant:7, hauler:8, loads_on_date:9, tons:10, markup:11, commission:12
};
const FIELD_ORDER = ['notes','delivery_date','product','load_number','customer_name','plant','hauler','loads_on_date','tons','markup','commission'];
const FIELD_TYPE = {
  notes:'text', delivery_date:'date', product:'select-product', load_number:'text',
  customer_name:'customer', plant:'select-plant', hauler:'text',
  loads_on_date:'number', tons:'decimal', markup:'decimal', commission:'decimal'
};

let allPlants     = [];
let allLines      = [];
let filteredLines = [];
let allOrders     = [];
let allCustomers  = [];
let weekOffset    = 0;
let activeCell    = null;
let editingCustomerId = null;
let importedRows  = [];
let dragFillStart = null;

// Multi-select & undo
let selectedIds   = new Set();
let undoBuffer    = [];   // [{rows: [...line objects], orderLinePayloads: [...]}]
let undoTimer     = null;

// Row highlight colors (stored in localStorage, keyed by line id)
let rowColors = JSON.parse(localStorage.getItem('rowColors') || '{}');

function saveRowColors() {
  localStorage.setItem('rowColors', JSON.stringify(rowColors));
}

// Cut / paste & drag-to-date
let cutIds        = new Set();   // ids currently cut (Ctrl+X)
let dragRowId     = null;        // id of row being dragged (or null if multi)
let dragOverDate  = null;        // date string currently highlighted

// ── Init ──────────────────────────────────────────────
async function init() {
  renderWeekLabel();
  await Promise.all([loadOrderLines(), loadOrders(), loadCustomers(), loadPlants()]);
  renderMetrics();
  renderSheet();
  document.addEventListener('keydown', handleKeyboard);
  // Backdrop click closes whichever modal is open
  document.getElementById('modal-backdrop').addEventListener('click', () => {
    if (document.getElementById('edit-cust-modal').style.display !== 'none') closeModal();
    if (document.getElementById('paste-date-modal').style.display !== 'none') closePasteModal();
  });
}

// ── Data ──────────────────────────────────────────────
async function loadOrderLines() {
  try {
    const lines = await sb('order_lines?select=*,orders(id,customer_id,notes,submitted_at,customers(id,name,phone))&order=delivery_date.asc,load_number.asc');
    const savedLines = Array.isArray(lines) ? lines.filter(l => l.status !== 'Fulfilled' && l.load_number) : [];
    // Keep any unsaved _isNew rows that are currently being edited
    const newRows = allLines.filter(l => l._isNew);
    allLines = [...savedLines, ...newRows];
    filteredLines = [...allLines];
  } catch(e) { console.error(e); }
}

async function loadOrders() {
  try {
    const lines = await sb(
      'order_lines?select=*,orders(id,customer_id,submitted_at,customers(id,name,phone))' +
      '&load_number=is.null' +
      '&status=in.(Pending,Scheduled)' +
      '&order=delivery_date.asc'
    );
    allOrders = Array.isArray(lines) ? lines : [];
  } catch(e) { console.error('loadOrders error:', e); }
}

async function loadCustomers() {
  try {
    const data = await sb('customers?order=name.asc');
    allCustomers = Array.isArray(data) ? data : [];
  } catch(e) { console.error(e); }
}

async function loadPlants() {
  try {
    const data = await sb('plants?order=name.asc');
    allPlants = Array.isArray(data) ? data : [];
    populatePlantDropdowns();
  } catch(e) { console.error('loadPlants error:', e); }
}

function populatePlantDropdowns() {
  // Entry form plant dropdown
  const entryPlant = document.getElementById('entry-plant');
  if (entryPlant) {
    const cur = entryPlant.value;
    entryPlant.innerHTML = '<option value="">Select plant...</option>' +
      allPlants.map(p => `<option value="${p.name}"${p.name===cur?' selected':''}>${p.name}</option>`).join('');
  }
}

// ── Week nav ──────────────────────────────────────────
function getWeekRange() {
  const today = new Date(); today.setHours(0,0,0,0);
  const dow = today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() - (dow===0?6:dow-1) + weekOffset*7);
  const friday = new Date(monday); friday.setDate(monday.getDate()+4);
  return { monday, friday };
}

function renderWeekLabel() {
  const { monday, friday } = getWeekRange();
  const fmt = d => d.toLocaleDateString('en-US',{month:'short',day:'numeric'});
  document.getElementById('week-label').textContent = 'Week of '+fmt(monday)+' — '+fmt(friday);
}

function prevWeek()  { weekOffset--; renderWeekLabel(); applyFilters(); }
function nextWeek()  { weekOffset++; renderWeekLabel(); applyFilters(); }
function todayWeek() { weekOffset=0;  renderWeekLabel(); applyFilters(); }

// ── Tabs ──────────────────────────────────────────────
function showAdminTab(tab) {
  ['loads','entry','orders','customers','plants'].forEach(t => {
    document.getElementById('panel-'+t).style.display = t===tab?'block':'none';
    document.getElementById('tab-'+t).classList.toggle('active', t===tab);
  });
  if (tab==='orders')    renderOrdersTable();
  if (tab==='customers') renderCustomersTable();
  if (tab==='plants')    renderPlantsTable();
}

// ── Dynamic filter dropdowns ──────────────────────────
function populateDynamicFilters() {
  const { monday, friday } = getWeekRange();
  const ws = monday.toISOString().split('T')[0];
  const we = friday.toISOString().split('T')[0];
  const weekLines = allLines.filter(l => l.delivery_date >= ws && l.delivery_date <= we);

  const plants   = [...new Set(weekLines.map(l => l.plant).filter(Boolean))].sort();
  const truckers = [...new Set(weekLines.map(l => l.hauler).filter(Boolean))].sort();

  const plantSel   = document.getElementById('filter-plant');
  const truckerSel = document.getElementById('filter-trucker');
  const curPlant   = plantSel.value;
  const curTrucker = truckerSel.value;

  plantSel.innerHTML   = '<option value="">All plants</option>'   + plants.map(p   => `<option${p===curPlant?' selected':''}>${p}</option>`).join('');
  truckerSel.innerHTML = '<option value="">All truckers</option>' + truckers.map(t => `<option${t===curTrucker?' selected':''}>${t}</option>`).join('');
}

function clearFilters() {
  document.getElementById('filter-product').value = '';
  document.getElementById('filter-plant').value   = '';
  document.getElementById('filter-trucker').value = '';
  document.getElementById('filter-search').value  = '';
  applyFilters();
}

// ── Filters ───────────────────────────────────────────
function applyFilters() {
  populateDynamicFilters();
  const fp      = document.getElementById('filter-product').value;
  const fpl     = document.getElementById('filter-plant').value;
  const ft      = document.getElementById('filter-trucker').value;
  const search  = document.getElementById('filter-search').value.toLowerCase();
  const { monday, friday } = getWeekRange();
  const ws = monday.toISOString().split('T')[0];
  const we = friday.toISOString().split('T')[0];

  filteredLines = allLines.filter(l => {
    // Always show unsaved new rows regardless of filters
    if (l._isNew) return true;
    if (l.delivery_date < ws || l.delivery_date > we) return false;
    if (fp  && l.product !== fp)  return false;
    if (fpl && l.plant   !== fpl) return false;
    if (ft  && l.hauler  !== ft)  return false;
    if (search) {
      const farmer  = (l.customer_name||(l.orders?.customers?.name)||'').toLowerCase();
      const plant   = (l.plant||'').toLowerCase();
      const loadnum = (l.load_number||'').toLowerCase();
      const notes   = (l.notes||'').toLowerCase();
      if (!farmer.includes(search) && !plant.includes(search) && !loadnum.includes(search) && !notes.includes(search)) return false;
    }
    return true;
  });

  const countEl = document.getElementById('filter-count');
  countEl.textContent = filteredLines.length !== allLines.filter(l => {
    const { monday, friday } = getWeekRange();
    return l.delivery_date >= monday.toISOString().split('T')[0] && l.delivery_date <= friday.toISOString().split('T')[0];
  }).length
    ? `${filteredLines.length} of ${allLines.filter(l => { const {monday,friday}=getWeekRange(); return l.delivery_date>=monday.toISOString().split('T')[0]&&l.delivery_date<=friday.toISOString().split('T')[0]; }).length} loads`
    : '';

  renderMetrics();
  renderSheet();
}

// ── Metrics ───────────────────────────────────────────
function renderMetrics() {
  const { monday, friday } = getWeekRange();
  const ws = monday.toISOString().split('T')[0];
  const we = friday.toISOString().split('T')[0];
  const week = allLines.filter(l => l.delivery_date>=ws && l.delivery_date<=we);
  const total = week.length;
  const totalCommission = week.reduce((a,l) => a+(parseFloat(l.commission)||0), 0);
  const pendingLoads = allOrders
    .filter(l => l.delivery_date>=ws && l.delivery_date<=we)
    .reduce((a,l) => a+(l.loads_on_date||1), 0);

  document.getElementById('metrics').innerHTML = `
    <div class="metric">
      <div class="metric-label">Loads this week</div>
      <div class="metric-value">${total}</div>
    </div>
    <div class="metric">
      <div class="metric-label">Commission</div>
      <div class="metric-value" style="color:#137333">$${totalCommission.toFixed(2)}</div>
    </div>
    <div class="metric" style="cursor:pointer" onclick="showAdminTab('orders')" title="View farmer orders">
      <div class="metric-label">Unfilled orders</div>
      <div class="metric-value" style="color:${pendingLoads>0?'#c5221f':'#137333'}">${pendingLoads}</div>
    </div>
  `;
}

// ── Sheet render ──────────────────────────────────────
function renderSheet() {
  const tbody = document.getElementById('sheet-body');
  if (!tbody) return;

  if (!filteredLines.length) {
    // Show day headers with add buttons even when no loads
    const { monday } = getWeekRange();
    let html = '';
    for (let d = 0; d < 5; d++) {
      const date = new Date(monday);
      date.setDate(monday.getDate() + d);
      const dateStr = date.toISOString().split('T')[0];
      const dayName = date.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'});
      html += `<tr class="date-row" data-date="${dateStr}"
          ondragover="dateDragOver(event,'${dateStr}')"
          ondragleave="dateDragLeave(event)"
          ondrop="dateDrop(event,'${dateStr}')">
          <td colspan="14" style="display:flex;align-items:center;justify-content:space-between">
            <span>${dayName} — 0 loads</span>
            <button class="add-row-btn" onclick="addBlankRow('${dateStr}')">+ Add load</button>
          </td></tr>`;
      for (let b = 0; b < 30; b++) {
        html += `
          <tr class="blank-row" data-date="${dateStr}">
            <td class="col-rownum" style="color:#ccc">${b + 1}</td>
            <td class="col-check"></td>
            <td onclick="addBlankRowAndEdit('${dateStr}','notes')" style="cursor:cell"></td>
            <td onclick="addBlankRowAndEdit('${dateStr}','delivery_date')" style="cursor:cell"></td>
            <td onclick="addBlankRowAndEdit('${dateStr}','product')" style="cursor:cell"></td>
            <td onclick="addBlankRowAndEdit('${dateStr}','load_number')" style="cursor:cell"></td>
            <td onclick="addBlankRowAndEdit('${dateStr}','customer_name')" style="cursor:cell"></td>
            <td onclick="addBlankRowAndEdit('${dateStr}','plant')" style="cursor:cell"></td>
            <td onclick="addBlankRowAndEdit('${dateStr}','hauler')" style="cursor:cell"></td>
            <td onclick="addBlankRowAndEdit('${dateStr}','loads_on_date')" style="cursor:cell"></td>
            <td onclick="addBlankRowAndEdit('${dateStr}','tons')" style="cursor:cell"></td>
            <td onclick="addBlankRowAndEdit('${dateStr}','markup')" style="cursor:cell"></td>
            <td onclick="addBlankRowAndEdit('${dateStr}','commission')" style="cursor:cell"></td>
            <td></td>
          </tr>`;
      }
    }
    tbody.innerHTML = html;
    updateSelectionToolbar();
    return;
  }

  // Group by date
  const grouped = {};
  filteredLines.forEach(l => {
    if (!grouped[l.delivery_date]) grouped[l.delivery_date] = [];
    grouped[l.delivery_date].push(l);
  });

  let html = '';
  let rowNum = 1;

  Object.keys(grouped).sort().forEach(dateStr => {
    const d = new Date(dateStr+'T00:00:00');
    const dayName = d.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'});
    const count = grouped[dateStr].length;
    html += `<tr class="date-row" data-date="${dateStr}"
        ondragover="dateDragOver(event,'${dateStr}')"
        ondragleave="dateDragLeave(event)"
        ondrop="dateDrop(event,'${dateStr}')">
        <td colspan="14" style="display:flex;align-items:center;justify-content:space-between">
          <span>${dayName} — ${count} load${count!==1?'s':''}</span>
          <button class="add-row-btn" onclick="addBlankRow('${dateStr}')">+ Add load</button>
        </td></tr>`;

    // Pad to minimum 30 visible rows with blank add-rows
    const MIN_ROWS = 30;
    const existingCount = grouped[dateStr].length;
    const blankCount = Math.max(0, MIN_ROWS - existingCount);

    grouped[dateStr].forEach(l => {
      const farmer   = l.customer_name||(l.orders?.customers?.name)||'';
      const hasTrucker = l.hauler && l.hauler.trim();
      const rowClass = (hasTrucker?'row-assigned':'row-unassigned') + (selectedIds.has(l.id)?' row-selected':'');
      const tons       = l.tons     != null ? l.tons     : '';
      const markup     = l.markup   != null ? l.markup   : '';
      const commission = l.commission != null ? l.commission : '';
      const commClass  = commission !== '' ? 'cell-commission' : 'cell-commission empty';
      const noteVal    = l.notes || '';
      const checked    = selectedIds.has(l.id) ? 'checked' : '';

      const farmerOrder = farmer ? getFarmerPendingOrder(farmer, l.product, l.delivery_date) : null;
      const farmerTag   = farmerOrder
        ? `<span class="farmer-order-badge">${farmerOrder.loads_on_date} needed</span>`
        : '';

      const isCut = cutIds.has(l.id);
      const rowColor = rowColors[l.id] || '';
      const rowBg = rowColor ? `background:${rowColor} !important;` : '';
      html += `
        <tr data-id="${l.id}" class="${rowClass}${isCut?' row-cut':''}" ondblclick="startEdit(${l.id},'notes')"
            draggable="false"
            oncontextmenu="showColorMenu(event,${l.id})"
            style="${rowBg}">
          <td class="col-rownum"
              onclick="toggleRowSelect(${l.id},event)"
              draggable="true"
              onmousedown="rowDragMousedown(event,${l.id})"
              ondragstart="rowDragStart(event,${l.id})"
              style="cursor:grab">${rowNum}</td>
          <td class="col-check"><input type="checkbox" ${checked} onchange="onRowCheckChange(${l.id},this.checked)" /></td>
          <td class="col-notes-td"><div class="cell-view${!noteVal?' empty':''}" onclick="startEdit(${l.id},'notes')">${noteVal||''}</div></td>
          <td><div class="cell-view${!l.delivery_date?' empty':''}" onclick="startEdit(${l.id},'delivery_date')">${formatDate(l.delivery_date)}</div></td>
          <td><div class="cell-view" onclick="startEdit(${l.id},'product')">${l.product||''}</div></td>
          <td><div class="cell-view${!l.load_number?' empty':''}" onclick="startEdit(${l.id},'load_number')">${l.load_number||'—'}</div></td>
          <td><div class="cell-view${!farmer?' empty':''}" onclick="startEdit(${l.id},'customer_name')" style="gap:0">${farmer||'—'}${farmerTag}</div></td>
          <td><div class="cell-view${!l.plant?' empty':''}" onclick="startEdit(${l.id},'plant')">${l.plant||'—'}</div></td>
          <td><div class="cell-view${!hasTrucker?' empty':''}" onclick="startEdit(${l.id},'hauler')" style="${hasTrucker?'color:#e37400;font-weight:500':''}">${l.hauler||'—'}</div></td>
          <td><div class="cell-view" onclick="startEdit(${l.id},'loads_on_date')">${l.loads_on_date||1}</div></td>
          <td><div class="cell-view${tons===''?' empty':''}" onclick="startEdit(${l.id},'tons')">${tons!==''?tons:'—'}</div></td>
          <td><div class="cell-view${markup===''?' empty':''}" onclick="startEdit(${l.id},'markup')">${markup!==''?('$'+markup):'—'}</div></td>
          <td><div class="${commClass}" style="padding:0 6px;height:22px;display:flex;align-items:center;font-size:12px;cursor:cell" onclick="startEdit(${l.id},'commission')">${commission!==''?('$'+commission):'—'}</div></td>
          <td><button class="del-row-btn" onclick="deleteSingleRow(${l.id})" title="Delete">×</button></td>
        </tr>`;
      rowNum++;
    });

    // Add blank placeholder rows to reach minimum 30
    for (let b = 0; b < blankCount; b++) {
      html += `
        <tr class="blank-row" data-date="${dateStr}">
          <td class="col-rownum" style="color:#ccc">${existingCount + b + 1}</td>
          <td class="col-check"></td>
          <td onclick="addBlankRowAndEdit('${dateStr}','notes')" style="cursor:cell"></td>
          <td onclick="addBlankRowAndEdit('${dateStr}','delivery_date')" style="cursor:cell"></td>
          <td onclick="addBlankRowAndEdit('${dateStr}','product')" style="cursor:cell"></td>
          <td onclick="addBlankRowAndEdit('${dateStr}','load_number')" style="cursor:cell"></td>
          <td onclick="addBlankRowAndEdit('${dateStr}','customer_name')" style="cursor:cell"></td>
          <td onclick="addBlankRowAndEdit('${dateStr}','plant')" style="cursor:cell"></td>
          <td onclick="addBlankRowAndEdit('${dateStr}','hauler')" style="cursor:cell"></td>
          <td onclick="addBlankRowAndEdit('${dateStr}','loads_on_date')" style="cursor:cell"></td>
          <td onclick="addBlankRowAndEdit('${dateStr}','tons')" style="cursor:cell"></td>
          <td onclick="addBlankRowAndEdit('${dateStr}','markup')" style="cursor:cell"></td>
          <td onclick="addBlankRowAndEdit('${dateStr}','commission')" style="cursor:cell"></td>
          <td></td>
        </tr>`;
    }
  });

  tbody.innerHTML = html;
  updateSelectionToolbar();
}

// Helper
function getFarmerPendingOrder(customerName, product, deliveryDate) {
  if (!customerName || !product || !deliveryDate) return null;
  return allOrders.find(l => {
    const name = l.orders?.customers?.name || l.customer_name || '';
    return name.toLowerCase().trim() === customerName.toLowerCase().trim()
      && l.product === product
      && l.delivery_date === deliveryDate;
  }) || null;
}

// ── Row selection ─────────────────────────────────────
function toggleRowSelect(lineId, e) {
  if (e.shiftKey) {
    // range-select between last selected and this row
    const ids = filteredLines.map(l => l.id);
    const clickIdx = ids.indexOf(lineId);
    const lastSel  = [...selectedIds].map(id => ids.indexOf(id)).filter(i => i >= 0);
    if (lastSel.length) {
      const anchor = lastSel[lastSel.length - 1];
      const [a, b] = [Math.min(anchor, clickIdx), Math.max(anchor, clickIdx)];
      for (let i = a; i <= b; i++) selectedIds.add(ids[i]);
    } else {
      selectedIds.has(lineId) ? selectedIds.delete(lineId) : selectedIds.add(lineId);
    }
  } else {
    selectedIds.has(lineId) ? selectedIds.delete(lineId) : selectedIds.add(lineId);
  }
  renderSheet();
}

function onRowCheckChange(lineId, checked) {
  checked ? selectedIds.add(lineId) : selectedIds.delete(lineId);
  updateSelectionToolbar();
  updateCheckAllState();
}

function toggleAllRows(checked) {
  if (checked) filteredLines.forEach(l => selectedIds.add(l.id));
  else selectedIds.clear();
  renderSheet();
}

function clearSelection() {
  selectedIds.clear();
  renderSheet();
}

function updateSelectionToolbar() {
  const tb = document.getElementById('selection-toolbar');
  const ct = document.getElementById('selection-count');
  const pb = document.getElementById('paste-btn');
  if (selectedIds.size > 0) {
    tb.style.display = 'flex';
    ct.textContent = `${selectedIds.size} row${selectedIds.size!==1?'s':''} selected`;
  } else {
    tb.style.display = 'none';
    hideColorMenu();
  }
  // Show paste button only when there are cut rows
  if (pb) pb.style.display = cutIds.size > 0 ? 'flex' : 'none';
  updateCheckAllState();
}

function updateCheckAllState() {
  const cb = document.getElementById('check-all');
  if (!cb) return;
  const weekIds = filteredLines.map(l => l.id);
  const selInWeek = weekIds.filter(id => selectedIds.has(id)).length;
  cb.checked       = selInWeek > 0 && selInWeek === weekIds.length;
  cb.indeterminate = selInWeek > 0 && selInWeek < weekIds.length;
}

// ── Delete rows ───────────────────────────────────────
async function deleteSingleRow(lineId) {
  const line = allLines.find(l => l.id === lineId);
  if (!line) return;
  // If row was never saved to Supabase, just remove it locally
  if (line._isNew) {
    allLines = allLines.filter(l => l.id !== lineId);
    applyFilters();
    return;
  }
  await deleteRows([line]);
}

async function deleteSelectedRows() {
  if (!selectedIds.size) return;
  const rows = allLines.filter(l => selectedIds.has(l.id));
  if (!confirm(`Delete ${rows.length} selected row${rows.length!==1?'s':''}?`)) return;
  await deleteRows(rows);
}

async function deleteRows(rows) {
  const ids = rows.map(r => r.id);
  try {
    await fetch(SUPABASE_URL + '/rest/v1/order_lines?id=in.(' + ids.join(',') + ')', {
      method: 'DELETE',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY, 'Prefer': 'return=minimal' }
    });

    // Store for undo
    undoBuffer = rows.map(r => ({ ...r }));

    // Remove from local state
    ids.forEach(id => {
      allLines = allLines.filter(l => l.id !== id);
      selectedIds.delete(id);
    });

    applyFilters();
    showToast(`Deleted ${rows.length} row${rows.length!==1?'s':''}`);
  } catch(e) { alert('Error deleting: ' + e.message); }
}

// ── Undo delete ───────────────────────────────────────
async function undoDelete() {
  if (!undoBuffer.length) return;
  hideToast();
  try {
    // Re-insert rows — strip join fields and let Supabase re-create them
    const payload = undoBuffer.map(r => {
      const { orders, ...clean } = r;
      return clean;
    });
    const result = await sb('order_lines', { method: 'POST', body: JSON.stringify(payload) });
    if (result && result.code) throw new Error(result.message);
    undoBuffer = [];
    await loadOrderLines();
    applyFilters();
  } catch(e) { alert('Undo failed: ' + e.message); }
}

function showToast(msg) {
  clearTimeout(undoTimer);
  document.getElementById('undo-msg').textContent = msg;
  document.getElementById('undo-toast').classList.add('show');
  undoTimer = setTimeout(hideToast, 6000);
}

function hideToast() {
  document.getElementById('undo-toast').classList.remove('show');
}

// ── Inline editing ────────────────────────────────────
function startEdit(lineId, field) {
  if (activeCell) commitCell(false);
  const tr = document.querySelector(`tr[data-id="${lineId}"]`);
  if (!tr) return;
  const colIdx = COL_MAP[field];
  const td = tr.children[colIdx];
  if (!td) return;
  td.classList.add('cell-active');

  const line = allLines.find(l => l.id === lineId);
  const currentVal = line ? (line[field] != null ? line[field] : '') : '';
  const type = FIELD_TYPE[field];
  let input;

  if (type === 'select-product') {
    input = document.createElement('select');
    input.className = 'cell-input';
    // Blank option so it doesn't auto-select Wet distillers on empty cells
    const blankOpt = document.createElement('option');
    blankOpt.value = ''; blankOpt.textContent = '— pick product —';
    if (!currentVal) blankOpt.selected = true;
    input.appendChild(blankOpt);
    PRODUCTS.forEach(p => {
      const o = document.createElement('option');
      o.textContent = p;
      if (p === currentVal) o.selected = true;
      input.appendChild(o);
    });
  } else if (type === 'select-plant') {
    input = document.createElement('select');
    input.className = 'cell-input';
    const blank = document.createElement('option');
    blank.value = ''; blank.textContent = '—';
    if (!currentVal) blank.selected = true;
    input.appendChild(blank);
    allPlants.forEach(p => {
      const o = document.createElement('option');
      o.textContent = p.name;
      if (p.name === currentVal) o.selected = true;
      input.appendChild(o);
    });
  } else if (type === 'customer') {
    input = document.createElement('input');
    input.className = 'cell-input';
    input.type = 'text';
    input.value = currentVal;
    // Build/reuse datalist
    let dl = document.getElementById('customer-datalist');
    if (!dl) {
      dl = document.createElement('datalist');
      dl.id = 'customer-datalist';
      document.body.appendChild(dl);
    }
    dl.innerHTML = allCustomers.map(c => `<option value="${c.name}">`).join('');
    input.setAttribute('list', 'customer-datalist');
  } else {
    input = document.createElement('input');
    input.className = 'cell-input';
    input.type = type==='date'?'date':type==='number'||type==='decimal'?'number':'text';
    if (type==='decimal') input.step = '0.01';
    if (type==='number')  input.min  = 1;
    input.value = currentVal;
  }

  input.onblur   = () => commitCell(true);
  input.onkeydown = e => {
    if (e.key==='Enter')  { e.preventDefault(); commitCell(true); }
    if (e.key==='Tab')    { e.preventDefault(); commitCell(true); moveNext(lineId, field); }
    if (e.key==='Escape') { td.classList.remove('cell-active'); renderSheet(); activeCell=null; }
  };

  td.innerHTML = '';
  td.appendChild(input);
  input.focus();
  if (type !== 'select-product' && type !== 'date') input.select();
  activeCell = { td, lineId, field, type, input, oldVal: currentVal };
}

async function commitCell(save) {
  if (!activeCell) return;
  const { td, lineId, field, type, input, oldVal } = activeCell;
  activeCell = null;
  td.classList.remove('cell-active');

  let newVal;
  if (type==='number')        newVal = parseInt(input.value) || 1;
  else if (type==='decimal')  newVal = input.value !== '' ? parseFloat(parseFloat(input.value).toFixed(2)) : null;
  else                        newVal = input.value.trim();

  const line = allLines.find(l => l.id === lineId);
  if (!line) { renderSheet(); return; }

  const strNew = newVal != null ? String(newVal) : '';
  const strOld = oldVal != null ? String(oldVal) : '';
  line[field] = newVal;

  if (save && strNew !== strOld) {
    const updatePayload = { [field]: newVal };
    if (field==='hauler' && newVal && !oldVal) updatePayload.status = 'Sent out';

    // Decrement farmer order when customer_name is assigned
    if (field === 'customer_name' && newVal) {
      const product = line.product;
      const date    = line.delivery_date;
      if (product && date) await decrementFarmerOrder(newVal, product, date);
    }

    // Also decrement when product or date changes and customer is already set
    if ((field==='product'||field==='delivery_date') && line.customer_name) {
      await decrementFarmerOrder(line.customer_name, line.product, line.delivery_date);
    }

    try {
      if (line._isNew) {
        // First time saving this row — do an INSERT with all current field values
        const insertPayload = {
          delivery_date: line.delivery_date,
          product:       line.product   || null,
          load_number:   line.load_number || null,
          customer_name: line.customer_name || null,
          plant:         line.plant     || null,
          hauler:        line.hauler    || null,
          loads_on_date: line.loads_on_date || 1,
          tons:          line.tons      || null,
          markup:        line.markup    || null,
          commission:    line.commission || null,
          notes:         line.notes     || null,
          status:        'Scheduled',
          total_loads:   1,
          [field]:       newVal
        };
        const result = await sb('order_lines', { method: 'POST', body: JSON.stringify(insertPayload) });
        const saved = Array.isArray(result) ? result[0] : result;
        if (saved && saved.id) {
          // Swap temp id for real id in allLines
          const idx = allLines.findIndex(l => l.id === lineId);
          if (idx >= 0) {
            allLines[idx] = { ...allLines[idx], ...saved, _isNew: false };
          }
        }
      } else {
        await sb('order_lines?id=eq.'+lineId, {
          method: 'PATCH', headers: { 'Prefer': 'return=minimal' },
          body: JSON.stringify(updatePayload)
        });
      }
      populateDynamicFilters();
    } catch(e) { console.error('Save error:', e); }
  }

  renderMetrics();
  renderSheet();
}

function moveNext(lineId, currentField) {
  const idx = FIELD_ORDER.indexOf(currentField);
  if (idx < FIELD_ORDER.length - 1) {
    setTimeout(() => startEdit(lineId, FIELD_ORDER[idx+1]), 30);
  }
}

// ── Decrement farmer order ────────────────────────────
async function decrementFarmerOrder(customerName, product, deliveryDate) {
  if (!customerName || !product || !deliveryDate) return;
  try {
    const match = allOrders.find(l => {
      const name = l.orders?.customers?.name || l.customer_name || '';
      return name.toLowerCase().trim() === customerName.toLowerCase().trim()
        && l.product === product
        && l.delivery_date === deliveryDate
        && (l.status === 'Pending' || l.status === 'Scheduled');
    });
    if (!match) return;

    const remaining = (match.loads_on_date || 1) - 1;
    if (remaining <= 0) {
      await fetch(SUPABASE_URL + '/rest/v1/order_lines?id=eq.' + match.id, {
        method: 'PATCH',
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify({ status: 'Fulfilled', loads_on_date: 0 })
      });
      allOrders = allOrders.filter(l => l.id !== match.id);
    } else {
      await fetch(SUPABASE_URL + '/rest/v1/order_lines?id=eq.' + match.id, {
        method: 'PATCH',
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify({ loads_on_date: remaining })
      });
      match.loads_on_date = remaining;
    }
    renderOrdersTable();
    renderMetrics();
  } catch(e) { console.error('Decrement error:', e); }
}

// ── Import loads ──────────────────────────────────────
function generateSequence() {
  const first = document.getElementById('gen-first').value.trim();
  const count = parseInt(document.getElementById('gen-count').value) || 0;
  const msg = document.getElementById('entry-msg');
  if (!first) { msg.style.color='red'; msg.textContent='Enter a starting load number.'; return; }
  if (!count || count<1) { msg.style.color='red'; msg.textContent='Enter how many loads to generate.'; return; }
  const seq = [first, ...incrementSequence(first, count-1)];
  document.getElementById('entry-loads').value = seq.join('\n');
  msg.style.color='green'; msg.textContent = seq.length + ' load numbers generated — click Import loads.';
}

function importLoads() {
  const plant   = document.getElementById('entry-plant').value.trim();
  const product = document.getElementById('entry-product').value;
  const date    = document.getElementById('entry-date').value;
  const raw     = document.getElementById('entry-loads').value.trim();
  const msg     = document.getElementById('entry-msg');
  if (!product) { msg.style.color='red'; msg.textContent='Please select a product.'; return; }
  if (!raw)     { msg.style.color='red'; msg.textContent='Please enter at least one load number.'; return; }
  const numbers = raw.split(/[\n,]+/).map(s=>s.trim()).filter(Boolean);
  importedRows = numbers.map((n,i) => ({tempId:i, load_number:n, plant, product, delivery_date:date||'', customer_name:''}));
  msg.style.color='green'; msg.textContent = numbers.length+' load'+(numbers.length!==1?'s':'')+' ready. Review below then save.';
  renderEntryTable();
  document.getElementById('entry-table-wrap').style.display = 'block';
  document.getElementById('entry-table-title').textContent = numbers.length+' loads ready to save';
}

function renderEntryTable() {
  const tbody = document.getElementById('entry-tbody');
  if (!tbody) return;
  if (!importedRows.length) { tbody.innerHTML='<tr><td colspan="7" class="table-empty">No loads.</td></tr>'; return; }
  const custOptions = allCustomers.map(c => `<option value="${c.name}">`).join('');
  tbody.innerHTML = importedRows.map((r,i) => `
    <tr data-entry-idx="${i}">
      <td style="padding:4px 8px;color:#888;font-size:11px;text-align:center">${i+1}</td>
      <td style="padding:4px 6px;position:relative">
        <input class="entry-input" type="text" id="entry-loadnum-${i}" value="${r.load_number}" onchange="updateImportRow(${i},'load_number',this.value)" />
        <div class="drag-handle" title="Drag to fill sequence" onmousedown="startDragFill(event,${i})" ontouchstart="startDragFill(event,${i})">▶</div>
      </td>
      <td style="padding:4px 6px">
        <select class="entry-input" onchange="updateImportRow(${i},'plant',this.value)">
          <option value="">Select plant...</option>
          ${allPlants.map(p => `<option value="${p.name}"${r.plant===p.name?' selected':''}>${p.name}</option>`).join('')}
        </select>
      </td>
      <td style="padding:4px 6px">
        <select class="entry-input" onchange="updateImportRow(${i},'product',this.value)">
          ${PRODUCTS.map(p=>`<option${r.product===p?' selected':''}>${p}</option>`).join('')}
        </select>
      </td>
      <td style="padding:4px 6px"><input class="entry-input" type="date" value="${r.delivery_date}" onchange="updateImportRow(${i},'delivery_date',this.value)" /></td>
      <td style="padding:4px 6px">
        <input class="entry-input" type="text" value="${r.customer_name}" placeholder="Farmer (optional)"
          list="entry-cust-dl-${i}" onchange="updateImportRow(${i},'customer_name',this.value)" />
        <datalist id="entry-cust-dl-${i}">${custOptions}</datalist>
      </td>
      <td style="padding:4px 6px"><button class="del-btn" onclick="removeImportRow(${i})">✕</button></td>
    </tr>`).join('');
}

// ── Drag-to-fill ──────────────────────────────────────
function startDragFill(e, fromIdx) {
  e.preventDefault();
  dragFillStart = fromIdx;
  document.addEventListener('mousemove', onDragFillMove);
  document.addEventListener('mouseup',   onDragFillEnd);
  document.addEventListener('touchmove', onDragFillMove);
  document.addEventListener('touchend',  onDragFillEnd);
}
function onDragFillMove(e) {
  if (dragFillStart===null) return;
  const clientY = e.touches?e.touches[0].clientY:e.clientY;
  document.querySelectorAll('#entry-tbody tr[data-entry-idx]').forEach(tr => {
    const idx = parseInt(tr.dataset.entryIdx);
    const rect = tr.getBoundingClientRect();
    tr.classList.toggle('drag-fill-highlight', idx>=dragFillStart && clientY>=rect.top);
  });
}
function onDragFillEnd(e) {
  if (dragFillStart===null) return;
  document.removeEventListener('mousemove', onDragFillMove);
  document.removeEventListener('mouseup',   onDragFillEnd);
  document.removeEventListener('touchmove', onDragFillMove);
  document.removeEventListener('touchend',  onDragFillEnd);
  const clientY = e.changedTouches?e.changedTouches[0].clientY:e.clientY;
  const rows = document.querySelectorAll('#entry-tbody tr[data-entry-idx]');
  let toIdx = dragFillStart;
  rows.forEach(tr => {
    const idx = parseInt(tr.dataset.entryIdx);
    const rect = tr.getBoundingClientRect();
    if (clientY>=rect.top) toIdx = Math.max(toIdx,idx);
    tr.classList.remove('drag-fill-highlight');
  });
  if (toIdx>dragFillStart) {
    const baseVal = importedRows[dragFillStart].load_number;
    const generated = incrementSequence(baseVal, toIdx-dragFillStart);
    for (let i=dragFillStart+1;i<=toIdx;i++) {
      if (importedRows[i]) importedRows[i].load_number = generated[i-dragFillStart-1];
    }
    renderEntryTable();
  }
  dragFillStart = null;
}
function incrementSequence(base, count) {
  const match = base.match(/^(.*?)(\d+)([^0-9]*)$/);
  if (!match) return Array(count).fill(base);
  const prefix=match[1], numStr=match[2], suffix=match[3];
  const num=parseInt(numStr), pad=numStr.length;
  const results=[];
  for (let i=1;i<=count;i++) results.push(prefix+String(num+i).padStart(pad,'0')+suffix);
  return results;
}

function updateImportRow(i,field,value) { importedRows[i][field]=value; }
function removeImportRow(i) {
  importedRows.splice(i,1);
  renderEntryTable();
  document.getElementById('entry-table-title').textContent = importedRows.length+' loads ready to save';
  if (!importedRows.length) document.getElementById('entry-table-wrap').style.display='none';
}

async function saveAllLoads() {
  const msg = document.getElementById('save-msg');
  const btn = document.getElementById('save-all-btn');
  const invalid = importedRows.filter(r => !r.load_number || !r.delivery_date);
  if (invalid.length) { msg.style.color='red'; msg.textContent='Every load needs a load number and date.'; return; }
  btn.disabled=true; btn.textContent='Saving…';
  try {
    const payload = importedRows.map(r => ({
      load_number: r.load_number, plant: r.plant||null, product: r.product,
      delivery_date: r.delivery_date, customer_name: r.customer_name||null,
      loads_on_date: 1, total_loads: 1, status: 'Scheduled'
    }));
    const result = await sb('order_lines', { method:'POST', body:JSON.stringify(payload) });
    if (result && result.code) throw new Error(result.message||'Save failed');
    for (const r of importedRows) {
      if (r.customer_name && r.product && r.delivery_date)
        await decrementFarmerOrder(r.customer_name, r.product, r.delivery_date);
    }
    msg.style.color='green'; msg.textContent = importedRows.length+' loads saved!';
    importedRows = [];
    renderEntryTable();
    document.getElementById('entry-table-wrap').style.display = 'none';
    document.getElementById('entry-loads').value = '';
    document.getElementById('entry-msg').textContent = '';
    await loadOrderLines();
    applyFilters();
  } catch(e) { msg.style.color='red'; msg.textContent='Error: '+e.message; }
  finally { btn.disabled=false; btn.textContent='Save all to database'; }
}

function clearEntryForm() {
  ['entry-plant','entry-product','entry-date','entry-loads'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value='';
  });
  document.getElementById('entry-msg').textContent='';
  importedRows=[];
  document.getElementById('entry-table-wrap').style.display='none';
}

// ── Farmer Orders tab ─────────────────────────────────
function renderOrdersTable() {
  const tbody   = document.getElementById('orders-tbody');
  const summary = document.getElementById('orders-summary-label');
  if (!tbody) return;

  const fp     = document.getElementById('orders-filter-product')?.value || '';
  const search = (document.getElementById('orders-filter-search')?.value || '').toLowerCase();

  let orders = [...allOrders];
  if (fp)     orders = orders.filter(l => l.product === fp);
  if (search) orders = orders.filter(l => {
    const name = (l.orders?.customers?.name || '').toLowerCase();
    return name.includes(search);
  });

  const totalLoads = orders.reduce((a,l) => a+(l.loads_on_date||1), 0);
  if (summary) summary.textContent = orders.length
    ? `${orders.length} order${orders.length!==1?'s':''} · ${totalLoads} load${totalLoads!==1?'s':''} needed`
    : '';

  if (!orders.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="table-empty">No outstanding farmer orders 🎉</td></tr>';
    return;
  }

  // Group by date
  const grouped = {};
  orders.sort((a,b) => {
    if (a.delivery_date < b.delivery_date) return -1;
    if (a.delivery_date > b.delivery_date) return 1;
    return (a.orders?.customers?.name||'').localeCompare(b.orders?.customers?.name||'');
  }).forEach(l => {
    const d = l.delivery_date || 'none';
    if (!grouped[d]) grouped[d] = [];
    grouped[d].push(l);
  });

  let html = '';
  Object.keys(grouped).sort().forEach(dateStr => {
    const grp = grouped[dateStr];
    const grpLoads = grp.reduce((a,l) => a+(l.loads_on_date||1), 0);
    const d = dateStr !== 'none' ? new Date(dateStr+'T00:00:00') : null;
    const dayName = d ? d.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'}) : 'No date';
    html += `<tr class="date-row"><td colspan="6">${dayName} — ${grpLoads} load${grpLoads!==1?'s':''} needed</td></tr>`;

    grp.forEach(l => {
      const farmer  = l.orders?.customers?.name || '—';
      const loads   = l.loads_on_date || 1;
      const ordered = l.orders?.submitted_at
        ? new Date(l.orders.submitted_at).toLocaleDateString('en-US',{month:'short',day:'numeric'})
        : '';
      const badgeColor = loads > 2 ? '#c5221f' : loads > 0 ? '#856404' : '#137333';
      const badgeBg    = loads > 2 ? '#fce8e6' : loads > 0 ? '#fff3cd' : '#e6f4ea';
      html += `
        <tr>
          <td style="padding:5px 10px">${formatDate(l.delivery_date)}</td>
          <td style="padding:5px 10px;font-weight:600">${farmer}</td>
          <td style="padding:5px 10px">${l.product}</td>
          <td style="padding:5px 10px">
            <span style="background:${badgeBg};color:${badgeColor};font-weight:700;padding:2px 10px;border-radius:12px;font-size:12px">
              ${loads} load${loads!==1?'s':''} needed
            </span>
          </td>
          <td style="padding:5px 10px;font-size:12px;color:#888">${ordered ? 'Ordered '+ordered : ''}</td>
          <td style="padding:5px 10px"><button class="del-btn" onclick="dismissOrder(${l.id})">Dismiss</button></td>
        </tr>`;
    });
  });
  tbody.innerHTML = html;
}

async function dismissOrder(id) {
  if (!confirm('Mark this order as fulfilled?')) return;
  try {
    await sb('order_lines?id=eq.'+id, {
      method: 'PATCH', headers: { 'Prefer': 'return=minimal' },
      body: JSON.stringify({ status: 'Fulfilled' })
    });
    allOrders = allOrders.filter(l => l.id !== id);
    renderOrdersTable();
    renderMetrics();
  } catch(e) { alert('Error dismissing order.'); }
}

// ── Customers ─────────────────────────────────────────
function renderCustomersTable() {
  const tbody = document.getElementById('customers-tbody');
  if (!tbody) return;
  if (!allCustomers.length) { tbody.innerHTML='<tr><td colspan="4" class="table-empty">No customers yet.</td></tr>'; return; }
  const base = window.location.origin + window.location.pathname.replace('admin.html','');
  tbody.innerHTML = allCustomers.map(c => {
    const link = base + 'order.html?id=' + c.id;
    return `
    <tr>
      <td style="padding:7px 10px">${c.name}</td>
      <td style="padding:7px 10px">${c.phone}</td>
      <td style="padding:7px 10px">
        <button class="copy-link-btn toolbar-btn" data-link="${link}" data-name="${c.name}" style="font-size:11px">📋 Copy link</button>
      </td>
      <td style="padding:7px 10px;display:flex;gap:6px">
        <button class="edit-btn" data-cid="${c.id}">Edit</button>
        <button class="del-btn"  data-cid="${c.id}">Remove</button>
      </td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('.edit-btn[data-cid]').forEach(btn => {
    btn.onclick = () => openCustomerEdit(parseInt(btn.dataset.cid));
  });
  tbody.querySelectorAll('.del-btn[data-cid]').forEach(btn => {
    btn.onclick = () => deleteCustomer(parseInt(btn.dataset.cid));
  });
  tbody.querySelectorAll('.copy-link-btn').forEach(btn => {
    btn.onclick = () => {
      navigator.clipboard.writeText(btn.dataset.link).then(() => {
        const orig = btn.textContent;
        btn.textContent = '✓ Copied!';
        btn.style.color = '#137333';
        setTimeout(() => { btn.textContent = orig; btn.style.color = ''; }, 2000);
      }).catch(() => {
        // Fallback for older browsers
        prompt('Copy this link for ' + btn.dataset.name + ':', btn.dataset.link);
      });
    };
  });
}


async function addCustomer() {
  const name  = document.getElementById('new-cust-name').value.trim();
  const phone = document.getElementById('new-cust-phone').value.trim();
  const msg   = document.getElementById('cust-msg');
  if (!name||!phone) { msg.style.color='red'; msg.textContent='Enter both name and phone.'; return; }
  try {
    const result = await sb('customers', { method:'POST', body:JSON.stringify({name,phone}) });
    if (result && result.code) throw new Error(result.message||'Error');
    document.getElementById('new-cust-name').value  = '';
    document.getElementById('new-cust-phone').value = '';
    msg.style.color='green'; msg.textContent = name+' added.';
    await loadCustomers();
    renderCustomersTable();
  } catch(e) { msg.style.color='red'; msg.textContent='Error: '+e.message; }
}

function openCustomerEdit(id) {
  editingCustomerId = id;
  console.log('Opening edit for customer id:', id, 'found:', allCustomers.find(x => x.id===id));
  const c = allCustomers.find(x => x.id===id);
  if (!c) return;
  document.getElementById('ec-name').value  = c.name;
  document.getElementById('ec-phone').value = c.phone;
  document.getElementById('ec-msg').textContent = '';
  document.getElementById('modal-backdrop').style.display = 'block';
  document.getElementById('edit-cust-modal').style.display = 'block';
}

function closeModal() {
  document.getElementById('edit-cust-modal').style.display = 'none';
  if (document.getElementById('paste-date-modal').style.display === 'none') {
    document.getElementById('modal-backdrop').style.display = 'none';
  }
  editingCustomerId = null;
}

async function saveCustomer() {
  const name  = document.getElementById('ec-name').value.trim();
  const phone = document.getElementById('ec-phone').value.trim();
  const msg   = document.getElementById('ec-msg');
  if (!name||!phone) { msg.style.color='red'; msg.textContent='Name and phone required.'; return; }
  try {
    console.log('Saving customer id:', editingCustomerId, {name, phone});
    const res = await fetch(SUPABASE_URL + '/rest/v1/customers?id=eq.' + editingCustomerId, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({name, phone})
    });
    const result = await res.json();
    console.log('Save customer response:', res.status, result);
    if (!res.ok) throw new Error(JSON.stringify(result));
    msg.style.color='green'; msg.textContent='Saved!';
    await loadCustomers();
    renderCustomersTable();
    setTimeout(closeModal, 700);
  } catch(e) { msg.style.color='red'; msg.textContent='Error: '+e.message; console.error('saveCustomer error:', e); }
}

async function deleteCustomer(id) {
  const customer = allCustomers.find(c => c.id === id);
  const name = customer ? customer.name : 'this customer';
  if (!confirm('Remove ' + name + '?')) return;
  try {
    console.log('Deleting customer id:', id);
    const res = await fetch(SUPABASE_URL + '/rest/v1/customers?id=eq.' + id, {
      method: 'DELETE',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      }
    });
    console.log('Delete response status:', res.status);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      console.log('Delete error body:', body);
      // Foreign key violation — customer has order history
      if (body.code === '23503' || (body.message||'').includes('foreign key')) {
        alert(name + ' cannot be removed because they have existing loads or orders in the system.\n\nRemove their loads first, then delete the customer.');
      } else {
        alert('Error removing customer: ' + (body.message || res.status));
      }
      return;
    }
    allCustomers = allCustomers.filter(c => c.id !== id);
    renderCustomersTable();
  } catch(e) { alert('Error removing customer: ' + e.message); }
}


// ── Drag rows to a date header ────────────────────────
function rowDragMousedown(e, lineId) {
  // Don't start drag if clicking to select
  if (!selectedIds.has(lineId)) {
    // Single row drag — don't change selection, just note the dragged id
    dragRowId = lineId;
  } else {
    dragRowId = null; // will use selectedIds
  }
}

function rowDragStart(e, lineId) {
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', lineId);
  // If dragging a row that isn't selected, treat it as a solo drag
  if (!selectedIds.has(lineId)) {
    dragRowId = lineId;
  } else {
    dragRowId = null; // drag all selected
  }
}

function dateDragOver(e, dateStr) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  if (dragOverDate !== dateStr) {
    // Remove highlight from previous
    document.querySelectorAll('tr.date-row.drag-target').forEach(r => r.classList.remove('drag-target'));
    dragOverDate = dateStr;
    const row = document.querySelector(`tr.date-row[data-date="${dateStr}"]`);
    if (row) row.classList.add('drag-target');
  }
}

function dateDragLeave(e) {
  // Only clear if leaving the row entirely (not just a child)
  if (!e.currentTarget.contains(e.relatedTarget)) {
    e.currentTarget.classList.remove('drag-target');
    dragOverDate = null;
  }
}

async function dateDrop(e, dateStr) {
  e.preventDefault();
  document.querySelectorAll('tr.date-row.drag-target').forEach(r => r.classList.remove('drag-target'));
  dragOverDate = null;

  // Which rows are moving?
  let ids;
  const droppedId = parseInt(e.dataTransfer.getData('text/plain'));
  if (dragRowId !== null && !selectedIds.has(droppedId)) {
    ids = [droppedId];
  } else {
    ids = [...selectedIds];
  }
  dragRowId = null;
  if (!ids.length) return;

  await moveRowsToDate(ids, dateStr);
}

// ── Cut (Ctrl+X) + Paste (Ctrl+V) ─────────────────────
function handleKeyboard(e) {
  // Only act when All Loads tab is visible
  const panel = document.getElementById('panel-loads');
  if (!panel || panel.style.display === 'none') return;
  // Don't intercept when typing in an input
  if (['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName)) return;

  if ((e.ctrlKey || e.metaKey) && e.key === 'x') {
    e.preventDefault();
    cutSelectedRows();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
    e.preventDefault();
    if (cutIds.size) openPasteModal();
  }
  if (e.key === 'Escape') {
    if (cutIds.size) { cutIds.clear(); renderSheet(); }
  }
}

function cutSelectedRows() {
  if (!selectedIds.size) return;
  cutIds = new Set(selectedIds);
  renderSheet(); // dims the cut rows
  showToast(`${cutIds.size} row${cutIds.size!==1?'s':''} cut — press Ctrl+V to paste to a new date`);
}

function openPasteModal() {
  const modal = document.getElementById('paste-date-modal');
  const backdrop = document.getElementById('modal-backdrop');
  const input = document.getElementById('paste-date-input');
  // Default to monday of current week
  const { monday } = getWeekRange();
  input.value = monday.toISOString().split('T')[0];
  document.getElementById('paste-modal-msg').textContent = `Move ${cutIds.size} row${cutIds.size!==1?'s':''} to:`;
  modal.style.display = 'block';
  backdrop.style.display = 'block';
  input.focus();
}

function closePasteModal() {
  document.getElementById('paste-date-modal').style.display = 'none';
  if (document.getElementById('edit-cust-modal').style.display === 'none') {
    document.getElementById('modal-backdrop').style.display = 'none';
  }
}

async function confirmPaste() {
  const dateStr = document.getElementById('paste-date-input').value;
  if (!dateStr) return;
  const ids = [...cutIds];
  cutIds.clear();
  closePasteModal();
  await moveRowsToDate(ids, dateStr);
  selectedIds.clear();
  renderSheet();
}

// ── Core: move rows to a new date ─────────────────────
async function moveRowsToDate(ids, newDate) {
  if (!ids.length || !newDate) return;
  const rows = allLines.filter(l => ids.includes(l.id));
  if (!rows.length) return;

  const oldDates = rows.map(r => r.delivery_date);
  const names    = [...new Set(rows.map(r => r.customer_name).filter(Boolean))];
  const products = [...new Set(rows.map(r => r.product).filter(Boolean))];
  const dayLabel = formatDate(newDate);

  try {
    // Patch all rows in parallel
    await Promise.all(ids.map(id =>
      fetch(SUPABASE_URL + '/rest/v1/order_lines?id=eq.' + id, {
        method: 'PATCH',
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify({ delivery_date: newDate })
      })
    ));

    // Update local state
    rows.forEach(r => { r.delivery_date = newDate; });

    applyFilters();
    showToast(`Moved ${ids.length} load${ids.length!==1?'s':''} to ${dayLabel}`);
  } catch(e) {
    alert('Error moving rows: ' + e.message);
  }
}


// ── Row color highlight ───────────────────────────────
const COLOR_OPTIONS = [
  { label: 'None',        color: '' },
  { label: 'Green',       color: '#c6efce' },
  { label: 'Yellow',      color: '#ffeb9c' },
  { label: 'Orange',      color: '#fce4d6' },
  { label: 'Red',         color: '#ffc7ce' },
  { label: 'Blue',        color: '#bdd7ee' },
  { label: 'Purple',      color: '#e2d0f5' },
];

let colorMenuTargetId = null;

function showColorMenu(e, lineId) {
  e.preventDefault();
  e.stopPropagation();
  colorMenuTargetId = lineId;

  // If right-clicking a selected row, menu applies to all selected
  const applyIds = selectedIds.has(lineId) && selectedIds.size > 1
    ? [...selectedIds]
    : [lineId];

  const menu = document.getElementById('color-menu');
  menu.innerHTML = `
    <div style="font-size:11px;color:#888;padding:4px 8px 6px;border-bottom:1px solid #e0e0e0;margin-bottom:4px">
      ${applyIds.length > 1 ? `Color ${applyIds.length} rows` : 'Row color'}
    </div>
    ${COLOR_OPTIONS.map(opt => `
      <div class="color-menu-item" onclick="applyRowColor('${opt.color}',[${applyIds.join(',')}])">
        <span class="color-swatch" style="background:${opt.color||'#fff'};border:1px solid ${opt.color?opt.color:'#ccc'}"></span>
        ${opt.label}
        ${applyIds.every(id => rowColors[id] === opt.color) ? ' ✓' : ''}
      </div>`).join('')}
  `;

  // Position near cursor
  const x = Math.min(e.clientX, window.innerWidth - 160);
  const y = Math.min(e.clientY, window.innerHeight - 220);
  menu.style.left = x + 'px';
  menu.style.top  = y + 'px';
  menu.style.display = 'block';

  // Close on next click anywhere
  setTimeout(() => document.addEventListener('click', hideColorMenu, { once: true }), 10);
}

function showColorMenuForSelected() {
  if (!selectedIds.size) return;
  const ids = [...selectedIds];
  // Show menu centered on screen
  const menu = document.getElementById('color-menu');
  menu.innerHTML = `
    <div style="font-size:11px;color:#888;padding:4px 8px 6px;border-bottom:1px solid #e0e0e0;margin-bottom:4px">
      Color ${ids.length} row${ids.length!==1?'s':''}
    </div>
    ${COLOR_OPTIONS.map(opt => `
      <div class="color-menu-item" onclick="applyRowColor('${opt.color}',[${ids.join(',')}])">
        <span class="color-swatch" style="background:${opt.color||'#fff'};border:1px solid ${opt.color?opt.color:'#ccc'}"></span>
        ${opt.label}
      </div>`).join('')}
  `;
  menu.style.left = '50%';
  menu.style.top  = '40%';
  menu.style.transform = 'translate(-50%,-50%)';
  menu.style.display = 'block';
  setTimeout(() => document.addEventListener('click', hideColorMenu, { once: true }), 10);
}

function hideColorMenu() {
  const menu = document.getElementById('color-menu');
  if (menu) menu.style.display = 'none';
}

function applyRowColor(color, ids) {
  hideColorMenu();
  ids.forEach(id => {
    if (color === '') delete rowColors[id];
    else rowColors[id] = color;
  });
  saveRowColors();
  renderSheet();
}



// ── Add blank row ─────────────────────────────────────
function addBlankRowAndEdit(dateStr, field) {
  addBlankRow(dateStr, field);
}

function addBlankRow(dateStr, focusField) {
  // Create a temporary local row — only saves to Supabase when a cell is committed
  const tempId = 'new_' + Date.now();
  const newLine = {
    id: tempId,
    delivery_date: dateStr,
    product: null,
    load_number: null,
    customer_name: null,
    plant: null,
    hauler: null,
    loads_on_date: 1,
    tons: null,
    markup: null,
    commission: null,
    notes: null,
    status: 'Scheduled',
    _isNew: true   // flag — not yet in Supabase
  };
  allLines.push(newLine);
  applyFilters();
  setTimeout(() => startEdit(tempId, focusField || 'load_number'), 50);
  return tempId;
}

// ── Plants tab ────────────────────────────────────────
function renderPlantsTable() {
  const tbody = document.getElementById('plants-tbody');
  if (!tbody) return;
  if (!allPlants.length) {
    tbody.innerHTML = '<tr><td colspan="2" class="table-empty">No plants yet. Add one below.</td></tr>';
    return;
  }
  tbody.innerHTML = allPlants.map(p => `
    <tr>
      <td style="padding:7px 10px">${p.name}</td>
      <td style="padding:7px 10px">
        <button class="del-btn" data-pid="${p.id}">Remove</button>
      </td>
    </tr>`).join('');
  tbody.querySelectorAll('.del-btn[data-pid]').forEach(btn => {
    btn.onclick = () => deletePlant(parseInt(btn.dataset.pid));
  });
}

async function addPlant() {
  const name = document.getElementById('new-plant-name').value.trim();
  const msg  = document.getElementById('plant-msg');
  if (!name) { msg.style.color='red'; msg.textContent='Enter a plant name.'; return; }
  if (allPlants.find(p => p.name.toLowerCase() === name.toLowerCase())) {
    msg.style.color='red'; msg.textContent=name+' already exists.'; return;
  }
  try {
    const result = await sb('plants', { method:'POST', body:JSON.stringify({name}) });
    if (result && result.code) throw new Error(result.message||'Error');
    document.getElementById('new-plant-name').value = '';
    msg.style.color='green'; msg.textContent = name+' added.';
    await loadPlants();
    renderPlantsTable();
  } catch(e) { msg.style.color='red'; msg.textContent='Error: '+e.message; }
}

async function deletePlant(id) {
  const plant = allPlants.find(p => p.id === id);
  const name = plant ? plant.name : 'this plant';
  if (!confirm('Remove ' + name + '?')) return;
  try {
    const res = await fetch(SUPABASE_URL + '/rest/v1/plants?id=eq.' + id, {
      method: 'DELETE',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY, 'Prefer': 'return=minimal' }
    });
    if (!res.ok) { alert('Error removing plant.'); return; }
    allPlants = allPlants.filter(p => p.id !== id);
    populatePlantDropdowns();
    renderPlantsTable();
  } catch(e) { alert('Error: ' + e.message); }
}

// ── Helpers ───────────────────────────────────────────
function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr+'T00:00:00');
  return d.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});
}

init();

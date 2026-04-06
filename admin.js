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

const COL_MAP = {
  notes:0, delivery_date:1, product:2, load_number:3, customer_name:4,
  plant:5, hauler:6, loads_on_date:7, tons:8, markup:9, commission:10
};
const FIELD_ORDER = ['notes','delivery_date','product','load_number','customer_name','plant','hauler','loads_on_date','tons','markup','commission'];
const FIELD_TYPE = {
  notes:'text', delivery_date:'date', product:'select-product', load_number:'text',
  customer_name:'text', plant:'text', hauler:'text',
  loads_on_date:'number', tons:'decimal', markup:'decimal', commission:'decimal'
};

let allLines = [];
let filteredLines = [];
let allOrders = [];
let allCustomers = [];
let weekOffset = 0;
let activeCell = null;
let editingCustomerId = null;
let importedRows = [];
let dragFillStart = null;

async function init() {
  renderWeekLabel();
  await Promise.all([loadOrderLines(), loadOrders(), loadCustomers()]);
  renderMetrics();
  renderSheet();
}

// ── Data ──────────────────────────────────────────────
async function loadOrderLines() {
  try {
    const lines = await sb('order_lines?select=*,orders(id,customer_id,notes,submitted_at,customers(id,name,phone))&order=delivery_date.asc,load_number.asc');
    // Only show plant loads (have load_number) or unmatched lines — hide fulfilled farmer requests
    allLines = Array.isArray(lines) ? lines.filter(l => l.status !== 'Fulfilled') : [];
    filteredLines = [...allLines];
  } catch(e) { console.error(e); }
}

async function loadOrders() {
  try {
    const lines = await sb('order_lines?select=*,orders(id,customer_id,submitted_at,customers(id,name,phone))&order_id=not.is.null&status=in.(Pending,Scheduled)&order=delivery_date.asc');
    // Filter to only farmer order lines (no load_number)
    allOrders = Array.isArray(lines) ? lines.filter(l => !l.load_number) : [];
  } catch(e) { console.error('loadOrders error:', e); }
}

async function loadCustomers() {
  try {
    const data = await sb('customers?order=name.asc');
    allCustomers = Array.isArray(data) ? data : [];
  } catch(e) { console.error(e); }
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

function prevWeek() { weekOffset--; renderWeekLabel(); applyFilters(); }
function nextWeek() { weekOffset++; renderWeekLabel(); applyFilters(); }
function todayWeek() { weekOffset=0; renderWeekLabel(); applyFilters(); }

// ── Tabs ──────────────────────────────────────────────
function showAdminTab(tab) {
  ['loads','entry','orders','customers'].forEach(t => {
    document.getElementById('panel-'+t).style.display = t===tab?'block':'none';
    document.getElementById('tab-'+t).classList.toggle('active', t===tab);
  });
  if (tab==='orders') renderOrdersTable();
  if (tab==='customers') renderCustomersTable();
}

// ── Filters ───────────────────────────────────────────
function applyFilters() {
  const fp = document.getElementById('filter-product').value;
  const search = document.getElementById('filter-search').value.toLowerCase();
  const { monday, friday } = getWeekRange();
  const ws = monday.toISOString().split('T')[0];
  const we = friday.toISOString().split('T')[0];
  filteredLines = allLines.filter(l => {
    const farmer = l.customer_name||(l.orders&&l.orders.customers?l.orders.customers.name:'');
    const plant = (l.plant||'').toLowerCase();
    const loadnum = (l.load_number||'').toLowerCase();
    const matchSearch = !search||farmer.toLowerCase().includes(search)||plant.includes(search)||loadnum.includes(search);
    return l.delivery_date>=ws && l.delivery_date<=we && (!fp||l.product===fp) && matchSearch;
  });
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
  document.getElementById('metrics').innerHTML = `
    <div class="metric"><div class="metric-label">Total loads this week</div><div class="metric-value">${total}</div></div>
    <div class="metric"><div class="metric-label">Commission this week</div><div class="metric-value" style="color:#3B6D11">$${totalCommission.toFixed(2)}</div></div>
  `;
}

// ── Sheet render ──────────────────────────────────────
function renderSheet() {
  const tbody = document.getElementById('sheet-body');
  if (!tbody) return;
  if (!filteredLines.length) {
    tbody.innerHTML = '<tr><td colspan="12" class="table-empty">No loads found for this week.</td></tr>';
    return;
  }
  const grouped = {};
  filteredLines.forEach(l => {
    if (!grouped[l.delivery_date]) grouped[l.delivery_date] = [];
    grouped[l.delivery_date].push(l);
  });

  let html = '';
  Object.keys(grouped).sort().forEach(dateStr => {
    const d = new Date(dateStr+'T00:00:00');
    const dayName = d.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'});
    const count = grouped[dateStr].length;
    html += `<tr class="date-row"><td colspan="12">${dayName} &mdash; ${count} load${count!==1?'s':''}</td></tr>`;

    grouped[dateStr].forEach(l => {
      const farmer = l.customer_name||(l.orders&&l.orders.customers?l.orders.customers.name:'');
      const hasTrucker = l.hauler&&l.hauler.trim();
      const rowClass = hasTrucker?'row-assigned':'row-unassigned';
      const tons = l.tons!=null ? l.tons : '';
      const markup = l.markup!=null ? l.markup : '';
      const commission = l.commission!=null ? l.commission : '';
      const commClass = commission!=='' ? 'cell-commission' : 'cell-commission empty';
      const noteVal = l.notes||'';

      html += `
        <tr data-id="${l.id}" class="${rowClass}">
          <td><div class="cell-view${!noteVal?' empty':''}" onclick="startEdit(${l.id},'notes')">${noteVal||'note'}</div></td>
          <td><div class="cell-view${!l.delivery_date?' empty':''}" onclick="startEdit(${l.id},'delivery_date')">${formatDate(l.delivery_date)}</div></td>
          <td><div class="cell-view" onclick="startEdit(${l.id},'product')">${l.product||''}</div></td>
          <td><div class="cell-view${!l.load_number?' empty':''}" onclick="startEdit(${l.id},'load_number')">${l.load_number||'add load #'}</div></td>
          <td><div class="cell-view${!farmer?' empty':''}" onclick="startEdit(${l.id},'customer_name')">${farmer||'assign farmer'}</div></td>
          <td><div class="cell-view${!l.plant?' empty':''}" onclick="startEdit(${l.id},'plant')">${l.plant||'add plant'}</div></td>
          <td><div class="cell-view${!hasTrucker?' empty':''}" onclick="startEdit(${l.id},'hauler')" style="${hasTrucker?'color:#854F0B;font-weight:500':''}">${l.hauler||'add trucker'}</div></td>
          <td><div class="cell-view" onclick="startEdit(${l.id},'loads_on_date')">${l.loads_on_date||1}</div></td>
          <td><div class="cell-view${tons===''?' empty':''}" onclick="startEdit(${l.id},'tons')">${tons!==''?tons:'tons'}</div></td>
          <td><div class="cell-view${markup===''?' empty':''}" onclick="startEdit(${l.id},'markup')">${markup!==''?('$'+markup):'markup'}</div></td>
          <td><div class="${commClass}" style="padding:0 8px;height:34px;display:flex;align-items:center;font-size:12px;cursor:pointer" onclick="startEdit(${l.id},'commission')">${commission!==''?('$'+commission):'—'}</div></td>
          <td><button class="del-row-btn" onclick="deleteLine(${l.id})" title="Delete">×</button></td>
        </tr>`;
    });
  });
  tbody.innerHTML = html;
}

// ── Single-click inline editing ───────────────────────
function startEdit(lineId, field) {
  if (activeCell) commitCell(false);
  const tr = document.querySelector(`tr[data-id="${lineId}"]`);
  if (!tr) return;
  const colIdx = COL_MAP[field];
  const td = tr.children[colIdx];
  if (!td) return;
  td.classList.add('cell-active');
  const line = allLines.find(l => l.id===lineId);
  const currentVal = line ? (line[field]!=null ? line[field] : '') : '';
  const type = FIELD_TYPE[field];
  let input;

  if (type==='select-product') {
    input = document.createElement('select');
    input.className = 'cell-input';
    PRODUCTS.forEach(p => { const o=document.createElement('option'); o.textContent=p; if(p===currentVal) o.selected=true; input.appendChild(o); });
  } else {
    input = document.createElement('input');
    input.className = 'cell-input';
    input.type = type==='date'?'date':type==='number'||type==='decimal'?'number':'text';
    if (type==='decimal') input.step='0.01';
    if (type==='number') input.min=1;
    input.value = currentVal;
  }

  input.onblur = () => commitCell(true);
  input.onkeydown = e => {
    if (e.key==='Enter') { e.preventDefault(); commitCell(true); }
    if (e.key==='Tab') { e.preventDefault(); commitCell(true); moveNext(lineId, field); }
    if (e.key==='Escape') { td.classList.remove('cell-active'); renderSheet(); activeCell=null; }
  };

  td.innerHTML=''; td.appendChild(input);
  input.focus();
  if (type!=='select-product'&&type!=='date') input.select();
  activeCell = { td, lineId, field, type, input, oldVal: currentVal };
}

async function commitCell(save) {
  if (!activeCell) return;
  const { td, lineId, field, type, input, oldVal } = activeCell;
  activeCell = null;
  td.classList.remove('cell-active');

  let newVal;
  if (type==='number') newVal = parseInt(input.value)||1;
  else if (type==='decimal') newVal = input.value!=='' ? parseFloat(parseFloat(input.value).toFixed(2)) : null;
  else newVal = input.value.trim();

  const line = allLines.find(l => l.id===lineId);
  if (!line) { renderSheet(); return; }

  const strNew = newVal!=null?String(newVal):'';
  const strOld = oldVal!=null?String(oldVal):'';
  line[field] = newVal;

  if (save && strNew!==strOld) {
    const updatePayload = { [field]: newVal };
    if (field==='hauler' && newVal && !oldVal) updatePayload.status = 'Sent out';

    // Try to decrement farmer order whenever customer_name, product, or delivery_date changes
    // as long as all three are now filled in
    const updatedLine = { ...line, [field]: newVal };
    const farmer = updatedLine.customer_name;
    const product = updatedLine.product;
    const date = updatedLine.delivery_date;
    if ((field==='customer_name' || field==='product' || field==='delivery_date') && farmer && product && date) {
      console.log('Calling decrement:', farmer, product, date);
      decrementFarmerOrder(farmer, product, date);
    }

    try {
      await sb('order_lines?id=eq.'+lineId, {
        method:'PATCH', headers:{'Prefer':'return=minimal'},
        body: JSON.stringify(updatePayload)
      });
    } catch(e) { console.error('Save error:', e); }
  }

  renderMetrics();
  renderSheet();
}

function moveNext(lineId, currentField) {
  const idx = FIELD_ORDER.indexOf(currentField);
  if (idx < FIELD_ORDER.length-1) setTimeout(() => startEdit(lineId, FIELD_ORDER[idx+1]), 30);
}

// ── Decrement farmer order 1 load at a time ───────────
async function decrementFarmerOrder(customerName, product, deliveryDate) {
  if (!customerName||!product||!deliveryDate) return;
  try {
    // Find this customer in allCustomers
    const customer = allCustomers.find(c =>
      c.name.toLowerCase().trim() === customerName.toLowerCase().trim()
    );
    if (!customer) return;

    // Find their pending order line matching product + date
    const match = allOrders.find(l =>
      l.orders &&
      l.orders.customers &&
      l.orders.customers.id === customer.id &&
      l.product === product &&
      l.delivery_date === deliveryDate &&
      (l.status === 'Pending' || l.status === 'Scheduled')
    );

    if (!match) return;

    const remaining = (match.loads_on_date || 1) - 1;

    if (remaining <= 0) {
      // All loads filled — mark as Fulfilled so it disappears
      await sb('order_lines?id=eq.'+match.id, {
        method:'PATCH', headers:{'Prefer':'return=minimal'},
        body: JSON.stringify({ status: 'Fulfilled', loads_on_date: 0 })
      });
    } else {
      // Still has remaining loads — decrement by 1
      await sb('order_lines?id=eq.'+match.id, {
        method:'PATCH', headers:{'Prefer':'return=minimal'},
        body: JSON.stringify({ loads_on_date: remaining })
      });
      // Update local state
      match.loads_on_date = remaining;
    }

    // Reload orders to reflect the change in the Farmer Orders tab
    await loadOrders();
    renderOrdersTable();
  } catch(e) {
    console.error('Decrement error:', e);
  }
}

// ── Delete ────────────────────────────────────────────
async function deleteLine(lineId) {
  if (!confirm('Delete this load?')) return;
  try {
    await sb('order_lines?id=eq.'+lineId, { method:'DELETE', headers:{'Prefer':'return=minimal'} });
    allLines = allLines.filter(l => l.id!==lineId);
    applyFilters();
  } catch(e) { alert('Error deleting.'); }
}

// ── Import loads ──────────────────────────────────────
function generateSequence() {
  const first = document.getElementById('gen-first').value.trim();
  const count = parseInt(document.getElementById('gen-count').value) || 0;
  const msg = document.getElementById('entry-msg');
  if (!first) { msg.style.color='red'; msg.textContent='Enter a starting load number.'; return; }
  if (!count || count < 1) { msg.style.color='red'; msg.textContent='Enter how many loads to generate.'; return; }
  const seq = [first, ...incrementSequence(first, count - 1)];
  document.getElementById('entry-loads').value = seq.join('\n');
  msg.style.color='green'; msg.textContent = seq.length + ' load numbers generated — click Import loads.';
}

function importLoads() {
  const plant = document.getElementById('entry-plant').value.trim();
  const product = document.getElementById('entry-product').value;
  const date = document.getElementById('entry-date').value;
  const raw = document.getElementById('entry-loads').value.trim();
  const msg = document.getElementById('entry-msg');
  if (!product) { msg.style.color='red'; msg.textContent='Please select a product.'; return; }
  if (!raw) { msg.style.color='red'; msg.textContent='Please enter at least one load number.'; return; }
  const numbers = raw.split(/[\n,]+/).map(s=>s.trim()).filter(Boolean);
  importedRows = numbers.map((n,i) => ({tempId:i,load_number:n,plant,product,delivery_date:date||'',customer_name:''}));
  msg.style.color='green'; msg.textContent=numbers.length+' load'+(numbers.length!==1?'s':'')+' ready. Review below then save.';
  renderEntryTable();
  document.getElementById('entry-table-wrap').style.display='block';
  document.getElementById('entry-table-title').textContent=numbers.length+' loads ready to save';
}

function renderEntryTable() {
  const tbody = document.getElementById('entry-tbody');
  if (!tbody) return;
  if (!importedRows.length) { tbody.innerHTML='<tr><td colspan="6" class="table-empty">No loads.</td></tr>'; return; }
  tbody.innerHTML = importedRows.map((r,i) => `
    <tr data-entry-idx="${i}">
      <td style="padding:4px 6px;position:relative">
        <input class="entry-input" type="text" id="entry-loadnum-${i}" value="${r.load_number}" onchange="updateImportRow(${i},'load_number',this.value)" />
        <div class="drag-handle" title="Drag to fill sequence" onmousedown="startDragFill(event,${i})" ontouchstart="startDragFill(event,${i})">&#9656;</div>
      </td>
      <td style="padding:4px 6px"><input class="entry-input" type="text" value="${r.plant}" placeholder="Plant" onchange="updateImportRow(${i},'plant',this.value)" /></td>
      <td style="padding:4px 6px">
        <select class="entry-input" onchange="updateImportRow(${i},'product',this.value)">
          ${PRODUCTS.map(p=>`<option${r.product===p?' selected':''}>${p}</option>`).join('')}
        </select>
      </td>
      <td style="padding:4px 6px"><input class="entry-input" type="date" value="${r.delivery_date}" onchange="updateImportRow(${i},'delivery_date',this.value)" /></td>
      <td style="padding:4px 6px"><input class="entry-input" type="text" value="${r.customer_name}" placeholder="Farmer (optional)" onchange="updateImportRow(${i},'customer_name',this.value)" /></td>
      <td style="padding:4px 6px"><button class="del-btn" onclick="removeImportRow(${i})">✕</button></td>
    </tr>`).join('');
}

// ── Drag-to-fill ──────────────────────────────────────
function startDragFill(e, fromIdx) {
  e.preventDefault();
  dragFillStart = fromIdx;
  document.addEventListener('mousemove', onDragFillMove);
  document.addEventListener('mouseup', onDragFillEnd);
  document.addEventListener('touchmove', onDragFillMove);
  document.addEventListener('touchend', onDragFillEnd);
}

function onDragFillMove(e) {
  if (dragFillStart === null) return;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  const rows = document.querySelectorAll('#entry-tbody tr[data-entry-idx]');
  rows.forEach(tr => tr.classList.remove('drag-fill-highlight'));
  rows.forEach(tr => {
    const idx = parseInt(tr.dataset.entryIdx);
    const rect = tr.getBoundingClientRect();
    if (idx >= dragFillStart && clientY >= rect.top) tr.classList.add('drag-fill-highlight');
  });
}

function onDragFillEnd(e) {
  if (dragFillStart === null) return;
  document.removeEventListener('mousemove', onDragFillMove);
  document.removeEventListener('mouseup', onDragFillEnd);
  document.removeEventListener('touchmove', onDragFillMove);
  document.removeEventListener('touchend', onDragFillEnd);
  const clientY = e.changedTouches ? e.changedTouches[0].clientY : e.clientY;
  const rows = document.querySelectorAll('#entry-tbody tr[data-entry-idx]');
  let toIdx = dragFillStart;
  rows.forEach(tr => {
    const idx = parseInt(tr.dataset.entryIdx);
    const rect = tr.getBoundingClientRect();
    if (clientY >= rect.top) toIdx = Math.max(toIdx, idx);
    tr.classList.remove('drag-fill-highlight');
  });
  if (toIdx > dragFillStart) {
    const baseVal = importedRows[dragFillStart].load_number;
    const generated = incrementSequence(baseVal, toIdx - dragFillStart);
    for (let i = dragFillStart+1; i <= toIdx; i++) {
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
  importedRows.splice(i,1); renderEntryTable();
  document.getElementById('entry-table-title').textContent=importedRows.length+' loads ready to save';
  if (!importedRows.length) document.getElementById('entry-table-wrap').style.display='none';
}

async function saveAllLoads() {
  const msg=document.getElementById('save-msg');
  const btn=document.getElementById('save-all-btn');
  const invalid=importedRows.filter(r=>!r.load_number||!r.delivery_date);
  if (invalid.length) { msg.style.color='red'; msg.textContent='Every load needs a load number and date.'; return; }
  btn.disabled=true; btn.textContent='Saving...';
  try {
    const payload=importedRows.map(r=>({
      load_number:r.load_number, plant:r.plant||null, product:r.product,
      delivery_date:r.delivery_date, customer_name:r.customer_name||null,
      loads_on_date:1, total_loads:1, status:'Scheduled'
    }));
    const result=await sb('order_lines',{method:'POST',body:JSON.stringify(payload)});
    if (result&&result.code) throw new Error(result.message||'Save failed');
    // Decrement farmer orders for any pre-assigned loads
    for (const r of importedRows) {
      if (r.customer_name&&r.product&&r.delivery_date) {
        await decrementFarmerOrder(r.customer_name, r.product, r.delivery_date);
      }
    }
    msg.style.color='green'; msg.textContent=importedRows.length+' loads saved!';
    importedRows=[]; renderEntryTable();
    document.getElementById('entry-table-wrap').style.display='none';
    document.getElementById('entry-loads').value='';
    document.getElementById('entry-msg').textContent='';
    await loadOrderLines(); renderMetrics(); renderSheet();
  } catch(e) { msg.style.color='red'; msg.textContent='Error: '+e.message; }
  finally { btn.disabled=false; btn.textContent='Save all to database'; }
}

function clearEntryForm() {
  document.getElementById('entry-plant').value='';
  document.getElementById('entry-product').value='';
  document.getElementById('entry-date').value='';
  document.getElementById('entry-loads').value='';
  document.getElementById('entry-msg').textContent='';
  importedRows=[];
  document.getElementById('entry-table-wrap').style.display='none';
}

// ── Farmer orders tab ─────────────────────────────────
function renderOrdersTable() {
  const tbody=document.getElementById('orders-tbody');
  if (!tbody) return;

  // Group by customer for a cleaner view
  if (!allOrders.length) {
    tbody.innerHTML='<tr><td colspan="5" class="table-empty">No outstanding farmer orders.</td></tr>';
    return;
  }

  // Sort by date then customer
  const sorted = [...allOrders].sort((a,b) => {
    if (a.delivery_date < b.delivery_date) return -1;
    if (a.delivery_date > b.delivery_date) return 1;
    const aName = a.orders&&a.orders.customers?a.orders.customers.name:'';
    const bName = b.orders&&b.orders.customers?b.orders.customers.name:'';
    return aName.localeCompare(bName);
  });

  tbody.innerHTML = sorted.map(l => {
    const farmer = l.orders&&l.orders.customers ? l.orders.customers.name : '—';
    const loads = l.loads_on_date || 1;
    return `
      <tr>
        <td style="padding:9px 12px">${formatDate(l.delivery_date)}</td>
        <td style="padding:9px 12px;font-weight:500">${farmer}</td>
        <td style="padding:9px 12px">${l.product}</td>
        <td style="padding:9px 12px">${loads} load${loads!==1?'s':''} needed</td>
        <td style="padding:9px 12px">
          <button class="del-btn" onclick="dismissOrder(${l.id})">Dismiss</button>
        </td>
      </tr>`;
  }).join('');
}

async function dismissOrder(id) {
  try {
    await sb('order_lines?id=eq.'+id, {
      method:'PATCH', headers:{'Prefer':'return=minimal'},
      body: JSON.stringify({status:'Fulfilled'})
    });
    allOrders = allOrders.filter(l => l.id!==id);
    renderOrdersTable();
  } catch(e) { alert('Error dismissing order.'); }
}

// ── Customers ─────────────────────────────────────────
function renderCustomersTable() {
  const tbody=document.getElementById('customers-tbody');
  if (!tbody) return;
  if (!allCustomers.length) { tbody.innerHTML='<tr><td colspan="3" class="table-empty">No customers yet.</td></tr>'; return; }
  tbody.innerHTML=allCustomers.map(c=>`
    <tr>
      <td style="padding:9px 12px">${c.name}</td>
      <td style="padding:9px 12px">${c.phone}</td>
      <td style="padding:9px 12px;display:flex;gap:6px">
        <button class="edit-btn" onclick="openCustomerEdit(${c.id})">Edit</button>
        <button class="del-btn" onclick="deleteCustomer(${c.id},'${c.name.replace(/'/g,"\\'")}')">Remove</button>
      </td>
    </tr>`).join('');
}

async function addCustomer() {
  const name=document.getElementById('new-cust-name').value.trim();
  const phone=document.getElementById('new-cust-phone').value.trim();
  const msg=document.getElementById('cust-msg');
  if (!name||!phone) { msg.style.color='red'; msg.textContent='Enter both name and phone.'; return; }
  try {
    const result=await sb('customers',{method:'POST',body:JSON.stringify({name,phone})});
    if (result&&result.code) throw new Error(result.message||'Error');
    document.getElementById('new-cust-name').value='';
    document.getElementById('new-cust-phone').value='';
    msg.style.color='green'; msg.textContent=name+' added.';
    await loadCustomers(); renderCustomersTable();
  } catch(e) { msg.style.color='red'; msg.textContent='Error: '+e.message; }
}

function openCustomerEdit(id) {
  editingCustomerId=id;
  const c=allCustomers.find(x=>x.id===id);
  if (!c) return;
  document.getElementById('ec-name').value=c.name;
  document.getElementById('ec-phone').value=c.phone;
  document.getElementById('ec-msg').textContent='';
  document.getElementById('modal-backdrop').style.display='block';
  document.getElementById('edit-cust-modal').style.display='block';
}

function closeModal() {
  document.getElementById('modal-backdrop').style.display='none';
  document.getElementById('edit-cust-modal').style.display='none';
  editingCustomerId=null;
}

async function saveCustomer() {
  const name=document.getElementById('ec-name').value.trim();
  const phone=document.getElementById('ec-phone').value.trim();
  const msg=document.getElementById('ec-msg');
  if (!name||!phone) { msg.style.color='red'; msg.textContent='Name and phone required.'; return; }
  try {
    await sb('customers?id=eq.'+editingCustomerId,{method:'PATCH',headers:{'Prefer':'return=minimal'},body:JSON.stringify({name,phone})});
    msg.style.color='green'; msg.textContent='Saved!';
    await loadCustomers(); renderCustomersTable();
    setTimeout(closeModal,700);
  } catch(e) { msg.style.color='red'; msg.textContent='Error: '+e.message; }
}

async function deleteCustomer(id,name) {
  if (!confirm('Remove '+name+'?')) return;
  try {
    await sb('customers?id=eq.'+id,{method:'DELETE',headers:{'Prefer':'return=minimal'}});
    await loadCustomers(); renderCustomersTable();
  } catch(e) { alert('Error removing.'); }
}

// ── Helpers ───────────────────────────────────────────
function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d=new Date(dateStr+'T00:00:00');
  return d.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});
}

init();

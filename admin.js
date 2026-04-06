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

const PRODUCTS = ['Wet distillers','Modified distillers','Dry distillers','Loosehulls','Soyhull pellets','Syrup','Corn screenings'];

// field -> column index in the sheet
const COL_MAP = {
  delivery_date:0, product:1, load_number:2, customer_name:3,
  plant:4, hauler:5, loads_on_date:6, tons:7, markup:8, commission:9
};
const FIELD_ORDER = ['delivery_date','product','load_number','customer_name','plant','hauler','loads_on_date','tons','markup','commission'];
const FIELD_TYPE = {
  delivery_date:'date', product:'select-product', load_number:'text',
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
    allLines = Array.isArray(lines) ? lines.filter(l => l.status !== 'Fulfilled') : [];
    filteredLines = [...allLines];
  } catch(e) { console.error(e); }
}

async function loadOrders() {
  try {
    const orders = await sb('orders?select=*,customers(name,phone),order_lines(product,total_loads,delivery_date,loads_on_date,status)&order=submitted_at.desc');
    allOrders = Array.isArray(orders) ? orders : [];
  } catch(e) { console.error(e); }
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
  if (!filteredLines.length) {
    tbody.innerHTML = '<tr><td colspan="11" class="table-empty">No loads found for this week.</td></tr>';
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
    html += `<tr class="date-row"><td colspan="11">${dayName} &mdash; ${count} load${count!==1?'s':''}</td></tr>`;

    grouped[dateStr].forEach(l => {
      const farmer = l.customer_name||(l.orders&&l.orders.customers?l.orders.customers.name:'');
      const hasTrucker = l.hauler&&l.hauler.trim();
      const rowClass = hasTrucker?'row-assigned':'row-unassigned';
      const tons = l.tons!=null ? l.tons : '';
      const markup = l.markup!=null ? l.markup : '';
      const commission = l.commission!=null ? l.commission : '';
      const commClass = commission!=='' ? 'cell-commission' : 'cell-commission empty';

      html += `
        <tr data-id="${l.id}" class="${rowClass}">
          <td><div class="cell-view${!l.delivery_date?' empty':''}" onclick="startEdit(${l.id},'delivery_date')">${formatDate(l.delivery_date)}</div></td>
          <td><div class="cell-view" onclick="startEdit(${l.id},'product')">${l.product||''}</div></td>
          <td><div class="cell-view${!l.load_number?' empty':''}" onclick="startEdit(${l.id},'load_number')">${l.load_number||'add load #'}</div></td>
          <td><div class="cell-view${!farmer?' empty':''}" onclick="startEdit(${l.id},'customer_name')">${farmer||'assign farmer'}</div></td>
          <td><div class="cell-view${!l.plant?' empty':''}" onclick="startEdit(${l.id},'plant')">${l.plant||'add plant'}</div></td>
          <td><div class="cell-view${!hasTrucker?' empty':''}" onclick="startEdit(${l.id},'hauler')" style="${hasTrucker?'color:#854F0B;font-weight:500':''}">${l.hauler||'add trucker'}</div></td>
          <td><div class="cell-view" onclick="startEdit(${l.id},'loads_on_date')">${l.loads_on_date||1}</div></td>
          <td><div class="cell-view${tons===''?' empty':''}" onclick="startEdit(${l.id},'tons')">${tons!==''?tons:'tons'}</div></td>
          <td><div class="cell-view${markup===''?' empty':''}" onclick="startEdit(${l.id},'markup')">${markup!==''?('$'+markup):'markup'}</div></td>
          <td><div class="${commClass}" style="padding:0 8px;height:34px;display:flex;align-items:center;font-size:12px;cursor:text" onclick="startEdit(${l.id},'commission')">${commission!==''?('$'+commission):'—'}</div></td>
          <td><button class="del-row-btn" onclick="deleteLine(${l.id})" title="Delete">×</button></td>
        </tr>`;
    });
  });
  tbody.innerHTML = html;
}

// ── Inline editing ────────────────────────────────────
function startEdit(lineId, field) {
  if (activeCell) commitCell();
  const tr = document.querySelector(`tr[data-id="${lineId}"]`);
  if (!tr) return;
  const colIdx = COL_MAP[field];
  const td = tr.children[colIdx];
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

  input.onblur = () => commitCell();
  input.onkeydown = e => {
    if (e.key==='Enter') { e.preventDefault(); commitCell(); }
    if (e.key==='Tab') { e.preventDefault(); commitCell(); moveNext(lineId, field); }
    if (e.key==='Escape') { td.classList.remove('cell-active'); renderSheet(); activeCell=null; }
  };

  td.innerHTML=''; td.appendChild(input);
  input.focus();
  if (type!=='select-product'&&type!=='date') input.select();
  activeCell = { td, lineId, field, type, input, oldVal: currentVal };
}

async function commitCell() {
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
  if (strNew===strOld) { renderSheet(); return; }

  line[field] = newVal;

  const updatePayload = { [field]: newVal };
  if (field==='hauler' && newVal && !oldVal) updatePayload.status = 'Sent out';
  if (field==='customer_name' && newVal && line.delivery_date && line.product) {
    autoFulfillOrder(newVal, line.product, line.delivery_date);
  }

  try {
    await sb('order_lines?id=eq.'+lineId, {
      method:'PATCH', headers:{'Prefer':'return=minimal'},
      body: JSON.stringify(updatePayload)
    });
  } catch(e) { console.error('Save error:', e); }

  renderMetrics();
  renderSheet();
}

function moveNext(lineId, currentField) {
  const idx = FIELD_ORDER.indexOf(currentField);
  if (idx < FIELD_ORDER.length-1) {
    setTimeout(() => startEdit(lineId, FIELD_ORDER[idx+1]), 30);
  }
}

// ── Auto-fulfill ──────────────────────────────────────
async function autoFulfillOrder(customerName, product, deliveryDate) {
  if (!customerName||!product||!deliveryDate) return;
  try {
    const matchedCustomer = allCustomers.find(c => c.name.toLowerCase().trim()===customerName.toLowerCase().trim());
    if (!matchedCustomer) return;
    const matches = await sb(`order_lines?select=id,order_id,product,delivery_date,status,load_number,orders(customer_id)&product=eq.${encodeURIComponent(product)}&delivery_date=eq.${deliveryDate}&status=neq.Fulfilled`);
    if (!Array.isArray(matches)||!matches.length) return;
    const toFulfill = matches.filter(l => l.orders&&l.orders.customer_id===matchedCustomer.id&&!l.load_number);
    if (!toFulfill.length) return;
    await sb('order_lines?id=eq.'+toFulfill[0].id, { method:'PATCH', headers:{'Prefer':'return=minimal'}, body: JSON.stringify({status:'Fulfilled'}) });
    await loadOrders();
  } catch(e) { console.error('Auto-fulfill error:', e); }
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
  if (!importedRows.length) { tbody.innerHTML='<tr><td colspan="6" class="table-empty">No loads.</td></tr>'; return; }
  tbody.innerHTML = importedRows.map((r,i) => `
    <tr>
      <td style="padding:4px 6px"><input class="entry-input" type="text" value="${r.load_number}" onchange="updateImportRow(${i},'load_number',this.value)" /></td>
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
    const payload=importedRows.map(r=>({load_number:r.load_number,plant:r.plant||null,product:r.product,delivery_date:r.delivery_date,customer_name:r.customer_name||null,loads_on_date:1,total_loads:1,status:'Scheduled'}));
    const result=await sb('order_lines',{method:'POST',body:JSON.stringify(payload)});
    if (result&&result.code) throw new Error(result.message||'Save failed');
    for (const r of importedRows) { if (r.customer_name&&r.product&&r.delivery_date) await autoFulfillOrder(r.customer_name,r.product,r.delivery_date); }
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

// ── Farmer orders ─────────────────────────────────────
function renderOrdersTable() {
  const tbody=document.getElementById('orders-tbody');
  const active=allOrders.filter(o=>(o.order_lines||[]).some(l=>l.status!=='Fulfilled'));
  if (!active.length) { tbody.innerHTML='<tr><td colspan="6" class="table-empty">No outstanding farmer orders.</td></tr>'; return; }
  tbody.innerHTML=active.map(o=>{
    const farmer=o.customers?o.customers.name:'—';
    const lines=(o.order_lines||[]).filter(l=>l.status!=='Fulfilled');
    const products=[...new Set(lines.map(l=>l.product))].join(', ');
    const totalLoads=lines.reduce((a,l)=>a+(l.loads_on_date||0),0);
    const dates=lines.map(l=>l.delivery_date).sort();
    const win=dates.length?(dates[0]===dates[dates.length-1]?formatDate(dates[0]):formatDate(dates[0])+' – '+formatDate(dates[dates.length-1])):'—';
    const submitted=o.submitted_at?new Date(o.submitted_at).toLocaleDateString('en-US',{month:'short',day:'numeric'}):'—';
    return `<tr><td style="padding:9px 12px">${submitted}</td><td style="padding:9px 12px">${farmer}</td><td style="padding:9px 12px">${products||'—'}</td><td style="padding:9px 12px">${totalLoads}</td><td style="padding:9px 12px">${win}</td><td style="padding:9px 12px">${o.notes||'<span style="color:#aaa">—</span>'}</td></tr>`;
  }).join('');
}

// ── Customers ─────────────────────────────────────────
function renderCustomersTable() {
  const tbody=document.getElementById('customers-tbody');
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

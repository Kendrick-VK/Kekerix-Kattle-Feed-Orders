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

let allLines = [];
let filteredLines = [];
let allOrders = [];
let allCustomers = [];
let weekOffset = 0;
let editingLineId = null;
let editingCustomerId = null;
let importedRows = [];

async function init() {
  renderWeekLabel();
  await Promise.all([loadOrderLines(), loadOrders(), loadCustomers()]);
  renderMetrics();
  renderLoadsTable();
}

// ── Data ──────────────────────────────────────────────
async function loadOrderLines() {
  try {
    const lines = await sb('order_lines?select=*,orders(id,customer_id,notes,submitted_at,customers(id,name,phone))&order=delivery_date.asc,load_number.asc');
    allLines = Array.isArray(lines) ? lines : [];
    filteredLines = [...allLines];
  } catch(e) {
    document.getElementById('loads-tbody').innerHTML = '<tr><td colspan="9" class="table-empty">Error loading.</td></tr>';
  }
}

async function loadOrders() {
  try {
    const orders = await sb('orders?select=*,customers(name,phone),order_lines(product,total_loads,delivery_date,loads_on_date)&order=submitted_at.desc');
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
  monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1) + weekOffset * 7);
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  return { monday, friday };
}

function renderWeekLabel() {
  const { monday, friday } = getWeekRange();
  const fmt = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  document.getElementById('week-label').textContent = 'Week of ' + fmt(monday) + ' — ' + fmt(friday);
}

function prevWeek() { weekOffset--; renderWeekLabel(); applyFilters(); }
function nextWeek() { weekOffset++; renderWeekLabel(); applyFilters(); }
function todayWeek() { weekOffset = 0; renderWeekLabel(); applyFilters(); }

// ── Tabs ──────────────────────────────────────────────
function showAdminTab(tab) {
  ['loads','entry','orders','customers'].forEach(t => {
    document.getElementById('panel-' + t).style.display = t === tab ? 'block' : 'none';
    document.getElementById('tab-' + t).classList.toggle('active', t === tab);
  });
  if (tab === 'orders') renderOrdersTable();
  if (tab === 'customers') renderCustomersTable();
}

// ── Filters ───────────────────────────────────────────
function applyFilters() {
  const fp = document.getElementById('filter-product').value;
  const fs = document.getElementById('filter-status').value;
  const search = document.getElementById('filter-search').value.toLowerCase();
  const { monday, friday } = getWeekRange();
  const ws = monday.toISOString().split('T')[0];
  const we = friday.toISOString().split('T')[0];

  filteredLines = allLines.filter(l => {
    const farmer = l.customer_name || (l.orders && l.orders.customers ? l.orders.customers.name : '');
    const plant = (l.plant || '').toLowerCase();
    const loadnum = (l.load_number || '').toLowerCase();
    const matchSearch = !search || farmer.toLowerCase().includes(search) || plant.includes(search) || loadnum.includes(search);
    return (
      l.delivery_date >= ws && l.delivery_date <= we &&
      (!fp || l.product === fp) &&
      (!fs || l.status === fs) &&
      matchSearch
    );
  });

  renderMetrics();
  renderLoadsTable();
}

// ── Metrics ───────────────────────────────────────────
function renderMetrics() {
  const { monday, friday } = getWeekRange();
  const ws = monday.toISOString().split('T')[0];
  const we = friday.toISOString().split('T')[0];
  const week = allLines.filter(l => l.delivery_date >= ws && l.delivery_date <= we);
  const total = week.length;
  const scheduled = week.filter(l => l.status === 'Scheduled').length;
  const sentOut = week.filter(l => l.status === 'Sent out').length;
  const delivered = week.filter(l => l.status === 'Delivered').length;

  document.getElementById('metrics').innerHTML = `
    <div class="metric"><div class="metric-label">Total loads this week</div><div class="metric-value">${total}</div></div>
    <div class="metric"><div class="metric-label">Scheduled</div><div class="metric-value" style="color:#185FA5">${scheduled}</div></div>
    <div class="metric"><div class="metric-label">Sent out</div><div class="metric-value" style="color:#854F0B">${sentOut}</div></div>
    <div class="metric"><div class="metric-label">Delivered</div><div class="metric-value" style="color:#3B6D11">${delivered}</div></div>
  `;
}

// ── All loads table ───────────────────────────────────
function renderLoadsTable() {
  const tbody = document.getElementById('loads-tbody');
  if (!filteredLines.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="table-empty">No loads found for this week.</td></tr>';
    return;
  }
  const grouped = {};
  filteredLines.forEach(l => {
    if (!grouped[l.delivery_date]) grouped[l.delivery_date] = [];
    grouped[l.delivery_date].push(l);
  });
  let html = '';
  Object.keys(grouped).sort().forEach(dateStr => {
    const d = new Date(dateStr + 'T00:00:00');
    const dayName = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    const count = grouped[dateStr].length;
    html += `<tr class="date-header"><td colspan="9">${dayName} &mdash; ${count} load${count !== 1 ? 's' : ''}</td></tr>`;
    grouped[dateStr].forEach(l => {
      const farmer = l.customer_name || (l.orders && l.orders.customers ? l.orders.customers.name : '');
      const statusKey = (l.status || 'scheduled').toLowerCase().replace(' ', '_');
      html += `
        <tr class="row-${statusKey}">
          <td>${formatDate(l.delivery_date)}</td>
          <td>${l.product}</td>
          <td>${l.load_number || '<span style="color:#aaa">—</span>'}</td>
          <td>${farmer || '<span style="color:#854F0B;font-style:italic">unassigned</span>'}</td>
          <td>${l.plant || '<span style="color:#aaa">—</span>'}</td>
          <td>${l.hauler || '<span style="color:#aaa">—</span>'}</td>
          <td>${l.loads_on_date || 1}</td>
          <td><span class="badge badge-${statusKey}">${l.status || 'Scheduled'}</span></td>
          <td><button class="edit-btn" onclick="openEdit(${l.id})">Edit</button></td>
        </tr>`;
    });
  });
  tbody.innerHTML = html;
}

// ── Import loads ──────────────────────────────────────
function importLoads() {
  const plant = document.getElementById('entry-plant').value.trim();
  const product = document.getElementById('entry-product').value;
  const date = document.getElementById('entry-date').value;
  const raw = document.getElementById('entry-loads').value.trim();
  const msg = document.getElementById('entry-msg');

  if (!product) { msg.style.color='red'; msg.textContent='Please select a product.'; return; }
  if (!raw) { msg.style.color='red'; msg.textContent='Please paste or type at least one load number.'; return; }

  const numbers = raw.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
  if (!numbers.length) { msg.style.color='red'; msg.textContent='No load numbers found.'; return; }

  importedRows = numbers.map((n, i) => ({ tempId: i, load_number: n, plant, product, delivery_date: date || '', customer_name: '', status: 'Scheduled', loads_on_date: 1 }));
  msg.style.color='green'; msg.textContent = numbers.length + ' load' + (numbers.length !== 1 ? 's' : '') + ' imported. Review below then save.';
  renderEntryTable();
  document.getElementById('entry-table-wrap').style.display = 'block';
  document.getElementById('entry-table-title').textContent = numbers.length + ' loads ready to save';
}

function renderEntryTable() {
  const tbody = document.getElementById('entry-tbody');
  if (!importedRows.length) { tbody.innerHTML = '<tr><td colspan="6" class="table-empty">No loads.</td></tr>'; return; }
  tbody.innerHTML = importedRows.map((r, i) => `
    <tr>
      <td><input type="text" value="${r.load_number}" onchange="updateImportRow(${i},'load_number',this.value)" style="min-width:130px" /></td>
      <td><input type="text" value="${r.plant}" onchange="updateImportRow(${i},'plant',this.value)" placeholder="Plant" style="min-width:110px" /></td>
      <td>
        <select onchange="updateImportRow(${i},'product',this.value)">
          ${['Wet distillers','Modified distillers','Dry distillers','Loosehulls','Soyhull pellets','Syrup','Corn screenings'].map(p =>
            `<option${r.product===p?' selected':''}>${p}</option>`).join('')}
        </select>
      </td>
      <td><input type="date" value="${r.delivery_date}" onchange="updateImportRow(${i},'delivery_date',this.value)" /></td>
      <td><input type="text" value="${r.customer_name}" onchange="updateImportRow(${i},'customer_name',this.value)" placeholder="Farmer (optional)" style="min-width:130px" /></td>
      <td><button class="del-btn" onclick="removeImportRow(${i})">✕</button></td>
    </tr>`).join('');
}

function updateImportRow(i, field, value) { importedRows[i][field] = value; }

function removeImportRow(i) {
  importedRows.splice(i, 1);
  renderEntryTable();
  document.getElementById('entry-table-title').textContent = importedRows.length + ' loads ready to save';
  if (!importedRows.length) document.getElementById('entry-table-wrap').style.display = 'none';
}

async function saveAllLoads() {
  const msg = document.getElementById('save-msg');
  const btn = document.getElementById('save-all-btn');
  const invalid = importedRows.filter(r => !r.load_number || !r.delivery_date);
  if (invalid.length) { msg.style.color='red'; msg.textContent='Every load needs a load number and date.'; return; }
  btn.disabled=true; btn.textContent='Saving...';
  try {
    const payload = importedRows.map(r => ({
      load_number: r.load_number, plant: r.plant||null, product: r.product,
      delivery_date: r.delivery_date, customer_name: r.customer_name||null,
      loads_on_date: 1, total_loads: 1, status: 'Scheduled'
    }));
    const result = await sb('order_lines', { method:'POST', body: JSON.stringify(payload) });
    if (result && result.code) throw new Error(result.message || 'Save failed');
    msg.style.color='green'; msg.textContent = importedRows.length + ' loads saved!';
    importedRows=[];
    renderEntryTable();
    document.getElementById('entry-table-wrap').style.display='none';
    document.getElementById('entry-loads').value='';
    document.getElementById('entry-msg').textContent='';
    await loadOrderLines(); renderMetrics(); renderLoadsTable();
  } catch(e) {
    msg.style.color='red'; msg.textContent='Error: '+e.message;
  } finally { btn.disabled=false; btn.textContent='Save all to database'; }
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
  const tbody = document.getElementById('orders-tbody');
  if (!allOrders.length) { tbody.innerHTML='<tr><td colspan="6" class="table-empty">No farmer orders yet.</td></tr>'; return; }
  tbody.innerHTML = allOrders.map(o => {
    const farmer = o.customers ? o.customers.name : '—';
    const lines = o.order_lines || [];
    const products = [...new Set(lines.map(l => l.product))].join(', ');
    const totalLoads = lines.reduce((a,l) => a+(l.loads_on_date||0), 0);
    const dates = lines.map(l => l.delivery_date).sort();
    const window = dates.length ? (dates[0]===dates[dates.length-1] ? formatDate(dates[0]) : formatDate(dates[0])+' – '+formatDate(dates[dates.length-1])) : '—';
    const submitted = o.submitted_at ? new Date(o.submitted_at).toLocaleDateString('en-US',{month:'short',day:'numeric'}) : '—';
    return `<tr><td>${submitted}</td><td>${farmer}</td><td>${products||'—'}</td><td>${totalLoads}</td><td>${window}</td><td>${o.notes||'<span style="color:#aaa">—</span>'}</td></tr>`;
  }).join('');
}

// ── Customers ─────────────────────────────────────────
function renderCustomersTable() {
  const tbody = document.getElementById('customers-tbody');
  if (!allCustomers.length) { tbody.innerHTML='<tr><td colspan="3" class="table-empty">No customers yet.</td></tr>'; return; }
  tbody.innerHTML = allCustomers.map(c => `
    <tr>
      <td>${c.name}</td>
      <td>${c.phone}</td>
      <td style="display:flex;gap:6px">
        <button class="edit-btn" onclick="openCustomerEdit(${c.id})">Edit</button>
        <button class="del-btn" onclick="deleteCustomer(${c.id},'${c.name.replace(/'/g,"\\'")}')">Remove</button>
      </td>
    </tr>`).join('');
}

async function addCustomer() {
  const name = document.getElementById('new-cust-name').value.trim();
  const phone = document.getElementById('new-cust-phone').value.trim();
  const msg = document.getElementById('cust-msg');
  if (!name||!phone) { msg.style.color='red'; msg.textContent='Enter both a name and phone number.'; return; }
  try {
    const result = await sb('customers', { method:'POST', body: JSON.stringify({name,phone}) });
    if (result && result.code) throw new Error(result.message||'Error');
    document.getElementById('new-cust-name').value='';
    document.getElementById('new-cust-phone').value='';
    msg.style.color='green'; msg.textContent=name+' added.';
    await loadCustomers(); renderCustomersTable();
  } catch(e) { msg.style.color='red'; msg.textContent='Error: '+e.message; }
}

function openCustomerEdit(id) {
  editingCustomerId = id;
  const c = allCustomers.find(x => x.id===id);
  if (!c) return;
  document.getElementById('ec-name').value = c.name;
  document.getElementById('ec-phone').value = c.phone;
  document.getElementById('ec-msg').textContent='';
  document.getElementById('modal-backdrop').style.display='block';
  document.getElementById('edit-cust-modal').style.display='block';
}

function closeCustomerModal() {
  document.getElementById('modal-backdrop').style.display='none';
  document.getElementById('edit-cust-modal').style.display='none';
  editingCustomerId=null;
}

async function saveCustomer() {
  const name = document.getElementById('ec-name').value.trim();
  const phone = document.getElementById('ec-phone').value.trim();
  const msg = document.getElementById('ec-msg');
  if (!name||!phone) { msg.style.color='red'; msg.textContent='Name and phone are required.'; return; }
  try {
    await sb('customers?id=eq.'+editingCustomerId, {
      method:'PATCH', headers:{'Prefer':'return=minimal'},
      body: JSON.stringify({name,phone})
    });
    msg.style.color='green'; msg.textContent='Saved!';
    await loadCustomers(); renderCustomersTable();
    setTimeout(closeCustomerModal, 700);
  } catch(e) { msg.style.color='red'; msg.textContent='Error: '+e.message; }
}

async function deleteCustomer(id, name) {
  if (!confirm('Remove ' + name + '?')) return;
  try {
    await sb('customers?id=eq.'+id, { method:'DELETE', headers:{'Prefer':'return=minimal'} });
    await loadCustomers(); renderCustomersTable();
  } catch(e) { alert('Error removing customer.'); }
}

// ── Edit load modal ───────────────────────────────────
function openEdit(lineId) {
  editingLineId=lineId;
  const l = allLines.find(x=>x.id===lineId);
  if (!l) return;
  const farmer = l.customer_name||(l.orders&&l.orders.customers?l.orders.customers.name:'');
  document.getElementById('modal-subtitle').textContent=(l.product||'')+(l.delivery_date?' — '+formatDate(l.delivery_date):'');
  document.getElementById('m-loadnum').value=l.load_number||'';
  document.getElementById('m-plant').value=l.plant||'';
  document.getElementById('m-date').value=l.delivery_date||'';
  document.getElementById('m-customer').value=farmer;
  document.getElementById('m-trucker').value=l.hauler||'';
  document.getElementById('m-status').value=l.status||'Scheduled';
  document.getElementById('modal-msg').textContent='';
  document.getElementById('modal-backdrop').style.display='block';
  document.getElementById('edit-modal').style.display='block';
}

function closeModal() {
  document.getElementById('modal-backdrop').style.display='none';
  document.getElementById('edit-modal').style.display='none';
  document.getElementById('edit-cust-modal').style.display='none';
  editingLineId=null;
}

async function saveEdit() {
  const msg=document.getElementById('modal-msg');
  const loadNumber=document.getElementById('m-loadnum').value.trim();
  const plant=document.getElementById('m-plant').value.trim();
  const date=document.getElementById('m-date').value;
  const customer=document.getElementById('m-customer').value.trim();
  const trucker=document.getElementById('m-trucker').value.trim();
  let status=document.getElementById('m-status').value;
  if (trucker && status==='Scheduled') status='Sent out';
  try {
    await sb('order_lines?id=eq.'+editingLineId, {
      method:'PATCH', headers:{'Prefer':'return=minimal'},
      body: JSON.stringify({load_number:loadNumber,plant,delivery_date:date||null,customer_name:customer,hauler:trucker,status})
    });
    const line=allLines.find(l=>l.id===editingLineId);
    if (line) { line.load_number=loadNumber;line.plant=plant;line.delivery_date=date;line.customer_name=customer;line.hauler=trucker;line.status=status; }
    msg.style.color='green'; msg.textContent='Saved!';
    setTimeout(()=>{ closeModal(); applyFilters(); }, 600);
  } catch(e) { msg.style.color='red'; msg.textContent='Error: '+e.message; }
}

// ── Helpers ───────────────────────────────────────────
function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr+'T00:00:00');
  return d.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});
}

init();

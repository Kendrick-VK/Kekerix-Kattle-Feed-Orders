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
let customers = [];
let weekOffset = 0;
let editingLineId = null;

// ── Init ──────────────────────────────────────────────
async function init() {
  await Promise.all([loadCustomers(), loadOrderLines()]);
  renderWeekLabel();
  renderMetrics();
  renderTable();
}

// ── Data ──────────────────────────────────────────────
async function loadCustomers() {
  try {
    const data = await sb('customers?order=name.asc');
    customers = Array.isArray(data) ? data : [];
    const sel = document.getElementById('filter-customer');
    customers.forEach(c => {
      const o = document.createElement('option');
      o.value = c.id; o.textContent = c.name; sel.appendChild(o);
    });
  } catch(e) { console.error(e); }
}

async function loadOrderLines() {
  try {
    const lines = await sb('order_lines?select=*,orders(id,customer_id,notes,submitted_at,customers(id,name,phone))&order=delivery_date.asc');
    allLines = Array.isArray(lines) ? lines : [];
    filteredLines = [...allLines];
  } catch(e) {
    document.getElementById('table-body').innerHTML = '<tr><td colspan="8" class="table-empty">Error loading orders.</td></tr>';
  }
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

// ── Filters ───────────────────────────────────────────
function applyFilters() {
  const fp = document.getElementById('filter-product').value;
  const fs = document.getElementById('filter-status').value;
  const fc = document.getElementById('filter-customer').value;
  const search = document.getElementById('filter-search').value.toLowerCase();
  const { monday, friday } = getWeekRange();
  const weekStart = monday.toISOString().split('T')[0];
  const weekEnd = friday.toISOString().split('T')[0];

  filteredLines = allLines.filter(l => {
    const farmer = l.orders && l.orders.customers ? l.orders.customers.name.toLowerCase() : '';
    const plant = (l.plant || '').toLowerCase();
    const loadnum = (l.load_number || '').toLowerCase();
    const matchSearch = !search || farmer.includes(search) || plant.includes(search) || loadnum.includes(search);
    return (
      l.delivery_date >= weekStart &&
      l.delivery_date <= weekEnd &&
      (!fp || l.product === fp) &&
      (!fs || l.status === fs) &&
      (!fc || (l.orders && l.orders.customer_id == fc)) &&
      matchSearch
    );
  });

  renderMetrics();
  renderTable();
}

// ── Metrics ───────────────────────────────────────────
function renderMetrics() {
  const { monday, friday } = getWeekRange();
  const ws = monday.toISOString().split('T')[0];
  const we = friday.toISOString().split('T')[0];
  const week = allLines.filter(l => l.delivery_date >= ws && l.delivery_date <= we);
  const total = week.reduce((a,l) => a + l.loads_on_date, 0);
  const scheduled = week.filter(l => l.status === 'Scheduled').reduce((a,l) => a + l.loads_on_date, 0);
  const sentOut = week.filter(l => l.status === 'Sent out').reduce((a,l) => a + l.loads_on_date, 0);
  const delivered = week.filter(l => l.status === 'Delivered').reduce((a,l) => a + l.loads_on_date, 0);

  document.getElementById('metrics').innerHTML = `
    <div class="metric"><div class="metric-label">Total loads this week</div><div class="metric-value">${total}</div></div>
    <div class="metric"><div class="metric-label">Scheduled</div><div class="metric-value" style="color:#185FA5">${scheduled}</div></div>
    <div class="metric"><div class="metric-label">Sent out</div><div class="metric-value" style="color:#854F0B">${sentOut}</div></div>
    <div class="metric"><div class="metric-label">Delivered</div><div class="metric-value" style="color:#3B6D11">${delivered}</div></div>
  `;
}

// ── Table ─────────────────────────────────────────────
function renderTable() {
  const tbody = document.getElementById('table-body');
  if (!filteredLines.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="table-empty">No loads found for this week.</td></tr>';
    return;
  }

  // Group by date
  const grouped = {};
  filteredLines.forEach(l => {
    if (!grouped[l.delivery_date]) grouped[l.delivery_date] = [];
    grouped[l.delivery_date].push(l);
  });

  let html = '';
  Object.keys(grouped).sort().forEach(dateStr => {
    const d = new Date(dateStr + 'T00:00:00');
    const dayName = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    const dayLoads = grouped[dateStr].reduce((a,l) => a + l.loads_on_date, 0);

    // Date header row
    html += `<tr class="date-header"><td colspan="8">${dayName} &mdash; ${dayLoads} load${dayLoads !== 1 ? 's' : ''}</td></tr>`;

    grouped[dateStr].forEach(l => {
      const farmer = l.orders && l.orders.customers ? l.orders.customers.name : '—';
      const statusKey = (l.status || 'scheduled').toLowerCase().replace(' ', '_');
      const loadNum = l.load_number || '<span class="cell-muted">—</span>';
      const plant = l.plant || '<span class="cell-muted">—</span>';
      const trucker = l.hauler || '<span class="cell-muted">—</span>';

      html += `
        <tr class="row-${statusKey}">
          <td>${l.product}</td>
          <td>${loadNum}</td>
          <td>${farmer}</td>
          <td>${plant}</td>
          <td>${trucker}</td>
          <td>${l.loads_on_date}</td>
          <td><span class="badge badge-${statusKey}">${l.status || 'Scheduled'}</span></td>
          <td><button class="edit-btn" onclick="openEdit(${l.id})">Edit</button></td>
        </tr>`;
    });
  });

  tbody.innerHTML = html;
}

// ── Edit modal ────────────────────────────────────────
function openEdit(lineId) {
  editingLineId = lineId;
  const l = allLines.find(x => x.id === lineId);
  if (!l) return;
  const farmer = l.orders && l.orders.customers ? l.orders.customers.name : '';
  document.getElementById('modal-subtitle').textContent = farmer + ' — ' + l.product + ' — ' + l.delivery_date;
  document.getElementById('m-loadnum').value = l.load_number || '';
  document.getElementById('m-plant').value = l.plant || '';
  document.getElementById('m-status').value = l.status || 'Scheduled';
  document.getElementById('modal-msg').textContent = '';

  const sel = document.getElementById('m-trucker-select');
  const custom = document.getElementById('m-trucker-custom');
  const knownTruckers = ['Midwest Hauling','Big Sioux Transport','Prairie Freight','Dakota Feed Haulers'];
  if (l.hauler && knownTruckers.includes(l.hauler)) {
    sel.value = l.hauler; custom.style.display = 'none';
  } else if (l.hauler) {
    sel.value = 'Other (type below)'; custom.style.display = 'block'; custom.value = l.hauler;
  } else {
    sel.value = ''; custom.style.display = 'none'; custom.value = '';
  }

  document.getElementById('modal-backdrop').style.display = 'block';
  document.getElementById('edit-modal').style.display = 'block';
}

function truckerSelectChange() {
  const sel = document.getElementById('m-trucker-select').value;
  document.getElementById('m-trucker-custom').style.display = sel === 'Other (type below)' ? 'block' : 'none';
}

function closeModal() {
  document.getElementById('modal-backdrop').style.display = 'none';
  document.getElementById('edit-modal').style.display = 'none';
  editingLineId = null;
}

async function saveEdit() {
  const msg = document.getElementById('modal-msg');
  const loadNumber = document.getElementById('m-loadnum').value.trim();
  const plant = document.getElementById('m-plant').value.trim();
  const status = document.getElementById('m-status').value;
  const truckerSel = document.getElementById('m-trucker-select').value;
  const truckerCustom = document.getElementById('m-trucker-custom').value.trim();
  const hauler = truckerSel === 'Other (type below)' ? truckerCustom : truckerSel;

  try {
    await sb('order_lines?id=eq.' + editingLineId, {
      method: 'PATCH',
      headers: { 'Prefer': 'return=minimal' },
      body: JSON.stringify({ load_number: loadNumber, plant, hauler, status })
    });
    const line = allLines.find(l => l.id === editingLineId);
    if (line) { line.load_number = loadNumber; line.plant = plant; line.hauler = hauler; line.status = status; }
    msg.style.color = 'green'; msg.textContent = 'Saved!';
    setTimeout(() => { closeModal(); applyFilters(); }, 800);
  } catch(e) {
    msg.style.color = 'red'; msg.textContent = 'Error saving: ' + e.message;
  }
}

init();

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
 
const PRODUCTS = [
  "Wet distillers", "Modified distillers", "Dry distillers",
  "Loosehulls", "Soyhull pellets", "Syrup", "Corn screenings"
];
 
let customers = [];
let selectedProducts = [];
let productLoads = {};
let productTotals = {};
 
// ── Init ──────────────────────────────────────────────
async function init() {
  await loadCustomers();
}
 
async function loadCustomers() {
  try {
    const data = await sb('customers?order=name.asc');
    customers = Array.isArray(data) ? data : [];
    populateCustomerDropdown();
  } catch (e) {
    document.getElementById('f-customer').innerHTML = '<option value="">Error loading customers</option>';
  }
}
 
function populateCustomerDropdown() {
  const sel = document.getElementById('f-customer');
  sel.innerHTML = '<option value="">Select your name...</option>';
  customers.forEach(c => {
    const o = document.createElement('option');
    o.value = c.id;
    o.textContent = c.name;
    sel.appendChild(o);
  });
}
 
function customerSelected() {
  const id = parseInt(document.getElementById('f-customer').value);
  const c = customers.find(x => x.id === id);
  document.getElementById('f-phone').value = c ? c.phone : '';
}
 
// ── Tabs ──────────────────────────────────────────────
function showTab(id) {
  document.querySelectorAll('.tab').forEach((t, i) =>
    t.classList.toggle('active', ['farmer-form', 'admin-customers'][i] === id));
  document.querySelectorAll('.page').forEach(p =>
    p.classList.toggle('active', p.id === id));
  if (id === 'admin-customers') renderCustomerList();
}
 
// ── Steps ─────────────────────────────────────────────
function goStep(n) {
  if (n === 2) {
    if (!document.getElementById('f-customer').value) { alert('Please select your name first.'); return; }
    buildProductChips();
  }
  if (n === 3) {
    if (!selectedProducts.length) { alert('Please select at least one product.'); return; }
    buildProductBlocks();
  }
  [1, 2, 3].forEach(i => {
    document.getElementById('step' + i).style.display = i === n ? 'block' : 'none';
    document.getElementById('step' + i + '-ind').className =
      'step' + (i === n ? ' active' : i < n ? ' done' : '');
  });
}
 
// ── Product chips ─────────────────────────────────────
function buildProductChips() {
  const el = document.getElementById('product-chips');
  el.innerHTML = '';
  PRODUCTS.forEach(p => {
    const chip = document.createElement('div');
    chip.className = 'product-chip' + (selectedProducts.includes(p) ? ' selected' : '');
    chip.textContent = p;
    chip.onclick = () => {
      if (selectedProducts.includes(p)) {
        selectedProducts = selectedProducts.filter(x => x !== p);
        delete productLoads[p];
        delete productTotals[p];
      } else {
        selectedProducts.push(p);
      }
      chip.classList.toggle('selected', selectedProducts.includes(p));
    };
    el.appendChild(chip);
  });
}
 
// ── Weekdays ──────────────────────────────────────────
function getWeekdays() {
  const days = [];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dow = today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1));
  for (let w = 0; w < 2; w++)
    for (let d = 0; d < 5; d++) {
      const date = new Date(monday);
      date.setDate(monday.getDate() + w * 7 + d);
      days.push({ date, week: w });
    }
  return days;
}
 
// ── Product blocks ────────────────────────────────────
function buildProductBlocks() {
  const el = document.getElementById('product-blocks');
  el.innerHTML = '';
  selectedProducts.forEach(p => {
    if (!productLoads[p]) productLoads[p] = {};
    if (!productTotals[p]) productTotals[p] = '';
    const sid = p.replace(/[^a-zA-Z0-9]/g, '_');
    const block = document.createElement('div');
    block.className = 'product-block';
    block.innerHTML = `
      <div class="product-block-title">${p}</div>
      <div class="total-row">
        <label>Total loads needed:</label>
        <input type="number" min="1" id="total_${sid}" value="${productTotals[p] || ''}" placeholder="0" oninput="totalChanged('${p}','${sid}')" />
        <div class="tally" id="tally_${sid}">0 of 0 assigned</div>
      </div>
      <div style="font-size:12px;color:#666;margin-bottom:8px">Spread your loads across the days below — they must add up to your total.</div>
      <div class="day-grid" id="daygrid_${sid}"></div>`;
    el.appendChild(block);
    buildDayGrid(sid, p);
    updateTally(p, sid);
  });
}
 
function totalChanged(productName, sid) {
  productTotals[productName] = parseInt(document.getElementById('total_' + sid).value) || 0;
  updateTally(productName, sid);
}
 
function buildDayGrid(sid, productName) {
  const grid = document.getElementById('daygrid_' + sid);
  grid.innerHTML = '';
  const days = getWeekdays();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  days.forEach((item, i) => {
    if (i === 0 || i === 5) {
      const lbl = document.createElement('div');
      lbl.className = 'week-label';
      lbl.textContent = i === 0 ? 'This week' : 'Next week';
      grid.appendChild(lbl);
    }
    const ts = item.date.getTime();
    const isPast = item.date < today;
    const loads = productLoads[productName][ts] || 0;
    const wd = item.date.toLocaleDateString('en-US', { weekday: 'short' });
    const mo = item.date.toLocaleDateString('en-US', { month: 'short' });
    const dy = item.date.getDate();
    const card = document.createElement('div');
    card.className = 'day-card' + (isPast ? ' disabled' : loads > 0 ? ' active' : '');
    card.id = `daycard_${sid}_${ts}`;
    card.innerHTML = `
      <div class="day-name">${wd}</div>
      <div class="day-date">${mo} ${dy}</div>
      <div class="counter">
        <button class="counter-btn" onclick="changeLoad('${productName}','${sid}',${ts},-1)" ${isPast ? 'disabled' : ''}>−</button>
        <span class="counter-val" id="val_${sid}_${ts}">${loads}</span>
        <button class="counter-btn" onclick="changeLoad('${productName}','${sid}',${ts},1)" ${isPast ? 'disabled' : ''}>+</button>
      </div>`;
    grid.appendChild(card);
  });
}
 
function changeLoad(productName, sid, ts, delta) {
  if (!productLoads[productName]) productLoads[productName] = {};
  const cur = productLoads[productName][ts] || 0;
  const next = Math.max(0, cur + delta);
  productLoads[productName][ts] = next;
  const valEl = document.getElementById('val_' + sid + '_' + ts);
  const cardEl = document.getElementById('daycard_' + sid + '_' + ts);
  if (valEl) valEl.textContent = next;
  if (cardEl) cardEl.classList.toggle('active', next > 0);
  updateTally(productName, sid);
}
 
function updateTally(productName, sid) {
  const loads = productLoads[productName] || {};
  const assigned = Object.values(loads).reduce((a, b) => a + b, 0);
  const total = parseInt(productTotals[productName]) || 0;
  const el = document.getElementById('tally_' + sid);
  if (!el) return;
  el.textContent = assigned + ' of ' + (total || '?') + ' assigned';
  el.className = 'tally';
  if (total > 0) {
    if (assigned === total) el.classList.add('match');
    else if (assigned > total) el.classList.add('over');
    else el.classList.add('under');
  }
}
 
function getTotalAssigned(productName) {
  return Object.values(productLoads[productName] || {}).reduce((a, b) => a + b, 0);
}
 
// ── Submit order ──────────────────────────────────────
async function submitOrder() {
  const msg = document.getElementById('form-msg');
  const btn = document.getElementById('submit-btn');
  let errors = [];
  selectedProducts.forEach(p => {
    const total = parseInt(productTotals[p]) || 0;
    const assigned = getTotalAssigned(p);
    if (total === 0) errors.push(`Enter a total load count for ${p}.`);
    else if (assigned !== total) errors.push(`${p}: ${assigned} of ${total} loads assigned — adjust your days to match.`);
  });
  if (errors.length) { msg.style.color = 'red'; msg.textContent = errors[0]; return; }
 
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Submitting...';
  msg.textContent = '';
 
  try {
    const custId = parseInt(document.getElementById('f-customer').value);
    const notes = document.getElementById('f-notes').value.trim();
    const orderRes = await sb('orders', {
      method: 'POST',
      body: JSON.stringify({ customer_id: custId, notes, status: 'Pending' })
    });
    const order = Array.isArray(orderRes) ? orderRes[0] : orderRes;
    if (!order || !order.id) throw new Error('Failed to create order');
 
    const lines = [];
    selectedProducts.forEach(p => {
      const total = parseInt(productTotals[p]);
      Object.entries(productLoads[p]).forEach(([ts, loads]) => {
        if (loads > 0) {
          const d = new Date(parseInt(ts));
          const dateStr = d.toISOString().split('T')[0];
          lines.push({ order_id: order.id, product: p, total_loads: total, delivery_date: dateStr, loads_on_date: loads, status: 'Pending' });
        }
      });
    });
    await sb('order_lines', { method: 'POST', body: JSON.stringify(lines) });
 
    msg.style.color = 'green';
    msg.textContent = 'Order submitted successfully!';
    selectedProducts = []; productLoads = {}; productTotals = {};
    document.getElementById('f-customer').value = '';
    document.getElementById('f-phone').value = '';
    document.getElementById('f-notes').value = '';
    setTimeout(() => { goStep(1); msg.textContent = ''; }, 2000);
  } catch (e) {
    msg.style.color = 'red';
    msg.textContent = 'Error submitting order: ' + e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Submit order';
  }
}
 
// ── Customer management ───────────────────────────────
async function renderCustomerList() {
  const el = document.getElementById('cust-list');
  el.innerHTML = '<span class="spinner"></span> Loading...';
  await loadCustomers();
  if (!customers.length) {
    el.innerHTML = '<p style="font-size:13px;color:#666">No customers yet. Add one below.</p>';
    return;
  }
  el.innerHTML = customers.map(c => `
    <div class="cust-row">
      <div class="cust-name">${c.name}</div>
      <div class="cust-phone">${c.phone}</div>
      <button class="btn-danger" onclick="removeCustomer(${c.id})">Remove</button>
    </div>`).join('');
}
 
async function addCustomer() {
  const name = document.getElementById('new-cust-name').value.trim();
  const phone = document.getElementById('new-cust-phone').value.trim();
  const msg = document.getElementById('cust-msg');
  if (!name || !phone) { msg.style.color = 'red'; msg.textContent = 'Enter both a name and phone number.'; return; }
  try {
    const result = await sb('customers', { method: 'POST', body: JSON.stringify({ name, phone }) });
    if (result && result.code) throw new Error(result.message || 'Unknown error');
    document.getElementById('new-cust-name').value = '';
    document.getElementById('new-cust-phone').value = '';
    msg.style.color = 'green'; msg.textContent = name + ' added.';
    renderCustomerList();
  } catch (e) {
    msg.style.color = 'red'; msg.textContent = 'Error: ' + e.message;
  }
}
 
async function removeCustomer(id) {
  if (!confirm('Remove this customer?')) return;
  try {
    await sb('customers?id=eq.' + id, { method: 'DELETE', headers: { 'Prefer': 'return=minimal' } });
    renderCustomerList();
  } catch (e) { alert('Error removing customer.'); }
}
 
init();

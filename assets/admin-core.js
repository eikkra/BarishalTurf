// Dashboard shell: state, auth, routing, modals and actions. Renders pages from admin-pages.js (PAGES).
// Talks to Code.gs admin actions: login, data, saveBooking, setStatus, addPayment, saveExpense, saveBlock, remove, savePricing, saveSettings, changePassword.

const A = {
  token: localStorage.getItem('turf_token'), d: null, view: [], limit: 100, byId: {}, custs: [],
  f: { q: '', status: '', from: '', to: '', cq: '', ptab: 'dues', month: '', period: 'month', day: '' },
};
const NAV = [['overview', 'Overview', 'view-dashboard-outline'], ['bookings', 'Bookings', 'calendar-check-outline'], ['schedule', 'Schedule', 'calendar-clock'],
  ['customers', 'Customers', 'account-group-outline'], ['payments', 'Payments', 'cash-multiple'], ['expenses', 'Expenses', 'receipt-text-outline'],
  ['reports', 'Reports', 'chart-box-outline'], ['pricing', 'Prices & offer', 'tag-outline'], ['settings', 'Settings', 'cog-outline']];
const page = () => (NAV.some(n => n[0] === location.hash.slice(1)) ? location.hash.slice(1) : 'overview');

/* ───── Data ───── */

async function call(action, payload = {}) {
  try { return await api(action, { ...payload, token: A.token }); } catch (e) {
    if (e.message === 'AUTH') { logout(); throw new Error('Your session ended. Sign in again.'); }
    throw e;
  }
}

const CACHE = 'bta_admin_v2';

async function refresh() {
  A.d = await call('data');
  try { localStorage.setItem(CACHE, JSON.stringify(A.d)); } catch {} // next visit opens instantly
  derive();
  showApp();
  render();
}

/** Adds due/payment state to bookings and builds the customer list. */
function derive() {
  A.byId = {};
  A.byDate = {}; // bookings that occupy the pitch, per day (calendar, schedule, week strip)
  const cust = {};
  A.d.bookings.forEach(b => {
    const active = b.status !== 'Cancelled';
    b.due = active ? Math.max(0, b.total - b.paid) : 0;
    b.pay = !active ? '' : b.paid >= b.total ? 'Paid' : b.paid > 0 ? 'Partial' : 'Unpaid';
    A.byId[b.id] = b;
    if (b.held) (A.byDate[b.date] ||= []).push(b);
    const c = cust[b.phone] ||= { phone: b.phone, name: b.name, count: 0, spent: 0, due: 0, last: '' };
    if (b.date >= c.last) { c.last = b.date; c.name = b.name; }
    c.count += active ? 1 : 0; c.spent += b.paid; c.due += b.due;
  });
  A.custs = Object.values(cust).sort((a, b) => b.spent - a.spent);
}

/* ───── Shell ───── */

function showApp() {
  $('#login').hidden = true;
  $('#app').hidden = false;
  $('#arenaName').textContent = A.d.settings.name;
  const logo = A.d.settings.logoUrl ? imgSrc(A.d.settings.logoUrl) : '../assets/logo.webp';
  $$('[data-logo]').forEach(img => {
    img.onerror = () => { img.onerror = null; img.src = '../assets/logo.webp'; }; // broken custom link → built-in logo
    if (img.getAttribute('src') !== logo) img.src = logo;
  });
  $('#barDate').textContent = fmtDate(A.d.today, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function render() {
  if (!A.d) return;
  const p = page(), pending = A.d.bookings.filter(b => b.status === 'Pending' && b.source === 'web' && b.held).length;
  $('#sideNav').innerHTML = NAV.map(([k, label, ic]) => `<a href="#${k}" class="${k === p ? 'on' : ''}" ${k === p ? 'aria-current="page"' : ''}>${icon(ic)}${label}
    ${k === 'overview' && pending ? `<span class="badge" title="New website requests">${pending}</span>` : ''}</a>`).join('');
  $('#pageTitle').textContent = NAV.find(n => n[0] === p)[1];
  document.title = `${NAV.find(n => n[0] === p)[1]} | ${A.d.settings.name}`;
  $('#main').innerHTML = PAGES[p]();
}

function logout() {
  localStorage.removeItem('turf_token');
  localStorage.removeItem(CACHE);
  A.token = null; A.d = null;
  $('#app').hidden = true;
  $('#login').hidden = false;
}

/* ───── Modals ───── */

/** Opens a form modal; onSave(values, dialog) runs the API call. */
function formModal(title, body, onSave, saveLabel = 'Save') {
  const dlg = openModal(`<h2>${title}</h2><form novalidate>${body}<div class="modal-actions"><button type="button" class="btn" data-close>Close</button>
    <button class="btn btn-turf">${icon('content-save')}${saveLabel}</button></div></form>`);
  const form = $('form', dlg);
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    await busy(e.submitter || $('.btn-turf', form), async () => {
      try { await onSave(Object.fromEntries(new FormData(form)), dlg); dlg.close(); await refresh(); } catch (err) { toast(err.message, 'error'); }
    });
  });
  return dlg;
}

const options = (list, sel, label = x => x) => list.map(x => `<option value="${x}" ${String(x) === String(sel) ? 'selected' : ''}>${label(x)}</option>`).join('');
const hoursOf = s => Array.from({ length: s.closeHour - s.openHour }, (_, i) => s.openHour + i);

function bookingModal(b, pre = {}) {
  const s = A.d.settings, v = b ? { ...b, start: b.hrs[0] } : { name: '', phone: '', note: '', status: 'Confirmed', hours: 1, date: pre.date || A.d.today, start: pre.start ?? s.openHour };
  const split = b && b.hrs.length > 1 && toRuns(b.hrs).length > 1;
  const dlg = formModal(b ? `Edit ${esc(b.id)}` : 'New booking', `
    <div class="grid-2"><label class="field">Name or team<input class="input" name="name" required minlength="2" value="${esc(v.name)}"></label>
      <label class="field">Mobile<input class="input" name="phone" required inputmode="numeric" placeholder="01XXXXXXXXX" value="${esc(v.phone)}"></label></div>
    <div class="grid-3"><label class="field">Date<input class="input" type="date" name="date" required value="${v.date}"></label>
      <label class="field">Start<select class="input" name="start">${options(hoursOf(s), v.start, hourLabel)}</select></label>
      <label class="field">Hours<select class="input" name="hours">${options(hoursOf(s).map((_, i) => i + 1), v.hours)}</select></label></div>
    <div class="grid-2"><label class="field">Status<select class="input" name="status">${options(A.d.statuses, v.status)}</select></label>
      <label class="field"><span>Total (৳) <small>${b ? 'changing the time resets it unless you edit it' : 'blank = standard price'}</small></span>
      <input class="input" type="number" min="0" name="total" value="${b ? b.total : ''}"></label></div>
    ${b ? '' : `<div class="grid-3"><label class="field">Advance received (৳)<input class="input" type="number" min="0" name="advance" placeholder="0"></label>
      <label class="field">Method<select class="input" name="method">${options(A.d.methods.filter(m => m !== 'Refund'), 'Cash')}</select></label>
      <label class="field">Reference<input class="input" name="ref" placeholder="TrxID"></label></div>`}
    ${split ? `<p class="meta">This booking has separate hours (${bTime(b)}). They stay as they are unless you change the date, start or hours.</p>` : ''}
    <label class="field">Note<input class="input" name="note" maxlength="200" value="${esc(v.note)}"></label>`,
  async (f, d) => {
    if (b && !$('[name=total]', d).dataset.dirty) delete f.total; // let the server re-price unless the total was edited
    const keepTime = b && !['date', 'start', 'hours'].some(n => $(`[name=${n}]`, d).dataset.dirty) ? 1 : undefined;
    const id = await call('saveBooking', { ...f, id: b?.id, keepTime });
    toast(b ? 'Booking saved' : `Booking ${id} created`);
  }, b ? 'Save changes' : 'Create booking');
  ['total', 'date', 'start', 'hours'].forEach(n => $(`[name=${n}]`, dlg).addEventListener('input', e => { e.target.dataset.dirty = '1'; }));
}

/** Everything about one booking: who, when, money, every payment, and the actions. */
function detailModal(b) {
  const pays = A.d.payments.filter(p => p.bookingId === b.id).sort((x, y) => String(x.date).localeCompare(y.date));
  openModal(`<h2>${esc(b.id)}</h2><div class="det-chips">${chip(b.status)}${b.trxId && !b.paid ? chip('Check') : chip(b.pay)}</div>
    <dl class="det">
      <div><dt>Customer</dt><dd><b>${esc(b.name)}</b><br>${esc(b.phone)}</dd></div>
      <div><dt>Day & time</dt><dd>${fmtDate(b.date, { weekday: 'long', day: 'numeric', month: 'long' })}<br>${bTime(b)} (${b.hours} h)</dd></div>
      <div><dt>Booked from</dt><dd>${b.source === 'web' ? 'Website' : 'Counter'}<br><small>${esc(b.createdAt)}</small></dd></div>
      ${b.note ? `<div><dt>Note</dt><dd>${esc(b.note)}</dd></div>` : ''}
      ${b.trxId ? `<div><dt>Online payment</dt><dd>${esc(b.payMethod)} ${taka(b.payClaim)}<br>TrxID <b class="trx-id">${esc(b.trxId)}</b><br><small>${b.paid ? 'Checked and recorded' : 'Check this TrxID in your ' + esc(b.payMethod) + ' app, then Verify & confirm'}</small></dd></div>` : ''}
    </dl>
    <div class="det-money"><div><span>Total</span><b>${taka(b.total)}</b>${b.regular > b.total ? `<small>Regular ${taka(b.regular)}</small>` : ''}</div>
      <div><span>Paid</span><b>${taka(b.paid)}</b></div><div><span>Due</span><b class="${b.due > 0 ? 'due' : ''}">${taka(b.due)}</b></div></div>
    <h3 class="det-h">Payments</h3>
    ${pays.length ? `<ul class="pay-list">${pays.map(p => `<li><span>${esc(String(p.date).slice(0, 16))}</span><span>${esc(p.method)}${p.ref ? `, ${esc(p.ref)}` : ''}</span><b class="${p.amount < 0 ? 'due' : ''}">${taka(p.amount)}</b></li>`).join('')}</ul>`
      : '<p class="meta">No payment recorded yet.</p>'}
    <div class="modal-actions">${b.status === 'Pending' ? act('confirm', b.id, 'check-decagram', b.trxId ? 'Verify & confirm' : 'Confirm', 'btn-turf') : ''}${b.due > 0 && !(b.trxId && !b.paid) ? act('pay', b.id, 'cash-plus', 'Record payment', 'btn-turf') : ''}
      ${act('edit', b.id, 'pencil', 'Edit')}${waBtn(b)}${b.status !== 'Cancelled' ? act('cancel', b.id, 'close', 'Cancel', 'btn-danger') : ''}</div>`, { wide: true });
}

function paymentModal(b) {
  formModal('Record payment', `<p class="modal-sub"><b>${esc(b.id)}</b>, ${esc(b.name)}, ${fmtDate(b.date)} ${bTime(b)}<br>
    Total ${taka(b.total)}, paid ${taka(b.paid)}, due <b>${taka(b.due)}</b></p>
    <div class="grid-3"><label class="field">Amount (৳)<input class="input" type="number" min="1" name="amount" required value="${b.due || ''}"></label>
      <label class="field">Method<select class="input" name="method">${options(A.d.methods, 'Cash')}</select></label>
      <label class="field">Reference<input class="input" name="ref" placeholder="TrxID"></label></div>
    <label class="field"><span>Note <small>Refund records the amount as money returned</small></span><input class="input" name="note" maxlength="200"></label>`,
  async f => { await call('addPayment', { ...f, bookingId: b.id }); toast('Payment recorded'); }, 'Record payment');
}

function expenseModal(e) {
  const v = e || { date: A.d.today, title: '', category: 'Other', amount: '', note: '' };
  formModal(e ? 'Edit expense' : 'Add expense', `<div class="grid-2"><label class="field">Date<input class="input" type="date" name="date" required value="${v.date}"></label>
      <label class="field">Category<select class="input" name="category">${options(A.d.categories, v.category)}</select></label></div>
    <div class="grid-2"><label class="field">What was it for<input class="input" name="title" required minlength="2" value="${esc(v.title)}"></label>
      <label class="field">Amount (৳)<input class="input" type="number" min="1" name="amount" required value="${v.amount}"></label></div>
    <label class="field">Note<input class="input" name="note" maxlength="200" value="${esc(v.note)}"></label>`,
  async f => { await call('saveExpense', { ...f, id: e?.id }); toast('Expense saved'); }, e ? 'Save changes' : 'Add expense');
}

function blockModal(day, start) {
  const s = A.d.settings, ends = hoursOf(s).map(h => h + 1);
  formModal('Block time', `<p class="modal-sub">${fmtDate(day, { weekday: 'long', day: 'numeric', month: 'long' })}. Blocked hours cannot be booked online.</p>
    <div class="grid-2"><label class="field">From<select class="input" name="start">${options(hoursOf(s), start, hourLabel)}</select></label>
      <label class="field">To<select class="input" name="end">${options(ends, start + 1, hourLabel)}</select></label></div>
    <label class="field">Reason<input class="input" name="reason" value="Maintenance" maxlength="80"></label>`,
  async f => { await call('saveBlock', { ...f, date: day }); toast('Time blocked'); }, 'Block time');
}

/* ───── Actions (buttons with data-act) ───── */

async function mutate(action, payload, msg) {
  try { await call(action, payload); toast(msg); await refresh(); } catch (e) { toast(e.message, 'error'); }
}

const ACTIONS = {
  menu: () => document.body.classList.toggle('nav-open'),
  logout,
  refresh: (_, btn) => busy(btn, () => refresh().then(() => toast('Up to date')).catch(e => toast(e.message, 'error'))),
  new: () => bookingModal(),
  view: id => detailModal(A.byId[id]),
  edit: id => bookingModal(A.byId[id]),
  'pick-day': d => { A.f.day = d; A.f.cal = d.slice(0, 7); if (location.hash === '#schedule') render(); else location.hash = 'schedule'; },
  cal: n => { const m = A.f.cal || (A.f.day || A.d.today).slice(0, 7); A.f.cal = Number(n) ? addDays(m + '-15', Number(n) * 30).slice(0, 7) : A.d.today.slice(0, 7); render(); },
  pay: id => paymentModal(A.byId[id]),
  confirm: id => mutate('setStatus', { id, status: 'Confirmed' }, `${id} confirmed`),
  cancel: id => {
    const b = A.byId[id];
    if (!confirm(`Cancel ${id} for ${b.name}?${b.paid > 0 ? `\n\n${taka(b.paid)} was paid. Record a Refund payment if you return it.` : ''}`)) return;
    mutate('setStatus', { id, status: 'Cancelled' }, `${id} cancelled`);
  },
  'book-slot': h => bookingModal(null, { date: A.f.day || A.d.today, start: Number(h) }),
  block: h => blockModal(A.f.day || A.d.today, Number(h)),
  unblock: id => mutate('remove', { sheet: 'Blocks', id }, 'Time opened again'),
  day: n => { A.f.day = Number(n) ? addDays(A.f.day || A.d.today, Number(n)) : A.d.today; A.f.cal = A.f.day.slice(0, 7); render(); },
  'view-customer': phone => { A.f.q = phone; A.f.status = A.f.from = A.f.to = ''; location.hash = 'bookings'; },
  ptab: t => { A.f.ptab = t; render(); },
  more: () => { A.limit += 100; render(); },
  'add-exp': () => expenseModal(),
  'edit-exp': id => expenseModal(A.d.expenses.find(e => e.id === id)),
  'del-exp': id => confirm('Delete this expense?') && mutate('remove', { sheet: 'Expenses', id }, 'Expense deleted'),
  'del-pay': id => confirm('Delete this payment record?') && mutate('remove', { sheet: 'Payments', id }, 'Payment deleted'),
  'add-band': () => $('#rateRows').insertAdjacentHTML('beforeend', A.bandRow({ label: '', start: A.d.settings.openHour, end: A.d.settings.closeHour, weekday: '', weekend: '' })),
  'del-band': (_, btn) => btn.closest('tr').remove(),
  'export-bookings': () => csv('bookings', ['ID', 'Created', 'Source', 'Name', 'Phone', 'Date', 'Time', 'Hours', 'Regular', 'Total', 'Paid', 'Due', 'Status', 'Method', 'TrxID', 'Note'],
    A.view.map(b => [b.id, b.createdAt, b.source, b.name, b.phone, b.date, bTime(b), b.hours, b.regular, b.total, b.paid, b.due, b.status, b.payMethod, b.trxId, b.note])),
  'export-payments': () => csv('payments', ['ID', 'Date', 'Booking', 'Customer', 'Method', 'Reference', 'Amount', 'Note'],
    A.d.payments.map(p => [p.id, p.date, p.bookingId, A.byId[p.bookingId]?.name, p.method, p.ref, p.amount, p.note])),
  'export-expenses': () => csv('expenses', ['ID', 'Date', 'Title', 'Category', 'Amount', 'Note'], A.view.map(e => [e.id, e.date, e.title, e.category, e.amount, e.note])),
};

/** Downloads rows as a CSV that opens cleanly in Excel (BOM for ৳, formula-injection guard). */
function csv(name, header, rows) {
  const cell = v => { const s = typeof v === 'string' && /^[=+\-@]/.test(v) ? "'" + v : String(v ?? ''); return `"${s.replace(/"/g, '""')}"`; };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + [header, ...rows].map(r => r.map(cell).join(',')).join('\n')], { type: 'text/csv' }));
  a.download = `${name}-${A.d.today}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ───── Page forms (data-form) ───── */

const FORMS = {
  offer: f => call('saveSettings', { values: { offerActive: f.offerActive ? 'TRUE' : 'FALSE', offerPercent: f.offerPercent, offerTitle: f.offerTitle } }),
  rates: (_, form) => call('savePricing', { rows: $$('#rateRows tr', form).map(tr => {
    const v = n => $(`[name=${n}]`, tr).value, label = v('label').trim();
    return { band: label.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 20) || 'band', label, start: v('start'), end: v('end'), weekday: v('weekday'), weekend: v('weekend') };
  }) }),
  settings: (f, form) => {
    delete f.wd;
    return call('saveSettings', { values: { ...f, weekendDays: $$('[name=wd]:checked', form).map(x => x.value).join(',') } });
  },
  password: async (f, form) => {
    A.token = (await call('changePassword', { next: f.next })).token;
    localStorage.setItem('turf_token', A.token);
    form.reset();
  },
};

/* ───── Events ───── */

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || !ACTIONS[el.dataset.act]) return;
  e.preventDefault();
  if (el.dataset.act !== 'menu' && el.closest('.side')) document.body.classList.remove('nav-open');
  if (el.closest('dialog') && !el.closest('form')) el.closest('dialog').close(); // detail modal → next step opens fresh
  ACTIONS[el.dataset.act](el.dataset.id, el);
});
$('#sideNav').addEventListener('click', () => document.body.classList.remove('nav-open'));

$('#main').addEventListener('input', e => {
  if (e.target.matches('[data-thumbs]')) { e.target.nextElementSibling.outerHTML = thumbs(e.target.value); return; } // live photo previews
  const k = e.target.dataset.f;
  if (!k || e.target.type === 'date' || e.target.type === 'month' || e.target.tagName === 'SELECT') return;
  A.f[k] = e.target.value; A.limit = 100;
  render();
  const el = $(`[data-f="${k}"]`); // keep typing in the re-rendered search box
  el.focus(); el.setSelectionRange(el.value.length, el.value.length);
});
$('#main').addEventListener('change', async e => {
  const t = e.target;
  if (t.dataset.f && (t.type === 'date' || t.type === 'month' || t.tagName === 'SELECT')) { A.f[t.dataset.f] = t.value; A.limit = 100; render(); }
  if (t.dataset.change === 'status') {
    t.disabled = true;
    await mutate('setStatus', { id: t.dataset.id, status: t.value }, `${t.dataset.id} is now ${t.value}`);
    render(); // also restores the select if the change failed
  }
});
$('#main').addEventListener('submit', async e => {
  const form = e.target, fn = FORMS[form.dataset.form];
  if (!fn) return;
  e.preventDefault();
  await busy(e.submitter || $('.btn-turf', form), async () => {
    try { await fn(Object.fromEntries(new FormData(form)), form); toast('Saved'); await refresh(); } catch (err) { toast(err.message, 'error'); }
  });
});

// Chart tooltips: "label|booked|collected"
function showTip(e) {
  const col = e.target.closest?.('[data-tip]'), tip = $('#tip');
  if (!col) { tip.hidden = true; return; }
  const [label, a, b] = col.dataset.tip.split('|'), r = col.getBoundingClientRect();
  tip.innerHTML = `<b>${esc(label)}</b><span><i class="sw s1"></i>Booked ${esc(a)}</span><span><i class="sw s2"></i>Collected ${esc(b)}</span>`;
  tip.hidden = false;
  tip.style.left = Math.min(innerWidth - tip.offsetWidth - 8, Math.max(8, r.left + r.width / 2 - tip.offsetWidth / 2)) + 'px';
  tip.style.top = Math.max(8, r.top - tip.offsetHeight - 8) + 'px';
}
['mouseover', 'focusin'].forEach(ev => document.addEventListener(ev, showTip));
document.addEventListener('scroll', () => { $('#tip').hidden = true; }, true);

window.addEventListener('hashchange', () => { $('#main').scrollTop = 0; scrollTo(0, 0); render(); });

$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  await busy($('button', e.target), async () => {
    try {
      A.token = (await api('login', { password: e.target.password.value })).token;
      localStorage.setItem('turf_token', A.token);
      e.target.reset();
      await refresh();
    } catch (err) { toast(err.message, 'error'); }
  });
});

// Pull fresh data every minute so new website requests show up (skipped while typing or in a dialog).
setInterval(() => {
  const typing = document.activeElement?.matches('input, select, textarea');
  if (A.d && !document.hidden && !typing && !$('dialog[open]')) refresh().catch(() => {});
}, 60000);

if (A.token) {
  try { // paint the last known data instantly, then refresh from the Sheet
    A.d = JSON.parse(localStorage.getItem(CACHE));
    if (A.d) { derive(); showApp(); render(); }
  } catch { A.d = null; }
  refresh().catch(e => { toast(e.message, 'error'); if (!A.d) logout(); });
} else logout();

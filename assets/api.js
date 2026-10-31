// Shared by site.js and admin.js. Needs config.js loaded first (window.TURF_API).

/** POST {action, ...payload} to Apps Script. text/plain body = no CORS preflight. */
async function api(action, payload = {}) {
  const res = await fetch(window.TURF_API, { method: 'POST', body: JSON.stringify({ action, ...payload }) });
  if (!res.ok) throw new Error('Could not reach the server. Check your connection and try again.');
  const json = await res.json();
  if (!json.ok) throw new Error(json.error);
  return json.data;
}

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (name, cls = '') => `<iconify-icon icon="mdi:${name}" class="${cls}" aria-hidden="true"></iconify-icon>`;

const taka = n => (n < 0 ? '-' : '') + '৳' + Math.abs(Math.round(Number(n) || 0)).toLocaleString('en-IN');
const ampm = h => (h % 24 < 12 ? 'AM' : 'PM');
const hourLabel = h => `${h % 12 || 12}:00 ${ampm(h)}`;
const timeRange = (start, hours) => `${hourLabel(start)} – ${hourLabel(start + hours)}`;
/** Compact range: 6–7 AM, 11 AM–12 PM, 6–9 PM */
const shortRange = (start, hours = 1) => {
  const a = start % 12 || 12, z = (start + hours) % 12 || 12;
  return ampm(start) === ampm(start + hours) ? `${a}–${z} ${ampm(start)}` : `${a} ${ampm(start)}–${z} ${ampm(start + hours)}`;
};
/** [6, 7, 9] → [{start: 6, hours: 2}, {start: 9, hours: 1}] (same rule as runs_ in Code.gs) */
const toRuns = hrs => [...hrs].sort((a, z) => a - z).reduce((out, h) => {
  const last = out[out.length - 1];
  if (last && last.start + last.hours === h) last.hours++; else out.push({ start: h, hours: 1 });
  return out;
}, []);

/** Comma/new-line separated text → trimmed list. */
const splitList = v => String(v || '').split(/[\n,]+/).map(x => x.trim()).filter(Boolean);
/** Google Drive share link → direct image URL (file must be shared "Anyone with the link"). Other URLs pass through. */
const imgSrc = u => {
  const id = /drive\.google\.com|docs\.google\.com/.test(u) && (u.match(/\/d\/([\w-]{20,})/) || u.match(/[?&]id=([\w-]{20,})/));
  return id ? `https://lh3.googleusercontent.com/d/${id[1]}=w1920` : u;
};

const todayISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date());
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const fmtDate = (iso, opts = { day: '2-digit', month: 'short', year: 'numeric' }) =>
  new Date(String(iso).slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-GB', { ...opts, timeZone: 'UTC' });

/** 017xxxxxxxx → https://wa.me/88017xxxxxxxx?text=… */
const waLink = (phone, text = '') => `https://wa.me/${String(phone).replace(/\D/g, '').replace(/^0/, '880')}${text ? '?text=' + encodeURIComponent(text) : ''}`;

function toast(msg, type = 'ok') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.innerHTML = `${icon(type === 'error' ? 'alert-circle' : 'check-circle')}<span>${esc(msg)}</span>`;
  document.body.append(el);
  setTimeout(() => el.remove(), 4200);
}

/** Opens a <dialog>. Returns the dialog; close() removes it. */
function openModal(html, { wide = false } = {}) {
  const dlg = document.createElement('dialog');
  dlg.className = 'modal' + (wide ? ' modal-wide' : '');
  dlg.innerHTML = `<button class="modal-x" type="button" aria-label="Close">${icon('close')}</button>${html}`;
  document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('click', e => { if (e.target === dlg || e.target.closest('.modal-x, [data-close]')) dlg.close(); });
  dlg.showModal();
  return dlg;
}

/** Disables a button and shows a spinner while the promise runs. */
async function busy(btn, fn) {
  const label = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span>${label}`;
  try { return await fn(); } finally { btn.disabled = false; btn.innerHTML = label; }
}

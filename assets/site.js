// Public site logic. Needs api.js (api, $, esc, icon, taka, dates…). Talks to Code.gs actions: config, availability, book.
const S = { cfg: null, date: todayISO(), slots: [], start: null, hours: 1, week: 'weekday', seq: 0 };
const form = $('#bookForm');
const FACILITY_ICONS = [[/turf|grass/i, 'grass'], [/light/i, 'lightbulb-on-outline'], [/chang|dress|locker/i, 'hanger'], [/park/i, 'parking'],
  [/water|drink/i, 'cup-water'], [/aid|medic/i, 'medical-bag'], [/wash|toilet|bath/i, 'shower-head'], [/seat|bench|gallery/i, 'seat-outline'], [/ball|bib|kit/i, 'soccer']];

/* ───── Config → page ───── */

function applyConfig(cfg) {
  S.cfg = cfg;
  const s = cfg.settings;
  document.title = `${s.name} | Book a turf slot`;
  $$('[data-s]').forEach(el => { el.textContent = s[el.dataset.s] ?? ''; });
  const links = { tel: `tel:${String(s.phone).replace(/[^\d+]/g, '')}`, wa: waLink(s.whatsapp, `Hello ${s.name}, I'd like to book a slot.`), mail: `mailto:${s.email}`,
    map: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.mapQuery)}`, fb: s.facebook };
  $$('[data-href]').forEach(el => { el.href = links[el.dataset.href] || '#'; el.hidden = el.dataset.href === 'fb' && !s.facebook; });
  $('#map').src = `https://www.google.com/maps?q=${encodeURIComponent(s.mapQuery)}&output=embed`;
  $('#offerBar').hidden = !s.offerActive;
  $('#openHours').textContent = `Every day, ${hourLabel(s.openHour)} – ${hourLabel(s.closeHour)}`;
  $('#weekendNote').textContent = `Weekend rates apply on ${weekendNames(s.weekendDays)} and public holidays.`;
  if (s.heroImage) { $('#hero').classList.add('has-photo'); $('#hero').style.setProperty('--hero', `url("${encodeURI(s.heroImage)}")`); }

  $('#facilityList').innerHTML = list(s.facilities).map(f =>
    `<li>${icon((FACILITY_ICONS.find(([re]) => re.test(f)) || [, 'check-decagram'])[1])}${esc(f)}</li>`).join('');
  const photos = list(s.gallery);
  $('#gallery').hidden = $('#galleryLink').hidden = !photos.length;
  $('#galleryGrid').innerHTML = photos.map((u, i) => `<img src="${esc(u)}" alt="${esc(s.name)} photo ${i + 1}" loading="lazy">`).join('');

  if (S.date < todayISO()) S.date = todayISO(); // page left open past midnight
  $('#otherDate').min = todayISO();
  $('#otherDate').max = addDays(todayISO(), s.bookAheadDays);
  renderDays(); renderPrices(); renderDurations(); renderSummary();
}

const list = v => String(v || '').split(',').map(x => x.trim()).filter(Boolean);
const weekendNames = v => list(v).map(d => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d]).filter(Boolean).join(' and ');
const isWeekend = date => { const s = S.cfg.settings; return list(s.weekendDays).includes(String(new Date(date + 'T12:00:00Z').getUTCDay())) || list(s.holidays).includes(date); };

function renderPrices() {
  const wk = S.week === 'weekend', offer = S.cfg.settings.offerActive;
  $$('.seg button').forEach(b => b.setAttribute('aria-selected', b.dataset.week === S.week));
  $('#priceTable').innerHTML = S.cfg.pricing.map(b => {
    const regular = wk ? b.weekend : b.weekday, price = wk ? b.weekendPrice : b.weekdayPrice;
    return `<div class="price"><h3>${esc(b.label)}</h3><p>${timeRange(b.start, b.end - b.start)}</p>
      <strong>${taka(price)}<small> / hour</small></strong>${offer && price < regular ? `<s>Regular ${taka(regular)}</s>` : ''}</div>`;
  }).join('');
}

/* ───── Step 1: days ───── */

function renderDays() {
  const today = todayISO(), n = Math.min(14, S.cfg.settings.bookAheadDays + 1);
  const days = Array.from({ length: n }, (_, i) => addDays(today, i));
  if (!days.includes(S.date)) days.push(S.date);
  $('#days').innerHTML = days.map((d, i) => `<button type="button" class="day" role="radio" data-date="${d}" aria-checked="${d === S.date}">
      <small>${i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : fmtDate(d, { weekday: 'short' })}</small>
      <b>${fmtDate(d, { day: 'numeric' })}</b><small>${fmtDate(d, { month: 'short' })}</small><em>${isWeekend(d) ? 'Weekend' : ''}</em></button>`).join('');
  $('#otherDate').value = S.date;
}

function pickDate(date) {
  if (!date || date === S.date) return;
  S.date = date; S.start = null;
  renderDays(); loadDay();
  $(`.day[data-date="${date}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
}

/* ───── Step 2: hour board ───── */

async function loadDay() {
  const seq = ++S.seq, date = S.date;
  $('#board').innerHTML = Array(3).fill('<div class="skel"></div>').join('');
  try {
    const res = await api('availability', { date });
    if (seq !== S.seq) return; // a newer day was picked meanwhile
    S.slots = res.slots;
    if (S.start !== null && maxRun(S.start) < 1) S.start = null;
    renderBoard();
    if (date === todayISO()) renderToday(res.slots);
  } catch (e) {
    if (seq !== S.seq) return;
    $('#board').innerHTML = `<div class="board-msg">${icon('wifi-off')} Live times could not load. ${esc(e.message)}
      <button type="button" class="btn btn-sm" id="retry">${icon('refresh')}Try again</button></div>`;
    $('#retry').onclick = loadDay;
  }
  renderDurations(); renderSummary();
}

const STATE_TEXT = { free: '', booked: 'Booked', blocked: 'Closed', past: 'Gone', closed: 'Closed' };

function renderBoard() {
  const inSel = h => S.start !== null && h >= S.start && h < S.start + S.hours;
  const groups = S.cfg.pricing.map(b => ({ b, slots: S.slots.filter(x => x.h >= b.start && x.h < b.end) })).filter(g => g.slots.length);
  $('#board').innerHTML = groups.map(({ b, slots }) => `
    <div><div class="band-head"><h3>${esc(b.label)}</h3><span>${timeRange(b.start, b.end - b.start)}</span><strong>${taka(slots[0].price)}/hr</strong></div>
    <div class="slots">${slots.map(x => `<button type="button" class="slot${inSel(x.h) ? ' is-on' : ''}" data-h="${x.h}" ${x.state !== 'free' ? 'disabled' : ''}
      aria-pressed="${inSel(x.h)}" aria-label="${hourLabel(x.h)}${STATE_TEXT[x.state] ? ', ' + STATE_TEXT[x.state] : ''}">
      <b>${hourLabel(x.h).replace(':00', '')}</b><small>${STATE_TEXT[x.state] || taka(x.price)}</small></button>`).join('')}</div></div>`).join('')
    || `<div class="board-msg">${icon('calendar-remove')} No hours open on this day.</div>`;
}

/** How many free hours in a row from h (capped at maxHours). */
function maxRun(h) {
  let n = 0;
  while (n < S.cfg.settings.maxHours && S.slots.find(x => x.h === h + n)?.state === 'free') n++;
  return n;
}

/* ───── Step 3: duration ───── */

function renderDurations() {
  if (!S.cfg) return;
  const run = S.start === null ? S.cfg.settings.maxHours : maxRun(S.start);
  $('#durations').innerHTML = Array.from({ length: S.cfg.settings.maxHours }, (_, i) => i + 1).map(n =>
    `<button type="button" class="dur" data-n="${n}" aria-pressed="${n === S.hours}" ${n > run ? 'disabled' : ''}>${n} hr${n > 1 ? 's' : ''}</button>`).join('');
}

/* ───── Summary ───── */

const picked = () => (S.start === null ? [] : S.slots.filter(x => x.h >= S.start && x.h < S.start + S.hours));

function renderSummary() {
  const el = $('#summary'), bar = $('#mobileBar');
  if (!S.cfg || S.start === null) {
    el.innerHTML = `<h3>Your booking</h3><p class="summary-empty">Pick a day and a start time to see the price.</p>`;
    bar.hidden = true;
    return;
  }
  const s = S.cfg.settings, p = picked(), regular = p.reduce((t, x) => t + x.regular, 0), total = p.reduce((t, x) => t + x.price, 0);
  const advance = Math.ceil(total * s.advancePercent / 100), when = timeRange(S.start, S.hours);
  el.innerHTML = `<h3>Your booking</h3><dl>
      <div><dt>Day</dt><dd>${fmtDate(S.date, { weekday: 'long', day: 'numeric', month: 'short' })}</dd></div>
      <div><dt>Time</dt><dd>${when}</dd></div>
      <div><dt>Duration</dt><dd>${S.hours} hour${S.hours > 1 ? 's' : ''}</dd></div>
      ${regular > total ? `<div><dt>Offer saving</dt><dd>- ${taka(regular - total)}</dd></div>` : ''}
      <div class="total"><dt>Total</dt><dd>${regular > total ? `<s>${taka(regular)}</s>` : ''}${taka(total)}</dd></div>
      <div><dt>Advance to confirm</dt><dd>${taka(advance)} (${s.advancePercent}%)</dd></div></dl>
    <button class="btn btn-bib" id="sendBtn" type="button">${icon('send')}Send booking request</button>
    <p class="fine">We hold this time for ${s.holdHours} hours while you send the advance.</p>`;
  $('#sendBtn').onclick = submit;
  $('#mbTime').textContent = `${fmtDate(S.date, { day: 'numeric', month: 'short' })}, ${when}`;
  $('#mbTotal').textContent = taka(total);
  bar.hidden = false;
}

/* ───── Submit ───── */

async function submit() {
  const f = Object.fromEntries(new FormData(form)), phone = f.phone.replace(/\D/g, '').replace(/^88/, '');
  if (f.name.trim().length < 2) return invalid('name', 'Enter your name or team name.');
  if (!/^01[3-9]\d{8}$/.test(phone)) return invalid('phone', 'Enter an 11-digit mobile number starting with 01.');
  await busy($('#sendBtn'), async () => {
    try {
      const b = await api('book', { ...f, phone, date: S.date, start: S.start, hours: S.hours });
      try { localStorage.setItem('turf_me', JSON.stringify({ name: f.name, phone })); } catch {}
      S.start = null;
      showDone(b);
    } catch (e) {
      toast(e.message, 'error');
    }
  });
  loadDay();
}

function invalid(name, msg) {
  const el = form.elements[name];
  el.focus();
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  toast(msg, 'error');
}

function showDone(b) {
  const s = S.cfg.settings, when = `${fmtDate(b.date, { weekday: 'short', day: 'numeric', month: 'short' })}, ${timeRange(b.start, b.hours)}`;
  const msg = `Hello ${s.name}, I sent booking request ${b.id}.\nName: ${b.name}\nPhone: ${b.phone}\nTime: ${when}\nTotal: ${taka(b.total)}\nPlease confirm.`;
  openModal(`${icon('check-circle', 'done-icon')}<h2>Request sent</h2>
    <p>Your booking ID</p><div class="booking-id">${esc(b.id)}</div>
    <ul class="done-list"><li>${icon('calendar')} ${when}</li><li>${icon('cash')} Total ${taka(b.total)}</li></ul>
    <div class="pay-box">Pay <b>${taka(b.advance)}</b> advance within ${s.holdHours} hours to confirm. ${esc(s.paymentInfo)}</div>
    <div class="modal-actions"><button class="btn" data-close>Done</button>
    <a class="btn btn-turf" href="${waLink(s.whatsapp, msg)}" target="_blank" rel="noopener">${icon('whatsapp')}Send on WhatsApp</a></div>`);
}

/* ───── Hero ruler: today's hours ───── */

function renderToday(slots) {
  const free = slots.filter(x => x.state === 'free').length;
  $('#todayCount').textContent = free ? `${free} of ${slots.length} hours free` : 'Fully booked today';
  $('#todayRuler').innerHTML = slots.map(x => `<div class="tick ${x.state}" title="${hourLabel(x.h)}: ${x.state}">
    ${x.h === slots[0].h || x.h % 6 === 0 ? `<span>${hourLabel(x.h).replace(':00', '')}</span>` : ''}</div>`).join('');
}

async function loadToday() {
  if (S.date === todayISO()) return; // loadDay() already renders it
  try { renderToday((await api('availability', { date: todayISO() })).slots); } catch { $('#todayCount').textContent = 'Call us for today’s times'; }
}

/* ───── Events ───── */

$('#days').addEventListener('click', e => pickDate(e.target.closest('.day')?.dataset.date));
$('#otherDate').addEventListener('change', e => pickDate(e.target.value));
$('#board').addEventListener('click', e => {
  const btn = e.target.closest('.slot');
  if (!btn || btn.disabled) return;
  S.start = Number(btn.dataset.h);
  S.hours = Math.max(1, Math.min(S.hours, maxRun(S.start)));
  renderBoard(); renderDurations(); renderSummary();
});
$('#durations').addEventListener('click', e => {
  const btn = e.target.closest('.dur');
  if (!btn || btn.disabled) return;
  S.hours = Number(btn.dataset.n);
  renderBoard(); renderDurations(); renderSummary();
});
$$('.seg button').forEach(b => b.addEventListener('click', () => { S.week = b.dataset.week; renderPrices(); }));
$('#menuBtn').addEventListener('click', () => {
  const open = $('#nav').classList.toggle('open');
  $('#menuBtn').setAttribute('aria-expanded', open);
});
$('#nav').addEventListener('click', e => e.target.closest('a') && $('#nav').classList.remove('open'));
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.cfg) loadDay(); });
// Mobile: hide the floating price bar while the real summary is on screen
new IntersectionObserver(([e]) => document.body.classList.toggle('summary-visible', e.isIntersecting)).observe($('#summary'));

/* ───── Boot: show cached config instantly, then refresh from the Sheet ───── */

(async function boot() {
  $('#year').textContent = new Date().getFullYear();
  try { const me = JSON.parse(localStorage.getItem('turf_me')); if (me) { form.elements.name.value = me.name; form.elements.phone.value = me.phone; } } catch {}
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem('turf_cfg')); } catch {}
  if (cached) { applyConfig(cached); loadDay(); loadToday(); }
  try {
    const cfg = await api('config');
    try { localStorage.setItem('turf_cfg', JSON.stringify(cfg)); } catch {}
    applyConfig(cfg);
    if (!cached) { loadDay(); loadToday(); }
  } catch (e) {
    if (!cached) $('#board').innerHTML = `<div class="board-msg">${icon('wifi-off')} The booking system is not reachable right now. ${esc(e.message)}</div>`;
  }
})();

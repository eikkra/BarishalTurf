// Public site logic. Needs api.js (api, $, esc, icon, taka, shortRange, toRuns, imgSrc…).
// Talks to Code.gs: boot (settings + prices + 7 days of slots in one call), availability (other dates), book.
const T0 = performance.now();
const S = { week: 'weekday', cfg: null, today: todayISO(), days: {}, date: todayISO(), sel: new Set(), seq: 0, slide: 0, slideKey: '', slideTimer: 0, bootAt: 0 };
const form = $('#bookForm');
const CACHE = 'bta_boot_v2';
const STATE_TEXT = { booked: 'Booked', blocked: 'Closed', past: 'Over', closed: 'Closed' };
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const BAND_ICONS = [[/morn/i, 'weather-sunset-up'], [/mid|noon|day/i, 'white-balance-sunny'], [/even/i, 'weather-sunset-down'], [/night/i, 'weather-night']];
const FACILITY_ICONS = [[/turf|field|grass/i, 'soccer-field'], [/friend|team/i, 'account-group'], [/light/i, 'lightbulb-on-outline'], [/park/i, 'parking'],
  [/chang|dress|locker|shower/i, 'shower-head'], [/clean/i, 'spray-bottle'], [/water|drink/i, 'cup-water'], [/aid|medic/i, 'medical-bag'], [/seat|bench/i, 'seat-outline']];
const pickIcon = (list, text, fallback) => (list.find(([re]) => re.test(text)) || [, fallback])[1];

/* ───── Boot: paint from the last visit instantly, then refresh from the Sheet ───── */

async function boot() {
  $('#year').textContent = new Date().getFullYear();
  setTimeout(hideSplash, 1200); // never hold the page behind the splash longer than this
  try { const me = JSON.parse(localStorage.getItem('turf_me')); if (me) { form.elements.name.value = me.name; form.elements.phone.value = me.phone; } } catch {}
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem(CACHE)); } catch {}
  if (cached) { apply(cached, cached.today === todayISO()); hideSplash(); } else renderSkeleton();
  try {
    await refreshAll(window.BOOT);
  } catch (e) {
    if (!cached) $('#board').innerHTML = `<div class="board-msg">${icon('wifi-off')} The booking system is not reachable right now. ${esc(e.message)}
      <button type="button" class="btn btn-sm" onclick="location.reload()">${icon('refresh')}Try again</button></div>`;
  }
  hideSplash();
}

/** early = the request already started in <head>; falls back to a fresh call if it failed. */
async function refreshAll(early) {
  const json = early && await early;
  const data = json && json.ok ? json.data : await api('boot');
  S.bootAt = Date.now();
  try { localStorage.setItem(CACHE, JSON.stringify(data)); } catch {}
  apply(data, true);
}

/** First visit only: show the page shape right away while the Sheet answers. */
function renderSkeleton() {
  $('#days').innerHTML = Array.from({ length: 7 }, () => '<div class="day skel"></div>').join('');
  $('#board').innerHTML = Array(4).fill('<div class="skel"></div>').join('');
  $('#rateTables').innerHTML = '<div class="skel tall"></div><div class="skel tall"></div>';
  $('#summary').innerHTML = '<h3>Your booking</h3><p class="summary-empty">Loading live times…</p>';
}

function hideSplash() {
  setTimeout(() => $('#splash').classList.add('done'), Math.max(0, 700 - (performance.now() - T0)));
}

/** data = {settings, pricing, today, days:{date: slots}}; useDays=false skips slot lists from an old cache. */
function apply(data, useDays) {
  S.cfg = { settings: data.settings, pricing: data.pricing };
  if (useDays) { S.today = data.today; Object.assign(S.days, data.days); }
  if (S.date < S.today) S.date = S.today;
  applyBrand();
  renderDays(); renderPrices();
  if (S.days[S.date]) renderBoard(); else loadDay();
  if (S.days[S.today]) renderToday(S.days[S.today]);
  observeReveal();
}

/* ───── Scroll reveal: blocks rise in once as they enter the screen ───── */

const REVEAL = '.head, .step, .summary, .offer, .rate, .facilities li, .gallery img, .map, .visit-info, details, .foot-grid > *, .about-media, .about-copy';
const revealer = 'IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches
  && new IntersectionObserver(entries => entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); revealer.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px' });
if (revealer) document.documentElement.classList.add('anim');

function observeReveal() {
  if (!revealer) return;
  $$(REVEAL).filter(el => !el.dataset.rv).forEach(el => {
    el.dataset.rv = 1;
    el.classList.add('reveal');
    el.style.setProperty('--d', `${([...el.parentNode.children].indexOf(el) % 6) * 0.07}s`); // siblings arrive one after another
    revealer.observe(el);
  });
}

/* ───── Brand, links, prices, facilities ───── */

function applyBrand() {
  const s = S.cfg.settings;
  document.title = `${s.name} | Book a turf slot`;
  $$('[data-s]').forEach(el => { el.textContent = s[el.dataset.s] ?? ''; });
  const logo = s.logoUrl ? imgSrc(s.logoUrl) : 'assets/logo.webp';
  $$('[data-logo]').forEach(img => {
    img.onerror = () => { img.onerror = null; img.src = 'assets/logo.webp'; }; // broken custom link → built-in logo
    if (img.getAttribute('src') !== logo) img.src = logo;
  });
  const links = { tel: `tel:${String(s.phone).replace(/[^\d+]/g, '')}`, wa: waLink(s.whatsapp, `Hello ${s.name}, I'd like to book a slot.`), mail: `mailto:${s.email}`,
    map: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.mapQuery)}`, fb: s.facebook, msg: s.messenger };
  $$('[data-href]').forEach(el => { el.href = links[el.dataset.href] || '#'; el.hidden = !links[el.dataset.href]; });
  const map = `https://www.google.com/maps?q=${encodeURIComponent(s.mapQuery)}&output=embed`;
  if ($('#map').src !== map) $('#map').src = map;
  $('#offerBar').hidden = !s.offerActive;
  $('#openHours').textContent = `Every day, ${hourLabel(s.openHour)} – ${hourLabel(s.closeHour)}`;
  $('#footHours').textContent = `${hourLabel(s.openHour)} – ${hourLabel(s.closeHour)}`;
  $('#footLine').textContent = splitList(s.brandLine).join(' · ');

  // About: chips from brandLine, facts from the booking rules, photo = aboutImage or the first slideshow photo
  $('#aboutChips').innerHTML = splitList(s.brandLine).map(x => `<li>${esc(x)}</li>`).join('');
  $('#factHours').textContent = shortRange(s.openHour, s.closeHour - s.openHour);
  $('#factDays').textContent = `${s.bookAheadDays} days`;
  $('#factMax').textContent = `Up to ${s.maxHours} hrs`;
  const aboutPhoto = s.aboutImage || splitList(s.heroImages)[0];
  $('#aboutImg').hidden = !aboutPhoto;
  $('#aboutMedia').classList.toggle('has-img', !!aboutPhoto);
  if (aboutPhoto && $('#aboutImg').getAttribute('src') !== imgSrc(aboutPhoto)) $('#aboutImg').src = imgSrc(aboutPhoto);
  $('#pickHint').textContent = `(tap one or more, up to ${s.maxHours})`;
  $('#otherDate').min = S.today;
  $('#otherDate').max = addDays(S.today, s.bookAheadDays);

  $('#facilityList').innerHTML = splitList(s.facilities).map(f => `<li><span class="fi">${icon(pickIcon(FACILITY_ICONS, f, 'check-decagram'))}</span>${esc(f)}</li>`).join('');
  const photos = splitList(s.gallery);
  $('#gallery').hidden = $('#galleryLink').hidden = $('[data-gallery]').hidden = !photos.length;
  $('#galleryGrid').innerHTML = photos.map((u, i) => `<img src="${esc(imgSrc(u))}" alt="${esc(s.name)} photo ${i + 1}" loading="lazy">`).join('');
  setSlides(splitList(s.heroImages).map(imgSrc), Math.max(2, s.slideSeconds || 6));
}

const weekendDays = () => splitList(S.cfg.settings.weekendDays).map(Number);
const isWeekend = date => weekendDays().includes(new Date(date + 'T12:00:00Z').getUTCDay()) || splitList(S.cfg.settings.holidays).includes(date);

/** [0..4] → "Sunday to Thursday", [5, 6] → "Friday & Saturday" */
function dayRange(list) {
  const names = list.map(i => DAY_NAMES[i]);
  if (list.length > 2 && list.every((d, i) => !i || d === list[i - 1] + 1)) return `${names[0]} to ${names[names.length - 1]}`;
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}` : names[0] || '';
}

function renderPrices() {
  const s = S.cfg.settings, wk = weekendDays();
  $('#offers').innerHTML = [
    s.offerActive && `<div class="offer">${icon('bullhorn-variant')}<div><b>${s.offerPercent}% off</b><span>${esc(s.offerTitle)}</span></div></div>`,
    s.offerNote && `<div class="offer">${icon('gift-outline')}<div><b>Bonus</b><span>${esc(s.offerNote)}</span></div></div>`,
    `<div class="offer">${icon('calendar-check')}<div><b>${s.advancePercent}% advance</b><span>Pay at least ${s.advancePercent}% to book your slot</span></div></div>`,
  ].filter(Boolean).join('');
  const subOf = weekend => (weekend ? `${wk.map(d => DAY_NAMES[d]).join(', ')} & govt. holidays` : dayRange([0, 1, 2, 3, 4, 5, 6].filter(d => !wk.includes(d))));
  // Slim toggle (weekdays green / weekends red) switches one compact table
  $('#wkTabs').innerHTML = ['weekday', 'weekend'].map(k => `<button role="tab" class="wk-${k}" data-week="${k}" aria-selected="${S.week === k}">
    <b>${k === 'weekend' ? 'Weekends & holidays' : 'Weekdays'}</b><small>${subOf(k === 'weekend')}</small></button>`).join('');
  const weekend = S.week === 'weekend';
  $('#rateTables').innerHTML = `<div class="rate ${weekend ? 'weekend' : ''}"><table>
    <thead><tr><th>Slot</th><th>Time</th>${s.offerActive ? '<th>Regular</th>' : ''}<th>${s.offerActive ? `Offer (${s.offerPercent}% off)` : 'Price'}</th></tr></thead><tbody>
    ${S.cfg.pricing.map(b => {
      const time = shortRange(b.start, b.end - b.start);
      return `<tr><td>${icon(pickIcon(BAND_ICONS, b.label, 'clock-outline'))}<div>${esc(b.label)}<small>${time}</small></div></td><td>${time}</td>
        ${s.offerActive ? `<td class="reg">${taka(weekend ? b.weekend : b.weekday)}</td>` : ''}<td class="now">${taka(weekend ? b.weekendPrice : b.weekdayPrice)}</td></tr>`;
    }).join('')}</tbody></table></div>`;
}

/* ───── Hero slideshow (images from Settings → heroImages, every slideSeconds) ───── */

function setSlides(urls, secs) {
  const key = urls.join('|') + secs;
  if (key === S.slideKey) return;
  S.slideKey = key;
  clearInterval(S.slideTimer);
  $('#hero').classList.toggle('has-slides', urls.length > 0);
  $('#slides').innerHTML = urls.map(() => '<div class="slide"></div>').join('');
  $('#dots').innerHTML = urls.length > 1 ? urls.map((_, i) => `<button role="tab" aria-label="Photo ${i + 1}" data-i="${i}"></button>`).join('') : '';
  const slides = $$('.slide');
  const load = i => { if (slides[i] && !slides[i].style.backgroundImage) slides[i].style.backgroundImage = `url("${urls[i]}")`; };
  const show = i => {
    S.slide = i;
    load(i); load((i + 1) % urls.length); // next photo downloads while this one shows
    slides.forEach((el, n) => el.classList.toggle('on', n === i));
    $$('#dots button').forEach((b, n) => b.setAttribute('aria-selected', n === i));
  };
  const start = () => { clearInterval(S.slideTimer); if (urls.length > 1) S.slideTimer = setInterval(() => !document.hidden && show((S.slide + 1) % urls.length), secs * 1000); };
  S.showSlide = i => { show(i); start(); };
  if (urls.length) { show(0); start(); }
}
$('#wkTabs').addEventListener('click', e => { const b = e.target.closest('[data-week]'); if (b) { S.week = b.dataset.week; renderPrices(); } });
$('#dots').addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b) S.showSlide(Number(b.dataset.i)); });

/* ───── Step 1: days ───── */

function renderDays() {
  const n = Math.min(14, S.cfg.settings.bookAheadDays + 1), days = Array.from({ length: n }, (_, i) => addDays(S.today, i));
  if (!days.includes(S.date)) days.push(S.date);
  $('#days').innerHTML = days.map((d, i) => `<button type="button" class="day" role="radio" data-date="${d}" aria-checked="${d === S.date}">
      <small>${i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : fmtDate(d, { weekday: 'short' })}</small>
      <b>${fmtDate(d, { day: 'numeric' })}</b><small>${fmtDate(d, { month: 'short' })}</small><em>${isWeekend(d) ? 'Weekend' : ''}</em></button>`).join('');
  $('#otherDate').value = S.date;
}

function pickDate(date) {
  if (!date || date === S.date) return;
  S.date = date;
  S.sel.clear();
  renderDays(); renderSummary();
  if (S.days[date]) renderBoard(); else loadDay();
  $(`.day[data-date="${date}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
}

/* ───── Step 2: hour board (multi-select) ───── */

async function loadDay(date = S.date) {
  const seq = ++S.seq;
  if (!S.days[date]) $('#board').innerHTML = Array(4).fill('<div class="skel"></div>').join('');
  try {
    const res = await api('availability', { date });
    S.days[date] = res.slots;
    if (seq === S.seq && date === S.date) renderBoard();
    if (date === S.today) renderToday(res.slots);
  } catch (e) {
    if (seq !== S.seq || S.days[date]) return;
    $('#board').innerHTML = `<div class="board-msg">${icon('wifi-off')} Live times could not load. ${esc(e.message)}
      <button type="button" class="btn btn-sm" id="retry">${icon('refresh')}Try again</button></div>`;
    $('#retry').onclick = () => loadDay(date);
  }
}

function renderBoard() {
  const slots = S.days[S.date] || [];
  [...S.sel].forEach(h => { if (slots.find(x => x.h === h)?.state !== 'free') S.sel.delete(h); }); // someone booked it meanwhile
  const groups = S.cfg.pricing.map(b => ({ b, slots: slots.filter(x => x.h >= b.start && x.h < b.end) })).filter(g => g.slots.length);
  $('#board').innerHTML = groups.map(({ b, slots: list }) => `
    <div><div class="band-head"><h3>${esc(b.label)}</h3><span>${shortRange(b.start, b.end - b.start)}</span><strong>${taka(list[0].price)}/hr</strong></div>
    <div class="slots">${list.map(x => {
      const on = S.sel.has(x.h), free = x.state === 'free';
      return `<button type="button" class="slot ${x.state}" data-h="${x.h}" ${free ? '' : 'disabled'} aria-pressed="${on}" aria-label="${shortRange(x.h)}${free ? '' : ', ' + STATE_TEXT[x.state]}">
        <b>${shortRange(x.h)}</b><small>${free ? taka(x.price) : STATE_TEXT[x.state]}</small></button>`;
    }).join('')}</div></div>`).join('') || `<div class="board-msg">${icon('calendar-remove')} No hours open on this day.</div>`;
  renderSummary();
}

/* ───── Summary ───── */

function quote() {
  const slots = S.days[S.date] || [], runs = toRuns(S.sel).map(r => {
    const hrs = slots.filter(x => x.h >= r.start && x.h < r.start + r.hours);
    return { ...r, regular: hrs.reduce((t, x) => t + x.regular, 0), total: hrs.reduce((t, x) => t + x.price, 0) };
  });
  return { runs, regular: runs.reduce((t, r) => t + r.regular, 0), total: runs.reduce((t, r) => t + r.total, 0), hours: S.sel.size };
}

function renderSummary() {
  const el = $('#summary'), bar = $('#mobileBar');
  if (!S.cfg || !S.sel.size) {
    el.innerHTML = `<h3>Your booking</h3><p class="summary-empty">Pick a day and tap the hours you want to play.</p>`;
    bar.hidden = true;
    return;
  }
  const s = S.cfg.settings, q = quote(), advance = Math.ceil(q.total * s.advancePercent / 100);
  el.innerHTML = `<h3>Your booking</h3>
    <ul class="picked">${q.runs.map(r => `<li><b>${shortRange(r.start, r.hours)}</b><span>${r.hours} hr${r.hours > 1 ? 's' : ''}, ${taka(r.total)}</span></li>`).join('')}</ul>
    <dl><div><dt>Day</dt><dd>${fmtDate(S.date, { weekday: 'long', day: 'numeric', month: 'short' })}</dd></div>
      <div><dt>Total time</dt><dd>${q.hours} hour${q.hours > 1 ? 's' : ''}</dd></div>
      ${q.regular > q.total ? `<div><dt>Offer saving</dt><dd>- ${taka(q.regular - q.total)}</dd></div>` : ''}
      <div class="total"><dt>Total</dt><dd>${q.regular > q.total ? `<s>${taka(q.regular)}</s>` : ''}${taka(q.total)}</dd></div>
      <div><dt>Advance to confirm</dt><dd>${taka(advance)} (${s.advancePercent}%)</dd></div></dl>
    <button class="btn btn-gold" id="sendBtn" type="button">${icon('send')}Send booking request</button>
    <p class="fine">We hold these hours for ${s.holdHours} hours while you send the advance.</p>`;
  $('#sendBtn').onclick = submit;
  $('#mbTime').textContent = `${fmtDate(S.date, { day: 'numeric', month: 'short' })}, ${q.hours} hr${q.hours > 1 ? 's' : ''}`;
  $('#mbTotal').textContent = taka(q.total);
  bar.hidden = false;
}

/* ───── Submit ───── */

async function submit() {
  const f = Object.fromEntries(new FormData(form)), phone = f.phone.replace(/\D/g, '').replace(/^88/, '');
  if (f.name.trim().length < 2) return invalid('name', 'Enter your name or team name.');
  if (!/^01[3-9]\d{8}$/.test(phone)) return invalid('phone', 'Enter an 11-digit mobile number starting with 01.');
  const date = S.date;
  await busy($('#sendBtn'), async () => {
    try {
      const res = await api('book', { ...f, phone, date, slots: [...S.sel] });
      try { localStorage.setItem('turf_me', JSON.stringify({ name: f.name, phone })); } catch {}
      S.sel.clear();
      showDone(res);
    } catch (e) { toast(e.message, 'error'); }
  });
  loadDay(date);
}

function invalid(name, msg) {
  const el = form.elements[name];
  el.focus();
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  toast(msg, 'error');
}

function showDone(res) {
  const s = S.cfg.settings, day = fmtDate(res.date, { weekday: 'short', day: 'numeric', month: 'short' });
  const lines = res.bookings.map(b => `${b.id}: ${shortRange(b.start, b.hours)}`);
  const msg = `Hello ${s.name}, I sent a booking request.\n${lines.join('\n')}\nDay: ${day}\nName: ${res.name}\nPhone: ${res.phone}\nTotal: ${taka(res.total)}\nPlease confirm.`;
  openModal(`${icon('check-circle', 'done-icon')}<h2>Request sent</h2>
    <p>Your booking ID${res.bookings.length > 1 ? 's' : ''}</p><div class="booking-ids">${res.bookings.map(b => `<span>${esc(b.id)}</span>`).join('')}</div>
    <ul class="done-list"><li>${icon('calendar')} ${day}: ${res.bookings.map(b => shortRange(b.start, b.hours)).join(', ')}</li><li>${icon('cash')} Total ${taka(res.total)}</li></ul>
    <div class="pay-box">Pay <b>${taka(res.advance)}</b> advance within ${s.holdHours} hours to confirm. ${esc(s.paymentInfo)}</div>
    <div class="modal-actions"><button class="btn" data-close>Done</button>
    <a class="btn btn-turf" href="${waLink(s.whatsapp, msg)}" target="_blank" rel="noopener">${icon('whatsapp')}Send on WhatsApp</a></div>`);
}

/* ───── Hero card: today's real availability ───── */

function renderToday(slots) {
  const free = slots.filter(x => x.state === 'free'), booked = slots.filter(x => x.state === 'booked').length;
  $('#todayFree').textContent = free.length;
  $('#todayFreeLabel').textContent = `hour${free.length === 1 ? '' : 's'} free today`;
  $('#todaySub').textContent = free.length ? `${booked} booked so far. Next free: ${shortRange(free[0].h)}` : 'Fully booked today. Try tomorrow.';
  $('#todayRuler').innerHTML = slots.map(x => `<div class="tick ${x.state}" title="${shortRange(x.h)}: ${STATE_TEXT[x.state] || 'Free'}">
    ${x.h === slots[0].h || x.h % 6 === 0 ? `<span>${hourLabel(x.h).replace(':00', '')}</span>` : ''}</div>`).join('');
}

/* ───── Events ───── */

$('#days').addEventListener('click', e => pickDate(e.target.closest('.day')?.dataset.date));
$('#otherDate').addEventListener('change', e => pickDate(e.target.value));
$('#board').addEventListener('click', e => {
  const btn = e.target.closest('.slot');
  if (!btn || btn.disabled) return;
  const h = Number(btn.dataset.h), max = S.cfg.settings.maxHours;
  if (S.sel.has(h)) S.sel.delete(h);
  else if (S.sel.size >= max) return toast(`You can pick up to ${max} hours in one request.`, 'error');
  else S.sel.add(h);
  renderBoard();
});
$('#menuBtn').addEventListener('click', () => $('#menuBtn').setAttribute('aria-expanded', $('#nav').classList.toggle('open')));
$('#nav').addEventListener('click', e => e.target.closest('a') && $('#nav').classList.remove('open'));
// Coming back to the tab: refresh if the data is older than a minute
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.cfg && Date.now() - S.bootAt > 60000) refreshAll().catch(() => {}); });
// Mobile: hide the floating price bar while the real summary is on screen
new IntersectionObserver(([e]) => document.body.classList.toggle('summary-visible', e.isIntersecting)).observe($('#summary'));

// Start last, so every function and constant above already exists when cached data paints synchronously.
boot();

// Dashboard pages + charts. Pure renderers: read state A (admin-core.js), return HTML strings.
// Buttons carry data-act / data-id; admin-core.js handles them.

const STATUS_ICON = { Pending: 'clock-outline', Confirmed: 'check-circle-outline', Completed: 'flag-checkered', Cancelled: 'close-circle-outline',
  Paid: 'cash-check', Partial: 'cash-minus', Unpaid: 'cash-remove', Expired: 'timer-off-outline' };
const STATUS_FILL = { Confirmed: '#17663f', Pending: '#b86e00', Completed: '#34507a', Cancelled: '#9e2a23' };

const chip = s => (s ? `<span class="chip chip-${s}">${icon(STATUS_ICON[s])}${s === 'Expired' ? 'Hold expired' : s}</span>` : '');
const sumBy = (arr, k) => arr.reduce((t, x) => t + (Number(typeof k === 'function' ? k(x) : x[k]) || 0), 0);
const kpi = (ic, label, value, sub = '') => `<div class="kpi">${icon(ic)}<span>${label}</span><b>${value}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
const empty = (msg, ic = 'inbox-outline') => `<div class="empty">${icon(ic)}<p>${msg}</p></div>`;
const who = b => `<b>${esc(b.name)}</b><small>${esc(b.phone)}</small>`;
const when = b => `${fmtDate(b.date)}<small>${timeRange(b.start, b.hours)}</small>`;
const act = (a, id, ic, label, cls = '') => `<button class="btn btn-sm ${cls}" data-act="${a}" data-id="${esc(id)}">${icon(ic)}${label}</button>`;
const iconAct = (a, id, ic, label) => `<button class="btn btn-icon btn-ghost" data-act="${a}" data-id="${esc(id)}" title="${label}" aria-label="${label}">${icon(ic)}</button>`;
const panel = (title, body, extra = '') => `<section class="panel"><div class="panel-head"><h2>${title}</h2>${extra}</div>${body}</section>`;

function waBtn(b) {
  const s = A.d.settings, slot = `${fmtDate(b.date, { weekday: 'short', day: 'numeric', month: 'short' })}, ${timeRange(b.start, b.hours)}`;
  const text = b.status === 'Pending'
    ? `Hi ${b.name}, we got your booking ${b.id} for ${slot}. Please send ${taka(Math.max(0, Math.ceil(b.total * s.advancePercent / 100) - b.paid))} advance to confirm it. ${s.paymentInfo}`
    : `Hi ${b.name}, your booking ${b.id} for ${slot} is ${b.status.toLowerCase()}. ${b.due > 0 ? `Due: ${taka(b.due)}. ` : ''}Thank you, ${s.name}`;
  return `<a class="btn btn-icon btn-ghost" href="${waLink(b.phone, text)}" target="_blank" rel="noopener" title="WhatsApp ${esc(b.name)}" aria-label="WhatsApp ${esc(b.name)}">${icon('whatsapp')}</a>`;
}

function table(cols, rows, emptyMsg) {
  if (!rows.length) return empty(emptyMsg, 'table-search');
  return `<div class="tbl-wrap"><table class="tbl"><thead><tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>
    ${rows.map(r => `<tr>${r.map((c, i) => `<td data-label="${cols[i]}"><div>${c}</div></td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

const statusSelect = b => `<select class="status-select chip-${b.status}" data-change="status" data-id="${esc(b.id)}" aria-label="Status of ${esc(b.id)}">
  ${A.d.statuses.map(s => `<option ${s === b.status ? 'selected' : ''}>${s}</option>`).join('')}</select>`;

/* ───── Charts ───── */

/** Paired bars: booked value (s1) vs collected (s2). rows: [{label, a, b}] */
function moneyChart(rows) {
  const max = Math.max(1, ...rows.flatMap(r => [r.a, r.b])), step = Math.ceil(rows.length / 8);
  return `<div class="chart">
    <div class="legend"><span><i class="sw s1"></i>Booked value</span><span><i class="sw s2"></i>Collected</span></div>
    <div class="plot"><div class="gridlines"><span>${taka(max)}</span><span>${taka(max / 2)}</span><span>৳0</span></div>
      <div class="bars">${rows.map((r, i) => `<div class="col" tabindex="0" data-tip="${esc(`${r.label}|${taka(r.a)}|${taka(r.b)}`)}">
        <div class="pair"><i class="s1" style="height:${r.a / max * 100}%"></i><i class="s2" style="height:${r.b / max * 100}%"></i></div>
        <small>${i % step === 0 ? esc(r.label) : ''}</small></div>`).join('')}</div></div></div>`;
}

/** Horizontal bars with the value written at the end. items: [{label, v, color?}] */
function hbars(items, fmt = String) {
  const max = Math.max(1, ...items.map(x => x.v));
  return items.length ? `<div class="hbars">${items.map(x => `<div class="hb"><span>${x.label}</span>
    <div class="track"><i style="width:${x.v / max * 100}%${x.color ? `;background:${x.color}` : ''}"></i></div><b>${fmt(x.v)}</b></div>`).join('')}</div>` : empty('No data for this period.');
}

/** Per-day money rows for a date range. */
function dailyMoney(from, to) {
  const rows = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    rows.push({ label: fmtDate(d, { day: 'numeric', month: 'short' }),
      a: sumBy(A.d.bookings.filter(b => b.date === d && b.status !== 'Cancelled'), 'total'),
      b: sumBy(A.d.payments.filter(p => String(p.date).startsWith(d)), 'amount') });
  }
  return rows;
}

/* ───── Pages ───── */

const PAGES = {
  overview() {
    const { today } = A.d, bk = A.d.bookings;
    const todays = bk.filter(b => b.date === today && b.held).sort((a, b) => a.start - b.start);
    const requests = bk.filter(b => b.status === 'Pending' && b.source === 'web' && b.date >= today).sort((a, b) => String(b.createdAt).localeCompare(a.createdAt));
    const reqItem = b => `<li class="item"><div class="who">${who(b)}</div><div>${when(b)}</div>
      <div>${taka(b.total)}<small>${b.paid ? `Paid ${taka(b.paid)}` : 'No advance yet'}</small></div><div>${chip(b.held ? 'Pending' : 'Expired')}</div>
      <div class="item-act">${act('confirm', b.id, 'check', 'Confirm', 'btn-turf')}${iconAct('pay', b.id, 'cash-plus', 'Record payment')}${waBtn(b)}${iconAct('cancel', b.id, 'close', 'Cancel booking')}</div></li>`;
    const dayItem = b => `<li class="item"><div class="time">${timeRange(b.start, b.hours)}</div><div class="who">${who(b)}</div>
      <div>${taka(b.total)}<small>${b.due > 0 ? `Due ${taka(b.due)}` : 'Fully paid'}</small></div><div>${chip(b.status)}</div>
      <div class="item-act">${b.due > 0 ? iconAct('pay', b.id, 'cash-plus', 'Record payment') : ''}${iconAct('edit', b.id, 'pencil', 'Edit')}${waBtn(b)}</div></li>`;
    return `<p class="hello">Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}. Here is ${esc(A.d.settings.name)} today.</p>
    <div class="kpis">
      ${kpi('calendar-today', "Today's bookings", todays.length, `${sumBy(todays, 'hours')} hours on the pitch`)}
      ${kpi('cash', "Today's booked value", taka(sumBy(todays, 'total')))}
      ${kpi('cash-check', 'Collected today', taka(sumBy(A.d.payments.filter(p => String(p.date).startsWith(today)), 'amount')))}
      ${kpi('cash-clock', 'Still to collect', taka(sumBy(bk, 'due')), 'Across all active bookings')}
    </div>
    ${panel('New website requests', requests.length ? `<ul class="list">${requests.map(reqItem).join('')}</ul>` : empty('No new requests. Website bookings land here first.'), `<span class="count">${requests.length}</span>`)}
    ${panel('Today', todays.length ? `<ul class="list">${todays.map(dayItem).join('')}</ul>` : empty('Nothing booked today yet.', 'calendar-blank'), '<a class="btn btn-sm btn-ghost" href="#schedule">Open schedule</a>')}
    ${panel('Last 14 days', moneyChart(dailyMoney(addDays(today, -13), today)))}`;
  },

  bookings() {
    const f = A.f, q = f.q.toLowerCase();
    const rows = A.d.bookings.filter(b => (!f.status || b.status === f.status) && (!f.from || b.date >= f.from) && (!f.to || b.date <= f.to)
      && (!q || `${b.id} ${b.name} ${b.phone}`.toLowerCase().includes(q))).sort((a, b) => b.date.localeCompare(a.date) || b.start - a.start);
    A.view = rows;
    const shown = rows.slice(0, A.limit);
    return `<div class="filters">
      <label class="search">${icon('magnify')}<input class="input" type="search" data-f="q" value="${esc(f.q)}" placeholder="Search name, phone or ID" aria-label="Search"></label>
      <select class="input" data-f="status" aria-label="Status"><option value="">All statuses</option>${A.d.statuses.map(s => `<option ${s === f.status ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <input class="input" type="date" data-f="from" value="${f.from}" aria-label="From date"><input class="input" type="date" data-f="to" value="${f.to}" aria-label="To date">
      <button class="btn" data-act="export-bookings">${icon('download')}Export CSV</button></div>
    <p class="meta">${rows.length} bookings, ${taka(sumBy(rows.filter(b => b.status !== 'Cancelled'), 'total'))} booked value</p>
    ${table(['Booking', 'Customer', 'Date & time', 'Total', 'Paid', 'Due', 'Status', 'Payment', ''], shown.map(b => [
      `<b>${esc(b.id)}</b><small>${b.source === 'web' ? 'Website' : 'Counter'}</small>`, who(b), when(b), taka(b.total), taka(b.paid),
      b.due > 0 ? `<b class="due">${taka(b.due)}</b>` : taka(0), statusSelect(b) + (b.status === 'Pending' && !b.held ? chip('Expired') : ''), chip(b.pay),
      `<div class="item-act">${iconAct('edit', b.id, 'pencil', 'Edit')}${b.due > 0 ? iconAct('pay', b.id, 'cash-plus', 'Record payment') : ''}${waBtn(b)}</div>`]), 'No bookings match these filters.')}
    ${rows.length > shown.length ? `<button class="btn more" data-act="more">Show more (${rows.length - shown.length} left)</button>` : ''}`;
  },

  schedule() {
    const s = A.d.settings, day = A.f.day || A.d.today, now = day === A.d.today ? A.d.hour : day < A.d.today ? 99 : -1;
    const bk = A.d.bookings.filter(b => b.date === day && b.held), bl = A.d.blocks.filter(x => x.date === day);
    const rows = [];
    let free = 0;
    for (let h = s.openHour; h < s.closeHour;) {
      const b = bk.find(x => h >= x.start && h < x.start + x.hours), k = bl.find(x => h >= +x.start && h < +x.end);
      if (b) {
        const end = b.start + b.hours;
        rows.push(`<li class="srow booked"><div class="stime">${timeRange(h, end - h)}</div><div class="who">${who(b)}</div>
          <div>${taka(b.total)}<small>${b.due > 0 ? `Due ${taka(b.due)}` : 'Fully paid'}</small></div><div>${chip(b.status)}</div>
          <div class="item-act">${b.due > 0 ? iconAct('pay', b.id, 'cash-plus', 'Record payment') : ''}${iconAct('edit', b.id, 'pencil', 'Edit')}${waBtn(b)}</div></li>`);
        h = end;
      } else if (k) {
        rows.push(`<li class="srow blocked"><div class="stime">${timeRange(h, +k.end - h)}</div><div class="who"><b>${icon('cone')} ${esc(k.reason)}</b><small>Closed for booking</small></div>
          <div></div><div></div><div class="item-act">${act('unblock', k.id, 'lock-open-variant-outline', 'Open again')}</div></li>`);
        h = +k.end;
      } else {
        free++;
        rows.push(`<li class="srow free${h <= now ? ' gone' : ''}"><div class="stime">${timeRange(h, 1)}</div><div class="who"><b>Free</b></div><div></div><div></div>
          <div class="item-act">${act('book-slot', h, 'plus', 'Book')}${act('block', h, 'cone', 'Block')}</div></li>`);
        h++;
      }
    }
    const blockedHrs = sumBy(bl, x => x.end - x.start);
    return `<div class="filters daynav">
      ${iconAct('day', -1, 'chevron-left', 'Previous day')}<input class="input" type="date" data-f="day" value="${day}" aria-label="Day">${iconAct('day', 1, 'chevron-right', 'Next day')}
      <button class="btn" data-act="day" data-id="0">Today</button><b class="dayname">${fmtDate(day, { weekday: 'long', day: 'numeric', month: 'long' })}</b></div>
    <div class="kpis">${kpi('soccer-field', 'Booked hours', sumBy(bk, 'hours'), taka(sumBy(bk, 'total')) + ' booked value')}${kpi('calendar-blank-outline', 'Free hours', free)}${kpi('cone', 'Blocked hours', blockedHrs)}</div>
    <section class="panel"><ul class="list schedule">${rows.join('')}</ul></section>`;
  },

  customers() {
    const q = A.f.cq.toLowerCase(), rows = A.custs.filter(c => !q || `${c.name} ${c.phone}`.toLowerCase().includes(q));
    return `<div class="filters"><label class="search">${icon('magnify')}<input class="input" type="search" data-f="cq" value="${esc(A.f.cq)}" placeholder="Search name or phone" aria-label="Search"></label></div>
    <div class="kpis">${kpi('account-group-outline', 'Customers', A.custs.length)}${kpi('cash-check', 'Average paid per customer', taka(sumBy(A.custs, 'spent') / (A.custs.length || 1)))}</div>
    ${table(['Customer', 'Bookings', 'Total paid', 'Due', 'Last booking', ''], rows.map(c => [
      `<b>${esc(c.name)}</b><small>${esc(c.phone)}</small>`, c.count, taka(c.spent), c.due > 0 ? `<b class="due">${taka(c.due)}</b>` : taka(0), fmtDate(c.last),
      `<div class="item-act">${act('view-customer', c.phone, 'format-list-bulleted', 'Bookings')}<a class="btn btn-icon btn-ghost" href="${waLink(c.phone)}" target="_blank" rel="noopener" aria-label="WhatsApp ${esc(c.name)}">${icon('whatsapp')}</a></div>`]), 'No customers found.')}`;
  },

  payments() {
    const bk = A.d.bookings, active = bk.filter(b => b.status !== 'Cancelled'), booked = sumBy(active, 'total'), collected = sumBy(A.d.payments, 'amount');
    const dues = active.filter(b => b.due > 0).sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
    const log = [...A.d.payments].sort((a, b) => String(b.date).localeCompare(a.date));
    const tab = A.f.ptab;
    return `<div class="kpis">${kpi('cash', 'Booked value', taka(booked), 'Cancelled bookings left out')}${kpi('cash-check', 'Collected', taka(collected), 'Advances, settlements and refunds')}
      ${kpi('cash-clock', 'Still to collect', taka(sumBy(dues, 'due')), `${dues.length} bookings`)}${kpi('percent-outline', 'Collection rate', booked ? Math.round(collected / booked * 100) + '%' : '–')}</div>
    <div class="filters"><div class="seg" role="tablist"><button role="tab" data-act="ptab" data-id="dues" aria-selected="${tab === 'dues'}">Dues</button>
      <button role="tab" data-act="ptab" data-id="log" aria-selected="${tab === 'log'}">All payments</button></div>
      <button class="btn" data-act="export-payments">${icon('download')}Export CSV</button></div>
    ${tab === 'dues'
      ? table(['Booking', 'Customer', 'Date & time', 'Total', 'Paid', 'Due', ''], dues.map(b => [`<b>${esc(b.id)}</b>`, who(b), when(b), taka(b.total), taka(b.paid), `<b class="due">${taka(b.due)}</b>`,
        `<div class="item-act">${act('pay', b.id, 'cash-plus', 'Record payment', 'btn-turf')}${waBtn(b)}</div>`]), 'Nothing left to collect.')
      : table(['Date', 'Booking', 'Customer', 'Method', 'Reference', 'Amount', ''], log.map(p => {
        const b = A.byId[p.bookingId] || {};
        return [esc(String(p.date).slice(0, 16)), `<b>${esc(p.bookingId)}</b>`, esc(b.name || '–'), esc(p.method), esc(p.ref || '–'),
          `<b class="${p.amount < 0 ? 'due' : ''}">${taka(p.amount)}</b>`, iconAct('del-pay', p.id, 'delete-outline', 'Delete payment')];
      }), 'No payments recorded yet.')}`;
  },

  expenses() {
    const month = A.f.month || A.d.today.slice(0, 7), list = A.d.expenses.filter(e => String(e.date).startsWith(month)).sort((a, b) => b.date.localeCompare(a.date));
    const byCat = A.d.categories.map(c => ({ label: c, v: sumBy(list.filter(e => e.category === c), 'amount') })).filter(x => x.v).sort((a, b) => b.v - a.v);
    A.view = list;
    return `<div class="filters"><input class="input" type="month" data-f="month" value="${month}" aria-label="Month">
      <button class="btn btn-turf" data-act="add-exp">${icon('plus')}Add expense</button><button class="btn" data-act="export-expenses">${icon('download')}Export CSV</button></div>
    <div class="kpis">${kpi('receipt-text-outline', 'Spent this month', taka(sumBy(list, 'amount')), `${list.length} entries`)}${kpi('chart-donut', 'Biggest cost', byCat[0] ? esc(byCat[0].label) : '–', byCat[0] ? taka(byCat[0].v) : '')}</div>
    ${table(['Date', 'Expense', 'Category', 'Amount', ''], list.map(e => [fmtDate(e.date), `<b>${esc(e.title)}</b>${e.note ? `<small>${esc(e.note)}</small>` : ''}`, esc(e.category), taka(e.amount),
      `<div class="item-act">${iconAct('edit-exp', e.id, 'pencil', 'Edit')}${iconAct('del-exp', e.id, 'delete-outline', 'Delete')}</div>`]), 'No expenses in this month. Add the first one.')}`;
  },

  reports() {
    const [from, to] = periodRange(A.f.period), inR = d => String(d).slice(0, 10) >= from && String(d).slice(0, 10) <= to;
    const bk = A.d.bookings.filter(b => inR(b.date)), active = bk.filter(b => b.status !== 'Cancelled'), cancelled = bk.length - active.length;
    const collected = sumBy(A.d.payments.filter(p => inR(p.date)), 'amount'), spent = sumBy(A.d.expenses.filter(e => inR(e.date)), 'amount');
    const bandHours = A.d.pricing.map(p => ({ label: esc(p.label), v: sumBy(active, b => Math.max(0, Math.min(b.start + b.hours, p.end) - Math.max(b.start, p.start))) }));
    const days = (new Date(to) - new Date(from)) / 864e5;
    return `<div class="filters"><select class="input" data-f="period" aria-label="Period">
      ${[['month', 'This month'], ['last', 'Last month'], ['30', 'Last 30 days'], ['all', 'All time']].map(([v, l]) => `<option value="${v}" ${v === A.f.period ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <span class="meta">${fmtDate(from)} – ${fmtDate(to)}</span></div>
    <div class="kpis">
      ${kpi('calendar-check-outline', 'Bookings', active.length, `${cancelled} cancelled (${bk.length ? Math.round(cancelled / bk.length * 100) : 0}%)`)}
      ${kpi('soccer-field', 'Hours played', sumBy(active, 'hours'))}${kpi('cash', 'Booked value', taka(sumBy(active, 'total')))}
      ${kpi('cash-check', 'Collected', taka(collected))}${kpi('receipt-text-outline', 'Expenses', taka(spent))}
      ${kpi('scale-balance', 'Net cash', taka(collected - spent), 'Collected minus expenses')}</div>
    ${days <= 62 ? panel('Booked value and collections by day', moneyChart(dailyMoney(from, to))) : ''}
    <div class="cols">
      ${panel('Bookings by status', hbars(A.d.statuses.map(s => ({ label: chip(s), v: bk.filter(b => b.status === s).length, color: STATUS_FILL[s] }))))}
      ${panel('Hours booked by time of day', hbars(bandHours, v => v + ' h'))}
      ${panel('Expenses by category', hbars(A.d.categories.map(c => ({ label: esc(c), v: sumBy(A.d.expenses.filter(e => inR(e.date) && e.category === c), 'amount') })).filter(x => x.v).sort((a, b) => b.v - a.v), taka))}
    </div>`;
  },

  pricing() {
    const s = A.d.settings, opts = sel => Array.from({ length: 25 }, (_, h) => `<option value="${h}" ${h === sel ? 'selected' : ''}>${hourLabel(h)}</option>`).join('');
    const row = p => `<tr><td data-label="Name"><input class="input" name="label" value="${esc(p.label)}" required></td>
      <td data-label="From"><select class="input" name="start">${opts(p.start)}</select></td><td data-label="To"><select class="input" name="end">${opts(p.end)}</select></td>
      <td data-label="Weekday ৳/hr"><input class="input" type="number" min="0" name="weekday" value="${p.weekday}" required></td>
      <td data-label="Weekend ৳/hr"><input class="input" type="number" min="0" name="weekend" value="${p.weekend}" required></td>
      <td data-label="">${iconAct('del-band', '', 'delete-outline', 'Remove band')}</td></tr>`;
    A.bandRow = row;
    return panel('Offer', `<form class="form" data-form="offer">
        <label class="switch"><input type="checkbox" name="offerActive" ${s.offerActive ? 'checked' : ''}><span></span>Show the offer and discounted prices</label>
        <div class="grid-2"><label class="field">Discount (%)<input class="input" type="number" min="0" max="90" name="offerPercent" value="${s.offerPercent}"></label>
        <label class="field">Banner text<input class="input" name="offerTitle" value="${esc(s.offerTitle)}" maxlength="80"></label></div>
        <div class="form-end"><button class="btn btn-turf">${icon('content-save')}Save offer</button></div></form>`)
    + panel('Hourly rates', `<p class="meta">Regular price per hour. Customers see it with the offer discount applied. Bands should cover opening hours (${hourLabel(s.openHour)} – ${hourLabel(s.closeHour)}) without gaps.</p>
      <form class="form" data-form="rates"><div class="tbl-wrap"><table class="tbl rates"><thead><tr><th>Name</th><th>From</th><th>To</th><th>Weekday ৳/hr</th><th>Weekend ৳/hr</th><th></th></tr></thead>
      <tbody id="rateRows">${A.d.pricing.map(row).join('')}</tbody></table></div>
      <div class="form-end"><button type="button" class="btn" data-act="add-band">${icon('plus')}Add time band</button><button class="btn btn-turf">${icon('content-save')}Save rates</button></div></form>`);
  },

  settings() {
    const s = A.d.settings, field = ([k, label, type = 'text', hint = '']) => type === 'textarea'
      ? `<label class="field"><span>${label} ${hint ? `<small>${hint}</small>` : ''}</span><textarea class="input" name="${k}">${esc(s[k])}</textarea></label>`
      : `<label class="field"><span>${label} ${hint ? `<small>${hint}</small>` : ''}</span><input class="input" type="${type}" name="${k}" value="${esc(s[k])}"></label>`;
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], wk = String(s.weekendDays).split(',').map(x => x.trim());
    return `<form class="form" data-form="settings">${SETTING_GROUPS.map(([title, fields]) => panel(title, `<div class="grid-2">${fields.map(field).join('')}</div>
      ${title === 'Booking rules' ? `<fieldset class="days-pick"><legend>Weekend price days</legend>${days.map((d, i) => `<label><input type="checkbox" name="wd" value="${i}" ${wk.includes(String(i)) ? 'checked' : ''}>${d}</label>`).join('')}</fieldset>` : ''}`)).join('')}
      <div class="form-end sticky-save"><button class="btn btn-turf">${icon('content-save')}Save settings</button></div></form>
    ${panel('Admin password', `<form class="form" data-form="password"><div class="grid-2"><label class="field">New password<input class="input" type="password" name="next" minlength="6" autocomplete="new-password" required></label></div>
      <div class="form-end"><button class="btn">${icon('lock-reset')}Change password</button></div></form><p class="meta">Changing it signs out every other device.</p>`)}`;
  },
};

const SETTING_GROUPS = [
  ['Arena details', [['name', 'Arena name'], ['tagline', 'Tagline'], ['phone', 'Phone'], ['whatsapp', 'WhatsApp number', 'text', 'with 880, e.g. 8801711…'],
    ['email', 'Email', 'email'], ['facebook', 'Facebook page link', 'url'], ['address', 'Address'], ['mapQuery', 'Map search text', 'text', 'what Google Maps should find'],
    ['heroImage', 'Hero photo link', 'url', 'optional'], ['facilities', 'Facilities', 'textarea', 'comma separated'], ['gallery', 'Photo links', 'textarea', 'comma separated, optional']]],
  ['Booking rules', [['openHour', 'Opens at', 'number', 'hour 0–23'], ['closeHour', 'Closes at', 'number', 'hour 1–24'], ['maxHours', 'Longest online booking', 'number', 'hours'],
    ['bookAheadDays', 'Book up to', 'number', 'days ahead'], ['holdHours', 'Hold unpaid requests for', 'number', 'hours'], ['advancePercent', 'Advance to confirm', 'number', '% of total'],
    ['holidays', 'Holidays with weekend prices', 'textarea', 'dates like 2026-12-16, comma separated']]],
  ['After booking', [['paymentInfo', 'Payment instructions shown to the customer', 'textarea']]],
];

function periodRange(p) {
  const t = A.d.today, m = t.slice(0, 7), monthEnd = mm => addDays(addDays(mm + '-01', 32).slice(0, 7) + '-01', -1);
  if (p === 'last') { const lm = addDays(m + '-01', -1).slice(0, 7); return [lm + '-01', monthEnd(lm)]; }
  if (p === '30') return [addDays(t, -29), t];
  if (p === 'all') return [A.d.bookings.reduce((a, b) => (b.date < a ? b.date : a), t), A.d.bookings.reduce((a, b) => (b.date > a ? b.date : a), t)];
  return [m + '-01', monthEnd(m)];
}

// Rent a Thing — desktop admin. Plain JS, no build step. Talks to the same FastAPI server it's served from.

const API = location.origin;
const TOKEN_KEY = 'rentathing.admin.token';
const THEME_KEY = 'rentathing.admin.theme';
const $app = document.getElementById('app');

let token = localStorage.getItem(TOKEN_KEY);
let me = null;
let counts = { approvals: 0, users: 0, listings: 0, messages: 0 };
let aiOn = false; // set from /ai/status at boot
const state = {
  approvals: { tab: 'listings', selected: new Set() },
  users: { q: '', filter: 'all' },
  listings: { q: '', status: 'all' },
  bookings: { q: '', status: 'all' },
  reviews: { filter: 'all' },
  support: { status: 'open', selected: null },
};
const cache = {}; // last loaded rows per page, for drawers

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const media = (u) => (!u ? '' : u.startsWith('http') ? u : API + u);
const money = (n) => '€' + (Number(n) % 1 === 0 ? Number(n).toFixed(0) : Number(n).toFixed(2));
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const utc = (iso) => new Date(/Z|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + 'Z');
const fmtDate = (iso) => new Date(iso.length === 10 ? iso + 'T12:00:00' : utc(iso)).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const fmtShort = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const range = (a, b) => (a === b ? fmtShort(a) : `${fmtShort(a)} – ${fmtShort(b)}`);
function ago(iso) {
  const s = (Date.now() - utc(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return fmtDate(iso);
}
const initials = (n) => esc(String(n || '?').split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase());
const avatar = (name, url) => `<div class="avatar">${url ? `<img src="${esc(media(url))}" alt="">` : initials(name)}</div>`;
const stars = (n) => `<span class="stars">${'★'.repeat(n)}<span style="opacity:.25">${'★'.repeat(5 - n)}</span></span>`;
const mapEmbed = (lat, lng, zoom = 15) =>
  `<iframe class="map" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="https://maps.google.com/maps?q=${lat},${lng}&z=${zoom}&hl=en&output=embed" title="Map"></iframe>`;
const gmapsLink = (lat, lng) => `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;

const CATEGORY = {
  tools: 'Tools & DIY', garden: 'Garden', camping: 'Camping', bikes: 'Bikes & scooters', photo: 'Photo & video',
  electronics: 'Electronics', party: 'Party & events', sports: 'Sports', kids: 'Kids & baby', home: 'Home & cleaning',
  music: 'Music', travel: 'Travel', other: 'Other',
};
const BOOKING = {
  pending: ['Awaiting reply', 'amber'], accepted: ['Confirmed', 'green'], completed: ['Completed', ''],
  declined: ['Declined', 'red'], cancelled: ['Cancelled', ''],
};
const REVIEW = { pending: ['In review', 'amber'], approved: ['Approved', 'green'], rejected: ['Rejected', 'red'] };
const TOPIC = { general: ['Question', 'blue'], booking: ['Booking', 'amber'], safety: ['Safety', 'red'], bug: ['Bug', 'purple'], feedback: ['Idea', 'green'] };
const pill = ([label, color]) => `<span class="pill ${color}">${esc(label)}</span>`;

const AI_VERDICT = { ok: ['Looks fine', 'green'], check: ['Check this', 'amber'], reject: ['Likely reject', 'red'] };
/** AI pre-check box for a listing waiting for approval. */
function aiPanel(i, { compact = false } = {}) {
  const a = i.ai_check;
  if (!a && !aiOn) return '';
  const run = aiOn ? `<button class="btn ghost sm" data-act="ai-check" data-id="${i.id}">${a ? 'Re-run' : 'Run AI check'}</button>` : '';
  let body;
  if (!a) body = '<div class="tiny">Not checked yet</div>';
  else if (a.error) body = `<div class="tiny">Couldn’t run: ${esc(a.error)}</div>`;
  else
    body = `<div>${esc(a.summary)}</div>${(a.issues || []).length ? `<ul>${a.issues.slice(0, compact ? 2 : 6).map((x) => `<li class="sev-${esc(x.severity)}">${esc(x.text)}</li>`).join('')}</ul>` : ''}`;
  const v = a && !a.error ? AI_VERDICT[a.verdict] : null;
  return `<div class="ai ${v ? v[1] : ''}"><div class="ai-h">${icon('sparkle')}<b>AI pre-check</b>${v ? pill(v) : ''}<span class="grow"></span>${run}</div>${body}</div>`;
}

const ICONS = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18.5 14.8c1.7.8 2.7 2.6 3 5.2"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 7 8 6 8-6"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H3"/>',
  pin: '<path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>',
  ban: '<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff: '<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  cog: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
};
const icon = (n) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ''}</svg>`;

const ACTION = {
  approve_user: ['Approved user', 'check', '#34C759'], reject_user: ['Rejected user', 'x', '#FF3B30'], reopen_user: ['Re-opened user', 'undo', '#0A84FF'],
  approve_item: ['Approved listing', 'check', '#34C759'], reject_item: ['Rejected listing', 'x', '#FF3B30'], reopen_item: ['Re-opened listing', 'undo', '#0A84FF'],
  suspend_user: ['Suspended', 'ban', '#FF3B30'], reinstate_user: ['Reinstated', 'check', '#34C759'],
  grant_admin: ['Made admin', 'shield', '#5E5CE6'], revoke_admin: ['Removed admin', 'shield', '#8E8E93'],
  hide_item: ['Hid listing', 'eyeoff', '#FF9500'], restore_item: ['Restored listing', 'eye', '#34C759'],
  cancel_booking: ['Cancelled booking', 'x', '#FF3B30'], remove_review: ['Removed review', 'trash', '#FF3B30'],
  resolve_message: ['Resolved message', 'check', '#34C759'], reopen_message: ['Reopened message', 'mail', '#0A84FF'],
  change_setting: ['Changed setting', 'sliders', '#8E8E93'],
};

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('on'), 2200);
}

async function api(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 || (res.status === 403 && path.startsWith('/admin'))) {
    logout();
    throw new Error('Please log in as an admin');
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(Array.isArray(data.detail) ? data.detail.map((d) => d.msg).join(', ') : data.detail || `Error ${res.status}`);
  return data;
}

const qs = (o) => {
  const s = Object.entries(o).filter(([, v]) => v !== '' && v != null).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return s ? '?' + s : '';
};

// ---------------------------------------------------------------------------
// theme + auth
// ---------------------------------------------------------------------------

function applyTheme() {
  const t = localStorage.getItem(THEME_KEY);
  if (t) document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}
function toggleTheme() {
  const dark = document.documentElement.dataset.theme
    ? document.documentElement.dataset.theme === 'dark'
    : matchMedia('(prefers-color-scheme: dark)').matches;
  localStorage.setItem(THEME_KEY, dark ? 'light' : 'dark');
  applyTheme();
}

function logout() {
  token = null;
  me = null;
  localStorage.removeItem(TOKEN_KEY);
  renderLogin();
}

function renderLogin(error = '') {
  $app.innerHTML = `
    <div class="login"><form class="card" id="login">
      <div class="brand" style="padding:0"><span class="dot"></span><div>Rent a Thing<small>Admin</small></div></div>
      <h1>Sign in</h1>
      <p class="muted" style="margin:0 0 6px">Admins only. Use the account that has admin rights in the app.</p>
      <input class="input" name="email" type="email" placeholder="Email" autocomplete="username" required>
      <input class="input" name="password" type="password" placeholder="Password" autocomplete="current-password" required>
      ${error ? `<div style="color:var(--red);font-weight:600">${esc(error)}</div>` : ''}
      <button class="btn primary lg" type="submit">Log in</button>
      <button class="btn ghost" type="button" data-act="demo-login">Use the demo admin account</button>
    </form></div>`;
  document.getElementById('login').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    await login(f.get('email'), f.get('password'));
  };
}

async function login(email, password) {
  try {
    const r = await api('POST', '/auth/login', { email, password });
    if (!r.user.is_admin) return renderLogin('This account isn’t an admin.');
    token = r.access_token;
    localStorage.setItem(TOKEN_KEY, token);
    me = r.user;
    boot();
  } catch (err) {
    renderLogin(err.message);
  }
}

// ---------------------------------------------------------------------------
// shell
// ---------------------------------------------------------------------------

const PAGES = [
  ['overview', 'Overview', 'grid'],
  ['approvals', 'Approvals', 'check'],
  ['users', 'Users', 'users'],
  ['listings', 'Listings', 'box'],
  ['bookings', 'Bookings', 'calendar'],
  ['reviews', 'Reviews', 'star'],
  ['support', 'Support inbox', 'mail'],
  ['log', 'Audit log', 'list'],
  ['settings', 'Settings', 'cog'],
];
const route = () => (location.hash.replace('#/', '') || 'overview').split('?')[0];

function shell() {
  const r = route();
  const badge = (id) =>
    id === 'approvals' && counts.approvals ? `<span class="count">${counts.approvals}</span>` : id === 'support' && counts.messages ? `<span class="count">${counts.messages}</span>` : '';
  $app.innerHTML = `
    <div class="shell">
      <aside class="side">
        <div class="brand"><span class="dot"></span><div>Rent a Thing<small>Admin console</small></div></div>
        ${PAGES.map(([id, label, ic]) => `<a class="nav ${r === id ? 'on' : ''}" href="#/${id}">${icon(ic)}<span>${label}</span>${badge(id)}</a>`).join('')}
        <div class="spacer"></div>
        <a class="nav" href="/" target="_blank" rel="noopener">${icon('phone')}<span>Open the app</span></a>
        <a class="nav" data-act="theme">${icon('moon')}<span>Light / dark</span></a>
        <div class="me">${avatar(me.name, me.avatar_url)}<div class="who"><b>${esc(me.name)}</b><span>${esc(me.email)}</span></div>
          <button class="close" data-act="logout" title="Log out">${icon('logout')}</button></div>
      </aside>
      <main class="main" id="page"><div class="empty">Loading…</div></main>
    </div>
    <div class="scrim" data-act="close-drawer"></div>
    <aside class="drawer" aria-hidden="true"><header><h3 id="dtitle"></h3><button class="close" data-act="close-drawer" title="Close">${icon('x')}</button></header><div class="content" id="dbody"></div></aside>`;
}

function header(title, sub = '', right = '') {
  return `<div class="top"><div><h1>${esc(title)}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}</div><div class="grow"></div>${right}</div>`;
}
const searchBox = (key, value, placeholder) =>
  `<label class="search">${icon('search')}<input class="input" data-search="${key}" value="${esc(value)}" placeholder="${esc(placeholder)}"></label>`;
const tabs = (key, options, value) =>
  `<div class="tabs">${options.map(([v, label, n]) => `<button class="tab ${v === value ? 'on' : ''}" data-act="tab" data-key="${key}" data-value="${v}">${esc(label)}${n ? `<span class="n">${n}</span>` : ''}</button>`).join('')}</div>`;

function openDrawer(title, html) {
  document.getElementById('dtitle').textContent = title;
  document.getElementById('dbody').innerHTML = html;
  document.querySelector('.drawer').classList.add('on');
  document.querySelector('.scrim').classList.add('on');
}
function closeDrawer() {
  document.querySelector('.drawer')?.classList.remove('on');
  document.querySelector('.scrim')?.classList.remove('on');
}
const reasonBox = (placeholder = 'Reason — shown in the audit log (and to the user for rejections)') =>
  `<textarea class="textarea" id="reason" placeholder="${esc(placeholder)}" maxlength="300"></textarea>`;
const reasonValue = () => document.getElementById('reason')?.value.trim() ?? '';
const kv = (rows) => `<div class="kv">${rows.filter(Boolean).map(([k, v]) => `<div><span>${esc(k)}</span><b>${v}</b></div>`).join('')}</div>`;

async function refreshCounts() {
  try {
    const s = await api('GET', '/admin/stats');
    counts = { approvals: s.pending_users + s.pending_listings, users: s.pending_users, listings: s.pending_listings, messages: s.open_messages };
    document.querySelectorAll('.nav').forEach((a) => {
      const id = a.getAttribute('href')?.replace('#/', '');
      const old = a.querySelector('.count');
      old?.remove();
      const n = id === 'approvals' ? counts.approvals : id === 'support' ? counts.messages : 0;
      if (n) a.insertAdjacentHTML('beforeend', `<span class="count">${n}</span>`);
    });
    return s;
  } catch {
    return null;
  }
}

async function render() {
  if (!me) return;
  if (!document.getElementById('page')) shell();
  const r = route();
  document.querySelectorAll('.nav').forEach((a) => a.classList.toggle('on', a.getAttribute('href') === `#/${r}`));
  const page = document.getElementById('page');
  try {
    page.innerHTML = await (VIEWS[r] || VIEWS.overview)();
  } catch (err) {
    page.innerHTML = `<div class="empty"><b>Couldn’t load this page</b>${esc(err.message)}</div>`;
  }
}

// ---------------------------------------------------------------------------
// views
// ---------------------------------------------------------------------------

const VIEWS = {
  async overview() {
    const s = await refreshCounts();
    if (!s) throw new Error('Could not load stats');
    const max = Math.max(1, ...s.bookings_per_day.map((d) => d.count));
    const order = ['completed', 'accepted', 'pending', 'declined', 'cancelled'];
    const colors = { completed: 'var(--text-2)', accepted: 'var(--green)', pending: 'var(--amber)', declined: 'var(--red)', cancelled: 'var(--text-3)' };
    const kpi = (label, value, sub, ic, go, alert) =>
      `<div class="card kpi ${alert ? 'alert' : ''}" ${go ? `data-act="go" data-to="${go}"` : ''}><div class="l">${icon(ic)}${label}</div><div class="v">${value}</div><div class="s">${sub}</div></div>`;
    const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    return `
      ${header('Overview', esc(today))}
      <div class="grid kpis">
        ${kpi('Waiting for approval', s.pending_users + s.pending_listings, `${plural(s.pending_listings, 'listing')} · ${plural(s.pending_users, 'user')}`, 'check', 'approvals', s.pending_users + s.pending_listings > 0)}
        ${kpi('Users', s.users, `+${s.new_users_7d} this week · ${s.suspended_users} suspended`, 'users', 'users')}
        ${kpi('Live listings', s.listings_active, `${s.listings_with_360} with 360° · ${s.listings_hidden} hidden`, 'box', 'listings')}
        ${kpi('Bookings', s.bookings_total, `${s.bookings.pending} awaiting reply`, 'calendar', 'bookings')}
        ${kpi('Rental value', money(s.revenue_completed), `${money(s.revenue_upcoming)} confirmed upcoming`, 'star')}
        ${kpi('Platform fees', money(s.platform_fees_completed), `${money(s.platform_fees_upcoming)} pending`, 'credit-card')}
        ${kpi('Open messages', s.open_messages, s.open_messages ? 'Need a reply' : 'All caught up', 'mail', 'support', s.open_messages > 0)}
      </div>
      <div class="row2">
        <div class="card pad">
          <div style="display:flex;justify-content:space-between;align-items:baseline"><h2>Booking requests</h2><span class="tiny">Last 14 days · ${s.bookings_per_day.slice(-7).reduce((a, d) => a + d.count, 0)} this week</span></div>
          <div class="chart">${s.bookings_per_day.map((d, i) => `<div class="bar" title="${esc(fmtShort(d.date))}: ${d.count}">${d.count ? `<small>${d.count}</small>` : ''}<i class="${d.count ? (i === 13 ? 'today' : '') : 'zero'}" style="height:${Math.max(3, (d.count / max) * 110)}px"></i></div>`).join('')}</div>
          <div style="display:flex;justify-content:space-between" class="tiny"><span>${esc(fmtShort(s.bookings_per_day[0].date))}</span><span>Today</span></div>
          <h2 style="margin-top:22px">Booking status</h2>
          <div class="stack">${order.map((k) => (s.bookings[k] ? `<span style="flex:${s.bookings[k]};background:${colors[k]}"></span>` : '')).join('')}</div>
          <div class="legend">${order.map((k) => `<span><i style="background:${colors[k]}"></i>${BOOKING[k][0]} <b style="color:var(--text)">${s.bookings[k]}</b></span>`).join('')}</div>
        </div>
        <div class="card pad">
          <h2>Needs attention</h2>
          <div class="attn">
            <a href="#/approvals" data-tab="listings">${icon('box')}Listings to review<span class="n">${s.pending_listings}</span></a>
            <a href="#/approvals" data-tab="users">${icon('users')}New users to approve<span class="n">${s.pending_users}</span></a>
            <a href="#/support">${icon('mail')}Open support messages<span class="n">${s.open_messages}</span></a>
          </div>
          <h2 style="margin-top:22px">Recent actions</h2>
          ${feed(s.recent_actions)}
        </div>
      </div>`;
  },

  async approvals() {
    const st = state.approvals;
    const [items, users] = await Promise.all([api('GET', '/admin/items?status=pending'), api('GET', '/admin/users?filter=pending')]);
    cache.items = Object.fromEntries(items.map((i) => [i.id, i]));
    cache.users = Object.fromEntries(users.map((u) => [u.id, u]));
    st.selected = new Set([...st.selected].filter((k) => (k.startsWith('i') ? cache.items[k.slice(1)] : cache.users[k.slice(1)])));
    refreshCounts();
    const t = tabs('approvals.tab', [['listings', 'Listings', items.length], ['users', 'Users', users.length]], st.tab);
    let body;
    if (st.tab === 'listings') {
      body = items.length
        ? `<div class="queue">${items.map((i) => `
            <div class="card qcard">
              <div class="img"><img src="${esc(media(i.cover_url))}" alt=""><input type="checkbox" class="sel" data-sel="i${i.id}" ${st.selected.has('i' + i.id) ? 'checked' : ''} title="Select"></div>
              <div class="body">
                <div class="pills">${pill([CATEGORY[i.category] || i.category, 'blue'])}${i.spin_frames ? pill(['360° view', '']) : ''}${i.owner_approval !== 'approved' ? pill(['New user', 'amber']) : ''}</div>
                <div class="title">${esc(i.title)}</div>
                <div class="muted">${money(i.price_per_day)}/day${i.deposit ? ` · ${money(i.deposit)} deposit` : ''} · by ${esc(i.owner_name)}</div>
                ${i.location_label ? `<div class="muted" style="display:flex;gap:6px;align-items:center">${icon('pin')}${esc(i.location_label)}</div>` : '<div style="color:var(--amber)">No location set</div>'}
                <div class="desc">${esc(i.description) || '<i>No description</i>'}</div>
                ${aiPanel(i, { compact: true })}
                <div class="actions">
                  <button class="btn good sm" data-act="approve-item" data-id="${i.id}">${icon('check')}Approve</button>
                  <button class="btn sm" data-act="reject-item" data-id="${i.id}">Reject…</button>
                  <button class="btn ghost sm" data-act="item" data-id="${i.id}">Details</button>
                </div>
              </div>
            </div>`).join('')}</div>`
        : `<div class="card empty"><b>No listings waiting</b>New listings appear here before they go live on Explore.</div>`;
    } else {
      body = users.length
        ? `<div class="card"><table><thead><tr><th style="width:36px"></th><th>Person</th><th>Neighbourhood</th><th>Signed up</th><th>About</th><th style="width:220px"></th></tr></thead><tbody>
            ${users.map((u) => `<tr data-act="user" data-id="${u.id}">
              <td><input type="checkbox" data-sel="u${u.id}" ${st.selected.has('u' + u.id) ? 'checked' : ''}></td>
              <td><div class="cell">${avatar(u.name, u.avatar_url)}<div><div class="t">${esc(u.name)}</div><div class="tiny">${esc(u.email)}</div></div></div></td>
              <td>${esc(u.neighborhood) || '—'}</td><td>${ago(u.created_at)}</td>
              <td><div class="ellipsis muted">${esc(u.bio) || '—'}</div></td>
              <td><div class="actions-row"><button class="btn good sm" data-act="approve-user" data-id="${u.id}">Approve</button><button class="btn sm" data-act="reject-user" data-id="${u.id}">Reject…</button></div></td>
            </tr>`).join('')}</tbody></table></div>`
        : `<div class="card empty"><b>No one waiting</b>New sign-ups appear here. They can browse, but can’t book until approved.</div>`;
    }
    const n = st.selected.size;
    return `${header('Approvals', 'Review new listings and new neighbours before they go live.', t)}${body}
      ${n ? `<div class="bulk"><b>${n} selected</b><button class="btn good sm" data-act="bulk-approve">Approve ${n}</button><button class="btn sm" data-act="bulk-clear">Clear</button></div>` : ''}`;
  },

  async users() {
    const st = state.users;
    const rows = await api('GET', '/admin/users' + qs({ q: st.q, filter: st.filter }));
    cache.users = Object.fromEntries(rows.map((u) => [u.id, u]));
    const status = (u) =>
      u.is_suspended ? pill(['Suspended', 'red']) : u.approval_status === 'pending' ? pill(['Pending', 'amber']) : u.approval_status === 'rejected' ? pill(['Rejected', 'red']) : pill(['Active', 'green']);
    return `${header('Users', `${plural(rows.length, 'person')} shown`)}
      <div class="toolbar">${searchBox('users.q', st.q, 'Search name, email, neighbourhood')}
        ${tabs('users.filter', [['all', 'All'], ['pending', 'Pending', counts.users], ['admins', 'Admins'], ['suspended', 'Suspended'], ['rejected', 'Rejected']], st.filter)}</div>
      <div class="card">${rows.length ? `<table><thead><tr><th>Person</th><th>Neighbourhood</th><th>Status</th><th>Listings</th><th>Rentals</th><th>Rating</th><th>Joined</th></tr></thead><tbody>
        ${rows.map((u) => `<tr data-act="user" data-id="${u.id}">
          <td><div class="cell">${avatar(u.name, u.avatar_url)}<div><div class="t">${esc(u.name)} ${u.is_admin ? pill(['Admin', 'purple']) : ''}</div><div class="tiny">${esc(u.email)}</div></div></div></td>
          <td>${esc(u.neighborhood) || '—'}</td><td>${status(u)}</td><td>${u.listings_count}</td><td>${u.bookings_count}</td>
          <td>${u.rating_count ? `★ ${u.rating_avg.toFixed(1)} <span class="tiny">(${u.rating_count})</span>` : '<span class="tiny">—</span>'}</td>
          <td class="tiny">${fmtDate(u.created_at)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty"><b>No users found</b></div>'}</div>`;
  },

  async listings() {
    const st = state.listings;
    const rows = await api('GET', '/admin/items' + qs({ q: st.q, status: st.status }));
    cache.items = Object.fromEntries(rows.map((i) => [i.id, i]));
    const status = (i) =>
      i.review_status !== 'approved' ? pill(REVIEW[i.review_status]) : !i.is_active ? pill(['Hidden', '']) : i.owner_suspended ? pill(['Owner suspended', 'red']) : pill(['Live', 'green']);
    return `${header('Listings', `${plural(rows.length, 'listing')} shown`)}
      <div class="toolbar">${searchBox('listings.q', st.q, 'Search title or owner')}
        ${tabs('listings.status', [['all', 'All'], ['pending', 'In review', counts.listings], ['active', 'Live'], ['hidden', 'Hidden'], ['rejected', 'Rejected']], st.status)}</div>
      <div class="card">${rows.length ? `<table><thead><tr><th>Listing</th><th>Owner</th><th>Category</th><th>Price</th><th>Location</th><th>Status</th><th>Bookings</th></tr></thead><tbody>
        ${rows.map((i) => `<tr data-act="item" data-id="${i.id}">
          <td><div class="cell"><img class="thumb" src="${esc(media(i.cover_url))}" alt=""><div style="min-width:0"><div class="t ellipsis">${esc(i.title)}</div><div class="tiny">${i.spin_frames ? '360° · ' : ''}added ${ago(i.created_at)}</div></div></div></td>
          <td>${esc(i.owner_name)}</td><td>${esc(CATEGORY[i.category] || i.category)}</td><td>${money(i.price_per_day)}</td>
          <td><div class="ellipsis tiny" style="max-width:200px">${esc(i.location_label) || '—'}</div></td>
          <td>${status(i)}</td><td>${i.bookings_count}</td></tr>`).join('')}</tbody></table>` : '<div class="empty"><b>No listings found</b></div>'}</div>`;
  },

  async bookings() {
    const st = state.bookings;
    const rows = await api('GET', '/admin/bookings' + qs({ q: st.q, status: st.status }));
    cache.bookings = Object.fromEntries(rows.map((b) => [b.id, b]));
    // Fees only count once a booking is confirmed or completed (pending/declined/cancelled earn nothing).
    const sumFees = (statuses) => rows.filter((b) => statuses.includes(b.status)).reduce((a, b) => a + (b.platform_fee || 0), 0);
    const earned = sumFees(['completed']);
    const upcoming = sumFees(['accepted']);
    const feeCell = (b) =>
      ['declined', 'cancelled'].includes(b.status)
        ? `<span class="tiny" style="text-decoration:line-through">${money(b.platform_fee)}</span>`
        : `<b>${money(b.platform_fee)}</b>`;
    return `${header('Bookings', `${plural(rows.length, 'booking')} shown · fees earned <b style="color:var(--text)">${money(earned)}</b> · ${money(upcoming)} from confirmed bookings`)}
      <div class="toolbar">${searchBox('bookings.q', st.q, 'Search item title')}
        ${tabs('bookings.status', [['all', 'All'], ['pending', 'Awaiting reply'], ['accepted', 'Confirmed'], ['completed', 'Completed'], ['cancelled', 'Cancelled'], ['declined', 'Declined']], st.status)}</div>
      <div class="card">${rows.length ? `<table><thead><tr><th>Item</th><th>Borrower → owner</th><th>Dates</th><th>Renter pays</th><th>Service fee</th><th>Owner gets</th><th>Status</th><th>Requested</th></tr></thead><tbody>
        ${rows.map((b) => `<tr data-act="booking" data-id="${b.id}">
          <td><div class="cell"><img class="thumb" src="${esc(media(b.cover_url))}" alt=""><div class="t ellipsis">${esc(b.item_title)}</div></div></td>
          <td>${esc(b.renter_name)} → ${esc(b.owner_name)}</td><td>${range(b.start_date, b.end_date)} <span class="tiny">(${plural(b.days, 'day')})</span></td>
          <td>${money(b.total_price)}</td><td>${feeCell(b)}</td><td>${money(b.owner_payout)}</td>
          <td>${pill(BOOKING[b.status])}</td><td class="tiny">${ago(b.created_at)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty"><b>No bookings here</b></div>'}</div>`;
  },

  async reviews() {
    const st = state.reviews;
    const rows = await api('GET', '/admin/reviews' + qs({ max_rating: st.filter === 'low' ? 2 : '' }));
    cache.reviews = Object.fromEntries(rows.map((r) => [r.id, r]));
    return `${header('Reviews', `${plural(rows.length, 'review')} shown`, tabs('reviews.filter', [['all', 'All'], ['low', '2★ and below']], st.filter))}
      <div class="card">${rows.length ? `<table><thead><tr><th>Rating</th><th>Review</th><th>From → about</th><th>Listing</th><th>Posted</th></tr></thead><tbody>
        ${rows.map((r) => `<tr data-act="review" data-id="${r.id}"><td>${stars(r.rating)}</td><td><div class="ellipsis" style="max-width:360px">${esc(r.comment) || '<i class="muted">No comment</i>'}</div></td>
          <td>${esc(r.reviewer.name)} → ${esc(r.reviewee_name)}</td><td class="tiny">${esc(r.item_title)}</td><td class="tiny">${ago(r.created_at)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty"><b>No reviews here</b></div>'}</div>`;
  },

  async support() {
    const st = state.support;
    const rows = await api('GET', '/admin/messages?status=' + st.status);
    cache.messages = Object.fromEntries(rows.map((m) => [m.id, m]));
    if (!cache.messages[st.selected]) st.selected = rows[0]?.id ?? null;
    const m = cache.messages[st.selected];
    refreshCounts();
    return `${header('Support inbox', 'Messages sent from Contact us in the app.', tabs('support.status', [['open', 'Open', counts.messages], ['resolved', 'Resolved'], ['all', 'All']], st.status))}
      <div class="card inbox">
        <div class="list">${rows.length ? rows.map((x) => `<div class="msg ${x.id === st.selected ? 'on' : ''}" data-act="pick-msg" data-id="${x.id}">
            <div class="h"><b>${esc(x.name || x.email || 'Guest')}</b><span class="tiny">${ago(x.created_at)}</span></div>
            <div class="pills" style="margin-top:4px">${pill(TOPIC[x.topic] || TOPIC.general)}${x.status === 'resolved' ? pill(['Resolved', 'green']) : ''}</div>
            <p>${esc(x.message)}</p></div>`).join('') : '<div class="empty"><b>Inbox zero</b>Nothing here.</div>'}</div>
        <div class="detail">${m ? `
          <div style="display:flex;align-items:center;gap:10px">${pill(TOPIC[m.topic] || TOPIC.general)}<h2 style="margin:0;flex:1">${esc(m.name || 'Guest')}</h2><span class="tiny">${utc(m.created_at).toLocaleString()}</span></div>
          ${kv([['Email', esc(m.email) || '—'], ['Account', m.user_id ? `User #${m.user_id}` : 'Not logged in'], m.booking_id && ['Booking', `#${m.booking_id}`], m.resolved_at && ['Resolved', ago(m.resolved_at)]])}
          <div class="quote">${esc(m.message)}</div>
          ${m.email ? `<div><a class="btn" href="mailto:${esc(m.email)}?subject=${encodeURIComponent('Re: your message to Rent a Thing')}">${icon('undo')}Reply by email</a></div>` : ''}
          <label class="tiny" for="note">INTERNAL NOTE — only admins see this</label>
          <textarea class="textarea" id="note">${esc(m.admin_note)}</textarea>
          <div class="actions-row">
            ${m.status === 'open' ? `<button class="btn good" data-act="msg-status" data-id="${m.id}" data-value="resolved">${icon('check')}Mark resolved</button>` : `<button class="btn" data-act="msg-status" data-id="${m.id}" data-value="open">Reopen</button>`}
            <button class="btn ghost" data-act="msg-note" data-id="${m.id}">Save note</button>
          </div>` : '<div class="empty">Select a message</div>'}</div>
      </div>`;
  },

  async log() {
    const rows = await api('GET', '/admin/actions');
    return `${header('Audit log', 'Every moderation action, with who did it and why.')}
      <div class="card">${rows.length ? `<table><thead><tr><th>Action</th><th>Target</th><th>Reason</th><th>Admin</th><th>When</th></tr></thead><tbody>
        ${rows.map((a) => { const [label, ic, color] = ACTION[a.action] || [a.action, 'list', '#8E8E93'];
          return `<tr style="cursor:default"><td><div class="cell"><span class="avatar" style="background:${color};color:#fff;width:28px;height:28px;border-radius:8px">${icon(ic)}</span><b>${esc(label)}</b></div></td>
            <td>${esc(a.summary)}</td><td class="muted">${esc(a.reason) || '—'}</td><td>${esc(a.admin_name)}</td><td class="tiny">${ago(a.created_at)}</td></tr>`; }).join('')}</tbody></table>` : '<div class="empty"><b>No actions yet</b></div>'}</div>`;
  },

  async settings() {
    const s = await api('GET', '/admin/settings');
    const sw = (key, title, text) => `<div class="setting"><div class="txt"><b>${title}</b><span class="muted">${text}</span></div>
      <label class="switch"><input type="checkbox" data-setting="${key}" ${s[key] ? 'checked' : ''}><span></span></label></div>`;
    return `${header('Settings')}
      <div class="card" style="max-width:760px">
        ${sw('approve_users', 'Approve new users', 'New sign-ups can browse but can’t book until an admin approves them.')}
        ${sw('approve_listings', 'Approve new listings', 'New listings stay hidden from Explore until an admin approves them. Edited rejected listings come back for review.')}
        <div class="setting">
          <div class="txt"><b>Platform fee</b><span class="muted">Kept by Rent a Thing on each booking, % of what the renter pays</span></div>
          <input type="number" data-setting="platform_fee_percent" min="0" max="100" step="1" style="width:70px;margin-left:auto" value="${s.platform_fee_percent ?? ''}">
        </div>
      </div>
      <div class="card pad" style="max-width:760px;margin-top:14px">
        <h2>Maps</h2>
        <p class="muted" style="margin:0 0 8px">Maps and “Get directions” work without a key (Google Maps embeds and links). Address search uses OpenStreetMap’s free geocoder.</p>
        <p class="muted" style="margin:0">Optional: with a Google Maps Platform key, set <code>GOOGLE_MAPS_API_KEY</code> for the server (address search via Google) and <code>EXPO_PUBLIC_GOOGLE_MAPS_API_KEY</code> in <code>mobile/.env</code> (official Maps Embed API).</p>
      </div>`;
  },
};

function feed(actions) {
  if (!actions.length) return '<div class="tiny">Nothing yet.</div>';
  return `<div class="feed">${actions.map((a) => { const [label, ic, color] = ACTION[a.action] || [a.action, 'list', '#8E8E93'];
    return `<div class="ev"><span class="ic" style="background:${color}">${icon(ic)}</span><div><div><b>${esc(label)}</b> · ${esc(a.summary)}</div>
      ${a.reason ? `<div class="tiny">“${esc(a.reason)}”</div>` : ''}<div class="tiny">${esc(a.admin_name)} · ${ago(a.created_at)}</div></div></div>`; }).join('')}</div>`;
}

// ---------------------------------------------------------------------------
// drawers
// ---------------------------------------------------------------------------

function userDrawer(u) {
  const self = u.id === me.id;
  const status = u.is_suspended ? 'Suspended' : { pending: 'Waiting for approval', approved: 'Approved', rejected: 'Rejected' }[u.approval_status];
  openDrawer(u.name, `
    <div class="cell">${avatar(u.name, u.avatar_url).replace('class="avatar"', 'class="avatar" style="width:64px;height:64px;border-radius:32px;font-size:20px"')}
      <div><div class="t" style="font-size:18px">${esc(u.name)}</div><div class="muted">${esc(u.email)}</div><div class="pills" style="margin-top:6px">${u.is_admin ? pill(['Admin', 'purple']) : ''}${pill([status, u.is_suspended || u.approval_status === 'rejected' ? 'red' : u.approval_status === 'pending' ? 'amber' : 'green'])}</div></div></div>
    ${u.bio ? `<div class="quote">${esc(u.bio)}</div>` : ''}
    ${kv([['Neighbourhood', esc(u.neighborhood) || '—'], ['Joined', fmtDate(u.created_at)], ['Listings', u.listings_count], ['Rentals', u.bookings_count],
      ['Rating', u.rating_count ? `★ ${u.rating_avg.toFixed(1)} (${u.rating_count})` : '—'], u.is_suspended && ['Suspended for', esc(u.suspended_reason) || '—'],
      u.approval_status === 'rejected' && ['Rejected because', esc(u.approval_note) || '—']])}
    ${self ? '<div class="muted">This is you. You can’t suspend yourself or remove your own admin rights.</div>' : `
      ${reasonBox()}
      <div class="actions-row">
        ${u.approval_status !== 'approved' ? `<button class="btn good" data-act="approve-user" data-id="${u.id}">${icon('check')}Approve</button>` : ''}
        ${u.approval_status !== 'rejected' ? `<button class="btn" data-act="reject-user-now" data-id="${u.id}">Reject</button>` : ''}
        ${u.is_suspended ? `<button class="btn primary" data-act="user-patch" data-id="${u.id}" data-patch='{"is_suspended":false}'>Reinstate</button>`
          : `<button class="btn bad" data-act="user-patch" data-id="${u.id}" data-patch='{"is_suspended":true}' data-confirm="Suspend ${esc(u.name)}? They’ll be logged out, their listings hidden and open requests cancelled.">${icon('ban')}Suspend</button>`}
        <button class="btn" data-act="user-patch" data-id="${u.id}" data-patch='{"is_admin":${!u.is_admin}}'>${icon('shield')}${u.is_admin ? 'Remove admin' : 'Make admin'}</button>
      </div>`}`);
}

function itemDrawer(i) {
  const photos = i.photos.length ? i.photos : i.cover_url ? [i.cover_url] : [];
  openDrawer(i.title, `
    ${photos.length ? `<div class="gallery">${photos.map((p) => `<img src="${esc(media(p))}" alt="">`).join('')}</div>` : ''}
    <div class="pills">${pill(REVIEW[i.review_status])}${i.is_active ? '' : pill(['Hidden', ''])}${i.spin_frames ? pill([`360° · ${i.spin_frames} frames`, '']) : pill(['No 360° view', 'amber'])}</div>
    ${kv([['Owner', `${esc(i.owner_name)}${i.owner_suspended ? ' (suspended)' : i.owner_approval !== 'approved' ? ' (not approved yet)' : ''}`], ['Owner email', esc(i.owner_email)],
      ['Category', esc(CATEGORY[i.category] || i.category)], ['Price', `${money(i.price_per_day)} / day`], ['Deposit', i.deposit ? money(i.deposit) : '—'],
      ['Bookings', i.bookings_count], ['Added', fmtDate(i.created_at)], i.review_status === 'rejected' && ['Rejected because', esc(i.review_note) || '—']])}
    <div class="quote">${esc(i.description) || '<i class="muted">No description</i>'}</div>
    ${i.review_status !== 'approved' || i.ai_check ? aiPanel(i) : ''}
    ${i.lat != null ? `<div><div class="muted" style="display:flex;gap:6px;align-items:center;margin-bottom:8px">${icon('pin')}${esc(i.location_label)} · <a href="${gmapsLink(i.lat, i.lng)}" target="_blank" rel="noopener">Open in Google Maps</a></div>${mapEmbed(i.lat, i.lng)}</div>` : '<div style="color:var(--amber)">No pick-up location set.</div>'}
    ${reasonBox()}
    <div class="actions-row">
      ${i.review_status !== 'approved' ? `<button class="btn good" data-act="approve-item" data-id="${i.id}">${icon('check')}Approve</button>` : ''}
      ${i.review_status !== 'rejected' ? `<button class="btn" data-act="reject-item-now" data-id="${i.id}">Reject</button>` : ''}
      ${i.is_active ? `<button class="btn bad" data-act="item-patch" data-id="${i.id}" data-patch='{"is_active":false}'>${icon('eyeoff')}Hide</button>` : `<button class="btn primary" data-act="item-patch" data-id="${i.id}" data-patch='{"is_active":true}'>${icon('eye')}Restore</button>`}
    </div>`);
}

function bookingDrawer(b) {
  openDrawer(`Booking #${b.id}`, `
    <div class="cell"><img class="thumb" style="width:72px;height:72px" src="${esc(media(b.cover_url))}" alt=""><div><div class="t" style="font-size:16px">${esc(b.item_title)}</div>${pill(BOOKING[b.status])}</div></div>
    ${kv([['Borrower', esc(b.renter_name)], ['Owner', esc(b.owner_name)], ['Dates', `${range(b.start_date, b.end_date)} (${plural(b.days, 'day')})`], ['Renter pays', money(b.total_price)],
      ['Service fee', `${money(b.platform_fee)}${b.total_price ? ` (${Math.round((b.platform_fee / b.total_price) * 100)}%)` : ''}${['declined', 'cancelled'].includes(b.status) ? ' · not charged' : ''}`],
      ['Owner gets', money(b.owner_payout)], ['Requested', ago(b.created_at)]])}
    ${b.message ? `<div class="quote">${esc(b.message)}</div>` : ''}
    ${['pending', 'accepted'].includes(b.status) ? `${reasonBox('Why cancel? (saved in the audit log)')}<div><button class="btn bad" data-act="cancel-booking" data-id="${b.id}">Cancel booking</button></div>` : ''}`);
}

function reviewDrawer(r) {
  openDrawer('Review', `
    <div class="cell">${avatar(r.reviewer.name, r.reviewer.avatar_url)}<div><div class="t">${esc(r.reviewer.name)} → ${esc(r.reviewee_name)}</div>${stars(r.rating)}</div></div>
    <div class="quote">${esc(r.comment) || '<i class="muted">No comment</i>'}</div>
    ${kv([['Listing', esc(r.item_title)], ['Type', r.direction === 'renter_to_owner' ? 'Borrower about owner' : 'Owner about borrower'], ['Posted', ago(r.created_at)]])}
    ${reasonBox('Why remove it? (e.g. abusive, personal data)')}
    <div><button class="btn bad" data-act="remove-review" data-id="${r.id}">${icon('trash')}Remove review</button></div>`);
}

function rejectDrawer(kind, row) {
  openDrawer(`Reject ${kind === 'item' ? 'listing' : 'user'}`, `
    <div class="muted">${kind === 'item' ? `“${esc(row.title)}” by ${esc(row.owner_name)}` : `${esc(row.name)} · ${esc(row.email)}`}</div>
    <label class="tiny">Tell them what to change — they’ll see this message.</label>
    ${reasonBox(kind === 'item' ? 'e.g. Please add real photos of the item and a pick-up location' : 'e.g. Please add your real name and neighbourhood')}
    ${kind === 'item' && row.ai_check?.message_to_owner ? '<div class="tiny">Pre-filled with the AI’s suggestion — edit it as you like.</div>' : ''}
    <div class="actions-row"><button class="btn bad" data-act="${kind === 'item' ? 'reject-item-now' : 'reject-user-now'}" data-id="${kind === 'item' ? row.id : row.id}">Reject</button>
      <button class="btn" data-act="close-drawer">Cancel</button></div>`);
  const suggestion = kind === 'item' ? row.ai_check?.message_to_owner : '';
  if (suggestion) document.getElementById('reason').value = suggestion;
  setTimeout(() => document.getElementById('reason')?.focus(), 50);
}

// ---------------------------------------------------------------------------
// actions
// ---------------------------------------------------------------------------

async function run(fn, ok) {
  try {
    await fn();
    if (ok) toast(ok);
    closeDrawer();
    await render();
    refreshCounts();
  } catch (err) {
    toast(err.message);
  }
}

const ACT = {
  'demo-login': () => login('admin@rentathing.app', 'admin1234'),
  logout: () => logout(),
  theme: () => toggleTheme(),
  go: (el) => (location.hash = '#/' + el.dataset.to),
  'close-drawer': () => closeDrawer(),
  tab: (el) => {
    const [page, key] = el.dataset.key.split('.');
    state[page][key] = el.dataset.value;
    if (page === 'support') state.support.selected = null;
    render();
  },
  user: (el) => cache.users?.[el.dataset.id] && userDrawer(cache.users[el.dataset.id]),
  item: (el) => cache.items?.[el.dataset.id] && itemDrawer(cache.items[el.dataset.id]),
  booking: (el) => bookingDrawer(cache.bookings[el.dataset.id]),
  review: (el) => reviewDrawer(cache.reviews[el.dataset.id]),
  'pick-msg': (el) => {
    state.support.selected = Number(el.dataset.id);
    render();
  },
  'ai-check': async (el) => {
    el.disabled = true;
    el.textContent = 'Checking…';
    try {
      const updated = await api('POST', `/admin/items/${el.dataset.id}/ai-check`);
      cache.items = { ...(cache.items || {}), [updated.id]: updated };
      const drawerOpen = document.querySelector('.drawer.on');
      await render();
      if (drawerOpen) itemDrawer(updated);
      toast(updated.ai_check?.error ? 'AI check failed' : 'AI check done');
    } catch (err) {
      toast(err.message);
      el.disabled = false;
    }
  },
  'approve-item': (el) => run(() => api('PATCH', `/admin/items/${el.dataset.id}`, { review_status: 'approved', reason: reasonValue() }), 'Listing approved — it’s live'),
  'reject-item': (el) => rejectDrawer('item', cache.items[el.dataset.id]),
  'reject-item-now': (el) => {
    if (!reasonValue()) return toast('Add a short reason so the owner knows what to fix');
    run(() => api('PATCH', `/admin/items/${el.dataset.id}`, { review_status: 'rejected', reason: reasonValue() }), 'Listing rejected');
  },
  'approve-user': (el) => run(() => api('PATCH', `/admin/users/${el.dataset.id}`, { approval_status: 'approved', reason: reasonValue() }), 'User approved'),
  'reject-user': (el) => rejectDrawer('user', cache.users[el.dataset.id]),
  'reject-user-now': (el) => {
    if (!reasonValue()) return toast('Add a short reason');
    run(() => api('PATCH', `/admin/users/${el.dataset.id}`, { approval_status: 'rejected', reason: reasonValue() }), 'User rejected');
  },
  'user-patch': (el) => {
    if (el.dataset.confirm && !confirm(el.dataset.confirm)) return;
    run(() => api('PATCH', `/admin/users/${el.dataset.id}`, { ...JSON.parse(el.dataset.patch), reason: reasonValue() }), 'Saved');
  },
  'item-patch': (el) => run(() => api('PATCH', `/admin/items/${el.dataset.id}`, { ...JSON.parse(el.dataset.patch), reason: reasonValue() }), 'Saved'),
  'cancel-booking': (el) => {
    if (!confirm('Cancel this booking? Both people will see it as cancelled.')) return;
    run(() => api('POST', `/admin/bookings/${el.dataset.id}/cancel`, { reason: reasonValue() }), 'Booking cancelled');
  },
  'remove-review': (el) => {
    if (!confirm('Remove this review? This can’t be undone.')) return;
    run(() => api('DELETE', `/admin/reviews/${el.dataset.id}${qs({ reason: reasonValue() })}`), 'Review removed');
  },
  'msg-status': (el) =>
    run(() => api('PATCH', `/admin/messages/${el.dataset.id}`, { status: el.dataset.value, admin_note: document.getElementById('note').value }), el.dataset.value === 'resolved' ? 'Marked as resolved' : 'Reopened'),
  'msg-note': (el) => run(() => api('PATCH', `/admin/messages/${el.dataset.id}`, { admin_note: document.getElementById('note').value }), 'Note saved'),
  'bulk-clear': () => {
    state.approvals.selected.clear();
    render();
  },
  'bulk-approve': () =>
    run(async () => {
      for (const k of state.approvals.selected) {
        const id = k.slice(1);
        if (k[0] === 'i') await api('PATCH', `/admin/items/${id}`, { review_status: 'approved' });
        else await api('PATCH', `/admin/users/${id}`, { approval_status: 'approved' });
      }
      state.approvals.selected.clear();
    }, 'Approved'),
};

document.addEventListener('click', (e) => {
  const sel = e.target.closest('[data-sel]');
  if (sel) {
    e.stopPropagation();
    const s = state.approvals.selected;
    sel.checked ? s.add(sel.dataset.sel) : s.delete(sel.dataset.sel);
    render();
    return;
  }
  const attn = e.target.closest('.attn a[data-tab]');
  if (attn) state.approvals.tab = attn.dataset.tab;
  const el = e.target.closest('[data-act]');
  if (!el) return;
  // buttons inside a clickable row shouldn't also open the row
  if (el.tagName === 'TR' && e.target.closest('button, a, input')) return;
  e.preventDefault();
  ACT[el.dataset.act]?.(el, e);
});

let searchTimer;
document.addEventListener('input', (e) => {
  const el = e.target.closest('[data-search]');
  if (!el) return;
  const [page, key] = el.dataset.search.split('.');
  state[page][key] = el.value;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    await render();
    const again = document.querySelector(`[data-search="${el.dataset.search}"]`);
    again?.focus();
    again?.setSelectionRange(again.value.length, again.value.length);
  }, 300);
});

document.addEventListener('change', async (e) => {
  const el = e.target.closest('[data-setting]');
  if (!el) return;
  try {
    const value = el.type === 'checkbox' ? el.checked : Number(el.value);
    await api('PATCH', '/admin/settings', { [el.dataset.setting]: value });
    toast(el.type === 'checkbox' ? (el.checked ? 'Turned on' : 'Turned off') : 'Saved');
  } catch (err) {
    if (el.type === 'checkbox') el.checked = !el.checked;
    toast(err.message);
  }
});

document.addEventListener('keydown', (e) => e.key === 'Escape' && closeDrawer());
window.addEventListener('hashchange', () => {
  closeDrawer();
  render();
});

// ---------------------------------------------------------------------------

async function boot() {
  applyTheme();
  if (!token) return renderLogin();
  try {
    me = me || (await api('GET', '/users/me'));
    if (!me.is_admin) return logout();
  } catch {
    return renderLogin();
  }
  try {
    aiOn = (await api('GET', '/ai/status')).enabled;
  } catch {
    aiOn = false;
  }
  shell();
  await refreshCounts();
  render();
}
boot();

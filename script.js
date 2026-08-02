'use strict';
/* ═══════════════════════════════════════════════════════════
   ORBIS — script.js
     (1) Constants & module registry
     (2) Storage helpers (users, session, activity)
     (3) showView + toast + modal + confirm systems
     (4) Ambient animation controllers
     (5) Validation helpers
     (6) Auth flow (login, signup, MFA)
     (7) Session manager
     (8) Admin dashboard renderers & handlers
     (9) Init

   Sections 1–3 and 7 are the reusable foundation. Later stages
   (Flight Board, GSE Entry, …) call showView / showToast /
   confirmDialog / getSession / hasPermission without refactoring.
   ═══════════════════════════════════════════════════════════ */

/* ═══ (1) CONSTANTS & MODULE REGISTRY ═══════════════════════ */

const USERS_KEY    = 'orbis_users';
const SESSION_KEY  = 'orbis_session';
const ACTIVITY_KEY = 'orbis_activity';
const SESSION_MS   = 15 * 60 * 1000;     // 15-minute session
const MFA_CODE     = '12345';
const LOAD_DELAY   = 500;

const ROLES = {
  SUPER_ADMIN:   'System Administrator',
  SUPERVISOR:    'Ramp Supervisor',
  SHIFT_MANAGER: 'Shift Operations Manager',
  STATION_ADMIN: 'Station Administrator',
  AIRLINE_REP:   'Airline Representative'
};

const STATUSES = { PENDING:'Pending', APPROVED:'Approved', REJECTED:'Rejected', SUSPENDED:'Suspended' };

/* SVG path bodies for the eight ORBIS modules */
const ICONS = {
  flightboard:'<path d="M12 2 L14.5 9.5 L22 12 L14.5 14.5 L12 22 L9.5 14.5 L2 12 L9.5 9.5 Z"/>',
  turnaround: '<path d="M21 12 a9 9 0 1 1-3-6.7"/><path d="M21 4 V9 H16"/>',
  gse:        '<rect x="3" y="7" width="12" height="8" rx="1.5"/><path d="M15 10 h4 l2 3 v2 h-6"/><circle cx="7" cy="17" r="1.7"/><circle cx="17" cy="17" r="1.7"/>',
  offblock:   '<circle cx="12" cy="12" r="9"/><path d="M12 7 V12 L15.5 14"/>',
  manager:    '<path d="M4 20 V10 M10 20 V4 M16 20 V13 M22 20 H2"/>',
  equipment:  '<path d="M12 2 v3 M12 19 v3 M2 12 h3 M19 12 h3"/><circle cx="12" cy="12" r="4"/><path d="M12 8 a4 4 0 0 1 4 4"/>',
  weights:    '<path d="M12 3 v18 M6 7 h12 M4 21 h16"/><path d="M6 7 L3 13 a3 3 0 0 0 6 0 Z"/><path d="M18 7 L15 13 a3 3 0 0 0 6 0 Z"/>',
  analytics:  '<path d="M3 3 v18 h18"/><path d="M7 15 L11 10 L14 13 L20 6"/>'
};

const MODULES = {
  flightboard:{ label:'Flight Board',       locked:true  },
  turnaround: { label:'Turnaround Detail',  locked:false },
  gse:        { label:'GSE Entry',          locked:false },
  offblock:   { label:'Off-Block Logging',  locked:false },
  manager:    { label:'Manager Dashboard',  locked:false },
  equipment:  { label:'Equipment Register', locked:false },
  weights:    { label:'Weights & Thresholds', locked:false },
  analytics:  { label:'Accuracy Analytics', locked:false }
};
const ALL_MODULES = Object.keys(MODULES);

/* corporate-email gate: reject these free providers (matched on the domain's first label) */
const FREE_PROVIDERS = new Set([
  'gmail','yahoo','hotmail','outlook','aol','icloud','mail',
  'protonmail','zoho','yandex','gmx','live','msn'
]);

/* ═══ (2) STORAGE HELPERS ═══════════════════════════════════ */

function readJSON(key, fallback){
  try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; }
  catch(e){ return fallback; }
}
function getUsers(){ const u = readJSON(USERS_KEY, []); return Array.isArray(u) ? u : []; }
function saveUsers(u){ localStorage.setItem(USERS_KEY, JSON.stringify(u)); }
function findUser(pred){ return getUsers().find(pred) || null; }
function updateUser(id, changes){
  const users = getUsers();
  const u = users.find(x => x.id === id);
  if(!u) return null;
  Object.assign(u, changes);
  saveUsers(users);
  return u;
}

function getActivity(){ const a = readJSON(ACTIVITY_KEY, []); return Array.isArray(a) ? a : []; }
function logActivity({ action, target, category='user', severity='info' }){
  const session = getSession();
  const entry = {
    id: uid('a'), timestamp: new Date().toISOString(),
    actor: session ? session.name : 'System', action, target: target || '—', category, severity
  };
  const all = getActivity(); all.unshift(entry);
  localStorage.setItem(ACTIVITY_KEY, JSON.stringify(all.slice(0, 200)));
  return entry;
}

function getSession(){
  const s = readJSON(SESSION_KEY, null);
  if(!s || !s.expiresAt || Date.now() > s.expiresAt){ if(s) clearSession(); return null; }
  return s;
}
function setSession(user, expiresAt){
  const s = { userId:user.id, name:user.name, email:user.email, role:user.role,
              expiresAt: expiresAt || (Date.now() + SESSION_MS) };
  localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  return s;
}
function clearSession(){ localStorage.removeItem(SESSION_KEY); }

/* seed on first load */
function seedIfEmpty(){
  if(getUsers().length) return;
  const now = Date.now();
  const iso = ms => new Date(ms).toISOString();
  const mk = (o) => Object.assign({
    id: uid('u'), permissions: ['flightboard'], organisation:'', registeredAt: iso(now),
    decidedAt:null, decidedBy:null, rejectionReason:null, sessionActive:false, lastActiveAt:null
  }, o);

  const users = [
    mk({ id:'seed-admin', name:'System Admin', email:'admin', password:'admin', role:'SUPER_ADMIN',
         organisation:'ORBIS', status:'APPROVED', permissions:[...ALL_MODULES],
         decidedAt:iso(now), decidedBy:'System' }),
    mk({ name:'Ayesha Raza', email:'ayesha.raza@menzies-ras.pk', password:'Ramp@2024', role:'SUPERVISOR',
         organisation:'Menzies-RAS', status:'PENDING', registeredAt:iso(now - 36e5) }),
    mk({ name:'Bilal Ahmed', email:'bilal.ahmed@piac.com.pk', password:'Shift@2024', role:'SHIFT_MANAGER',
         organisation:'PIA', status:'PENDING', registeredAt:iso(now - 72e5) }),
    mk({ name:'Sana Malik', email:'sana.malik@menzies-ras.pk', password:'Statn@2024', role:'STATION_ADMIN',
         organisation:'Menzies-RAS', status:'APPROVED', permissions:[...ALL_MODULES],
         registeredAt:iso(now - 864e5*3), decidedAt:iso(now - 864e5*2), decidedBy:'System Admin', lastActiveAt:iso(now - 6e5) }),
    mk({ name:'Usman Tariq', email:'usman.tariq@piac.com.pk', password:'Airln@2024', role:'AIRLINE_REP',
         organisation:'PIA', airline:'PK', status:'APPROVED', permissions:['flightboard','turnaround','manager','analytics'],
         registeredAt:iso(now - 864e5*5), decidedAt:iso(now - 864e5*4), decidedBy:'System Admin' }),
    mk({ name:'Hina Shah', email:'hina.shah@piac.com.pk', password:'Reqst@2024', role:'AIRLINE_REP',
         organisation:'PIA', status:'REJECTED', registeredAt:iso(now - 864e5*2),
         decidedAt:iso(now - 864e5), decidedBy:'System Admin', rejectionReason:'Organisation affiliation could not be verified.' })
  ];
  saveUsers(users);
}

/* ═══ (3) showView + toast + modal + confirm ════════════════ */

const VIEW_IDS = ['view-auth','view-mfa','view-admin','view-app'];

function showView(id){
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const el = document.getElementById(id);
  if(el) el.classList.add('active');
  window.scrollTo(0, 0);
  if(id === 'view-auth') ambient.start(); else ambient.stop();
}

/* toasts */
const TOAST_ICONS = {
  success:'<path d="M20 6 L9 17 L4 12"/>',
  error:'<circle cx="12" cy="12" r="9"/><path d="M12 7.5 V13 M12 16.2 V16.3"/>',
  notice:'<path d="M12 3 L22 20 H2 Z"/><path d="M12 10 V14 M12 17 V17.1"/>'
};
function showToast(message, type='success'){
  const wrap = document.getElementById('toast-wrap'); if(!wrap) return;
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.innerHTML = `<span class="toast-ico"><svg viewBox="0 0 24 24" width="14" height="14" fill="none"
    stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${TOAST_ICONS[type]||TOAST_ICONS.success}</svg></span>
    <span class="toast-msg"></span>
    <button class="toast-x" type="button" aria-label="Dismiss"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 L6 18 M6 6 L18 18"/></svg></button>`;
  t.querySelector('.toast-msg').textContent = message;
  const dismiss = () => { t.classList.add('out'); t.addEventListener('animationend', () => t.remove(), { once:true }); };
  t.querySelector('.toast-x').onclick = e => { e.stopPropagation(); dismiss(); };
  t.onclick = dismiss;
  wrap.appendChild(t);
  setTimeout(() => { if(t.parentNode) dismiss(); }, 3400);
}

/* generic modal host */
function openModal(html, wide){
  const host = document.getElementById('modal-host');
  host.innerHTML = `<div class="modal${wide ? ' wide' : ''}">${html}</div>`;
  host.hidden = false;
  host.onclick = e => { if(e.target === host) closeModal(); };
  return host.querySelector('.modal');
}
function closeModal(){ const h = document.getElementById('modal-host'); h.hidden = true; h.innerHTML = ''; }

/* confirm dialog → Promise<null | true | {reason}> */
function confirmDialog({ title, message, confirmLabel='Confirm', danger=true, withReason=false, reasonLabel='Reason' }){
  return new Promise(resolve => {
    const host = document.getElementById('confirm-host');
    host.innerHTML = `
      <div class="confirm">
        <div class="confirm-ico ${danger ? 'danger' : 'warn'}">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 L22 20 H2 Z"/><path d="M12 10 V14 M12 17 V17.1"/></svg>
        </div>
        <h3></h3><p></p>
        ${withReason ? `<textarea id="confirm-reason" placeholder="${reasonLabel}…"></textarea>` : ''}
        <div class="confirm-foot">
          <button class="btn btn-ghost" data-cancel>Cancel</button>
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${confirmLabel}</button>
        </div>
      </div>`;
    host.querySelector('h3').textContent = title;
    host.querySelector('p').textContent = message;
    host.hidden = false;

    const done = val => { host.hidden = true; host.innerHTML = ''; host.onclick = null; resolve(val); };
    host.onclick = e => { if(e.target === host) done(null); };
    host.querySelector('[data-cancel]').onclick = () => done(null);
    host.querySelector('[data-ok]').onclick = () => {
      if(withReason){
        const reason = host.querySelector('#confirm-reason').value.trim();
        done({ reason });
      } else done(true);
    };
  });
}

/* body-level kebab menu */
let activeKebabAnchor = null;

function positionKebab(anchorEl, menu){
  if(!anchorEl || !menu) return;
  const r = anchorEl.getBoundingClientRect();
  if(r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth){
    closeKebab(); return;
  }
  const mw = 190;
  const menuHeight = menu.offsetHeight || 180;
  const top = (r.bottom + 6 + menuHeight > window.innerHeight) ? Math.max(8, r.top - menuHeight - 6) : r.bottom + 6;
  const left = Math.max(8, Math.min(r.right - mw, window.innerWidth - mw - 8));
  menu.style.top = `${top}px`;
  menu.style.left = `${left}px`;
}

function openKebab(anchorEl, items){
  const host = document.getElementById('kebab-host');
  activeKebabAnchor = anchorEl;
  const menu = document.createElement('div');
  menu.className = 'kebab-menu';
  menu.innerHTML = items.map(it => {
    if(it.sep) return '<div class="sep"></div>';
    if(it.note) return `<div class="you-note">${escapeHtml(it.note)}</div>`;
    return `<button class="${it.danger ? 'danger' : ''}" data-k="${it.key}">${escapeHtml(it.label)}</button>`;
  }).join('');
  host.innerHTML = ''; host.appendChild(menu); host.hidden = false;

  positionKebab(anchorEl, menu);

  host.onclick = e => {
    const btn = e.target.closest('button[data-k]');
    if(btn){ const key = btn.dataset.k; closeKebab(); const it = items.find(i => i.key === key); if(it && it.onClick) it.onClick(); }
    else if(e.target === host) closeKebab();
  };
}

function closeKebab(){
  const h = document.getElementById('kebab-host');
  if(h){ h.hidden = true; h.innerHTML = ''; h.onclick = null; }
  activeKebabAnchor = null;
}

/* small utilities */
function uid(p){ return `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`; }
function escapeHtml(v){ const d = document.createElement('div'); d.textContent = v == null ? '' : String(v); return d.innerHTML; }
function initials(name){ const p = String(name||'').trim().split(/\s+/); if(!p[0]) return '?';
  return (p[0][0] + (p.length>1 ? p[p.length-1][0] : '')).toUpperCase(); }
function fmtDate(iso){ if(!iso) return '—'; const d = new Date(iso); if(isNaN(d)) return '—';
  return d.toLocaleDateString(undefined,{ day:'2-digit', month:'short', year:'numeric' }); }
function fmtDateTime(iso){ if(!iso) return '—'; const d = new Date(iso); if(isNaN(d)) return '—';
  return fmtDate(iso) + ', ' + d.toLocaleTimeString(undefined,{ hour:'2-digit', minute:'2-digit' }); }
function pad2(n){ return String(n).padStart(2,'0'); }
function relTime(iso){ if(!iso) return 'never'; const s = Math.floor((Date.now()-new Date(iso))/1000);
  if(s<60) return 'just now'; if(s<3600) return `${Math.floor(s/60)}m ago`;
  if(s<86400) return `${Math.floor(s/3600)}h ago`; return `${Math.floor(s/86400)}d ago`; }
function countUp(el, target, dur=600){ if(!el) return; const start=performance.now();
  (function frame(now){ const p=Math.min((now-start)/dur,1); el.textContent=String(Math.round(target*(1-Math.pow(1-p,3))));
    if(p<1) requestAnimationFrame(frame); else el.textContent=String(target); })(performance.now()); }

/* ═══ (4) AMBIENT ANIMATION CONTROLLERS ═════════════════════ */

const ambient = (function(){
  let timers = [], running = false, board = [];
  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const seedBoard = () => ([
    { fl:'PK-301', stand:3, eibt:'14:00', buffer:42, tobt:'14:42', risk:'RED' },
    { fl:'PK-305', stand:1, eibt:'15:20', buffer:34, tobt:'15:54', risk:'AMBER' },
    { fl:'ER-712', stand:2, eibt:'16:45', buffer:26, tobt:'17:11', risk:'GREEN' },
    { fl:'FZ-336', stand:5, eibt:'19:25', buffer:35, tobt:'20:00', risk:'AMBER' },
    { fl:'9P-118', stand:1, eibt:'18:10', buffer:27, tobt:'18:37', risk:'GREEN' },
    { fl:'PA-204', stand:4, eibt:'17:30', buffer:44, tobt:'18:14', risk:'RED' },
    { fl:'QR-612', stand:6, eibt:'20:05', buffer:29, tobt:'20:34', risk:'GREEN' },
    { fl:'EK-623', stand:2, eibt:'21:15', buffer:38, tobt:'21:53', risk:'AMBER' }
  ]);

  function rowHtml(r){
    return `<div class="board-row" data-fl="${r.fl}">
      <span>${r.fl}</span><span>${r.stand}</span><span>${r.eibt}</span>
      <span>${r.buffer} min</span><span>${r.tobt}</span>
      <span class="risk risk-${r.risk}"><span class="rdot"></span>${r.risk}</span></div>`;
  }
  function paintBoard(){
    const host = document.getElementById('board-scroll'); if(!host) return;
    // doubled for a seamless infinite loop
    host.innerHTML = (board.concat(board)).map(rowHtml).join('');
  }
  function buildTicks(){
    const g = document.getElementById('ring-ticks'); if(!g || g.childNodes.length) return;
    let s = '';
    for(let i=0;i<60;i++){ const a=(i/60)*2*Math.PI, r1=i%5===0?76:80, r2=86;
      const x1=100+r1*Math.cos(a), y1=100+r1*Math.sin(a), x2=100+r2*Math.cos(a), y2=100+r2*Math.sin(a);
      s += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`; }
    g.innerHTML = s;
  }
  function buildStandDots(){
    const g = document.getElementById('stand-pings'); if(!g || g.childNodes.length) return;
    const pos = [[100,14],[176,72],[150,178],[42,150]];
    g.innerHTML = pos.map(([x,y]) => `<circle class="stand-ping" cx="${x}" cy="${y}" r="4"/>`).join('');
  }

  function tickClock(){
    const d = new Date(), hms = `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
    const bc = document.getElementById('brand-clock');
    if(bc) bc.textContent = `${d.toLocaleDateString(undefined,{day:'2-digit',month:'short'})} · ${hms} · SHIFT A`;
  }
  let turnRemaining = 12*60 + 30;
  function tickTurn(){
    const el = document.getElementById('turn-count'); if(!el) return;
    turnRemaining = turnRemaining <= 0 ? 12*60 + 30 : turnRemaining - 1;
    el.textContent = `${pad2(Math.floor(turnRemaining/60))}:${pad2(turnRemaining%60)}`;
  }
  let heat = 47;
  function tickHeat(){
    heat = Math.max(34, Math.min(54, heat + (Math.random()*2 - 1)));
    const v = document.getElementById('heat-val'), f = document.getElementById('heat-fill');
    if(v) v.textContent = `${Math.round(heat)}°C`;
    if(f){ f.style.width = `${Math.round(((heat-30)/(56-30))*100)}%`;
      f.style.background = heat<38 ? 'var(--green)' : heat<=48 ? 'var(--amber)' : 'var(--red)'; }
  }
  function pingStand(){
    const g = document.getElementById('stand-pings'); if(!g) return;
    const dots = g.querySelectorAll('.stand-ping'); if(!dots.length) return;
    const d = dots[Math.floor(Math.random()*dots.length)];
    const wave = document.createElementNS('http://www.w3.org/2000/svg','circle');
    wave.setAttribute('class','ping-wave'); wave.setAttribute('cx', d.getAttribute('cx')); wave.setAttribute('cy', d.getAttribute('cy'));
    g.appendChild(wave); setTimeout(() => wave.remove(), 1500);
  }
  function simulateRisk(){
    if(!board.length) return;
    const i = Math.floor(Math.random()*board.length), r = board[i];
    if(Math.random() < 0.5){
      const order = ['GREEN','AMBER','RED'];
      r.risk = order[Math.min(order.length-1, order.indexOf(r.risk) + (Math.random()<0.5?1:-1)+1) % order.length] || r.risk;
      r.risk = order[Math.max(0, Math.min(2, order.indexOf(r.risk)))];
    } else {
      r.buffer = Math.max(20, Math.min(55, r.buffer + (Math.random()<0.5?-2:3)));
    }
    paintBoard();
    document.querySelectorAll(`.board-row[data-fl="${r.fl}"]`).forEach(row => {
      row.classList.add('flash'); setTimeout(() => row.classList.remove('flash'), 1100);
    });
  }

  return {
    init(){ board = seedBoard(); buildTicks(); buildStandDots(); paintBoard(); tickClock(); tickTurn(); tickHeat(); },
    start(){
      if(running) return; running = true;
      tickClock();
      timers.push(setInterval(tickClock, 1000));
      if(REDUCED) return;                        // static ambience under reduced-motion
      timers.push(setInterval(tickTurn, 1000));
      timers.push(setInterval(tickHeat, 2500));
      timers.push(setInterval(pingStand, 2600));
      timers.push(setInterval(simulateRisk, 9000));
    },
    stop(){ running = false; timers.forEach(clearInterval); timers = []; }
  };
})();

/* ═══ (5) VALIDATION HELPERS ════════════════════════════════ */

function isEmailFormat(v){ return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v); }
function emailProvider(v){ const m = /@([^.\s@]+)\./.exec(v); return m ? m[1].toLowerCase() : ''; }
function isCorporateEmail(v){ return isEmailFormat(v) && !FREE_PROVIDERS.has(emailProvider(v)); }

function passwordRules(pw){
  return { len:pw.length>=8, upper:/[A-Z]/.test(pw), number:/[0-9]/.test(pw), special:/[^A-Za-z0-9]/.test(pw) };
}
function passwordScore(pw){
  const r = passwordRules(pw); const met = Object.values(r).filter(Boolean).length;
  const labels = ['Very weak','Weak','Medium','Almost there','Strong'];
  const colors = ['var(--red)','#EA580C','#CA8A04','#CA8A04','var(--green)'];
  const idx = pw.length ? met : 0;
  return { met, rules:r, allMet:met===4, label:pw.length?labels[idx]:'—', color:colors[idx], pct:pw.length?(idx/4)*100:0 };
}
function strengthText(pw){ const s = passwordScore(pw); return s.allMet ? 'Strong' : s.label; }

/* ═══ (6) AUTH FLOW ═════════════════════════════════════════ */

let authMode = 'login';

function renderAuth(prefillEmail){
  authMode = 'login';
  const login = document.getElementById('login-form');
  const signup = document.getElementById('signup-form');
  const success = document.getElementById('signup-success');
  signup.hidden = true; success.hidden = true; login.hidden = false;
  login.reset(); signup.reset();
  clearFormMsg('login-msg'); clearFormMsg('signup-msg');
  document.querySelectorAll('#signup-form .field').forEach(f => f.classList.remove('ok','bad'));
  if(prefillEmail) document.getElementById('login-id').value = prefillEmail;
  cascade(login);
  showView('view-auth');
}

function cascade(card){
  card.classList.remove('cascade'); void card.offsetWidth; card.classList.add('cascade');
}

function swapAuth(toSignup){
  const login = document.getElementById('login-form');
  const signup = document.getElementById('signup-form');
  const outEl = toSignup ? login : signup;
  const inEl  = toSignup ? signup : login;
  outEl.classList.add(toSignup ? 'slide-out-left' : 'slide-out-right');
  outEl.addEventListener('animationend', function h(){
    outEl.removeEventListener('animationend', h);
    outEl.classList.remove('slide-out-left','slide-out-right'); outEl.hidden = true;
    inEl.hidden = false; inEl.classList.add(toSignup ? 'slide-in-right' : 'slide-in-left');
    inEl.addEventListener('animationend', function h2(){ inEl.removeEventListener('animationend', h2);
      inEl.classList.remove('slide-in-right','slide-in-left'); cascade(inEl); }, { once:true });
    authMode = toSignup ? 'signup' : 'login';
  }, { once:true });
}

function setFormMsg(id, text, type){
  const el = document.getElementById(id);
  el.className = `form-msg ${type}`; el.textContent = text; el.hidden = false;
}
function clearFormMsg(id){ const el = document.getElementById(id); el.hidden = true; el.textContent = ''; }
function shakeField(fieldEl){ fieldEl.classList.remove('shake'); void fieldEl.offsetWidth; fieldEl.classList.add('shake'); }

/* ── login ── */
async function handleLogin(e){
  e.preventDefault();
  const idEl = document.getElementById('login-id'), pwEl = document.getElementById('login-pw');
  const btn = document.getElementById('login-btn');
  const idVal = idEl.value.trim(), pw = pwEl.value;
  clearFormMsg('login-msg');

  if(!idVal){ shakeField(idEl.closest('.field')); setFormMsg('login-msg','Enter your email or username.','error'); return; }
  if(idVal !== 'admin' && !isEmailFormat(idVal)){ shakeField(idEl.closest('.field')); setFormMsg('login-msg','Enter a valid email address or username.','error'); return; }
  if(!pw){ shakeField(pwEl.closest('.field')); setFormMsg('login-msg','Enter your password.','error'); return; }

  setBtnLoading(btn, true, 'Signing in…');
  await wait(450);
  setBtnLoading(btn, false);

  const user = findUser(u => u.email === idVal || u.email.toLowerCase() === idVal.toLowerCase());
  if(!user || user.password !== pw){
    shakeField(pwEl.closest('.field')); setFormMsg('login-msg','Invalid email/username or password.','error'); return;
  }
  if(user.status === 'PENDING'){ setFormMsg('login-msg','Your account is pending administrator approval.','notice'); return; }
  if(user.status === 'REJECTED'){
    const reason = user.rejectionReason ? ` ${user.rejectionReason}` : '';
    setFormMsg('login-msg',`Your access request has been rejected.${reason}`,'error'); return;
  }
  if(user.status === 'SUSPENDED'){ setFormMsg('login-msg','Your account has been suspended. Contact your station admin.','error'); return; }

  // APPROVED → MFA
  pendingLogin = user;
  renderMFA();
}

/* ── signup live validation ── */
const signupTouched = {};

function validateSignupField(name, opts={}){
  const users = getUsers();
  const f = document.querySelector(`#signup-form .field[data-field="${name}"]`);
  if(!f) return false;
  const err = f.querySelector('.field-err');
  let ok = true, msg = '';

  if(name === 'name'){
    const v = document.getElementById('su-name').value.trim();
    if(v.length < 2){ ok = false; msg = 'Enter your full name (2+ characters).'; }
  } else if(name === 'email'){
    const v = document.getElementById('su-email').value.trim();
    if(!isEmailFormat(v)){ ok = false; msg = 'Enter a valid email address.'; }
    else if(!isCorporateEmail(v)){ ok = false; msg = 'Use your corporate email address.'; }
    else { const dup = users.find(u => u.email.toLowerCase() === v.toLowerCase());
      if(dup && dup.status !== 'REJECTED'){ ok = false; msg = 'An account with this email already exists.'; } }
  } else if(name === 'org'){
    if(!document.getElementById('su-org').value.trim()){ ok = false; msg = 'Organisation is required.'; }
  } else if(name === 'role'){
    if(!document.getElementById('su-role').value){ ok = false; msg = 'Select a role.'; }
  } else if(name === 'pw'){
    ok = passwordScore(document.getElementById('su-pw').value).allMet;
    if(!ok) msg = 'Password does not meet all four rules.';
  } else if(name === 'confirm'){
    const p = document.getElementById('su-pw').value, c = document.getElementById('su-confirm').value;
    if(!c || c !== p){ ok = false; msg = 'Passwords do not match.'; }
  }

  const touched = signupTouched[name];
  if(ok){ f.classList.remove('bad'); if(touched) f.classList.add('ok'); if(err) err.textContent = ''; }
  else { f.classList.remove('ok');
    if(touched){ f.classList.add('bad'); if(err) err.textContent = msg; if(opts.shake) shakeField(f); } }
  return ok;
}

function updateStrengthUI(){
  const pw = document.getElementById('su-pw').value;
  const s = passwordScore(pw);
  const fill = document.querySelector('#su-strength .strength-fill');
  const label = document.querySelector('#su-strength .strength-label');
  fill.style.width = `${s.pct}%`; fill.style.background = s.color;
  label.textContent = s.label; label.style.color = pw.length ? s.color : 'var(--text-mute)';
  document.querySelectorAll('#su-checklist li').forEach(li => li.classList.toggle('met', s.rules[li.dataset.rule]));
}

async function handleSignup(e){
  e.preventDefault();
  ['name','email','org','role','pw','confirm'].forEach(n => signupTouched[n] = true);
  const results = ['name','email','org','role','pw','confirm'].map(n => validateSignupField(n, { shake:true }));
  if(results.includes(false)){ setFormMsg('signup-msg','Please correct the highlighted fields.','error'); return; }
  clearFormMsg('signup-msg');

  const btn = document.getElementById('signup-btn');
  setBtnLoading(btn, true, 'Submitting…');
  await wait(500);
  setBtnLoading(btn, false);

  const email = document.getElementById('su-email').value.trim();
  const payload = {
    name: document.getElementById('su-name').value.trim(),
    email, password: document.getElementById('su-pw').value,
    organisation: document.getElementById('su-org').value.trim(),
    role: document.getElementById('su-role').value,
    status: 'PENDING', permissions:['flightboard'],
    registeredAt: new Date().toISOString(), decidedAt:null, decidedBy:null,
    rejectionReason:null, sessionActive:false, lastActiveAt:null
  };

  const users = getUsers();
  const existingRejected = users.find(u => u.email.toLowerCase() === email.toLowerCase() && u.status === 'REJECTED');
  if(existingRejected){ Object.assign(existingRejected, payload, { id: existingRejected.id }); }
  else { users.push(Object.assign({ id: uid('u') }, payload)); }
  saveUsers(users);
  logActivity({ action:'submitted access request', target:email, category:'auth', severity:'info' });

  // success panel + 3s ring, then back to login prefilled
  showSignupSuccess(email);
  showToast('Registration submitted — awaiting approval', 'success');
}

function showSignupSuccess(email){
  const signup = document.getElementById('signup-form'), success = document.getElementById('signup-success');
  signup.hidden = true; success.hidden = false;
  const ring = document.getElementById('sr-fill'); ring.classList.remove('run'); void ring.getBoundingClientRect(); ring.classList.add('run');
  setTimeout(() => { success.hidden = true; renderAuth(email); }, 3000);
}

/* ── MFA ── */
let pendingLogin = null;
let mfaVerifying = false;   // guards against the auto-submit firing twice

function renderMFA(){
  mfaVerifying = false;
  const boxes = [...document.querySelectorAll('.mfa-box')];
  boxes.forEach((b,i) => { b.value=''; b.classList.remove('shown','pop','fading'); void b.offsetWidth;
    setTimeout(() => b.classList.add('shown'), i*65); });
  document.getElementById('mfa-msg').hidden = true;
  document.getElementById('mfa-success').hidden = true;
  showView('view-mfa');
  setTimeout(() => boxes[0].focus(), 360);
}

function wireMFA(){
  const boxes = [...document.querySelectorAll('.mfa-box')];
  boxes.forEach((box, i) => {
    box.addEventListener('input', () => {
      box.value = box.value.replace(/\D/g,'').slice(0,1);
      if(box.value){ box.classList.add('pop'); setTimeout(() => box.classList.remove('pop'), 120);
        if(i < 4) boxes[i+1].focus(); }
      if(boxes.every(b => b.value)) submitMFA();
    });
    box.addEventListener('keydown', e => {
      if(e.key === 'Backspace' && !box.value && i > 0) boxes[i-1].focus();
    });
    box.addEventListener('paste', e => {
      e.preventDefault();
      const digits = (e.clipboardData.getData('text').match(/\d/g) || []).slice(0,5);
      digits.forEach((d,k) => { if(boxes[k]){ boxes[k].value = d; boxes[k].classList.add('shown'); } });
      if(digits.length) boxes[Math.min(digits.length,5)-1].focus();
      if(digits.length === 5) submitMFA();
    });
  });
  document.getElementById('mfa-back').addEventListener('click', () => { pendingLogin = null; renderAuth(); });
}

async function submitMFA(){
  if(mfaVerifying) return;                       // already handling this code
  const boxes = [...document.querySelectorAll('.mfa-box')];
  const code = boxes.map(b => b.value).join('');
  const group = document.getElementById('mfa-inputs');
  const msg = document.getElementById('mfa-msg');

  if(code !== MFA_CODE){
    msg.className = 'form-msg error mfa-msg'; msg.textContent = 'Incorrect code. Please try again.'; msg.hidden = false;
    group.classList.add('shake'); setTimeout(() => group.classList.remove('shake'), 350);
    boxes.forEach(b => b.classList.add('fading'));
    setTimeout(() => { boxes.forEach(b => { b.value=''; b.classList.remove('fading'); }); boxes[0].focus(); }, 450);
    return;
  }

  const user = pendingLogin;
  if(!user){ renderAuth(); return; }             // no pending login — bail safely
  mfaVerifying = true;
  pendingLogin = null;

  msg.hidden = true;
  document.getElementById('mfa-success').hidden = false;

  setSession(user);
  updateUser(user.id, { sessionActive:true, lastActiveAt:new Date().toISOString() });
  logActivity({ action:'signed in', target:user.email, category:'auth', severity:'success' });

  await wait(1050);
  sessionMgr.start();
  if(user.role === 'SUPER_ADMIN') renderAdmin();
  else renderApp();
  mfaVerifying = false;
}

function setBtnLoading(btn, loading, text){
  const sp = btn.querySelector('.spinner'), lbl = btn.querySelector('.btn-text');
  if(loading){ if(lbl){ btn.dataset.idle = lbl.textContent; lbl.textContent = text || lbl.textContent; }
    if(sp) sp.hidden = false; btn.disabled = true; }
  else { if(lbl && btn.dataset.idle) lbl.textContent = btn.dataset.idle; if(sp) sp.hidden = true; btn.disabled = false; }
}
const wait = ms => new Promise(r => setTimeout(r, ms));

/* ═══ (7) SESSION MANAGER ═══════════════════════════════════ */

const sessionMgr = (function(){
  let timer = null, activeUserId = null;

  function fmt(ms){ const s = Math.max(0, Math.floor(ms/1000)); return `${pad2(Math.floor(s/60))}:${pad2(s%60)}`; }

  function paint(){
    // Read the raw record, not getSession() — the getter auto-clears an expired
    // session and returns null, which would hide the expiry from us.
    const s = readJSON(SESSION_KEY, null);
    if(!s || !s.expiresAt){ if(timer) expire(); return; }
    const remaining = s.expiresAt - Date.now();
    if(remaining <= 0){ expire(); return; }
    ['admin','app'].forEach(v => {
      const pill = document.getElementById(`${v}-session`); if(!pill) return;
      pill.querySelector('.sp-time').textContent = fmt(remaining);
      pill.classList.toggle('warn', remaining <= 120000 && remaining > 60000);
      pill.classList.toggle('danger', remaining <= 60000);
    });
    const now = new Date();
    ['admin','app'].forEach(v => { const c = document.getElementById(`${v}-clock`);
      if(c) c.textContent = `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`; });
  }

  function topUp(){
    const s = readJSON(SESSION_KEY, null); if(!s) return;
    s.expiresAt = Date.now() + SESSION_MS;
    localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    paint();   // reflect the reset immediately, don't wait for the next tick
  }

  function expire(){
    stop();
    if(activeUserId) updateUser(activeUserId, { sessionActive:false, lastActiveAt:new Date().toISOString() });
    activeUserId = null;
    clearSession();
    renderAuth();
    showToast('Session expired — please sign in again', 'notice');
  }

  function onActivity(){ if(timer && readJSON(SESSION_KEY, null)) topUp(); }

  function start(){
    stop();
    const s = readJSON(SESSION_KEY, null); activeUserId = s ? s.userId : null;
    timer = setInterval(paint, 1000); paint();
    document.addEventListener('click', onActivity, true);
    document.addEventListener('keydown', onActivity, true);
  }
  function stop(){ if(timer) clearInterval(timer); timer = null;
    document.removeEventListener('click', onActivity, true);
    document.removeEventListener('keydown', onActivity, true); }

  return { start, stop, expire };
})();

function handleSignOut(){
  const s = getSession();
  if(s){ updateUser(s.userId, { sessionActive:false, lastActiveAt:new Date().toISOString() });
    logActivity({ action:'signed out', target:s.email, category:'auth', severity:'info' }); }
  sessionMgr.stop(); clearSession(); renderAuth(); showToast('Signed out', 'notice');
}

/* ═══ (8) ADMIN DASHBOARD ═══════════════════════════════════ */

let adminFilters = { q:'', status:'ALL', role:'ALL' };
let selectedIds = new Set();
let adminLoaded = false;

async function renderAdmin(){
  const s = getSession();
  document.getElementById('admin-who').textContent = s ? s.name : '';
  showView('view-admin');

  const skel = document.getElementById('admin-skeleton'), content = document.getElementById('admin-content');
  if(!adminLoaded){ skel.hidden = false; content.hidden = true; await wait(LOAD_DELAY); adminLoaded = true; }
  skel.hidden = true; content.hidden = false;

  renderStats({ animate:true });
  renderUsers();
  renderActivity();
}

function renderStats({ animate=false }={}){
  const c = { PENDING:0, APPROVED:0, REJECTED:0, SUSPENDED:0 };
  getUsers().forEach(u => { if(c[u.status] !== undefined) c[u.status]++; });
  const map = { 'c-pending':c.PENDING, 'c-approved':c.APPROVED, 'c-rejected':c.REJECTED, 'c-suspended':c.SUSPENDED };
  Object.entries(map).forEach(([id,v]) => { const el = document.getElementById(id);
    if(animate) countUp(el, v); else el.textContent = String(v); });

  const banner = document.getElementById('pending-banner');
  if(c.PENDING > 0){ banner.hidden = false;
    banner.querySelector('.pb-text').textContent = `${c.PENDING} access request${c.PENDING>1?'s':''} awaiting review`; }
  else banner.hidden = true;

  document.getElementById('user-total').textContent = `${getUsers().length} registered`;
}

function accessStripHtml(user){
  return `<span class="access-strip">` + ALL_MODULES.map(m => {
    const on = user.permissions && user.permissions.includes(m);
    return `<span class="am ${on?'on':''}" title="${MODULES[m].label}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICONS[m]}</svg></span>`;
  }).join('') + `</span>`;
}
function statusBadge(s){ const cls = { APPROVED:'b-approved', PENDING:'b-pending', REJECTED:'b-rejected', SUSPENDED:'b-suspended' }[s] || 'b-suspended';
  return `<span class="badge ${cls}"><span class="dot"></span>${STATUSES[s]||s}</span>`; }

function sessionCellHtml(user){
  if(user.sessionActive) return `<span class="session-cell"><span class="live"><span class="dot"></span>Active</span></span>`;
  return `<span class="session-cell"><span class="idle">Last active ${relTime(user.lastActiveAt)}</span></span>`;
}

function renderUsers(){
  const tbody = document.getElementById('users-body');
  const emptyEl = document.getElementById('users-empty');
  const session = getSession();
  const q = adminFilters.q.trim().toLowerCase();

  let rows = getUsers().filter(u => {
    if(adminFilters.status !== 'ALL' && u.status !== adminFilters.status) return false;
    if(adminFilters.role !== 'ALL' && u.role !== adminFilters.role) return false;
    if(q && !(`${u.name} ${u.email}`.toLowerCase().includes(q))) return false;
    return true;
  }).sort((a,b) => {
    const order = { PENDING:0, APPROVED:1, SUSPENDED:2, REJECTED:3 };
    if(order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
    return new Date(b.registeredAt) - new Date(a.registeredAt);
  });

  if(!rows.length){
    tbody.innerHTML = ''; emptyEl.hidden = false;
    emptyEl.innerHTML = `<div class="empty"><div class="empty-ico">
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M20 20 L16.5 16.5"/></svg></div>
      <h4>No matching users</h4><p>Try a different search term or filter.</p></div>`;
    return;
  }
  emptyEl.hidden = true;

  tbody.innerHTML = rows.map(u => {
    const isSelf = session && u.id === session.userId;
    return `<tr data-id="${u.id}" class="${selectedIds.has(u.id)?'selected':''}">
      <td class="cell-check"><input type="checkbox" data-check="${u.id}" ${selectedIds.has(u.id)?'checked':''} aria-label="Select ${escapeHtml(u.name)}" /></td>
      <td class="td-name">${escapeHtml(u.name)}${isSelf?' <span class="you-tag">You</span>':''}</td>
      <td class="td-email">${escapeHtml(u.email)}</td>
      <td><span class="role-badge">${escapeHtml(ROLES[u.role]||u.role)}</span></td>
      <td>${statusBadge(u.status)}</td>
      <td>${accessStripHtml(u)}</td>
      <td>${sessionCellHtml(u)}</td>
      <td class="mono" style="font-size:11.5px;color:var(--text-mute)">${fmtDate(u.registeredAt)}</td>
      <td class="th-act"><button class="kebab-btn" data-kebab="${u.id}" aria-label="Actions">
        <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg></button></td>
    </tr>`;
  }).join('');

  document.getElementById('check-all').checked = rows.length > 0 && rows.every(u => selectedIds.has(u.id));
  updateBulkBar();
}

function updateBulkBar(){
  const bar = document.getElementById('bulkbar');
  if(selectedIds.size){ bar.hidden = false; document.getElementById('bulk-n').textContent = String(selectedIds.size); }
  else bar.hidden = true;
}

function flashRow(id){ const r = document.querySelector(`tr[data-id="${id}"]`); if(r){ r.classList.add('flash'); setTimeout(() => r.classList.remove('flash'), 1000); } }

/* ── row action menu ── */
function openRowMenu(id, anchor){
  const user = findUser(u => u.id === id); if(!user) return;
  const session = getSession();
  const isSelf = session && id === session.userId;
  const isSeed = id === 'seed-admin';
  const items = [];

  items.push({ key:'view', label:'View details', onClick:() => openDrawer(id) });
  items.push({ key:'perms', label:'Access permissions', onClick:() => openPermissions(id) });
  items.push({ key:'edit', label:'Edit user', onClick:() => openEditUser(id) });
  items.push({ key:'reset', label:'Reset password', onClick:() => openResetPassword(id) });

  if(isSelf || isSeed){ items.push({ sep:true }); items.push({ note:'This is you — self-management is disabled' }); openKebab(anchor, items); return; }

  items.push({ sep:true });
  if(user.status !== 'APPROVED') items.push({ key:'approve', label:'Approve', onClick:() => approveUser(id) });
  if(user.status !== 'REJECTED') items.push({ key:'reject', label:'Reject', onClick:() => rejectUser(id) });
  if(user.status === 'APPROVED') items.push({ key:'suspend', label:'Suspend', onClick:() => suspendUser(id) });
  if(user.status === 'SUSPENDED') items.push({ key:'reactivate', label:'Reactivate', onClick:() => reactivateUser(id) });
  if(user.sessionActive) items.push({ key:'revoke', label:'Revoke session', onClick:() => revokeSession(id) });
  items.push({ sep:true });
  items.push({ key:'delete', label:'Delete user', danger:true, onClick:() => deleteUser(id) });

  openKebab(anchor, items);
}

/* ── individual actions ── */
function afterMutation(){ renderStats(); renderUsers(); renderActivity(); }

function approveUser(id){
  const s = getSession(); const u = updateUser(id, { status:'APPROVED', decidedAt:new Date().toISOString(), decidedBy:s?s.name:'Admin', rejectionReason:null });
  logActivity({ action:'approved user', target:u.email, category:'user', severity:'success' });
  afterMutation(); flashRow(id); showToast(`${u.name} approved`, 'success');
}
async function rejectUser(id){
  const u = findUser(x => x.id === id);
  const res = await confirmDialog({ title:'Reject access request', message:`Reject ${u.name}? Provide a reason — the applicant will see it at sign-in.`,
    confirmLabel:'Reject', withReason:true, reasonLabel:'Rejection reason' });
  if(!res) return;
  const s = getSession();
  updateUser(id, { status:'REJECTED', decidedAt:new Date().toISOString(), decidedBy:s?s.name:'Admin', rejectionReason:res.reason || null, sessionActive:false });
  logActivity({ action:'rejected user', target:u.email, category:'user', severity:'warn' });
  afterMutation(); flashRow(id); showToast(`${u.name} rejected`, 'notice');
}
async function suspendUser(id){
  const u = findUser(x => x.id === id);
  const ok = await confirmDialog({ title:'Suspend user', message:`Suspend ${u.name}? They will be unable to sign in until reactivated.`, confirmLabel:'Suspend' });
  if(!ok) return;
  const s = getSession();
  updateUser(id, { status:'SUSPENDED', decidedAt:new Date().toISOString(), decidedBy:s?s.name:'Admin', sessionActive:false });
  logActivity({ action:'suspended user', target:u.email, category:'user', severity:'warn' });
  afterMutation(); flashRow(id); showToast(`${u.name} suspended`, 'notice');
}
function reactivateUser(id){
  const s = getSession(); const u = updateUser(id, { status:'APPROVED', decidedAt:new Date().toISOString(), decidedBy:s?s.name:'Admin' });
  logActivity({ action:'reactivated user', target:u.email, category:'user', severity:'success' });
  afterMutation(); flashRow(id); showToast(`${u.name} reactivated`, 'success');
}
async function deleteUser(id){
  const u = findUser(x => x.id === id);
  const ok = await confirmDialog({ title:'Delete user', message:`Permanently delete ${u.name}? This cannot be undone.`, confirmLabel:'Delete' });
  if(!ok) return;
  const row = document.querySelector(`tr[data-id="${id}"]`);
  const finish = () => { saveUsers(getUsers().filter(x => x.id !== id)); selectedIds.delete(id);
    logActivity({ action:'deleted user', target:u.email, category:'user', severity:'danger' }); afterMutation(); showToast(`${u.name} deleted`, 'error'); };
  if(row){ row.classList.add('removing'); setTimeout(finish, 350); } else finish();
}
function revokeSession(id){
  const u = updateUser(id, { sessionActive:false, lastActiveAt:new Date().toISOString() });
  logActivity({ action:'revoked session', target:u.email, category:'security', severity:'warn' });
  renderUsers(); showToast(`Session revoked for ${u.name}`, 'notice');
}

/* ── bulk actions ── */
async function bulkAction(kind){
  const ids = [...selectedIds]; if(!ids.length) return;
  const session = getSession();
  const actable = ids.filter(id => id !== 'seed-admin' && !(session && id === session.userId));

  if(kind === 'clear'){ selectedIds.clear(); renderUsers(); return; }
  if(kind === 'approve'){
    actable.forEach(id => updateUser(id, { status:'APPROVED', decidedAt:new Date().toISOString(), decidedBy:session?session.name:'Admin', rejectionReason:null }));
    logActivity({ action:`bulk-approved ${actable.length} user(s)`, target:'—', category:'user', severity:'success' });
    selectedIds.clear(); afterMutation(); showToast(`${actable.length} user(s) approved`, 'success'); return;
  }
  if(kind === 'reject'){
    const res = await confirmDialog({ title:`Reject ${actable.length} user(s)`, message:'Provide a reason applied to all selected requests.', confirmLabel:'Reject all', withReason:true, reasonLabel:'Rejection reason' });
    if(!res) return;
    actable.forEach(id => updateUser(id, { status:'REJECTED', decidedAt:new Date().toISOString(), decidedBy:session?session.name:'Admin', rejectionReason:res.reason||null, sessionActive:false }));
    logActivity({ action:`bulk-rejected ${actable.length} user(s)`, target:'—', category:'user', severity:'warn' });
    selectedIds.clear(); afterMutation(); showToast(`${actable.length} user(s) rejected`, 'notice'); return;
  }
  if(kind === 'delete'){
    const ok = await confirmDialog({ title:`Delete ${actable.length} user(s)`, message:'This permanently removes the selected users and cannot be undone.', confirmLabel:'Delete all' });
    if(!ok) return;
    const del = new Set(actable);
    saveUsers(getUsers().filter(u => !del.has(u.id)));
    logActivity({ action:`bulk-deleted ${actable.length} user(s)`, target:'—', category:'user', severity:'danger' });
    selectedIds.clear(); afterMutation(); showToast(`${actable.length} user(s) deleted`, 'error'); return;
  }
}

/* ── Add / Edit / Reset password modals ── */
function pwFieldBlock(idPrefix){
  return `<div class="field" data-field="${idPrefix}-pw">
      <label for="${idPrefix}-pw">Password</label>
      <div class="input-wrap"><input type="password" id="${idPrefix}-pw" placeholder="••••••••" autocomplete="new-password" />
        <button type="button" class="eye" data-eye="${idPrefix}-pw" tabindex="-1" aria-label="Show"></button></div>
      <div class="strength" id="${idPrefix}-strength"><div class="strength-bar"><span class="strength-fill"></span></div><span class="strength-label">—</span></div>
      <ul class="pw-checklist" id="${idPrefix}-checklist">
        <li data-rule="len"><span class="tick"></span>8+ characters</li><li data-rule="upper"><span class="tick"></span>Uppercase</li>
        <li data-rule="number"><span class="tick"></span>Number</li><li data-rule="special"><span class="tick"></span>Special character</li></ul></div>`;
}
function wirePwMeter(idPrefix){
  const input = document.getElementById(`${idPrefix}-pw`); if(!input) return;
  input.addEventListener('input', () => {
    const s = passwordScore(input.value);
    const fill = document.querySelector(`#${idPrefix}-strength .strength-fill`);
    const label = document.querySelector(`#${idPrefix}-strength .strength-label`);
    fill.style.width = `${s.pct}%`; fill.style.background = s.color;
    label.textContent = s.label; label.style.color = input.value.length ? s.color : 'var(--text-mute)';
    document.querySelectorAll(`#${idPrefix}-checklist li`).forEach(li => li.classList.toggle('met', s.rules[li.dataset.rule]));
  });
}
function genPassword(){
  const U='ABCDEFGHJKLMNPQRSTUVWXYZ', L='abcdefghijkmnpqrstuvwxyz', N='23456789', S='!@#$%&*?';
  const pick = set => set[Math.floor(Math.random()*set.length)];
  let pw = pick(U)+pick(L)+pick(N)+pick(S);
  const all = U+L+N+S; for(let i=0;i<8;i++) pw += pick(all);
  return pw.split('').sort(() => Math.random()-0.5).join('');
}
function roleOptions(sel){ return Object.entries(ROLES).filter(([k]) => k !== 'SUPER_ADMIN')
  .map(([k,v]) => `<option value="${k}" ${sel===k?'selected':''}>${v}</option>`).join(''); }

function openAddUser(){
  const modal = openModal(`
    <div class="modal-head"><div><h3>Add User</h3><p>Admin-created users are approved immediately.</p></div>
      <button class="modal-x" data-x aria-label="Close"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6 L18 18 M18 6 L6 18"/></svg></button></div>
    <div class="field" data-field="au-name"><label for="au-name">Full name</label><div class="input-wrap"><input type="text" id="au-name" placeholder="Jane Doe" /></div><p class="field-err"></p></div>
    <div class="field" data-field="au-email"><label for="au-email">Corporate email</label><div class="input-wrap"><input type="text" id="au-email" placeholder="jane@menzies-ras.pk" /></div><p class="field-err"></p></div>
    <div class="grid-2">
      <div class="field"><label for="au-org">Organisation</label><div class="input-wrap"><input type="text" id="au-org" placeholder="Menzies-RAS" /></div></div>
      <div class="field"><label for="au-role">Role</label><div class="input-wrap"><select id="au-role"><option value="" selected disabled>Select…</option>${roleOptions()}</select></div></div>
    </div>
    <div class="toggle-row"><label for="au-gen" style="font-size:13px;font-weight:500">Auto-generate secure password</label>
      <label class="switch"><input type="checkbox" id="au-gen" /><span class="slider"></span></label></div>
    <div id="au-pw-manual">${pwFieldBlock('au')}</div>
    <div id="au-pw-gen" hidden><div class="gen-pw"><code id="au-genpw"></code><button type="button" class="btn btn-ghost btn-xs" id="au-regen">Regenerate</button></div><p class="modal-note">Shown once — copy and share it with the user manually.</p></div>
    <div class="modal-foot"><button class="btn btn-ghost" data-x>Cancel</button><button class="btn btn-primary" id="au-save">Create user</button></div>`);

  wirePwMeter('au');
  modal.querySelectorAll('[data-x]').forEach(b => b.onclick = closeModal);
  modal.querySelectorAll('.eye').forEach(wireEyeEl);

  const genToggle = modal.querySelector('#au-gen');
  const setGen = () => { const on = genToggle.checked;
    modal.querySelector('#au-pw-manual').hidden = on; modal.querySelector('#au-pw-gen').hidden = !on;
    if(on) modal.querySelector('#au-genpw').textContent = genPassword(); };
  genToggle.onchange = setGen;
  modal.querySelector('#au-regen').onclick = () => modal.querySelector('#au-genpw').textContent = genPassword();

  modal.querySelector('#au-save').onclick = () => {
    const name = modal.querySelector('#au-name').value.trim();
    const email = modal.querySelector('#au-email').value.trim();
    const org = modal.querySelector('#au-org').value.trim();
    const role = modal.querySelector('#au-role').value;
    const gen = genToggle.checked;
    const pw = gen ? modal.querySelector('#au-genpw').textContent : modal.querySelector('#au-pw').value;

    let bad = false;
    const fail = (sel, msg) => { const f = modal.querySelector(sel); f.classList.add('bad'); f.querySelector('.field-err').textContent = msg; bad = true; };
    modal.querySelectorAll('.field').forEach(f => f.classList.remove('bad'));
    if(name.length < 2) fail('[data-field="au-name"]','Enter a full name.');
    if(!isEmailFormat(email)) fail('[data-field="au-email"]','Enter a valid email.');
    else if(!isCorporateEmail(email)) fail('[data-field="au-email"]','Use a corporate email address.');
    else if(findUser(u => u.email.toLowerCase() === email.toLowerCase())) fail('[data-field="au-email"]','Email already exists.');
    if(!org){ showToast('Organisation is required','error'); bad = true; }
    if(!role){ showToast('Select a role','error'); bad = true; }
    if(!gen && !passwordScore(pw).allMet){ fail('[data-field="au-pw"]','Password must meet all four rules.'); }
    if(bad) return;

    const s = getSession();
    const users = getUsers();
    users.push({ id:uid('u'), name, email, password:pw, organisation:org, role, status:'APPROVED',
      permissions:['flightboard'], registeredAt:new Date().toISOString(), decidedAt:new Date().toISOString(),
      decidedBy:s?s.name:'Admin', rejectionReason:null, sessionActive:false, lastActiveAt:null });
    saveUsers(users);
    logActivity({ action:'created user', target:email, category:'user', severity:'success' });
    closeModal(); afterMutation(); showToast(`${name} created`, 'success');
  };
}

function openEditUser(id){
  const u = findUser(x => x.id === id); if(!u) return;
  const modal = openModal(`
    <div class="modal-head"><div><h3>Edit User</h3><p>${escapeHtml(u.name)}</p></div>
      <button class="modal-x" data-x aria-label="Close"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6 L18 18 M18 6 L6 18"/></svg></button></div>
    <div class="field" data-field="eu-name"><label for="eu-name">Full name</label><div class="input-wrap"><input type="text" id="eu-name" value="${escapeHtml(u.name)}" /></div><p class="field-err"></p></div>
    <div class="field" data-field="eu-email"><label for="eu-email">Corporate email</label><div class="input-wrap"><input type="text" id="eu-email" value="${escapeHtml(u.email)}" /></div><p class="field-err"></p></div>
    <div class="grid-2">
      <div class="field"><label for="eu-org">Organisation</label><div class="input-wrap"><input type="text" id="eu-org" value="${escapeHtml(u.organisation)}" /></div></div>
      <div class="field"><label for="eu-role">Role</label><div class="input-wrap"><select id="eu-role" ${u.id==='seed-admin'?'disabled':''}>${u.role==='SUPER_ADMIN'?'<option value="SUPER_ADMIN" selected>System Administrator</option>':roleOptions(u.role)}</select></div></div>
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" data-x>Cancel</button><button class="btn btn-primary" id="eu-save">Save changes</button></div>`);
  modal.querySelectorAll('[data-x]').forEach(b => b.onclick = closeModal);
  modal.querySelector('#eu-save').onclick = () => {
    const name = modal.querySelector('#eu-name').value.trim();
    const email = modal.querySelector('#eu-email').value.trim();
    const org = modal.querySelector('#eu-org').value.trim();
    const role = u.id === 'seed-admin' ? u.role : modal.querySelector('#eu-role').value;
    modal.querySelectorAll('.field').forEach(f => f.classList.remove('bad'));
    let bad = false;
    const fail = (sel,msg) => { const f = modal.querySelector(sel); f.classList.add('bad'); f.querySelector('.field-err').textContent = msg; bad = true; };
    if(name.length < 2) fail('[data-field="eu-name"]','Enter a full name.');
    if(!isEmailFormat(email)) fail('[data-field="eu-email"]','Enter a valid email.');
    else if(!isCorporateEmail(email) && email !== 'admin') fail('[data-field="eu-email"]','Use a corporate email address.');
    else { const dup = findUser(x => x.email.toLowerCase() === email.toLowerCase() && x.id !== id); if(dup) fail('[data-field="eu-email"]','Email already exists.'); }
    if(bad) return;
    updateUser(id, { name, email, organisation:org, role });
    logActivity({ action:'edited user', target:email, category:'user', severity:'info' });
    closeModal(); afterMutation(); showToast(`${name} updated`, 'success');
  };
}

function openResetPassword(id){
  const u = findUser(x => x.id === id); if(!u) return;
  const modal = openModal(`
    <div class="modal-head"><div><h3>Reset Password</h3><p>${escapeHtml(u.name)}</p></div>
      <button class="modal-x" data-x aria-label="Close"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6 L18 18 M18 6 L6 18"/></svg></button></div>
    <div class="toggle-row"><label for="rp-gen" style="font-size:13px;font-weight:500">Auto-generate secure password</label>
      <label class="switch"><input type="checkbox" id="rp-gen" /><span class="slider"></span></label></div>
    <div id="rp-manual">${pwFieldBlock('rp')}</div>
    <div id="rp-gen-box" hidden><div class="gen-pw"><code id="rp-genpw"></code><button type="button" class="btn btn-ghost btn-xs" id="rp-regen">Regenerate</button></div><p class="modal-note">Shown once — copy and share it with the user manually.</p></div>
    <div class="modal-foot"><button class="btn btn-ghost" data-x>Cancel</button><button class="btn btn-primary" id="rp-save">Reset password</button></div>`);
  wirePwMeter('rp');
  modal.querySelectorAll('[data-x]').forEach(b => b.onclick = closeModal);
  modal.querySelectorAll('.eye').forEach(wireEyeEl);
  const gen = modal.querySelector('#rp-gen');
  gen.onchange = () => { const on = gen.checked; modal.querySelector('#rp-manual').hidden = on; modal.querySelector('#rp-gen-box').hidden = !on;
    if(on) modal.querySelector('#rp-genpw').textContent = genPassword(); };
  modal.querySelector('#rp-regen').onclick = () => modal.querySelector('#rp-genpw').textContent = genPassword();
  modal.querySelector('#rp-save').onclick = () => {
    const on = gen.checked; const pw = on ? modal.querySelector('#rp-genpw').textContent : modal.querySelector('#rp-pw').value;
    if(!on && !passwordScore(pw).allMet){ const f = modal.querySelector('[data-field="rp-pw"]'); f.classList.add('bad'); f.querySelector('.field-err').textContent = 'Password must meet all four rules.'; return; }
    updateUser(id, { password:pw });
    logActivity({ action:'reset password', target:u.email, category:'security', severity:'warn' });
    closeModal(); showToast(`Password reset for ${u.name}`, 'success');
  };
}

/* ── access permissions panel ── */
function openPermissions(id){
  const u = findUser(x => x.id === id); if(!u) return;
  let perms = new Set(u.permissions && u.permissions.length ? u.permissions : ['flightboard']);
  perms.add('flightboard');

  const itemHtml = m => `<div class="perm-item ${perms.has(m)?'on':''} ${MODULES[m].locked?'locked':''}" data-perm="${m}">
      <span class="perm-check"></span>
      <span class="perm-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICONS[m]}</svg></span>
      <span class="perm-label">${MODULES[m].label}</span>${MODULES[m].locked?'<span class="perm-lock">LOCKED</span>':''}</div>`;

  const modal = openModal(`
    <div class="modal-head"><div><h3>Access permissions</h3><p>${escapeHtml(u.name)} — choose the ORBIS modules this user can open.</p></div>
      <button class="modal-x" data-x aria-label="Close"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6 L18 18 M18 6 L6 18"/></svg></button></div>
    <div class="perm-shortcuts"><button id="perm-all">Select all</button><button id="perm-clear">Clear all</button></div>
    <div class="perm-grid" id="perm-grid">${ALL_MODULES.map(itemHtml).join('')}</div>
    <div class="perm-preview" id="perm-preview"></div>
    <div class="modal-foot"><button class="btn btn-ghost" data-x>Cancel</button><button class="btn btn-primary" id="perm-save">Save access</button></div>`, true);

  const preview = () => {
    modal.querySelector('#perm-preview').innerHTML =
      `This user's navigation will show: <strong>${ALL_MODULES.filter(m => perms.has(m)).map(m => MODULES[m].label).join(', ')}</strong>`;
  };
  const repaint = () => {
    modal.querySelectorAll('.perm-item').forEach(el => el.classList.toggle('on', perms.has(el.dataset.perm)));
    preview();
  };
  preview();

  modal.querySelector('#perm-grid').onclick = e => {
    const item = e.target.closest('.perm-item'); if(!item) return;
    const m = item.dataset.perm; if(MODULES[m].locked) return;
    if(perms.has(m)) perms.delete(m); else perms.add(m);
    repaint();
  };
  modal.querySelector('#perm-all').onclick = () => { perms = new Set(ALL_MODULES); repaint(); };
  modal.querySelector('#perm-clear').onclick = () => { perms = new Set(['flightboard']); repaint(); };
  modal.querySelectorAll('[data-x]').forEach(b => b.onclick = closeModal);

  modal.querySelector('#perm-save').onclick = () => {
    const list = ALL_MODULES.filter(m => perms.has(m));
    updateUser(id, { permissions:list });
    logActivity({ action:'updated access permissions', target:u.email, category:'security', severity:'info' });
    closeModal(); renderUsers(); showToast(`Access updated for ${u.name}`, 'success');
  };
}

/* ── detail drawer ── */
function openDrawer(id){
  const u = findUser(x => x.id === id); if(!u) return;
  const acts = getActivity().filter(a => a.target === u.email).slice(0, 8);
  const pwAssess = passwordScore(u.password);
  const host = document.getElementById('drawer-host');
  host.innerHTML = `
    <div class="drawer">
      <div class="drawer-head"><h3 style="font-size:15px;font-weight:700">User details</h3>
        <button class="modal-x" data-x aria-label="Close"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6 L18 18 M18 6 L6 18"/></svg></button></div>
      <div class="drawer-body">
        <div class="drawer-avatar">${escapeHtml(initials(u.name))}</div>
        <div class="dw-name">${escapeHtml(u.name)}</div>
        <div class="dw-email">${escapeHtml(u.email)}</div>
        <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">${statusBadge(u.status)}<span class="role-badge">${escapeHtml(ROLES[u.role]||u.role)}</span></div>
        <div class="dw-section"><h4>Account</h4>
          <div class="dw-grid">
            <div class="dw-item"><div class="k">Organisation</div><div class="v">${escapeHtml(u.organisation||'—')}</div></div>
            <div class="dw-item"><div class="k">Registered</div><div class="v">${fmtDate(u.registeredAt)}</div></div>
            <div class="dw-item"><div class="k">Decision</div><div class="v">${u.decidedBy?escapeHtml(u.decidedBy)+' · '+fmtDate(u.decidedAt):'—'}</div></div>
            <div class="dw-item"><div class="k">Session</div><div class="v">${u.sessionActive?'Active now':'Last active '+relTime(u.lastActiveAt)}</div></div>
          </div>
          ${u.rejectionReason?`<div class="dw-item" style="margin-top:12px"><div class="k">Rejection reason</div><div class="v">${escapeHtml(u.rejectionReason)}</div></div>`:''}
        </div>
        <div class="dw-section"><h4>Password strength</h4>
          <div class="strength"><div class="strength-bar"><span class="strength-fill" style="width:${pwAssess.pct}%;background:${pwAssess.color}"></span></div><span class="strength-label" style="color:${pwAssess.color}">${pwAssess.label}</span></div>
        </div>
        <div class="dw-section"><h4>Current permissions</h4>
          <div class="dw-perms">${(u.permissions||['flightboard']).map(m => `<span class="dw-perm">${MODULES[m]?MODULES[m].label:m}</span>`).join('')}</div>
        </div>
        <div class="dw-section"><h4>Activity history</h4>
          ${acts.length ? acts.map(a => `<div class="dw-act"><span class="sev act-sev ${a.severity}"></span><div><div>${escapeHtml(a.action)}</div><div class="act-meta">${escapeHtml(a.actor)} · ${fmtDateTime(a.timestamp)}</div></div></div>`).join('')
            : '<p style="font-size:12.5px;color:var(--text-mute)">No recorded activity for this user.</p>'}
        </div>
      </div>
    </div>`;
  host.hidden = false;
  host.onclick = e => { if(e.target === host || e.target.closest('[data-x]')) closeDrawer(); };
}
function closeDrawer(){ const h = document.getElementById('drawer-host'); h.hidden = true; h.innerHTML = ''; h.onclick = null; }

/* ── activity log + export ── */
function renderActivity(){
  const list = document.getElementById('activity-list');
  const acts = getActivity().slice(0, 40);
  document.getElementById('activity-count').textContent = `${getActivity().length} entries`;
  if(!acts.length){ list.innerHTML = `<div class="empty"><div class="empty-ico"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8 v4 l3 2"/><circle cx="12" cy="12" r="9"/></svg></div><h4>No activity yet</h4><p>Administrative actions will be recorded here.</p></div>`; return; }
  list.innerHTML = acts.map(a => `<div class="act-row"><span class="act-sev ${a.severity}"></span>
      <div class="act-body"><div class="act-line"><strong>${escapeHtml(a.actor)}</strong> ${escapeHtml(a.action)} <span style="color:var(--text-mute)">${escapeHtml(a.target)}</span></div>
      <div class="act-meta">${fmtDateTime(a.timestamp)}</div></div><span class="act-cat">${escapeHtml(a.category)}</span></div>`).join('');
}

function download(filename, text, type){
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}
function exportCSV(){
  const acts = getActivity();
  const header = ['id','timestamp','actor','action','target','category','severity'];
  const esc = v => `"${String(v==null?'':v).replace(/"/g,'""')}"`;
  const csv = [header.join(','), ...acts.map(a => header.map(h => esc(a[h])).join(','))].join('\r\n');
  download('orbis-activity.csv', csv, 'text/csv');
  showToast('Activity exported as CSV', 'success');
}
function exportJSON(){
  download('orbis-activity.json', JSON.stringify(getActivity(), null, 2), 'application/json');
  showToast('Activity exported as JSON', 'success');
}

/* ═══ (view-app) permission-driven navigation ═══════════════ */

function renderApp(){
  const s = getSession();
  const user = findUser(u => u.id === s.userId);
  document.getElementById('app-who').textContent = s ? s.name : '';
  const perms = (user && user.permissions && user.permissions.length) ? user.permissions : ['flightboard'];
  const allowed = ALL_MODULES.filter(m => perms.includes(m));

  const nav = document.getElementById('app-nav');
  nav.innerHTML = `<div class="nav-label">Navigation</div>` + allowed.map((m,i) => `
    <div class="nav-item ${i===0?'active':''}" data-mod="${m}">
      <span class="ni-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICONS[m]}</svg></span>
      <span>${MODULES[m].label}</span></div>`).join('');

  const setStage = m => {
    document.getElementById('stage-icon').innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICONS[m]}</svg>`;
    document.getElementById('stage-title').textContent = MODULES[m].label;
    document.getElementById('stage-msg').textContent = `The ${MODULES[m].label} module will be built in a later prompt. Your access to it is enabled.`;
    const inner = document.getElementById('app-stage'); inner.style.animation = 'none'; void inner.offsetWidth; inner.style.animation = '';
  };
  setStage(allowed[0]);

  nav.onclick = e => {
    const item = e.target.closest('.nav-item'); if(!item) return;
    nav.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    item.classList.add('active'); setStage(item.dataset.mod);
  };

  showView('view-app');
}

function hasPermission(module){
  const s = getSession(); if(!s) return false;
  const u = findUser(x => x.id === s.userId);
  return !!(u && u.permissions && u.permissions.includes(module));
}

/* ═══ (9) INIT & EVENT WIRING ═══════════════════════════════ */

function wireEyeEl(btn){
  btn.addEventListener('click', () => {
    const input = document.getElementById(btn.dataset.eye); if(!input) return;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password'; btn.classList.toggle('on', show);
  });
}

function wireAuth(){
  document.getElementById('login-form').addEventListener('submit', handleLogin);
  document.getElementById('signup-form').addEventListener('submit', handleSignup);
  document.getElementById('to-signup').addEventListener('click', e => { e.preventDefault(); swapAuth(true); });
  document.getElementById('to-login').addEventListener('click', e => { e.preventDefault(); swapAuth(false); });
  document.querySelectorAll('.eye').forEach(wireEyeEl);

  // live signup validation
  const wire = (id, name) => {
    const el = document.getElementById(id);
    el.addEventListener('blur', () => { signupTouched[name] = true; validateSignupField(name); });
    el.addEventListener('input', () => {
      if(name === 'pw'){ updateStrengthUI(); if(document.getElementById('su-confirm').value) validateSignupField('confirm'); }
      if(signupTouched[name]) validateSignupField(name);
      else if(!signupTouched[name]) setTimeout(() => { signupTouched[name] = true; validateSignupField(name); }, 600);
    });
  };
  wire('su-name','name'); wire('su-email','email'); wire('su-org','org'); wire('su-pw','pw'); wire('su-confirm','confirm');
  document.getElementById('su-role').addEventListener('change', () => { signupTouched.role = true; validateSignupField('role'); });
}

function wireAdmin(){
  document.getElementById('admin-signout').addEventListener('click', handleSignOut);
  document.getElementById('add-user-btn').addEventListener('click', openAddUser);
  document.getElementById('pb-link').addEventListener('click', () => {
    document.getElementById('filter-status').value = 'PENDING'; adminFilters.status = 'PENDING'; renderUsers();
    document.querySelector('.panel').scrollIntoView({ behavior:'smooth' });
  });

  document.getElementById('user-search').addEventListener('input', e => { adminFilters.q = e.target.value; renderUsers(); });
  document.getElementById('filter-status').addEventListener('change', e => { adminFilters.status = e.target.value; renderUsers(); });
  document.getElementById('filter-role').addEventListener('change', e => { adminFilters.role = e.target.value; renderUsers(); });

  const tbody = document.getElementById('users-body');
  tbody.addEventListener('click', e => {
    const kebab = e.target.closest('[data-kebab]');
    if(kebab){ e.stopPropagation(); openRowMenu(kebab.dataset.kebab, kebab); return; }
    const check = e.target.closest('[data-check]');
    if(check){ const id = check.dataset.check; if(check.checked) selectedIds.add(id); else selectedIds.delete(id);
      const tr = check.closest('tr'); tr.classList.toggle('selected', check.checked); updateBulkBar();
      document.getElementById('check-all').checked = [...tbody.querySelectorAll('[data-check]')].every(c => c.checked); return; }
    const row = e.target.closest('tr[data-id]'); if(row) openDrawer(row.dataset.id);
  });

  document.getElementById('check-all').addEventListener('change', e => {
    const rows = [...tbody.querySelectorAll('[data-check]')];
    rows.forEach(c => { c.checked = e.target.checked; if(e.target.checked) selectedIds.add(c.dataset.check); else selectedIds.delete(c.dataset.check);
      c.closest('tr').classList.toggle('selected', e.target.checked); });
    updateBulkBar();
  });

  document.getElementById('bulkbar').addEventListener('click', e => {
    const b = e.target.closest('[data-bulk]'); if(b) bulkAction(b.dataset.bulk);
  });

  document.getElementById('export-csv').addEventListener('click', exportCSV);
  document.getElementById('export-json').addEventListener('click', exportJSON);
}

function wireApp(){ document.getElementById('app-signout').addEventListener('click', handleSignOut); }

function init(){
  seedIfEmpty();
  seedOpsData();
  migrateFleetDesignations();
  ambient.init();
  wireAuth(); wireMFA(); wireAdmin(); wireApp();

  document.addEventListener('scroll', () => {
    const h = document.getElementById('kebab-host');
    if(h && !h.hidden) closeKebab();
  }, { capture: true, passive: true });
  window.addEventListener('resize', closeKebab);
  document.addEventListener('keydown', e => { if(e.key === 'Escape'){ closeKebab(); closeDrawer(); } });

  // restore live session
  const s = getSession();
  if(s){
    const u = findUser(x => x.id === s.userId);
    if(u && u.status === 'APPROVED'){ sessionMgr.start(); if(u.role === 'SUPER_ADMIN') renderAdmin(); else renderApp(); return; }
    clearSession();
  }
  renderAuth();
}

/* ═══════════════════════════════════════════════════════════
   ORBIS OPERATIONAL MODULES  (Phases A–F)
     (S)  Simulation engine — PURE, no DOM
     (D)  Storage keys, weight versions, seed data
     (H)  App shell · showModule · nav · guards
     (X)  Shared render/chart helpers
     (M)  S2–S9 module renderers
     (F)  Alert engine · degraded mode · audit
   ═══════════════════════════════════════════════════════════ */

/* ═══ (S) SIMULATION ENGINE ═════════════════════════════════
   A faithful port of the ORBIS specification. Arrays in, numbers
   out — NO DOM access, NO Math.random(). Every draw comes from a
   seeded PRNG so a disputed prediction is fully reproducible. */
const ENGINE = (function(){
  const ITERATIONS = 1000;
  const VAR_NAMES = ['Heat Index','GSE Availability','Equipment Failure Risk','Passenger Load','PRM Handling'];
  const HIST_BINS = 24;

  function clamp(x, lo, hi){ return x < lo ? lo : x > hi ? hi : x; }

  /* mulberry32 — small deterministic PRNG */
  function mulberry32(a){
    return function(){
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  /* FNV-1a hash → 32-bit seed */
  function hashSeed(str){
    let h = 2166136261 >>> 0;
    str = String(str);
    for(let i = 0; i < str.length; i++){ h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  /* STEP 1 — normalise raw inputs to five values in [0,1] */
  function normalise(raw, params){
    return [
      clamp((raw.heatIndexC - 28.0) / (55.0 - 28.0), 0, 1),                 // v1 Heat Index
      clamp(1.0 - (raw.gseAvailable / raw.gseTotal), 0, 1),                 // v2 GSE unavailable
      clamp(raw.mtbfFailureProb, 0, 1),                                     // v3 MTBF failure
      clamp(raw.loadFactorPercent / 100.0, 0, 1),                          // v4 Load factor
      clamp(raw.prmCount / params.stationPrmP95, 0, 1)                      // v5 PRM handling
    ];
  }

  /* Input validation — reject / clamp / block, returns findings */
  function validate(raw, params){
    const warnings = [];
    if(raw == null) return { ok:false, code:'INCOMPLETE_DATA', warnings };
    const req = ['heatIndexC','gseAvailable','gseTotal','mtbfFailureProb','loadFactorPercent','prmCount'];
    for(const k of req){ if(raw[k] == null || Number.isNaN(Number(raw[k]))) return { ok:false, code:'INCOMPLETE_DATA', field:k, warnings }; }
    if(raw.gseAvailable > raw.gseTotal) return { ok:false, code:'REJECT_GSE', warnings };
    if(raw.passengerTotal != null && raw.prmCount > raw.passengerTotal) return { ok:false, code:'REJECT_PRM', warnings };
    if(raw.loadFactorPercent > 100) warnings.push('loadFactorPercent > 100 — clamped to 100');
    if(raw.heatIndexC < -10 || raw.heatIndexC > 70) warnings.push('heatIndexC out of range — cached value used');
    return { ok:true, warnings };
  }

  /* Box–Muller standard normal driven by seeded rng */
  function gaussian(rng){
    let u1 = 0, u2 = 0;
    while(u1 <= 1e-12) u1 = rng();
    u2 = rng();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  /* STEP 2–5 — Monte Carlo + attribution + classification + TOBT bits.
     `iters` overrides the 1000-draw default (used only by the fast T9
     self-check); production always runs the full 1000. */
  function run(raw, params, flightNumber, calcTimestamp, iters){
    const N = iters || ITERATIONS;
    const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const v = normalise(raw, params);
    const W = params.weights, SIGMA = params.sigma;
    const seed = hashSeed(String(flightNumber) + '|' + String(calcTimestamp));
    const rng = mulberry32(seed);

    const buffers = new Array(N);
    let sum = 0;
    for(let i = 0; i < N; i++){
      let composite = 0;
      for(let k = 0; k < 5; k++){
        const s = clamp(v[k] + SIGMA[k] * gaussian(rng), 0, 1);
        composite += s * W[k];
      }
      const delayProb = 1 / (1 + Math.exp(-10 * (composite - 0.5)));
      const buf = params.baseBuffer + delayProb * params.maxAdditional;
      buffers[i] = buf; sum += buf;
    }
    buffers.sort((a, b) => a - b);
    const mean = sum / N;
    let sq = 0; for(let i = 0; i < N; i++){ const d = buffers[i] - mean; sq += d * d; }
    const std = Math.sqrt(sq / N);
    const pct = q => buffers[clamp(Math.floor(q * N), 0, N - 1)];
    const p10 = pct(0.10), p50 = pct(0.50), p90 = pct(0.90);

    /* STEP 3 — dominant variable attribution */
    const contributions = v.map((x, k) => x * W[k]);
    const csum = contributions.reduce((a, b) => a + b, 0);
    const shares = csum > 0 ? contributions.map(c => c / csum) : [0, 0, 0, 0, 0];
    let dominant = 0; for(let k = 1; k < 5; k++) if(shares[k] > shares[dominant]) dominant = k;

    /* STEP 4 — risk classification */
    const spread = p90 - p10, th = params.thresholds;
    let riskLevel;
    if(p90 <= th.green_p90 && spread < th.green_spread) riskLevel = 'GREEN';
    else if(p90 <= th.amber_p90 && spread < th.amber_spread) riskLevel = 'AMBER';
    else riskLevel = 'RED';

    /* histogram of the 1000 simulated buffers (adaptive bounds for full-width density curve) */
    const minBuf = buffers[0], maxBuf = buffers[N - 1];
    const pad = Math.max(1.5, (maxBuf - minBuf) * 0.12);
    const histLo = Math.max(0, Math.floor(minBuf - pad));
    const histHi = Math.ceil(maxBuf + pad);
    const histBins = new Array(HIST_BINS).fill(0);
    for(let i = 0; i < N; i++){
      let idx = Math.floor((buffers[i] - histLo) / (histHi - histLo) * HIST_BINS);
      histBins[clamp(idx, 0, HIST_BINS - 1)]++;
    }

    const t1 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    return {
      p10, p50, p90, mean, std, seed, computeMs: +(t1 - t0).toFixed(2),
      buffer: Math.round(p50), riskLevel, spread,
      dominant, shares, contributions, normalisedVector: v,
      histBins, histLo, histHi
    };
  }

  return { ITERATIONS, VAR_NAMES, run, normalise, validate, hashSeed, clamp };
})();

/* ═══ (D) OPS STORAGE KEYS & HELPERS ════════════════════════ */
const FLIGHTS_KEY   = 'orbis_flights';
const GSE_KEY       = 'orbis_gse';
const GSE_SHIFT_KEY = 'orbis_gse_shift';
const ALERTS_KEY    = 'orbis_alerts';
const OUTCOMES_KEY  = 'orbis_outcomes';
const WEIGHTS_KEY   = 'orbis_weights';
const RULES_KEY     = 'orbis_action_rules';
const INTEG_KEY     = 'orbis_integration';

function lsGet(key, fb){ const v = readJSON(key, fb); return v == null ? fb : v; }
function lsSet(key, val){ localStorage.setItem(key, JSON.stringify(val)); }

function getFlights(){ const f = lsGet(FLIGHTS_KEY, []); return Array.isArray(f) ? f : []; }
function saveFlights(f){ lsSet(FLIGHTS_KEY, f); }
function getFlight(id){ return getFlights().find(f => f.id === id) || null; }
function updateFlight(id, changes){
  const all = getFlights(); const f = all.find(x => x.id === id);
  if(!f) return null; Object.assign(f, changes); saveFlights(all); return f;
}

function getGse(){ const g = lsGet(GSE_KEY, []); return Array.isArray(g) ? g : []; }
function saveGse(g){ lsSet(GSE_KEY, g); }
function getGseShifts(){ const s = lsGet(GSE_SHIFT_KEY, []); return Array.isArray(s) ? s : []; }
function getAlerts(){ const a = lsGet(ALERTS_KEY, []); return Array.isArray(a) ? a : []; }
function saveAlerts(a){ lsSet(ALERTS_KEY, a); }
function getOutcomes(){ const o = lsGet(OUTCOMES_KEY, []); return Array.isArray(o) ? o : []; }
function getWeightVersions(){ const w = lsGet(WEIGHTS_KEY, []); return Array.isArray(w) ? w : []; }
function saveWeightVersions(w){ lsSet(WEIGHTS_KEY, w); }
function getActiveWeightVersion(){ return getWeightVersions().find(v => v.status === 'ACTIVE') || getWeightVersions()[0]; }
function getWeightVersion(id){ return getWeightVersions().find(v => v.id === id) || getActiveWeightVersion(); }
function getActionRules(){ return lsGet(RULES_KEY, {}); }
function getIntegration(){ return lsGet(INTEG_KEY, { weather:'HEALTHY', dcs:'HEALTHY' }); }
function saveIntegration(i){ lsSet(INTEG_KEY, i); }

/* time utilities */
function addMinutesISO(iso, min){ return new Date(new Date(iso).getTime() + min * 60000).toISOString(); }
function hhmm(iso){ if(!iso) return '--:--'; const d = new Date(iso); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
function minutesBetween(aIso, bIso){ return Math.round((new Date(aIso) - new Date(bIso)) / 60000); }
function nowISO(){ return new Date().toISOString(); }

/* the default calibration parameter set (spec defaults) */
function defaultEngineParams(){
  return {
    weights:[0.30, 0.25, 0.15, 0.15, 0.15],
    sigma:[0.05, 0.08, 0.06, 0.04, 0.07],
    baseBuffer:25.0, maxAdditional:25.0,
    thresholds:{ green_p90:30, green_spread:6, amber_p90:40, amber_spread:12 },
    stationPrmP95:8
  };
}

/* the engine's single public entry point.
   Stores nothing — callers persist the returned object onto the flight. */
function calculateFlightRisk(flight, versionId, fixedTs){
  const version = versionId ? getWeightVersion(versionId) : getActiveWeightVersion();
  const params = version.params;
  const calcTs = fixedTs || nowISO();
  const r = ENGINE.run(flight.rawInputs, params, flight.flightNumber, calcTs);

  /* data quality — DEGRADED if any input arrived stale/cached */
  let quality = 'GOOD';
  const prov = flight.inputProvenance && flight.inputProvenance.perVariable;
  if(prov) for(const k in prov){ const q = prov[k].quality; if(q === 'STALE' || q === 'CACHED') quality = 'DEGRADED'; }

  return {
    p10:r.p10, p50:r.p50, p90:r.p90, mean:r.mean, std:r.std, seed:r.seed, computeMs:r.computeMs,
    bufferMinutes:r.buffer, riskLevel:r.riskLevel, tobt:addMinutesISO(flight.eibt, r.buffer),
    dominantVariable:ENGINE.VAR_NAMES[r.dominant], dominantIndex:r.dominant,
    dominantSharePercent:+(r.shares[r.dominant] * 100).toFixed(1),
    shares:r.shares, normalisedVector:r.normalisedVector, contributions:r.contributions,
    histBins:r.histBins, histLo:r.histLo, histHi:r.histHi, spread:r.spread,
    weightVersionId:version.id, calculatedAt:calcTs, dataQuality:quality
  };
}

/* recompute + persist a flight's stored calculation (fresh timestamp) */
function recomputeFlight(id){
  const f = getFlight(id); if(!f) return null;
  const calc = calculateFlightRisk(f);
  updateFlight(id, { calculation:calc });
  return calc;
}

/* action-rules lookup → checklist array for a (risk, dominant) pair */
function lookupActions(riskLevel, dominantVariable){
  const rules = getActionRules();
  let key = riskLevel + '|' + dominantVariable;
  if(riskLevel === 'GREEN') key = 'GREEN|*';
  let txt = rules[key] || rules[riskLevel + '|*'] || ('Review ' + dominantVariable + ' with ramp team; Confirm resourcing; Monitor status');
  let list = [];
  if(txt.includes(';')){
    list = txt.split(';').map(s => s.trim()).filter(Boolean);
  } else if(txt.includes(' plus ')){
    const parts = txt.split(' plus ');
    list = [parts[0].trim(), parts[1].charAt(0).toUpperCase() + parts[1].slice(1).trim(), 'Confirm crew readiness on stand'];
  } else {
    list = [txt, 'Confirm ramp crew readiness on stand', 'Monitor turnaround timeline'];
  }
  return list;
}

/* one-time, non-destructive: bring already-stored flights onto the
   standardised fleet designations (types/pax only — no recompute). */
function migrateFleetDesignations(){
  if(localStorage.getItem('orbis_fleet_v3')) return;
  const map = {
    'PK-301':['A320',180],       'PA-204':['B777-200ER',280], 'ER-712':['A321',220],
    'PK-305':['B747-400',416],   'FZ-336':['B737-800',186],   'EK-623':['B777-300ER',358],
    'ER-540':['A330-300',290],   '9P-118':['A320',180],       'QR-612':['B787-9',290],
    '9P-220':['A321',220]
  };
  const fl = getFlights();
  if(fl.length){
    let changed = false;
    fl.forEach(f => { const m = map[f.flightNumber]; if(m){ f.aircraftType = m[0]; if(f.rawInputs) f.rawInputs.passengerTotal = m[1]; changed = true; } });
    if(changed) saveFlights(fl);
  }
  localStorage.setItem('orbis_fleet_v3', '1');
}

/* ═══ (D) SEED DATA — make every screen look alive ══════════ */
function seedOpsData(){
  const now = Date.now();
  const iso = ms => new Date(ms).toISOString();
  const todayAt = (h, m) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.toISOString(); };
  const dayAgo = d => iso(now - d * 864e5);

  /* ── weight versions (append-only; one ACTIVE + one SUPERSEDED) ── */
  if(!getWeightVersions().length){
    const older = {
      id:'wv-base-0', createdAt:dayAgo(21), author:'System', note:'Initial station calibration.',
      status:'SUPERSEDED',
      params:{ weights:[0.26,0.24,0.16,0.18,0.16], sigma:[0.05,0.08,0.06,0.04,0.07],
        baseBuffer:25.0, maxAdditional:25.0,
        thresholds:{ green_p90:30, green_spread:6, amber_p90:40, amber_spread:12 }, stationPrmP95:8 }
    };
    const active = {
      id:'wv-active-1', createdAt:dayAgo(7), author:'System Admin', note:'Seasonal re-weighting toward heat exposure.',
      status:'ACTIVE', params:defaultEngineParams()
    };
    saveWeightVersions([older, active]);
  }

  /* ── action rules ── */
  if(!Object.keys(getActionRules()).length){
    lsSet(RULES_KEY, {
      'GREEN|*':'Standard procedure — monitor for changes; Confirm all GSE in position; Inspect stand safety area',
      'AMBER|Heat Index':'Activate crew rotation; Confirm hydration station stocked; Provide shade canopy for ramp crew',
      'AMBER|GSE Availability':'Confirm backup belt loader; Verify GPU serviceable; Pre-position tractor on stand',
      'AMBER|Equipment Failure Risk':'Pre-check standby equipment; Place maintenance on standby; Verify hydraulic systems',
      'AMBER|Passenger Load':'Stage second baggage crew; Confirm belt loader availability; Pre-sort priority baggage',
      'AMBER|PRM Handling':'Brief PRM team 45 min prior; Stage ambulift at stand; Confirm passenger manifest count',
      'RED|Heat Index':'Mandatory 15-min rotation; Assign extra crew; Notify shift manager; Stock ice & hydration packs',
      'RED|GSE Availability':'Deploy all serviceable GSE to stand; Escalate to shift manager; Reallocate equipment from Stand 5',
      'RED|Equipment Failure Risk':'Assign standby equipment; Pre-brief maintenance team; Inspect critical systems prior to arrival',
      'RED|Passenger Load':'Deploy second belt loader; Assign additional baggage crew; Pre-stage extra baggage carts',
      'RED|PRM Handling':'Deploy full PRM team; Stage two ambulifts; Brief team 60 min prior; Direct ramp escort'
    });
  }

  /* ── integration health ── */
  if(!localStorage.getItem(INTEG_KEY)) saveIntegration({ weather:'HEALTHY', dcs:'HEALTHY' });

  /* ── GSE fleet (Comprehensive Real-World Airport Equipment) ── */
  if(!getGse().length || getGse().length < 35 || !getGse()[0].category){
    const svcDates = (lastD, nextD) => ({ lastService:dayAgo(lastD), nextServiceDue:iso(now + nextD * 864e5) });
    const unit = (typeCode, type, n, serial, status, mtbf, lastD, nextD, cat='POWERED', log) => Object.assign({
      id:'gse-' + typeCode + '-' + n, typeCode, type, serial, status, category:cat, mtbfHours:mtbf,
      maintLog: log || [{ date:dayAgo(lastD), type:'Scheduled service', notes:'Routine inspection completed.', hours:2 }]
    }, svcDates(lastD, nextD));
    saveGse([
      // POWERED GSE
      unit('TUG','Pushback Tug',1,'TUG-77','SERVICEABLE',1500,25,70,'POWERED'),
      unit('TUG','Pushback Tug',2,'TUG-78','SERVICEABLE',1350,55,4,'POWERED'),
      unit('TLT','Towbarless Tractor',1,'TLT-101','SERVICEABLE',1600,10,80,'POWERED'),
      unit('TLT','Towbarless Tractor',2,'TLT-102','MAINTENANCE',1400,4,15,'POWERED'),
      unit('BL','Belt Loader',1,'BL-4471','SERVICEABLE',900,12,48,'POWERED'),
      unit('BL','Belt Loader',2,'BL-4472','SERVICEABLE',760,40,8,'POWERED'),
      unit('BL','Belt Loader',3,'BL-4473','UNSERVICEABLE',540,70,-4,'POWERED'),
      unit('BT','Baggage Tractor',1,'BT-91','SERVICEABLE',1100,15,65,'POWERED'),
      unit('BT','Baggage Tractor',2,'BT-92','SERVICEABLE',990,48,10,'POWERED'),
      unit('BT','Baggage Tractor',3,'BT-93','MAINTENANCE',520,6,25,'POWERED'),
      unit('CL','Cargo High Loader',1,'CL-501','SERVICEABLE',1300,18,60,'POWERED'),
      unit('CL','Cargo High Loader',2,'CL-502','SERVICEABLE',1250,30,45,'POWERED'),
      unit('GPU','Ground Power Unit (GPU)',1,'GPU-208','SERVICEABLE',1200,18,60,'POWERED'),
      unit('GPU','Ground Power Unit (GPU)',2,'GPU-209','MAINTENANCE',600,4,20,'POWERED'),
      unit('ASU','Air Start Unit (ASU)',1,'ASU-12','SERVICEABLE',1100,22,50,'POWERED'),
      unit('ASU','Air Start Unit (ASU)',2,'ASU-13','SERVICEABLE',1050,45,12,'POWERED'),
      unit('PCA','Preconditioned Air (PCA)',1,'PCA-04','SERVICEABLE',1000,14,75,'POWERED'),
      unit('PCA','Preconditioned Air (PCA)',2,'PCA-05','SERVICEABLE',950,50,5,'POWERED'),
      unit('FLT','Fuel Bowser Truck',1,'FBL-88','SERVICEABLE',1800,20,90,'POWERED'),
      unit('FLT','Fuel Bowser Truck',2,'FBL-89','SERVICEABLE',1750,40,30,'POWERED'),
      unit('PWT','Potable Water Truck',1,'PWT-15','SERVICEABLE',700,30,30,'POWERED'),
      unit('LST','Lavatory Service Truck',1,'LST-22','SERVICEABLE',680,60,2,'POWERED'),
      unit('LST','Lavatory Service Truck',2,'LST-23','UNSERVICEABLE',450,75,-6,'POWERED'),
      unit('DCT','De-icing Truck',1,'DCT-01','SERVICEABLE',1400,15,120,'POWERED'),
      unit('CAT','Catering Hi-Lift Truck',1,'CAT-301','SERVICEABLE',1200,28,40,'POWERED'),
      unit('CAT','Catering Hi-Lift Truck',2,'CAT-302','SERVICEABLE',1150,55,8,'POWERED'),
      unit('PBS','Mobile Boarding Stairs',1,'PBS-14','SERVICEABLE',850,35,45,'POWERED'),
      unit('AMB','Ambulift (PRM)',1,'AMB-31','SERVICEABLE',800,20,55,'POWERED'),
      unit('AMB','Ambulift (PRM)',2,'AMB-32','UNSERVICEABLE',430,80,-9,'POWERED'),
      unit('FLK','Ramp Forklift',1,'FLK-08','SERVICEABLE',950,25,60,'POWERED'),
      unit('SWP','Runway/Apron Sweeper',1,'SWP-03','SERVICEABLE',1600,12,70,'POWERED'),
      unit('RFF','ARFF Crash Tender',1,'RFF-01','SERVICEABLE',2500,10,150,'POWERED'),
      unit('BCV','Bird Control Vehicle',1,'BCV-01','SERVICEABLE',1100,15,80,'POWERED'),

      // NON-POWERED / MANUAL GSE
      unit('CHK','Wheel Chocks',1,'CHK-SET-01','SERVICEABLE',5000,5,180,'NON_POWERED'),
      unit('CHK','Wheel Chocks',2,'CHK-SET-02','SERVICEABLE',5000,10,180,'NON_POWERED'),
      unit('CNS','Safety Cones',1,'CNS-SET-01','SERVICEABLE',5000,5,180,'NON_POWERED'),
      unit('BCD','Baggage Cart / Dolly',1,'BCD-101','SERVICEABLE',3000,30,90,'NON_POWERED'),
      unit('BCD','Baggage Cart / Dolly',2,'BCD-102','SERVICEABLE',3000,45,75,'NON_POWERED'),
      unit('CPD','Cargo Pallet Dolly',1,'CPD-201','SERVICEABLE',3000,20,100,'NON_POWERED'),
      unit('ULD','ULD Container Dolly',1,'ULD-301','SERVICEABLE',3000,15,110,'NON_POWERED'),
      unit('JCK','Aircraft Hydraulic Jacks',1,'JCK-A320-1','SERVICEABLE',2000,40,60,'NON_POWERED'),
      unit('COV','Wing & Engine Covers',1,'COV-ENG-01','SERVICEABLE',4000,60,120,'NON_POWERED'),
      unit('MSH','Marshalling Wands',1,'MSH-WAND-01','SERVICEABLE',5000,1,180,'NON_POWERED'),

      // FIXED INFRASTRUCTURE
      unit('PBB','Passenger Boarding Bridge',1,'PBB-GATE-01','SERVICEABLE',4000,15,90,'INFRASTRUCTURE'),
      unit('PBB','Passenger Boarding Bridge',2,'PBB-GATE-02','SERVICEABLE',3800,25,65,'INFRASTRUCTURE'),
      unit('PBB','Passenger Boarding Bridge',3,'PBB-GATE-03','MAINTENANCE',3200,5,10,'INFRASTRUCTURE'),
      unit('FHS','Fuel Hydrant System',1,'FHS-STAND-01','SERVICEABLE',5000,10,120,'INFRASTRUCTURE'),
      unit('FHS','Fuel Hydrant System',2,'FHS-STAND-02','SERVICEABLE',5000,20,110,'INFRASTRUCTURE')
    ]);
  }

  /* ── flights ── */
  if(!getFlights().length){
    const prov = (quality, ageMin) => ({
      source:quality === 'STALE' ? 'Weather feed (cached)' : 'Live feed',
      timestamp:iso(now - (ageMin || 3) * 60000), quality
    });
    const makeProv = (stale) => ({ perVariable:{
      heatIndexC: stale ? prov('STALE', 68) : prov('GOOD', 4),
      gseAvailable: prov('GOOD', 6), mtbfFailureProb: prov('MANUAL', 15),
      loadFactorPercent: prov('GOOD', 9), prmCount: prov('MANUAL', 20)
    }});
    const F = (o) => Object.assign({
      id:'flt-' + o.flightNumber, status:'SCHEDULED', alertId:null,
      ackStatus:'NONE', ackAt:null, ackBy:null, actualOffBlock:null, delayReasonCode:null,
      inputProvenance:makeProv(!!o.stale)
    }, o);

    const flights = [
      F({ flightNumber:'PK-301', airline:'PK', stand:3, aircraftType:'A320', eibt:todayAt(13,55), std:todayAt(14,40), status:'IN_BLOCK',
          rawInputs:{ heatIndexC:53, gseAvailable:3, gseTotal:10, mtbfFailureProb:0.55, loadFactorPercent:94, prmCount:5, passengerTotal:180 } }),
      F({ flightNumber:'PA-204', airline:'PA', stand:4, aircraftType:'B777-200ER', eibt:todayAt(15,10), std:todayAt(15,55), status:'IN_BLOCK',
          rawInputs:{ heatIndexC:50, gseAvailable:4, gseTotal:12, mtbfFailureProb:0.60, loadFactorPercent:90, prmCount:6, passengerTotal:280 } }),
      F({ flightNumber:'ER-712', airline:'ER', stand:2, aircraftType:'A321', eibt:todayAt(16,45), std:todayAt(17,20), status:'SCHEDULED',
          rawInputs:{ heatIndexC:49, gseAvailable:5, gseTotal:10, mtbfFailureProb:0.52, loadFactorPercent:88, prmCount:4, passengerTotal:220 } }),
      /* B747-400 kept for seasonal Hajj/Umrah peak ops only, not flown year-round */
      F({ flightNumber:'PK-305', airline:'PK', stand:1, aircraftType:'B747-400', eibt:todayAt(15,20), std:todayAt(16,5), status:'IN_BLOCK',
          rawInputs:{ heatIndexC:44, gseAvailable:6, gseTotal:10, mtbfFailureProb:0.40, loadFactorPercent:62, prmCount:3, passengerTotal:416 } }),
      F({ flightNumber:'FZ-336', airline:'FZ', stand:5, aircraftType:'B737-800', eibt:todayAt(19,25), std:todayAt(20,5), status:'SCHEDULED',
          rawInputs:{ heatIndexC:45, gseAvailable:6, gseTotal:10, mtbfFailureProb:0.42, loadFactorPercent:70, prmCount:3, passengerTotal:186 } }),
      F({ flightNumber:'EK-623', airline:'EK', stand:2, aircraftType:'B777-300ER', eibt:todayAt(21,15), std:todayAt(21,55), status:'SCHEDULED',
          rawInputs:{ heatIndexC:43, gseAvailable:7, gseTotal:10, mtbfFailureProb:0.38, loadFactorPercent:66, prmCount:2, passengerTotal:358 } }),
      F({ flightNumber:'ER-540', airline:'ER', stand:5, aircraftType:'A330-300', eibt:todayAt(17,40), std:todayAt(18,20), status:'IN_BLOCK', stale:true,
          rawInputs:{ heatIndexC:46, gseAvailable:7, gseTotal:10, mtbfFailureProb:0.35, loadFactorPercent:68, prmCount:2, passengerTotal:290 } }),
      F({ flightNumber:'9P-118', airline:'9P', stand:1, aircraftType:'A320', eibt:todayAt(18,10), std:todayAt(18,45), status:'SCHEDULED',
          rawInputs:{ heatIndexC:36, gseAvailable:8, gseTotal:10, mtbfFailureProb:0.20, loadFactorPercent:40, prmCount:1, passengerTotal:180 } }),
      F({ flightNumber:'QR-612', airline:'QR', stand:3, aircraftType:'B787-9', eibt:todayAt(20,5), std:todayAt(20,45), status:'SCHEDULED',
          rawInputs:{ heatIndexC:34, gseAvailable:9, gseTotal:10, mtbfFailureProb:0.15, loadFactorPercent:35, prmCount:1, passengerTotal:290 } }),
      F({ flightNumber:'9P-220', airline:'9P', stand:4, aircraftType:'A321', eibt:todayAt(16,20), std:todayAt(16,55), status:'IN_BLOCK',
          rawInputs:{ heatIndexC:37, gseAvailable:8, gseTotal:10, mtbfFailureProb:0.22, loadFactorPercent:45, prmCount:2, passengerTotal:220 } })
    ];

    /* calculate + persist every flight, then raise alerts for AMBER/RED */
    const alerts = [];
    flights.forEach((f, i) => {
      f.calculation = calculateFlightRisk(f, undefined, iso(now - (flights.length - i) * 1000));
      if(f.calculation.riskLevel !== 'GREEN'){
        const al = makeAlertRecord(f);
        /* stagger created times a little so a couple are already escalated for the demo */
        al.createdAt = iso(now - [7, 4, 9, 1, 6, 2, 3, 5][i % 8] * 60000);
        rollAlertStages(al);
        f.alertId = al.id; f.ackStatus = 'REQUIRED';
        alerts.push(al);
      }
    });
    /* acknowledge one AMBER up-front so both states are visible */
    const ackTarget = alerts.find(a => a.riskLevel === 'AMBER');
    if(ackTarget){ ackTarget.stage = 'ACKNOWLEDGED'; ackTarget.ackAt = iso(now - 30000); ackTarget.ackBy = 'A. Khan';
      const ff = flights.find(x => x.id === ackTarget.flightId); if(ff){ ff.ackStatus = 'ACKNOWLEDGED'; ff.ackAt = ackTarget.ackAt; ff.ackBy = 'A. Khan'; } }

    saveFlights(flights);
    saveAlerts(alerts);
  }

  /* ── historical outcomes (learning dataset) ── */
  if(!getOutcomes().length){
    const sups = ['A. Khan','S. Malik','B. Ahmed','R. Iqbal'];
    const risks = ['GREEN','AMBER','RED'];
    const doms = ENGINE.VAR_NAMES;
    const active = getActiveWeightVersion();
    const rnd = () => Math.random();
    const gauss = () => { let u = 0, v = 0; while(u <= 1e-9) u = rnd(); v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    const outcomes = [];
    const N = 56;
    for(let i = 0; i < N; i++){
      const risk = risks[Math.floor(rnd() * 3)];
      const predicted = risk === 'GREEN' ? 26 + rnd() * 4 : risk === 'AMBER' ? 33 + rnd() * 6 : 42 + rnd() * 7;
      /* signed error: modest bias + noise, occasional outlier */
      const bias = risk === 'RED' ? 2.5 : risk === 'AMBER' ? 0.5 : -0.5;
      let err = bias + gauss() * 6.5;
      if(rnd() < 0.08) err += (rnd() < 0.5 ? -1 : 1) * (12 + rnd() * 10);   // outliers
      const actual = Math.max(15, predicted + err);
      const dominant = doms[Math.floor(rnd() * doms.length)];
      const quality = rnd() < 0.12 ? 'DEGRADED' : 'GOOD';
      const daysBack = Math.floor(rnd() * 30);
      outcomes.push({
        id:uid('oc'), flightNumber:['PK','ER','9P','FZ','EK','QR'][Math.floor(rnd() * 6)] + '-' + (100 + Math.floor(rnd() * 800)),
        predictedBuffer:+predicted.toFixed(1), actualBuffer:+actual.toFixed(1), error:+(actual - predicted).toFixed(1),
        normalisedVector:[rnd(), rnd(), rnd(), rnd(), rnd()].map(x => +x.toFixed(3)),
        weightVersionId:active.id, riskLevel:risk, dominantVariable:dominant,
        supervisor:sups[Math.floor(rnd() * sups.length)], dataQuality:quality,
        loggedAt:iso(now - daysBack * 864e5 - Math.floor(rnd() * 12) * 36e5), delayReasonCode:null
      });
    }
    outcomes.sort((a, b) => new Date(b.loggedAt) - new Date(a.loggedAt));
    lsSet(OUTCOMES_KEY, outcomes);
  }
}

/* ═══ (F) ALERT ENGINE — records, staging, escalation ═══════
   Demo timers are compressed but the STAGES and their ordering are
   intact (noted on the manager dashboard). */
const ALERT_T = { RED:{ sms:2, esc:5 }, AMBER:{ sms:5, esc:10 } };   // minutes

function makeAlertRecord(f){
  return {
    id:uid('al'), flightId:f.id, flightNumber:f.flightNumber, riskLevel:f.calculation.riskLevel,
    createdAt:f.calculation.calculatedAt, stage:'AWAITING', ackAt:null, ackBy:null,
    events:[{ stage:'ISSUED', at:f.calculation.calculatedAt }]
  };
}
function alertAckDeadline(al){ return new Date(al.createdAt).getTime() + ALERT_T[al.riskLevel].esc * 60000; }

/* advance an alert through its escalation stages based on elapsed time */
function rollAlertStages(al){
  if(al.stage === 'ACKNOWLEDGED') return al;
  const t = ALERT_T[al.riskLevel];
  const ageMin = (Date.now() - new Date(al.createdAt)) / 60000;
  const f = getFlight(al.flightId);
  const addEvent = stage => { if(!al.events.some(e => e.stage === stage)) al.events.push({ stage, at:nowISO() }); };
  let stage = 'AWAITING';
  if(ageMin >= t.sms){ stage = 'SMS_SENT'; addEvent('SMS_SENT'); }
  if(ageMin >= t.esc){ stage = 'ESCALATED'; addEvent('ESCALATED'); }
  if(f && ageMin >= t.esc && minutesBetween(f.eibt, nowISO()) <= 30){ stage = 'UNACK_CRITICAL'; addEvent('UNACK_CRITICAL'); }
  al.stage = stage;
  return al;
}

/* acknowledge a flight's alert */
function acknowledgeAlert(flightId, who){
  const alerts = getAlerts();
  const al = alerts.find(a => a.flightId === flightId && a.stage !== 'ACKNOWLEDGED');
  const when = nowISO();
  if(al){ al.stage = 'ACKNOWLEDGED'; al.ackAt = when; al.ackBy = who; al.events.push({ stage:'ACKNOWLEDGED', at:when }); saveAlerts(alerts); }
  updateFlight(flightId, { ackStatus:'ACKNOWLEDGED', ackAt:when, ackBy:who });
  const f = getFlight(flightId);
  logActivity({ action:'acknowledged ' + (f ? f.calculation.riskLevel : '') + ' alert', target:f ? f.flightNumber : flightId, category:'alert', severity:'success' });
  updateAlertBadge();
}

/* outstanding = not yet acknowledged */
function outstandingAlerts(){ return getAlerts().filter(a => a.stage !== 'ACKNOWLEDGED'); }

const alertEngine = (function(){
  let timer = null;
  function tick(){
    const alerts = getAlerts(); let changed = false;
    alerts.forEach(a => { const before = a.stage; rollAlertStages(a); if(a.stage !== before) changed = true; });
    if(changed) saveAlerts(alerts);
    updateAlertBadge();
    /* live-refresh the board countdowns & manager escalation panel */
    if(currentModule === 'flightboard') tickBoardCountdowns();
    if(currentModule === 'manager') tickManagerLive();
  }
  return {
    start(){ if(timer) clearInterval(timer); tick(); timer = setInterval(tick, 1000); },
    stop(){ if(timer) clearInterval(timer); timer = null; }
  };
})();

/* ═══ (H) APP SHELL · navigation · module guard ═════════════ */
let currentModule = null;
let selectedFlightId = null;

function currentUser(){ const s = getSession(); return s ? findUser(u => u.id === s.userId) : null; }
function currentActor(){ const s = getSession(); return s ? s.name : 'Supervisor'; }

/* renderApp — override of the Phase-shell stub: builds the persistent
   module shell from the signed-in user's permission array. */
function renderApp(){
  const s = getSession(); if(!s) return renderAuth();
  const user = findUser(u => u.id === s.userId);
  document.getElementById('app-who').textContent = s.name || '';
  const perms = (user && user.permissions && user.permissions.length) ? user.permissions : ['flightboard'];
  const allowed = ALL_MODULES.filter(m => perms.includes(m));

  buildAppNav(allowed);
  renderDegradedBanner();
  alertEngine.start();
  showView('view-app');

  const first = allowed.includes('flightboard') ? 'flightboard' : allowed[0];
  showModule(first || 'flightboard');
}

function buildAppNav(allowed){
  const nav = document.getElementById('app-nav');
  nav.innerHTML = `<div class="nav-label">Modules</div>` + allowed.map(m => `
    <button class="nav-item" data-mod="${m}" type="button">
      <span class="ni-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICONS[m]}</svg></span>
      <span class="ni-label">${MODULES[m].label}</span></button>`).join('');
  nav.onclick = e => { const it = e.target.closest('.nav-item'); if(it) showModule(it.dataset.mod); };
}

/* the module dispatch — permission-guarded */
function renderModule(key, el){
  switch(key){
    case 'flightboard': return renderFlightBoard(el);
    case 'turnaround':  return renderTurnaround(el);
    case 'gse':         return renderGseEntry(el);
    case 'offblock':    return renderOffBlock(el);
    case 'manager':     return renderManager(el);
    case 'equipment':   return renderEquipment(el);
    case 'weights':     return renderWeights(el);
    case 'analytics':   return renderAnalytics(el);
    default:            return renderFlightBoard(el);
  }
}

function showModule(key){
  /* real enforcement — a denied key never renders */
  if(!hasPermission(key)){ renderAccessDenied(key); return; }
  currentModule = key;
  document.querySelectorAll('#app-nav .nav-item').forEach(n => n.classList.toggle('active', n.dataset.mod === key));
  const root = document.getElementById('module-root'); if(!root) return;
  root.scrollTop = 0; root.innerHTML = '';
  const view = document.createElement('section'); view.className = 'module-view';
  root.appendChild(view);
  renderModule(key, view);
  requestAnimationFrame(() => view.classList.add('in'));
  closeKebab(); updateAlertBadge();
}

function renderAccessDenied(key){
  currentModule = null;
  document.querySelectorAll('#app-nav .nav-item').forEach(n => n.classList.remove('active'));
  const root = document.getElementById('module-root'); if(!root) return;
  root.innerHTML = `
    <div class="module-view in"><div class="access-denied">
      <div class="empty-ico" style="width:56px;height:56px;background:var(--red-lite);color:var(--red);border-radius:14px">
        <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 L20 5 V11 C20 16 16.5 19.5 12 22 C7.5 19.5 4 16 4 11 V5 Z"/><path d="M12 8 v4 M12 16 v.1"/></svg></div>
      <h2>You don't have access to this module</h2>
      <p>${MODULES[key] ? MODULES[key].label : 'This module'} is not enabled for your account. Ask a station administrator to grant access.</p>
      <button class="btn btn-primary" id="ad-back">Go to Flight Board</button>
    </div></div>`;
  const back = document.getElementById('ad-back'); if(back) back.onclick = () => showModule('flightboard');
  showToast('Access to that module is not enabled for your account', 'notice');
  setTimeout(() => { if(!currentModule) showModule('flightboard'); }, 2600);
}

/* alert badge in the top bar */
function updateAlertBadge(){
  const badge = document.getElementById('alert-badge'); if(!badge) return;
  const n = outstandingAlerts().length;
  badge.hidden = n === 0;
  const cnt = document.getElementById('alert-count'); if(cnt) cnt.textContent = String(n);
  const critical = outstandingAlerts().some(a => a.stage === 'ESCALATED' || a.stage === 'UNACK_CRITICAL');
  badge.classList.toggle('critical', critical);
  badge.onclick = () => { if(hasPermission('manager')) showModule('manager'); else showModule('flightboard'); };
}

/* degraded-integration banner */
function renderDegradedBanner(){
  const banner = document.getElementById('degraded-banner'); if(!banner) return;
  const integ = getIntegration();
  const down = [];
  if(integ.weather !== 'HEALTHY') down.push('Weather');
  if(integ.dcs !== 'HEALTHY') down.push('DCS');
  if(!down.length){ banner.hidden = true; banner.innerHTML = ''; return; }
  banner.hidden = false;
  banner.innerHTML = `
    <span class="db-dot"></span>
    <span class="db-text"><strong>Degraded mode</strong> — ${down.join(' & ')} feed${down.length > 1 ? 's' : ''} unavailable. Affected flights fall back to cached inputs and are flagged; predictions still run.</span>`;
}

/* ═══ (X) SHARED RENDER / CHART HELPERS ═════════════════════ */
function riskColor(level){ return level === 'RED' ? 'var(--red)' : level === 'AMBER' ? 'var(--amber)' : 'var(--green)'; }
function riskChip(level){ return `<span class="risk-chip r-${level}"><span class="rc-dot"></span>${level}</span>`; }
function mmss(ms){ const s = Math.max(0, Math.floor(ms / 1000)); return pad2(Math.floor(s / 60)) + ':' + pad2(s % 60); }
function errorClass(err){ const a = Math.abs(err); return a <= 5 ? 'good' : a <= 15 ? 'warn' : 'bad'; }
function fmtSigned(n){ return (n > 0 ? '+' : '') + n; }
function openGenericDrawer(html){
  const host = document.getElementById('drawer-host');
  host.innerHTML = `<div class="drawer">${html}</div>`;
  host.hidden = false;
  host.onclick = e => { if(e.target === host || e.target.closest('[data-x]')) closeDrawer(); };
}

/* a downsampled polyline path for line/area charts */
function polyPath(points){ return points.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' '); }

/* ═══ (M) MODULE HELPERS — raw values, provenance, charts ═══ */
function rawValueLabel(f, idx){
  const r = f.rawInputs;
  switch(idx){
    case 0: return Math.round(r.heatIndexC) + '°C';
    case 1: return r.gseAvailable + '/' + r.gseTotal;
    case 2: return Math.round(r.mtbfFailureProb * 100) + '%';
    case 3: return Math.round(r.loadFactorPercent) + '%';
    case 4: return r.prmCount + ' PRM';
  }
  return '—';
}
const PROV_KEYS = ['heatIndexC','gseAvailable','mtbfFailureProb','loadFactorPercent','prmCount'];
function provFor(f, idx){
  const p = f.inputProvenance && f.inputProvenance.perVariable;
  const key = PROV_KEYS[idx];
  return (p && p[key]) ? p[key] : { source:'—', timestamp:null, quality:'GOOD' };
}
function qualityFlag(q){ return `<span class="q-flag q-${q}">${q||'GOOD'}</span>`; }

/* histogram bars as an inline SVG */
function histBarsSVG(bins, w, h, color){
  const bList = Array.isArray(bins) && bins.length ? bins : new Array(24).fill(1);
  const max = Math.max(1, ...bList);
  const bw = w / bList.length;
  return `<svg class="hist-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" width="100%" height="${h}">` +
    bList.map((b, i) => {
      const bh = (b / max) * (h - 2);
      return `<rect class="hist-bar" x="${(i * bw + 0.7).toFixed(1)}" y="${(h - bh).toFixed(1)}" width="${(bw - 1.4).toFixed(1)}" height="${bh.toFixed(1)}" rx="1" style="fill:${color};animation-delay:${(i * 14)}ms"/>`;
    }).join('') + `</svg>`;
}

/* unified confidence band density chart SVG with dynamic zoom */
function renderConfidenceChart(c, accent){
  const rawBins = Array.isArray(c.histBins) && c.histBins.length ? c.histBins : new Array(24).fill(1);
  const numBins = rawBins.length;

  let fIdx = 0, lIdx = numBins - 1;
  while(fIdx < numBins && rawBins[fIdx] === 0) fIdx++;
  while(lIdx >= 0 && rawBins[lIdx] === 0) lIdx--;
  if(fIdx >= lIdx){ fIdx = 0; lIdx = numBins - 1; }

  fIdx = Math.max(0, fIdx - 1);
  lIdx = Math.min(numBins - 1, lIdx + 1);

  const origStep = (c.histHi - c.histLo) / numBins;
  const chartLo = Math.floor(c.histLo + fIdx * origStep);
  const chartHi = Math.ceil(c.histLo + (lIdx + 1) * origStep);
  const bins = rawBins.slice(fIdx, lIdx + 1);
  const activeNum = bins.length;
  const max = Math.max(1, ...bins);

  const W = 600, H = 105, chartBottom = 82, chartTop = 22;
  const maxBarH = chartBottom - chartTop;
  const bw = W / activeNum;
  const span = Math.max(1, chartHi - chartLo);

  const toX = v => Math.min(W - 6, Math.max(6, ((v - chartLo) / span) * W));
  const xP10 = toX(c.p10);
  const xP50 = toX(c.p50);
  const xP90 = toX(c.p90);

  const gradId = 'confGrad_' + Math.floor(Math.random() * 1e6);

  /* Build SVG points for smooth area density curve */
  const points = [[0, chartBottom]];
  bins.forEach((b, i) => {
    const x = (i + 0.5) * bw;
    const y = chartBottom - (b / max) * maxBarH;
    points.push([x, y]);
  });
  points.push([W, chartBottom]);

  let areaD = `M 0,${chartBottom} `;
  points.forEach((p, i) => {
    if(i === 0) return;
    const prev = points[i - 1];
    const cx = (prev[0] + p[0]) / 2;
    areaD += `C ${cx.toFixed(1)},${prev[1].toFixed(1)} ${cx.toFixed(1)},${p[1].toFixed(1)} ${p[0].toFixed(1)},${p[1].toFixed(1)} `;
  });
  areaD += `Z`;

  let barsHTML = bins.map((b, i) => {
    const bh = (b / max) * maxBarH;
    const x = i * bw + 1.5;
    const w = Math.max(1, bw - 3);
    const y = chartBottom - bh;
    const binCenterVal = chartLo + (i + 0.5) * (span / activeNum);
    const inRange = binCenterVal >= c.p10 && binCenterVal <= c.p90;
    const opacity = inRange ? '0.70' : '0.18';
    return `<rect class="hist-bar" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${bh.toFixed(1)}" rx="3" fill="${accent}" opacity="${opacity}" style="animation-delay:${i * 10}ms"/>`;
  }).join('');

  const rangeHTML = `<rect x="${xP10.toFixed(1)}" y="${chartBottom.toFixed(1)}" width="${Math.max(2, xP90 - xP10).toFixed(1)}" height="6" rx="3" fill="${accent}" opacity="0.45"/>`;

  const p10Line = `<line x1="${xP10.toFixed(1)}" y1="${chartTop}" x2="${xP10.toFixed(1)}" y2="${chartBottom + 6}" stroke="${accent}" stroke-width="1.5" stroke-dasharray="3,3" opacity="0.8"/>`;
  const p50Line = `<line x1="${xP50.toFixed(1)}" y1="${chartTop - 6}" x2="${xP50.toFixed(1)}" y2="${chartBottom + 6}" stroke="var(--text)" stroke-width="2.5"/><circle cx="${xP50.toFixed(1)}" cy="${chartTop - 6}" r="4" fill="var(--text)"/>`;
  const p90Line = `<line x1="${xP90.toFixed(1)}" y1="${chartTop}" x2="${xP90.toFixed(1)}" y2="${chartBottom + 6}" stroke="${accent}" stroke-width="1.5" stroke-dasharray="3,3" opacity="0.8"/>`;

  const baseline = `<line x1="0" y1="${chartBottom.toFixed(1)}" x2="${W}" y2="${chartBottom.toFixed(1)}" stroke="var(--border)" stroke-width="1"/>`;

  const svg = `<svg class="conf-chart-svg" viewBox="0 0 ${W} ${H}" width="100%" height="100" preserveAspectRatio="none">
    <defs>
      <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${accent}" stop-opacity="0.32"/>
        <stop offset="100%" stop-color="${accent}" stop-opacity="0.02"/>
      </linearGradient>
    </defs>
    <path d="${areaD}" fill="url(#${gradId})"/>
    ${barsHTML}
    ${rangeHTML}
    ${baseline}
    ${p10Line}
    ${p50Line}
    ${p90Line}
  </svg>`;

  return { svg, chartLo, chartHi };
}

/* ═══ S2 — FLIGHT BOARD (key: flightboard) ══════════════════ */
function boardSortedFlights(){
  const order = { RED:0, AMBER:1, GREEN:2 };
  return getFlights().slice().sort((a, b) => {
    const ca = a.calculation || calculateFlightRisk(a);
    const cb = b.calculation || calculateFlightRisk(b);
    const ra = order[ca ? ca.riskLevel : 'GREEN'] ?? 2, rb = order[cb ? cb.riskLevel : 'GREEN'] ?? 2;
    if(ra !== rb) return ra - rb;
    return new Date(a.eibt) - new Date(b.eibt);
  });
}

function ackAreaHtml(f){
  const c = f.calculation || calculateFlightRisk(f);
  if(c.riskLevel === 'GREEN') return '';
  if(f.ackStatus === 'ACKNOWLEDGED')
    return `<div class="ack-area acked"><span class="ack-done">✓ Acknowledged ${hhmm(f.ackAt)} by ${escapeHtml(f.ackBy || '—')}</span></div>`;
  const al = getAlerts().find(a => a.id === f.alertId);
  const deadline = al ? alertAckDeadline(al) : new Date(c.calculatedAt || nowISO()).getTime() + ALERT_T[c.riskLevel || 'AMBER'].esc * 60000;
  return `<div class="ack-area">
      <div class="ack-strip">
        <span class="ack-req">ACKNOWLEDGE REQUIRED</span>
        <span class="ack-countdown mono" data-deadline="${deadline}">--:--</span>
      </div>
      <button class="btn btn-primary btn-sm ack-btn" data-ack="${f.id}" type="button">Acknowledge</button>
    </div>`;
}

function flightCardHtml(f){
  const c = f.calculation || calculateFlightRisk(f);
  const level = c.riskLevel || 'GREEN';
  const degraded = c.dataQuality === 'DEGRADED';
  const prov0 = provFor(f, 0);
  return `<article class="fl-card r-${level}" data-flight="${f.id}" style="--accent:${riskColor(level)}">
    <div class="fl-top">
      <div class="fl-id"><span class="fl-num mono">${escapeHtml(f.flightNumber)}</span>
        <span class="fl-meta">Stand ${f.stand} · ${escapeHtml(f.aircraftType)} · ETA ${hhmm(f.eibt)}</span></div>
      ${riskChip(level)}
    </div>
    ${degraded ? `<div class="fl-degraded">⚠ Weather data ${Math.round((Date.now() - new Date(prov0.timestamp || nowISO())) / 60000)} min old · estimate less certain</div>` : ''}
    <div class="fl-nums">
      <div class="fl-num-block"><span class="nb-label">BUFFER</span><span class="nb-val mono">${c.bufferMinutes} min</span></div>
      <div class="fl-num-block"><span class="nb-label">TOBT</span><span class="nb-val mono accent">${hhmm(c.tobt)}</span></div>
    </div>
    <div class="fl-driver">Driver · <strong>${escapeHtml(c.dominantVariable || 'Heat Index')} ${escapeHtml(rawValueLabel(f, c.dominantIndex != null ? c.dominantIndex : 0))}</strong></div>
    ${ackAreaHtml(f)}
  </article>`;
}

function renderFlightBoard(el){
  const flights = boardSortedFlights();
  const counts = { RED:0, AMBER:0, GREEN:0 };
  flights.forEach(f => {
    const c = f.calculation || calculateFlightRisk(f);
    counts[c.riskLevel || 'GREEN']++;
  });
  el.innerHTML = `
    <div class="board-col">
      <div class="mod-head">
        <div><h1 class="mod-title">Flight Board</h1>
          <p class="mod-sub">${flights.length} turnarounds · sorted by risk</p></div>
        <div class="board-legend">
          <span class="lg r-RED">${counts.RED} RED</span>
          <span class="lg r-AMBER">${counts.AMBER} AMBER</span>
          <span class="lg r-GREEN">${counts.GREEN} GREEN</span>
        </div>
      </div>
      <div class="fl-list" id="fl-list">
        ${flights.map((f, i) => flightCardHtml(f)).join('')}
      </div>
    </div>`;
  const list = el.querySelector('#fl-list');
  [...list.children].forEach((card, i) => { card.style.animationDelay = (i * 40) + 'ms'; card.classList.add('stagger'); });

  list.onclick = e => {
    const ackBtn = e.target.closest('[data-ack]');
    if(ackBtn){ e.stopPropagation(); handleBoardAck(ackBtn.dataset.ack); return; }
    const card = e.target.closest('[data-flight]');
    if(card) openTurnaround(card.dataset.flight);
  };
  tickBoardCountdowns();
}

function handleBoardAck(flightId){
  acknowledgeAlert(flightId, currentActor());
  const f = getFlight(flightId);
  const c = f.calculation || calculateFlightRisk(f);
  const card = document.querySelector(`.fl-card[data-flight="${flightId}"]`);
  if(card){
    const area = card.querySelector('.ack-area');
    if(area){ area.classList.add('acked','ack-animate');
      area.innerHTML = `<span class="ack-done">✓ Acknowledged ${hhmm(f.ackAt)} by ${escapeHtml(f.ackBy)}</span>`; }
  }
  showToast(`${f.flightNumber} — ${c.riskLevel} alert acknowledged`, 'success');
}

/* live countdown ticker (driven by alertEngine) */
function tickBoardCountdowns(){
  document.querySelectorAll('.ack-countdown[data-deadline]').forEach(el => {
    const remaining = Number(el.dataset.deadline) - Date.now();
    el.textContent = remaining <= 0 ? 'OVERDUE' : mmss(remaining);
    el.classList.toggle('warn', remaining <= 60000 && remaining > 30000);
    el.classList.toggle('pulse', remaining <= 30000);
    el.classList.toggle('over', remaining <= 0);
  });
}

function openTurnaround(flightId){ selectedFlightId = flightId; showModule('turnaround'); }

/* ═══ S3 — TURNAROUND DETAIL (key: turnaround) ══════════════ */
function renderTurnaround(el){
  let f = selectedFlightId ? getFlight(selectedFlightId) : null;
  if(!f){ f = boardSortedFlights()[0]; selectedFlightId = f ? f.id : null; }
  if(!f){ el.innerHTML = emptyState('No flights', 'There are no turnarounds to inspect yet.'); return; }
  if(!f.calculation || !f.calculation.shares || !f.calculation.histBins || !f.calculation.normalisedVector){
    f.calculation = calculateFlightRisk(f);
    updateFlight(f.id, { calculation: f.calculation });
  }
  const c = f.calculation;
  const level = c.riskLevel || 'GREEN', accent = riskColor(level);

  /* gauge geometry */
  const R = 62, CIRC = 2 * Math.PI * R;
  const histHi = c.histHi || 50, histLo = c.histLo || 25;
  const gfrac = Math.min(1, c.bufferMinutes / histHi);
  /* confidence band scaled to [histLo, histHi] */
  const span = histHi - histLo;
  const pos = v => span > 0 ? ((v - histLo) / span) * 100 : 50;

  /* contribution rows sorted desc by share */
  const rows = ENGINE.VAR_NAMES.map((name, idx) => ({
    idx, name, share:c.shares[idx], norm:c.normalisedVector[idx], raw:rawValueLabel(f, idx)
  })).sort((a, b) => b.share - a.share);

  const actions = lookupActions(level, c.dominantVariable);
  const ticks = f.actionTicks || [];
  const confChart = renderConfidenceChart(c, accent);

  el.innerHTML = `
    <div class="turn-wrap">
      <!-- 1 HEADER -->
      <div class="turn-head">
        <div class="th-id"><span class="fl-num mono">${escapeHtml(f.flightNumber)}</span>
          <span class="fl-meta">Stand ${f.stand} · ${escapeHtml(f.aircraftType)} · EIBT ${hhmm(f.eibt)} · STD ${hhmm(f.std)}</span></div>
        ${riskChip(level)}
      </div>

      <div class="turn-grid">
        <!-- 2 BUFFER GAUGE -->
        <section class="card gauge-card">
          <h3 class="card-h">Recommended buffer</h3>
          <div class="gauge">
            <svg viewBox="0 0 160 160">
              <circle cx="80" cy="80" r="${R}" fill="none" stroke="var(--surface-alt)" stroke-width="12"/>
              <circle class="gauge-fill" cx="80" cy="80" r="${R}" fill="none" stroke="${accent}" stroke-width="12" stroke-linecap="round"
                transform="rotate(-90 80 80)" stroke-dasharray="${CIRC.toFixed(1)}" stroke-dashoffset="${CIRC.toFixed(1)}"
                data-target="${(CIRC * (1 - gfrac)).toFixed(1)}"/>
            </svg>
            <div class="gauge-center"><span class="gauge-num mono">${c.bufferMinutes}</span><span class="gauge-unit">min</span></div>
          </div>
          <p class="gauge-note">Base ${getActiveWeightVersion().params.baseBuffer} + risk allowance</p>
        </section>

        <!-- 3 TOBT -->
        <section class="card tobt-card">
          <h3 class="card-h">Target off-block time</h3>
          <div class="tobt-big mono">${hhmm(c.tobt)}</div>
          <p class="tobt-math mono">EIBT ${hhmm(f.eibt)} + ${c.bufferMinutes} min buffer = TOBT ${hhmm(c.tobt)}</p>
        </section>

        <!-- 4 CONFIDENCE BAND -->
        <section class="card band-card">
          <div class="band-h-row">
            <h3 class="card-h">Confidence band</h3>
            <span class="card-h-tag mono">1,000 SIMULATED DRAWS</span>
          </div>

          <div class="conf-chart-wrap">
            ${confChart.svg}
            <div class="conf-axis mono">
              <span>${confChart.chartLo} min</span>
              <span class="ca-mid">P50 Expected ${Math.round(c.p50)} min</span>
              <span>${confChart.chartHi} min</span>
            </div>
          </div>

          <div class="conf-stats">
            <div class="cs-item">
              <span class="cs-label">Likely <small>(P10)</small></span>
              <span class="cs-val mono">${Math.round(c.p10)} <span class="cs-unit">min</span></span>
            </div>
            <div class="cs-item cs-primary">
              <span class="cs-label">Expected <small>(P50)</small></span>
              <span class="cs-val mono">${Math.round(c.p50)} <span class="cs-unit">min</span></span>
            </div>
            <div class="cs-item">
              <span class="cs-label">Worst Case <small>(P90)</small></span>
              <span class="cs-val mono">${Math.round(c.p90)} <span class="cs-unit">min</span></span>
            </div>
          </div>

          <div class="conf-plain">
            <span class="cp-icon">💡</span>
            <span>9 times out of 10, the turnaround finishes within <strong>${Math.round(c.p90)} minutes</strong>.</span>
          </div>
        </section>

        <!-- 5 WHAT'S DRIVING THIS -->
        <section class="card drive-card">
          <h3 class="card-h">What's driving this</h3>
          <div class="contrib-rows">
            ${rows.map(r => `
              <div class="contrib-row ${r.idx === c.dominantIndex ? 'dominant' : ''}">
                <div class="cr-top"><span class="cr-name">${escapeHtml(r.name)}${r.idx === c.dominantIndex ? ' <span class="cr-tag">DRIVER</span>' : ''}</span>
                  <span class="cr-share mono">${(r.share * 100).toFixed(1)}%</span></div>
                <div class="cr-bar"><span class="cr-fill" style="width:${(r.share * 100).toFixed(1)}%;--accent:${r.idx === c.dominantIndex ? accent : 'var(--grey)'}"></span></div>
                <div class="cr-meta mono">raw ${escapeHtml(r.raw)} · norm ${r.norm.toFixed(2)}</div>
              </div>`).join('')}
          </div>
        </section>

        <!-- 6 RECOMMENDED ACTIONS -->
        <section class="card action-card">
          <h3 class="card-h">Recommended actions <span class="card-h-tag mono" id="action-progress-tag">${ticks.length}/${actions.length} done</span></h3>
          <div class="action-list" id="action-list">
            ${actions.map((a, i) => `<label class="action-item ${ticks.includes(i) ? 'ticked' : ''}">
              <input type="checkbox" data-act="${i}" ${ticks.includes(i) ? 'checked' : ''}/>
              <span class="ai-box"></span><span class="ai-text">${escapeHtml(a)}</span></label>`).join('')}
          </div>
          <div class="action-foot">
            <div class="af-bar"><span class="af-fill" id="action-fill" style="width:${(actions.length ? (ticks.length / actions.length * 100) : 0)}%"></span></div>
            <span class="af-text mono" id="action-foot-text">${ticks.length === actions.length && actions.length ? '✓ All actions completed' : `${actions.length - ticks.length} remaining`}</span>
          </div>
        </section>

        <!-- 7 INPUTS & PROVENANCE -->
        <section class="card prov-card">
          <h3 class="card-h">Inputs &amp; provenance</h3>
          <table class="prov-tbl">
            <thead><tr><th>Variable</th><th>Value</th><th>Source</th><th>Time</th><th>Quality</th></tr></thead>
            <tbody>
              ${ENGINE.VAR_NAMES.map((name, idx) => { const p = provFor(f, idx);
                return `<tr class="${p.quality === 'STALE' ? 'stale' : ''}">
                  <td>${escapeHtml(name)}</td><td class="mono">${escapeHtml(rawValueLabel(f, idx))}</td>
                  <td>${escapeHtml(p.source)}</td><td class="mono">${p.timestamp ? hhmm(p.timestamp) : '—'}</td>
                  <td>${qualityFlag(p.quality)}</td></tr>`; }).join('')}
            </tbody>
          </table>
        </section>
      </div>

      <!-- 8 ACKNOWLEDGE -->
      ${level !== 'GREEN' && f.ackStatus !== 'ACKNOWLEDGED'
        ? `<button class="btn btn-primary btn-full turn-ack" id="turn-ack" type="button">Acknowledge ${level} alert</button>`
        : level !== 'GREEN' ? `<div class="turn-acked">✓ Acknowledged ${hhmm(f.ackAt)} by ${escapeHtml(f.ackBy || '—')}</div>` : ''}

      <!-- 9 AUDIT PANEL -->
      <section class="card audit-card">
        <button class="audit-toggle" id="audit-toggle" type="button">
          <span>Audit &amp; reproducibility</span><span class="au-chev">▸</span></button>
        <div class="audit-body" id="audit-body" hidden>
          <div class="au-grid mono">
            <div><span class="au-k">Seed</span><span class="au-v">${c.seed}</span></div>
            <div><span class="au-k">Weight version</span><span class="au-v">${escapeHtml(c.weightVersionId)}</span></div>
            <div><span class="au-k">Compute time</span><span class="au-v">${c.computeMs} ms</span></div>
            <div><span class="au-k">Calculated</span><span class="au-v">${fmtDateTime(c.calculatedAt)}</span></div>
          </div>
          <button class="btn btn-ghost btn-sm" id="verify-btn" type="button">Verify reproducibility</button>
          <div class="verify-result" id="verify-result" hidden></div>
        </div>
      </section>
    </div>`;

  /* animate gauge */
  const gf = el.querySelector('.gauge-fill');
  requestAnimationFrame(() => { gf.style.transition = 'stroke-dashoffset 1s var(--ease)'; gf.style.strokeDashoffset = gf.dataset.target; });

  const turnBackBtn = el.querySelector('#turn-back');
  if(turnBackBtn) turnBackBtn.onclick = () => showModule('flightboard');
  const backAck = el.querySelector('#turn-ack');
  if(backAck) backAck.onclick = () => { acknowledgeAlert(f.id, currentActor()); showToast(`${f.flightNumber} acknowledged`, 'success'); showModule('turnaround'); };

  /* action ticks persist */
  el.querySelector('#action-list').onchange = e => {
    const cb = e.target.closest('[data-act]'); if(!cb) return;
    const idx = Number(cb.dataset.act);
    let t = (getFlight(f.id).actionTicks || []).slice();
    if(cb.checked){ if(!t.includes(idx)) t.push(idx); } else t = t.filter(x => x !== idx);
    updateFlight(f.id, { actionTicks:t });
    cb.closest('.action-item').classList.toggle('ticked', cb.checked);
    const tag = el.querySelector('#action-progress-tag');
    const fill = el.querySelector('#action-fill');
    const footText = el.querySelector('#action-foot-text');
    if(tag) tag.textContent = `${t.length}/${actions.length} done`;
    if(fill) fill.style.width = (actions.length ? (t.length / actions.length * 100) : 0) + '%';
    if(footText) footText.textContent = t.length === actions.length && actions.length ? '✓ All actions completed' : `${actions.length - t.length} remaining`;
  };

  /* audit toggle + verify */
  const toggle = el.querySelector('#audit-toggle'), body = el.querySelector('#audit-body');
  toggle.onclick = () => { body.hidden = !body.hidden; toggle.classList.toggle('open', !body.hidden); };
  el.querySelector('#verify-btn').onclick = () => {
    const stored = getFlight(f.id).calculation;
    const re = calculateFlightRisk(getFlight(f.id), stored.weightVersionId, stored.calculatedAt);
    const match = re.seed === stored.seed && re.p10 === stored.p10 && re.p50 === stored.p50 &&
      re.p90 === stored.p90 && re.mean === stored.mean && re.std === stored.std && re.bufferMinutes === stored.bufferMinutes;
    const rr = el.querySelector('#verify-result'); rr.hidden = false;
    rr.className = 'verify-result ' + (match ? 'ok' : 'fail');
    rr.innerHTML = match
      ? `<strong>✓ Exact match.</strong> Re-running the engine from the stored inputs, seed ${stored.seed} and weight version reproduced P10/P50/P90 = ${Math.round(re.p10)}/${Math.round(re.p50)}/${Math.round(re.p90)} to full precision.`
      : `<strong>✗ Mismatch.</strong> The re-run did not reproduce the stored result.`;
    logActivity({ action:'verified reproducibility', target:f.flightNumber, category:'audit', severity:match ? 'info' : 'danger' });
  };
}

function emptyState(title, msg, iconPath){
  const p = iconPath || '<circle cx="12" cy="12" r="9"/><path d="M9 12 h6"/>';
  return `<div class="empty"><div class="empty-ico"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${p}</svg></div>
    <h4>${escapeHtml(title)}</h4><p>${escapeHtml(msg)}</p></div>`;
}

/* ═══ shared: visible recalculation sequence (S4 & S7) ══════
   Steps through pending flights ~150ms each, applies `mutate(flight)`
   before recomputing, then resolves with the list of changes. */
function recalcSequence(hostEl, mutate){
  return new Promise(resolve => {
    const flights = getFlights().filter(f => f.status !== 'OFF_BLOCK');
    hostEl.innerHTML = `<div class="recalc-box">
        <div class="recalc-head"><span class="spinner" style="border-color:rgba(37,99,235,.25);border-top-color:var(--primary)"></span>
          <span>Recalculating pending flights…</span></div>
        <div class="recalc-now mono" id="recalc-now">—</div>
        <div class="recalc-track"><span class="recalc-fill" id="recalc-fill"></span></div>
      </div>`;
    const changes = []; let i = 0;
    const store = getFlights();
    function step(){
      if(i >= flights.length){ saveFlights(store); resolve(changes); return; }
      const f = flights[i];
      const target = store.find(x => x.id === f.id);
      const old = { risk:target.calculation.riskLevel, buffer:target.calculation.bufferMinutes };
      if(mutate) mutate(target);
      target.calculation = calculateFlightRisk(target);
      if(old.risk !== target.calculation.riskLevel || old.buffer !== target.calculation.bufferMinutes){
        changes.push({ id:target.id, flightNumber:target.flightNumber, oldRisk:old.risk, newRisk:target.calculation.riskLevel,
          oldBuffer:old.buffer, newBuffer:target.calculation.bufferMinutes });
        /* worsened to RED → raise a fresh alert */
        if(target.calculation.riskLevel === 'RED' && old.risk !== 'RED'){
          const alerts = getAlerts();
          const al = makeAlertRecord(target); al.createdAt = nowISO();
          target.alertId = al.id; target.ackStatus = 'REQUIRED'; target.ackAt = null; target.ackBy = null;
          alerts.push(al); saveAlerts(alerts);
        }
      }
      const now = document.getElementById('recalc-now'); if(now) now.textContent = f.flightNumber;
      const fill = document.getElementById('recalc-fill'); if(fill) fill.style.width = ((i + 1) / flights.length * 100) + '%';
      i++;
      setTimeout(step, 150);
    }
    step();
  });
}

function changeSummaryHtml(changes, total){
  const moved = changes.length;
  return `<div class="recalc-summary">
    <div class="rs-head"><strong>${total} flights recalculated</strong> · ${moved} risk level${moved === 1 ? '' : 's'} changed</div>
    ${moved ? `<div class="rs-list">${changes.map(ch => `
      <div class="rs-row">
        <span class="mono rs-fl">${escapeHtml(ch.flightNumber)}</span>
        <span class="rs-move">${riskChip(ch.oldRisk)} → ${riskChip(ch.newRisk)}</span>
        <span class="mono rs-buf">${ch.oldBuffer} → ${ch.newBuffer} min</span>
      </div>`).join('')}</div>` : `<p class="rs-none">No risk levels changed.</p>`}
  </div>`;
}

let gseCatFilter = 'ALL';

/* ═══ S4 — GSE ENTRY (key: gse) ═════════════════════════════ */
function renderGseEntry(el){
  const fleet = getGse();
  const byType = {};
  fleet.forEach(u => {
    (byType[u.typeCode] = byType[u.typeCode] || { code:u.typeCode, name:u.type, category:u.category || 'POWERED', total:0, avail:0 });
  });
  fleet.forEach(u => {
    byType[u.typeCode].total++;
    if(u.status === 'SERVICEABLE') byType[u.typeCode].avail++;
  });
  const types = Object.values(byType);
  const s = getSession();

  const poweredCount = types.filter(t => t.category === 'POWERED').length;
  const nonPoweredCount = types.filter(t => t.category === 'NON_POWERED').length;
  const infraCount = types.filter(t => t.category === 'INFRASTRUCTURE').length;

  const filteredTypes = types.filter(t => {
    if(gseCatFilter === 'ALL') return true;
    return t.category === gseCatFilter;
  });

  const activeTypes = gseCatFilter === 'ALL' ? types : filteredTypes;
  let summaryAvail = 0, summaryTotal = 0;
  activeTypes.forEach(t => { summaryAvail += t.avail; summaryTotal += t.total; });
  const summaryRatio = summaryTotal ? summaryAvail / summaryTotal : 0;
  const summaryPct = Math.round(summaryRatio * 100);
  const barColor = summaryRatio >= 0.7 ? 'var(--green)' : summaryRatio >= 0.45 ? 'var(--amber)' : 'var(--red)';
  const badgeColor = summaryRatio >= 0.7 ? '#15803D' : summaryRatio >= 0.45 ? '#B45309' : '#991B1B';
  const badgeBg = summaryRatio >= 0.7 ? 'var(--green-lite)' : summaryRatio >= 0.45 ? 'var(--amber-lite)' : 'var(--red-lite)';
  const catLabel = gseCatFilter === 'ALL' ? 'Total Fleet Availability' : (gseCatFilter === 'POWERED' ? 'Powered GSE Availability' : (gseCatFilter === 'NON_POWERED' ? 'Non-Powered Availability' : 'Infrastructure Availability'));

  el.innerHTML = `
    <div class="gse-wrap">
      <div class="mod-head">
        <div>
          <h1 class="mod-title">GSE Availability Entry</h1>
          <p class="mod-sub">Shift A · ${fmtDate(nowISO())} · ${escapeHtml(s ? s.name : 'Supervisor')}</p>
        </div>
      </div>

      <!-- FLEET READINESS SUMMARY CARD -->
      <div class="gse-summary-card card">
        <div class="gsc-top">
          <div class="gsc-left">
            <span class="gsc-lbl">${catLabel}</span>
            <span class="gsc-num mono" id="gt-val-num">${summaryAvail} / ${summaryTotal}</span>
          </div>
          <div class="gsc-right">
            <span class="gsc-pct mono" id="gt-pct-text" style="color:${badgeColor}; background:${badgeBg}">${summaryPct}% Readiness</span>
          </div>
        </div>
        <div class="gt-bar">
          <span class="gt-fill" id="gt-fill" style="width:${summaryPct}%; background:${barColor}"></span>
        </div>
      </div>

      <!-- CATEGORY TABS -->
      <div class="gse-cat-tabs" id="gse-cat-tabs">
        <button type="button" class="gct-tab ${gseCatFilter === 'ALL' ? 'active' : ''}" data-cat="ALL">All Fleet (${types.length})</button>
        <button type="button" class="gct-tab ${gseCatFilter === 'POWERED' ? 'active' : ''}" data-cat="POWERED">⚡ Powered GSE (${poweredCount})</button>
        <button type="button" class="gct-tab ${gseCatFilter === 'NON_POWERED' ? 'active' : ''}" data-cat="NON_POWERED">📦 Non-Powered (${nonPoweredCount})</button>
        <button type="button" class="gct-tab ${gseCatFilter === 'INFRASTRUCTURE' ? 'active' : ''}" data-cat="INFRASTRUCTURE">🏗 Infrastructure (${infraCount})</button>
      </div>

      <!-- GSE EQUIPMENT GRID -->
      <div class="gse-rows" id="gse-rows">
        ${filteredTypes.map(t => `
          <div class="gse-row card" data-code="${t.code}">
            <div class="gr-top">
              <div class="gr-left">
                <span class="gr-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICONS.gse}</svg></span>
                <span class="gr-name">${escapeHtml(t.name)}</span>
              </div>
              <span class="gr-badge mono" data-badge>${t.avail} / ${t.total}</span>
            </div>

            <div class="gr-control">
              <button class="stepper btn-sub" data-step="-1" data-code="${t.code}" type="button">−</button>
              <div class="gr-count mono"><span class="gr-avail" data-avail>${t.avail}</span> <span class="gr-slash">/</span> ${t.total}</div>
              <button class="stepper btn-add" data-step="1" data-code="${t.code}" type="button">+</button>
            </div>

            <div class="gr-bar"><span class="gr-fill" data-fill></span></div>
            <div class="gr-err" data-err hidden></div>
          </div>`).join('')}
      </div>

      <!-- FOOTER CARD -->
      <div class="card gse-footer-card">
        <div class="gse-footer-row">
          <div class="field gse-notes-field">
            <label for="gse-notes">Shift Notes / Remarks (optional)</label>
            <div class="input-wrap">
              <input type="text" id="gse-notes" placeholder="Serviceability remarks, standby arrangements…" autocomplete="off" />
            </div>
          </div>
          <div class="gse-submit-action">
            <button class="btn btn-primary" id="gse-submit" type="button">Submit Shift Availability</button>
          </div>
        </div>
      </div>
      <div id="gse-result" class="gse-result"></div>
    </div>`;

  const state = {}; types.forEach(t => state[t.code] = { total:t.total, avail:t.avail });

  function paint(){
    let sa = 0, st = 0;
    activeTypes.forEach(t => {
      const s2 = state[t.code]; sa += s2.avail; st += s2.total;
      const row = el.querySelector(`.gse-row[data-code="${t.code}"]`);
      if(row){
        const availEl = row.querySelector('[data-avail]'); if(availEl) availEl.textContent = s2.avail;
        const badge = row.querySelector('[data-badge]'); if(badge) badge.textContent = `${s2.avail} / ${s2.total}`;
        const ratio = s2.total ? s2.avail / s2.total : 0;
        const fill = row.querySelector('[data-fill]');
        if(fill){
          fill.style.width = (ratio * 100) + '%';
          fill.style.background = ratio >= 0.7 ? 'var(--green)' : ratio >= 0.45 ? 'var(--amber)' : 'var(--red)';
        }
      }
    });
    const ratio = st ? sa / st : 0;
    const pct = Math.round(ratio * 100);
    const numEl = el.querySelector('#gt-val-num'); if(numEl) numEl.textContent = `${sa} / ${st}`;
    const pctEl = el.querySelector('#gt-pct-text');
    if(pctEl){
      pctEl.textContent = `${pct}% Readiness`;
      pctEl.style.color = ratio >= 0.7 ? '#15803D' : ratio >= 0.45 ? '#B45309' : '#991B1B';
      pctEl.style.background = ratio >= 0.7 ? 'var(--green-lite)' : ratio >= 0.45 ? 'var(--amber-lite)' : 'var(--red-lite)';
    }
    const gf = el.querySelector('#gt-fill');
    if(gf){
      gf.style.width = (pct) + '%';
      gf.style.background = ratio >= 0.7 ? 'var(--green)' : ratio >= 0.45 ? 'var(--amber)' : 'var(--red)';
    }
  }
  const catTabs = el.querySelector('#gse-cat-tabs');
  if(catTabs){
    catTabs.onclick = e => {
      const btn = e.target.closest('[data-cat]');
      if(!btn) return;
      gseCatFilter = btn.dataset.cat;
      renderGseEntry(el);
    };
  }

  el.querySelector('#gse-rows').onclick = e => {
    const btn = e.target.closest('[data-step]'); if(!btn) return;
    const code = btn.dataset.code, dir = Number(btn.dataset.step), st = state[code];
    const next = st.avail + dir;
    const row = el.querySelector(`.gse-row[data-code="${code}"]`);
    const err = row.querySelector('[data-err]');
    if(next < 0 || next > st.total){
      err.hidden = false; err.textContent = next < 0 ? 'Available cannot go below zero.' : 'Available cannot exceed the total units.';
      row.classList.add('shake'); setTimeout(() => row.classList.remove('shake'), 320);
      return;
    }
    err.hidden = true; st.avail = next; paint();
  };

  el.querySelector('#gse-submit').onclick = async () => {
    const sa = types.reduce((a, t) => a + state[t.code].avail, 0);
    const stt = types.reduce((a, t) => a + state[t.code].total, 0);
    const notes = el.querySelector('#gse-notes').value.trim();
    const result = el.querySelector('#gse-result');
    el.querySelector('#gse-submit').disabled = true;

    const total = getFlights().filter(f => f.status !== 'OFF_BLOCK').length;
    const changes = await recalcSequence(result, f => { f.rawInputs.gseAvailable = Math.min(sa, stt); f.rawInputs.gseTotal = stt; });

    /* persist a shift submission record */
    const shifts = getGseShifts();
    shifts.unshift({ id:uid('gs'), submittedAt:nowISO(), submittedBy:s ? s.name : 'Supervisor',
      shift:'A', available:sa, total:stt, notes, perType:types.map(t => ({ code:t.code, avail:state[t.code].avail, total:state[t.code].total })) });
    lsSet(GSE_SHIFT_KEY, shifts);
    logActivity({ action:`submitted GSE availability ${sa}/${stt}`, target:'Shift A', category:'gse', severity:'info' });

    result.innerHTML = changeSummaryHtml(changes, total);
    const newReds = changes.filter(ch => ch.newRisk === 'RED' && ch.oldRisk !== 'RED').length;
    showToast(`${total} flights recalculated${newReds ? ` · ${newReds} new RED alert${newReds > 1 ? 's' : ''}` : ''}`, newReds ? 'notice' : 'success');
    updateAlertBadge();
    el.querySelector('#gse-submit').disabled = false;
  };
}

/* ═══ S5 — OFF-BLOCK LOGGING (key: offblock) ════════════════ */
function isoWithTime(baseIso, hhmmStr){
  const d = new Date(baseIso); const [h, m] = hhmmStr.split(':').map(Number);
  d.setHours(h, m, 0, 0); return d.toISOString();
}
const DELAY_REASONS = ['Late inbound aircraft','GSE unavailable','Crew shortage','Baggage handling','PRM assistance','Fuelling delay','ATC/slot','Weather','Other'];

function renderOffBlock(el){
  const pending = getFlights().filter(f => f.status === 'IN_BLOCK' && !f.actualOffBlock);
  const outcomes = getOutcomes();
  const recent = outcomes.slice(0, 8);

  const totalLogged = outcomes.length;
  const avgError = totalLogged ? Math.round(outcomes.reduce((s, o) => s + Math.abs(o.error), 0) / totalLogged) : 0;
  const onTimeRate = totalLogged ? Math.round((outcomes.filter(o => Math.abs(o.error) <= 5).length / totalLogged) * 100) : 100;

  el.innerHTML = `
    <div class="mod-wide">
      <div class="mod-head">
        <div>
          <h1 class="mod-title">Off-Block Logging</h1>
          <p class="mod-sub">${pending.length} in-block flight${pending.length === 1 ? '' : 's'} awaiting actual off-block time (AOBT) confirmation</p>
        </div>
      </div>

      <!-- KPI STRIP -->
      <div class="ob-kpi-strip">
        <div class="kpi">
          <span class="kpi-num mono">${pending.length}</span>
          <span class="kpi-lbl">Awaiting Confirmation</span>
        </div>
        <div class="kpi">
          <span class="kpi-num mono">${totalLogged}</span>
          <span class="kpi-lbl">Departures Logged</span>
        </div>
        <div class="kpi">
          <span class="kpi-num mono">±${avgError} <small style="font-size:12px;font-weight:500;color:var(--text-mute)">min</small></span>
          <span class="kpi-lbl">Mean Absolute Error</span>
        </div>
        <div class="kpi">
          <span class="kpi-num mono">${onTimeRate}%</span>
          <span class="kpi-lbl">Target Accuracy (±5m)</span>
        </div>
      </div>

      <!-- 2-COLUMN DUAL PANE -->
      <div class="ob-main-grid">
        <!-- LEFT: Pending Flights -->
        <section class="card ob-pending-card">
          <h3 class="card-h">Pending In-Block Flights (${pending.length})</h3>
          <div class="ob-list">
            ${pending.length ? pending.map(f => {
              const c = f.calculation || calculateFlightRisk(f);
              return `
              <div class="ob-item card" data-flight="${f.id}">
                <div class="ob-item-top">
                  <span class="fl-num mono">${escapeHtml(f.flightNumber)}</span>
                  ${riskChip(c.riskLevel)}
                </div>
                <div class="ob-item-meta">
                  Stand <strong>${f.stand}</strong> · Aircraft <strong>${escapeHtml(f.aircraftType)}</strong> · EIBT <strong class="mono">${hhmm(f.eibt)}</strong>
                </div>
                <div class="ob-item-tobt">
                  <div class="tobt-box">
                    <span class="ob-k">TARGET OFF-BLOCK (TOBT)</span>
                    <span class="mono ob-v">${hhmm(c.tobt)}</span>
                  </div>
                  <button class="btn btn-primary btn-sm" data-log="${f.id}" type="button">Log off-block</button>
                </div>
              </div>`;
            }).join('') : emptyState('All caught up', 'No in-block flights are currently awaiting off-block confirmation.')}
          </div>
        </section>

        <!-- RIGHT: Recent Departures History Log -->
        <section class="card ob-history-card">
          <h3 class="card-h">Recent Off-Block Departures (${recent.length})</h3>
          ${recent.length ? `
          <div class="table-scroll">
            <table class="prov-tbl ob-tbl">
              <thead>
                <tr>
                  <th>Flight</th>
                  <th>Pred</th>
                  <th>Actual</th>
                  <th>Error</th>
                  <th>Supervisor</th>
                </tr>
              </thead>
              <tbody>
                ${recent.map(o => `
                <tr>
                  <td><strong class="mono">${escapeHtml(o.flightNumber)}</strong></td>
                  <td class="mono">${o.predictedBuffer}m</td>
                  <td class="mono">${o.actualBuffer}m</td>
                  <td><span class="orc-err ${errorClass(o.error)} mono">${fmtSigned(Math.round(o.error))} min</span></td>
                  <td>${escapeHtml(o.supervisor || '—')}</td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>` : '<p class="rs-none">No off-block outcomes logged yet.</p>'}
        </section>
      </div>
    </div>`;

  el.querySelector('.ob-list').onclick = e => { const b = e.target.closest('[data-log]'); if(b) openOffBlockModal(b.dataset.log); };
}

function openOffBlockModal(flightId){
  const f = getFlight(flightId); if(!f) return;
  const c = f.calculation;
  const modal = openModal(`
    <div class="modal-head"><div><h3>Log off-block</h3><p>${escapeHtml(f.flightNumber)} · Stand ${f.stand} · TOBT ${hhmm(c.tobt)}</p></div>
      <button class="modal-x" data-x aria-label="Close"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6 L18 18 M18 6 L6 18"/></svg></button></div>
    <div class="field"><label for="ob-time">Actual off-block time</label>
      <div class="input-wrap"><input type="time" id="ob-time" value="${hhmm(nowISO())}"/></div></div>
    <div class="ob-error" id="ob-error" hidden></div>
    <div class="field" id="ob-reason-field" hidden><label for="ob-reason">Delay reason (required — more than 15 min past TOBT)</label>
      <div class="input-wrap"><select id="ob-reason"><option value="" selected disabled>Select reason…</option>${DELAY_REASONS.map(r => `<option value="${r}">${r}</option>`).join('')}</select></div></div>
    <div class="modal-foot"><button class="btn btn-ghost" data-x>Cancel</button><button class="btn btn-primary" id="ob-save">Save off-block</button></div>`);

  modal.querySelectorAll('[data-x]').forEach(b => b.onclick = closeModal);
  const timeEl = modal.querySelector('#ob-time');
  const errEl = modal.querySelector('#ob-error');
  const reasonField = modal.querySelector('#ob-reason-field');

  function preview(){
    const actualIso = isoWithTime(f.eibt, timeEl.value);
    const err = minutesBetween(actualIso, c.tobt);
    errEl.hidden = false;
    errEl.className = 'ob-error ' + errorClass(err);
    errEl.innerHTML = `Prediction error: <strong class="mono">${fmtSigned(err)} min</strong> vs TOBT ${hhmm(c.tobt)}`;
    reasonField.hidden = !(err > 15);
    return { actualIso, err };
  }
  preview();
  timeEl.oninput = preview;

  modal.querySelector('#ob-save').onclick = () => {
    const { actualIso, err } = preview();
    let reason = null;
    if(err > 15){
      reason = modal.querySelector('#ob-reason').value;
      if(!reason){ modal.querySelector('#ob-reason-field').classList.add('shake'); setTimeout(() => modal.querySelector('#ob-reason-field').classList.remove('shake'), 320);
        showToast('A delay reason is required', 'error'); return; }
    }
    const actualBuffer = minutesBetween(actualIso, f.eibt);
    updateFlight(f.id, { status:'OFF_BLOCK', actualOffBlock:actualIso, delayReasonCode:reason });
    const outcomes = getOutcomes();
    outcomes.unshift({
      id:uid('oc'), flightId:f.id, flightNumber:f.flightNumber,
      predictedBuffer:c.bufferMinutes, actualBuffer, error:err,
      normalisedVector:c.normalisedVector, weightVersionId:c.weightVersionId,
      riskLevel:c.riskLevel, dominantVariable:c.dominantVariable,
      supervisor:currentActor(), dataQuality:c.dataQuality, loggedAt:nowISO(), delayReasonCode:reason
    });
    lsSet(OUTCOMES_KEY, outcomes);
    logActivity({ action:`logged off-block (error ${fmtSigned(err)} min)`, target:f.flightNumber, category:'offblock', severity:err > 15 ? 'warn' : 'success' });
    closeModal();
    showToast(`${f.flightNumber} off-block logged · error ${fmtSigned(err)} min`, Math.abs(err) <= 5 ? 'success' : 'notice');
    showModule('offblock');
  };
}

/* ═══ degraded mode — integration health drives input quality ═ */
function applyDegradedToFlights(){
  const integ = getIntegration();
  const flights = getFlights();
  flights.forEach(f => {
    const p = f.inputProvenance.perVariable;
    /* weather feed → heat index falls back to cached */
    if(integ.weather !== 'HEALTHY'){ if(p.heatIndexC.quality === 'GOOD'){ p.heatIndexC.quality = 'CACHED'; p.heatIndexC._autoW = true; } }
    else if(p.heatIndexC._autoW){ p.heatIndexC.quality = 'GOOD'; delete p.heatIndexC._autoW; }
    /* DCS feed → load factor falls back to cached */
    if(integ.dcs !== 'HEALTHY'){ if(p.loadFactorPercent.quality === 'GOOD'){ p.loadFactorPercent.quality = 'CACHED'; p.loadFactorPercent._autoD = true; } }
    else if(p.loadFactorPercent._autoD){ p.loadFactorPercent.quality = 'GOOD'; delete p.loadFactorPercent._autoD; }
    /* recompute keeping seed/timestamp so ONLY the data-quality flag changes */
    f.calculation = calculateFlightRisk(f, f.calculation.weightVersionId, f.calculation.calculatedAt);
  });
  saveFlights(flights);
}
function toggleIntegration(feed){
  const integ = getIntegration();
  integ[feed] = integ[feed] === 'HEALTHY' ? 'UNHEALTHY' : 'HEALTHY';
  saveIntegration(integ);
  applyDegradedToFlights();
  renderDegradedBanner();
  logActivity({ action:`${feed} feed marked ${integ[feed]}`, target:'Integration', category:'integration', severity:integ[feed] === 'HEALTHY' ? 'info' : 'warn' });
  showToast(`${feed === 'weather' ? 'Weather' : 'DCS'} feed ${integ[feed] === 'HEALTHY' ? 'restored' : 'marked unhealthy'}`, integ[feed] === 'HEALTHY' ? 'success' : 'notice');
  if(currentModule === 'manager') showModule('manager');
}

/* ═══ fleet → input plumbing (used by S7 recalcs) ═══════════ */
function unitFailureProb(u){
  const days = (Date.now() - new Date(u.lastService)) / 864e5;
  let p = (days * 8) / u.mtbfHours;   // ~8 operating hours/day
  if(u.status === 'UNSERVICEABLE') p = 1;
  else if(u.status === 'MAINTENANCE') p = Math.max(p, 0.6);
  return ENGINE.clamp(p, 0, 1);
}
function activeFleet(){ return getGse().filter(u => u.status !== 'RETIRED'); }
function fleetGseRatio(){ const f = activeFleet(); return { avail:f.filter(u => u.status === 'SERVICEABLE').length, total:f.length }; }
function fleetAvgFailure(){ const f = activeFleet(); return f.length ? f.reduce((a, u) => a + unitFailureProb(u), 0) / f.length : 0.3; }
function applyFleetToFlight(f){ const g = fleetGseRatio(); f.rawInputs.gseAvailable = g.avail; f.rawInputs.gseTotal = g.total; f.rawInputs.mtbfFailureProb = +fleetAvgFailure().toFixed(2); }

/* donut chart (hand-built SVG) */
function donutSVG(segments, size){
  const r = size / 2 - 10, cx = size / 2, cy = size / 2, C = 2 * Math.PI * r;
  const totalV = segments.reduce((a, s) => a + s.value, 0) || 1;
  let off = 0;
  const arcs = segments.map(s => {
    const frac = s.value / totalV, len = frac * C;
    const seg = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${s.color}" stroke-width="14"
      stroke-dasharray="${len.toFixed(1)} ${(C - len).toFixed(1)}" stroke-dashoffset="${(-off).toFixed(1)}"
      transform="rotate(-90 ${cx} ${cy})" class="donut-seg"/>`;
    off += len; return seg;
  }).join('');
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">${arcs}
    <text x="${cx}" y="${cy - 2}" text-anchor="middle" class="donut-total mono">${totalV}</text>
    <text x="${cx}" y="${cy + 15}" text-anchor="middle" class="donut-lbl">flights</text></svg>`;
}

/* ═══ S6 — MANAGER DASHBOARD (key: manager) ═════════════════ */
function renderManager(el){
  const user = currentUser();
  const isRep = user && user.role === 'AIRLINE_REP';
  /* AIRLINE_REP scoping — filter at the DATA layer, before rendering */
  let flights = getFlights();
  if(isRep) flights = flights.filter(f => f.airline === (user.airline || ''));

  const counts = { RED:0, AMBER:0, GREEN:0 };
  flights.forEach(f => counts[f.calculation.riskLevel]++);
  const avgBuffer = flights.length ? Math.round(flights.reduce((a, f) => a + f.calculation.bufferMinutes, 0) / flights.length) : 0;

  const alerts = getAlerts().filter(a => !isRep || flights.some(f => f.id === a.flightId));
  const acked = alerts.filter(a => a.stage === 'ACKNOWLEDGED').length;
  const escalated = alerts.filter(a => a.stage === 'ESCALATED' || a.stage === 'UNACK_CRITICAL').length;

  const weekAgo = Date.now() - 7 * 864e5;
  const recentOc = getOutcomes().filter(o => new Date(o.loggedAt) >= weekAgo && o.dataQuality === 'GOOD');
  const mae7 = recentOc.length ? +(recentOc.reduce((a, o) => a + Math.abs(o.error), 0) / recentOc.length).toFixed(1) : 0;
  const otpOc = getOutcomes().filter(o => new Date(o.loggedAt) >= weekAgo);
  const otp = otpOc.length ? Math.round(otpOc.filter(o => o.error <= 5).length / otpOc.length * 100) : 0;

  const integ = getIntegration();
  const fleet = activeFleet();
  const gseByType = {};
  fleet.forEach(u => { const t = gseByType[u.typeCode] = gseByType[u.typeCode] || { name:u.type, total:0, svc:0, uns:0 };
    t.total++; if(u.status === 'SERVICEABLE') t.svc++; if(u.status === 'UNSERVICEABLE') t.uns++; });

  const outstanding = alerts.filter(a => a.stage !== 'ACKNOWLEDGED');

  el.innerHTML = `
    <div class="mod-wide">
      <div class="mod-head">
        <div><h1 class="mod-title">Manager Dashboard</h1>
          <p class="mod-sub">Shift A situational awareness${isRep ? ` · <span class="rep-scope">${escapeHtml(user.airline)} flights only · read-only</span>` : ''}</p></div>
      </div>

      <!-- KPI STRIP -->
      <div class="kpi-strip">
        <div class="kpi"><span class="kpi-num mono" data-count="${flights.length}">0</span><span class="kpi-lbl">Flights today</span></div>
        <div class="kpi"><span class="kpi-num mono" data-count="${otp}" data-suffix="%">0</span><span class="kpi-lbl">On-time perf.</span></div>
        <div class="kpi"><span class="kpi-num mono" data-count="${avgBuffer}" data-suffix=" min">0</span><span class="kpi-lbl">Avg buffer</span></div>
        <div class="kpi"><span class="kpi-num mono">${acked}<span class="kpi-sep">/</span>${escalated}</span><span class="kpi-lbl">Ack / escalated</span></div>
        <div class="kpi"><span class="kpi-num mono" data-count="${mae7}" data-suffix=" min" data-dec="1">0</span><span class="kpi-lbl">MAE · 7 days</span></div>
      </div>

      <!-- ESCALATED / UNACK PANEL -->
      <section class="card esc-panel ${outstanding.length ? 'has' : ''}" id="esc-panel">
        <h3 class="card-h">Escalated &amp; unacknowledged</h3>
        <div id="esc-body">${escBodyHtml(outstanding)}</div>
        <p class="esc-note mono">Demo timers compressed · stages (SMS → escalation → critical) preserved</p>
      </section>

      <div class="mgr-grid">
        <!-- RISK DISTRIBUTION -->
        <section class="card"><h3 class="card-h">Risk distribution</h3>
          <div class="donut-wrap">${donutSVG([{ value:counts.RED, color:'var(--red)' }, { value:counts.AMBER, color:'var(--amber)' }, { value:counts.GREEN, color:'var(--green)' }], 150)}
            <div class="donut-legend">
              <span><i style="background:var(--red)"></i>RED ${counts.RED}</span>
              <span><i style="background:var(--amber)"></i>AMBER ${counts.AMBER}</span>
              <span><i style="background:var(--green)"></i>GREEN ${counts.GREEN}</span>
            </div></div>
        </section>

        <!-- BUFFER TIMELINE -->
        <section class="card"><h3 class="card-h">Buffer across today (EIBT order)</h3>
          <div class="timeline-wrap">${bufferTimelineSVG(flights)}</div>
        </section>
      </div>

      <!-- FLIGHT TABLE -->
      <section class="card"><h3 class="card-h">Flights</h3>
        <div class="table-scroll"><table class="mgr-tbl">
          <thead><tr><th>Flight</th><th>Stand</th><th>EIBT</th><th>Buffer</th><th>TOBT</th><th>Risk</th><th>Ack</th></tr></thead>
          <tbody>${flights.slice().sort((a, b) => new Date(a.eibt) - new Date(b.eibt)).map(f => `
            <tr><td class="mono">${escapeHtml(f.flightNumber)}</td><td>${f.stand}</td><td class="mono">${hhmm(f.eibt)}</td>
              <td class="mono">${f.calculation.bufferMinutes} min</td><td class="mono">${hhmm(f.calculation.tobt)}</td>
              <td>${riskChip(f.calculation.riskLevel)}</td>
              <td>${f.calculation.riskLevel === 'GREEN' ? '—' : f.ackStatus === 'ACKNOWLEDGED' ? '<span class="ack-yes">✓ Ack</span>' : '<span class="ack-no">Pending</span>'}</td></tr>`).join('')}
          </tbody></table></div>
      </section>

      <div class="mgr-grid">
        <!-- GSE STATUS -->
        <section class="card"><h3 class="card-h">GSE status</h3>
          <div class="gse-summary">${Object.values(gseByType).map(t => `
            <div class="gss-row"><span class="gss-name">${escapeHtml(t.name)}</span>
              <span class="gss-bar"><span style="width:${(t.svc / t.total * 100)}%;background:${t.svc / t.total >= 0.7 ? 'var(--green)' : t.svc / t.total >= 0.45 ? 'var(--amber)' : 'var(--red)'}"></span></span>
              <span class="mono gss-val">${t.svc}/${t.total}${t.uns ? ` · ${t.uns} U/S` : ''}</span></div>`).join('')}</div>
        </section>

        <!-- INTEGRATION HEALTH -->
        <section class="card"><h3 class="card-h">Integration health</h3>
          <div class="integ-rows">
            <div class="integ-row"><span class="integ-dot ${integ.weather === 'HEALTHY' ? 'ok' : 'down'}"></span>
              <span class="integ-name">Weather feed</span><span class="integ-status">${integ.weather}</span>
              ${isRep ? '' : `<button class="btn btn-ghost btn-xs" data-feed="weather" type="button">${integ.weather === 'HEALTHY' ? 'Mark unhealthy' : 'Restore'}</button>`}</div>
            <div class="integ-row"><span class="integ-dot ${integ.dcs === 'HEALTHY' ? 'ok' : 'down'}"></span>
              <span class="integ-name">DCS feed</span><span class="integ-status">${integ.dcs}</span>
              ${isRep ? '' : `<button class="btn btn-ghost btn-xs" data-feed="dcs" type="button">${integ.dcs === 'HEALTHY' ? 'Mark unhealthy' : 'Restore'}</button>`}</div>
          </div>
        </section>
      </div>
    </div>`;

  /* count-up KPIs */
  el.querySelectorAll('.kpi-num[data-count]').forEach(node => {
    const target = Number(node.dataset.count), suffix = node.dataset.suffix || '', dec = Number(node.dataset.dec || 0);
    const start = performance.now();
    (function frame(now){ const p = Math.min((now - start) / 700, 1); const v = target * (1 - Math.pow(1 - p, 3));
      node.textContent = (dec ? v.toFixed(dec) : Math.round(v)) + suffix;
      if(p < 1) requestAnimationFrame(frame); else node.textContent = (dec ? target.toFixed(dec) : target) + suffix; })(start);
  });

  if(!isRep) el.querySelectorAll('[data-feed]').forEach(b => b.onclick = () => toggleIntegration(b.dataset.feed));
}

function escBodyHtml(outstanding){
  if(!outstanding.length) return `<div class="esc-empty">✓ All alerts acknowledged.</div>`;
  return outstanding.map(a => {
    const f = getFlight(a.flightId);
    const outstandingMs = Date.now() - new Date(a.createdAt);
    return `<div class="esc-row r-${a.riskLevel}">
      <span class="esc-fl mono">${escapeHtml(a.flightNumber)}</span>
      ${riskChip(a.riskLevel)}
      <span class="esc-stage stage-${a.stage}">${a.stage.replace(/_/g, ' ')}</span>
      <span class="esc-time mono" data-created="${a.createdAt}">${mmss(outstandingMs)}</span>
      <span class="esc-lbl">outstanding</span></div>`;
  }).join('');
}
function tickManagerLive(){
  document.querySelectorAll('.esc-time[data-created]').forEach(el => {
    el.textContent = mmss(Date.now() - new Date(el.dataset.created));
  });
}

/* buffer timeline — area + risk-coloured points */
function bufferTimelineSVG(flights){
  const fs = flights.slice().sort((a, b) => new Date(a.eibt) - new Date(b.eibt));
  if(!fs.length) return '<p class="rs-none">No flights.</p>';
  const W = 460, H = 150, padL = 30, padB = 22, padT = 12, padR = 10;
  const maxB = 55, minB = 20;
  const x = i => padL + (fs.length === 1 ? 0.5 : i / (fs.length - 1)) * (W - padL - padR);
  const y = b => padT + (1 - (b - minB) / (maxB - minB)) * (H - padT - padB);
  const pts = fs.map((f, i) => [x(i), y(f.calculation.bufferMinutes)]);
  const area = polyPath(pts) + ` L${pts[pts.length - 1][0].toFixed(1)} ${H - padB} L${pts[0][0].toFixed(1)} ${H - padB} Z`;
  const grid = [20, 30, 40, 50].map(v => `<line x1="${padL}" y1="${y(v).toFixed(1)}" x2="${W - padR}" y2="${y(v).toFixed(1)}" class="tl-grid"/><text x="4" y="${(y(v) + 3).toFixed(1)}" class="tl-axis mono">${v}</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" class="tl-svg">
    ${grid}
    <path d="${area}" class="tl-area"/>
    <path d="${polyPath(pts)}" class="tl-line"/>
    ${fs.map((f, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(f.calculation.bufferMinutes).toFixed(1)}" r="4" fill="${riskColor(f.calculation.riskLevel)}" class="tl-pt"/>`).join('')}
    ${fs.map((f, i) => `<text x="${x(i).toFixed(1)}" y="${H - 6}" text-anchor="middle" class="tl-xlbl mono">${hhmm(f.eibt).slice(0, 5)}</text>`).join('')}
  </svg>`;
}

/* ═══ S7 — EQUIPMENT REGISTER (key: equipment) ══════════════ */
let equipFilter = { q:'', type:'ALL', status:'ALL' };
function renderEquipment(el){
  const fleet = getGse();
  const active = fleet.filter(u => u.status !== 'RETIRED');
  const svcPct = active.length ? Math.round(active.filter(u => u.status === 'SERVICEABLE').length / active.length * 100) : 0;
  const inMaint = active.filter(u => u.status === 'MAINTENANCE').length;
  const overdue = active.filter(u => new Date(u.nextServiceDue) < new Date()).length;
  const types = [...new Set(fleet.map(u => u.type))];

  const q = equipFilter.q.toLowerCase();
  let rows = fleet.filter(u => {
    if(equipFilter.type !== 'ALL' && u.type !== equipFilter.type) return false;
    if(equipFilter.status !== 'ALL' && u.status !== equipFilter.status) return false;
    if(q && !(`${u.serial} ${u.type}`.toLowerCase().includes(q))) return false;
    return true;
  });

  el.innerHTML = `
    <div class="mod-wide">
      <div class="mod-head"><div><h1 class="mod-title">Equipment Register</h1>
        <p class="mod-sub">${active.length} active units · fleet management</p></div>
        <button class="btn btn-primary btn-sm" id="eq-add" type="button">+ Add unit</button></div>

      <div class="fleet-strip">
        <div class="fs-tile"><span class="fs-num mono">${active.length}</span><span class="fs-lbl">Active units</span></div>
        <div class="fs-tile"><span class="fs-num mono">${svcPct}%</span><span class="fs-lbl">Serviceable</span></div>
        <div class="fs-tile"><span class="fs-num mono">${inMaint}</span><span class="fs-lbl">In maintenance</span></div>
        <div class="fs-tile ${overdue ? 'warn' : ''}"><span class="fs-num mono">${overdue}</span><span class="fs-lbl">Overdue service</span></div>
      </div>

      <div class="filters" style="border:1px solid var(--border);border-radius:var(--r);margin-bottom:16px">
        <div class="search"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20 L16.5 16.5"/></svg>
          <input type="text" id="eq-search" placeholder="Search serial or type…" value="${escapeHtml(equipFilter.q)}"/></div>
        <select id="eq-type" class="filter-select"><option value="ALL">All types</option>${types.map(t => `<option value="${escapeHtml(t)}" ${equipFilter.type === t ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('')}</select>
        <select id="eq-status" class="filter-select"><option value="ALL">All statuses</option>${['SERVICEABLE','UNSERVICEABLE','MAINTENANCE','RETIRED'].map(s => `<option value="${s}" ${equipFilter.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
      </div>

      <div class="card" style="padding:0"><div class="table-scroll"><table class="eq-tbl">
        <thead><tr><th>Unit</th><th>Type</th><th>Serial</th><th>Status</th><th>MTBF</th><th>Last service</th><th>Next due</th><th>Fail prob</th><th></th></tr></thead>
        <tbody>${rows.length ? rows.map(u => equipRowHtml(u)).join('') : `<tr><td colspan="9">${emptyState('No units match', 'Adjust the search or filters.')}</td></tr>`}</tbody>
      </table></div></div>
    </div>`;

  el.querySelector('#eq-add').onclick = () => openEquipModal(null);
  el.querySelector('#eq-search').oninput = e => { equipFilter.q = e.target.value; renderEquipmentTableOnly(); };
  el.querySelector('#eq-type').onchange = e => { equipFilter.type = e.target.value; renderEquipmentTableOnly(); };
  el.querySelector('#eq-status').onchange = e => { equipFilter.status = e.target.value; renderEquipmentTableOnly(); };
  el.querySelector('.eq-tbl tbody').onclick = handleEquipRowClick;
}

function renderEquipmentTableOnly(){
  const tbody = document.querySelector('.eq-tbl tbody');
  if(!tbody) return;
  const fleet = getGse();
  const q = equipFilter.q.toLowerCase();
  let rows = fleet.filter(u => {
    if(equipFilter.type !== 'ALL' && u.type !== equipFilter.type) return false;
    if(equipFilter.status !== 'ALL' && u.status !== equipFilter.status) return false;
    if(q && !(`${u.serial} ${u.type}`.toLowerCase().includes(q))) return false;
    return true;
  });
  tbody.innerHTML = rows.length ? rows.map(u => equipRowHtml(u)).join('') : `<tr><td colspan="9">${emptyState('No units match', 'Adjust the search or filters.')}</td></tr>`;
}

function renderEquipmentBody(){
  const searchInput = document.getElementById('eq-search');
  const isFocused = document.activeElement === searchInput;
  const selStart = searchInput ? searchInput.selectionStart : 0;
  const selEnd = searchInput ? searchInput.selectionEnd : 0;

  const el = document.querySelector('.module-view');
  if(el) renderEquipment(el);

  if(isFocused){
    const newInp = document.getElementById('eq-search');
    if(newInp){
      newInp.focus();
      try{ newInp.setSelectionRange(selStart, selEnd); } catch(err){}
    }
  }
}

function equipRowHtml(u){
  const overdue = new Date(u.nextServiceDue) < new Date() && u.status !== 'RETIRED';
  const fp = unitFailureProb(u);
  const stCls = { SERVICEABLE:'ok', UNSERVICEABLE:'bad', MAINTENANCE:'maint', RETIRED:'ret' }[u.status];
  return `<tr data-unit="${u.id}" class="${u.status === 'UNSERVICEABLE' ? 'row-uns' : ''} ${overdue ? 'row-overdue' : ''}">
    <td class="mono">${escapeHtml(u.id.replace('gse-', ''))}</td><td>${escapeHtml(u.type)}</td><td class="mono">${escapeHtml(u.serial)}</td>
    <td><span class="eq-status es-${stCls}">${u.status}</span></td>
    <td class="mono">${u.mtbfHours} h</td>
    <td class="mono">${fmtDate(u.lastService)}</td>
    <td class="mono ${overdue ? 'overdue-txt' : ''}">${fmtDate(u.nextServiceDue)}${overdue ? ' ⚠' : ''}</td>
    <td class="mono">${Math.round(fp * 100)}%</td>
    <td class="th-act"><button class="kebab-btn" data-eqmenu="${u.id}" aria-label="Actions"><svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg></button></td>
  </tr>`;
}
function handleEquipRowClick(e){
  const menu = e.target.closest('[data-eqmenu]');
  if(menu){ e.stopPropagation(); openEquipMenu(menu.dataset.eqmenu, menu); return; }
  const row = e.target.closest('[data-unit]'); if(row) openMaintDrawer(row.dataset.unit);
}
function openEquipMenu(id, anchor){
  const u = getGse().find(x => x.id === id); if(!u) return;
  const items = [
    { key:'log', label:'Maintenance log', onClick:() => openMaintDrawer(id) },
    { key:'edit', label:'Edit unit', onClick:() => openEquipModal(id) },
    { sep:true },
    { key:'svc', label:'Set serviceable', onClick:() => changeUnitStatus(id, 'SERVICEABLE') },
    { key:'uns', label:'Set unserviceable', onClick:() => changeUnitStatus(id, 'UNSERVICEABLE') },
    { key:'maint', label:'Set maintenance', onClick:() => changeUnitStatus(id, 'MAINTENANCE') },
    { sep:true },
    { key:'retire', label:'Retire unit', danger:true, onClick:() => retireUnit(id) }
  ];
  openKebab(anchor, items);
}
async function changeUnitStatus(id, status){
  const g = getGse(); const u = g.find(x => x.id === id); if(!u || u.status === status) return;
  u.status = status; saveGse(g);
  logActivity({ action:`set ${u.serial} ${status}`, target:u.type, category:'equipment', severity:status === 'UNSERVICEABLE' ? 'warn' : 'info' });
  showToast(`${u.serial} → ${status}`, 'success');
  renderEquipmentBody();
  offerRecalc();
}
async function retireUnit(id){
  const u = getGse().find(x => x.id === id); if(!u) return;
  const ok = await confirmDialog({ title:'Retire unit', message:`Retire ${u.serial} (${u.type})? It will be removed from active availability.`, confirmLabel:'Retire' });
  if(!ok) return;
  const g = getGse(); g.find(x => x.id === id).status = 'RETIRED'; saveGse(g);
  logActivity({ action:`retired ${u.serial}`, target:u.type, category:'equipment', severity:'warn' });
  showToast(`${u.serial} retired`, 'notice');
  renderEquipmentBody(); offerRecalc();
}
async function offerRecalc(){
  const ok = await confirmDialog({ title:'Recalculate pending flights?', message:'Equipment status changed — GSE availability and failure-risk inputs are affected. Recalculate all pending flights now?', confirmLabel:'Recalculate', danger:false });
  if(!ok) return;
  const modal = openModal(`<div class="modal-head"><div><h3>Recalculating</h3><p>Applying the updated fleet state</p></div></div><div id="recalc-host"></div>`);
  const total = getFlights().filter(f => f.status !== 'OFF_BLOCK').length;
  const changes = await recalcSequence(modal.querySelector('#recalc-host'), f => applyFleetToFlight(f));
  modal.querySelector('#recalc-host').innerHTML = changeSummaryHtml(changes, total) + '<div class="modal-foot"><button class="btn btn-primary" id="rc-close">Done</button></div>';
  modal.querySelector('#rc-close').onclick = closeModal;
  updateAlertBadge();
}

function openEquipModal(id){
  const u = id ? getGse().find(x => x.id === id) : null;
  const presets = ['Pushback Tug', 'Towbarless Tractor', 'Belt Loader', 'Baggage Tractor', 'Cargo High Loader', 'Ground Power Unit (GPU)', 'Air Start Unit (ASU)', 'Preconditioned Air (PCA)', 'Fuel Bowser Truck', 'Potable Water Truck', 'Lavatory Service Truck', 'Catering Hi-Lift Truck', 'Mobile Boarding Stairs', 'Ambulift (PRM)', 'Ramp Forklift', 'Wheel Chocks', 'Safety Cones', 'Baggage Cart / Dolly', 'Passenger Boarding Bridge', 'Fuel Hydrant System'];
  const curType = u ? u.type : '';
  const curStatus = u ? u.status : 'SERVICEABLE';
  const curLast = u ? u.lastService.slice(0, 10) : nowISO().slice(0, 10);
  const curNext = u ? u.nextServiceDue.slice(0, 10) : addMinutesISO(nowISO(), 60 * 24 * 30).slice(0, 10);

  const modal = openModal(`
    <div class="modal-head">
      <div>
        <div class="modal-h-tag mono">FLEET MANAGEMENT</div>
        <h3>${u ? 'Edit GSE Unit' : 'Register GSE Unit'}</h3>
        <p>${u ? `Serial: ${escapeHtml(u.serial)} · ID: ${escapeHtml(u.id)}` : 'Register a new airside unit to station inventory'}</p>
      </div>
      <button class="modal-x" data-x aria-label="Close">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6 L18 18 M18 6 L6 18"/></svg>
      </button>
    </div>

    <div class="eq-modal-body">
      <!-- TYPE SELECTOR & PRESET CHIPS -->
      <div class="field">
        <label for="eq-f-type">Equipment Type</label>
        <div class="input-wrap">
          <input type="text" id="eq-f-type" value="${escapeHtml(curType)}" placeholder="Select or type equipment category…" autocomplete="off" />
        </div>
        <div class="eq-type-chips" id="eq-type-chips">
          ${presets.map(t => `<button type="button" class="eq-chip ${curType === t ? 'active' : ''}" data-type="${t}">${t}</button>`).join('')}
        </div>
      </div>

      <!-- SERIAL & MTBF -->
      <div class="grid-2">
        <div class="field">
          <label for="eq-f-serial">Serial / Unit Identifier</label>
          <div class="input-wrap">
            <input type="text" id="eq-f-serial" value="${u ? escapeHtml(u.serial) : ''}" placeholder="e.g. BL-4474, GPU-802" autocomplete="off" />
          </div>
        </div>
        <div class="field">
          <label for="eq-f-mtbf">MTBF (Mean Time Between Failures)</label>
          <div class="input-wrap">
            <input type="number" id="eq-f-mtbf" value="${u ? u.mtbfHours : '800'}" placeholder="800" />
            <span class="input-unit mono">hrs</span>
          </div>
        </div>
      </div>

      <!-- VISUAL STATUS PILLS -->
      <div class="field">
        <label>Operational Status</label>
        <div class="eq-status-pills" id="eq-status-pills">
          <button type="button" class="eq-status-pill st-ok ${curStatus === 'SERVICEABLE' ? 'active' : ''}" data-status="SERVICEABLE">
            <span class="sp-dot"></span><span>SERVICEABLE</span>
          </button>
          <button type="button" class="eq-status-pill st-maint ${curStatus === 'MAINTENANCE' ? 'active' : ''}" data-status="MAINTENANCE">
            <span class="sp-dot"></span><span>MAINTENANCE</span>
          </button>
          <button type="button" class="eq-status-pill st-bad ${curStatus === 'UNSERVICEABLE' ? 'active' : ''}" data-status="UNSERVICEABLE">
            <span class="sp-dot"></span><span>UNSERVICEABLE</span>
          </button>
        </div>
      </div>

      <!-- DATE PICKERS WITH QUICK PRESET CHIPS -->
      <div class="grid-2">
        <div class="field">
          <label for="eq-f-last">Last Service Date</label>
          <div class="input-wrap date-wrap">
            <svg class="date-ico" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            <input type="date" id="eq-f-last" value="${curLast}"/>
          </div>
          <div class="date-presets">
            <button type="button" class="dp-preset" data-target="eq-f-last" data-days="0">Today</button>
            <button type="button" class="dp-preset" data-target="eq-f-last" data-days="-7">1 wk ago</button>
            <button type="button" class="dp-preset" data-target="eq-f-last" data-days="-30">1 mo ago</button>
          </div>
        </div>

        <div class="field">
          <label for="eq-f-next">Next Service Due</label>
          <div class="input-wrap date-wrap">
            <svg class="date-ico" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            <input type="date" id="eq-f-next" value="${curNext}"/>
          </div>
          <div class="date-presets">
            <button type="button" class="dp-preset" data-target="eq-f-next" data-days="30">+30 days</button>
            <button type="button" class="dp-preset" data-target="eq-f-next" data-days="60">+60 days</button>
            <button type="button" class="dp-preset" data-target="eq-f-next" data-days="90">+90 days</button>
          </div>
        </div>
      </div>
    </div>

    <div class="modal-foot">
      <button class="btn btn-ghost" data-x type="button">Cancel</button>
      <button class="btn btn-primary" id="eq-save" type="button">${u ? 'Save Changes' : 'Register Unit'}</button>
    </div>`);

  modal.querySelectorAll('[data-x]').forEach(b => b.onclick = closeModal);

  let selectedStatus = curStatus;
  const statusPills = modal.querySelectorAll('.eq-status-pill');
  statusPills.forEach(p => p.onclick = () => {
    statusPills.forEach(x => x.classList.remove('active'));
    p.classList.add('active');
    selectedStatus = p.dataset.status;
  });

  const typeInput = modal.querySelector('#eq-f-type');
  const typeChips = modal.querySelectorAll('.eq-chip');
  typeChips.forEach(c => c.onclick = () => {
    typeChips.forEach(x => x.classList.remove('active'));
    c.classList.add('active');
    typeInput.value = c.dataset.type;
  });

  modal.querySelectorAll('.dp-preset').forEach(btn => {
    btn.onclick = () => {
      const targetId = btn.dataset.target;
      const days = Number(btn.dataset.days);
      const targetInput = modal.querySelector('#' + targetId);
      if(targetInput){
        const d = new Date();
        d.setDate(d.getDate() + days);
        targetInput.value = d.toISOString().slice(0, 10);
      }
    };
  });

  modal.querySelector('#eq-save').onclick = () => {
    const type = typeInput.value.trim();
    const serial = modal.querySelector('#eq-f-serial').value.trim();
    const status = selectedStatus;
    const mtbf = Number(modal.querySelector('#eq-f-mtbf').value) || 800;
    const last = modal.querySelector('#eq-f-last').value;
    const next = modal.querySelector('#eq-f-next').value;
    if(!type || !serial){ showToast('Type and serial are required', 'error'); return; }
    const g = getGse();
    if(u){
      Object.assign(g.find(x => x.id === id), {
        type, serial, status, mtbfHours:mtbf,
        lastService:last ? new Date(last).toISOString() : u.lastService,
        nextServiceDue:next ? new Date(next).toISOString() : u.nextServiceDue
      });
      logActivity({ action:`edited unit ${serial}`, target:type, category:'equipment', severity:'info' });
    } else {
      const code = (type.match(/\b\w/g) || ['G']).join('').toUpperCase().slice(0, 3);
      g.push({
        id:'gse-' + code + '-' + uid('n').slice(-4), typeCode:code, type, serial, status, mtbfHours:mtbf,
        lastService:last ? new Date(last).toISOString() : nowISO(),
        nextServiceDue:next ? new Date(next).toISOString() : addMinutesISO(nowISO(), 60 * 24 * 30),
        maintLog:[]
      });
      logActivity({ action:`added unit ${serial}`, target:type, category:'equipment', severity:'success' });
    }
    saveGse(g); closeModal(); showToast(`${serial} ${u ? 'updated' : 'added'}`, 'success'); renderEquipmentBody();
  };
}

function openMaintDrawer(id){
  const u = getGse().find(x => x.id === id); if(!u) return;
  const log = (u.maintLog || []).slice().sort((a, b) => new Date(b.date) - new Date(a.date));
  openGenericDrawer(`
    <div class="drawer-head"><h3 style="font-size:15px;font-weight:700">${escapeHtml(u.serial)} · maintenance</h3>
      <button class="modal-x" data-x aria-label="Close"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6 L18 18 M18 6 L6 18"/></svg></button></div>
    <div class="drawer-body">
      <div class="dw-grid">
        <div class="dw-item"><div class="k">Type</div><div class="v">${escapeHtml(u.type)}</div></div>
        <div class="dw-item"><div class="k">Status</div><div class="v">${u.status}</div></div>
        <div class="dw-item"><div class="k">MTBF</div><div class="v mono">${u.mtbfHours} h</div></div>
        <div class="dw-item"><div class="k">Fail prob</div><div class="v mono">${Math.round(unitFailureProb(u) * 100)}%</div></div>
      </div>
      <div class="dw-section"><h4>Add log entry</h4>
        <div class="grid-2"><div class="field"><label>Date</label><div class="input-wrap"><input type="date" id="ml-date" value="${nowISO().slice(0, 10)}"/></div></div>
          <div class="field"><label>Hours</label><div class="input-wrap"><input type="text" id="ml-hours" placeholder="2"/></div></div></div>
        <div class="field"><label>Type</label><div class="input-wrap"><input type="text" id="ml-type" placeholder="Scheduled service"/></div></div>
        <div class="field"><label>Notes</label><textarea id="ml-notes" placeholder="Work performed…"></textarea></div>
        <button class="btn btn-primary btn-sm" id="ml-add" type="button">Add entry</button>
      </div>
      <div class="dw-section"><h4>Service history</h4>
        <div id="ml-list">${log.length ? log.map(m => `<div class="ml-row"><div class="ml-top"><span class="mono">${fmtDate(m.date)}</span><span class="ml-hrs mono">${m.hours || 0}h</span></div>
          <div class="ml-type">${escapeHtml(m.type)}</div>${m.notes ? `<div class="ml-notes">${escapeHtml(m.notes)}</div>` : ''}</div>`).join('') : '<p style="font-size:12.5px;color:var(--text-mute)">No service history recorded.</p>'}</div>
      </div>
    </div>`);
  const host = document.getElementById('drawer-host');
  host.querySelector('#ml-add').onclick = () => {
    const date = host.querySelector('#ml-date').value, hours = Number(host.querySelector('#ml-hours').value) || 0;
    const type = host.querySelector('#ml-type').value.trim() || 'Service', notes = host.querySelector('#ml-notes').value.trim();
    const g = getGse(); const unit = g.find(x => x.id === id);
    unit.maintLog = unit.maintLog || []; unit.maintLog.push({ date:date ? new Date(date).toISOString() : nowISO(), type, notes, hours });
    unit.lastService = date ? new Date(date).toISOString() : nowISO();
    saveGse(g);
    logActivity({ action:`logged maintenance on ${unit.serial}`, target:type, category:'equipment', severity:'info' });
    showToast('Maintenance entry added', 'success');
    openMaintDrawer(id);
  };
}

/* ═══ weight-version write helpers (append-only) ═══════════ */
function saveNewWeightVersion(params, note, fromRecalib){
  const versions = getWeightVersions();
  versions.forEach(v => { if(v.status === 'ACTIVE') v.status = 'SUPERSEDED'; });
  const nv = { id:'wv-' + uid('v').slice(-6), createdAt:nowISO(), author:currentActor(),
    note:note || 'Manual calibration update.', status:'ACTIVE', params:JSON.parse(JSON.stringify(params)) };
  versions.push(nv); saveWeightVersions(versions);
  logActivity({ action:'created weight version' + (fromRecalib ? ' (recalibration)' : ''), target:nv.id, category:'weights', severity:'warn' });
  return nv;
}
function activateWeightVersion(id){
  const versions = getWeightVersions();
  const target = versions.find(v => v.id === id); if(!target) return;
  versions.forEach(v => { v.status = v.id === id ? 'ACTIVE' : (v.status === 'ACTIVE' ? 'SUPERSEDED' : v.status); });
  /* ensure exactly one active */
  versions.forEach(v => { if(v.id !== id && v.status === 'ACTIVE') v.status = 'SUPERSEDED'; });
  saveWeightVersions(versions);
  logActivity({ action:'activated weight version', target:id, category:'weights', severity:'warn' });
}

/* transient compute with arbitrary params (no persistence) */
function computeWithParams(flight, params){
  const ts = flight.calculation ? flight.calculation.calculatedAt : nowISO();
  const r = ENGINE.run(flight.rawInputs, params, flight.flightNumber, ts);
  return { bufferMinutes:r.buffer, p10:r.p10, p50:r.p50, p90:r.p90, riskLevel:r.riskLevel,
    dominantVariable:ENGINE.VAR_NAMES[r.dominant] };
}

/* T9 monotonicity self-check — buffer must never decrease as any
   single variable rises with the others held fixed. */
function monotonicityCheck(params){
  const holds = [0.25, 0.75];
  const rises = [0.0, 0.2, 0.4, 0.6, 0.8, 1.0];
  const MONO_ITERS = 240;   // reduced draws keep the check well under a second
  let tested = 0; const violations = [];
  const p50For = v => {
    const raw = { heatIndexC:28 + v[0] * 27, gseAvailable:Math.round((1 - v[1]) * 1000), gseTotal:1000,
      mtbfFailureProb:v[2], loadFactorPercent:v[3] * 100, prmCount:v[4] * params.stationPrmP95, passengerTotal:1e6 };
    return ENGINE.run(raw, params, 'MONO', 'fixed-seed', MONO_ITERS).p50;
  };
  for(let k = 0; k < 5; k++){
    /* iterate the four held variables over the grid */
    for(const a of holds) for(const b of holds) for(const c of holds) for(const d of holds){
      const base = [a, b, c, d]; let prev = -Infinity;
      for(const r of rises){
        const v = [0, 0, 0, 0, 0]; let bi = 0;
        for(let i = 0; i < 5; i++) v[i] = (i === k) ? r : base[bi++];
        const buf = p50For(v);
        tested++;
        if(buf < prev - 1e-9) violations.push({ variable:ENGINE.VAR_NAMES[k], at:r, drop:+(prev - buf).toFixed(3) });
        prev = buf;
      }
    }
  }
  return { pass:violations.length === 0, tested, violations };
}

/* ═══ S8 — WEIGHTS & THRESHOLDS (key: weights) ══════════════ */
function renderWeights(el){
  const active = getActiveWeightVersion();
  const proposed = JSON.parse(JSON.stringify(active.params));
  const flights = getFlights();
  let previewFlightId = flights.length ? flights[0].id : null;

  el.innerHTML = `
    <div class="mod-wide">
      <div class="mod-head"><div><h1 class="mod-title">Weights &amp; Thresholds</h1>
        <p class="mod-sub">Calibration · append-only versioning · active <span class="mono">${escapeHtml(active.id)}</span></p></div></div>

      <div class="weights-grid">
        <!-- LEFT COLUMN: WEIGHTS, SIGMA & ACTIONS -->
        <section class="card">
          <h3 class="card-h">Variable weights <span class="wt-total mono" id="wt-total">1.000</span></h3>
          <div id="weight-sliders">
            ${ENGINE.VAR_NAMES.map((name, i) => `
              <div class="wt-row"><label>${escapeHtml(name)}</label>
                <input type="range" min="0" max="1" step="0.01" value="${proposed.weights[i]}" data-w="${i}"/>
                <span class="wt-val mono" data-wv="${i}">${proposed.weights[i].toFixed(2)}</span></div>`).join('')}
          </div>
          <div class="wt-validate" id="wt-validate"></div>
          <div class="wt-btns"><button class="btn btn-ghost btn-sm" id="wt-normalise" type="button">Normalise to 1.0</button></div>

          <h3 class="card-h" style="margin-top:20px">Sigma (per-variable σ)</h3>
          <div class="param-grid">
            ${ENGINE.VAR_NAMES.map((name, i) => `
              <div class="pg-field"><label>${escapeHtml(name)}</label><input type="text" data-sig="${i}" value="${proposed.sigma[i]}"/></div>`).join('')}
            <div class="pg-field"><label>Residual Noise (σ)</label><input type="text" data-sig="5" value="${proposed.sigma[5] || 0.05}"/></div>
          </div>

          <div class="wt-info-card">
            <span class="wt-info-tag mono">T9 ENFORCED</span>
            <span class="wt-info-txt">Monotonicity constraints prevent buffer decay when single risk variables escalate.</span>
          </div>

          <div class="wt-actions">
            <button class="btn btn-ghost btn-sm" id="wt-mono" type="button">Run monotonicity check (T9)</button>
            <button class="btn btn-primary btn-sm" id="wt-save" type="button">Save new version</button>
          </div>
          <div class="mono-result" id="mono-result" hidden></div>
        </section>

        <!-- RIGHT COLUMN: LIVE PREVIEW & THRESHOLDS -->
        <section class="card">
          <h3 class="card-h">Live preview</h3>
          <div class="field"><label for="wt-flight">Preview flight</label><div class="input-wrap">
            <select id="wt-flight">${flights.map(f => `<option value="${f.id}">${escapeHtml(f.flightNumber)} · ${f.calculation.riskLevel}</option>`).join('')}</select></div></div>
          <div class="preview-cmp" id="preview-cmp"></div>

          <h3 class="card-h" style="margin-top:22px">Buffer &amp; risk thresholds</h3>
          <div class="param-grid">
            <div class="pg-field"><label>Base buffer (min)</label><input type="text" data-p="baseBuffer" value="${proposed.baseBuffer}"/></div>
            <div class="pg-field"><label>Max additional (min)</label><input type="text" data-p="maxAdditional" value="${proposed.maxAdditional}"/></div>
            <div class="pg-field"><label>Green p90 limit</label><input type="text" data-th="green_p90" value="${proposed.thresholds.green_p90}"/></div>
            <div class="pg-field"><label>Green spread limit</label><input type="text" data-th="green_spread" value="${proposed.thresholds.green_spread}"/></div>
            <div class="pg-field"><label>Amber p90 limit</label><input type="text" data-th="amber_p90" value="${proposed.thresholds.amber_p90}"/></div>
            <div class="pg-field"><label>Amber spread limit</label><input type="text" data-th="amber_spread" value="${proposed.thresholds.amber_spread}"/></div>
            <div class="pg-field"><label>Station PRM P95</label><input type="text" data-p="stationPrmP95" value="${proposed.stationPrmP95}"/></div>
            <div class="pg-field"><label>Safety Factor Margin</label><input type="text" data-p="safetyFactor" value="${proposed.safetyFactor || 1.00}"/></div>
          </div>
        </section>
      </div>

      <section class="card"><h3 class="card-h">Version history</h3>
        <div class="table-scroll"><table class="ver-tbl">
          <thead><tr><th>Version</th><th>Status</th><th>Author</th><th>Created</th><th>Note</th><th></th></tr></thead>
          <tbody id="ver-body"></tbody></table></div>
        <div class="ver-diff-hint mono">Select two versions to diff.</div>
      </section>
    </div>`;

  /* ── state sync ── */
  function readTotal(){ return proposed.weights.reduce((a, b) => a + b, 0); }
  function paintTotal(){
    const total = readTotal();
    const t = el.querySelector('#wt-total'); t.textContent = total.toFixed(3);
    const ok = Math.abs(total - 1) < 0.001;
    t.classList.toggle('bad', !ok); t.classList.toggle('good', ok);
    const val = el.querySelector('#wt-validate');
    val.className = 'wt-validate ' + (ok ? 'ok' : 'bad');
    val.textContent = ok ? '✓ Weights sum to 1.0 — save enabled.' : `VALIDATION_FAILED · weights sum to ${total.toFixed(3)}, must equal 1.0`;
    el.querySelector('#wt-save').disabled = !ok;
  }
  function paintPreview(){
    const f = getFlight(el.querySelector('#wt-flight').value); if(!f) return;
    const cur = computeWithParams(f, active.params);
    const prop = computeWithParams(f, proposed);
    const cell = (a, b, unit) => `<td class="mono">${a}${unit || ''}</td><td class="mono ${a !== b ? 'changed' : ''}">${b}${unit || ''}</td>`;
    el.querySelector('#preview-cmp').innerHTML = `
      <table class="cmp-tbl"><thead><tr><th>Metric</th><th>Active</th><th>Proposed</th></tr></thead><tbody>
        <tr><td>Buffer</td>${cell(cur.bufferMinutes, prop.bufferMinutes, ' min')}</tr>
        <tr><td>P10</td>${cell(Math.round(cur.p10), Math.round(prop.p10), '')}</tr>
        <tr><td>P50</td>${cell(Math.round(cur.p50), Math.round(prop.p50), '')}</tr>
        <tr><td>P90</td>${cell(Math.round(cur.p90), Math.round(prop.p90), '')}</tr>
        <tr><td>Risk</td><td>${riskChip(cur.riskLevel)}</td><td>${riskChip(prop.riskLevel)}</td></tr>
        <tr><td>Driver</td><td>${escapeHtml(cur.dominantVariable)}</td><td class="${cur.dominantVariable !== prop.dominantVariable ? 'changed' : ''}">${escapeHtml(prop.dominantVariable)}</td></tr>
      </tbody></table>`;
  }
  paintTotal(); paintPreview(); renderVersionTable(el);

  el.querySelector('#weight-sliders').oninput = e => {
    const s = e.target.closest('[data-w]'); if(!s) return;
    const i = Number(s.dataset.w); proposed.weights[i] = Number(s.value);
    el.querySelector(`[data-wv="${i}"]`).textContent = proposed.weights[i].toFixed(2);
    paintTotal(); paintPreview();
  };
  el.querySelector('#wt-normalise').onclick = () => {
    const s = readTotal() || 1; proposed.weights = proposed.weights.map(w => +(w / s).toFixed(3));
    el.querySelectorAll('[data-w]').forEach(sl => { const i = Number(sl.dataset.w); sl.value = proposed.weights[i]; el.querySelector(`[data-wv="${i}"]`).textContent = proposed.weights[i].toFixed(2); });
    paintTotal(); paintPreview();
  };
  el.querySelectorAll('[data-sig]').forEach(inp => inp.oninput = () => { proposed.sigma[Number(inp.dataset.sig)] = Number(inp.value) || 0; paintPreview(); });
  el.querySelectorAll('[data-p]').forEach(inp => inp.oninput = () => { proposed[inp.dataset.p] = Number(inp.value) || 0; paintPreview(); });
  el.querySelectorAll('[data-th]').forEach(inp => inp.oninput = () => { proposed.thresholds[inp.dataset.th] = Number(inp.value) || 0; paintPreview(); });
  el.querySelector('#wt-flight').onchange = paintPreview;

  el.querySelector('#wt-mono').onclick = () => {
    const box = el.querySelector('#mono-result'); box.hidden = false;
    box.className = 'mono-result'; box.innerHTML = 'Running T9 across the sampled input grid…';
    const btn = el.querySelector('#wt-mono'); btn.disabled = true;
    setTimeout(() => {   // let the "running" state paint before the blocking compute
    const res = monotonicityCheck(proposed);
    btn.disabled = false;
    box.className = 'mono-result ' + (res.pass ? 'ok' : 'fail');
    box.innerHTML = res.pass
      ? `<strong>✓ T9 PASSED.</strong> ${res.tested} input combinations tested — raising any single variable never reduced the buffer.`
      : `<strong>✗ T9 FAILED.</strong> ${res.violations.length} violation(s) across ${res.tested} combinations. First: ${escapeHtml(res.violations[0].variable)} dropped ${res.violations[0].drop} min.`;
    logActivity({ action:'ran monotonicity check', target:res.pass ? 'PASS' : 'FAIL', category:'weights', severity:res.pass ? 'info' : 'danger' });
    }, 30);
  };

  el.querySelector('#wt-save').onclick = () => {
    const total = readTotal();
    if(Math.abs(total - 1) >= 0.001){ showToast('VALIDATION_FAILED — weights must sum to 1.0', 'error'); return; }
    const nv = saveNewWeightVersion(proposed, 'Manual calibration update.');
    showToast(`New active version ${nv.id} created`, 'success');
    showModule('weights');
  };
}

let diffSelection = [];
function renderVersionTable(el){
  const versions = getWeightVersions().slice().reverse();
  const body = el.querySelector('#ver-body');
  body.innerHTML = versions.map(v => `
    <tr data-ver="${v.id}" class="${diffSelection.includes(v.id) ? 'sel' : ''}">
      <td class="mono">${escapeHtml(v.id)}</td>
      <td><span class="ver-status vs-${v.status.toLowerCase()}">${v.status}</span></td>
      <td>${escapeHtml(v.author)}</td><td class="mono">${fmtDate(v.createdAt)}</td>
      <td class="ver-note">${escapeHtml(v.note)}</td>
      <td class="th-act">${v.status !== 'ACTIVE' ? `<button class="btn btn-ghost btn-xs" data-activate="${v.id}" type="button">Activate</button>` : '<span class="mono" style="color:var(--text-mute);font-size:11px">current</span>'}</td>
    </tr>`).join('');
  body.onclick = e => {
    const act = e.target.closest('[data-activate]');
    if(act){ e.stopPropagation(); activateWeightVersion(act.dataset.activate); showToast('Version activated (rollback applied)', 'success'); showModule('weights'); return; }
    const row = e.target.closest('[data-ver]'); if(!row) return;
    const id = row.dataset.ver;
    const idx = diffSelection.indexOf(id);
    if(idx >= 0) diffSelection.splice(idx, 1); else { diffSelection.push(id); if(diffSelection.length > 2) diffSelection.shift(); }
    renderVersionTable(el);
    if(diffSelection.length === 2) openVersionDiff(diffSelection[0], diffSelection[1]);
  };
}
function openVersionDiff(idA, idB){
  const a = getWeightVersion(idA), b = getWeightVersion(idB); if(!a || !b) return;
  const line = (label, x, y) => `<tr><td>${label}</td><td class="mono">${x}</td><td class="mono ${x !== y ? 'changed' : ''}">${y}</td></tr>`;
  const rows = ENGINE.VAR_NAMES.map((n, i) => line('W · ' + n, a.params.weights[i], b.params.weights[i])).join('') +
    ENGINE.VAR_NAMES.map((n, i) => line('σ · ' + n, a.params.sigma[i], b.params.sigma[i])).join('') +
    line('Base buffer', a.params.baseBuffer, b.params.baseBuffer) + line('Max additional', a.params.maxAdditional, b.params.maxAdditional) +
    ['green_p90','green_spread','amber_p90','amber_spread'].map(k => line(k, a.params.thresholds[k], b.params.thresholds[k])).join('') +
    line('PRM P95', a.params.stationPrmP95, b.params.stationPrmP95);
  openModal(`<div class="modal-head"><div><h3>Version diff</h3><p>${escapeHtml(idA)} → ${escapeHtml(idB)}</p></div>
    <button class="modal-x" data-x aria-label="Close"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6 L18 18 M18 6 L6 18"/></svg></button></div>
    <div class="table-scroll"><table class="diff-tbl"><thead><tr><th>Parameter</th><th>${escapeHtml(idA)}</th><th>${escapeHtml(idB)}</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="modal-foot"><button class="btn btn-primary" data-x>Close</button></div>`, true)
    .querySelectorAll('[data-x]').forEach(b2 => b2.onclick = () => { closeModal(); diffSelection = []; if(currentModule === 'weights') renderVersionTable(document.querySelector('.module-view')); });
}

/* ═══ recalibration fit (coordinate descent, MAE-minimising) ═ */
function fitWeights(params){
  const data = getOutcomes().filter(o => o.dataQuality === 'GOOD' && Array.isArray(o.normalisedVector));
  if(data.length < 8) return null;
  const sig = x => 1 / (1 + Math.exp(-x));
  const pred = (v, w) => params.baseBuffer + sig(10 * (v.reduce((a, x, k) => a + x * w[k], 0) - 0.5)) * params.maxAdditional;
  const mae = w => data.reduce((a, o) => a + Math.abs(pred(o.normalisedVector, w) - o.actualBuffer), 0) / data.length;
  let w = params.weights.slice(); let best = mae(w);
  for(const step of [0.08, 0.04, 0.02]){
    let improved = true, guard = 0;
    while(improved && guard++ < 300){ improved = false;
      for(let i = 0; i < 5; i++) for(let j = 0; j < 5; j++){ if(i === j || w[i] - step < 0) continue;
        const cand = w.slice(); cand[i] -= step; cand[j] += step;
        const m = mae(cand); if(m < best - 1e-9){ best = m; w = cand; improved = true; }
      }
    }
  }
  const s = w.reduce((a, b) => a + b, 0) || 1; w = w.map(x => +(x / s).toFixed(3));
  const currentMae = +mae(params.weights).toFixed(2);
  return { weights:w, mae:+best.toFixed(2), currentMae, n:data.length,
    improvement:currentMae > 0 ? +((currentMae - best) / currentMae * 100).toFixed(1) : 0 };
}

/* ═══ S9 — ACCURACY ANALYTICS (key: analytics) ═════════════ */
let analyticsRange = 30, analyticsAnon = true;
function renderAnalytics(el){
  const cutoff = analyticsRange === 0 ? 0 : Date.now() - analyticsRange * 864e5;
  const all = getOutcomes();
  const data = all.filter(o => new Date(o.loggedAt) >= cutoff);
  const errs = data.map(o => o.error);
  const abs = errs.map(Math.abs);
  const mae = abs.length ? +(abs.reduce((a, b) => a + b, 0) / abs.length).toFixed(1) : 0;
  const sorted = errs.slice().sort((a, b) => a - b);
  const median = sorted.length ? +sorted[Math.floor(sorted.length / 2)].toFixed(1) : 0;
  const within5 = abs.length ? Math.round(abs.filter(x => x <= 5).length / abs.length * 100) : 0;

  el.innerHTML = `
    <div class="mod-wide">
      <div class="mod-head"><div><h1 class="mod-title">Accuracy Analytics</h1>
        <p class="mod-sub">${data.length} outcomes · the system proving whether it works</p></div>
        <div class="an-range">${[[7,'7d'],[30,'30d'],[90,'90d'],[0,'All']].map(([v, l]) => `<button class="rg-btn ${analyticsRange === v ? 'on' : ''}" data-range="${v}" type="button">${l}</button>`).join('')}</div></div>

      <div class="kpi-strip">
        <div class="kpi"><span class="kpi-num mono" data-count="${mae}" data-dec="1" data-suffix=" min">0</span><span class="kpi-lbl">Mean abs error</span></div>
        <div class="kpi"><span class="kpi-num mono">${fmtSigned(median)} min</span><span class="kpi-lbl">Median error</span></div>
        <div class="kpi"><span class="kpi-num mono" data-count="${within5}" data-suffix="%">0</span><span class="kpi-lbl">Within ±5 min</span></div>
        <div class="kpi"><span class="kpi-num mono" data-count="${data.length}">0</span><span class="kpi-lbl">Outcomes</span></div>
      </div>

      <div class="mgr-grid">
        <section class="card"><h3 class="card-h">MAE over time</h3><div class="an-chart">${maeLineSVG(data)}</div></section>
        <section class="card"><h3 class="card-h">Predicted vs actual</h3><div class="an-chart">${scatterSVG(data)}</div>
          <p class="an-cap mono">diagonal = perfect prediction · colour = risk</p></section>
      </div>

      <div class="mgr-grid">
        <section class="card"><h3 class="card-h">Error distribution</h3><div class="an-chart">${errorHistSVG(errs)}</div>
          <p class="an-cap mono">signed error, centred on zero</p></section>
        <section class="card"><h3 class="card-h">MAE by risk &amp; driver</h3>
          <div class="brk">${maeByGroup(data, 'riskLevel', ['RED','AMBER','GREEN'])}</div>
          <div class="brk" style="margin-top:10px">${maeByGroup(data, 'dominantVariable', ENGINE.VAR_NAMES)}</div></section>
      </div>

      <section class="card"><div class="an-sup-head"><h3 class="card-h" style="margin:0">Per-supervisor accuracy</h3>
        <label class="switch-inline"><span>Anonymise</span><label class="switch"><input type="checkbox" id="an-anon" ${analyticsAnon ? 'checked' : ''}/><span class="slider"></span></label></label></div>
        <p class="an-note">This dataset links a named individual to every prediction error — useful operationally but personally sensitive, so the identified view is opt-in.</p>
        <div id="an-sup">${supervisorTable(data, analyticsAnon)}</div>
      </section>

      <section class="card recalib-card"><h3 class="card-h">Recalibration proposal</h3>
        <div id="recalib-body"></div></section>

      <div class="an-export">
        <button class="btn btn-ghost btn-sm" id="an-csv" type="button">Export CSV</button>
        <button class="btn btn-ghost btn-sm" id="an-json" type="button">Export JSON</button>
      </div>
    </div>`;

  el.querySelectorAll('.kpi-num[data-count]').forEach(node => {
    const target = Number(node.dataset.count), suffix = node.dataset.suffix || '', dec = Number(node.dataset.dec || 0);
    const start = performance.now();
    (function frame(now){ const p = Math.min((now - start) / 700, 1); const v = target * (1 - Math.pow(1 - p, 3));
      node.textContent = (dec ? v.toFixed(dec) : Math.round(v)) + suffix;
      if(p < 1) requestAnimationFrame(frame); else node.textContent = (dec ? target.toFixed(dec) : target) + suffix; })(start);
  });

  el.querySelector('.an-range').onclick = e => { const b = e.target.closest('[data-range]'); if(b){ analyticsRange = Number(b.dataset.range); showModule('analytics'); } };
  el.querySelector('#an-anon').onchange = e => { analyticsAnon = e.target.checked; el.querySelector('#an-sup').innerHTML = supervisorTable(getOutcomes().filter(o => new Date(o.loggedAt) >= cutoff), analyticsAnon); };
  el.querySelector('#an-csv').onclick = exportOutcomesCSV;
  el.querySelector('#an-json').onclick = exportOutcomesJSON;

  renderRecalibPanel(el.querySelector('#recalib-body'));
}

function maeByGroup(data, key, order){
  const groups = {};
  data.forEach(o => { const g = o[key]; (groups[g] = groups[g] || []).push(Math.abs(o.error)); });
  const rows = order.filter(k => groups[k]).map(k => ({ k, mae:groups[k].reduce((a, b) => a + b, 0) / groups[k].length, n:groups[k].length }));
  const max = Math.max(1, ...rows.map(r => r.mae));
  if(!rows.length) return '<p class="rs-none">No data.</p>';
  return rows.map(r => `<div class="brk-row"><span class="brk-lbl">${escapeHtml(r.k)}</span>
    <span class="brk-bar"><span style="width:${(r.mae / max * 100).toFixed(0)}%"></span></span>
    <span class="mono brk-val">${r.mae.toFixed(1)} <span class="brk-n">(${r.n})</span></span></div>`).join('');
}

function supervisorTable(data, anon){
  const groups = {};
  data.forEach(o => { (groups[o.supervisor] = groups[o.supervisor] || []).push(o); });
  const names = Object.keys(groups).sort();
  if(!names.length) return '<p class="rs-none">No data.</p>';
  const labels = {}; names.forEach((n, i) => labels[n] = 'Supervisor ' + String.fromCharCode(65 + i));
  return `<table class="sup-tbl"><thead><tr><th>Supervisor</th><th>Outcomes</th><th>MAE</th><th>Within ±5</th></tr></thead><tbody>${
    names.map(n => { const g = groups[n]; const mae = g.reduce((a, o) => a + Math.abs(o.error), 0) / g.length;
      const w5 = Math.round(g.filter(o => Math.abs(o.error) <= 5).length / g.length * 100);
      return `<tr><td>${anon ? labels[n] : escapeHtml(n)}</td><td class="mono">${g.length}</td><td class="mono">${mae.toFixed(1)} min</td><td class="mono">${w5}%</td></tr>`; }).join('')
  }</tbody></table>`;
}

function renderRecalibPanel(host){
  const active = getActiveWeightVersion();
  const fit = fitWeights(active.params);
  if(!fit){ host.innerHTML = '<p class="rs-none">Not enough GOOD-quality outcomes to propose a recalibration yet.</p>'; return; }
  const material = fit.improvement >= 5;
  host.innerHTML = `
    <div class="recalib-metrics">
      <div class="rcm"><span class="rcm-k">Current MAE</span><span class="rcm-v mono">${fit.currentMae} min</span></div>
      <div class="rcm"><span class="rcm-k">Proposed MAE</span><span class="rcm-v mono">${fit.mae} min</span></div>
      <div class="rcm"><span class="rcm-k">Improvement</span><span class="rcm-v mono ${material ? 'good' : ''}">${fit.improvement}%</span></div>
      <div class="rcm"><span class="rcm-k">GOOD outcomes</span><span class="rcm-v mono">${fit.n}</span></div>
    </div>
    ${material ? `
      <table class="cmp-tbl" style="margin-top:12px"><thead><tr><th>Variable</th><th>Current</th><th>Proposed</th></tr></thead><tbody>
        ${ENGINE.VAR_NAMES.map((n, i) => `<tr><td>${escapeHtml(n)}</td><td class="mono">${active.params.weights[i].toFixed(3)}</td><td class="mono changed">${fit.weights[i].toFixed(3)}</td></tr>`).join('')}
      </tbody></table>
      <button class="btn btn-primary btn-sm" id="recalib-approve" type="button" style="margin-top:12px">Approve &amp; create version</button>`
    : `<div class="recalib-nochange">No material improvement · current weights retained (improvement below the 5% threshold).</div>`}`;
  if(material){
    host.querySelector('#recalib-approve').onclick = () => {
      const params = JSON.parse(JSON.stringify(active.params)); params.weights = fit.weights.slice();
      const nv = saveNewWeightVersion(params, `Recalibration from analytics · MAE ${fit.currentMae}→${fit.mae} min (${fit.improvement}% better).`, true);
      showToast(`Recalibrated weights saved as ${nv.id}`, 'success');
      showModule('analytics');
    };
  }
}

/* analytics charts */
function scatterSVG(data){
  const W = 300, H = 180, pad = 30, lo = 15, hi = 55;
  const sx = v => pad + (ENGINE.clamp(v, lo, hi) - lo) / (hi - lo) * (W - pad - 8);
  const sy = v => (H - pad) - (ENGINE.clamp(v, lo, hi) - lo) / (hi - lo) * (H - pad - 8);
  if(!data.length) return '<p class="rs-none">No data.</p>';
  return `<svg viewBox="0 0 ${W} ${H}" width="100%">
    <line x1="${sx(lo)}" y1="${sy(lo)}" x2="${sx(hi)}" y2="${sy(hi)}" class="scat-diag"/>
    ${data.map(o => `<circle cx="${sx(o.predictedBuffer).toFixed(1)}" cy="${sy(o.actualBuffer).toFixed(1)}" r="3.4" fill="${riskColor(o.riskLevel)}" opacity="0.72" class="scat-pt"/>`).join('')}
    <text x="${W / 2}" y="${H - 4}" text-anchor="middle" class="an-axis mono">predicted →</text>
    <text x="8" y="14" class="an-axis mono">actual ↑</text></svg>`;
}
function errorHistSVG(errs){
  const W = 300, H = 170, pad = 24, lo = -25, hi = 25, nb = 20;
  const bins = new Array(nb).fill(0);
  errs.forEach(e => { let idx = Math.floor((ENGINE.clamp(e, lo, hi) - lo) / (hi - lo) * nb); bins[ENGINE.clamp(idx, 0, nb - 1)]++; });
  const max = Math.max(1, ...bins), bw = (W - pad) / nb;
  if(!errs.length) return '<p class="rs-none">No data.</p>';
  const zeroX = pad + (0 - lo) / (hi - lo) * (W - pad);
  return `<svg viewBox="0 0 ${W} ${H}" width="100%">
    <line x1="${zeroX.toFixed(1)}" y1="6" x2="${zeroX.toFixed(1)}" y2="${H - pad}" class="eh-zero"/>
    ${bins.map((b, i) => { const bh = b / max * (H - pad - 8); const x = pad + i * bw;
      return `<rect x="${(x + 1).toFixed(1)}" y="${(H - pad - bh).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${bh.toFixed(1)}" rx="1" class="hist-bar" style="fill:var(--primary);animation-delay:${i * 16}ms"/>`; }).join('')}
    <text x="${zeroX.toFixed(1)}" y="${H - 6}" text-anchor="middle" class="an-axis mono">0</text>
    <text x="${pad}" y="${H - 6}" class="an-axis mono">${lo}</text><text x="${W - 6}" y="${H - 6}" text-anchor="end" class="an-axis mono">+${hi}</text></svg>`;
}
function maeLineSVG(data){
  const days = {};
  data.forEach(o => { const d = o.loggedAt.slice(0, 10); (days[d] = days[d] || []).push(Math.abs(o.error)); });
  const keys = Object.keys(days).sort();
  if(keys.length < 2) return '<p class="rs-none">Not enough days of data.</p>';
  const series = keys.map(k => ({ d:k, mae:days[k].reduce((a, b) => a + b, 0) / days[k].length }));
  const W = 300, H = 170, padL = 26, padB = 22, padT = 10, padR = 8;
  const maxM = Math.max(12, ...series.map(s => s.mae));
  const x = i => padL + (series.length === 1 ? 0.5 : i / (series.length - 1)) * (W - padL - padR);
  const y = m => padT + (1 - m / maxM) * (H - padT - padB);
  const pts = series.map((s, i) => [x(i), y(s.mae)]);
  const trend = series[series.length - 1].mae - series[0].mae;
  return `<svg viewBox="0 0 ${W} ${H}" width="100%">
    ${[0, maxM / 2, maxM].map(v => `<line x1="${padL}" y1="${y(v).toFixed(1)}" x2="${W - padR}" y2="${y(v).toFixed(1)}" class="tl-grid"/><text x="2" y="${(y(v) + 3).toFixed(1)}" class="an-axis mono">${v.toFixed(0)}</text>`).join('')}
    <path d="${polyPath(pts)}" class="tl-line" style="stroke:var(--primary)"/>
    ${pts.map(p => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3" fill="var(--primary)"/>`).join('')}
    <text x="${W - 6}" y="14" text-anchor="end" class="an-axis mono ${trend <= 0 ? 'trend-good' : 'trend-bad'}">${trend <= 0 ? '▼ improving' : '▲ worsening'}</text></svg>`;
}

function outcomeColumns(){ return ['id','flightNumber','predictedBuffer','actualBuffer','error','riskLevel','dominantVariable','supervisor','dataQuality','weightVersionId','delayReasonCode','loggedAt']; }
function exportOutcomesCSV(){
  const cols = outcomeColumns(); const esc = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const csv = [cols.join(','), ...getOutcomes().map(o => cols.map(c => esc(o[c])).join(','))].join('\r\n');
  download('orbis-outcomes.csv', csv, 'text/csv'); showToast('Outcomes exported as CSV', 'success');
}
function exportOutcomesJSON(){ download('orbis-outcomes.json', JSON.stringify(getOutcomes(), null, 2), 'application/json'); showToast('Outcomes exported as JSON', 'success'); }

document.addEventListener('DOMContentLoaded', init);

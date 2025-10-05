// app.js - Daily tracker + PWA + Push subscription integration
'use strict';

const PUSH_WORKER_URL = 'https://hardcore-push.justin-hardcore.workers.dev';
const VAPID_PUBLIC_KEY = 'BMrks-ZiaqTIOfJLEdBNmH9csHtcvnS_ky4Ly9bEsVkJX4QhjwKvzhGlHy4T2RwbVpW8xQ9FQCigCZelENoXrts';

const MAX_OZ = 64;

// --- UI references (assumes index.html matching layout from earlier) ---
const todayLabel = document.getElementById('todayLabel');
const waterLabel = document.getElementById('waterLabel');
const waterBar = document.getElementById('waterBar');
const chkPhoto = document.getElementById('chkPhoto');
const chkExercise = document.getElementById('chkExercise');
const chkNoJunk = document.getElementById('chkNoJunk');
const statusBadge = document.getElementById('statusBadge');

const prevDayBtn = document.getElementById('prevDay');
const nextDayBtn = document.getElementById('nextDay');

const waterButtons = document.querySelectorAll('.water-controls .btn[data-oz]');
const customOz = document.getElementById('customOz');
const addCustomOz = document.getElementById('addCustomOz');
const resetWater = document.getElementById('resetWater');

const tabButtons = document.querySelectorAll('.tabbar .tab');
const views = document.querySelectorAll('.view');

const prevMonth = document.getElementById('prevMonth');
const nextMonth = document.getElementById('nextMonth');
const monthLabel = document.getElementById('monthLabel');
const calGrid = document.getElementById('calGrid');

const quoteBox = document.getElementById('quoteBox');

// celebration
const celebrateEl = document.getElementById('celebrate');
const celebrateClose = document.getElementById('celebrateClose');
const confettiCanvas = document.getElementById('confetti');

let confettiCtx;

// Add "Enable Notifications" button automatically (since you asked for that)
(function addNotifButton(){
  const notifBtn = document.getElementById('notifBtn');
  if (notifBtn) return; // already exists
  const topActions = document.querySelector('.top-actions');
  const btn = document.createElement('button');
  btn.id = 'notifBtn';
  btn.className = 'btn small';
  btn.textContent = 'Enable Notifications';
  topActions && topActions.prepend(btn);
  btn.addEventListener('click', onEnableNotificationsClicked);
})();

// -------------------- date helpers --------------------
const toISODate = d => d.toISOString().slice(0,10);
const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d,n) => { const x = new Date(d); x.setDate(x.getDate()+n); return x; };
const todayISO = () => toISODate(new Date());

// -------------------- storage helpers --------------------
function loadDay(iso){ try { return JSON.parse(localStorage.getItem(`day:${iso}`)) || null } catch(e){ return null } }
function saveDay(iso, data){ localStorage.setItem(`day:${iso}`, JSON.stringify(data)); }
function getOrInitDay(iso, allowInit=true) {
  let data = loadDay(iso);
  if (!data && allowInit) {
    data = { photo:false, exercise:false, noJunk:false, water:0, locked:false, celebrated:false };
    saveDay(iso, data);
  }
  return data;
}
function isComplete(day){ return day && day.photo && day.exercise && day.noJunk && day.water >= MAX_OZ; }

// -------------------- push helpers --------------------
// helper to convert base64url to Uint8Array (for subscribe)
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4-base64String.length%4)%4);
  const base64 = (base64String + padding).replace(/-/g,'+').replace(/_/g,'/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i=0;i<raw.length;i++) out[i] = raw.charCodeAt(i);
  return out;
}

// register the SW and subscribe to push, then POST subscription to Worker
async function registerForPush() {
  try {
    if (!('serviceWorker' in navigator)) throw new Error('No service worker support');
    const reg = await navigator.serviceWorker.ready;
    // check existing subscription
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      });
    }
    // send subscription to your Worker
    await fetch(`${PUSH_WORKER_URL}/subscribe`, {
      method: 'POST',
      headers: {'content-type':'application/json'},
      body: JSON.stringify(sub)
    });
    const btn = document.getElementById('notifBtn');
    if (btn) { btn.textContent = 'Notifications On'; btn.disabled = true; }
    showLocalNotification('Notifications enabled', 'Hardcore Mode');
  } catch (e) {
    console.error('Push registration failed', e);
    alert('Push registration failed: ' + (e && e.message ? e.message : e));
  }
}

async function unregisterPush() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await fetch(`${PUSH_WORKER_URL}/unsubscribe`, {
        method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(sub)
      });
      await sub.unsubscribe();
    }
    const btn = document.getElementById('notifBtn');
    if (btn) { btn.textContent = 'Enable Notifications'; btn.disabled = false; }
  } catch (e) { console.error(e); }
}

async function reportCompletion(isCompleteFlag) {
  try {
    await fetch(`${PUSH_WORKER_URL}/status`, {
      method: 'POST',
      headers: {'content-type':'application/json'},
      body: JSON.stringify({ date: todayISO(), complete: !!isCompleteFlag })
    });
  } catch (e) { console.warn('status report failed', e); }
}

// simple foreground notification
function showLocalNotification(body, title='Daily Tracker') {
  if (Notification.permission === 'granted') {
    navigator.serviceWorker.ready.then(reg => {
      if (reg.showNotification) {
        reg.showNotification(title, { body, icon: 'icons/icon-192.png', vibrate: [60,40,60] });
      } else {
        try { new Notification(title, { body }); } catch(e) {}
      }
    });
  }
}

async function onEnableNotificationsClicked(){
  if (!('Notification' in window)) { alert('Notifications not supported'); return; }
  const p = await Notification.requestPermission();
  if (p !== 'granted') return alert('Please allow notifications in browser settings.');
  await registerForPush();
}

// -------------------- UI / app logic (daily view) --------------------
let currentDate = startOfDay(new Date());
let calendarCursor = startOfDay(new Date());

function updateWaterUI(oz) {
  const pct = Math.max(0, Math.min(100, (oz / MAX_OZ) * 100));
  waterBar.style.width = pct + '%';
  waterLabel.textContent = `${oz} / ${MAX_OZ} oz`;
}

function refreshDaily() {
  const iso = toISODate(currentDate);
  const d = getOrInitDay(iso);
  todayLabel.textContent = new Intl.DateTimeFormat(undefined,{weekday:'short',month:'short',day:'numeric',year:'numeric'}).format(currentDate);

  // lock past days
  d.locked = iso < todayISO();
  saveDay(iso, d);

  chkPhoto.checked = d.photo;
  chkExercise.checked = d.exercise;
  chkNoJunk.checked = d.noJunk;
  updateWaterUI(d.water);

  [chkPhoto, chkExercise, chkNoJunk].forEach(el => el.disabled = d.locked);
  waterButtons.forEach(b => b.disabled = d.locked);
  addCustomOz.disabled = d.locked;
  customOz.disabled = d.locked;
  resetWater.disabled = d.locked;

  if (isComplete(d)) {
    statusBadge.textContent = d.locked ? 'Completed' : 'Completed (today)';
    statusBadge.className = 'badge ok';
    // report completion to Worker — this will stop background pushes for today
    reportCompletion(true);
    if (!d.celebrated && !d.locked && iso === todayISO()) {
      d.celebrated = true; saveDay(iso, d);
      celebrate();
    }
  } else {
    if (d.locked) {
      statusBadge.textContent = 'Locked: Incomplete';
      statusBadge.className = 'badge bad';
      // report incomplete (so worker may still push)
      reportCompletion(false);
    } else {
      statusBadge.textContent = 'In progress';
      statusBadge.className = 'badge';
      reportCompletion(false);
    }
  }
  renderCalendar();
}

function updateField(field, value) {
  const iso = toISODate(currentDate);
  const d = getOrInitDay(iso);
  if (d.locked && iso < todayISO()) return;
  d[field] = value;
  saveDay(iso, d);
  refreshDaily();
}
function addWater(oz) {
  const iso = toISODate(currentDate);
  const d = getOrInitDay(iso);
  if (d.locked && iso < todayISO()) return;
  d.water = Math.max(0, Math.min(MAX_OZ, d.water + oz));
  saveDay(iso, d);
  refreshDaily();
}
function resetWaterNow() {
  const iso = toISODate(currentDate);
  const d = getOrInitDay(iso);
  if (d.locked && iso < todayISO()) return;
  d.water = 0; saveDay(iso, d); refreshDaily();
}

// element listeners
chkPhoto.addEventListener('change', e => updateField('photo', e.target.checked));
chkExercise.addEventListener('change', e => updateField('exercise', e.target.checked));
chkNoJunk.addEventListener('change', e => updateField('noJunk', e.target.checked));
waterButtons.forEach(btn => btn.addEventListener('click', () => addWater(Number(btn.dataset.oz))));
addCustomOz.addEventListener('click', () => { const val = Number(customOz.value || 0); if (!Number.isFinite(val) || val<=0) return; addWater(val); customOz.value=''; });
resetWater.addEventListener('click', resetWaterNow);

prevDayBtn.addEventListener('click', ()=>{ currentDate = addDays(currentDate, -1); refreshDaily(); });
nextDayBtn.addEventListener('click', ()=>{ currentDate = addDays(currentDate, +1); refreshDaily(); });

tabButtons.forEach(t => t.addEventListener('click', ()=>{
  tabButtons.forEach(x => x.classList.remove('active')); t.classList.add('active');
  const viewId = t.dataset.view;
  views.forEach(v => v.classList.remove('active'));
  document.getElementById(viewId).classList.add('active');
  if (viewId === 'view-calendar') renderCalendar();
}));

// calendar rendering
function renderCalendar(){
  const year = calendarCursor.getFullYear();
  const month = calendarCursor.getMonth();
  const first = new Date(year, month, 1);
  const last = new Date(year, month+1, 0);
  const startOffset = first.getDay();

  monthLabel.textContent = new Intl.DateTimeFormat(undefined,{month:'long', year:'numeric'}).format(calendarCursor);

  calGrid.innerHTML = '';
  for (let i=0;i<startOffset;i++){ const cell = document.createElement('div'); cell.className='cal-cell disabled'; calGrid.appendChild(cell); }
  for (let d=1; d<=last.getDate(); d++){
    const cell = document.createElement('div'); cell.className='cal-cell white';
    const iso = toISODate(new Date(year, month, d));
    const data = getOrInitDay(iso, false);
    const num = document.createElement('div'); num.className='num'; num.textContent = String(d);
    cell.appendChild(num);
    if (iso < todayISO()) {
      if (data && isComplete(data)) cell.classList.replace('white','green');
      else cell.classList.replace('white','red');
    } else if (iso === todayISO()) {
      if (data && isComplete(data)) cell.classList.replace('white','green');
    }
    cell.addEventListener('click', ()=> { currentDate = startOfDay(new Date(year, month, d)); document.querySelector('.tabbar .tab.active')?.classList.remove('active'); document.querySelector('.tabbar .tab[data-view="view-daily"]').classList.add('active'); views.forEach(v=>v.classList.remove('active')); document.getElementById('view-daily').classList.add('active'); refreshDaily(); });
    calGrid.appendChild(cell);
  }
  const weeks = Math.ceil((startOffset+last.getDate())/7);
  const remaining = weeks*7 - calGrid.children.length;
  for (let i=0;i<remaining;i++){ const cell = document.createElement('div'); cell.className='cal-cell disabled'; calGrid.appendChild(cell); }
}

// celebration (simple confetti)
let confettiTimer = null;
function celebrate(){
  celebrateEl.classList.remove('hidden');
  if (navigator.vibrate) try { navigator.vibrate([80,60,80]); } catch(e){}
  const canvas = confettiCanvas; confettiCtx = canvas.getContext('2d');
  canvas.width = window.innerWidth; canvas.height = window.innerHeight;
  let pieces = Array.from({length:120}, ()=>({x:Math.random()*canvas.width,y:-Math.random()*canvas.height,s:2+Math.random()*4,vx:-2+Math.random()*4,vy:2+Math.random()*6,a:Math.random()}));
  function draw(){
    confettiCtx.clearRect(0,0,canvas.width,canvas.height);
    pieces.forEach(p=>{ p.x+=p.vx; p.y+=p.vy; p.a+=0.05; if (p.y>canvas.height) p.y=-10; confettiCtx.fillStyle = (Math.sin(p.a)>0) ? '#ef4444' : '#ffffff'; confettiCtx.fillRect(p.x,p.y,p.s,p.s*2); });
    confettiTimer = requestAnimationFrame(draw);
  }
  draw();
}
celebrateClose?.addEventListener('click', ()=>{ celebrateEl.classList.add('hidden'); if (confettiTimer) cancelAnimationFrame(confettiTimer); });

// init
(function init(){
  refreshDaily();
  calendarCursor = startOfDay(new Date());
  renderCalendar();

  // register service worker if not already
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch(()=>{});
  }

  // if permission already granted, attempt registration
  if (Notification && Notification.permission === 'granted') {
    registerForPush().catch(()=>{});
  }
})();

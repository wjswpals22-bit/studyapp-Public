'use strict';
/* =========================================================
   공부어플 — 홈 / 플래너 / 스터디룸 / 상점 / 커뮤니티
   모든 데이터는 기기 안(localStorage)에 저장됨
   ========================================================= */

// ---------- 저장소 ----------
const KEY = 'studyapp.v1';
const PALETTE = [
  ['#F4A99A', '#FDEDEA'], ['#9DB9EE', '#EBF1FC'], ['#93CFA8', '#E8F5EC'], ['#F2C878', '#FCF3E1'],
  ['#B9A6E8', '#F1EDFB'], ['#8ECFD0', '#E6F5F5'], ['#F0A8C8', '#FCEBF3'], ['#B5BEC9', '#EEF1F4']
];
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function defaults() {
  const subs = [['국어', 0, 120], ['수학', 1, 180], ['영어', 2, 90], ['한국사', 3, 60]]
    .map(([name, p, goal]) => ({ id: uid() + p, name, c: PALETTE[p][0], l: PALETTE[p][1], goal }));
  return { subjects: subs, sessions: [], running: null, lastSid: null, plans: {}, vows: {}, vowHome: true, ddays: [], ddSel: null };
}
let D;
try { D = JSON.parse(localStorage.getItem(KEY)) || defaults(); } catch (e) { D = defaults(); }
function save() { try { localStorage.setItem(KEY, JSON.stringify(D)); } catch (e) { } }
save();

// ---------- 날짜/시간 도우미 ----------
const WD = ['일', '월', '화', '수', '목', '금', '토'];
const pad = n => String(n).padStart(2, '0');
const dkey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const kdate = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const todayKey = () => dkey(new Date());
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function hms(sec) { sec = Math.max(0, Math.floor(sec)); return `${Math.floor(sec / 3600)}:${pad(Math.floor(sec % 3600 / 60))}:${pad(sec % 60)}`; }
function hm(sec) { sec = Math.max(0, Math.floor(sec)); return `${Math.floor(sec / 3600)}:${pad(Math.floor(sec % 3600 / 60))}`; }
function kdur(min) { // 1시간 30분
  min = Math.max(0, Math.round(min)); const h = Math.floor(min / 60), m = min % 60;
  if (!h) return `${m}분`; if (!m) return `${h}시간`; return `${h}시간 ${m}분`;
}
const toMin = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const fromMin = m => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
function ddayText(dateKey, baseKey) {
  const diff = Math.round((kdate(dateKey) - kdate(baseKey)) / 864e5);
  return diff > 0 ? `D-${diff}` : diff === 0 ? 'D-DAY' : `D+${-diff}`;
}
function selDday() { return D.ddays.find(x => x.id === D.ddSel) || null; }

// ---------- 데이터 정리 (이전 버전 기록 옮기기) ----------
// plans[날짜] = [{ sid, todos: [{ id, t, done, kind: 'time'|'check', st, en }] }]
(function migrate() {
  for (const k in D.plans) {
    for (const p of D.plans[k]) {
      for (const t of p.todos) { if (!t.id) t.id = uid(); if (!t.kind) t.kind = 'check'; }
      delete p.st; delete p.en;
    }
    D.plans[k] = D.plans[k].filter(p => p.todos.length);
  }
  save();
})();

// ---------- 공부 기록 계산 ----------
const sub = id => D.subjects.find(s => s.id === id);
function allSessions() { const a = D.sessions.slice(); if (D.running) a.push({ sid: D.running.sid, tid: D.running.tid, s: D.running.start, e: Date.now() }); return a; }
function studiedSec(dayKey, sid) { // 해당 날짜(0~24시)에 겹치는 공부시간(초)
  const a = kdate(dayKey).getTime(), b = a + 864e5; let t = 0;
  for (const r of allSessions()) { if (sid && r.sid !== sid) continue; const x = Math.max(r.s, a), y = Math.min(r.e, b); if (y > x) t += y - x; }
  return t / 1000;
}
function todoSec(tid) { let t = 0; for (const r of allSessions()) if (r.tid === tid) t += r.e - r.s; return t / 1000; }
const durMin = t => t.kind === 'time' && t.st && t.en ? Math.max(0, toMin(t.en) - toMin(t.st)) : 0;
function dayTodos(k) { // [{p, s, t}] 시간 순(시간 할 일 먼저), 체크 할 일은 뒤
  const out = [];
  for (const p of D.plans[k] || []) { const s = sub(p.sid); if (!s) continue; for (const t of p.todos) out.push({ p, s, t }); }
  return out.sort((a, b) => (a.t.kind === 'time' ? toMin(a.t.st) : 2000) - (b.t.kind === 'time' ? toMin(b.t.st) : 2000));
}
function findTodo(tid) { for (const k in D.plans) for (const p of D.plans[k]) for (const t of p.todos) if (t.id === tid) return { k, p, t, s: sub(p.sid) }; return null; }
function goalMin(k) { return dayTodos(k).reduce((a, x) => a + durMin(x.t), 0); }
function planRange(p) { const T = p.todos.filter(t => t.kind === 'time'); if (!T.length) return ''; return `${fromMin(Math.min(...T.map(t => toMin(t.st))))}~${fromMin(Math.max(...T.map(t => toMin(t.en))))}`; }
function streak() {
  let d = new Date(); if (studiedSec(dkey(d)) < 60) d = addDays(d, -1);
  let n = 0; while (studiedSec(dkey(d)) >= 60 && n < 3650) { n++; d = addDays(d, -1); }
  return n;
}
function weekSec() { const t = new Date(); const mon = addDays(t, -((t.getDay() + 6) % 7)); let s = 0; for (let i = 0; i < 7; i++) s += studiedSec(dkey(addDays(mon, i))); return s; }

// ---------- 타이머 ----------
function startTimer(sid, tid) {
  tid = tid || null;
  if (D.running && D.running.sid === sid && D.running.tid === tid) return;
  if (D.running) stopTimer(true);
  D.running = { sid, tid, start: Date.now() }; D.lastSid = sid; D.lastTid = tid; save(); native('keepScreenOn', true);
}
function stopTimer(silent) {
  if (!D.running) return;
  const r = D.running, e = Date.now();
  if (e - r.start >= 5000) D.sessions.push({ sid: r.sid, tid: r.tid, s: r.start, e });
  D.running = null; save(); native('keepScreenOn', false);
  if (!silent) { const f = r.tid && findTodo(r.tid); toast(`${f ? f.t.t : (sub(r.sid) || {}).name || ''} ${kdur((e - r.start) / 60000)} 기록했어요`); }
}
function checkAutoDone() { // 시간 할 일은 목표 시간을 채우면 자동으로 완료
  if (!D.running || !D.running.tid) return false;
  const f = findTodo(D.running.tid); if (!f || f.t.done) return false;
  const need = durMin(f.t) * 60; if (need && todoSec(f.t.id) >= need) { f.t.done = true; save(); toast(`"${f.t.t}" 목표 시간 달성!`); return true; }
  return false;
}

// ---------- 안드로이드 연결 ----------
function native(fn, ...a) { try { if (window.Android && window.Android[fn]) window.Android[fn](...a); } catch (e) { } }

// ---------- 아이콘 ----------
const PLAY = '<svg class="play" viewBox="0 0 9 10"><path d="M0 0.8v8.4a.6.6 0 0 0 .9.5l7.4-4.2a.6.6 0 0 0 0-1L.9.3A.6.6 0 0 0 0 .8z" fill="currentColor"/></svg>';
const PAUSE = '<svg viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1.2" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1.2" fill="currentColor"/></svg>';
const PLUS = '<svg viewBox="0 0 24 24" style="width:14px;height:14px"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>';
const AV = '<svg viewBox="0 0 32 32"><circle cx="16" cy="13" r="5.5" fill="#fff"/><path d="M5.5 30c1.5-6 5.5-9 10.5-9s9 3 10.5 9z" fill="#fff"/></svg>';
const XI = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const PEN = '<svg class="ed" viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>';
const CK = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const TABS = [
  ['home', '홈', '<path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z"/>'],
  ['planner', '플래너', '<rect x="4" y="5.5" width="16" height="14.5" rx="2.5"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>'],
  ['room', '스터디룸', '<path d="M6 20h12M9 20l2-8M11 12l-3-4M8 8l4-4 4 4z"/><path d="M12 8v2.5"/>'],
  ['shop', '상점', '<path d="M5.5 8.5h13l-1 11.5h-11z"/><path d="M9 10V7a3 3 0 0 1 6 0v3"/>'],
  ['community', '커뮤니티', '<circle cx="9.5" cy="9" r="3.2"/><path d="M3.5 19.5c.6-3.3 3-5 6-5s5.4 1.7 6 5"/><path d="M15.5 6a3 3 0 0 1 0 6M17.5 14.8c1.7.6 2.8 2.1 3.1 4.2"/>']
];
function ringSvg(size, r, sw, pct, color, track) {
  const C = 2 * Math.PI * r, p = Math.max(0, Math.min(1, pct));
  return `<svg viewBox="0 0 ${size} ${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${track}" stroke-width="${sw}"/>` +
    (p > 0 ? `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-dasharray="${C * p} ${C}"/>` : '') + '</svg>';
}

// ---------- 스터디룸 테마 (상점에서 적용) ----------
const THEMES = [
  { k: 'lofi', n: '로파이 밤 공부방', d: '비 오는 밤, 헤드폰 낀 고양이', bg: '#16152A', light: false },
  { k: 'cherry', n: '벚꽃 봄 공부방', d: '벚꽃 날리는 봄날의 토끼', bg: '#F3E4E2', light: true },
  { k: 'forest', n: '숲속 오두막', d: '반딧불이 숲과 안경 쓴 곰', bg: '#3E2C22', light: false },
  { k: 'sea', n: '바닷가 공부방', d: '햇살 좋은 바다와 수달', bg: '#E4EFF1', light: true },
  { k: 'snow', n: '눈 오는 밤', d: '눈 덮인 마을과 펭귄', bg: '#1B2438', light: false },
  { k: 'train', n: '공부 기차여행', d: '반짝이는 바다 옆을 달리는 공부열차', bg: '#F4EFE7', light: true, isNew: 1 },
  { k: 'orb', n: '집중 오브', d: '공부할수록 커지는 빛, 군더더기 없는 집중', bg: '#EEE8DE', light: true, isNew: 1 }
];
const curTheme = () => THEMES.find(t => t.k === D.roomTheme) || THEMES[0];

// ---------- 라우팅 ----------
const R = { tab: 'home', day: null, calY: new Date().getFullYear(), calM: new Date().getMonth() };
const $ = s => document.querySelector(s);
const screen = $('#screen');
function go(tab) { R.tab = tab; R.day = null; render(); }
function openDay(k) { R.tab = 'planner'; R.day = k; const d = kdate(k); R.calY = d.getFullYear(); R.calM = d.getMonth(); render(); }
function render() {
  $('#tab').innerHTML = TABS.map(([k, n, p]) => `<div class="tb tap${R.tab === k ? ' on' : ''}" data-tab="${k}"><svg viewBox="0 0 24 24">${p}</svg>${n}</div>`).join('');
  const dark = R.tab === 'room', th = curTheme();
  native('setStatusBar', dark ? th.bg : '#F2F4F6', dark ? th.light : true);
  document.querySelector('meta[name=theme-color]').content = dark ? th.bg : '#F2F4F6';
  $('#app').classList.toggle('dk', dark);
  $('#app').className = $('#app').className.replace(/\brt-\w+/g, '').trim() + ' rt-' + th.k;
  if (R.tab === 'home') renderHome();
  else if (R.tab === 'planner') R.day ? renderDay() : renderCal();
  else if (R.tab === 'room') renderRoom();
  else renderSoon();
}
$('#tab').addEventListener('click', e => { const t = e.target.closest('[data-tab]'); if (t) go(t.dataset.tab); });

// =========================================================
//  홈 — 오늘 플래너의 할 일이 그대로 뜸
// =========================================================
function ctaTarget(tk) { // 이어서 할 시간 할 일
  if (D.running && D.running.tid) { const f = findTodo(D.running.tid); if (f) return f; }
  const T = dayTodos(tk).filter(x => x.t.kind === 'time');
  const last = T.find(x => x.t.id === D.lastTid && !x.t.done);
  return last || T.find(x => !x.t.done) || null;
}
function renderHome() {
  const now = new Date(), tk = dkey(now);
  const total = studiedSec(tk), gm = goalMin(tk), pct = gm ? total / (gm * 60) : 0;
  const dd = selDday();
  const yd = studiedSec(dkey(addDays(now, -1))), diffMin = Math.round((total - yd) / 60);
  const vow = D.vows[tk];
  const L = dayTodos(tk), doneN = L.filter(x => x.t.done).length;
  const tg = ctaTarget(tk);
  const freeRun = D.running && !D.running.tid && sub(D.running.sid);
  const ctaHtml = `<div class="cta vowc tap" data-act="vow"><div class="ct"><span>오늘의 다짐</span>${vow && vow.text ? `${vow.emo ? esc(vow.emo) + ' ' : ''}${esc(vow.text)}` : '<em>오늘의 다짐을 적어보세요</em>'}</div><div class="pb2">${PEN}</div></div>`;
  const leftMin = gm - total / 60;
  screen.innerHTML = `<div class="scroll home"><div class="wrap">
    <div class="head"><div class="d">홈<span>${now.getMonth() + 1}월 ${now.getDate()}일 ${WD[now.getDay()]}요일</span></div><div class="av tap" data-act="profile">${AV}</div></div>
    <div class="hc hero">
      <div class="top"><span class="l"><i class="${D.running ? 'run' : ''}"></i>오늘 공부시간</span><span class="dd tap" data-act="dday">${dd ? esc(dd.name) + ' ' + ddayText(dd.date, tk) : 'D-day 설정'}</span></div>
      <div class="main">
        <div><div class="t num" id="heroT">${hms(total)}</div><div class="g">${!gm ? '오늘 계획한 공부시간이 아직 없어요' : leftMin > 0 ? `목표 ${kdur(gm)}까지 <b>${kdur(leftMin)}</b> 남았어요` : `오늘 목표 <b>${kdur(gm)}</b> 달성!`}</div></div>
        <div class="ring">${ringSvg(76, 31, 7, pct, '#A9C1F5', 'rgba(255,255,255,.1)')}<div class="rc num">${Math.min(100, Math.round(pct * 100))}<small>%</small></div></div>
      </div>
      ${ctaHtml}
      <div class="foot"><div>연속 공부<b>${streak()}일째</b></div><div>이번 주<b class="num">${kdur(weekSec() / 60)}</b></div><div>어제보다<b>${diffMin >= 0 ? '+' : '-'}${kdur(Math.abs(diffMin))}${diffMin > 0 ? '<em>▲</em>' : diffMin < 0 ? '<em class="dn">▼</em>' : ''}</b></div></div>
    </div>
    <div class="hc banner tap" data-act="room"><span class="live">${curTheme().n}</span><span class="go">스터디룸 이동하기<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></span></div>
    <div class="sec"><b>오늘의 할 일<small class="num">${L.length ? `${doneN}/${L.length}` : ''}</small></b><span class="tap" data-act="today">플래너</span></div>
    <div class="hc slist${L.length ? '' : ' blank tap'}"${L.length ? '' : ' data-act="today"'}>${L.length ? '' : '<div class="bmsg">할 일을 추가해보세요<span>누르면 플래너로 이동해요</span></div>'}${L.map(({ s, t }) => {
      if (t.kind === 'time') {
        const need = durMin(t) * 60, got = todoSec(t.id), on = D.running && D.running.tid === t.id;
        return `<div class="srw${on ? ' on' : ''}${t.done ? ' done' : ''}"><div class="mid"><div class="tp"><span class="nm"><i class="dot" style="background:${s.c}"></i>${esc(s.name)}</span><span class="tm num"><b data-tt="${t.id}">${kdur(got / 60)}</b> / ${kdur(need / 60)}</span></div><div class="td">${esc(t.t)}</div>
          <div class="bar"><i data-tb="${t.id}" style="width:${need ? Math.min(100, got / need * 100) : 0}%;background:${s.c}"></i></div></div><div class="pl tap" data-play="${t.id}">${on ? PAUSE : PLAY}</div></div>`;
      }
      return `<div class="srw chk${t.done ? ' done' : ''}"><div class="mid"><div class="tp"><span class="nm"><i class="dot" style="background:${s.c}"></i>${esc(s.name)}</span></div><div class="td">${esc(t.t)}</div></div><div class="cb tap" data-hck="${t.id}">${t.done ? CK : ''}</div></div>`;
    }).join('')}</div>
  </div></div>`;
}
function tickHome() {
  const tk = todayKey(); const t = $('#heroT'); if (!t) return;
  t.textContent = hms(studiedSec(tk));
  if (!D.running) return;
  const cs = $('#ctaSub'); if (cs) cs.textContent = '이번 세션 ' + hms((Date.now() - D.running.start) / 1000);
  if (D.running.tid) {
    const f = findTodo(D.running.tid);
    const el = document.querySelector(`[data-tt="${D.running.tid}"]`); if (el) el.textContent = kdur(todoSec(D.running.tid) / 60);
    const b = document.querySelector(`[data-tb="${D.running.tid}"]`); if (b && f) b.style.width = Math.min(100, todoSec(f.t.id) / (durMin(f.t) * 60 || 1) * 100) + '%';
  }
  if (Math.floor(Date.now() / 1000) % 30 === 0) renderHome();
}

// =========================================================
//  플래너 — 달력
// =========================================================
function dayItems(k) { return dayTodos(k).map(({ s, t }) => ({ text: t.t, l: s.l, c: s.c, done: t.done })); }
function renderCal() {
  const y = R.calY, m = R.calM, first = new Date(y, m, 1), days = new Date(y, m + 1, 0).getDate(), tk = todayKey();
  const lead = first.getDay(), rows = Math.ceil((lead + days) / 7);
  let h = ''; for (let i = 0; i < lead; i++) h += '<div class="cd"></div>';
  for (let d = 1; d <= days; d++) {
    const k = dkey(new Date(y, m, d)), w = (lead + d - 1) % 7, L = dayItems(k);
    const cls = ['cd', 'tap', w === 0 ? 'sun' : '', w === 6 ? 'sat' : '', k > tk ? 'fut' : '', k === tk ? 'today' : ''].join(' ');
    h += `<div class="${cls}" data-day="${k}"><b class="num">${d}</b>${L.slice(0, 4).map(t => `<span class="ctg${t.done ? ' ok' : ''}${k < tk ? ' past' : ''}"><i style="background:${t.c}"></i>${esc(t.text)}</span>`).join('')}${L.length > 4 ? `<div class="more">+${L.length - 4}</div>` : ''}</div>`;
  }
  screen.innerHTML = `<div class="scroll cal" style="overflow:hidden"><div class="wrap">
    <div class="head"><span class="tt">플래너</span><div class="av tap" data-act="profile">${AV}</div></div>
    <div class="card plc">
      <div class="band"><div class="mon">${TM[curTheme().k] && TM[curTheme().k].sign ? `<div class="sign"><b>${y}년 ${m + 1}월</b></div>` : `<div>${TM[curTheme().k] && TM[curTheme().k].kick ? `<small>${TM[curTheme().k].kick.replace('OCT', ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][m])}</small>` : ''}<b>${y}년 ${m + 1}월</b></div>`}<div class="ar"><i class="tap" data-mon="-1"><svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg></i><i class="tap" data-mon="1"><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></i></div></div></div>
      <div class="pbody"><div class="wk">${WD.map(w => `<span>${w}</span>`).join('')}</div>
      <div class="cgrid" style="grid-template-rows:repeat(${rows},1fr)">${h}</div></div>
    </div></div></div>`;
  const th = plVars(screen.querySelector('.cal'));
  plDeco(screen.querySelector('.band'), th.band); plDeco(screen.querySelector('.pbody'), th.body);
}


// =========================================================
//  플래너 테마 그림 (스터디룸 테마를 따라감) — 디자인: 플래너/테마5종/planner.html
// =========================================================
let W = 336;
function rnd(s){let x=s;return()=>(x=(x*9301+49297)%233280)/233280}
const svg=(w,h,inner,cls='')=>`<svg class="${cls}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${inner}</svg>`;
const enc=s=>`url("data:image/svg+xml,${encodeURIComponent(s)}")`;

// ---------- 그림 조각 ----------
const rain=(w,h,n,seed,op)=>{const r=rnd(seed);let s='';for(let i=0;i<n;i++){const x=r()*w,y=r()*h,l=6+r()*10;s+=`<path d="M${x.toFixed(1)} ${y.toFixed(1)}l-${(l*.18).toFixed(1)} ${l.toFixed(1)}"/>`}return `<g stroke="#AFC0E6" stroke-width=".7" stroke-linecap="round" opacity="${op}">${s}</g>`};
const petal=(x,y,r,a,c,o)=>`<ellipse cx="${x}" cy="${y}" rx="${r}" ry="${r*.62}" fill="${c}" opacity="${o}" transform="rotate(${a} ${x} ${y})"/>`;
const petals=(w,h,n,seed,o)=>{const r=rnd(seed);let s='';for(let i=0;i<n;i++)s+=petal((r()*w).toFixed(1),(r()*h).toFixed(1),2.4+r()*2.2,(r()*180)|0,i%3?'#F6A9BC':'#FBC7D4',o);return s};
const flower=(x,y,r,c='#F7B3C4',cc='#E86F8E')=>{let s='';for(let k=0;k<5;k++){const a=k*72*Math.PI/180;s+=`<circle cx="${(x+Math.sin(a)*r*.62).toFixed(1)}" cy="${(y-Math.cos(a)*r*.62).toFixed(1)}" r="${r*.52}" fill="${c}"/>`}return s+`<circle cx="${x}" cy="${y}" r="${r*.28}" fill="${cc}"/>`};
function bunting(w,y0,sag,cols){let s=`<path d="M-4 ${y0} Q${w/2} ${y0+sag*2} ${w+4} ${y0}" fill="none" stroke="#D99AAA" stroke-width="1"/>`;const n=11;for(let i=1;i<n;i++){const t=i/n,x=-4+(w+8)*t,y=(1-t)*(1-t)*y0+2*(1-t)*t*(y0+sag*2)+t*t*y0;s+=`<path d="M${x-6} ${y-1}L${x+6} ${y-1}L${x} ${y+10}z" fill="${cols[i%cols.length]}"/>`}return s}
function lights(w,y0,sag,cols,n){let s=`<path d="M-4 ${y0} Q${w/2} ${y0+sag*2} ${w+4} ${y0}" fill="none" stroke="rgba(0,0,0,.45)" stroke-width="1"/>`;for(let i=1;i<n;i++){const t=i/n,x=-4+(w+8)*t,y=(1-t)*(1-t)*y0+2*(1-t)*t*(y0+sag*2)+t*t*y0,c=cols[i%cols.length];s+=`<circle cx="${x}" cy="${y+4}" r="8" fill="${c}" opacity=".22"/><rect x="${x-1.2}" y="${y-.5}" width="2.4" height="2.5" fill="#2a2018"/><circle cx="${x}" cy="${y+4}" r="2.5" fill="${c}"/>`}return s}
const planks=(w,h)=>{let s='';for(let y=0;y<h;y+=22)s+=`<rect x="0" y="${y}" width="${w}" height="22" fill="${(y/22)%2?'#6A4C34':'#634630'}"/><path d="M0 ${y+.5}H${w}" stroke="#4A3322" stroke-width="1"/>`;const r=rnd(5);for(let i=0;i<5;i++){const x=r()*w,y=r()*h;s+=`<ellipse cx="${x}" cy="${y}" rx="5" ry="2" fill="none" stroke="#523925" stroke-width=".8"/>`}for(let y=0;y<h;y+=22){const x=40+r()*(w-80);s+=`<path d="M${x} ${y}V${y+22}" stroke="#4A3322" stroke-width="1"/>`}return s};
const pine=(x,y,s,c)=>`<path d="M${x} ${y-s*2.4}L${x+s*.75} ${y-s*1.3}H${x+s*.35}L${x+s} ${y-s*.3}H${x-s}L${x-s*.35} ${y-s*1.3}H${x-s*.75}z" fill="${c}"/><rect x="${x-s*.12}" y="${y-s*.3}" width="${s*.24}" height="${s*.4}" fill="${c}"/>`;
const pines=(w,y,seed,c,o)=>{const r=rnd(seed);let s=`<g opacity="${o}">`;for(let x=6;x<w;x+=14+r()*16)s+=pine(x,y,7+r()*7,c);return s+'</g>'};
const flakes=(w,h,n,seed,o,c='#fff')=>{const r=rnd(seed);let s='';for(let i=0;i<n;i++)s+=`<circle cx="${(r()*w).toFixed(1)}" cy="${(r()*h).toFixed(1)}" r="${(.7+r()*1.5).toFixed(1)}" fill="${c}" opacity="${(o*(.4+r()*.6)).toFixed(2)}"/>`;return s};
const snowcap=(w,base)=>{let d=`M0 0H${w}V${base}`;const r=rnd(11);for(let x=w;x>0;x-=22){const dip=base+3+r()*9;d+=` Q${x-6} ${dip+6} ${x-11} ${dip} T${x-22} ${base}`}return `<path d="${d}V0z" fill="#F7FAFF"/><path d="${d.replace(/^M0 0H\d+V/,'M'+w+' ')}" fill="none" stroke="#D5E2F4" stroke-width="1" opacity=".8"/>`};
const waves=(w,y,c,amp,len,o=1)=>{let d=`M0 ${y}`;for(let x=0;x<w;x+=len)d+=` q${len/4} -${amp} ${len/2} 0 t${len/2} 0`;return `<path d="${d}V${y+400}H0z" fill="${c}" opacity="${o}"/>`};
const cloud=(x,y,s,o)=>`<g fill="#fff" opacity="${o}"><ellipse cx="${x}" cy="${y}" rx="${14*s}" ry="${6*s}"/><circle cx="${x-5*s}" cy="${y-4*s}" r="${6*s}"/><circle cx="${x+4*s}" cy="${y-6*s}" r="${7.5*s}"/></g>`;
const gull=(x,y,s)=>`<path d="M${x-5*s} ${y}q${2.5*s} -${3*s} ${5*s} 0q${2.5*s} -${3*s} ${5*s} 0" fill="none" stroke="#5B7D96" stroke-width="1.1" stroke-linecap="round"/>`;
const stars=(w,h,n,seed)=>{const r=rnd(seed);let s='';for(let i=0;i<n;i++)s+=`<circle cx="${(r()*w).toFixed(1)}" cy="${(r()*h).toFixed(1)}" r="${(.5+r()*.8).toFixed(1)}" fill="#FFF6D8" opacity="${(.3+r()*.6).toFixed(2)}"/>`;return s};
const vinyl=(cx,cy,R)=>{let g='';for(let k=R*.42;k<R*.95;k+=3)g+=`<circle cx="${cx}" cy="${cy}" r="${k}" fill="none" stroke="rgba(255,255,255,.06)" stroke-width=".6"/>`;return `<circle cx="${cx}" cy="${cy}" r="${R}" fill="#141320"/>${g}<circle cx="${cx}" cy="${cy}" r="${R*.34}" fill="#E9A766"/><circle cx="${cx}" cy="${cy}" r="2" fill="#141320"/>`};

// ---------- 테마 정의 ----------
let FLOWER=enc(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${flower(12,12,23,'#F08FA8','#F08FA8')}</svg>`);
const TM={
lofi:{grain:1,c:['#E59A8C','#8FA8E0','#86C29C','#E2B86A'],kick:'LO-FI NIGHT · OCT',
 v:{'--bbg':'linear-gradient(180deg,#2E2B42,#1F1E2D)','--hbg':'linear-gradient(172deg,#3A3653,#2A283E)','--tx':'#ECE5F4','--mu':'rgba(236,229,244,.48)','--ln':'rgba(255,255,255,.07)','--tg':'rgba(255,255,255,.07)','--tt':'rgba(236,229,244,.86)','--sun':'#E9A394','--sat':'#9EB3E6','--kick':'#F0B470','--mtx':'#F7E2C0','--abg':'rgba(255,255,255,.08)','--aic':'#E8DDF2','--tdbg':'#F0B470','--tdtx':'#1D1C2A','--tdsh':'0 0 0 3px rgba(240,180,112,.18),0 0 14px rgba(240,180,112,.55)','--acc':'#F0B470','--hmu':'rgba(236,229,244,.5)','--gbg':'rgba(255,255,255,.07)','--gtx':'#ECE5F4','--gmu':'rgba(236,229,244,.5)','--gnum':'#F7E2C0','--gsh':'inset 0 0 0 1px rgba(255,255,255,.06)','--ddbg':'#2A283E','--ddtx':'#F0C48E','--ckb':'rgba(236,229,244,.28)','--ckm':'#1F1E2D','--btx':'#1D1C2A','--bbtn':'#F0B470','--bsh':'0 6px 16px -6px rgba(240,180,112,.6)','--tln':'rgba(255,255,255,.09)','--tln2':'rgba(255,255,255,.04)','--sh':'0 14px 28px -16px rgba(20,18,34,.8)','--grain':'.16'},
 band:()=>`<rect width="${W}" height="88" fill="url(#lg)"/><defs><radialGradient id="lg" cx=".82" cy=".1" r=".6"><stop offset="0" stop-color="#F0B470" stop-opacity=".28"/><stop offset="1" stop-color="#F0B470" stop-opacity="0"/></radialGradient></defs>${rain(W,88,30,7,.25)}<circle cx="246" cy="26" r="9" fill="#F7E2C0" opacity=".9"/><circle cx="250" cy="23" r="8" fill="#38344F"/>`,
 body:(h)=>rain(W,h,80,9,.12)+`<rect x="0" y="${h-120}" width="${W}" height="120" fill="url(#lb)"/><defs><linearGradient id="lb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F0B470" stop-opacity="0"/><stop offset="1" stop-color="#F0B470" stop-opacity=".07"/></linearGradient></defs>`,
 hero:(h)=>`<defs><radialGradient id="hg" cx=".9" cy=".05" r=".7"><stop offset="0" stop-color="#F0B470" stop-opacity=".3"/><stop offset="1" stop-color="#F0B470" stop-opacity="0"/></radialGradient></defs><rect width="${W}" height="${h}" fill="url(#hg)"/>${rain(W,h,40,3,.22)}`,
 hpt:'14px'},
cherry:{c:['#EF8DA6','#8FB0E8','#86C7A0','#EDBB64'],kick:'SPRING · 벚꽃 봄',
 v:{'--bbg':'linear-gradient(180deg,#FFF7F8,#FFF0F3)','--hbg':'linear-gradient(180deg,#FFE3EA,#FDEFF2)','--tx':'#4E3640','--mu':'#B98D9A','--ln':'#F7DCE3','--tg':'#fff','--tt':'#5E4450','--tgsh':'0 0 0 1px #F6DDE4','--sun':'#E8728F','--sat':'#7C9BD8','--kick':'#E8728F','--mtx':'#4E3640','--abg':'#fff','--ash':'0 2px 6px -2px rgba(232,114,143,.35)','--aic':'#C26F86','--tdbg':FLOWER+' center/100% 100% no-repeat','--tdtx':'#fff','--acc':'#E8728F','--hmu':'#B98D9A','--gbg':'#fff','--gtx':'#4E3640','--gmu':'#B98D9A','--gnum':'#E05F80','--gsh':'0 4px 12px -6px rgba(232,114,143,.35)','--ddbg':'#FFE3EA','--ddtx':'#D35A7A','--ckb':'#EBC6D0','--ckbg':'#fff','--btx':'#fff','--bbtn':'#EC7A97','--bsh':'0 6px 14px -6px rgba(236,122,151,.7)','--tln':'#F5DAE1','--tln2':'#FBEDF1','--tgbg':'#fff','--sh':'0 12px 26px -18px rgba(214,110,140,.55)'},
 band:()=>{let br=`<path d="M${W+6} 4 C300 14 286 30 262 34 M300 15 C306 26 304 36 298 44 M282 27 C276 36 270 42 258 46" stroke="#8A5A4A" stroke-width="2.2" fill="none" stroke-linecap="round"/>`;[[300,10,9],[276,26,8],[260,36,7],[298,42,7],[312,26,7],[284,40,5]].forEach(([x,y,r])=>br+=flower(x,y,r));return bunting(W,2,9,['#F7B3C4','#FBE3A8','#BFE0C8','#C7D8F4','#F6C9D5'])+br+petals(W,88,10,21,.7)},
 body:(h)=>petals(W,h,26,13,.35)+`<path d="M0 ${h-14} Q${W/2} ${h-26} ${W} ${h-12} V${h}H0z" fill="#FBD9E2" opacity=".55"/>`,
 hero:(h)=>{let br='';[[318,22,10],[300,10,8],[330,40,8],[288,24,6]].forEach(([x,y,r])=>br+=flower(x,y,r));return bunting(W,2,8,['#F7B3C4','#FBE3A8','#BFE0C8','#C7D8F4','#F6C9D5'])+`<path d="M${W+4} 30 C320 26 306 18 296 12" stroke="#8A5A4A" stroke-width="2" fill="none"/>`+br+petals(W,h,14,4,.6)},
 hpt:'32px'},
forest:{c:['#D07D5F','#6F93BE','#7FA86B','#D9A64E'],kick:'',sign:1,
 v:{'--bbg':'linear-gradient(180deg,#FBF4E6,#F5EBD6)','--hbg':'#634630','--tx':'#4A3624','--mu':'#A48B6E','--ln':'#EADBBE','--tg':'#F1E3C6','--tt':'#56402B','--sun':'#C46A4E','--sat':'#5F82AE','--kick':'#F2D08A','--mtx':'#4A3624','--abg':'#7B5A3E','--ash':'inset 0 -2px 0 #4A3322','--aic':'#F6E6C8','--tdbg':'radial-gradient(circle,#FFD983 0,#EFAF45 70%)','--tdtx':'#4A3020','--tdsh':'0 0 0 3px rgba(239,175,69,.22),0 0 12px rgba(239,175,69,.6)','--acc':'#F2C15E','--hmu':'rgba(246,230,200,.6)','--wtx':'#F6E6C8','--gbg':'#F7EBD3','--gtx':'#4A3624','--gmu':'#A48B6E','--gnum':'#7A4E26','--gsh':'0 3px 0 #3E2A1B, inset 0 0 0 1px #E3CFA8','--ddbg':'#634630','--ddtx':'#F6DFA8','--ckb':'#D8C39C','--ckbg':'#FFFBF2','--btx':'#F8EBD0','--bbtn':'#6A4B32','--bsh':'inset 0 -3px 0 #4A3322','--tln':'#E6D5B4','--tln2':'#F1E6CF','--tgbg':'#FFFBF2','--sh':'0 12px 26px -16px rgba(74,51,34,.6)'},
 band:()=>planks(W,88)+lights(W,6,9,['#FFD27A','#FFB46A','#FFE7A6'],13),
 body:(h)=>pines(W,h+4,8,'#6E8A5A',.1),
 hero:(h)=>planks(W,h)+lights(W,4,8,['#FFD27A','#FFB46A','#FFE7A6'],13)+`<g transform="translate(300 ${h-64})"><path d="M8 -12V0" stroke="#2a2018" stroke-width="1.2"/><rect x="0" y="0" width="16" height="4" rx="1" fill="#3A2A1E"/><rect x="1.5" y="4" width="13" height="18" rx="2" fill="#FFCB6B" opacity=".9"/><circle cx="8" cy="13" r="16" fill="#FFCB6B" opacity=".18"/><path d="M1.5 4h13v18h-13zM8 4v18" fill="none" stroke="#3A2A1E" stroke-width="1.4"/><rect x="0" y="22" width="16" height="3" rx="1" fill="#3A2A1E"/></g>`,
 hpt:'34px'},
sea:{c:['#F0957E','#4F98D6','#4FB9A2','#EDB94F'],kick:'SEASIDE · 바닷가',
 v:{'--bbg':'linear-gradient(180deg,#FBFEFF,#EEF8FC)','--hbg':'linear-gradient(180deg,#A9DBF3,#DDF2FA)','--tx':'#1F3D55','--mu':'#86A4B8','--ln':'#E0EFF6','--tg':'#E6F4FA','--tt':'#2B4D66','--sun':'#E87D66','--sat':'#2F86C4','--kick':'#2F86C4','--mtx':'#163A57','--abg':'rgba(255,255,255,.75)','--aic':'#2F6E9C','--tdbg':'linear-gradient(180deg,#fff 0 48%,#8FD0EF 48%)','--tdtx':'#163A57','--tdsh':'0 0 0 2px #2F86C4','--acc':'#2F86C4','--hmu':'#4C7A98','--gbg':'#fff','--gtx':'#1F3D55','--gmu':'#86A4B8','--gnum':'#1F6FAE','--gsh':'0 6px 14px -8px rgba(31,111,174,.45)','--ddbg':'#DDF2FA','--ddtx':'#1F6FAE','--ckb':'#C6DDE9','--ckbg':'#fff','--btx':'#fff','--bbtn':'#2F86C4','--bsh':'0 6px 14px -6px rgba(47,134,196,.6)','--tln':'#DDECF3','--tln2':'#EEF6FA','--tgbg':'#fff','--sh':'0 12px 26px -18px rgba(31,111,174,.5)'},
 band:()=>`<circle cx="292" cy="20" r="26" fill="#FFF3C4" opacity=".55"/><circle cx="292" cy="20" r="13" fill="#FFE59A"/>`+cloud(70,22,1.1,.9)+cloud(190,14,.8,.8)+gull(140,30,1)+gull(156,24,.8)+gull(236,38,.7)+waves(W,74,'#7CC4EA',4,48,.9)+waves(W,80,'#4FA6DA',4,40,.9),
 body:(h)=>waves(W,h-22,'#D5EEF8',5,64,.9)+waves(W,h-12,'#BFE4F4',5,52,.9),
 hero:(h)=>`<circle cx="312" cy="12" r="16" fill="#FFF3C4" opacity=".55"/><circle cx="312" cy="12" r="8" fill="#FFE59A"/>`+cloud(40,12,.7,.85)+cloud(200,10,.55,.75)+gull(130,12,.8)+gull(142,8,.6)+waves(W,h-30,'#7CC4EA',4,48,.85)+waves(W,h-22,'#4FA6DA',4,40,.85),
 hpt:'28px'},
snow:{grain:1,c:['#F08A8A','#8DB4F0','#8FD0B4','#EFCB76'],kick:'SNOWY NIGHT · 눈 오는 밤',
 v:{'--bbg':'linear-gradient(180deg,#27304D,#1B2238)','--hbg':'linear-gradient(180deg,#323C5E,#27304D)','--tx':'#E8EEF8','--mu':'rgba(232,238,248,.48)','--ln':'rgba(255,255,255,.07)','--tg':'rgba(255,255,255,.08)','--tt':'rgba(232,238,248,.88)','--sun':'#F29A9A','--sat':'#A9C6F2','--kick':'#A9C8F0','--mtx':'#FFFFFF','--abg':'rgba(255,255,255,.1)','--aic':'#E8EEF8','--tdbg':'#fff','--tdtx':'#1B2238','--tdsh':'0 0 0 3px rgba(169,200,240,.25),0 0 14px rgba(255,255,255,.45)','--acc':'#E85D5D','--hmu':'rgba(232,238,248,.55)','--gbg':'#F7FAFF','--gtx':'#1F2A44','--gmu':'#8A97AE','--gnum':'#1F2A44','--gsh':'0 6px 14px -8px rgba(0,0,0,.5)','--ddbg':'#27304D','--ddtx':'#fff','--ckb':'rgba(232,238,248,.3)','--ckm':'#1B2238','--btx':'#1F2A44','--bbtn':'#F7FAFF','--bsh':'0 0 0 1px #D5E2F4,0 6px 14px -6px rgba(255,255,255,.3)','--tln':'rgba(255,255,255,.09)','--tln2':'rgba(255,255,255,.04)','--sh':'0 14px 28px -16px rgba(16,20,36,.8)','--grain':'.1'},
 band:()=>stars(W,88,18,2)+flakes(W,88,26,6,.8)+snowcap(W,12),
 body:(h)=>flakes(W,h,34,17,.3)+`<path d="M0 ${h-26} Q90 ${h-46} 190 ${h-30} T${W} ${h-34}V${h}H0z" fill="#EAF1FB" opacity=".12"/>`+pines(W,h-14,3,'#EAF1FB',.08),
 hero:(h)=>stars(W,h,10,8)+flakes(W,h,12,12,.45)+snowcap(W,12),
 hpt:'32px'}
};


TM.train = {kick: 'STUDY EXPRESS · 바다 노선', c: [],
 v: {'--bbg':'linear-gradient(180deg,#FFFDF9,#F7F2EA)','--hbg':'#EAF2F6','--tx':'#2A3B4A','--mu':'#93A0AC','--ln':'#EEE8DE','--tg':'#EEF4F8','--tt':'#2F4A5E','--sun':'#D97E6A','--sat':'#3E7FA8','--kick':'#3E7FA8','--mtx':'#2A3B4A','--abg':'rgba(255,255,255,.82)','--ash':'0 2px 6px -2px rgba(42,59,74,.25)','--aic':'#2A3B4A','--tdbg':'#3E7FA8','--tdtx':'#fff','--tdsh':'0 0 0 3px rgba(91,155,196,.25)','--acc':'#3E7FA8','--hmu':'#5E6E7C','--wtx':'#2A3B4A','--gbg':'rgba(255,255,255,.9)','--gtx':'#2A3B4A','--gmu':'#93A0AC','--gnum':'#3E7FA8','--gsh':'0 6px 14px -8px rgba(42,59,74,.3)','--ddbg':'#E3EEF5','--ddtx':'#2F6E96','--ckb':'#CBD3DB','--ckbg':'#fff','--btx':'#fff','--bbtn':'#3E7FA8','--bsh':'0 6px 14px -6px rgba(62,127,168,.55)','--tln':'#ECE6DC','--tln2':'#F5F1EA','--tgbg':'#fff','--sh':'0 12px 26px -18px rgba(42,59,74,.35)'},
 band: (h) => { h = h || 88; return `<defs><linearGradient id="trb" x1="0" y1="0" x2="0" y2="1"><stop offset=".3" stop-color="#FFFDF9" stop-opacity="0"/><stop offset="1" stop-color="#FFFDF9" stop-opacity=".92"/></linearGradient></defs><image href="img/train_wide.jpg" x="0" y="0" width="${W}" height="${h}" preserveAspectRatio="xMidYMid slice"/><rect width="${W}" height="${h}" fill="url(#trb)"/>`; },
 body: (h) => { let s = '<g fill="none" stroke="#5B9BC4" stroke-width="1.2" opacity=".14">'; for (let k = 0; k < 3; k++) { let d = `M0 ${h - 34 + k * 9}`; for (let x = 0; x < W; x += 40) d += ` q10 -5 20 0 t20 0`; s += `<path d="${d}"/>`; } return s + '</g>'; },
 hero: (h) => `<defs><linearGradient id="trh" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFDF9" stop-opacity=".45"/><stop offset=".6" stop-color="#FFFDF9" stop-opacity=".7"/><stop offset="1" stop-color="#FFFDF9" stop-opacity=".85"/></linearGradient></defs><image href="img/train_wide.jpg" x="0" y="0" width="${W}" height="${h}" preserveAspectRatio="xMidYMid slice"/><rect width="${W}" height="${h}" fill="url(#trh)"/>`,
 hpt: '14px'};
TM.orb = {grain: 1, kick: 'DEEP FOCUS', c: [],
 v: {'--bbg':'#F4EFE7','--hbg':'#EEE8DE','--tx':'#1B1A19','--mu':'#8C8378','--ln':'rgba(27,26,25,.07)','--tg':'rgba(27,26,25,.05)','--tt':'#3E3A35','--sun':'#E07A5F','--sat':'#7C6FB8','--kick':'#8C8378','--mtx':'#1B1A19','--abg':'rgba(27,26,25,.06)','--aic':'#1B1A19','--tdbg':'radial-gradient(circle at 40% 38%,#FFE6B8,#F7B37A 45%,#EE8B78)','--tdtx':'#1B1A19','--tdsh':'0 0 12px rgba(238,139,120,.65)','--acc':'#E98A6E','--hmu':'#8C8378','--gbg':'rgba(255,255,255,.72)','--gtx':'#1B1A19','--gmu':'#8C8378','--gnum':'#1B1A19','--gsh':'inset 0 0 0 1px rgba(27,26,25,.06)','--ddbg':'#1B1A19','--ddtx':'#fff','--ckb':'rgba(27,26,25,.25)','--btx':'#fff','--bbtn':'#1B1A19','--bsh':'0 6px 14px -6px rgba(27,26,25,.45)','--tln':'rgba(27,26,25,.09)','--tln2':'rgba(27,26,25,.04)','--sh':'0 12px 26px -18px rgba(27,26,25,.35)','--grain':'.12'},
 band: (h) => { h = h || 88; return `<defs><radialGradient id="obA" cx=".42" cy=".4" r=".5"><stop offset="0" stop-color="#FFE6B8"/><stop offset=".45" stop-color="#F7B37A"/><stop offset=".8" stop-color="#EE8B78" stop-opacity=".6"/><stop offset="1" stop-color="#EE8B78" stop-opacity="0"/></radialGradient><filter id="obF" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="9"/></filter></defs><circle cx="${W - 70}" cy="${h * .45}" r="58" fill="none" stroke="rgba(27,26,25,.1)" stroke-dasharray="3 4"/><circle cx="${W - 70}" cy="${h * .45}" r="44" fill="url(#obA)" filter="url(#obF)"/><circle cx="${W - 58}" cy="${h * .55}" r="18" fill="#B9A6E8" opacity=".45" filter="url(#obF)"/>`; },
 body: (h) => `<defs><radialGradient id="obB"><stop offset="0" stop-color="#F7B37A" stop-opacity=".22"/><stop offset="1" stop-color="#F7B37A" stop-opacity="0"/></radialGradient></defs><circle cx="40" cy="${h - 30}" r="120" fill="url(#obB)"/>`,
 hero: (h) => `<defs><radialGradient id="obH" cx=".42" cy=".4" r=".5"><stop offset="0" stop-color="#FFE6B8"/><stop offset=".45" stop-color="#F7B37A"/><stop offset=".8" stop-color="#EE8B78" stop-opacity=".55"/><stop offset="1" stop-color="#EE8B78" stop-opacity="0"/></radialGradient><filter id="obG" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="12"/></filter></defs><circle cx="${W - 40}" cy="18" r="66" fill="url(#obH)" filter="url(#obG)" opacity=".85"/><circle cx="${W - 40}" cy="18" r="84" fill="none" stroke="rgba(27,26,25,.09)" stroke-dasharray="3 4"/>`,
 hpt: '14px'};

function plVars(el) { const th = TM[curTheme().k] || TM.lofi; for (const k in th.v) el.style.setProperty(k, th.v[k]); el.classList.toggle('plgrain', !!th.grain); return th; }
const plSvg = (w, h, inner, cls = '') => `<svg class="${cls}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${inner}</svg>`;
function plDeco(el, fn, cls) { if (!el) return; const r = el.getBoundingClientRect(); W = Math.round(r.width) || 336; const h = Math.round(r.height) || 88; el.insertAdjacentHTML('afterbegin', plSvg(W, h, fn(h), cls || 'pbg')); }

// =========================================================
//  플래너 — 기입 화면
// =========================================================
function plansOf(k) { return (D.plans[k] = D.plans[k] || []); }
function cleanPlans(k) { if (D.plans[k]) { D.plans[k] = D.plans[k].filter(p => p.todos.length); if (!D.plans[k].length) delete D.plans[k]; } }
function renderDay() {
  const k = R.day, dt = kdate(k), dd = selDday();
  const sun = addDays(dt, -dt.getDay());
  const P = (D.plans[k] || []).filter(p => sub(p.sid)).sort((a, b) => { const ra = planRange(a), rb = planRange(b); return (ra ? toMin(ra.slice(0, 5)) : 2000) - (rb ? toMin(rb.slice(0, 5)) : 2000); });
  const all = P.reduce((a, p) => a + p.todos.length, 0), done = P.reduce((a, p) => a + p.todos.filter(t => t.done).length, 0);
  const vow = D.vows[k], gm = goalMin(k);
  screen.innerHTML = `<div class="scroll day" style="overflow:hidden"><div class="wrap">
    <div class="dh"><svg class="tap" data-act="back" viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg><b>${dt.getMonth() + 1}월 ${dt.getDate()}일 ${WD[dt.getDay()]}요일</b><span class="tap" data-act="dday">${dd ? esc(dd.name) + ' ' + ddayText(dd.date, k) : 'D-day 설정'}</span></div>
    <div class="card phero" style="--hpt:${(TM[curTheme().k] || {}).hpt || '14px'}"><div class="week">${[0, 1, 2, 3, 4, 5, 6].map(i => { const x = addDays(sun, i), xk = dkey(x); return `<div class="tap${xk === k ? ' on' : ''}" data-day="${xk}">${WD[i]}<b class="num">${x.getDate()}</b><i style="${(D.plans[xk] || []).length || xk === k ? '' : 'visibility:hidden'}"></i></div>`; }).join('')}</div>
    <div class="goal">
      <div class="q tap" data-act="vow"><small>오늘의 다짐</small><p class="${vow && vow.text ? '' : 'ph'}">${vow && vow.text ? esc(vow.text) : '한 줄 다짐을 적어보세요'}</p></div>
      <div class="tm"><small>공부시간</small><b class="num" id="dayT">${hm(studiedSec(k))}<span> / ${gm ? Math.round(gm / 6) / 10 + 'h' : '-'}</span></b></div>
    </div></div>
    <div class="card dmain">
      <div class="todo"><div class="h">할 일<span class="num">${done} / ${all}</span></div>
        ${P.map(p => { const s = sub(p.sid), pi = D.plans[k].indexOf(p), rg = planRange(p); return `<div class="sub" style="--l:${s.l};--sc:${s.c}">
          <div class="sn"><b>${esc(s.name)}</b><u class="num">${rg}</u></div>
          ${p.todos.map(t => `<div class="it${t.done ? ' done' : ''}"><div class="ck tap${t.done ? ' on' : ''}" style="--c:${s.c}" data-ck="${t.id}">${t.done ? CK : ''}</div><span class="tap" data-edit="${t.id}">${esc(t.t)}${t.kind === 'time' ? `<em class="tt num">${t.st}~${t.en}</em>` : ''}</span></div>`).join('')}
          <div class="add tap" data-addtodo="${pi}"><i>+</i>할 일 추가</div></div>`; }).join('')}
        <div class="addsub tap" data-act="addplan">+ 할 일 추가</div>
      </div>
      <div class="ttb"><div class="h">타임테이블<span>10분</span></div><div class="tgrid" id="tg"></div>
        <div class="legend"><span><i class="p"></i>계획</span><span><i></i>공부</span></div></div>
    </div></div></div>`;
  drawTimetable(k);
  const th = plVars(screen.querySelector('.day'));
  plDeco(screen.querySelector('.phero'), th.hero); plDeco(screen.querySelector('.dmain'), th.body);
}
function drawTimetable(k) {
  const base = kdate(k).getTime() + 6 * 3600e3; // 6시부터 19시간(6~0시)
  const cells = new Array(19 * 6).fill(null);
  for (const { s, t } of dayTodos(k)) {
    if (t.kind !== 'time') continue;
    let a = toMin(t.st) - 360, b = toMin(t.en) - 360; if (a < 0) a += 1440; if (b <= 0) b += 1440; if (b < a) b += 1440;
    for (let m = a; m < b && m < 1140; m += 10) if (m >= 0) cells[Math.floor(m / 10)] = { c: s.c, o: .35 };
  }
  for (const r of allSessions()) {
    const s = sub(r.sid); if (!s) continue;
    for (let i = 0; i < cells.length; i++) { const cs = base + i * 600e3, ce = cs + 600e3; const ov = Math.min(ce, r.e) - Math.max(cs, r.s); if (ov >= 300e3) cells[i] = { c: s.c, o: .9 }; }
  }
  let h = ''; for (let r = 0; r < 19; r++) { let c = ''; for (let j = 0; j < 6; j++) { const x = cells[r * 6 + j]; c += `<i style="${x ? `background:${x.c};opacity:${x.o}` : ''}"></i>`; } h += `<div class="r"><em class="num">${(6 + r) % 24}</em>${c}</div>`; }
  const tg = $('#tg'); if (tg) tg.innerHTML = h;
}

// =========================================================
//  스터디룸 — 오늘의 시간 할 일을 골라 공부
// =========================================================
let roomPick = null; // 'sid|tid'
function roomOptions() {
  const T = dayTodos(todayKey()).filter(x => x.t.kind === 'time' && !x.t.done).map(x => ({ key: x.s.id + '|' + x.t.id, label: x.t.t, s: x.s }));
  return T.length ? T : D.subjects.map(s => ({ key: s.id + '|', label: s.name, s }));
}
function renderRoom() {
  const opts = roomOptions();
  const runF = D.running && D.running.tid && findTodo(D.running.tid);
  const runLabel = D.running ? (runF ? runF.t.t : (sub(D.running.sid) || {}).name) : '';
  if (!roomPick || !opts.find(o => o.key === roomPick)) { const lt = opts.find(o => o.key.endsWith('|' + D.lastTid)); roomPick = (lt || opts[0] || {}).key || null; }
  const po = opts.find(o => o.key === roomPick);
  screen.innerHTML = `<div class="scroll room" style="overflow:hidden"><div class="art"></div>
    <div class="head"><span class="tt" style="color:#fff">스터디룸</span><div class="av tap" data-act="profile">${AV}</div></div>
    <div class="timer">
      ${D.running ? '' : `<div class="chipsd">${opts.map(o => `<span class="tap${o.key === roomPick ? ' on' : ''}" data-pick="${o.key}" style="--c:${o.s.c}"><i></i>${esc(o.label)}</span>`).join('') || '<span class="tap" data-act="newsub">+ 테마 추가</span>'}</div>`}
      <div class="rowx"><div class="tx"><div class="sub" id="rmSub">${D.running ? esc(runLabel) + ' · 오늘 ' + hms(studiedSec(todayKey())) : po ? esc(po.label) + ' · 오늘 ' + hms(studiedSec(todayKey())) : '테마를 먼저 추가해 주세요'}</div>
        <div class="t num" id="rmT">${D.running ? hms((Date.now() - D.running.start) / 1000) : '0:00:00'}</div></div>
        <div class="pp tap" data-act="roomtoggle">${D.running ? PAUSE : '<svg viewBox="0 0 24 24"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" fill="currentColor"/></svg>'}</div></div>
    </div></div>`;
}
function tickRoom() {
  if (!D.running) return;
  const t = $('#rmT'); if (t) t.textContent = hms((Date.now() - D.running.start) / 1000);
  const u = $('#rmSub'); if (u) { const f = D.running.tid && findTodo(D.running.tid); u.textContent = `${f ? f.t.t : (sub(D.running.sid) || {}).name} · 오늘 ${hms(studiedSec(todayKey()))}`; }
}

// =========================================================
//  상점 / 커뮤니티 (디자인 확정 전 — 준비 중)
// =========================================================
function renderShop() {
  const cur = curTheme().k;
  screen.innerHTML = `<div class="scroll soon shop"><div class="wrap">
    <div class="head" style="padding:0 4px"><span class="tt">상점</span><div class="av tap" data-act="profile">${AV}</div></div>
    <div class="sec"><b>스터디룸 테마</b><span style="padding-left:0">적용하면 홈 배너와 스터디룸이 바뀌어요</span></div>
    ${THEMES.map(t => `<div class="thc${t.k === cur ? ' on' : ''}"><div class="thimg" style="background-image:url(img/${t.k === 'lofi' ? 'v2' : t.k}_wide.jpg)"></div>
      <div class="thb"><div><b>${t.n}${t.isNew ? '<u class="new">NEW</u>' : ''}</b><span>${t.d}</span></div>${t.k === cur ? '<em>적용 중</em>' : `<button class="tap" data-theme="${t.k}">적용하기</button>`}</div></div>`).join('')}
  </div></div>`;
}
function renderSoon() {
  const shop = R.tab === 'shop';
  if (shop) return renderShop();
  const icon = shop ? TABS[3][2] : TABS[4][2];
  screen.innerHTML = `<div class="scroll soon"><div class="wrap">
    <div class="head" style="padding:0 4px"><span class="tt">${shop ? '상점' : '커뮤니티'}</span><div class="av tap" data-act="profile">${AV}</div></div>
    <div class="box"><svg viewBox="0 0 24 24">${icon}</svg><b>준비 중이에요</b><p>${shop ? '스터디룸을 꾸밀 아이템과 테마를<br>여기서 만나볼 수 있게 될 거예요.' : '함께 공부하는 친구들과<br>기록을 나누는 공간이 생길 거예요.'}</p></div>
  </div></div>`;
}

// =========================================================
//  화면 클릭 처리
// =========================================================
function toggleTodo(tid) { const f = findTodo(tid); if (!f) return; f.t.done = !f.t.done; save(); }
screen.addEventListener('click', e => {
  const tb = e.target.closest('[data-theme]');
  if (tb) { D.roomTheme = tb.dataset.theme; save(); render(); toast(curTheme().n + ' 테마를 적용했어요'); return; }
  const el = e.target.closest('[data-act],[data-day],[data-mon],[data-play],[data-ck],[data-hck],[data-edit],[data-addtodo],[data-pick],[data-cta]');
  if (!el) return;
  const ds = el.dataset;
  if (ds.act) {
    const a = ds.act;
    if (a === 'room') go('room');
    else if (a === 'profile') sheetProfile();
    else if (a === 'dday') sheetDday();
    else if (a === 'subjects') sheetSubjects();
    else if (a === 'newsub') sheetSubjectEdit(null);
    else if (a === 'today') openDay(todayKey());
    else if (a === 'back') { R.day = null; render(); }
    else if (a === 'vow') sheetVow();
    else if (a === 'addplan') sheetTodo(null);
    else if (a === 'roomtoggle') {
      if (D.running) stopTimer();
      else if (roomPick) { const [sid, tid] = roomPick.split('|'); startTimer(sid, tid || null); }
      else return sheetSubjectEdit(null);
      renderRoom();
    }
  } else if (ds.cta) {
    if (ds.cta === 'add') { openDay(todayKey()); sheetTodo(null); }
    else if (D.running && (ds.cta === 'free' || D.running.tid === ds.cta)) { stopTimer(); render(); }
    else { const f = findTodo(ds.cta); if (f) { startTimer(f.s.id, f.t.id); go('room'); } }
  } else if (ds.day) openDay(ds.day);
  else if (ds.mon) { R.calM += +ds.mon; if (R.calM < 0) { R.calM = 11; R.calY--; } if (R.calM > 11) { R.calM = 0; R.calY++; } renderCal(); }
  else if (ds.play) { if (D.running && D.running.tid === ds.play) { stopTimer(); render(); } else { const f = findTodo(ds.play); if (f) { startTimer(f.s.id, f.t.id); go('room'); } } }
  else if (ds.ck) { toggleTodo(ds.ck); renderDay(); }
  else if (ds.hck) { toggleTodo(ds.hck); renderHome(); }
  else if (ds.edit) sheetTodo(ds.edit);
  else if (ds.addtodo !== undefined) inlineAdd(el, +ds.addtodo);
  else if (ds.pick) { roomPick = ds.pick; renderRoom(); }
});
function inlineAdd(el, pi) { // 과목 아래에서 바로 적는 체크 할 일
  if (el.querySelector('input')) return;
  el.innerHTML = '<i>+</i><input maxlength="40" placeholder="할 일을 적고 완료">';
  const inp = el.querySelector('input'); inp.focus();
  let done = false;
  const commit = again => { if (done) return; done = true; const v = inp.value.trim(); if (v) { D.plans[R.day][pi].todos.push({ id: uid(), t: v, done: false, kind: 'check' }); save(); } renderDay(); if (v && again) { const n = document.querySelector(`[data-addtodo="${pi}"]`); if (n) inlineAdd(n, pi); } };
  inp.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); commit(true); } });
  inp.addEventListener('blur', () => setTimeout(() => commit(false), 50));
}

// =========================================================
//  바텀시트
// =========================================================
let sheetStack = [];
function openSheet(html, onMount) {
  closeSheet(true);
  const w = document.createElement('div'); w.className = 'shw';
  w.innerHTML = `<div class="dim"></div><div class="sh"><div class="hd"></div>${html}</div>`;
  $('#sheets').appendChild(w); sheetStack.push(w);
  w.querySelector('.dim').onclick = () => closeSheet();
  w.querySelectorAll('[data-close]').forEach(x => x.onclick = () => closeSheet());
  requestAnimationFrame(() => requestAnimationFrame(() => w.classList.add('open')));
  if (onMount) onMount(w);
  return w;
}
function closeSheet(instant) {
  const w = sheetStack.pop(); if (!w) return false;
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  if (instant) w.remove(); else { w.classList.remove('open'); setTimeout(() => w.remove(), 260); }
  return true;
}
const title = t => `<div class="tl"><b>${t}</b><span class="tap" data-close>${XI}</span></div>`;

// ----- 할 일 추가 / 수정 (플래너) -----
// 종류: 시간 할 일(시작~종료, 홈에서 ▶로 공부) / 체크 할 일(체크만으로 완료)
function sheetTodo(tid, preSid, draft) {
  const k = R.day || todayKey(), P = plansOf(k);
  const f = tid ? findTodo(tid) : null, edit = f ? f.t : null;
  let sel = edit ? f.s.id : (preSid || (draft && draft.sel) || (D.subjects[0] || {}).id || null);
  let kind = edit ? edit.kind : (draft && draft.kind) || 'time';
  let text = edit ? edit.t : (draft && draft.text) || '';
  const T = dayTodos(k).filter(x => x.t.kind === 'time' && (!edit || x.t.id !== edit.id));
  const lastEnd = T.length ? Math.max(...T.map(x => toMin(x.t.en))) : 540;
  let st = edit && edit.kind === 'time' ? toMin(edit.st) : Math.min(lastEnd, 1380), en = edit && edit.kind === 'time' ? toMin(edit.en) : Math.min(st + 60, 1430);
  let field = 'en';
  const w = openSheet(`${title(edit ? '할 일 수정' : '할 일 추가')}<div style="height:12px"></div>
    <div class="lb lbx">테마<span class="tap" id="pedit">편집</span></div><div class="chips" id="pch"></div>
    <div class="lb">할 일</div><div class="form" style="padding:0;background:none;margin-bottom:18px"><div class="f"><input id="ptd" maxlength="40" placeholder="예) 미적분 p.112~128" value="${esc(text)}"></div></div>
    <div class="lb">종류</div><div class="seg" id="pkind"><span class="tap" data-k="time">시간 정해서 공부</span><span class="tap" data-k="check">체크만 하기</span></div>
    <div id="ptime">
      <div class="lb">공부할 시간</div>
      <div class="tmr"><div class="tf tap" data-f="st"><small>시작</small><b class="num" id="pst"></b></div><em>~</em><div class="tf tap" data-f="en"><small>종료</small><b class="num" id="pen"></b></div></div>
      <div class="wh"><div class="band"></div><div class="col" id="wH"></div><div class="colon">:</div><div class="col" id="wM"></div></div>
      <div class="dur" id="pdur"></div>
    </div>
    <div class="dur" id="pchk" style="margin:-4px 0 18px">홈 화면에 체크칸으로 떠요</div>
    <div class="btns">${edit ? '<div class="btn red tap" id="pdel">삭제</div>' : ''}<div class="btn tap" id="pok">${edit ? '저장' : '추가하기'}</div></div>`);
  const ptd = w.querySelector('#ptd');
  let editing = false;
  const chips = () => {
    w.querySelector('#pedit').textContent = editing ? '완료' : '편집';
    w.querySelector('#pch').innerHTML = editing
      ? (D.subjects.map(s => `<div class="c tap cdel" data-s="${s.id}" style="--c:${s.c};--l:${s.l}"><i></i>${esc(s.name)}<b>×</b></div>`).join('') || '<div class="dur" style="margin:0">테마가 없어요</div>')
      : D.subjects.map(s => `<div class="c tap${s.id === sel ? ' on' : ''}" data-s="${s.id}" style="--c:${s.c};--l:${s.l}"><i></i>${esc(s.name)}</div>`).join('') + '<div class="c new tap" data-s="__new">+ 새 테마</div>';
  };
  chips();
  w.querySelector('#pedit').onclick = () => { editing = !editing; chips(); };
  w.querySelector('#pch').onclick = e => {
    const c = e.target.closest('[data-s]'); if (!c) return;
    if (editing) {
      const id = c.dataset.s, sb = sub(id); if (!sb) return;
      askConfirm(`'${esc(sb.name)}' 테마를 삭제하시겠습니까?`, '이 테마의 할 일도 함께 지워져요', () => {
        if (D.running && D.running.sid === id) stopTimer(true);
        D.subjects = D.subjects.filter(x => x.id !== id);
        for (const k in D.plans) D.plans[k] = D.plans[k].filter(p => p.sid !== id);
        if (sel === id) sel = (D.subjects[0] || {}).id || null;
        save(); chips(); upd(); render(); toast('테마를 삭제했어요');
      });
      return;
    }
    if (c.dataset.s === '__new') { const dr = { text: ptd.value.trim(), kind }; sheetSubjectEdit(null, ns => { const back = R.day; sheetTodo(null, ns, dr); }); return; }
    sel = c.dataset.s; chips(); upd();
  };
  const H = w.querySelector('#wH'), M = w.querySelector('#wM');
  H.innerHTML = Array.from({ length: 24 }, (_, i) => `<div>${pad(i)}</div>`).join('');
  M.innerHTML = [0, 10, 20, 30, 40, 50].map(m => `<div>${pad(m)}</div>`).join('');
  const hl = (col, idx) => [...col.children].forEach((c, i) => c.className = i === idx ? 'on' : Math.abs(i - idx) === 1 ? 's1' : '');
  const valid = () => !!(sel && ptd.value.trim() && (kind === 'check' || en > st));
  function upd() {
    w.querySelectorAll('#pkind span').forEach(x => x.classList.toggle('on', x.dataset.k === kind));
    w.querySelector('#ptime').style.display = kind === 'time' ? '' : 'none';
    w.querySelector('#pchk').style.display = kind === 'check' ? '' : 'none';
    w.querySelector('#pst').textContent = fromMin(st); w.querySelector('#pen').textContent = fromMin(en);
    w.querySelectorAll('.tf').forEach(t => t.classList.toggle('on', t.dataset.f === field));
    const d = en - st, el = w.querySelector('#pdur');
    el.className = 'dur' + (d <= 0 ? ' err' : '');
    el.innerHTML = d > 0 ? `총 <b>${kdur(d)}</b> · 홈 화면에서 ▶로 바로 공부해요` : `<b>종료 시간이 시작보다 늦어야 해요</b>`;
    w.querySelector('#pok').classList.toggle('dis', !valid());
  }
  let lock = false;
  function setWheel() { lock = true; const v = field === 'st' ? st : en; const hi = Math.floor(v / 60), mi = Math.floor(v % 60 / 10); H.scrollTop = hi * 40; M.scrollTop = mi * 40; hl(H, hi); hl(M, mi); setTimeout(() => lock = false, 120); }
  const onScroll = () => {
    const hi = Math.max(0, Math.min(23, Math.round(H.scrollTop / 40))), mi = Math.max(0, Math.min(5, Math.round(M.scrollTop / 40)));
    hl(H, hi); hl(M, mi); if (lock) return;
    const v = hi * 60 + mi * 10; if (field === 'st') st = v; else en = v; upd();
  };
  H.addEventListener('scroll', onScroll); M.addEventListener('scroll', onScroll);
  [H, M].forEach(col => col.addEventListener('click', e => { const i = [...col.children].indexOf(e.target); if (i >= 0) col.scrollTo({ top: i * 40, behavior: 'smooth' }); }));
  w.querySelectorAll('.tf').forEach(t => t.onclick = () => { field = t.dataset.f; upd(); setWheel(); });
  w.querySelector('#pkind').onclick = e => { const x = e.target.closest('[data-k]'); if (!x) return; kind = x.dataset.k; upd(); if (kind === 'time') requestAnimationFrame(setWheel); };
  ptd.oninput = upd; ptd.onkeydown = ev => { if (ev.key === 'Enter') { ev.preventDefault(); ptd.blur(); } };
  requestAnimationFrame(() => { upd(); if (kind === 'time') setWheel(); });
  w.querySelector('#pok').onclick = () => {
    if (!valid()) { toast(!ptd.value.trim() ? '할 일을 적어주세요' : !sel ? '테마를 골라주세요' : '시간을 확인해 주세요'); return; }
    const data = { t: ptd.value.trim(), kind, st: kind === 'time' ? fromMin(st) : null, en: kind === 'time' ? fromMin(en) : null };
    let target = P.find(p => p.sid === sel); if (!target) { target = { sid: sel, todos: [] }; P.push(target); }
    if (edit) {
      Object.assign(edit, data);
      if (f.p !== target) { f.p.todos.splice(f.p.todos.indexOf(edit), 1); target.todos.push(edit); if (D.running && D.running.tid === edit.id) D.running.sid = sel; }
    } else target.todos.push(Object.assign({ id: uid(), done: false }, data));
    cleanPlans(k); save(); closeSheet(); render();
  };
  const del = w.querySelector('#pdel');
  if (del) del.onclick = () => {
    askConfirm('할 일을 삭제하시겠습니까?', esc(edit.t), () => {
      if (D.running && D.running.tid === edit.id) stopTimer(true);
      f.p.todos.splice(f.p.todos.indexOf(edit), 1); cleanPlans(f.k); save(); closeSheet(); render(); toast('할 일을 삭제했어요');
    });
  };
}

// ----- D-day 설정 -----
function sheetDday(editId) {
  const tk = todayKey();
  const ed = editId ? D.ddays.find(x => x.id === editId) : null;
  const list = D.ddays.slice().sort((a, b) => a.date.localeCompare(b.date));
  const w = openSheet(`${title('D-day 설정')}<div class="ss">플래너 위에 보여줄 D-day를 하나 골라주세요</div>
    ${list.map(x => { const dt = kdate(x.date); return `<div class="dit tap${x.id === D.ddSel ? ' on' : ''}${x.date < tk ? ' past' : ''}" data-id="${x.id}"><div class="rd"></div><div class="dtx"><b>${esc(x.name)}</b><span class="num">${x.date.replace(/-/g, '.')} (${WD[dt.getDay()]})</span></div><span class="ddc num">${ddayText(x.date, tk)}</span><span class="tap" data-edit="${x.id}">${PEN}</span></div>`; }).join('')}
    <div class="lb" style="margin-top:16px">${ed ? 'D-day 수정' : '새 D-day'}</div>
    <div class="form"><div class="frow"><div class="f" style="flex:1.3"><small>이름</small><input id="dn" maxlength="12" placeholder="예) 토익 시험" value="${ed ? esc(ed.name) : ''}"></div><div class="f"><small>날짜</small><input id="dt" type="date" class="num" value="${ed ? ed.date : dkey(addDays(new Date(), 30))}"></div></div></div>
    <div class="btns">${ed ? '<div class="btn red tap" id="ddel">삭제</div>' : ''}<div class="btn tap" id="dok">저장</div></div>`);
  w.querySelectorAll('.dit').forEach(r => r.onclick = e => {
    const ee = e.target.closest('[data-edit]'); if (ee) { sheetDday(ee.dataset.edit); return; }
    D.ddSel = r.dataset.id; save(); closeSheet(); render();
  });
  w.querySelector('#dok').onclick = () => {
    const n = w.querySelector('#dn').value.trim(), d = w.querySelector('#dt').value;
    if (!n || !d) { if (list.length && !n && !ed) { closeSheet(); return; } toast('이름과 날짜를 입력해 주세요'); return; }
    if (ed) { ed.name = n; ed.date = d; } else { const x = { id: uid(), name: n, date: d }; D.ddays.push(x); D.ddSel = x.id; }
    save(); closeSheet(); render();
  };
  const del = w.querySelector('#ddel');
  if (del) del.onclick = () => askConfirm('D-day를 삭제하시겠습니까?', esc(ed.name), () => { D.ddays = D.ddays.filter(x => x.id !== ed.id); if (D.ddSel === ed.id) D.ddSel = (D.ddays[0] || {}).id || null; save(); sheetDday(); render(); });
}

// ----- 오늘의 다짐 -----
function sheetVow() {
  const k = R.day || todayKey(), dt = kdate(k), cur = D.vows[k] || { text: '', emo: '' };
  const EMO = ['✏️', '🔥', '💪', '📚', '☕', '🌙', '🍀'];
  const past = Object.keys(D.vows).filter(x => x !== k && D.vows[x].text).sort().reverse().slice(0, 3);
  let emo = cur.emo || '';
  const base = cur.emo && cur.text.endsWith(' ' + cur.emo) ? cur.text.slice(0, -(cur.emo.length + 1)) : cur.text;
  const w = openSheet(`${title('오늘의 다짐')}<div class="ss">${dt.getMonth() + 1}월 ${dt.getDate()}일 ${WD[dt.getDay()]}요일 · 짧게 한 줄로 적어보세요</div>
    <div class="inp"><textarea id="vt" rows="2" maxlength="30" placeholder="예) 오답노트 미루지 말기">${esc(base)}</textarea><small class="num" id="vc"></small></div>
    <div class="emo" id="ve">${EMO.map(x => `<span class="tap${x === emo ? ' on' : ''}">${x}</span>`).join('')}</div>
    ${past.length ? `<div class="lb">지난 다짐</div><div class="rec">${past.map(x => `<div class="tap" data-v="${x}">${esc(D.vows[x].text)}<span>${+x.slice(5, 7)}.${x.slice(8)}</span></div>`).join('')}</div>` : ''}
    <div class="tg">홈 화면에도 보여주기<div class="sw tap${D.vowHome ? ' on' : ''}" id="vsw"></div></div>
    <div class="btn tap" id="vok">저장</div>`);
  const ta = w.querySelector('#vt'), vc = w.querySelector('#vc');
  const cnt = () => vc.textContent = `${ta.value.length} / 30`; cnt(); ta.oninput = cnt;
  w.querySelector('#ve').onclick = e => { const s = e.target.closest('span'); if (!s) return; emo = emo === s.textContent ? '' : s.textContent; w.querySelectorAll('#ve span').forEach(x => x.classList.toggle('on', x.textContent === emo)); };
  w.querySelectorAll('[data-v]').forEach(r => r.onclick = () => { const v = D.vows[r.dataset.v]; ta.value = v.emo && v.text.endsWith(' ' + v.emo) ? v.text.slice(0, -(v.emo.length + 1)) : v.text; emo = v.emo || ''; cnt(); w.querySelectorAll('#ve span').forEach(x => x.classList.toggle('on', x.textContent === emo)); });
  const sw = w.querySelector('#vsw'); sw.onclick = () => sw.classList.toggle('on');
  w.querySelector('#vok').onclick = () => {
    const t = ta.value.trim();
    if (t) D.vows[k] = { text: emo ? `${t} ${emo}` : t, emo }; else delete D.vows[k];
    D.vowHome = sw.classList.contains('on'); save(); closeSheet(); render();
  };
}

// ----- 과목 관리 (홈 > 편집) -----
function sheetSubjects() {
  const w = openSheet(`${title('테마 관리')}<div class="ss">플래너에서 쓸 테마와 색을 정해주세요</div>
    ${D.subjects.map(s => `<div class="srow tap" data-s="${s.id}" style="--c:${s.c}"><i></i><b>${esc(s.name)}</b>${PEN}</div>`).join('')}
    <div class="dadd tap" id="snew">+ 새 테마</div>
    <div class="btn tap" data-close>완료</div>`);
  w.querySelectorAll('[data-s]').forEach(r => r.onclick = () => sheetSubjectEdit(r.dataset.s, null, true));
  w.querySelector('#snew').onclick = () => sheetSubjectEdit(null, null, true);
}
function sheetSubjectEdit(id, after, back) {
  const s = id ? sub(id) : null;
  const usedC = new Set(D.subjects.map(x => x.c));
  let ci = s ? Math.max(0, PALETTE.findIndex(p => p[0] === s.c)) : Math.max(0, PALETTE.findIndex(p => !usedC.has(p[0])));
  let goal = s ? s.goal : 60;
  const w = openSheet(`${title(s ? '테마 수정' : '새 테마')}<div style="height:12px"></div>
    <div class="lb">이름</div><div class="form" style="padding:0;background:none;margin-bottom:18px"><div class="f"><input id="sn" maxlength="10" placeholder="예) 사회탐구" value="${s ? esc(s.name) : ''}"></div></div>
    <div class="lb">색</div><div class="pal" id="sp">${PALETTE.map((p, i) => `<span class="tap${i === ci ? ' on' : ''}" style="--c:${p[0]}"></span>`).join('')}</div>
    <div class="btns">${s ? '<div class="btn red tap" id="sdel">삭제</div>' : ''}<div class="btn tap" id="sok">저장</div></div>`);
  w.querySelector('#sp').onclick = e => { const x = e.target.closest('span'); if (!x) return; ci = [...x.parentNode.children].indexOf(x); w.querySelectorAll('#sp span').forEach((y, i) => y.classList.toggle('on', i === ci)); };
  w.querySelector('#sok').onclick = () => {
    const n = w.querySelector('#sn').value.trim(); if (!n) { toast('테마 이름을 입력해 주세요'); return; }
    let nid;
    if (s) { s.name = n; s.c = PALETTE[ci][0]; s.l = PALETTE[ci][1]; s.goal = goal; nid = s.id; }
    else { nid = uid(); D.subjects.push({ id: nid, name: n, c: PALETTE[ci][0], l: PALETTE[ci][1], goal }); }
    save(); closeSheet(true);
    if (after) after(nid); else if (back) sheetSubjects();
    render();
  };
  const del = w.querySelector('#sdel');
  if (del) del.onclick = () => {
    askConfirm(`'${esc(s.name)}' 테마를 삭제하시겠습니까?`, '이 테마의 할 일도 함께 지워져요', () => {
      if (D.running && D.running.sid === s.id) stopTimer(true);
      D.subjects = D.subjects.filter(x => x.id !== s.id);
      for (const k in D.plans) D.plans[k] = D.plans[k].filter(p => p.sid !== s.id);
      save(); closeSheet(true); if (back) sheetSubjects(); render(); toast('테마를 삭제했어요');
    });
  };
}

// ----- 프로필 -----
function sheetProfile() {
  const total = D.sessions.reduce((a, r) => a + (r.e - r.s), 0) / 1000;
  const w = openSheet(`${title('내 정보')}<div class="ss">기록은 이 기기 안에만 저장돼요</div>
    <div class="srow"><b>지금까지 공부한 시간</b><span class="num">${kdur(total / 60)}</span></div>
    <div class="srow"><b>연속 공부</b><span>${streak()}일</span></div>
    <div class="srow tap" id="psub"><b>테마 관리</b><span>${D.subjects.length}개</span>${PEN}</div>
    <div class="srow"><b>앱 버전</b><span>0.1.12</span></div>
    <div style="height:10px"></div>
    <div class="btns"><div class="btn red tap" id="reset" style="flex:1">기록 초기화</div><div class="btn tap" data-close>닫기</div></div>`);
  w.querySelector('#psub').onclick = () => sheetSubjects();
  const r = w.querySelector('#reset');
  r.onclick = () => askConfirm('모든 기록을 삭제하시겠습니까?', '삭제한 기록은 되돌릴 수 없어요', () => { localStorage.removeItem(KEY); D = defaults(); save(); closeSheet(); go('home'); toast('모든 기록을 지웠어요'); });
}

// ---------- 토스트 ----------
let tt;
function askConfirm(msg, sub, onYes) {
  const o = document.createElement('div'); o.className = 'cfm';
  o.innerHTML = `<div class="cfb"><b>${msg}</b>${sub ? `<p>${sub}</p>` : ''}<div class="cfr"><div class="tap" data-n>아니오</div><div class="tap yes" data-y>예</div></div></div>`;
  document.body.appendChild(o); requestAnimationFrame(() => o.classList.add('on'));
  const close = () => { o.classList.remove('on'); setTimeout(() => o.remove(), 180); };
  o.onclick = e => { if (e.target.closest('[data-y]')) { close(); onYes(); } else if (e.target.closest('[data-n]') || e.target === o) close(); };
}
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('on'), 2000); }

// ---------- 뒤로가기 (안드로이드 버튼) ----------
window.appBack = function () {
  if (closeSheet()) return true;
  if (R.tab === 'planner' && R.day) { R.day = null; render(); return true; }
  if (R.tab !== 'home') { go('home'); return true; }
  return false;
};
// 브라우저(PWA)용 뒤로가기
history.pushState(null, '', location.href);
window.addEventListener('popstate', () => { if (window.appBack()) history.pushState(null, '', location.href); });

// ---------- 1초마다 갱신 ----------
let lastDay = todayKey();
setInterval(() => {
  if (todayKey() !== lastDay) { lastDay = todayKey(); render(); return; }
  if (!D.running) return;
  if (checkAutoDone()) { render(); return; }
  if (R.tab === 'home') tickHome();
  else if (R.tab === 'room') tickRoom();
  else if (R.tab === 'planner' && R.day && Math.floor(Date.now() / 1000) % 15 === 0) { const t = $('#dayT'); if (t) t.firstChild.textContent = hm(studiedSec(R.day)); drawTimetable(R.day); }
}, 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });

if (D.running) native('keepScreenOn', true);
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => { });
render();

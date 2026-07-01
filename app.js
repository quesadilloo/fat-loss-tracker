/* ============================================================
   FAT LOSS TRACKER
   A self-contained tracker built from the PRD + Excel schema.
   Persistence: localStorage. Charts: inline SVG. No build step.
   ============================================================ */

'use strict';

/* ---------- constants from the Excel "database" ---------- */
const KCAL_PER_KG = 7700;                 // energy per kg fat
const SESSIONS = [                        // weekly training plan (Weekly Activity sheet)
  { day:'Sun', name:'Long run' },
  { day:'Mon', name:'Glutes I' },
  { day:'Tue', name:'Zone 2 + badminton' },
  { day:'Wed', name:'Upper body + interval run' },
  { day:'Thu', name:'Glutes II' },
  { day:'Fri', name:'Threshold run' },
];                                        // Saturday = rest (6 trainable days)
const MEASURE_PARTS = [                    // Measurements sheet columns
  ['waist','Waist'],['hips','Hips'],['glutes','Glutes'],
  ['lThigh','L Thigh'],['rThigh','R Thigh'],['lArm','L Arm'],['rArm','R Arm'],
  ['bust','Bust'],['neck','Neck'],
];

/* ---------- defaults seeded from the spreadsheet ---------- */
function defaultSettings(){
  return {
    name:'',
    gender:'female',          // Mifflin constant: female -161, male +5
    height:156,               // cm
    age:22,                   // yrs
    startWeight:67,           // kg
    goalWeight:54,            // kg
    activityMultiplier:1.675,
    dailyDeficit:800,         // kcal
    deficitWeeksPerBlock:4,   // 4 on / 1 maintenance
    startDate: todayISO(),
    units:'kg',
    weightMsStart:68,         // kg — start of the 10 weight milestones
    weightMsGoal:54,          // kg — end of the 10 weight milestones
    waistStart:78,            // cm — first waist (Measurements sheet baseline)
    waistGoal:68,             // cm — target waist for milestones
    adminPin:'1234',          // gate for amending the deficit
    deficitLog:[],            // [{date, from, to}] audit trail of deficit changes
  };
}

/* ============================================================
   STORAGE
   ============================================================ */
const DB = {
  load(key, fallback){
    try{ const v = localStorage.getItem('flt_'+key); return v?JSON.parse(v):fallback; }
    catch(e){ return fallback; }
  },
  save(key, val){ localStorage.setItem('flt_'+key, JSON.stringify(val)); },
};

let state = {
  settings: mergeSettings(DB.load('settings', null)),
  weights:  DB.load('weights', []),       // [{date,weight,time,notes}]
  activity: DB.load('activity', {}),      // {weekStartISO:{0..5:bool, notes}}
  measures: DB.load('measures', []),      // [{date,weight,waist,...,notes}]
  diary:    DB.load('diary', []),         // [{date,content,mood,tags[]}]
  workouts: DB.load('workouts', defaultWorkouts()), // {plan:{Mon..Sun}, log:{ISO:true}}
};

// weekly workout plan + completion log (the Workouts tab)
const DAY_KEYS=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];   // workouts: week starts Sunday
function defaultWorkouts(){
  return {
    plan:{
      Mon:{ split:'GLUTES', title:'Glutes I', tags:['Glutes','Hamstrings'], exercises:[
        {name:'Hip Thrust', note:'Main lift — drive through heels', scheme:'4x8'},
        {name:'Romanian Deadlift', note:'Hamstrings + hinge', scheme:'3x10'},
        {name:'Bulgarian Split Squat', note:'Per leg', scheme:'3x10ea'},
        {name:'Cable Kickback', note:'Glute med, slow', scheme:'3x15ea'},
      ]},
      Tue:{ split:'CARDIO', title:'Zone 2 + Badminton', tags:['Cardio'], exercises:[
        {name:'Zone 2 Run', note:'Easy, nose-breathing pace', scheme:'40min'},
        {name:'Badminton', note:'Social game', scheme:'60min'},
      ]},
      Wed:{ split:'UPPER', title:'Upper Body + Interval Run', tags:['Upper','Cardio'], exercises:[
        {name:'Assisted Pull-Ups', note:'Back width', scheme:'4xmax'},
        {name:'Seated Cable Row', note:'Squeeze shoulder blades', scheme:'3x12'},
        {name:'Dumbbell Shoulder Press', note:'', scheme:'3x10'},
        {name:'Interval Run', note:'After lifting', scheme:'6x400m'},
      ]},
      Thu:{ split:'GLUTES', title:'Glutes II', tags:['Glutes','Quads'], exercises:[
        {name:'Back Squat', note:'Below parallel', scheme:'4x6'},
        {name:'Hip Thrust', note:'', scheme:'3x10'},
        {name:'Walking Lunges', note:'Per leg', scheme:'3x12ea'},
        {name:'Hip Abduction', note:'Burnout', scheme:'3x20'},
      ]},
      Fri:{ split:'RUN', title:'Threshold Run', tags:['Cardio'], exercises:[
        {name:'Threshold Run', note:'Comfortably hard', scheme:'30min'},
      ]},
      Sat:{ split:'REST', title:'Rest Day', tags:['Recovery'], exercises:[
        {name:'Mobility / Stretch', note:'Optional light flow', scheme:'15min'},
      ]},
      Sun:{ split:'RUN', title:'Long Run', tags:['Cardio','Endurance'], exercises:[
        {name:'Long Run', note:'Easy, conversational', scheme:'60-90min'},
      ]},
    },
    log:{},
  };
}
const clone=o=>JSON.parse(JSON.stringify(o));
// migration: seed editable per-day defaults from the current plan if missing
if(!state.workouts.defaults){ state.workouts.defaults=clone(state.workouts.plan); DB.save('workouts',state.workouts); }

function seedFirstRun(){
  const s = defaultSettings();
  DB.save('settings', s);
  return s;
}
// merge saved settings over defaults so new fields appear for existing users
function mergeSettings(saved){
  if(!saved) return seedFirstRun();
  const s = Object.assign(defaultSettings(), saved);
  DB.save('settings', s);
  return s;
}
function persist(k){ DB.save(k, state[k]); }

/* ============================================================
   DATE HELPERS  (store everything as YYYY-MM-DD)
   ============================================================ */
// format a Date as local YYYY-MM-DD (avoids the UTC shift toISOString causes)
function isoOf(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function todayISO(){ return isoOf(new Date()); }
function parseISO(s){ const [y,m,d]=s.split('-').map(Number); return new Date(y,m-1,d); }
function addDays(iso,n){ const d=parseISO(iso); d.setDate(d.getDate()+n); return isoOf(d); }
function fmtDate(iso,opts){ return parseISO(iso).toLocaleDateString(undefined, opts||{month:'short',day:'numeric'}); }
function fmtLong(iso){ return parseISO(iso).toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric',year:'numeric'}); }
function daysBetween(a,b){ return Math.round((parseISO(b)-parseISO(a))/86400000); }
// Monday-anchored week start (matches the Mon–Sun convention in the PRD)
function weekStart(iso){ const d=parseISO(iso); const k=(d.getDay()+6)%7; d.setDate(d.getDate()-k); return isoOf(d); }

/* ============================================================
   CALCULATIONS  (mirror the Excel formulas)
   ============================================================ */
function mifflinMaintenance(weightKg, s){
  const sexConst = s.gender==='male' ? 5 : -161;
  const bmr = 10*weightKg + 6.25*s.height - 5*s.age + sexConst;
  return bmr * s.activityMultiplier;
}
function lossRatePerWeek(s){ return s.dailyDeficit*7/KCAL_PER_KG; }

// 7-day rolling average series over logged weights (chronological)
// weights are logged in the Measurements tab (single source of truth)
function weightSeries(){
  const ws = state.measures
    .filter(m=>m.weight!=null)
    .map(m=>({date:m.date, weight:m.weight, notes:m.notes||''}))
    .sort((a,b)=>a.date<b.date?-1:1);
  return ws.map((w,i)=>{
    const win = ws.slice(Math.max(0,i-6), i+1);
    const avg = win.reduce((t,x)=>t+x.weight,0)/win.length;
    return { ...w, avg };
  });
}
// current weight = latest 7-day average, fallback to start weight
function currentWeight(){
  const s = weightSeries();
  return s.length ? s[s.length-1].avg : state.settings.startWeight;
}
// latest actual logged weight (today's weigh-in), fallback to start weight
function latestWeight(){
  const s = weightSeries();
  return s.length ? s[s.length-1].weight : state.settings.startWeight;
}

function dashboardMetrics(){
  const s = state.settings;
  const cw = currentWeight();
  const maint = mifflinMaintenance(cw, s);
  const totalLost = s.startWeight - cw;
  const remaining = Math.max(0, cw - s.goalWeight);
  const span = s.startWeight - s.goalWeight;
  const pct = span>0 ? clamp((s.startWeight - cw)/span,0,1) : 0;
  const rate = lossRatePerWeek(s);
  return {
    cw, maint,
    deficitIntake: maint - s.dailyDeficit,
    maintIntake: maint,
    totalLost, remaining, pct, rate,
  };
}

// Goal projection: deficit weeks needed + maintenance breaks
function goalProjection(){
  const s = state.settings;
  const cw = currentWeight();
  const span = cw - s.goalWeight;
  const rate = lossRatePerWeek(s);
  if(span<=0 || rate<=0) return { reached:true, deficitWeeks:0, calWeeks:0, goalDate:todayISO() };
  const deficitWeeks = span/rate;
  const calWeeks = deficitWeeks*(1 + 1/s.deficitWeeksPerBlock);
  const goalDate = addDays(s.startDate, Math.round((currentWeekIndex() + calWeeks)*7));
  return { reached:false, deficitWeeks, calWeeks, goalDate, daysLeft: Math.max(0, daysBetween(todayISO(), goalDate)) };
}

// Week-by-week projected path starting from current weight/today
function projectionTable(){
  const s = state.settings;
  const rate = lossRatePerWeek(s);
  const block = s.deficitWeeksPerBlock;
  const rows = [];
  let wt = currentWeight();   // anchor to actual logged weight
  const startWeek = currentWeekIndex();  // how many weeks since startDate
  let reachedAt = null;
  for(let w=0; w<=52; w++){
    const absW = startWeek + w;          // absolute week number from startDate
    const isMaint = absW>0 && (absW % (block+1) === 0);
    if(w>0 && !isMaint) wt = Math.max(s.goalWeight, wt - rate);
    const maint = mifflinMaintenance(wt, s);
    let phase, intake;
    if(wt<=s.goalWeight){ phase='Goal'; intake=maint; if(reachedAt===null) reachedAt=w; }
    else if(isMaint){ phase='Maintenance'; intake=maint; }
    else { phase='Deficit'; intake=maint - s.dailyDeficit; }
    rows.push({ w:absW, date:addDays(s.startDate, absW*7), wt, maint, intake, phase });
    if(reachedAt!==null && w>=reachedAt+1) break;
  }
  return rows;
}
// compute which week we're in relative to startDate
function currentWeekIndex(){ return Math.max(0, Math.floor(daysBetween(state.settings.startDate, todayISO())/7)); }

/* ============================================================
   GAMIFICATION  (streak · XP · level · milestones)
   ============================================================ */
const XP = { weightDay:10, session:5, measurement:20, diary:15, weightMs:50, waistMs:40, workout:25 };
function workoutsDone(){ return Object.values(state.workouts.log).filter(Boolean).length; }

function loggedDates(){
  return new Set(state.measures.filter(m=>m.weight!=null).map(m=>m.date));
}
// consecutive days with a weigh-in, ending today (or yesterday — grace)
function currentStreak(){
  const set=loggedDates();
  if(!set.size) return 0;
  let cur=todayISO();
  if(!set.has(cur)) cur=addDays(cur,-1);      // grace: counts if logged yesterday
  if(!set.has(cur)) return 0;
  let n=0;
  while(set.has(cur)){ n++; cur=addDays(cur,-1); }
  return n;
}
function bestStreak(){
  const ds=[...loggedDates()].sort();
  let best=0,run=0,prev=null;
  for(const d of ds){
    if(prev && daysBetween(prev,d)===1) run++; else run=1;
    best=Math.max(best,run); prev=d;
  }
  return best;
}
function totalSessions(){
  return Object.values(state.activity).reduce((t,a)=>t+SESSIONS.reduce((x,_,i)=>x+(a[i]?1:0),0),0);
}
function gameStats(){
  const wMs=weightMilestones().filter(m=>m.reached).length;
  const waMs=waistMilestones().filter(m=>m.reached).length;
  const total =
    loggedDates().size*XP.weightDay +
    totalSessions()*XP.session +
    state.measures.length*XP.measurement +
    state.diary.length*XP.diary +
    workoutsDone()*XP.workout +
    wMs*XP.weightMs + waMs*XP.waistMs;
  const t=todayISO();
  const todayXp =
    (loggedDates().has(t)?XP.weightDay:0) +
    (state.measures.some(m=>m.date===t)?XP.measurement:0) +
    (state.diary.some(d=>d.date===t)?XP.diary:0) +
    (state.workouts.log[t]?XP.workout:0);
  const per=200;                                 // XP per level
  const level=Math.floor(total/per)+1;
  const into=total%per;
  return { total, todayXp, level, into, per, msReached:wMs+waMs };
}

// 10 evenly-spaced weight checkpoints from start → goal
function weightMilestones(){
  const s=state.settings, cw=currentWeight();
  const start=s.weightMsStart, goal=s.weightMsGoal;
  const span=start-goal, step=span/10;
  const out=[];
  for(let i=1;i<=10;i++){
    const target=start-step*i;
    const reached=cw<=target+1e-9;
    const prev=start-step*(i-1);
    const pct=clamp((prev-cw)/(prev-target||1),0,1);
    out.push({ i, target:r1(target), reached, pct, kind:'weight' });
  }
  return out;
}
// 10 waist checkpoints from waistStart → waistGoal
function latestWaist(){
  const list=[...state.measures].filter(m=>m.waist!=null).sort((a,b)=>a.date<b.date?-1:1);
  return list.length?list[list.length-1].waist:null;
}
function waistMilestones(){
  const s=state.settings;
  const start=s.waistStart, goal=s.waistGoal;
  const cur=latestWaist();
  const span=start-goal, step=span/10;
  const out=[];
  for(let i=1;i<=10;i++){
    const target=start-step*i;
    const reached=cur!=null && cur<=target+1e-9;
    const prev=start-step*(i-1);
    const pct=cur==null?0:clamp((prev-cur)/(prev-target||1),0,1);
    out.push({ i, target:r1(target), reached, pct, kind:'waist', hasData:cur!=null });
  }
  return out;
}

/* pixel-art mascot — full-body alt girl: long black hair, red round shades,
   gold strapless top, baggy black pants, red shoulder bag, sandals, arm tattoos */
function mascotSVG(px){
  px=px||4;
  const P={
    k:'#14110f',  // hair (near-black)
    s:'#c9925e',  // skin
    g:'#a06a3a',  // skin shadow / nose
    e:'#7d1f1f',  // sunglasses lens (red)
    f:'#e8b84b',  // gold (frame, necklace, top highlight)
    o:'#b9892a',  // gold mid
    d:'#7c5a18',  // gold dark
    w:'#ffffff',  // teeth
    l:'#9c5650',  // lips
    p:'#1b1b20',  // black pants
    q:'#0d0d11',  // pants fold shadow
    r:'#b62a22',  // red bag
    m:'#7d1712',  // red bag shadow
    n:'#232323',  // sandals
    i:'#3a4a5a',  // tattoo ink
  };
  const R=(...spec)=>spec.map(([c,n])=>c.repeat(n)).join('');   // build a row, guarantees widths
  const rows=[
    R(['.',8],['k',6],['.',8]),                                            // hair crown
    R(['.',7],['k',8],['.',7]),
    R(['.',6],['k',10],['.',6]),
    R(['.',5],['k',12],['.',5]),
    R(['.',5],['k',12],['.',5]),
    R(['.',4],['k',14],['.',4]),
    R(['.',4],['k',14],['.',4]),
    R(['.',4],['k',3],['s',8],['k',3],['.',4]),                            // forehead
    R(['.',4],['k',3],['s',8],['k',3],['.',4]),                            // brow
    R(['.',4],['k',3],['f',8],['k',3],['.',4]),                            // sunglasses frame
    R(['.',4],['k',3],['e',3],['s',2],['e',3],['k',3],['.',4]),           // lenses
    R(['.',4],['k',3],['e',3],['s',2],['e',3],['k',3],['.',4]),           // lenses lower
    R(['.',4],['k',3],['s',3],['g',2],['s',3],['k',3],['.',4]),           // nose
    R(['.',4],['k',3],['s',1],['l',1],['w',4],['l',1],['s',1],['k',3],['.',4]), // big smile
    R(['.',4],['k',3],['s',2],['l',4],['s',2],['k',3],['.',4]),           // lips
    R(['.',4],['k',3],['s',8],['k',3],['.',4]),                            // chin
    R(['.',3],['k',4],['s',8],['k',4],['.',3]),                            // neck + hair
    R(['.',1],['k',3],['s',6],['f',2],['s',6],['k',3],['.',1]),           // shoulders + necklace
    R(['r',3],['s',3],['f',10],['s',3],['k',2],['.',1]),                  // top hem + bag
    R(['r',2],['m',1],['s',3],['o',1],['d',2],['o',1],['f',2],['o',1],['d',2],['o',1],['s',1],['i',1],['s',1],['k',2],['.',1]),
    R(['m',2],['r',1],['s',3],['d',1],['o',2],['f',1],['o',2],['f',1],['o',2],['d',1],['s',1],['i',1],['s',1],['.',3]),
    R(['m',2],['r',1],['s',3],['o',1],['d',2],['o',1],['f',2],['o',1],['d',2],['o',1],['s',3],['.',3]),
    R(['.',1],['m',1],['r',1],['s',3],['f',10],['s',3],['.',3]),          // top bottom hem
    R(['.',4],['p',6],['f',1],['p',7],['.',4]),                            // waistband + button
    R(['.',4],['p',14],['.',4]),                                          // hips
    R(['.',3],['p',16],['.',3]),
    R(['.',3],['p',6],['q',1],['p',9],['.',3]),                           // fold
    R(['.',3],['p',16],['.',3]),
    R(['.',2],['p',18],['.',2]),                                          // baggy widen
    R(['.',2],['p',8],['q',2],['p',8],['.',2]),                           // center seam
    R(['.',1],['p',8],['.',4],['p',8],['.',1]),                           // legs split
    R(['.',1],['p',8],['.',4],['p',8],['.',1]),
    R(['.',1],['p',2],['q',1],['p',5],['.',4],['p',8],['.',1]),           // left fold
    R(['.',1],['p',8],['.',4],['p',3],['q',1],['p',4],['.',1]),           // right fold
    R(['.',1],['p',8],['.',4],['p',8],['.',1]),
    R(['p',9],['.',4],['p',9]),                                           // wide-leg flare
    R(['p',9],['.',4],['p',9]),
    R(['p',9],['.',4],['p',9]),
    R(['q',9],['.',4],['q',9]),                                           // hem
    R(['n',8],['.',6],['n',8]),                                           // sandals
    R(['n',8],['.',6],['n',8]),
  ];
  let r='';
  rows.forEach((row,y)=>{[...row].forEach((ch,x)=>{
    if(P[ch]) r+=`<rect x="${x*px}" y="${y*px}" width="${px}" height="${px}" fill="${P[ch]}"/>`;
  });});
  const W=22*px, H=rows.length*px;
  return `<svg class="avatar" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" shape-rendering="crispEdges">${r}</svg>`;
}

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const r1=n=>Math.round(n*10)/10;
const r0=n=>Math.round(n);
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

/* ============================================================
   SVG CHART (lightweight line chart with optional points)
   series: [{points:[{x:iso,y:num}], color, width, dashed, fill}]
   ============================================================ */
function lineChart(series, opts){
  opts = opts||{};
  const W=opts.w||640, H=opts.h||230, pad={t:14,r:16,b:28,l:42};
  const all = series.flatMap(s=>s.points).filter(p=>p.y!=null);
  if(!all.length) return `<div class="empty">No data yet — add entries to see the chart.</div>`;
  const xs = all.map(p=>+parseISO(p.x)), ys = all.map(p=>p.y);
  let xmin=Math.min(...xs), xmax=Math.max(...xs);
  let ymin=Math.min(...ys), ymax=Math.max(...ys);
  if(opts.yMin!=null) ymin=Math.min(ymin,opts.yMin);
  if(opts.yMax!=null) ymax=Math.max(ymax,opts.yMax);
  const ypad=(ymax-ymin)*0.12||1; ymin-=ypad; ymax+=ypad;
  if(xmax===xmin) xmax=xmin+86400000;
  const px=x=>pad.l+(+parseISO(x)-xmin)/(xmax-xmin)*(W-pad.l-pad.r);
  const py=y=>H-pad.b-(y-ymin)/(ymax-ymin)*(H-pad.t-pad.b);

  // y gridlines
  let grid='';
  const steps=4;
  for(let i=0;i<=steps;i++){
    const yv=ymin+(ymax-ymin)*i/steps, yy=py(yv);
    grid+=`<line x1="${pad.l}" y1="${yy}" x2="${W-pad.r}" y2="${yy}" stroke="#e7e1d4" stroke-width="1"/>`;
    grid+=`<text x="${pad.l-7}" y="${yy+4}" fill="#a89f8c" font-size="10" text-anchor="end" font-family="monospace">${r1(yv)}</text>`;
  }
  // x labels (first / mid / last)
  const labelIdx=[0, Math.floor(all.length/2), all.length-1];
  let xlab='';
  [...new Set(labelIdx)].forEach(i=>{
    const p=all[i]; if(!p)return;
    xlab+=`<text x="${px(p.x)}" y="${H-9}" fill="#a89f8c" font-size="10" text-anchor="middle" font-family="monospace">${fmtDate(p.x)}</text>`;
  });
  // goal line
  let goalLine='';
  if(opts.goal!=null && opts.goal>=ymin && opts.goal<=ymax){
    const gy=py(opts.goal);
    goalLine=`<line x1="${pad.l}" y1="${gy}" x2="${W-pad.r}" y2="${gy}" stroke="#3f7d54" stroke-width="1.3" stroke-dasharray="5 4" opacity=".8"/>
      <text x="${W-pad.r}" y="${gy-5}" fill="#3f7d54" font-size="10" text-anchor="end" font-family="monospace">goal ${r1(opts.goal)}</text>`;
  }
  let paths='';
  series.forEach(s=>{
    const pts=s.points.filter(p=>p.y!=null);
    if(!pts.length)return;
    const d=pts.map((p,i)=>(i?'L':'M')+px(p.x).toFixed(1)+' '+py(p.y).toFixed(1)).join(' ');
    if(s.fill){
      const area=d+` L ${px(pts[pts.length-1].x).toFixed(1)} ${H-pad.b} L ${px(pts[0].x).toFixed(1)} ${H-pad.b} Z`;
      paths+=`<path d="${area}" fill="${s.color}" opacity=".10"/>`;
    }
    paths+=`<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.width||2.2}" ${s.dashed?'stroke-dasharray="4 4"':''} stroke-linejoin="round" stroke-linecap="round"/>`;
    if(s.dots) pts.forEach(p=>{ paths+=`<circle cx="${px(p.x).toFixed(1)}" cy="${py(p.y).toFixed(1)}" r="${s.dotR||2.6}" fill="${s.dotColor||s.color}"/>`; });
  });
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" role="img">${grid}${goalLine}${paths}${xlab}</svg>`;
}

function ring(pct, color, size){
  size=size||74; const sw=8, r=(size-sw)/2, c=2*Math.PI*r, off=c*(1-clamp(pct,0,1));
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="#243049" stroke-width="${sw}"/>
    <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${color}" stroke-width="${sw}"
      stroke-linecap="round" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"/>
  </svg>`;
}

/* ============================================================
   UI HELPERS
   ============================================================ */
const $=s=>document.querySelector(s);
const main=()=>$('#main');
function toast(msg){ const t=$('#toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(t._t); t._t=setTimeout(()=>t.classList.remove('show'),2200); }
function u(){ return state.settings.units; }

/* ============================================================
   ROUTER
   ============================================================ */
const routes={ dashboard:renderDashboard, milestones:renderMilestones, weight:renderMeasurements,
  workouts:renderWorkouts, measurements:renderMeasurements, diary:renderDiary, projection:renderProjection, settings:renderSettings };
const TITLES={ dashboard:'Dashboard', milestones:'Milestones', weight:'Log & Measure',
  workouts:'Workouts', measurements:'Log & Measure', diary:'Diary', projection:'Projection', settings:'Settings' };
let route='dashboard';
function go(r){
  route=r;
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active', b.dataset.route===r));
  $('#pageTitle').textContent=TITLES[r]||'';
  $('#levelBadge').textContent='LV'+gameStats().level;
  closeDrawer();
  main().scrollTop=0; window.scrollTo(0,0);
  routes[r]();
}
document.querySelectorAll('.nav-btn').forEach(b=>b.addEventListener('click',()=>go(b.dataset.route)));
$('#levelBadge').addEventListener('click',()=>go('milestones'));

/* ---------- drawer ---------- */
function openDrawer(){ $('#drawer').classList.add('open'); $('#scrim').classList.add('show'); }
function closeDrawer(){ $('#drawer').classList.remove('open'); $('#scrim').classList.remove('show'); }
const isDesktop=()=>window.matchMedia('(min-width:1024px)').matches;
$('#menuBtn').addEventListener('click',()=>{
  if(isDesktop()) document.body.classList.toggle('nav-collapsed');   // collapse/expand persistent sidebar
  else openDrawer();                                                 // mobile overlay
});
$('#scrim').addEventListener('click',closeDrawer);

/* ============================================================
   VIEW: DASHBOARD
   ============================================================ */
function renderDashboard(){
  const s=state.settings, m=dashboardMetrics(), gp=goalProjection();
  const ws=weightSeries();
  const nm = s.name ? s.name.split(' ')[0] : 'Ro';
  const g=gameStats();
  const streak=currentStreak(), best=Math.max(bestStreak(),streak);

  // streak blocks: show up to 7
  const blocksMax=7, lit=Math.min(streak,blocksMax);
  let blocks=''; for(let i=0;i<blocksMax;i++) blocks+=`<i class="${i<lit?'on':''}"></i>`;

  // Today list
  const t=todayISO();
  const loggedToday=loggedDates().has(t);
  const wi=currentWeekIndex(), isMaint=wi>0&&(wi%(s.deficitWeeksPerBlock+1)===0);
  const intake = isMaint ? m.maintIntake : m.deficitIntake;
  const lastMeas=[...state.measures].sort((a,b)=>a.date<b.date?1:-1)[0];
  const measAgo=lastMeas?daysBetween(lastMeas.date,t):null;
  const wroteDiary=state.diary.some(d=>d.date===t);
  const woTodayKey=DAY_KEYS[new Date().getDay()];
  const woToday=state.workouts.plan[woTodayKey];
  const woDoneToday=!!state.workouts.log[t];

  const lrow=(name,val,cls)=>`<div class="lrow"><span class="lname">${name}</span><span class="lval ${cls||''}">${val}</span></div>`;
  const todayCard=`
    <div class="card list-card" style="margin-top:16px">
      <div class="lc-head">
        <span class="lc-title"><span class="ic">🎯</span>Today</span>
        <button class="lc-link" data-go="measurements">Log weight</button>
      </div>
      ${lrow('Weigh-in', loggedToday?'✓ done':'—', loggedToday?'done':'dash')}
      <div class="lrow" style="cursor:pointer" data-go="workouts"><span class="lname">Workout · ${esc(woToday.title)}</span><span class="lval ${woDoneToday?'done':'dash'}">${woDoneToday?'✓ done':'—'}</span></div>
      ${lrow(isMaint?'Phase · maintenance':'Phase · deficit', isMaint?'refeed':'on plan')}
      ${lrow('Intake target', r0(intake)+' kcal')}
      ${lrow('Measurements', measAgo==null?'none yet':(measAgo===0?'✓ today':measAgo+'d ago'), measAgo===0?'done':'')}
      ${lrow('Diary', wroteDiary?'✓ done':'—', wroteDiary?'done':'dash')}
      ${lrow("Today's XP", '＋'+g.todayXp+' xp', g.todayXp?'done':'dash')}
    </div>`;

  // This week strip (Sun→Sat) — green if a weigh-in exists that day
  const labels=['S','M','T','W','T','F','S'];
  const wkStart=woWeekStart();  // Sunday-anchored
  const set=loggedDates();
  let doneDays=0, strip='';
  for(let i=0;i<7;i++){
    const d=addDays(wkStart,i);
    const done=set.has(d), future=d>t, mark=done?'✓':(future?' ':'·');
    if(done) doneDays++;
    const cls=done?'done':(future?'future':'');
    strip+=`<div class="daybox ${cls}"><span class="dl">${labels[i]}</span><span class="dm">${mark}</span></div>`;
  }

  const cards=`
    <div class="grid cards" style="margin-top:18px">
      <div class="card metric hl">
        <div class="k">Weight · latest</div>
        <div class="v">${r1(latestWeight())}<small>${u()}</small></div>
        <div class="d">7-day avg ${r1(m.cw)} · ${r0(m.pct*100)}% to goal (${r1(s.goalWeight)} ${u()})</div>
        <div class="bar"><i style="width:${r0(m.pct*100)}%"></i></div>
      </div>
      <div class="card metric">
        <div class="k">Total lost</div>
        <div class="v accent">${m.totalLost>=0?'−':'+'}${r1(Math.abs(m.totalLost))}<small>${u()}</small></div>
        <div class="d">${r1(m.remaining)} ${u()} to go</div>
      </div>
      <div class="card metric">
        <div class="k">Deficit-day intake</div>
        <div class="v accent">${r0(m.deficitIntake)}<small>kcal</small></div>
        <div class="d">Maint ${r0(m.maint)} − ${s.dailyDeficit}</div>
      </div>
      <div class="card metric">
        <div class="k">Loss rate</div>
        <div class="v">${r1(m.rate)}<small>${u()}/wk</small></div>
        <div class="d">${gp.reached?'Goal reached 🎉':'ETA '+fmtDate(gp.goalDate,{month:'short',day:'numeric'})}</div>
      </div>
    </div>`;

  const chart=`
    <div class="card chart-card" style="margin-top:14px">
      <div class="section-title" style="margin:0 0 10px">Weight trend</div>
      ${lineChart([
        {points:ws.map(w=>({x:w.date,y:w.weight})), color:'#b3aa97', width:1.2, dots:true, dotR:2, dotColor:'#b3aa97'},
        {points:ws.map(w=>({x:w.date,y:w.avg})), color:'#4f9d6a', width:2.6, fill:true},
      ], {goal:s.goalWeight, h:210})}
      <div class="chart-legend"><span><i style="background:#4f9d6a"></i>7-day avg</span><span><i style="background:#b3aa97"></i>Daily</span><span><i style="background:#3f7d54"></i>Goal</span></div>
    </div>`;

  main().innerHTML=`
    <div class="greet">
      <img class="avatar" id="charImg" alt="" src="character.png?v=3">
      <div><h1>Let's go, ${esc(nm)}!</h1><div class="sub">${fmtLong(t)}</div></div>
    </div>

    <div class="streak">
      <div class="left">
        <span class="fire">🔥</span>
        <div><div class="stitle">${streak} day streak</div><div class="sbest">best: ${best}</div></div>
      </div>
      <div class="blocks">${blocks}</div>
    </div>

    ${todayCard}

    <div class="card" style="margin-top:14px">
      <div class="week-head">
        <span class="lc-title" style="font-size:18px"><span class="ic">📅</span>This Week</span>
        <span class="mono" style="font-size:11px;color:var(--muted)">${doneDays} day${doneDays===1?'':'s'}</span>
      </div>
      <div class="week-strip">${strip}</div>
    </div>

    ${cards}
    ${chart}
    <div class="note" style="margin-top:14px">${nextPhaseNote()}</div>`;

  bindGo();
  processAvatar();
}
function nextPhaseNote(){
  const wi=currentWeekIndex(), block=state.settings.deficitWeeksPerBlock;
  const isMaint = wi>0 && (wi%(block+1)===0);
  const into = wi%(block+1);
  if(isMaint) return `<b>Maintenance week.</b> Eat at maintenance — no deficit. This refeed pauses the loss and supports hormones & adherence. Back to deficit next week.`;
  const toMaint = (block+1) - into;
  return `<b>Deficit week ${into+1} of ${block}.</b> ${toMaint===1?'Maintenance (refeed) week starts next week — heads up.':'Maintenance week in '+toMaint+' weeks.'} Aim for your deficit-day intake and trust the 7-day average over daily wobbles.`;
}

/* ============================================================
   VIEW: WEIGHT
   ============================================================ */
let weightRange='all';
function renderWeight(){
  const s=state.settings;
  const series=weightSeries();
  let view=series;
  if(weightRange!=='all'){
    const days={ '1w':7,'2w':14,'4w':28 }[weightRange];
    const cut=addDays(todayISO(),-days);
    view=series.filter(w=>w.date>=cut);
  }
  const rowsDesc=[...series].reverse().slice(0,28);

  main().innerHTML=`
    <div class="page-head"><div><h1>Weight</h1><div class="sub">Weigh AM · post-toilet · pre-food, same conditions</div></div></div>

    <div class="card">
      <div class="section-title" style="margin:0 0 12px">Log today's weight</div>
      <div class="form">
        <div class="field"><label>Date</label><input type="date" id="w-date" value="${todayISO()}"></div>
        <div class="field"><label>Weight (${u()})</label><input type="number" step="0.1" id="w-kg" placeholder="e.g. 66.4"></div>
        <div class="field"><label>Time of day</label><input type="text" id="w-time" placeholder="morning"></div>
        <div class="field" style="grid-column:1/-1"><label>Notes</label><input type="text" id="w-notes" placeholder="sleep, cycle, sodium, training…"></div>
      </div>
      <div class="form-actions"><button class="btn primary" id="w-add">Save entry</button></div>
    </div>

    <div class="card chart-card" style="margin-top:18px">
      <div class="row-between" style="margin-bottom:6px">
        <div class="section-title" style="margin:0">Trend</div>
        <div class="range-tabs" id="w-range">
          ${['1w','2w','4w','all'].map(r=>`<button data-r="${r}" class="${r===weightRange?'on':''}">${r==='all'?'All':r}</button>`).join('')}
        </div>
      </div>
      ${lineChart([
        {points:view.map(w=>({x:w.date,y:w.weight})), color:'#b3aa97', width:1.2, dots:true, dotR:2.2},
        {points:view.map(w=>({x:w.date,y:w.avg})), color:'#4f9d6a', width:2.6, fill:true},
      ], {goal:s.goalWeight, h:240})}
      <div class="chart-legend"><span><i style="background:#4f9d6a"></i>7-day average</span><span><i style="background:#b3aa97"></i>Daily</span><span><i style="background:#3f7d54"></i>Goal</span></div>
    </div>

    <div class="section-title">Recent entries</div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Date</th><th class="num">Weight</th><th class="num">7-day avg</th><th class="num">Wkly Δ</th><th>Notes</th><th></th></tr></thead>
        <tbody>
          ${rowsDesc.length? rowsDesc.map((w,i)=>{
            const all=series; const idx=all.findIndex(x=>x.date===w.date && x.weight===w.weight);
            const prevWk = idx>=7 ? all[idx-7].avg : null;
            const delta = prevWk!=null ? w.avg-prevWk : null;
            return `<tr>
              <td>${fmtDate(w.date,{weekday:'short',month:'short',day:'numeric'})}</td>
              <td class="num">${r1(w.weight)}</td>
              <td class="num accent" style="color:var(--teal-l)">${r1(w.avg)}</td>
              <td class="num ${delta==null?'':(delta<=0?'pos':'neg')}">${delta==null?'—':(delta<=0?'−':'+')+r1(Math.abs(delta))}</td>
              <td style="white-space:normal;color:var(--muted)">${esc(w.notes||'')}</td>
              <td><button class="btn sm danger" data-del-w="${w.date}|${w.weight}">✕</button></td>
            </tr>`;}).join('')
          : `<tr><td colspan="6"><div class="empty" style="border:0">No weigh-ins yet.</div></td></tr>`}
        </tbody>
      </table>
    </div>`;

  $('#w-add').onclick=()=>{
    const kg=parseFloat($('#w-kg').value);
    if(!kg){ toast('Enter a weight'); return; }
    const date=$('#w-date').value||todayISO();
    state.weights=state.weights.filter(w=>w.date!==date); // one per day
    state.weights.push({date, weight:kg, time:$('#w-time').value.trim(), notes:$('#w-notes').value.trim()});
    persist('weights'); toast('Weight saved'); renderWeight();
  };
  $('#w-range').querySelectorAll('button').forEach(b=>b.onclick=()=>{weightRange=b.dataset.r;renderWeight();});
  bindDelW();
}
function bindDelW(){
  document.querySelectorAll('[data-del-w]').forEach(b=>b.onclick=()=>{
    const [date,kg]=b.dataset.delW.split('|');
    state.weights=state.weights.filter(w=>!(w.date===date && w.weight==kg));
    persist('weights'); renderWeight();
  });
}

/* ============================================================
   VIEW: ACTIVITY
   ============================================================ */
function renderActivity(){
  const s=state.settings;
  // build 26 weeks from start date
  const weeks=[];
  for(let i=0;i<26;i++) weeks.push({ idx:i, start:weekStart(addDays(s.startDate,i*7)) });
  const curWk=weekStart(todayISO());

  const totals=SESSIONS.map((_,i)=>weeks.reduce((t,w)=>t+((state.activity[w.start]||{})[i]?1:0),0));
  const grandDone=weeks.reduce((t,w)=>{ const a=state.activity[w.start]||{}; return t+SESSIONS.reduce((x,_,i)=>x+(a[i]?1:0),0); },0);

  const head=`<tr><th>Wk</th><th>Week of</th>${SESSIONS.map(se=>`<th class="cell-check"><span class="day">${se.day}</span><span class="ses">${se.name}</span></th>`).join('')}<th class="cell-check"><span class="day">Sat</span><span class="ses">Rest</span></th><th class="num">Done /6</th></tr>`;

  const body=weeks.map(w=>{
    const a=state.activity[w.start]||{};
    const done=SESSIONS.reduce((t,_,i)=>t+(a[i]?1:0),0);
    const isNow=w.start===curWk;
    return `<tr class="${isNow?'now':''}">
      <td>${w.idx+1}</td>
      <td>${fmtDate(w.start)}</td>
      ${SESSIONS.map((_,i)=>`<td class="cell-check" data-tick="${w.start}|${i}">${a[i]?'<span class="tick">✓</span>':'<span class="untick">○</span>'}</td>`).join('')}
      <td class="cell-check rest">—</td>
      <td class="num done-badge" style="color:${done>=5?'#22c55e':done>=3?'#fbbf24':'#93a3bd'}">${done}</td>
    </tr>`;
  }).join('');

  const foot=`<tr style="font-weight:700;background:var(--bg2)"><td colspan="2">Total</td>${totals.map(t=>`<td class="cell-check">${t}</td>`).join('')}<td class="cell-check rest">—</td><td class="num">${grandDone}</td></tr>`;

  main().innerHTML=`
    <div class="page-head"><div><h1>Weekly Activity</h1><div class="sub">Tap a cell to tick a completed session · Saturday is rest</div></div></div>
    <div class="note" style="margin-bottom:16px">Plan: <b>4 runs</b> (long, interval, threshold + zone-2), <b>2 glute sessions</b>, <b>1 upper body</b> & <b>1 badminton</b> across 6 training days. "Done /6" tracks your sessions; the current week is highlighted.</div>
    <div class="act-grid"><table><thead>${head}</thead><tbody>${body}${foot}</tbody></table></div>`;

  document.querySelectorAll('[data-tick]').forEach(c=>c.onclick=()=>{
    const [wk,i]=c.dataset.tick.split('|');
    const a=state.activity[wk]||{};
    a[i]=!a[i];
    state.activity[wk]=a; persist('activity'); renderActivity();
  });
}

/* ============================================================
   VIEW: MEASUREMENTS
   ============================================================ */
let measurePart='weight';
function renderMeasurements(){
  const list=[...state.measures].sort((a,b)=>a.date<b.date?-1:1);
  const first=list[0], last=list[list.length-1];
  const delta=(key)=>{
    if(!first||!last) return null;
    const f=firstVal(list,key), l=lastVal(list,key);
    return (f==null||l==null)?null:l-f;
  };

  const deltaCards=[['weight','Weight'],...MEASURE_PARTS].map(([k,lbl])=>{
    const d=delta(k);
    return `<div class="card metric" style="padding:14px">
      <div class="k">${lbl}</div>
      <div class="v" style="font-size:22px">${d==null?'—':(d<=0?'−':'+')+r1(Math.abs(d))}<small>${k==='weight'?u():'cm'}</small></div>
      <div class="d">${lastVal(list,k)==null?'no data':'now '+r1(lastVal(list,k))}</div>
    </div>`;}).join('');

  const fields=[['weight','Weight ('+u()+')'],...MEASURE_PARTS.map(([k,l])=>[k,l+' (cm)'])];

  const chartPts=list.map(m=>({x:m.date,y:m[measurePart]})).filter(p=>p.y!=null);

  main().innerHTML=`
    <div class="page-head"><div><h1>Log &amp; Measure</h1><div class="sub">Weight + body measurements in one entry · AM, same conditions</div></div></div>
    <div class="note" style="margin-bottom:16px">Log your <b>weight</b> and any body parts here — it all feeds the dashboard, milestones & projection. When training glutes, measurements matter <b>more than the scale</b>: waist can shrink while weight stalls — that's success.</div>

    <div class="card">
      <div class="section-title" style="margin:0 0 12px">New entry</div>
      <div class="form">
        <div class="field"><label>Date</label><input type="date" id="m-date" value="${todayISO()}"></div>
        ${fields.map(([k,l])=>`<div class="field"><label>${l}</label><input type="number" step="0.1" id="m-${k}"></div>`).join('')}
        <div class="field" style="grid-column:1/-1"><label>Notes</label><input type="text" id="m-notes" placeholder="hydration, bloating, soreness…"></div>
      </div>
      <div class="form-actions"><button class="btn primary" id="m-add">Save measurement</button></div>
    </div>

    <div class="grid cards" style="margin-top:18px">${deltaCards}</div>

    <div class="card chart-card" style="margin-top:18px">
      <div class="row-between" style="margin-bottom:8px">
        <div class="section-title" style="margin:0">Trend</div>
        <select id="m-part" class="field" style="width:auto;max-width:180px;padding:7px 10px;border-radius:9px;background:var(--bg);border:1px solid var(--line2);color:var(--txt)">
          ${[['weight','Weight'],...MEASURE_PARTS].map(([k,l])=>`<option value="${k}" ${k===measurePart?'selected':''}>${l}</option>`).join('')}
        </select>
      </div>
      ${lineChart([{points:chartPts, color:'#9b7bd0', width:2.6, dots:true, fill:true}], {h:220})}
    </div>

    <div class="section-title">History</div>
    <div class="table-wrap"><table>
      <thead><tr><th>Date</th><th class="num">Wt</th>${MEASURE_PARTS.map(([_,l])=>`<th class="num">${l}</th>`).join('')}<th>Notes</th><th></th></tr></thead>
      <tbody>${[...list].reverse().map(m=>`<tr>
        <td>${fmtDate(m.date,{month:'short',day:'numeric',year:'numeric'})}</td>
        <td class="num">${m.weight!=null?r1(m.weight):'—'}</td>
        ${MEASURE_PARTS.map(([k])=>`<td class="num">${m[k]!=null?r1(m[k]):'—'}</td>`).join('')}
        <td style="white-space:normal;color:var(--muted)">${esc(m.notes||'')}</td>
        <td><button class="btn sm danger" data-del-m="${m.date}">✕</button></td>
      </tr>`).join('')||`<tr><td colspan="${MEASURE_PARTS.length+4}"><div class="empty" style="border:0">No measurements yet.</div></td></tr>`}</tbody>
    </table></div>`;

  $('#m-add').onclick=()=>{
    const date=$('#m-date').value||todayISO();
    const rec={date, notes:$('#m-notes').value.trim()};
    let any=false;
    [['weight'],...MEASURE_PARTS].forEach(([k])=>{ const v=parseFloat($('#m-'+k).value); if(!isNaN(v)){rec[k]=v;any=true;} });
    if(!any){ toast('Enter at least one value'); return; }
    state.measures=state.measures.filter(m=>m.date!==date);
    state.measures.push(rec); persist('measures'); toast('Measurement saved'); go('dashboard');
  };
  $('#m-part').onchange=e=>{ measurePart=e.target.value; renderMeasurements(); };
  document.querySelectorAll('[data-del-m]').forEach(b=>b.onclick=()=>{
    state.measures=state.measures.filter(m=>m.date!==b.dataset.delM); persist('measures'); renderMeasurements();
  });
}
function firstVal(list,key){ for(const m of list) if(m[key]!=null) return m[key]; return null; }
function lastVal(list,key){ for(let i=list.length-1;i>=0;i--) if(list[i][key]!=null) return list[i][key]; return null; }

/* ============================================================
   VIEW: DIARY
   ============================================================ */
const MOOD_COLORS=['#f43f5e','#f97316','#f59e0b','#eab308','#a3e635','#84cc16','#4ade80','#22c55e','#4f9d6a','#06b6d4'];
let diaryQuery='';
function renderDiary(){
  let list=[...state.diary].sort((a,b)=>a.date<b.date?1:-1);
  if(diaryQuery){
    const q=diaryQuery.toLowerCase();
    list=list.filter(d=>(d.content||'').toLowerCase().includes(q)||(d.tags||[]).some(t=>t.toLowerCase().includes(q)));
  }
  const logged=state.diary.length, days=Math.max(1,daysBetween(state.settings.startDate,todayISO())+1);

  main().innerHTML=`
    <div class="page-head"><div><h1>Daily Diary</h1><div class="sub">${logged} entries logged · one note per day</div></div></div>

    <div class="card">
      <div class="section-title" style="margin:0 0 12px">Today's note</div>
      <div class="form">
        <div class="field"><label>Date</label><input type="date" id="d-date" value="${todayISO()}"></div>
        <div class="field"><label>Mood / energy <span id="d-moodval" class="faint">5</span>/10</label>
          <input type="range" id="d-mood" min="1" max="10" value="5"></div>
        <div class="field" style="grid-column:1/-1"><label>Note</label><textarea id="d-content" placeholder="How did today go? Adherence, energy, training, cravings…"></textarea></div>
        <div class="field" style="grid-column:1/-1"><label>Tags (comma separated)</label><input id="d-tags" placeholder="motivated, sore, cheat-meal, sleep-poor"></div>
      </div>
      <div class="form-actions"><button class="btn primary" id="d-add">Save entry</button></div>
    </div>

    <div class="row-between" style="margin:22px 0 12px">
      <div class="section-title" style="margin:0">Timeline</div>
      <input id="d-search" class="field" style="max-width:220px;padding:8px 11px;background:var(--bg);border:1px solid var(--line2);border-radius:10px;color:var(--txt)" placeholder="Search notes / tags…" value="${esc(diaryQuery)}">
    </div>

    <div class="timeline">
      ${list.length? list.map(d=>`
        <div class="diary-card">
          <div class="dh">
            <span class="ddate">${fmtLong(d.date)}</span>
            <span class="dmood">${d.mood?`<span class="mood-dot" style="background:${MOOD_COLORS[d.mood-1]}"></span>mood ${d.mood}/10`:''}
              <button class="btn sm danger" style="margin-left:8px" data-del-d="${d.date}">✕</button></span>
          </div>
          <div class="dbody">${esc(d.content||'')}</div>
          ${(d.tags&&d.tags.length)?`<div class="tags">${d.tags.map(t=>`<span class="tag">#${esc(t)}</span>`).join('')}</div>`:''}
        </div>`).join('')
      : `<div class="empty">${diaryQuery?'No entries match.':'No diary entries yet — write your first above.'}</div>`}
    </div>`;

  const mood=$('#d-mood'); mood.oninput=()=>$('#d-moodval').textContent=mood.value;
  $('#d-add').onclick=()=>{
    const content=$('#d-content').value.trim();
    if(!content){ toast('Write something first'); return; }
    const date=$('#d-date').value||todayISO();
    const tags=$('#d-tags').value.split(',').map(t=>t.trim().replace(/^#/,'')).filter(Boolean);
    state.diary=state.diary.filter(d=>d.date!==date);
    state.diary.push({date, content, mood:+mood.value, tags});
    persist('diary'); toast('Entry saved'); go('dashboard');
  };
  const sb=$('#d-search'); sb.oninput=()=>{ diaryQuery=sb.value; const pos=sb.selectionStart; renderDiary(); const n=$('#d-search'); n.focus(); n.setSelectionRange(pos,pos); };
  document.querySelectorAll('[data-del-d]').forEach(b=>b.onclick=()=>{
    state.diary=state.diary.filter(d=>d.date!==b.dataset.delD); persist('diary'); renderDiary();
  });
}

/* ============================================================
   VIEW: PROJECTION
   ============================================================ */
let projFilter='all';
function renderProjection(){
  const s=state.settings, gp=goalProjection();
  let rows=projectionTable();
  const cur=currentWeekIndex();
  if(projFilter!=='all') rows=rows.filter(r=>r.phase.toLowerCase()===projFilter);

  main().innerHTML=`
    <div class="page-head"><div><h1>Goal Projection</h1><div class="sub">${s.dailyDeficit} kcal/day deficit · maintenance every ${s.deficitWeeksPerBlock+1}th week</div></div></div>

    <div class="grid cards">
      <div class="card metric"><div class="k">Remaining to lose</div><div class="v">${r1(Math.max(0,currentWeight()-s.goalWeight))}<small>${u()}</small></div></div>
      <div class="card metric"><div class="k">Deficit weeks needed</div><div class="v">${r0(gp.deficitWeeks)}</div></div>
      <div class="card metric"><div class="k">Calendar weeks (incl. breaks)</div><div class="v">${r0(gp.calWeeks)}</div></div>
      <div class="card metric hl"><div class="k">Projected goal date</div><div class="v" style="font-size:22px">${gp.reached?'Reached 🎉':fmtDate(gp.goalDate,{month:'short',day:'numeric',year:'numeric'})}</div><div class="d">${gp.reached?'':'± 2 weeks · real-world factors vary'}</div></div>
    </div>

    <div class="card chart-card" style="margin-top:18px">
      <div class="section-title" style="margin:0 0 10px">Projected path</div>
      ${lineChart([
        {points:weightSeries().map(w=>({x:w.date,y:w.avg})), color:'#e8923b', width:2.2, dots:true, dotR:2.2, dotColor:'#e8923b'},
        {points:projectionTable().map(r=>({x:r.date,y:r.wt})), color:'#4f9d6a', width:2.6, fill:true, dashed:false, dots:true, dotR:2},
      ], {goal:s.goalWeight, h:240})}
      <div class="chart-legend"><span><i style="background:#4f9d6a"></i>Projected</span><span><i style="background:#e8923b"></i>Actual avg</span><span><i style="background:#3f7d54"></i>Goal</span></div>
      <div class="faint" style="font-size:12px;margin-top:8px">Projection starts from your current 7-day average. Flat spots are maintenance (refeed) weeks.</div>
    </div>

    <div class="row-between" style="margin:22px 0 12px">
      <div class="section-title" style="margin:0">Week-by-week</div>
      <div class="range-tabs" id="p-filter">
        ${[['all','All'],['deficit','Deficit'],['maintenance','Maintenance'],['goal','Goal']].map(([k,l])=>`<button data-f="${k}" class="${k===projFilter?'on':''}">${l}</button>`).join('')}
      </div>
    </div>

    <div class="table-wrap"><table>
      <thead><tr><th>Wk</th><th>Date</th><th class="num">Proj wt</th><th class="num">Maint kcal</th><th class="num">Intake kcal</th><th>Phase</th></tr></thead>
      <tbody>${rows.map(r=>`<tr class="${r.w===cur?'now':''}">
        <td>${r.w}</td>
        <td>${fmtDate(r.date,{month:'short',day:'numeric',year:'numeric'})}</td>
        <td class="num">${r1(r.wt)}</td>
        <td class="num">${r0(r.maint)}</td>
        <td class="num">${r0(r.intake)}</td>
        <td><span class="pill ${r.phase==='Deficit'?'def':r.phase==='Maintenance'?'maint':'goal'}">${r.phase}</span></td>
      </tr>`).join('')}</tbody>
    </table></div>

    <div class="form-actions" style="margin-top:16px"><button class="btn" id="p-csv">⬇ Export CSV</button></div>`;

  $('#p-filter').querySelectorAll('button').forEach(b=>b.onclick=()=>{projFilter=b.dataset.f;renderProjection();});
  $('#p-csv').onclick=exportProjectionCSV;
}
function exportProjectionCSV(){
  const rows=projectionTable();
  const head='Week,Date,Projected weight (kg),Maintenance kcal,Intake kcal,Phase';
  const body=rows.map(r=>[r.w,r.date,r1(r.wt),r0(r.maint),r0(r.intake),r.phase].join(',')).join('\n');
  download('projection.csv', head+'\n'+body);
}
function download(name,text){
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([text],{type:'text/plain'}));
  a.download=name; a.click(); URL.revokeObjectURL(a.href);
}

/* ============================================================
   VIEW: SETTINGS
   ============================================================ */
function renderSettings(){
  const s=state.settings;
  const F=(id,label,val,attrs='',hint='')=>`<div class="field"><label>${label}</label><input id="${id}" value="${val??''}" ${attrs}>${hint?`<span class="hint">${hint}</span>`:''}</div>`;

  main().innerHTML=`
    <div class="page-head"><div><h1>Settings</h1><div class="sub">Everything on the dashboard flows from these numbers</div></div></div>

    <div class="card">
      <div class="section-title" style="margin:0 0 12px">Profile</div>
      <div class="form">
        ${F('s-name','Name',esc(s.name),'type="text"')}
        <div class="field"><label>Gender (for BMR)</label><select id="s-gender"><option value="female" ${s.gender==='female'?'selected':''}>Female (−161)</option><option value="male" ${s.gender==='male'?'selected':''}>Male (+5)</option></select></div>
        ${F('s-height','Height (cm)',s.height,'type="number" step="0.1"')}
        ${F('s-age','Age (yrs)',s.age,'type="number"')}
        <div class="field"><label>Units</label><select id="s-units"><option value="kg" ${s.units==='kg'?'selected':''}>kg</option><option value="lbs" ${s.units==='lbs'?'selected':''}>lbs</option></select></div>
      </div>
    </div>

    <div class="card" style="margin-top:18px">
      <div class="section-title" style="margin:0 0 12px">Goal & deficit</div>
      <div class="form">
        ${F('s-start','Start weight ('+u()+')',s.startWeight,'type="number" step="0.1"')}
        ${F('s-goal','Goal weight ('+u()+')',s.goalWeight,'type="number" step="0.1"')}
        ${F('s-mult','Activity multiplier',s.activityMultiplier,'type="number" step="0.005"','e.g. 1.675 = sedentary + exercise')}
        ${F('s-deficit','Daily deficit (kcal)',s.dailyDeficit,'type="number" step="50"','range 500–1000')}
        ${F('s-block','Deficit weeks per block',s.deficitWeeksPerBlock,'type="number" min="1" max="8"','maintenance every N+1th week')}
        ${F('s-startdate','Start date',s.startDate,'type="date"')}
      </div>
      <div class="form-actions"><button class="btn primary" id="s-save">Save settings</button></div>
    </div>

    <div class="card" style="margin-top:18px">
      <div class="section-title" style="margin:0 0 12px">Milestone targets</div>
      <div class="form">
        ${F('s-wmsstart','Weight milestone start ('+u()+')',s.weightMsStart,'type="number" step="0.1"','top of the 10 weight milestones')}
        ${F('s-wmsgoal','Weight milestone goal ('+u()+')',s.weightMsGoal,'type="number" step="0.1"','bottom of the 10 weight milestones')}
        ${F('s-waiststart','Waist start (cm)',s.waistStart,'type="number" step="0.1"','your first/baseline waist')}
        ${F('s-waistgoal','Waist goal (cm)',s.waistGoal,'type="number" step="0.1"','target for the 10 waist milestones')}
      </div>
      <div class="hint" style="margin-top:8px">10 even steps each. Both tracks auto-tick as you progress.</div>
      <div class="form-actions"><button class="btn primary" id="s-save2">Save targets</button></div>
    </div>

    <div class="card" style="margin-top:18px">
      <div class="section-title" style="margin:0 0 12px">Data & privacy</div>
      <div class="muted" style="font-size:13.5px;margin-bottom:14px">All data is stored locally in your browser (localStorage). Nothing is uploaded or shared.</div>
      <div class="form-actions">
        <button class="btn" id="s-export">⬇ Export all data (JSON)</button>
        <label class="btn ghost" style="cursor:pointer">⬆ Import<input type="file" id="s-import" accept="application/json" hidden></label>
        <button class="btn danger" id="s-reset">Delete all data</button>
      </div>
    </div>`;

  $('#s-save').onclick=()=>{
    Object.assign(state.settings,{
      name:$('#s-name').value.trim(),
      gender:$('#s-gender').value,
      height:parseFloat($('#s-height').value)||s.height,
      age:parseInt($('#s-age').value)||s.age,
      units:$('#s-units').value,
      startWeight:parseFloat($('#s-start').value)||s.startWeight,
      goalWeight:parseFloat($('#s-goal').value)||s.goalWeight,
      activityMultiplier:parseFloat($('#s-mult').value)||s.activityMultiplier,
      dailyDeficit:parseFloat($('#s-deficit').value)||s.dailyDeficit,
      deficitWeeksPerBlock:parseInt($('#s-block').value)||s.deficitWeeksPerBlock,
      startDate:$('#s-startdate').value||s.startDate,
    });
    persist('settings'); toast('Settings saved'); renderSettings();
  };
  $('#s-save2').onclick=()=>{
    state.settings.weightMsStart=parseFloat($('#s-wmsstart').value)||s.weightMsStart;
    state.settings.weightMsGoal=parseFloat($('#s-wmsgoal').value)||s.weightMsGoal;
    state.settings.waistStart=parseFloat($('#s-waiststart').value)||s.waistStart;
    state.settings.waistGoal=parseFloat($('#s-waistgoal').value)||s.waistGoal;
    persist('settings'); toast('Targets saved'); renderSettings();
  };
  $('#s-export').onclick=()=>download('fat-loss-tracker-backup.json', JSON.stringify(state,null,2));
  $('#s-import').onchange=e=>{
    const f=e.target.files[0]; if(!f)return;
    const rd=new FileReader();
    rd.onload=()=>{ try{
      const o=JSON.parse(rd.result);
      ['settings','weights','activity','measures','diary'].forEach(k=>{ if(o[k]!=null){ state[k]=o[k]; persist(k); } });
      toast('Data imported'); go('dashboard');
    }catch(err){ toast('Invalid file'); } };
    rd.readAsText(f);
  };
  $('#s-reset').onclick=()=>{
    if(!confirm('Delete ALL tracked data? This cannot be undone.')) return;
    ['settings','weights','activity','measures','diary'].forEach(k=>localStorage.removeItem('flt_'+k));
    state={ settings:seedFirstRun(), weights:[], activity:{}, measures:[], diary:[] };
    toast('All data deleted'); go('dashboard');
  };
}

/* ============================================================
   VIEW: MILESTONES  (gamified — 10 weight + 10 waist)
   ============================================================ */
function renderMilestones(){
  const s=state.settings, g=gameStats();
  const wms=weightMilestones(), wams=waistMilestones();
  const cw=currentWeight(), waist=latestWaist();

  const msRow=(m,unit,extra)=>{
    const rightDone=`<span class="mright">✓ done</span>`;
    const rightLock=`<span class="mright locked">${m.target}${unit}</span>`;
    return `<div class="ms ${m.reached?'reached':''}">
      <div class="badge">${m.reached?'✓':m.i}</div>
      <div class="body">
        <div class="mtitle">${m.target} ${unit==='kg'?u():'cm'}</div>
        <div class="msub">Milestone ${m.i} of 10${extra||''}</div>
        ${m.reached?'':`<div class="mbar"><i style="width:${r0((m.pct||0)*100)}%"></i></div>`}
      </div>
      ${m.reached?rightDone:rightLock}
    </div>`;
  };

  const wReached=wms.filter(m=>m.reached).length;
  const waReached=wams.filter(m=>m.reached).length;

  main().innerHTML=`
    <div class="page-head"><h1>Milestones</h1><div class="sub">Small wins on the way to your goal — each one earns XP</div></div>

    <div class="xp-hero">
      <div class="lv"><b>${g.level}</b><span>LEVEL</span></div>
      <div class="xi">
        <div class="xtop"><span class="xt">${g.total} XP</span><span class="xn">${g.into}/${g.per} to LV${g.level+1}</span></div>
        <div class="bar"><i style="width:${r0(g.into/g.per*100)}%"></i></div>
        <div class="xn" style="margin-top:8px">🏆 ${g.msReached} milestones reached</div>
      </div>
    </div>

    <div class="row-between" style="margin:22px 0 11px">
      <div class="section-title" style="margin:0">⚖ Weight milestones</div>
      <span class="mono" style="font-size:11px;color:var(--muted)">${wReached}/10</span>
    </div>
    <div class="ms-list">${wms.map(m=>msRow(m,'kg')).join('')}</div>

    <div class="row-between" style="margin:26px 0 11px">
      <div class="section-title" style="margin:0">📏 Waist milestones</div>
      <span class="mono" style="font-size:11px;color:var(--muted)">${waReached}/10</span>
    </div>
    ${waist==null?`<div class="empty">Log a waist measurement to start tracking these. Target & start are set in <b>Settings</b>.</div>`:''}
    <div class="ms-list">${wams.map(m=>msRow(m,'cm')).join('')}</div>

    <div class="note" style="margin-top:18px">Weight milestones are 10 even steps from <b>${r1(s.weightMsStart)}</b> → <b>${r1(s.weightMsGoal)} ${u()}</b>; waist from <b>${r1(s.waistStart)}</b> → <b>${r1(s.waistGoal)} cm</b>. They tick automatically as your 7-day average (currently ${r1(cw)} ${u()}${waist!=null?', waist '+r1(waist)+' cm':''}) drops. Adjust targets in Settings.</div>`;
}

/* ============================================================
   VIEW: WORKOUTS  (weekly split · tick to complete · admin edit)
   ============================================================ */
let woDay = DAY_KEYS[new Date().getDay()];  // today's weekday key (Sun=0)
let woEdit = false;
let woAdmin = false;
let woSwap = false, woSwapFrom = null;   // tap-to-swap (mobile-friendly)
let woHistory = false;
function woWeekStart(){ const d=parseISO(todayISO()); d.setDate(d.getDate()-d.getDay()); return isoOf(d); } // Sunday anchor
function woDateFor(dayKey){ return addDays(woWeekStart(), DAY_KEYS.indexOf(dayKey)); }
function reloadWorkouts(){ state.workouts=DB.load('workouts',defaultWorkouts()); if(!state.workouts.defaults) state.workouts.defaults=clone(state.workouts.plan); }

function renderWorkouts(){
  const plan=state.workouts.plan;
  const todayKey=DAY_KEYS[new Date().getDay()];
  const w=plan[woDay];
  const date=woDateFor(woDay);
  const done=!!state.workouts.log[date];

  const tabs=DAY_KEYS.map(k=>{
    const d=plan[k], isSel=k===woDay, isToday=k===todayKey, dDone=!!state.workouts.log[woDateFor(k)];
    return `<button class="wo-tab ${isSel?'sel':''} ${isToday?'today':''} ${k===woSwapFrom?'swapsrc':''}" data-woday="${k}" draggable="true">
      <span class="wd">${k[0]}</span><span class="ws">${esc(d.split)}</span>
      ${dDone?'<span class="wdone">✓</span>':''}
    </button>`;
  }).join('');

  const doneCount=DAY_KEYS.filter(k=>state.workouts.log[woDateFor(k)]).length;

  main().innerHTML=`
    <div class="page-head"><div><h1>Workouts</h1><div class="sub">${woAdmin?'Admin · set the default workout for each day':'Your weekly split · '+doneCount+'/7 done this week'}</div></div></div>
    <div class="wo-controls">
      ${woAdmin
        ? `<span class="mono" style="font-size:11px;color:var(--amber)">editing defaults</span><button class="btn sm" id="wo-admin-done">✓ Done</button>`
        : woSwap
          ? `<span class="faint" style="font-size:12px">${woSwapFrom?'Tap another day to swap with '+woSwapFrom:'Tap two days to swap'}</span><button class="btn sm" id="wo-swap-cancel">Cancel</button>`
          : `<span style="display:flex;gap:7px;flex-wrap:wrap"><button class="btn sm" id="wo-swap">⇄ Swap</button><button class="btn sm" id="wo-admin">⚙ Defaults</button><button class="btn sm" id="wo-reset">↺ Reset</button><button class="btn sm ${woHistory?'primary':''}" id="wo-history">📋 History</button></span>`}
    </div>
    <div class="wo-tabs">${tabs}</div>
    ${woAdmin ? woEditCard(woDay, state.workouts.defaults[woDay], true)
      : woHistory ? woHistoryCard()
      : (woEdit ? woEditCard(woDay,w) : woViewCard(woDay,w,date,done,todayKey))}`;

  bindWorkouts();
}

function woHistoryCard(){
  const log=state.workouts.log;
  const entries=Object.keys(log).sort((a,b)=>b.localeCompare(a)); // newest first
  if(!entries.length) return `<div class="wo-card"><div class="empty">No completed workouts yet.</div></div>`;
  const rows=entries.map(date=>{
    const dayKey=DAY_KEYS[parseISO(date).getDay()];
    const title=state.workouts.plan[dayKey]?.title||dayKey;
    const split=state.workouts.plan[dayKey]?.split||'';
    return `<div class="lrow" style="border-bottom:1px solid var(--line);padding:10px 4px">
      <span class="lname" style="display:flex;flex-direction:column;gap:2px">
        <span style="font-size:14px;font-weight:600">${esc(title)}</span>
        <span style="font-size:11px;color:var(--muted);font-family:var(--mono);text-transform:uppercase;letter-spacing:.05em">${esc(split)} · ${dayKey}</span>
      </span>
      <span class="lval done">${fmtDate(date,{weekday:'short',month:'short',day:'numeric',year:'numeric'})}</span>
    </div>`;
  }).join('');
  return `<div class="wo-card">
    <div class="wo-head" style="margin-bottom:8px">
      <span class="wo-title">Completed Workouts</span>
      <span class="mono" style="font-size:11px;color:var(--muted)">${entries.length} total</span>
    </div>
    ${rows}
  </div>`;
}

function woViewCard(dayKey,w,date,done,todayKey){
  const tags=(w.tags||[]).map(t=>`<span class="wtag">${esc(t)}</span>`).join('');
  const ex=(w.exercises||[]).map((e,i)=>`
    <div class="wo-ex">
      <span class="wo-num">${String(i+1).padStart(2,'0')}</span>
      <div class="wo-exbody">
        <div class="wo-exname">${esc(e.name)}</div>
        ${e.note?`<div class="wo-exnote">${esc(e.note)}</div>`:''}
      </div>
      <span class="wo-scheme">${esc(e.scheme||'')}</span>
    </div>`).join('') || `<div class="empty" style="border:0">No exercises yet — tap Edit to add some.</div>`;
  const isToday=dayKey===todayKey;
  return `
    <div class="card wo-card ${done?'is-done':''}">
      <div class="wo-head">
        <div>
          <div class="mono wo-split">${esc(w.split)}${isToday?' · today':''} · ${fmtDate(date,{weekday:'short',month:'short',day:'numeric'})}</div>
          <h2 class="wo-title">${esc(w.title)}</h2>
          <div class="wo-tags">${tags}</div>
        </div>
        <button class="wo-edit-btn" data-wo-edit title="Admin: edit this day">✎ Edit</button>
      </div>
      <div class="wo-exlist">${ex}</div>
      <div class="wo-foot">
        <label class="wo-check ${done?'on':''}">
          <input type="checkbox" id="wo-tick" ${done?'checked':''}>
          <span class="wo-box">${done?'✓':''}</span>
          <span class="wo-checklbl">${done?'Completed — nice work!':'Mark workout complete'}</span>
        </label>
        ${done?`<button class="btn sm" id="wo-undo">Undo</button>`:''}
      </div>
    </div>`;
}

function woEditCard(dayKey,w,isDefault){
  const exRows=(w.exercises||[]).map((e,i)=>`
    <div class="wo-erow" data-erow="${i}">
      <input class="we-name" placeholder="Exercise" value="${esc(e.name)}">
      <input class="we-scheme" placeholder="3x12" value="${esc(e.scheme||'')}">
      <input class="we-note" placeholder="Note (optional)" value="${esc(e.note||'')}">
      <button class="btn sm danger" data-erm="${i}">✕</button>
    </div>`).join('');
  return `
    <div class="card wo-edit">
      <div class="row-between" style="margin-bottom:12px">
        <div class="section-title" style="margin:0">${isDefault?'Default for '+esc(dayKey):'Edit '+esc(dayKey)+' · admin'}</div>
        <span class="mono" style="font-size:11px;color:var(--amber)">${isDefault?'default':'editing'}</span>
      </div>
      <div class="form">
        <div class="field"><label>Workout title</label><input id="we-title" value="${esc(w.title)}"></div>
        <div class="field"><label>Split label</label><input id="we-split" value="${esc(w.split)}"></div>
        <div class="field" style="grid-column:1/-1"><label>Tags (comma separated)</label><input id="we-tags" value="${esc((w.tags||[]).join(', '))}"></div>
      </div>
      <div class="section-title" style="margin:16px 0 8px">Exercises</div>
      <div class="wo-erows">${exRows||'<div class="faint" style="font-size:13px">No exercises yet.</div>'}</div>
      <button class="btn sm" id="we-add" style="margin-top:10px">+ Add exercise</button>
      <div class="form-actions" style="margin-top:16px">
        <button class="btn primary" id="we-save">${isDefault?'Save default':'Save changes'}</button>
        <button class="btn ghost" id="we-cancel">Cancel</button>
      </div>
    </div>`;
}

function collectEditWorkout(w){
  if($('#we-title')) w.title=$('#we-title').value.trim()||w.title;
  if($('#we-split')) w.split=($('#we-split').value.trim()||w.split).toUpperCase();
  if($('#we-tags')) w.tags=$('#we-tags').value.split(',').map(t=>t.trim()).filter(Boolean);
  document.querySelectorAll('[data-erow]').forEach(row=>{
    const i=+row.dataset.erow; if(!w.exercises[i]) return;
    w.exercises[i].name=row.querySelector('.we-name').value.trim();
    w.exercises[i].scheme=row.querySelector('.we-scheme').value.trim();
    w.exercises[i].note=row.querySelector('.we-note').value.trim();
  });
}

let _dragKey=null;
// save whatever is currently in the editor inputs (used before leaving a day / view)
function saveEditorIfOpen(){
  if(!(woEdit||woAdmin)) return;
  const isDef=woAdmin;
  const target=isDef ? state.workouts.defaults[woDay] : state.workouts.plan[woDay];
  if(!document.getElementById('we-title')) return;
  collectEditWorkout(target);
  target.exercises=target.exercises.filter(e=>e.name);
  if(isDef) state.workouts.plan[woDay]=clone(target);   // apply default to the live week too
  persist('workouts');
}
function swapDays(a,b){
  const p=state.workouts.plan, t=p[a]; p[a]=p[b]; p[b]=t; persist('workouts');
}
function bindWorkouts(){
  document.querySelectorAll('[data-woday]').forEach(b=>b.onclick=()=>{
    const k=b.dataset.woday;
    if(woSwap){                                  // tap-to-swap mode
      if(!woSwapFrom){ woSwapFrom=k; }
      else if(woSwapFrom!==k){ swapDays(woSwapFrom,k); toast(`Swapped ${woSwapFrom} ↔ ${k}`); woDay=k; woSwap=false; woSwapFrom=null; }
      else { woSwapFrom=null; }
      renderWorkouts(); return;
    }
    saveEditorIfOpen(); woDay=k; if(!woAdmin) woEdit=false; renderWorkouts();
  });
  const editBtn=document.querySelector('[data-wo-edit]'); if(editBtn) editBtn.onclick=()=>{ woEdit=true; renderWorkouts(); };
  const swapBtn=$('#wo-swap'); if(swapBtn) swapBtn.onclick=()=>{ woSwap=true; woSwapFrom=null; renderWorkouts(); };
  const swapCancel=$('#wo-swap-cancel'); if(swapCancel) swapCancel.onclick=()=>{ woSwap=false; woSwapFrom=null; renderWorkouts(); };

  // reset weekly plan to the saved defaults
  const resetBtn=$('#wo-reset');
  if(resetBtn) resetBtn.onclick=()=>{
    confirmModal('Reset this week to your default workouts? Any swaps or edits to the current week will be replaced.',
      ()=>{ state.workouts.plan=clone(state.workouts.defaults); persist('workouts'); toast('Reset to default'); renderWorkouts(); });
  };
  // enter / leave the defaults admin view
  const adminBtn=$('#wo-admin'); if(adminBtn) adminBtn.onclick=()=>{ woAdmin=true; woEdit=false; woHistory=false; renderWorkouts(); };
  const adminDone=$('#wo-admin-done'); if(adminDone) adminDone.onclick=()=>{ saveEditorIfOpen(); woAdmin=false; toast('Defaults saved'); renderWorkouts(); };
  const histBtn=$('#wo-history'); if(histBtn) histBtn.onclick=()=>{ woHistory=!woHistory; woEdit=false; woAdmin=false; renderWorkouts(); };

  // drag a day onto another to swap their workouts
  document.querySelectorAll('.wo-tab').forEach(tab=>{
    tab.addEventListener('dragstart',e=>{ _dragKey=tab.dataset.woday; e.dataTransfer.effectAllowed='move'; tab.classList.add('dragging'); });
    tab.addEventListener('dragend',()=>{ tab.classList.remove('dragging'); document.querySelectorAll('.wo-tab').forEach(t=>t.classList.remove('dragover')); });
    tab.addEventListener('dragover',e=>{ e.preventDefault(); tab.classList.add('dragover'); });
    tab.addEventListener('dragleave',()=>tab.classList.remove('dragover'));
    tab.addEventListener('drop',e=>{
      e.preventDefault();
      const to=tab.dataset.woday;
      if(_dragKey && to && _dragKey!==to){
        const p=state.workouts.plan, tmp=p[_dragKey]; p[_dragKey]=p[to]; p[to]=tmp;
        persist('workouts'); woDay=to; toast(`Swapped ${_dragKey} ↔ ${to}`); renderWorkouts();
      }
      _dragKey=null;
    });
  });

  const tick=$('#wo-tick');
  if(tick) tick.onchange=()=>{
    if(!tick.checked) return;
    const w=state.workouts.plan[woDay], date=woDateFor(woDay);
    confirmModal(`Mark “${w.title}” as complete for ${fmtDate(date,{weekday:'short',month:'short',day:'numeric'})}?`,
      ()=>{ state.workouts.log[date]=true; persist('workouts'); renderWorkouts(); congrats(w.title); },
      ()=>{ renderWorkouts(); });
  };
  const undo=$('#wo-undo'); if(undo) undo.onclick=()=>{ delete state.workouts.log[woDateFor(woDay)]; persist('workouts'); renderWorkouts(); };

  if(woEdit || woAdmin){
    const isDef=woAdmin;
    const target=isDef ? state.workouts.defaults[woDay] : state.workouts.plan[woDay];
    $('#we-add').onclick=()=>{ collectEditWorkout(target); target.exercises.push({name:'',scheme:'',note:''}); renderWorkouts(); };
    document.querySelectorAll('[data-erm]').forEach(b=>b.onclick=()=>{ collectEditWorkout(target); target.exercises.splice(+b.dataset.erm,1); renderWorkouts(); });
    $('#we-save').onclick=()=>{ collectEditWorkout(target); target.exercises=target.exercises.filter(e=>e.name); if(isDef) state.workouts.plan[woDay]=clone(target); persist('workouts'); if(!isDef) woEdit=false; toast(isDef?'Default saved & applied':'Workout updated'); renderWorkouts(); };
    $('#we-cancel').onclick=()=>{ reloadWorkouts(); if(!isDef) woEdit=false; renderWorkouts(); };
  }
}

/* confirmation dialog */
function confirmModal(msg,onYes,onNo){
  const ov=document.createElement('div'); ov.className='modal-ov';
  ov.innerHTML=`<div class="modal">
    <div class="modal-icon">💪</div>
    <div class="modal-msg">${esc(msg)}</div>
    <div class="modal-actions">
      <button class="btn ghost" data-no>Cancel</button>
      <button class="btn primary" data-yes>Confirm</button>
    </div></div>`;
  document.body.appendChild(ov);
  requestAnimationFrame(()=>ov.classList.add('show'));
  const close=()=>{ ov.classList.remove('show'); setTimeout(()=>ov.remove(),200); };
  ov.querySelector('[data-yes]').onclick=()=>{ close(); onYes&&onYes(); };
  ov.querySelector('[data-no]').onclick=()=>{ close(); onNo&&onNo(); };
  ov.onclick=e=>{ if(e.target===ov){ close(); onNo&&onNo(); } };
}

/* congratulations animation */
function congrats(title){
  const ov=document.createElement('div'); ov.className='congrats-ov';
  const colors=['#e8923b','#5aa06f','#9b7bd0','#d05c5c','#f0a04b','#5b86c4'];
  let confetti='';
  for(let i=0;i<70;i++){
    const left=Math.random()*100, delay=(Math.random()*0.5).toFixed(2), dur=(1.7+Math.random()*1.5).toFixed(2);
    const c=colors[i%colors.length], rot=Math.floor(Math.random()*360), sz=(6+Math.random()*7).toFixed(1);
    confetti+=`<i style="left:${left}%;background:${c};width:${sz}px;height:${(sz*0.5).toFixed(1)}px;animation-delay:${delay}s;animation-duration:${dur}s;--rot:${rot}deg"></i>`;
  }
  ov.innerHTML=`<div class="confetti">${confetti}</div>
    <div class="congrats-card">
      <div class="cg-emoji">🎉</div>
      <div class="cg-title">Workout Complete!</div>
      <div class="cg-sub">${esc(title)} — crushed it 💪</div>
      <div class="cg-xp">+${XP.workout} XP</div>
    </div>`;
  document.body.appendChild(ov);
  requestAnimationFrame(()=>ov.classList.add('show'));
  const done=()=>{ ov.classList.remove('show'); setTimeout(()=>ov.remove(),300); };
  ov.onclick=done; setTimeout(done,2800);
}

/* ---------- avatar: strip white background (edge flood-fill → transparent) ---------- */
let _charCache=null;            // processed dataURL, computed once per session
function processAvatar(){
  const img=document.getElementById('charImg');
  if(!img) return;
  if(_charCache){ img.src=_charCache; return; }   // reuse already-processed result
  const run=()=>{
    const w=img.naturalWidth, h=img.naturalHeight;
    if(!w||!h) return;
    try{
      const c=document.createElement('canvas'); c.width=w; c.height=h;
      const ctx=c.getContext('2d'); ctx.drawImage(img,0,0);
      const id=ctx.getImageData(0,0,w,h), D=id.data;
      const near=i=>D[i]>205&&D[i+1]>205&&D[i+2]>205;    // near-white test (catches the halo)
      const cleared=new Uint8Array(w*h);
      const seen=new Uint8Array(w*h), stack=[];
      const push=(x,y)=>{ if(x<0||y<0||x>=w||y>=h)return; const p=y*w+x; if(seen[p])return; seen[p]=1; stack.push(p); };
      for(let x=0;x<w;x++){ push(x,0); push(x,h-1); }    // seed from all four edges
      for(let y=0;y<h;y++){ push(0,y); push(w-1,y); }
      while(stack.length){
        const p=stack.pop(), i=p*4;
        if(!near(i)) continue;                           // stop at the figure's edge
        D[i+3]=0; cleared[p]=1;                           // make transparent
        const x=p%w, y=(p/w)|0;
        push(x+1,y); push(x-1,y); push(x,y+1); push(x,y-1);
      }
      // feather: any still-light pixel touching transparency gets partial alpha → soft edge, no hard fringe
      for(let y=0;y<h;y++) for(let x=0;x<w;x++){
        const p=y*w+x, i=p*4;
        if(cleared[p]||D[i+3]===0) continue;
        const bright=(D[i]+D[i+1]+D[i+2])/3;
        if(bright<190) continue;
        const edge=(x>0&&cleared[p-1])||(x<w-1&&cleared[p+1])||(y>0&&cleared[p-w])||(y<h-1&&cleared[p+w]);
        if(edge) D[i+3]=Math.round(D[i+3]*Math.max(0,(235-bright)/45));
      }
      ctx.putImageData(id,0,0);
      _charCache=c.toDataURL('image/png');
      img.src=_charCache;
    }catch(e){ /* tainted canvas (file://) — leave original image as-is */ }
  };
  if(img.complete && img.naturalWidth) run(); else img.addEventListener('load',run,{once:true});
}

/* ---------- misc binders ---------- */
function bindGo(){ document.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>go(b.dataset.go)); }

/* ---------- boot ---------- */
go('dashboard');

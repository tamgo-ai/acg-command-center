import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.heat';
import { Chart, CategoryScale, LinearScale, BarElement, PointElement, LineElement, ArcElement, Filler, Title, Tooltip, Legend } from 'chart.js';
import { Bar, Line, Doughnut } from 'react-chartjs-2';

Chart.register(CategoryScale,LinearScale,BarElement,PointElement,LineElement,ArcElement,Filler,Title,Tooltip,Legend);

const API = '/crash-intel/api';
const RED = '#dc2626';
const GOLD = '#f59e0b';
const C = [RED,'#3b82f6','#8b5cf6','#06b6d4',GOLD,'#10b981','#ec4899','#f97316','#6366f1','#14b8a6'];
const F = { family:'Inter, system-ui, sans-serif' };
const LOGO = '/crash-intel/logo-acg.png';

// ── Helpers ─────────────────────────────────────────────────────────

const gmaps = (lat,lon) => `https://www.google.com/maps?q=${lat},${lon}`;
function CoordChip({lat,lon}) {
  return <a href={gmaps(lat,lon)} target="_blank" rel="noopener noreferrer"
    className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-white/[0.04] text-slate-400 hover:bg-white/[0.08] transition border border-white/[0.06]">
    📍{lat?.toFixed(3)},{lon?.toFixed(3)}
  </a>;
}

// ── Single fetch hook ───────────────────────────────────────────────

function useDashboard(filters) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const keyRef = useRef(null);

  const qs = Object.entries(filters).filter(([,v])=>v?.length).flatMap(([k,vs])=>vs.map(v=>`${k}=${encodeURIComponent(v)}`)).join('&');

  useEffect(() => {
    const cacheKey = qs || '__default';
    if (cacheKey === keyRef.current) return;
    keyRef.current = cacheKey;
    setLoading(true);
    setData(null);
    const url = qs ? `${API}/dashboard?${qs}` : `${API}/dashboard`;
    fetch(url).then(r=>r.json()).then(d=>{setData(d);setLoading(false);}).catch(e=>{setError(e.message);setLoading(false);});
  }, [qs]);

  return { data, loading, error };
}

function useFilters() {
  const [filters, setFilters] = useState({});
  const [options, setOptions] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch(`${API}/filters`).then(r=>r.json()).then(setOptions).catch(e=>setError(e.message));
  }, []);

  const toggle = (key, val) => setFilters(prev => ({
    ...prev, [key]: prev[key]?.includes(val) ? prev[key].filter(v=>v!==val) : [...(prev[key]||[]), val]
  }));
  const clearAll = () => setFilters({});
  const qs = Object.entries(filters).filter(([,v])=>v?.length).flatMap(([k,vs])=>vs.map(v=>`${k}=${encodeURIComponent(v)}`)).join('&');

  return { filters, options, error, toggle, clearAll, qs, fLoading: !options && !error };
}

// ── KPI ─────────────────────────────────────────────────────────────

function KPI({title,value,color=RED,loading,suffix}) {
  return <div className="relative rounded-2xl p-4 border border-white/[0.06] bg-gradient-to-b from-white/[0.03] to-transparent hover:border-white/[0.1] transition-all duration-300">
    <div className="text-[11px] uppercase tracking-wider text-slate-500 font-medium mb-1.5">{title}</div>
    {loading ? <div className="h-7 w-20 rounded-lg bg-white/[0.03] animate-pulse"/> :
    <div className="text-[26px] font-bold tracking-tight text-white" style={{fontVariantNumeric:'tabular-nums'}}>
      {typeof value === 'number' ? value.toLocaleString() : (value ?? '—')}
      {suffix && <span className="text-xs font-normal text-slate-500 ml-1.5">{suffix}</span>}
    </div>}
  </div>;
}

function Skeleton({h=220}) {
  return <div className="rounded-2xl border border-white/[0.06] bg-white/[0.01] flex items-center justify-center" style={{height:h}}>
    <div className="flex items-center gap-1 text-slate-600 text-sm"><span className="animate-pulse">·</span><span className="animate-pulse" style={{animationDelay:'0.2s'}}>·</span><span className="animate-pulse" style={{animationDelay:'0.4s'}}>·</span></div>
  </div>;
}

// ── Filter Bar ──────────────────────────────────────────────────────

function FilterBar({options,filters,toggle,clearAll}) {
  const [open,setOpen]=useState(null);
  const [pos,setPos]=useState({top:0,left:0});
  const btnRefs=useRef({});
  const ref=useRef(null);

  useEffect(()=>{
    if(!open)return;
    const h=e=>{if(ref.current&&!ref.current.contains(e.target)&&!Object.values(btnRefs.current).some(b=>b?.contains(e.target)))setOpen(null)};
    document.addEventListener('mousedown',h);
    return()=>document.removeEventListener('mousedown',h);
  },[open]);

  if(!options)return null;
  const sections=[{key:'year',label:'Year',opts:options.years||[]},{key:'make',label:'Make',opts:(options.makes||[]).slice(0,42)},{key:'city',label:'City',opts:(options.cities||[]).slice(0,60)},{key:'collision_type',label:'Type',opts:options.collision_types||[]}];
  const active=Object.values(filters).flat().filter(Boolean).length;

  const handleClick=(key,btn)=>{
    if(open===key){setOpen(null);return;}
    const rect=btn.getBoundingClientRect();
    setPos({top:rect.bottom+4,left:rect.left});
    setOpen(key);
  };

  return <div ref={ref} className="px-5 py-2.5 bg-black/30 border-b border-white/[0.04] flex items-center gap-1.5 flex-wrap flex-shrink-0 backdrop-blur-xl" style={{zIndex:99999,position:'relative'}}>
    {sections.map(s=><div key={s.key}>
      <button ref={el=>btnRefs.current[s.key]=el} onClick={(e)=>handleClick(s.key,e.currentTarget)}
        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${filters[s.key]?.length?'bg-white/[0.06] text-white border-white/[0.1]':'text-slate-500 border-transparent hover:bg-white/[0.02]'}`}>{s.label}{filters[s.key]?.length?` (${filters[s.key].length})`:''}</button>
    </div>)}
    {active>0&&<button onClick={clearAll} className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-500 hover:text-white hover:bg-white/[0.03] transition ml-1">Clear</button>}

    {open && createPortal(
      <div ref={ref} className="fixed bg-slate-950 border border-white/[0.1] rounded-xl p-2 max-h-64 overflow-y-auto shadow-2xl shadow-black/90" style={{top:pos.top,left:pos.left,minWidth:190,zIndex:999999,animation:'dropdown-in 0.12s ease-out'}}>
        {sections.find(s=>s.key===open)?.opts.map(o=><label key={o} className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-white/[0.06] rounded-lg cursor-pointer text-xs transition"><input type="checkbox" checked={filters[open]?.includes(o)} onChange={()=>toggle(open,o)} className="rounded accent-red-600"/>{o}</label>)}
      </div>,
      document.body
    )}
  </div>;
}

// ── Map ─────────────────────────────────────────────────────────────

function CrashMap({filters,mapKey}) {
  const containerRef=useRef(null);
  const mapRef=useRef(null);
  const heatRef=useRef(null);
  const debounceRef=useRef(null);

  const loadData=useCallback(()=>{
    const map=mapRef.current;if(!map)return;
    const b=map.getBounds();
    const p=new URLSearchParams();
    Object.entries(filters).filter(([,v])=>v?.length).forEach(([k,vs])=>vs.forEach(v=>p.append(k,v)));
    p.set('lat_min',b.getSouth().toFixed(5));p.set('lat_max',b.getNorth().toFixed(5));
    p.set('lon_min',b.getWest().toFixed(5));p.set('lon_max',b.getEast().toFixed(5));
    p.set('limit','12000');
    fetch(`${API}/heatmap?${p}`).then(r=>r.json()).then(d=>{
      if(heatRef.current)map.removeLayer(heatRef.current);
      if(d.points?.length)heatRef.current=L.heatLayer(d.points.map(p=>[p.lat,p.lon,p.weight]),{
        radius:20,blur:18,maxZoom:14,max:5,
        gradient:{0.15:'#1e40af',0.35:'#3b82f6',0.5:'#8b5cf6',0.65:'#dc2626',0.8:'#f59e0b',0.95:'#ef4444'}
      }).addTo(map);
    }).catch(()=>{});
  },[filters]);

  useEffect(()=>{
    const el=containerRef.current;if(!el)return;
    if(el._leaflet_id)el._leaflet_id=null;
    const m=L.map(el,{attributionControl:false,zoomControl:false}).setView([36.8,-119.4],6);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png',{maxZoom:18}).addTo(m);
    L.control.zoom({position:'bottomright'}).addTo(m);
    mapRef.current=m;
    setTimeout(loadData,50);
    m.on('moveend',()=>{if(debounceRef.current)clearTimeout(debounceRef.current);debounceRef.current=setTimeout(loadData,200);});
    return()=>{if(debounceRef.current)clearTimeout(debounceRef.current);if(mapRef.current){mapRef.current.remove();mapRef.current=null;}};
  },[mapKey]);

  useEffect(()=>{if(mapRef.current)loadData();},[filters]);

  return <div ref={containerRef} className="w-full h-full rounded-2xl"/>;
}

// ── Charts ──────────────────────────────────────────────────────────

function TrendChart({months}) {
  if(!months?.length)return<Skeleton/>;
  return <div className="rounded-2xl border border-white/[0.06] bg-gradient-to-b from-white/[0.02] to-transparent p-5 h-full flex flex-col">
    <h3 className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-3">Monthly Trend</h3>
    <div className="flex-1 min-h-0"><Line data={{labels:months.map(x=>x.month?.substring(5)),datasets:[
      {label:'Crashes',data:months.map(x=>x.crashes),borderColor:RED,borderWidth:2,backgroundColor:'rgba(220,38,38,0.05)',fill:true,tension:0.35,pointRadius:0},
      {label:'Injuries',data:months.map(x=>x.injured),borderColor:GOLD,borderWidth:1.5,backgroundColor:'transparent',tension:0.35,pointRadius:0}
    ]}} options={{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{font:{size:9,...F},color:'#94a3b8',usePointStyle:true,boxWidth:6,padding:12}}},scales:{x:{ticks:{font:{size:8,...F},color:'#64748b',maxTicksLimit:16},grid:{display:false}},y:{ticks:{font:{size:8,...F},color:'#64748b'},grid:{color:'#1e293b',drawBorder:false}}}}}/></div></div>;
}

function TopMakes({makes}) {
  if(!makes?.length)return<Skeleton h={340}/>;
  const m=makes.slice(0,12);
  return <div className="rounded-2xl border border-white/[0.06] bg-gradient-to-b from-white/[0.02] to-transparent p-5 h-full flex flex-col">
    <h3 className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-3">Top Makes</h3>
    <div className="flex-1 min-h-0"><Bar data={{labels:m.map(x=>x.make),datasets:[{data:m.map(x=>x.crash_count),backgroundColor:m.map((_,i)=>C[i%C.length]),borderRadius:3,borderSkipped:false}]}}
      options={{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{ticks:{font:{size:8,...F},color:'#475569'},grid:{color:'#1e293b',drawBorder:false}},y:{ticks:{font:{size:9,...F},color:'#94a3b8'},grid:{display:false}}}}}/></div></div>;
}

function CollisionDonut({types}) {
  if(!types?.length)return<Skeleton h={280}/>;
  const t=types.slice(0,7);
  return <div className="rounded-2xl border border-white/[0.06] bg-gradient-to-b from-white/[0.02] to-transparent p-5 h-full flex flex-col">
    <h3 className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-3">Collision Types</h3>
    <div className="flex-1 min-h-0"><Doughnut data={{labels:t.map(x=>x.collision_type_desc),datasets:[{data:t.map(x=>x.total),backgroundColor:C,borderWidth:0,hoverBorderWidth:2,hoverBorderColor:'#020617'}]}}
      options={{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'right',labels:{font:{size:8,...F},color:'#94a3b8',padding:6,usePointStyle:true,pointStyleWidth:6}}},cutout:'58%'}}/></div></div>;
}

function CityBars({cities}) {
  if(!cities?.length)return<Skeleton h={260}/>;
  const ct=cities.filter(x=>x.city_name!=='Unincorporated').slice(0,10);
  if(!ct.length)return<Skeleton h={260}/>;
  const max=Math.max(...ct.map(x=>x.total_crashes));
  return <div className="rounded-2xl border border-white/[0.06] bg-gradient-to-b from-white/[0.02] to-transparent p-5 h-full flex flex-col">
    <h3 className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-3">Top Cities</h3>
    <div className="flex-1 min-h-0"><Bar data={{labels:ct.map(x=>x.city_name),datasets:[{data:ct.map(x=>x.total_crashes),backgroundColor:ct.map(x=>`rgba(220,38,38,${0.35+(x.total_crashes/max)*0.65})`),borderRadius:3,borderSkipped:false}]}}
      options={{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{ticks:{font:{size:8,...F},color:'#475569'},grid:{color:'#1e293b',drawBorder:false}},y:{ticks:{font:{size:9,...F},color:'#94a3b8'},grid:{display:false}}}}}/></div></div>;
}

function DayHour({days,hours}) {
  if(!days?.length)return<Skeleton h={260}/>;
  return <div className="grid grid-cols-2 gap-3 h-full">
    <div className="rounded-2xl border border-white/[0.06] bg-gradient-to-b from-white/[0.02] to-transparent p-4 flex flex-col">
      <h3 className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Day of Week</h3>
      <div className="flex-1 min-h-0"><Bar data={{labels:days.map(x=>x.day?.substring(0,3)),datasets:[{data:days.map(x=>x.crashes),backgroundColor:'#6366f1',borderRadius:3,borderSkipped:false}]}}
        options={{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{ticks:{font:{size:8,...F},color:'#475569'},grid:{color:'#1e293b',drawBorder:false}},x:{ticks:{font:{size:8,...F},color:'#64748b'},grid:{display:false}}}}}/></div></div>
    <div className="rounded-2xl border border-white/[0.06] bg-gradient-to-b from-white/[0.02] to-transparent p-4 flex flex-col">
      <h3 className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Time of Day</h3>
      <div className="flex-1 min-h-0"><Bar data={{labels:hours.map(x=>`${x.hour}h`),datasets:[{data:hours.map(x=>x.n),backgroundColor:'#06b6d4',borderRadius:3,borderSkipped:false}]}}
        options={{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{ticks:{font:{size:8,...F},color:'#475569'},grid:{color:'#1e293b',drawBorder:false}},x:{ticks:{font:{size:7,...F},color:'#64748b',maxTicksLimit:12},grid:{display:false}}}}}/></div></div>
  </div>;
}

function LuxuryBrands({luxury}) {
  if(!luxury?.length)return<Skeleton h={290}/>;
  const t=luxury.reduce((s,m)=>s+m.crashes,0);
  return <div className="rounded-2xl border border-white/[0.06] bg-gradient-to-b from-white/[0.02] to-transparent p-5 h-full overflow-y-auto">
    <h3 className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-3">Premium Brands — {t.toLocaleString()} incidents</h3>
    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
      {luxury.slice(0,16).map((m,i)=><div key={m.make} className="text-center p-2.5 rounded-xl bg-white/[0.02] hover:bg-white/[0.05] transition border border-white/[0.03]">
        <div className="text-[11px] font-medium text-slate-400 truncate">{m.make}</div>
        <div className="text-lg font-bold mt-0.5 text-white">{m.crashes.toLocaleString()}</div>
        <div className="text-[9px] text-slate-600">{m.at_fault} at fault</div>
      </div>)}
    </div></div>;
}

function Demographics({age_groups}) {
  if(!age_groups?.length)return<Skeleton h={290}/>;
  return <div className="rounded-2xl border border-white/[0.06] bg-gradient-to-b from-white/[0.02] to-transparent p-5 h-full flex flex-col">
    <h3 className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-3">Driver Age</h3>
    <div className="flex-1 min-h-0"><Bar data={{labels:age_groups.map(g=>g.age_group),datasets:[
      {label:'Drivers',data:age_groups.map(g=>g.n),backgroundColor:RED,borderRadius:3,borderSkipped:false},
      {label:'At Fault',data:age_groups.map(g=>g.at_fault),backgroundColor:GOLD,borderRadius:3,borderSkipped:false}
    ]}} options={{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{font:{size:9,...F},color:'#94a3b8',usePointStyle:true,boxWidth:6,padding:12}}},scales:{x:{ticks:{font:{size:8,...F},color:'#64748b'},grid:{display:false}},y:{ticks:{font:{size:8,...F},color:'#475569'},grid:{color:'#1e293b',drawBorder:false}}}}}/></div></div>;
}

// ── Locations ───────────────────────────────────────────────────────

function AcgLocations({filters}) {
  const qs = Object.entries(filters).filter(([,v])=>v?.length).flatMap(([k,vs])=>vs.map(v=>`${k}=${encodeURIComponent(v)}`)).join('&') || 'year=2025';
  const [d,setD] = useState(null);
  const [b,setB] = useState(null);
  useEffect(()=>{
    fetch(`${API}/acg-locations?${qs}`).then(r=>r.json()).then(setD);
    fetch(`${API}/billboard-intel?year=2025&make=BMW`).then(r=>r.json()).then(setB);
  },[qs]);

  if(!d)return<div className="p-6"><Skeleton h={600}/></div>;
  const locs=d.locations||[], roads=b?.roads||[];
  const total=locs.reduce((s,l)=>s+(l.total_crashes||0),0);

  return <div className="p-6 space-y-5">
    <div className="flex items-center justify-between">
      <div><h2 className="text-lg font-bold text-white">Your Repair Centers — {d.year}</h2><p className="text-xs text-slate-500 mt-0.5">Click 📍 for Google Maps</p></div>
      <div className="text-right"><div className="text-[28px] font-bold text-red-400">{total.toLocaleString()}</div><div className="text-[10px] text-slate-500 uppercase tracking-wider">Incidents in ACG Zones</div></div>
    </div>
    <div className="grid grid-cols-2 gap-3">
      {locs.map(l=>{const lux=l.luxury_brands?.slice(0,4)||[],tr=l.top_roads?.[0],pk=l.peak_hours?.[0];
        return <div key={l.name} className="rounded-2xl border border-white/[0.06] bg-gradient-to-b from-white/[0.02] to-transparent p-4 hover:border-white/[0.1] transition">
          <div className="flex items-start justify-between mb-2"><div><div className="flex items-center gap-1.5"><h3 className="text-sm font-bold text-white">{l.name}</h3>{l.lat&&<CoordChip lat={l.lat} lon={l.lon}/>}</div><div className="text-[10px] text-slate-500 mt-0.5">{l.address}</div></div>
          <div className="text-right"><div className="text-xl font-bold text-red-400">{(l.total_crashes||0).toLocaleString()}</div><div className="text-[10px] text-slate-500">{(l.total_injured||0).toLocaleString()} injured</div></div></div>
          <div className="flex gap-1.5 mb-2.5 flex-wrap">{lux.map(b=><span key={b.make} className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/[0.03] text-slate-400 border border-white/[0.05]">{b.make} <span className="text-slate-600">{b.crashes}</span></span>)}</div>
          {tr&&<div className="text-[10px] p-2 rounded-lg bg-white/[0.02] border border-white/[0.04]"><span className="text-amber-400/80 font-medium">Billboard: </span><span className="text-slate-400">{tr.primary_road}</span><span className="text-slate-600"> — {tr.n} crashes</span>{pk&&<span className="text-slate-600 ml-2">Peak: {pk.hour}:00</span>}</div>}
        </div>;
      })}
    </div>
    <div className="rounded-2xl border border-white/[0.06] bg-gradient-to-b from-white/[0.02] to-transparent p-5">
      <h3 className="text-sm font-bold text-white mb-1">Billboard Corridors — BMW (2025)</h3>
      <p className="text-[10px] text-slate-500 mb-3">Highest crash frequency = maximum visibility</p>
      <div className="grid grid-cols-2 gap-2">{roads.slice(0,12).map((r,i)=><div key={i} className="flex items-center justify-between p-2.5 rounded-xl bg-white/[0.02] hover:bg-white/[0.05] transition border border-white/[0.03] text-xs"><div className="flex-1 min-w-0"><div className="flex items-center gap-1.5"><span className="text-slate-300 font-medium truncate">{r.primary_road}</span>{r.lat&&<CoordChip lat={r.lat} lon={r.lon}/>}</div><div className="text-[10px] text-slate-500 mt-0.5">{r.city_name||'California'}</div></div><div className="text-right ml-3"><div className="text-red-400 font-bold">{r.crashes}</div><div className="text-[10px] text-slate-600">{r.injured} inj</div></div></div>)}</div>
    </div>
  </div>;
}

// ── Ad Intel v2 ─────────────────────────────────────────────────────────

function AdIntel() {
  const PREMIUM_MAKES = ['ALL','ACURA','ALFA ROMEO','ASTON MARTIN','AUDI','BENTLEY','BMW','CADILLAC','FERRARI','GENESIS','INFINITI','JAGUAR','LAMBORGHINI','LAND ROVER','LEXUS','LOTUS','LUCID','MASERATI','MCLAREN','MERCEDES-BENZ','POLESTAR','PORSCHE','RIVIAN','ROLLS ROYCE','TESLA','VOLVO'];
  const [year, setYear] = useState('2025');
  const [make, setMake] = useState('ALL');
  const [data, setData] = useState(null);
  const [acgTotal, setAcgTotal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedZone, setSelectedZone] = useState(null);
  const [mapReady, setMapReady] = useState(false);
  const mapContainerRef = useRef(null);
  const mapInstance = useRef(null);
  const circlesLayer = useRef(null);

  useEffect(() => {
    setLoading(true);
    setSelectedZone(null);
    setMapReady(false);
    const qs = new URLSearchParams({year, limit: '60', min_crashes: make === 'ALL' ? '25' : '4'});
    if (make !== 'ALL') qs.set('make', make);
    Promise.all([
      fetch(`${API}/ad-intel-composite?${qs}`).then(r => r.json()),
      fetch(`${API}/acg-locations?year=${year}`).then(r => r.json()),
    ]).then(([geoData, acgData]) => {
      setData(geoData);
      setAcgTotal(acgData?.locations?.reduce((s,l) => s + (l.total_crashes||0), 0) || 0);
      setLoading(false);
    }).catch(e => { setError(e.message); setLoading(false); });
  }, [year, make]);

  // Initialize map after data + DOM are ready
  useEffect(() => {
    if (!data?.zones?.length || !mapContainerRef.current) return;

    // Retry-based map init: polls until container has dimensions
    let cancelled = false;
    let attempts = 0;
    let timer = null;

    const initMap = () => {
      if (cancelled) return;
      const el = mapContainerRef.current;
      // Keep retrying until container is visible with height > 50px
      if (!el || !el.offsetHeight || el.offsetHeight < 50) {
        if (attempts++ < 40) { timer = setTimeout(initMap, 150); }
        return;
      }
      // Container ready — init map
      if (mapInstance.current) { mapInstance.current.remove(); mapInstance.current = null; }
      try { el._leaflet_id = null; } catch(e) {}

      const m = L.map(el, { attributionControl: false, zoomControl: false, preferCanvas: true })
        .setView([34.05, -118.25], 8);
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 18 }).addTo(m);
      L.control.zoom({ position: 'bottomright' }).addTo(m);

      // Geo-fence circles
      const circles = [];
      data.zones.forEach(z => {
        const score = z.ad_score || z.composite_score || 0;
        const color = score >= 70 ? '#ef4444' : score >= 50 ? '#f59e0b' : score >= 35 ? '#3b82f6' : '#64748b';
        const c = L.circle([z.center.lat, z.center.lon], {
          radius: z.radius_meters || 900, color, weight: 1.5, opacity: 0.7, fillOpacity: 0.12, fillColor: color,
        }).addTo(m);
        const dmvInfo = z.stats?.dmv_luxury_total ? `<br/><span style="color:#10b981">🚗 ${z.stats.dmv_luxury_total.toLocaleString()} luxury cars nearby</span>` : '';
        const acgInfo = z.stats?.nearest_acg ? `<br/><span style="color:#ef4444">📍 ACG ${z.stats.nearest_acg} · ${z.stats.acg_distance_miles} mi</span>` : '';
        c.bindTooltip(`<div style="font-family:Inter,sans-serif;font-size:11px;padding:2px 0;"><b style="color:#fff">${z.name}</b><br/><span style="color:#f59e0b">Score: ${score}</span> · <span style="color:#94a3b8">${z.stats.total_crashes} crashes</span>${dmvInfo}${acgInfo}</div>`, { direction: 'top' });
        c.on('click', () => { setSelectedZone(z); m.setView([z.center.lat, z.center.lon], 13, { animate: true }); });
        circles.push(c);
      });

      // ACG location markers
      fetch(`${API}/acg-locations?year=${year}`).then(r => r.json()).then(acgData => {
        if (!acgData?.locations || !mapInstance.current) return;
        acgData.locations.forEach(loc => {
          if (!loc.lat || !loc.lon) return;
          const marker = L.circleMarker([loc.lat, loc.lon], { radius: 5, fillColor: '#dc2626', color: '#fff', weight: 1.5, fillOpacity: 0.9 }).addTo(mapInstance.current);
          const crashInfo = loc.total_crashes ? `<br/><span style="color:#94a3b8">${loc.total_crashes.toLocaleString()} crashes · ${loc.total_injured?.toLocaleString()} injured</span>` : '';
          marker.bindTooltip(`<div style="font-family:Inter,sans-serif;font-size:11px"><b style="color:#fff">ACG ${loc.name}</b>${crashInfo}</div>`, { direction: 'top' });
        });
      }).catch(() => {});

      mapInstance.current = m;
      circlesLayer.current = circles;
      setMapReady(true);
      if (data.zones.length > 0) m.fitBounds(data.zones.map(z => [z.center.lat, z.center.lon]), { padding: [40,40], maxZoom: 12 });
      setTimeout(() => { if (mapInstance.current) mapInstance.current.invalidateSize(); }, 400);
    };

    timer = setTimeout(initMap, 200); // Start after 200ms

    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (mapInstance.current) { mapInstance.current.remove(); mapInstance.current = null; }
    };
  }, [data]);

  if (error) return <div className="p-10 text-center"><div className="text-red-400 text-lg font-semibold mb-2">Error</div><div className="text-slate-500 text-sm">{error}</div></div>;
  if (loading) return <div className="p-5 space-y-4"><Skeleton h={120}/><div className="grid grid-cols-3 gap-4"><Skeleton h={400}/><Skeleton h={400}/></div></div>;
  if (!data?.zones?.length) return <div className="p-10 text-center text-slate-500 text-sm">No zones found for these filters. Try expanding criteria.</div>;

  const zones = data.zones;
  const best = zones[0];
  const totalLuxury = data.summary?.total_luxury_crashes || 0;
  const highValueZones = zones.filter(z => z.ad_score >= 50);
  const premiumZones = zones.filter(z => z.stats.luxury_pct >= 30);

  return <div className="flex flex-col h-full">
    {/* Filter bar */}
    <div className="px-5 py-2.5 bg-black/30 border-b border-white/[0.04] flex items-center gap-3 flex-shrink-0">
      <div className="flex items-center gap-1.5">
        <span className="text-[9px] text-slate-500 font-medium">Year</span>
        <select value={year} onChange={e => setYear(e.target.value)}
          className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-black/40 text-slate-300 border border-white/[0.08] outline-none focus:border-red-500/50 transition">
          {['2016','2023','2024','2025'].map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-[9px] text-slate-500 font-medium">Brand</span>
        <select value={make} onChange={e => setMake(e.target.value)}
          className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-black/40 text-slate-300 border border-white/[0.08] outline-none focus:border-red-500/50 transition max-w-[160px]">
          {PREMIUM_MAKES.map(m => <option key={m} value={m}>{m === 'ALL' ? 'All Makes' : m}</option>)}
        </select>
      </div>
      <div className="flex items-center gap-2 ml-auto text-[9px] text-slate-500">
        <span>{zones.length} zones</span>
        <span>·</span>
        <span className="text-amber-400">{highValueZones.length} high-value</span>
        <span>·</span>
        <span className="text-purple-400">{premiumZones.length} premium</span>
      </div>
      {selectedZone && <button onClick={() => setSelectedZone(null)}
        className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-500 hover:text-white hover:bg-white/[0.04] transition border border-white/[0.06] ml-2">✕ Clear</button>}
    </div>

    <div className="flex-1 overflow-y-auto">
      <div className="p-5 space-y-4">

        {/* KPI row */}
        <div className="grid grid-cols-5 gap-3">
          <KPI title="Total ACG Market" value={(acgTotal || 0).toLocaleString()} color="#f59e0b"/>
          <KPI title="Ad Zones Mapped" value={zones.length} color="#8b5cf6"/>
          <KPI title="Luxury Cars Nearby" value={zones.reduce((s,z)=>s+(z.stats.dmv_luxury_total||0),0).toLocaleString()} color={RED}/>
          <KPI title="Best Composite" value={best.composite_score || best.ad_score} color="#10b981"/>
          <KPI title="Luxury in Zones" value={totalLuxury} color="#06b6d4"/>
        </div>

        {/* Map + Top zones */}
        <div className="grid grid-cols-3 gap-4" style={{ minHeight: 440 }}>
          {/* Map — left 2/3 */}
          <div className="col-span-2 rounded-2xl overflow-hidden border border-white/[0.06] bg-black/20 relative">
            <div ref={mapContainerRef} className="w-full h-full" style={{ minHeight: 440 }}/>
            {!mapReady && <div className="absolute inset-0 flex items-center justify-center bg-black/40 z-10">
              <div className="flex flex-col items-center gap-2">
                <div className="w-6 h-6 border-2 border-white/20 border-t-white/60 rounded-full animate-spin"/>
                <span className="text-[10px] text-slate-500">Loading map...</span>
              </div>
            </div>}
            {/* Map legend */}
            <div className="absolute bottom-3 left-3 z-[1000] flex items-center gap-3 text-[9px] bg-black/70 backdrop-blur rounded-lg px-3 py-1.5 border border-white/[0.08]">
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-red-500/60"/> 70+</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-amber-500/60"/> 50+</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-blue-500/60"/> 35+</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-slate-500/60"/> &lt;35</span>
              <span className="text-slate-600 mx-1">|</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 border border-white"/> ACG</span>
            </div>
          </div>

          {/* Zone ranking — right 1/3 */}
          <div className="rounded-2xl border border-white/[0.06] bg-gradient-to-b from-white/[0.02] to-transparent p-4 overflow-y-auto" style={{ maxHeight: 440 }}>
            <h3 className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-3">Top Ad Zones by Score</h3>
            <div className="space-y-1">
              {zones.slice(0, 20).map((z, i) => {
                const barColor = z.ad_score >= 70 ? 'bg-red-500' : z.ad_score >= 50 ? 'bg-amber-500' : z.ad_score >= 35 ? 'bg-blue-500' : 'bg-slate-500';
                const borderColor = z.ad_score >= 70 ? 'border-red-500/20' : z.ad_score >= 50 ? 'border-amber-500/20' : z.ad_score >= 35 ? 'border-blue-500/20' : 'border-slate-500/20';
                const isSelected = selectedZone?.zone_id === z.zone_id;
                return <button key={i} onClick={() => {
                  setSelectedZone(z);
                  if (mapInstance.current) {
                    mapInstance.current.setView([z.center.lat, z.center.lon], 14, { animate: true });
                  }
                }} className={`w-full text-left p-2.5 rounded-lg transition-all hover:bg-white/[0.05] border ${isSelected ? 'border-white/[0.12] bg-white/[0.04]' : 'border-transparent ' + borderColor}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] font-medium text-slate-300 truncate">{z.name.length > 30 ? z.name.substring(0,28)+'…' : z.name}</div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <div className="flex items-center gap-1">
                          <div className={`w-1.5 h-1.5 rounded-full ${barColor}`}/>
                          <span className="text-[10px] font-bold text-white">{z.ad_score}</span>
                        </div>
                        <span className="text-[9px] text-slate-500">{z.stats.total_crashes} crashes</span>
                        {z.stats.dmv_luxury_total > 0 && <span className="text-[9px] text-emerald-400/70">{z.stats.dmv_luxury_total.toLocaleString()} DMV</span>}
                      </div>
                    </div>
                    <span className="text-[8px] text-slate-600 flex-shrink-0">#{i+1}</span>
                  </div>
                </button>;
              })}
            </div>
          </div>
        </div>

        {/* Selected zone detail */}
        {selectedZone && <div className="rounded-2xl border border-white/[0.08] bg-gradient-to-b from-white/[0.03] to-transparent p-5 animate-in">
          <div className="flex items-start justify-between mb-4">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-white">{selectedZone.name}</h2>
                <a href={`https://www.google.com/maps?q=${selectedZone.center.lat},${selectedZone.center.lon}`} target="_blank" rel="noopener noreferrer"
                  className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/[0.04] text-slate-400 hover:text-white hover:bg-white/[0.08] transition border border-white/[0.06]">
                  📍 Map
                </a>
              </div>
              <div className="flex items-center gap-3 mt-1">
                <span className="text-xs text-slate-400">{selectedZone.city}</span>
                <span className="text-[10px] text-slate-600">Radius: {selectedZone.radius_meters}m</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/[0.03] text-slate-500 border border-white/[0.05]">
                  {selectedZone.primary_road}
                </span>
              </div>
            </div>
            <div className="text-center">
              <div className="text-[36px] font-bold text-red-400 leading-none">{selectedZone.ad_score}</div>
              <div className="text-[9px] text-slate-500 uppercase tracking-wider mt-1">Ad Score /100</div>
            </div>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-6 gap-3 mb-4">
            {[
              {label:'Crashes',value:selectedZone.stats.total_crashes.toLocaleString(),color:'text-white'},
              {label:'Luxury Crashes',value:selectedZone.stats.total_luxury+' ('+selectedZone.stats.luxury_pct+'%)',color:'text-purple-400'},
              {label:'🚗 DMV Luxury Nearby',value:(selectedZone.stats.dmv_luxury_total||0).toLocaleString(),color:'text-emerald-400'},
              {label:'DMV ZIPs',value:selectedZone.stats.dmv_zip_count||0,color:'text-blue-400'},
              {label:'📍 Nearest ACG',value:selectedZone.stats.nearest_acg||'N/A',color:'text-amber-400'},
              {label:'📏 ACG Distance',value:(selectedZone.stats.acg_distance_miles||'?')+' mi',color:'text-red-400'},
            ].map((s,i) => (
              <div key={i} className="rounded-xl bg-white/[0.02] border border-white/[0.04] p-3 text-center">
                <div className={`text-lg font-bold ${s.color} leading-tight`}>{s.value}</div>
                <div className="text-[9px] text-slate-500 mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>

          {/* Score Breakdown */}
          {selectedZone.stats.score_breakdown && <div className="mb-4 p-4 rounded-xl bg-white/[0.01] border border-white/[0.04]">
            <h4 className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-3">📊 Composite Score Breakdown</h4>
            <div className="grid grid-cols-4 gap-3">
              {[
                {label:'Crash Volume (30%)',v:selectedZone.stats.score_breakdown.crash_volume,color:'#f97316'},
                {label:'Luxury Mix (25%)',v:selectedZone.stats.score_breakdown.luxury_mix,color:'#a78bfa'},
                {label:'DMV Density (25%)',v:selectedZone.stats.score_breakdown.dmv_density,color:'#10b981'},
                {label:'ACG Proximity (20%)',v:selectedZone.stats.score_breakdown.acg_proximity,color:'#ef4444'},
              ].map((s,i) => (
                <div key={i} className="text-center">
                  <div className="flex items-center justify-center mb-1">
                    <svg width="44" height="44" viewBox="0 0 44 44" className="-rotate-90">
                      <circle cx="22" cy="22" r="18" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="3"/>
                      <circle cx="22" cy="22" r="18" fill="none" stroke={s.color} strokeWidth="3"
                        strokeDasharray={`${(s.v/100)*113} 113`} strokeLinecap="round"
                        style={{filter:`drop-shadow(0 0 3px ${s.color}44)`}}/>
                    </svg>
                    <span className="absolute text-[11px] font-bold text-white">{s.v}</span>
                  </div>
                  <div className="text-[8px] text-slate-500 leading-tight">{s.label}</div>
                </div>
              ))}
            </div>
          </div>}

          {/* DMV Brands + Luxury crash brands */}
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <h4 className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">🚗 Luxury Cars Registered Nearby</h4>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {selectedZone.stats.dmv_top_brands?.slice(0,6).map((b, i) => (
                  <span key={i} className="text-[10px] px-2 py-1 rounded-full bg-emerald-500/[0.08] text-emerald-400 border border-emerald-500/[0.15]">
                    {b.make} <span className="font-medium">{b.vehicles?.toLocaleString()}</span>
                  </span>
                ))}
                {!selectedZone.stats.dmv_top_brands?.length && <span className="text-[10px] text-slate-600">No DMV data</span>}
              </div>
              <h4 className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">🏎️ Luxury Brands Crashed Here</h4>
              <div className="flex flex-wrap gap-1.5">
                {selectedZone.stats.top_luxury?.map((l, i) => (
                  <span key={i} className="text-[10px] px-2 py-1 rounded-full bg-white/[0.04] text-slate-300 border border-white/[0.06]">
                    {l.make} <span className="text-slate-500 font-medium">{l.crashes}</span>
                  </span>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <h4 className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">⏰ Peak Hours</h4>
                <div className="space-y-1">
                  {selectedZone.stats.peak_hours?.map((h, i) => (
                    <div key={i} className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-300 font-medium">{h.hour}:00</span>
                      <span className="text-slate-500">{h.n} crashes</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <h4 className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">📅 Peak Day</h4>
                <div className="text-sm font-bold text-blue-400">{selectedZone.stats.peak_day}</div>
                <h4 className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mt-3 mb-2">📐 Radius</h4>
                <div className="text-sm font-bold text-slate-300">{selectedZone.radius_meters}m</div>
                <div className="text-[9px] text-slate-500 mt-0.5">Geo-fence target</div>
              </div>
            </div>
          </div>

          {/* Ad Recommendation */}
          <div className="p-4 rounded-xl bg-gradient-to-r from-red-500/[0.06] to-amber-500/[0.04] border border-red-500/[0.12]">
            <div className="flex items-start gap-3">
              <span className="text-xl">🎯</span>
              <div className="flex-1">
                <div className="text-xs font-bold text-red-400 mb-1.5 uppercase tracking-wide">Advertising Recommendation</div>
                <p className="text-[11px] text-slate-300 leading-relaxed">
                  {selectedZone.stats.luxury_pct > 25
                    ? `${selectedZone.stats.total_luxury} luxury vehicles crashed here in ${year} (${selectedZone.stats.luxury_pct}% of total). ` +
                      `Recommend <strong class="text-white">Meta geo-fence ads</strong> (${selectedZone.radius_meters}m radius) ` +
                      `targeting ${selectedZone.stats.top_luxury?.slice(0,3).map(l=>l.make).join(', ')} owners. ` +
                      `Best timing: <strong class="text-white">${selectedZone.stats.peak_day}s ${selectedZone.stats.peak_hours?.[0]?.hour}:00–${selectedZone.stats.peak_hours?.[1]?.hour||selectedZone.stats.peak_hours?.[0]?.hour}:00</strong>. ` +
                      `Estimated reach: ~${Math.round(selectedZone.stats.total_crashes*15)} drivers/month.`
                    : `${selectedZone.stats.total_crashes} crashes/year in this corridor. ` +
                      `Recommend <strong class="text-white">Waze Local ads</strong> + tow truck partnership. ` +
                      `Peak activity: <strong class="text-white">${selectedZone.stats.peak_day}s ${selectedZone.stats.peak_hours?.[0]?.hour}:00</strong>. ` +
                      `Consider programmatic DOOH billboard if available nearby.`
                  }
                </p>
                <div className="flex items-center gap-2 mt-3">
                  <a href={`https://www.google.com/maps/search/body+shop+near+${encodeURIComponent(selectedZone.name.replace('×','and'))}`} target="_blank" rel="noopener noreferrer"
                    className="text-[10px] px-3 py-1.5 rounded-lg bg-white/[0.04] text-slate-400 hover:text-white hover:bg-white/[0.08] transition border border-white/[0.06]">
                    🔍 Find nearby body shops
                  </a>
                  <a href={`https://www.google.com/maps?q=${selectedZone.center.lat},${selectedZone.center.lon}`} target="_blank" rel="noopener noreferrer"
                    className="text-[10px] px-3 py-1.5 rounded-lg bg-white/[0.04] text-slate-400 hover:text-white hover:bg-white/[0.08] transition border border-white/[0.06]">
                    📍 Open in Google Maps
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>}

        {/* All zones grid */}
        {!selectedZone && <div className="rounded-2xl border border-white/[0.06] bg-gradient-to-b from-white/[0.02] to-transparent p-5">
          <h3 className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-4">
            All Ad Zones ({zones.length}) · Sorted by Ad Score
          </h3>
          <div className="grid grid-cols-3 gap-2">
            {zones.map((z, i) => {
              const sc = z.ad_score;
              const scColor = sc >= 70 ? 'text-red-400' : sc >= 50 ? 'text-amber-400' : sc >= 35 ? 'text-blue-400' : 'text-slate-400';
              const bgGlow = sc >= 70 ? 'shadow-[inset_0_0_20px_rgba(239,68,68,0.05)]' : '';
              return <button key={i} onClick={() => {
                setSelectedZone(z);
                if (mapInstance.current) mapInstance.current.setView([z.center.lat, z.center.lon], 13, { animate: true });
              }} className={`text-left p-3 rounded-xl bg-white/[0.01] hover:bg-white/[0.04] transition border border-white/[0.03] hover:border-white/[0.08] ${bgGlow}`}>
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] font-medium text-slate-300 truncate">{z.name}</div>
                    <div className="text-[9px] text-slate-500 mt-0.5">{z.city}</div>
                  </div>
                  <div className={`text-lg font-bold ${scColor} flex-shrink-0`}>{sc}</div>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-white/[0.03] text-slate-400 border border-white/[0.04]">{z.stats.total_crashes} crashes</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-purple-500/[0.08] text-purple-400 border border-purple-500/[0.1]">{z.stats.luxury_pct}% lux</span>
                  {z.stats.top_luxury?.slice(0, 2).map((l, j) => (
                    <span key={j} className="text-[8px] px-1 py-0.5 rounded-full bg-white/[0.02] text-slate-500 border border-white/[0.03]">{l.make}</span>
                  ))}
                </div>
              </button>;
            })}
          </div>
        </div>}

      </div>
    </div>
  </div>;
}

// ── Forecast v3 — Modern Crash Weather ──────────────────────────────

const riskGradient = (level) => level === 'EXTREME' ? 'from-red-600 to-rose-700' : level === 'HIGH' ? 'from-orange-500 to-amber-600' : level === 'MODERATE' ? 'from-yellow-500 to-amber-500' : 'from-emerald-500 to-teal-600';
const riskColor = (level) => level === 'EXTREME' ? 'bg-red-500 text-white' : level === 'HIGH' ? 'bg-orange-500 text-white' : level === 'MODERATE' ? 'bg-yellow-500 text-black' : 'bg-emerald-500 text-white';
const riskText = (level) => level === 'EXTREME' ? 'text-red-400' : level === 'HIGH' ? 'text-orange-400' : level === 'MODERATE' ? 'text-yellow-400' : 'text-emerald-400';
const riskBorder = (level) => level === 'EXTREME' ? 'border-red-500/30' : level === 'HIGH' ? 'border-orange-500/30' : level === 'MODERATE' ? 'border-yellow-500/30' : 'border-emerald-500/30';
const riskBg = (level) => level === 'EXTREME' ? 'bg-red-500/10' : level === 'HIGH' ? 'bg-orange-500/10' : level === 'MODERATE' ? 'bg-yellow-500/10' : 'bg-emerald-500/10';
const riskGlow = (level) => level === 'EXTREME' ? 'shadow-[0_0_20px_rgba(239,68,68,0.2)]' : level === 'HIGH' ? 'shadow-[0_0_20px_rgba(249,115,22,0.2)]' : level === 'MODERATE' ? 'shadow-[0_0_20px_rgba(234,179,8,0.15)]' : 'shadow-[0_0_12px_rgba(16,185,129,0.1)]';

// SVG gauge for risk score
function RiskGauge({score, size=80}) {
  const r = (size-8)/2;
  const circ = 2*Math.PI*r;
  const pct = score/100;
  const dash = circ*pct;
  const color = score >= 70 ? '#ef4444' : score >= 45 ? '#f97316' : score >= 25 ? '#eab308' : '#10b981';
  const trackColor = 'rgba(255,255,255,0.06)';
  return <div className="relative inline-flex items-center justify-center" style={{width:size,height:size}}>
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={trackColor} strokeWidth="5"/>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth="5"
        strokeDasharray={`${dash} ${circ-dash}`} strokeLinecap="round"
        style={{filter:`drop-shadow(0 0 4px ${color}44)`}}/>
    </svg>
    <div className="absolute inset-0 flex flex-col items-center justify-center">
      <span className="text-lg font-bold text-white leading-none">{score}</span>
      <span className="text-[7px] text-slate-500">/100</span>
    </div>
  </div>;
}

function ForecastView() {
  const [data, setData] = useState(null);
  const [seasonal, setSeasonal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedDay, setSelectedDay] = useState(null);
  const [showMap, setShowMap] = useState(false);
  const mapRef = useRef(null);
  const mapInstance = useRef(null);

  useEffect(() => {
    Promise.all([
      fetch(`${API}/forecast`).then(r => r.json()),
      fetch(`${API}/seasonal-patterns`).then(r => r.json()),
    ]).then(([forecastData, seasonalData]) => {
      setData(forecastData);
      setSeasonal(seasonalData);
      setLoading(false);
      if(forecastData?.daily?.length) setSelectedDay(forecastData.daily[0]);
    }).catch(e => { setError(e.message); setLoading(false); });
  }, []);

  // Initialize mini-map
  useEffect(() => {
    if (!showMap || !mapRef.current || !data?.corridors || mapInstance.current) return;
    const el = mapRef.current;
    if (el._leaflet_id) { el._leaflet_id = null; }
    const m = L.map(el, { attributionControl: false, zoomControl: true, zoomControlOptions: {position:'bottomright'} })
      .setView([34.05, -118.25], 8);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {maxZoom:18}).addTo(m);

    // Add corridor markers
    const todayData = data.daily?.[0];
    data.corridors.forEach(c => {
      const zoneData = todayData?.zones?.find(z => z.corridor_name === c.name);
      const risk = zoneData?.risk_level || 'LOW';
      const icon = zoneData?.weather_icon || '📍';
      const markerColor = risk === 'EXTREME' ? '#ef4444' : risk === 'HIGH' ? '#f97316' : risk === 'MODERATE' ? '#eab308' : '#10b981';
      const marker = L.circleMarker([c.lat, c.lon], {
        radius: risk === 'EXTREME' ? 12 : risk === 'HIGH' ? 9 : risk === 'MODERATE' ? 7 : 5,
        fillColor: markerColor, color: markerColor, weight: 2, opacity: 0.8, fillOpacity: 0.4,
      }).addTo(m);
      marker.bindTooltip(`<b>${c.name}</b><br/>${icon} ${zoneData?.weather_label || ''}<br/>Risk: ${risk} (${zoneData?.risk_score || 0})`, {direction:'top'});
    });

    mapInstance.current = m;
    return () => { m.remove(); mapInstance.current = null; };
  }, [showMap, data]);

  if (error) return <div className="p-10 text-center"><div className="text-red-400 text-lg font-semibold mb-2">Forecast Error</div><div className="text-slate-500 text-sm">{error}</div></div>;
  if (loading) return <div className="p-5 space-y-4"><Skeleton h={120}/><Skeleton h={200}/><Skeleton h={300}/></div>;
  if (!data?.daily?.length) return <div className="p-10 text-center text-slate-500 text-sm">No forecast data yet. Run weather sync first.</div>;

  const daily = data.daily;
  const summary = data.summary || {};
  const current = data.current;
  const today = daily[0];
  const selected = selectedDay || today;

  // Find the ACG corridors with highest risk today
  const topRisky = today?.zones?.filter(z => z.risk_level !== 'LOW').slice(0, 3) || [];

  return <div className="flex flex-col h-full">
    {/* Header */}
    <div className="px-5 py-3 bg-black/30 border-b border-white/[0.04] flex items-center justify-between flex-shrink-0">
      <div className="flex items-center gap-3">
        <span className="text-2xl">{today?.weather_icon || '🌤️'}</span>
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-white">Crash Weather Intel</h2>
            <span className="text-[9px] px-2 py-0.5 rounded-full bg-white/[0.04] text-slate-400 border border-white/[0.06]">7-Day Forecast</span>
            {current?.stale && <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">Live data stale</span>}
          </div>
          <p className="text-[10px] text-slate-500 mt-0.5">Crash risk prediction · weather × crash history × revenue opportunity</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={() => setShowMap(!showMap)}
          className={`text-[10px] px-3 py-1.5 rounded-lg border transition ${showMap ? 'border-white/[0.15] bg-white/[0.06] text-white' : 'border-white/[0.06] text-slate-500 hover:text-white hover:border-white/[0.1]'}`}>
          🗺️ {showMap ? 'Hide Map' : 'Corridor Map'}
        </button>
        <button onClick={() => fetch(`${API}/weather/refresh`).then(()=>window.location.reload())}
          className="text-[10px] px-3 py-1.5 rounded-lg border border-white/[0.06] text-slate-500 hover:text-white hover:border-white/[0.1] transition">
          🔄 Refresh
        </button>
        <div className="text-[9px] text-slate-600">{data.generated_at ? new Date(data.generated_at).toLocaleTimeString() : ''}</div>
      </div>
    </div>

    <div className="flex-1 overflow-y-auto p-5 space-y-4">
      {/* ── HERO: Today's Overview ── */}
      <div className={`rounded-2xl border ${riskBorder(today.overall_risk)} bg-gradient-to-br from-white/[0.03] via-white/[0.01] to-transparent p-5 ${riskGlow(today.overall_risk)}`}>
        <div className="flex items-start gap-6">
          {/* Left: Gauge + Weather */}
          <div className="flex items-center gap-4 flex-shrink-0">
            <RiskGauge score={today.max_risk_score} size={90}/>
            <div className="text-center">
              <div className="text-4xl mb-1">{today.weather_icon}</div>
              <div className="text-xs font-medium text-slate-300">{today.weather_summary}</div>
              {current?.conditions?.[0] && <div className="text-[10px] text-slate-500 mt-0.5">
                {current.conditions[0].temp_c}°C · {current.conditions[0].humidity_pct}% humidity · {current.conditions[0].wind_speed_kmh}km/h wind
              </div>}
            </div>
          </div>

          {/* Middle: Risk Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${riskColor(today.overall_risk)}`}>
                {today.overall_risk} RISK TODAY
              </span>
              <span className="text-[10px] text-slate-500">{today.day_of_week} · {today.date}</span>
            </div>
            <h3 className="text-lg font-bold text-white mb-1">
              {today.overall_risk === 'LOW' ? '✅ Clear conditions — normal crash patterns' :
               today.overall_risk === 'MODERATE' ? '👀 Slightly elevated risk — keep monitoring' :
               today.overall_risk === 'HIGH' ? '⚠️ High crash risk — activate ad campaigns' :
               '🚨 EXTREME risk — maximize all channels'}
            </h3>
            <p className="text-xs text-slate-400 mb-3">
              {today.high_risk_count > 0
                ? `${today.high_risk_count} corridor${today.high_risk_count>1?'s':''} at elevated risk. `
                : 'All corridors at normal levels. '}
              {topRisky.length > 0 && <span className="text-orange-400">
                Top concern: {topRisky[0]?.corridor_name} — {topRisky[0]?.recommendation}
              </span>}
              {topRisky.length === 0 && <span className="text-emerald-400">No action required today.</span>}
            </p>

            {/* Quick corridor stats */}
            <div className="grid grid-cols-4 gap-2">
              {today.zones?.slice(0,4).map((z,i) => (
                <div key={i} className={`rounded-lg border ${riskBorder(z.risk_level)} px-3 py-2 ${riskBg(z.risk_level)}`}>
                  <div className="text-[9px] text-slate-500 truncate">{z.corridor_name.split('×')[0].trim()}</div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-[15px]">{z.weather_icon}</span>
                    <span className={`text-[11px] font-bold ${riskText(z.risk_level)}`}>{z.risk_score}</span>
                  </div>
                  <div className="text-[8px] text-slate-500 mt-0.5">{z.expected_crashes} crashes · {z.weather_factor}x</div>
                </div>
              ))}
            </div>
          </div>

          {/* Right: Market Intelligence */}
          <div className="flex-shrink-0 w-52 rounded-xl border border-white/[0.06] bg-gradient-to-b from-white/[0.02] to-transparent p-4">
            <div className="text-[9px] text-slate-500 uppercase tracking-wider mb-3">📊 Today's Market</div>
            {(() => {
              const totalCrashes = today.zones?.reduce((sum,z) => sum + (z.expected_crashes||0), 0) || 0;
              const totalBaseline = today.zones?.reduce((sum,z) => sum + (z.baseline_crashes||0), 0) || 0;
              const uplift = totalCrashes - totalBaseline;
              const avgRepair = 2800; // avg collision repair ticket
              const marketValue = Math.round(totalCrashes * avgRepair);
              const captureRate = 0.03; // 3% market share across 13 ACG locations
              const acgRevenue = Math.round(marketValue * captureRate);

              return <>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] text-slate-400">Crashes expected</span>
                  <span className="text-sm font-bold text-white">{Math.round(totalCrashes)}</span>
                </div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] text-slate-400">Market value</span>
                  <span className="text-sm font-bold text-amber-400">${marketValue.toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] text-slate-400">Est. ACG revenue</span>
                  <span className="text-sm font-bold text-emerald-400">${acgRevenue.toLocaleString()}</span>
                </div>
                {uplift > 0.5 && <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] text-slate-400">Weather uplift</span>
                  <span className="text-xs font-bold text-orange-400">+{Math.round(uplift)} crashes</span>
                </div>}
                <div className="mt-2 pt-2 border-t border-white/[0.04]">
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] text-slate-500">Avg repair ticket</span>
                    <span className="text-[9px] text-slate-400">${avgRepair.toLocaleString()}</span>
                  </div>
                  <div className="flex items-center justify-between mt-0.5">
                    <span className="text-[9px] text-slate-500">ACG capture rate</span>
                    <span className="text-[9px] text-slate-400">{(captureRate*100).toFixed(0)}%</span>
                  </div>
                </div>
              </>;
            })()}
          </div>
        </div>
      </div>

      {/* ── CORRIDOR MAP (togglable) ── */}
      {showMap && <div className="rounded-2xl border border-white/[0.06] overflow-hidden" style={{height:280}}>
        <div ref={mapRef} className="w-full h-full"/>
      </div>}

      {/* ── 7-DAY CARDS ── */}
      <div className="rounded-2xl border border-white/[0.06] bg-gradient-to-b from-white/[0.02] to-transparent p-4">
        <h3 className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-3">📅 7-Day Outlook</h3>
        <div className="grid grid-cols-7 gap-2">
          {daily.map((d, i) => {
            const isToday = i === 0;
            const isSelected = selectedDay?.date === d.date;
            return <button key={i} onClick={() => setSelectedDay(isSelected ? null : d)}
              className={`rounded-xl p-3 text-left transition-all border cursor-pointer
                ${isToday ? 'ring-1 ring-white/[0.1] bg-white/[0.03]' : ''}
                ${isSelected ? 'border-white/[0.15] bg-white/[0.05] scale-[1.02]' : 'border-white/[0.05] hover:border-white/[0.1] bg-white/[0.01] hover:bg-white/[0.03]'}`}>
              <div className="flex items-center justify-between mb-2">
                <div className="text-[9px] text-slate-500 font-semibold">{d.day_of_week?.substring(0,3).toUpperCase()}</div>
                {isToday && <span className="text-[7px] px-1 py-0.5 rounded bg-white/[0.06] text-slate-400">TODAY</span>}
              </div>
              <div className="text-2xl mb-2 text-center">{d.weather_icon}</div>
              <div className="text-[10px] text-slate-400 text-center mb-2">{d.weather_summary}</div>
              <div className="flex items-center justify-center gap-1 mb-1">
                <span className={`text-[8px] px-1.5 py-0.5 rounded-full font-bold ${riskColor(d.overall_risk)}`}>
                  {d.overall_risk}
                </span>
              </div>
              <div className="text-center">
                <span className="text-xs font-bold" style={{color: d.overall_risk==='EXTREME'?'#ef4444':d.overall_risk==='HIGH'?'#f97316':d.overall_risk==='MODERATE'?'#eab308':'#10b981'}}>
                  {d.max_risk_score}
                </span>
              </div>
              {d.high_risk_count > 0 && <div className="flex items-center justify-center gap-1 mt-1.5">
                <span className="w-1 h-1 rounded-full bg-red-400"/>
                <span className="text-[7px] text-red-400 font-medium">{d.high_risk_count}</span>
              </div>}
              <div className="text-[8px] text-slate-600 text-center mt-1">{d.date?.substring(5)}</div>
            </button>;
          })}
        </div>
      </div>

      {/* ── SELECTED DAY DETAIL ── */}
      {selected && <div className={`rounded-2xl border ${riskBorder(selected.overall_risk)} ${riskBg(selected.overall_risk)} p-5 ${riskGlow(selected.overall_risk)}`}>
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-2xl">{selected.weather_icon}</span>
              <h3 className="text-base font-bold text-white">{selected.day_of_week}, {selected.date}</h3>
            </div>
            <div className="flex items-center gap-2 mt-1.5">
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${riskColor(selected.overall_risk)}`}>
                {selected.overall_risk} RISK
              </span>
              <span className="text-xs text-slate-400">{selected.weather_summary} · {selected.avg_temp}°C</span>
              {selected.high_risk_count > 0 && <span className="text-xs text-orange-400">{selected.high_risk_count} alerts</span>}
            </div>
          </div>
          <RiskGauge score={selected.max_risk_score} size={70}/>
        </div>

        {/* Alerts with revenue */}
        {selected.top_alerts?.length > 0 && <div className="space-y-2 mb-4">
          <h4 className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">🎯 Action Required</h4>
          {selected.top_alerts.map((a, i) => (
            <div key={i} className={`flex items-start gap-3 p-3 rounded-xl border ${riskBorder(a.risk)} ${a.risk==='EXTREME'?'bg-red-500/5':a.risk==='HIGH'?'bg-orange-500/5':'bg-yellow-500/5'}`}>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold flex-shrink-0 mt-0.5 ${riskColor(a.risk)}`}>{a.risk}</span>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-slate-200">{a.corridor}</div>
                <div className="text-[10px] text-slate-400 mt-0.5">{a.rec}</div>
                {a.revenue && <div className="text-[9px] text-emerald-400/70 mt-0.5">{a.revenue}</div>}
              </div>
              <div className={`text-lg font-bold ${riskText(a.risk)} flex-shrink-0`}>{a.score}</div>
            </div>
          ))}
        </div>}

        {selected.top_alerts?.length === 0 && <div className="mb-4 p-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 text-center">
          <span className="text-xs text-emerald-400">✅ All clear — no alerts for this day</span>
        </div>}

        {/* Zone grid */}
        <h4 className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
          All Corridors — {selected.day_of_week}
        </h4>
        <div className="grid grid-cols-2 gap-2">
          {selected.zones?.map((z, i) => (
            <div key={i} className={`flex items-center gap-3 p-3 rounded-lg border ${riskBorder(z.risk_level)} bg-white/[0.01] hover:bg-white/[0.02] transition`}>
              <span className="text-xl flex-shrink-0">{z.weather_icon}</span>
              <div className="flex-1 min-w-0">
                <div className="text-[10px] font-medium text-slate-300 truncate">{z.corridor_name}</div>
                <div className="text-[8px] text-slate-500 mt-0.5">
                  {z.weather_label} · {z.precipitation_mm}mm · {z.expected_crashes} crashes
                  {z.weather_factor > 1 && <span className="text-amber-400 ml-1">({z.weather_factor}x)</span>}
                </div>
              </div>
              <div className="flex flex-col items-end flex-shrink-0">
                <span className={`text-sm font-bold ${riskText(z.risk_level)}`}>{z.risk_score}</span>
                <span className="text-[8px] text-slate-600">{z.risk_level}</span>
              </div>
            </div>
          ))}
        </div>
      </div>}

      {/* ── SEASONAL PATTERNS ── */}
      {seasonal && <div className="rounded-2xl border border-white/[0.06] bg-gradient-to-b from-white/[0.02] to-transparent p-5">
        <h3 className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-3">📈 Seasonal Crash Patterns (3-Year CCRS Data)</h3>
        <div className="grid grid-cols-2 gap-4">
          {/* Monthly bars */}
          <div>
            <div className="text-[10px] text-slate-500 mb-2">Monthly Avg Crashes (CA)</div>
            <div className="space-y-1">
              {(seasonal.patterns?.monthly || []).map((m, i) => {
                const maxVal = Math.max(...(seasonal.patterns.monthly||[]).map(x => x.avg_3yr));
                const isPeak = m.avg_3yr === maxVal;
                return <div key={i} className="flex items-center gap-2">
                  <span className="text-[9px] text-slate-400 w-7">{m.key}</span>
                  <div className="flex-1 h-3 rounded-sm bg-white/[0.02] relative overflow-hidden">
                    <div className={`h-full rounded-sm ${isPeak ? 'bg-amber-500/70' : 'bg-blue-500/30'}`}
                      style={{width: `${(m.avg_3yr/maxVal)*100}%`}}/>
                  </div>
                  <span className={`text-[9px] w-10 text-right ${isPeak ? 'text-amber-400 font-bold' : 'text-slate-500'}`}>
                    {(m.avg_3yr/1000).toFixed(1)}K
                  </span>
                </div>;
              })}
            </div>
          </div>
          {/* Insights */}
          <div className="space-y-3">
            <div className="rounded-xl bg-amber-500/[0.05] border border-amber-500/[0.1] p-3">
              <div className="text-[10px] text-amber-400 font-semibold mb-1">🔴 Peak Season Alert</div>
              <div className="text-[11px] text-slate-300">
                <strong>{seasonal.insights?.peak_month?.key}</strong> is the deadliest month —{' '}
                <strong className="text-amber-400">{seasonal.insights?.seasonal_swing_pct}%</strong> more crashes than{' '}
                {seasonal.insights?.low_month?.key}.{' '}
                Tow rate: {seasonal.insights?.peak_month?.tow_rate}%.
              </div>
            </div>
            <div className="rounded-xl bg-white/[0.02] border border-white/[0.04] p-3">
              <div className="text-[10px] text-slate-400 font-semibold mb-1">📅 Day of Week</div>
              <div className="flex items-center gap-1">
                {(seasonal.patterns?.dow || []).slice(0,7).map((d, i) => {
                  const maxDow = Math.max(...(seasonal.patterns.dow||[]).map(x => x.avg_3yr));
                  return <div key={i} className="flex-1 text-center">
                    <div className="h-12 flex items-end justify-center mb-1">
                      <div className={`w-5 rounded-t-sm ${d.key === seasonal.insights?.peak_day?.key ? 'bg-red-500/70' : 'bg-white/[0.08]'}`}
                        style={{height: `${(d.avg_3yr/maxDow)*100}%`, minHeight: 4}}/>
                    </div>
                    <div className="text-[7px] text-slate-500">{d.key.substring(0,3)}</div>
                  </div>;
                })}
              </div>
              <div className="text-[9px] text-slate-500 mt-1">
                Peak: <strong className="text-red-400">{seasonal.insights?.peak_day?.key}</strong> ·{' '}
                Weekend avg is {seasonal.insights?.weekend_vs_weekday}% of weekday
              </div>
            </div>
            <div className="rounded-xl bg-white/[0.02] border border-white/[0.04] p-3">
              <div className="text-[10px] text-slate-400 font-semibold mb-1">⏰ Peak Hours</div>
              <div className="flex items-center gap-1">
                {(seasonal.patterns?.hourly || []).filter(h => parseInt(h.key) >= 6 && parseInt(h.key) <= 21).map((h, i) => {
                  const maxHr = Math.max(...(seasonal.patterns.hourly||[]).map(x => x.avg_3yr));
                  return <div key={i} className="flex-1 text-center">
                    <div className="h-10 flex items-end justify-center mb-0.5">
                      <div className={`w-3 rounded-t-sm ${h.key === seasonal.insights?.peak_hour?.key ? 'bg-amber-500/80' : 'bg-white/[0.06]'}`}
                        style={{height: `${(h.avg_3yr/maxHr)*100}%`, minHeight: 2}}/>
                    </div>
                    <div className="text-[7px] text-slate-600">{h.key}</div>
                  </div>;
                })}
              </div>
              <div className="text-[9px] text-slate-500 mt-1">
                Peak: <strong className="text-amber-400">{seasonal.insights?.peak_hour?.key}:00</strong> ({((seasonal.insights?.peak_hour?.avg_3yr||0)/1000).toFixed(1)}K crashes) — Rush hour
              </div>
            </div>
          </div>
        </div>
      </div>}

      {/* ── CORRIDOR × DAY RISK MATRIX ── */}
      <div className="rounded-2xl border border-white/[0.06] bg-gradient-to-b from-white/[0.02] to-transparent p-5">
        <h3 className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-3">📊 Risk Matrix — 10 Corridors × 7 Days</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-[10px]">
            <thead>
              <tr className="text-slate-500 border-b border-white/[0.04]">
                <th className="text-left py-2.5 px-2 font-medium text-[9px] uppercase tracking-wider">Corridor</th>
                {daily.map((d, i) => (
                  <th key={i} className="text-center py-2.5 px-2 font-medium">
                    <div className="text-[9px]">{d.day_of_week?.substring(0,3)}</div>
                    <div className="text-[7px] text-slate-600 mt-0.5">{d.weather_icon}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(daily[0]?.zones || []).map((z, zi) => {
                const name = z.corridor_name;
                const across = daily.map(d => d.zones?.find(zz => zz.corridor_name === name));
                return <tr key={zi} className="border-b border-white/[0.02] hover:bg-white/[0.01] transition">
                  <td className="py-2.5 px-2 text-slate-300 font-medium max-w-[180px] truncate text-[9px]">{name}</td>
                  {across.map((az, ai) => {
                    if (!az) return <td key={ai} className="py-2.5 px-1 text-center text-slate-600">—</td>;
                    const isHigh = az.risk_level === 'HIGH' || az.risk_level === 'EXTREME';
                    return <td key={ai} className="py-2.5 px-1 text-center">
                      <div className={`inline-flex flex-col items-center px-1.5 py-1 rounded-md text-[8px] font-semibold
                        ${isHigh ? 'bg-red-500/10 border border-red-500/20' :
                          az.risk_level === 'MODERATE' ? 'bg-yellow-500/5 border border-yellow-500/10' :
                          'bg-white/[0.02] border border-white/[0.03]'}`}>
                        <span className={riskText(az.risk_level)}>{az.risk_score}</span>
                        <span className="text-[7px] text-slate-600 mt-0.5">{az.expected_crashes}c</span>
                      </div>
                    </td>;
                  })}
                </tr>;
              })}
            </tbody>
          </table>
        </div>
        <div className="flex items-center gap-4 mt-3 text-[9px] text-slate-500">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-red-500/30"/> HIGH+ risk</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-yellow-500/20"/> MODERATE</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-white/[0.04]"/> LOW / Clear</span>
          <span className="ml-auto">c = expected crashes/day</span>
        </div>
      </div>

    </div>
  </div>;
}

// ── Mailer Targets View ─────────────────────────────────────────────

function MailerView() {
  const [targets, setTargets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [minScore, setMinScore] = useState(30);
  const [acgFilter, setAcgFilter] = useState('');

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({limit: 200, min_score: minScore});
    if (search) params.set('city', search);
    if (acgFilter) params.set('acg_center', acgFilter);
    fetch(`${API}/mailer-targets?${params}`)
      .then(r => r.json()).then(d => {setTargets(d.targets||[]); setLoading(false);})
      .catch(() => setLoading(false));
  }, [search, minScore, acgFilter]);

  const acgCenters = [...new Set(targets.map(t=>t.nearest_acg_center).filter(Boolean))].sort();

  return <div className="p-5">
    <div className="flex items-center justify-between mb-5">
      <div>
        <h2 className="text-lg font-bold text-white">🎯 Luxury Mailer Targets</h2>
        <p className="text-[11px] text-slate-500 mt-0.5">Cities ranked by luxury crash volume × ACG proximity — DMV + CCRS cross-referenced</p>
      </div>
      <div className="flex items-center gap-2">
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search city..." className="px-3 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.06] text-xs text-white placeholder:text-slate-600 w-40 focus:outline-none focus:border-white/[0.12]"/>
        <select value={minScore} onChange={e=>setMinScore(Number(e.target.value))} className="px-2 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.06] text-xs text-white">
          <option value={0}>All scores</option><option value={30}>≥30</option><option value={35}>≥35</option><option value={38}>≥38</option>
        </select>
        <select value={acgFilter} onChange={e=>setAcgFilter(e.target.value)} className="px-2 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.06] text-xs text-white max-w-[160px]">
          <option value="">All centers</option>
          {acgCenters.map(c=><option key={c} value={c}>{c.replace('ACG ','')}</option>)}
        </select>
      </div>
    </div>

    {loading ? <Skeleton h={400}/> :
    <div className="rounded-xl border border-white/[0.06] overflow-hidden">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="bg-white/[0.02] text-slate-400 text-[10px] uppercase tracking-wider">
            <th className="text-left px-4 py-2.5 font-medium">City</th>
            <th className="text-right px-3 py-2.5 font-medium">Luxury Crashes</th>
            <th className="text-right px-3 py-2.5 font-medium">Total Crashes</th>
            <th className="text-right px-3 py-2.5 font-medium">Luxury %</th>
            <th className="text-left px-3 py-2.5 font-medium">Top Makes</th>
            <th className="text-left px-3 py-2.5 font-medium">Nearest ACG</th>
            <th className="text-right px-3 py-2.5 font-medium">Distance</th>
            <th className="text-right px-4 py-2.5 font-medium">Score</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.03]">
          {targets.map((t,i)=>{
            let makes = [];
            try { makes = JSON.parse(t.top_luxury_makes_crashed||'[]'); } catch(e){}
            const actionColors = {'HIGH PRIORITY':'text-red-400','MEDIUM':'text-amber-400','LOW':'text-slate-500'};
            return <tr key={i} className="hover:bg-white/[0.01] transition">
              <td className="px-4 py-2.5 text-white font-medium">{t.city}</td>
              <td className="px-3 py-2.5 text-right text-white tabular-nums">{t.luxury_crashes_2025?.toLocaleString()}</td>
              <td className="px-3 py-2.5 text-right text-slate-400 tabular-nums">{t.total_crashes_2025?.toLocaleString()}</td>
              <td className="px-3 py-2.5 text-right text-slate-300 tabular-nums">{t.luxury_crash_pct}%</td>
              <td className="px-3 py-2.5 text-slate-400 text-[10px]">{makes.slice(0,3).map(([m,c])=>`${m} (${c})`).join(', ')}</td>
              <td className="px-3 py-2.5 text-slate-400 text-[10px]">{t.nearest_acg_center?.replace('ACG ','')}</td>
              <td className="px-3 py-2.5 text-right text-slate-500 tabular-nums">{t.distance_to_acg_km}km</td>
              <td className={`px-4 py-2.5 text-right font-bold tabular-nums ${actionColors[t.recommended_action]||'text-slate-400'}`}>{t.mailer_priority_score}</td>
            </tr>;
          })}
        </tbody>
      </table>
    </div>}
  </div>;
}

// ── Tow Network View ─────────────────────────────────────────────────

function TowNetworkView() {
  const [towing, setTowing] = useState([]);
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [minRating, setMinRating] = useState(0);
  const [sourceFilter, setSourceFilter] = useState('');

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({limit: 500});
    if (search) params.set('city', search);
    if (minRating > 0) params.set('min_rating', minRating);
    fetch(`${API}/towing?${params}`)
      .then(r => r.json()).then(d => {setTowing(d.towing_services||[]); setLoading(false);})
      .catch(() => setLoading(false));
  }, [search, minRating]);

  useEffect(() => {
    fetch(`${API}/chp-offices`).then(r=>r.json()).then(d=>setSources(d.offices||[])).catch(()=>{});
  }, []);

  const filtered = sourceFilter ? towing.filter(t => (sourceFilter==='official' && t.source==='official_list') || (sourceFilter==='google' && t.source==='google_places')) : towing;

  return <div className="p-5">
    <div className="flex items-center justify-between mb-5">
      <div>
        <h2 className="text-lg font-bold text-white">🚛 Tow Network</h2>
        <p className="text-[11px] text-slate-500 mt-0.5">{towing.length} towing companies — Google Places + Official Police Lists (OPGLA, Whittier PD, Santa Ana PD)</p>
      </div>
      <div className="flex items-center gap-2">
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search city/name..." className="px-3 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.06] text-xs text-white placeholder:text-slate-600 w-40 focus:outline-none focus:border-white/[0.12]"/>
        <select value={minRating} onChange={e=>setMinRating(Number(e.target.value))} className="px-2 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.06] text-xs text-white">
          <option value={0}>All ratings</option><option value={4.0}>≥4.0 ★</option><option value={4.5}>≥4.5 ★</option>
        </select>
        <select value={sourceFilter} onChange={e=>setSourceFilter(e.target.value)} className="px-2 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.06] text-xs text-white">
          <option value="">All sources</option><option value="official">Official Lists</option><option value="google">Google Places</option>
        </select>
      </div>
    </div>

    {loading ? <Skeleton h={400}/> :
    <div className="rounded-xl border border-white/[0.06] overflow-hidden">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="bg-white/[0.02] text-slate-400 text-[10px] uppercase tracking-wider">
            <th className="text-left px-4 py-2.5 font-medium">Company</th>
            <th className="text-left px-3 py-2.5 font-medium">Phone</th>
            <th className="text-left px-3 py-2.5 font-medium">City/Area</th>
            <th className="text-right px-3 py-2.5 font-medium">★ Rating</th>
            <th className="text-right px-3 py-2.5 font-medium">Reviews</th>
            <th className="text-left px-3 py-2.5 font-medium">Source</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.03]">
          {filtered.map((t,i)=>{
            const isOfficial = t.source === 'official_list';
            return <tr key={i} className="hover:bg-white/[0.01] transition">
              <td className="px-4 py-2.5 text-white font-medium">
                {t.company_name}
                {t.website && <a href={t.website} target="_blank" rel="noopener noreferrer" className="ml-1.5 text-[9px] text-blue-400 hover:underline">web</a>}
              </td>
              <td className="px-3 py-2.5 text-slate-300">{t.phone||'—'}</td>
              <td className="px-3 py-2.5 text-slate-400 text-[10px]">{t.city||t.chp_area_name}</td>
              <td className="px-3 py-2.5 text-right">
                {t.google_rating > 0 ? <span className="text-amber-400 font-medium">{t.google_rating}</span> : <span className="text-slate-600">—</span>}
              </td>
              <td className="px-3 py-2.5 text-right text-slate-500 tabular-nums">{t.google_review_count > 0 ? t.google_review_count : '—'}</td>
              <td className="px-3 py-2.5">
                <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${isOfficial?'bg-blue-500/10 text-blue-400':'bg-slate-500/10 text-slate-400'}`}>
                  {isOfficial ? 'OFFICIAL' : 'Google'}
                </span>
              </td>
            </tr>;
          })}
        </tbody>
      </table>
    </div>}

    {/* CHP Offices section */}
    <div className="mt-6">
      <h3 className="text-sm font-bold text-white mb-3">🏛️ CHP Area Offices ({sources.length})</h3>
      <div className="grid grid-cols-3 gap-2">
        {sources.map((o,i)=>
          <div key={i} className="rounded-lg border border-white/[0.04] bg-white/[0.01] p-3 text-[10px]">
            <div className="text-white font-medium">{o.area_name} ({o.area_code})</div>
            <div className="text-slate-500 mt-0.5">{o.division} Division</div>
            <div className="text-slate-400 mt-1">{o.phone||'No phone'}</div>
            <div className="text-slate-600 mt-0.5">{o.address||''}</div>
            {o.notes && <div className="text-slate-500 mt-1 italic">{o.notes}</div>}
          </div>
        )}
      </div>
    </div>
  </div>;
}

// ── DMV Luxury View ──────────────────────────────────────────────────

function DmvLuxuryView() {
  const [mode, setMode] = useState('top-zips');
  const [data, setData] = useState([]);
  const [topZips, setTopZips] = useState(null);
  const [loading, setLoading] = useState(false);
  const [zip, setZip] = useState('');
  const [make, setMake] = useState('BMW');
  const [year, setYear] = useState('2025');
  const [searched, setSearched] = useState(false);

  const LUXURY_MAKES = ['BMW','MERCEDES-BENZ','TESLA','AUDI','PORSCHE','LAND ROVER','LEXUS','ACURA','CADILLAC','INFINITI','VOLVO','GENESIS','JAGUAR','LINCOLN','MASERATI','LUCID','RIVIAN','POLESTAR','MINI','FERRARI','BENTLEY','LAMBORGHINI','ASTON MARTIN','ALFA ROMEO','LOTUS','MAYBACH','ROLLS-ROYCE'];
  const AVAILABLE_YEARS = ['2025','2024','2023','2022','2020','2019'];

  // Auto-search when make/year changes in reverse mode
  useEffect(() => {
    if (mode === 'top-zips') {
      setLoading(true);
      setSearched(true);
      fetch(`${API}/dmv-top-zips?make=${encodeURIComponent(make)}&year=${year}&limit=20`)
        .then(r=>r.json()).then(d=>{setTopZips(d); setLoading(false);})
        .catch(()=>setLoading(false));
    }
  }, [make, year, mode]);

  const doZipSearch = () => {
    if (!zip && !make) return;
    setLoading(true);
    setSearched(true);
    const params = new URLSearchParams({limit: 100, year});
    if (zip) params.set('zip', zip);
    if (make && mode === 'by-zip') params.set('make', make);
    fetch(`${API}/dmv-luxury?${params}`)
      .then(r=>r.json()).then(d=>{setData(d.luxury_vehicles||[]); setLoading(false);})
      .catch(()=>setLoading(false));
  };

  return <div className="p-5">
    <div className="flex items-center justify-between mb-5">
      <div>
        <h2 className="text-lg font-bold text-white">🚗 DMV Luxury Vehicles</h2>
        <p className="text-[11px] text-slate-500 mt-0.5">California DMV registered luxury vehicles — 2025 data (3M+ records)</p>
      </div>
      {/* Mode toggle */}
      <div className="flex rounded-lg bg-white/[0.03] border border-white/[0.06] p-0.5">
        <button onClick={()=>setMode('top-zips')} className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${mode==='top-zips'?'bg-red-600 text-white':'text-slate-400 hover:text-white'}`}>📊 Top ZIPs by Make</button>
        <button onClick={()=>setMode('by-zip')} className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${mode==='by-zip'?'bg-red-600 text-white':'text-slate-400 hover:text-white'}`}>🔍 Search by ZIP</button>
      </div>
    </div>

    {mode === 'top-zips' ? (
      /* ── REVERSE MODE: Pick make → see top ZIPs ── */
      <>
        <div className="flex items-center gap-3 mb-5">
          <span className="text-xs text-slate-500">Brand:</span>
          <select value={make} onChange={e=>setMake(e.target.value)} className="px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.08] text-sm text-white font-medium focus:outline-none focus:border-red-500/50">
            {LUXURY_MAKES.map(m=><option key={m} value={m}>{m}</option>)}
          </select>
          <span className="text-xs text-slate-500 ml-2">Year:</span>
          <select value={year} onChange={e=>setYear(e.target.value)} className="px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.08] text-sm text-white font-medium focus:outline-none focus:border-red-500/50">
            {AVAILABLE_YEARS.map(y=><option key={y} value={y}>{y} snapshot</option>)}
          </select>
          <span className="text-[10px] text-slate-600 ml-1">({year==='2025'?'21.6M':year==='2024'?'21.3M':year==='2023'?'21.2M':'~21M'} vehicles)</span>
        </div>

        {loading ? <Skeleton h={400}/> :
        topZips && topZips.top_zips?.length > 0 ? <>
          {/* KPIs */}
          <div className="grid grid-cols-4 gap-3 mb-4">
            <KPI title={`Total ${make} in CA`} value={topZips.total_vehicles_across_zips} color={RED}/>
            <KPI title="ZIPs with vehicles" value={topZips.total_zips_found} color={GOLD}/>
            <KPI title="Top ZIP" value={topZips.top_zips[0]?.zip_code} color="#8b5cf6"/>
            <KPI title={`Top ZIP ${make}s`} value={topZips.top_zips[0]?.total_vehicles} color="#10b981"/>
          </div>
          {/* ZIP ranking table */}
          <div className="rounded-xl border border-white/[0.06] overflow-hidden">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="bg-white/[0.02] text-slate-400 text-[10px] uppercase tracking-wider">
                  <th className="text-left px-4 py-2.5 font-medium w-8">#</th>
                  <th className="text-left px-4 py-2.5 font-medium">ZIP Code</th>
                  <th className="text-right px-4 py-2.5 font-medium">{make} Vehicles</th>
                  <th className="text-right px-3 py-2.5 font-medium">Year Range</th>
                  <th className="text-left px-3 py-2.5 font-medium">Oldest–Newest</th>
                  <th className="text-right px-4 py-2.5 font-medium">% of CA Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.03]">
                {topZips.top_zips.map((z,i)=>{
                  const pct = topZips.total_vehicles_across_zips > 0 ? ((z.total_vehicles / topZips.total_vehicles_across_zips)*100).toFixed(1) : 0;
                  const barWidth = Math.max(2, (z.total_vehicles / (topZips.top_zips[0]?.total_vehicles||1))*100);
                  return <tr key={i} className="hover:bg-white/[0.01] transition">
                    <td className="px-4 py-2.5 text-slate-500 font-mono text-[10px]">{i+1}</td>
                    <td className="px-4 py-2.5 text-white font-bold">
                      <a href={`https://www.google.com/maps?q=${z.zip_code}+California`} target="_blank" rel="noopener noreferrer" className="hover:text-red-400 transition-colors underline decoration-dotted underline-offset-2 decoration-white/20 hover:decoration-red-400/50" title="Open in Google Maps">
                        {z.zip_code}
                      </a>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="h-1.5 rounded-full bg-red-600/30" style={{width:Math.max(8,barWidth*0.8)}}>
                          <div className="h-full rounded-full bg-red-500" style={{width:'100%'}}/>
                        </div>
                        <span className="text-white font-bold tabular-nums">{z.total_vehicles?.toLocaleString()}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right text-slate-400">{z.year_range} yrs</td>
                    <td className="px-3 py-2.5 text-slate-500 text-[10px]">{z.oldest_model}–{z.newest_model}</td>
                    <td className="px-4 py-2.5 text-right text-slate-400 tabular-nums">{pct}%</td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
        </> : <div className="text-slate-500 text-sm py-10 text-center">No data found for {make}</div>}
      </>
    ) : (
      /* ── FORWARD MODE: Pick ZIP → see vehicles ── */
      <>
        <div className="flex items-center gap-2 mb-5">
          <input value={zip} onChange={e=>setZip(e.target.value)} placeholder="ZIP Code (e.g. 90210)" onKeyDown={e=>e.key==='Enter'&&doZipSearch()} className="px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06] text-sm text-white placeholder:text-slate-600 w-44 focus:outline-none focus:border-white/[0.12]"/>
          <select value={make} onChange={e=>setMake(e.target.value)} className="px-2 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06] text-sm text-white">
            <option value="">All luxury makes</option>
            {LUXURY_MAKES.map(m=><option key={m} value={m}>{m}</option>)}
          </select>
          <select value={year} onChange={e=>setYear(e.target.value)} className="px-2 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06] text-sm text-white">
            {AVAILABLE_YEARS.map(y=><option key={y} value={y}>{y}</option>)}
          </select>
          <button onClick={doZipSearch} className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-500 transition">Search</button>
        </div>

        {loading ? <Skeleton h={300}/> :
        searched && data.length === 0 ? <div className="text-slate-500 text-sm py-10 text-center">No results. Try a ZIP code like 90210, 90024, 92648...</div> :
        data.length > 0 ? <>
          <div className="rounded-xl border border-white/[0.06] overflow-hidden">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="bg-white/[0.02] text-slate-400 text-[10px] uppercase tracking-wider">
                  <th className="text-left px-4 py-2.5 font-medium">ZIP Code</th>
                  <th className="text-left px-3 py-2.5 font-medium">Make</th>
                  <th className="text-right px-3 py-2.5 font-medium">Model Year</th>
                  <th className="text-left px-3 py-2.5 font-medium">Fuel Type</th>
                  <th className="text-right px-4 py-2.5 font-medium">Vehicles</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.03]">
                {data.map((d,i)=>
                  <tr key={i} className="hover:bg-white/[0.01] transition">
                    <td className="px-4 py-2.5 text-white font-medium">
                      <a href={`https://www.google.com/maps?q=${d.zip_code}+California`} target="_blank" rel="noopener noreferrer" className="hover:text-red-400 transition-colors underline decoration-dotted underline-offset-2 decoration-white/20 hover:decoration-red-400/50" title="Open in Google Maps">
                        {d.zip_code}
                      </a>
                    </td>
                    <td className="px-3 py-2.5 text-white">{d.make}</td>
                    <td className="px-3 py-2.5 text-right text-slate-400">{d.model_year}</td>
                    <td className="px-3 py-2.5 text-slate-400 text-[10px]">{d.fuel_type}</td>
                    <td className="px-4 py-2.5 text-right text-white font-bold tabular-nums">{d.count?.toLocaleString()}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {/* Quick Stats */}
          {(()=>{
            const total = data.reduce((s,d)=>s+(d.count||0),0);
            const makes = [...new Set(data.map(d=>d.make))];
            return <div className="mt-4 grid grid-cols-4 gap-3">
              <KPI title="Total Luxury Vehicles" value={total} color={RED}/>
              <KPI title="Unique Makes" value={makes.length} color={GOLD}/>
              <KPI title="Top Make" value={data[0]?.make} color="#8b5cf6"/>
              <KPI title="Records" value={data.length} color="#10b981"/>
            </div>;
          })()}
        </> : null}
      </>
    )}
  </div>;
}

// ── Claims Intel ──────────────────────────────────────────────────────

function ClaimsIntel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/claims-intel?year=2022&ccr_year=2025`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-5 space-y-4"><Skeleton h={100}/><Skeleton h={400}/></div>;
  if (!data) return <div className="p-10 text-center text-slate-500">No claims data available.</div>;

  const s = data.state_summary;
  const totalClaims = s.cdi_liability_claims + s.cdi_physical_damage_claims;
  const policePct = s.police_reported_pct;
  const nonPolicePct = 100 - policePct;

  return <div className="p-5 space-y-4">
    <div className="flex items-center justify-between">
      <div>
        <h2 className="text-lg font-bold text-white">💰 Claims Intelligence</h2>
        <p className="text-[11px] text-slate-500 mt-0.5">
          CDI Insurance Claims ({data.cdi_year}) × Police-Reported Crashes ({data.ccr_year}) — California
        </p>
      </div>
      <div className="text-[10px] text-slate-600">
        Source: California Department of Insurance · CCC Intelligent Solutions
      </div>
    </div>

    {/* HERO: The Gap */}
    <div className="rounded-2xl border border-amber-500/20 bg-gradient-to-br from-amber-500/[0.04] to-red-500/[0.02] p-5">
      <div className="flex items-center gap-6">
        <div className="flex-1">
          <div className="text-[10px] font-semibold text-amber-400 uppercase tracking-wider mb-2">📊 The Full Picture</div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <div className="text-[10px] text-slate-500 mb-1">🚔 Police-Reported Crashes</div>
              <div className="text-2xl font-bold text-white">{s.ccr_police_reported.toLocaleString()}</div>
              <div className="text-[10px] text-slate-500 mt-0.5">CCRS · Solo lo que ve la policía</div>
            </div>
            <div>
              <div className="text-[10px] text-slate-500 mb-1">📋 Total Insurance Claims</div>
              <div className="text-2xl font-bold text-amber-400">{totalClaims.toLocaleString()}</div>
              <div className="text-[10px] text-slate-500 mt-0.5">CDI · Claims reales reportados a aseguradoras</div>
            </div>
            <div>
              <div className="text-[10px] text-slate-500 mb-1">👻 Claims SIN policía</div>
              <div className="text-2xl font-bold text-red-400">{s.non_police_claims.toLocaleString()}</div>
              <div className="text-[10px] text-slate-500 mt-0.5">Rayones, parking, hail, choques menores...</div>
            </div>
          </div>

          {/* Gap visualization bar */}
          <div className="mt-4 bg-white/[0.03] rounded-xl p-3 border border-white/[0.04]">
            <div className="text-[10px] text-slate-500 mb-2">Proporción del mercado visible vs invisible</div>
            <div className="h-6 rounded-lg overflow-hidden flex">
              <div className="bg-blue-500/60 h-full flex items-center justify-center text-[9px] font-bold text-white"
                   style={{width: `${Math.min(policePct, 15)}%`}}>
                {policePct}%
              </div>
              <div className="bg-amber-500/60 h-full flex items-center justify-center text-[9px] font-bold text-white flex-1">
                {nonPolicePct}% — Claims SIN reporte policial
              </div>
            </div>
            <div className="text-[9px] text-slate-500 mt-1.5">
              Por cada 1 crash policial hay <strong className="text-white">{s.claims_per_crash}x</strong> claims de seguro
            </div>
          </div>
        </div>

        {/* Market value */}
        <div className="flex-shrink-0 w-56 rounded-xl border border-white/[0.06] bg-gradient-to-b from-white/[0.03] to-transparent p-4 text-center">
          <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">💰 CA Total Market</div>
          <div className="text-[28px] font-bold text-amber-400">
            ${(s.total_market_value / 1e9).toFixed(1)}B
          </div>
          <div className="text-[10px] text-slate-500 mt-1">
            ${s.total_market_value.toLocaleString()}
          </div>
          <div className="mt-3 pt-3 border-t border-white/[0.04] space-y-1">
            <div className="flex justify-between text-[10px]">
              <span className="text-slate-500">Avg Collision Claim</span>
              <span className="text-white">${s.avg_collision_claim.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-[10px]">
              <span className="text-slate-500">Vehicles Insured</span>
              <span className="text-white">{(s.total_exposures||0).toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-[10px]">
              <span className="text-slate-500">DMV Luxury Reg.</span>
              <span className="text-white">{s.dmv_luxury_total.toLocaleString()}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    {/* Claims by Type */}
    <div className="grid grid-cols-3 gap-4">
      <div className="rounded-2xl border border-white/[0.06] bg-gradient-to-b from-white/[0.02] to-transparent p-4">
        <div className="text-[11px] font-semibold text-white mb-3">📋 Liability Claims</div>
        <div className="text-2xl font-bold text-blue-400">{s.cdi_liability_claims.toLocaleString()}</div>
        <div className="text-[10px] text-slate-500 mt-1">
          Bodily Injury + Property Damage<br/>
          Avg claim: ${s.avg_collision_claim.toLocaleString()}
        </div>
      </div>
      <div className="rounded-2xl border border-white/[0.06] bg-gradient-to-b from-white/[0.02] to-transparent p-4">
        <div className="text-[11px] font-semibold text-white mb-3">🔧 Collision Claims</div>
        <div className="text-2xl font-bold text-amber-400">{s.cdi_collision_claims.toLocaleString()}</div>
        <div className="text-[10px] text-slate-500 mt-1">
          Choques con daño al vehículo<br/>
          Estos van a body shop → ACG
        </div>
      </div>
      <div className="rounded-2xl border border-red-500/10 bg-gradient-to-b from-red-500/[0.03] to-transparent p-4">
        <div className="text-[11px] font-semibold text-white mb-3">👻 Comprehensive (NO policía)</div>
        <div className="text-2xl font-bold text-red-400">{s.cdi_comprehensive_claims > 0 ? s.cdi_comprehensive_claims.toLocaleString() : '~605K'}</div>
        <div className="text-[10px] text-slate-500 mt-1">
          Hail, robo, vandalismo, parking lot<br/>
          <span className="text-red-400">NUNCA reportados a policía</span>
        </div>
      </div>
    </div>

    {/* County breakdown */}
    <div className="rounded-2xl border border-white/[0.06] bg-gradient-to-b from-white/[0.02] to-transparent p-5">
      <h3 className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-3">
        📍 Top Counties — Claims Est. (CDI data distributed by CCRS crash density)
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-[10px]">
          <thead>
            <tr className="text-slate-500 border-b border-white/[0.04]">
              <th className="text-left py-2 px-3 font-medium">County</th>
              <th className="text-right py-2 px-3 font-medium">Police Crashes</th>
              <th className="text-right py-2 px-3 font-medium">Est. Claims</th>
              <th className="text-right py-2 px-3 font-medium">Est. Market</th>
              <th className="text-right py-2 px-3 font-medium">Share</th>
            </tr>
          </thead>
          <tbody>
            {data.county_data.slice(0, 15).map((c, i) => (
              <tr key={i} className="border-b border-white/[0.02] hover:bg-white/[0.01]">
                <td className="py-2 px-3 text-slate-300 font-medium">#{c.county_code} ({c.sample_city})</td>
                <td className="py-2 px-3 text-right text-slate-400">{c.ccr_crashes.toLocaleString()}</td>
                <td className="py-2 px-3 text-right text-amber-400 font-medium">{c.est_total_claims.toLocaleString()}</td>
                <td className="py-2 px-3 text-right text-emerald-400 font-medium">${(c.est_market_value/1e6).toFixed(1)}M</td>
                <td className="py-2 px-3 text-right text-slate-500">{c.crash_share_pct}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>

    {/* Insurers + Customer Pay + Vehicle Types row */}
    <div className="grid grid-cols-2 gap-4">
      {/* Insurers */}
      <div className="rounded-2xl border border-white/[0.06] bg-gradient-to-b from-white/[0.02] to-transparent p-5">
        <h3 className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-3">
          🏢 Top Auto Insurers in CA (2024 CDI Data)
        </h3>
        <div className="space-y-1.5">
          {data.insurers?.slice(0, 12).map((ins, i) => (
            <div key={i} className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-white/[0.02]">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <span className="text-[10px] text-slate-600 w-5">{i+1}</span>
                <span className="text-[11px] text-slate-300 truncate">{ins.company_name.split(' - ')[0]}</span>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                <span className="text-[10px] text-slate-500">{(ins.market_share*100).toFixed(1)}%</span>
                <div className="w-16 h-1.5 rounded-full bg-white/[0.03]">
                  <div className="h-full rounded-full bg-blue-500/60" style={{width: `${ins.market_share*100}%`}}/>
                </div>
                <span className="text-[10px] text-slate-500">LR: {(ins.loss_ratio*100).toFixed(0)}%</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Customer Pay + Vehicle Types */}
      <div className="space-y-4">
        <div className="rounded-2xl border border-emerald-500/10 bg-gradient-to-b from-emerald-500/[0.04] to-transparent p-4">
          <div className="text-[11px] font-semibold text-emerald-400 uppercase tracking-wider mb-2">💵 Customer-Pay Market</div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] text-slate-500">% of repairs paid out-of-pocket</span>
            <span className="text-sm font-bold text-emerald-400">~{data.customer_pay?.pct || 20}%</span>
          </div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] text-slate-500">Customer-pay market value</span>
            <span className="text-sm font-bold text-white">${(data.customer_pay?.market_value/1e9 || 0).toFixed(1)}B</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-slate-500">Total market (ins + CP)</span>
            <span className="text-sm font-bold text-amber-400">${(data.customer_pay?.total_market_with_cp/1e9 || 0).toFixed(1)}B</span>
          </div>
          <div className="text-[9px] text-slate-600 mt-2 pt-2 border-t border-white/[0.04]">
            Rising from ~8% (2021) to ~20% (2025) due to premium increases. Higher margins, OEM parts, faster cycle times.
          </div>
        </div>

        <div className="rounded-2xl border border-white/[0.06] bg-gradient-to-b from-white/[0.02] to-transparent p-4">
          <h3 className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
            🚗 Vehicle Types in Crashes ({data.ccr_year})
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {data.vehicle_types?.slice(0, 8).map((vt, i) => (
              <span key={i} className="text-[10px] px-2 py-1 rounded-full bg-white/[0.03] text-slate-300 border border-white/[0.05]">
                {vt.vehicle_type} <span className="text-slate-500">{vt.crashes.toLocaleString()}</span>
              </span>
            ))}
          </div>
          {data.ev_crashes?.length > 0 && <div className="mt-2 pt-2 border-t border-white/[0.04]">
            <div className="text-[10px] text-slate-500 mb-1">⚡ EV Crashes (police-reported)</div>
            <div className="flex flex-wrap gap-1.5">
              {data.ev_crashes.map((ev, i) => (
                <span key={i} className="text-[10px] px-2 py-1 rounded-full bg-amber-500/[0.08] text-amber-400 border border-amber-500/[0.1]">
                  {ev.make} <span className="text-amber-500/70">{ev.crashes.toLocaleString()}</span>
                </span>
              ))}
            </div>
          </div>}
        </div>
      </div>
    </div>

    {/* ── MARKET INTELLIGENCE ── */}
    {data.market_intel && <>
      <div className="flex items-center gap-2 mt-2">
        <span className="text-lg">🏪</span>
        <h2 className="text-sm font-bold text-white">Market Intelligence</h2>
        <span className="text-[9px] px-2 py-0.5 rounded-full bg-white/[0.04] text-slate-500 border border-white/[0.06]">Industry Data 2024-2025</span>
      </div>

      {/* Shop Census + DRP */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-2xl border border-white/[0.06] bg-gradient-to-b from-white/[0.02] to-transparent p-4">
          <div className="text-[11px] font-semibold text-white mb-3">🔧 Body Shop Census (CA)</div>
          {[
            ['Total CA shops', data.market_intel.shops.ca_total.toLocaleString()],
            ['US total shops', data.market_intel.shops.us_total.toLocaleString()],
            ['CA per 100K pop', data.market_intel.shops.ca_per_100k.toFixed(1)],
            ['Independents', data.market_intel.shops.independent_pct + '%'],
            ['MSOs (3+ locations)', data.market_intel.shops.mso_pct + '%'],
            ['Regional chains', data.market_intel.shops.regional_chain_pct + '%'],
            ['Shops closed in 2024', '~' + data.market_intel.shops.closures_2024],
          ].map(([label, val], i) => (
            <div key={i} className="flex justify-between py-1.5 text-[10px] border-b border-white/[0.02]">
              <span className="text-slate-400">{label}</span>
              <span className="text-white font-medium">{val}</span>
            </div>
          ))}
        </div>

        <div className="rounded-2xl border border-white/[0.06] bg-gradient-to-b from-white/[0.02] to-transparent p-4">
          <div className="text-[11px] font-semibold text-white mb-3">🏢 DRP & Insurance Steering</div>
          {[
            ['Claims via DRP', data.market_intel.drp.pct_claims_through_drp + '%'],
            ['Top DRP network', data.market_intel.drp.top_insurer_drp],
            ['Customer-pay (no ins)', data.customer_pay?.pct + '%'],
            ['Ins-paid (all types)', (100 - data.customer_pay?.pct) + '%'],
            ['CA anti-steering law', 'YES — customer chooses'],
            ['DRP shop discount to insurer', '10-15% off labor'],
            ['Non-DRP shop rate premium', '+$10-15/hr labor'],
          ].map(([label, val], i) => (
            <div key={i} className="flex justify-between py-1.5 text-[10px] border-b border-white/[0.02]">
              <span className="text-slate-400">{label}</span>
              <span className="text-white font-medium">{val}</span>
            </div>
          ))}
        </div>

        <div className="rounded-2xl border border-emerald-500/10 bg-gradient-to-b from-emerald-500/[0.04] to-transparent p-4">
          <div className="text-[11px] font-semibold text-emerald-400 mb-3">💰 ACG Market Capture</div>
          <div className="text-center mb-3">
            <div className="text-3xl font-bold text-emerald-400">{data.market_intel.market_size.acg_market_share_pct}%</div>
            <div className="text-[10px] text-slate-500 mt-1">Current CA market share</div>
          </div>
          {[
            ['CA annual revenue', '$' + data.market_intel.market_size.ca_annual_revenue_billions + 'B'],
            ['ACG est. revenue', '$' + (data.market_intel.market_size.acg_estimated_revenue / 1e6).toFixed(0) + 'M/yr'],
            ['Avg shop revenue', '$' + (data.market_intel.market_size.avg_shop_revenue_ca / 1e6).toFixed(1) + 'M'],
            ['Top MSO per location', '$' + (data.market_intel.market_size.top_shop_revenue / 1e6).toFixed(0) + 'M'],
            ['Growth needed for 1%', '+' + Math.round(9/0.41).toLocaleString() + ' shops at current rate'],
            ['Addressable (50mi ACG)', '~$2.1B'],
            ['Capture potential', '$' + Math.round(2.1 * 0.02 * 1000) + 'M at 2% share'],
          ].map(([label, val], i) => (
            <div key={i} className="flex justify-between py-1.5 text-[10px] border-b border-white/[0.02]">
              <span className="text-slate-400">{label}</span>
              <span className="text-white font-medium">{val}</span>
            </div>
          ))}
        </div>
      </div>

      {/* MSO Landscape */}
      <div className="rounded-2xl border border-white/[0.06] bg-gradient-to-b from-white/[0.02] to-transparent p-5">
        <h3 className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-3">
          🦈 MSO Landscape — California Presence
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-[10px]">
            <thead>
              <tr className="text-slate-500 border-b border-white/[0.04]">
                <th className="text-left py-2 px-2 font-medium">MSO</th>
                <th className="text-right py-2 px-2 font-medium">US Locations</th>
                <th className="text-right py-2 px-2 font-medium">CA Locations</th>
                <th className="text-left py-2 px-2 font-medium">Position</th>
              </tr>
            </thead>
            <tbody>
              {data.market_intel.msos.map((m, i) => (
                <tr key={i} className="border-b border-white/[0.02] hover:bg-white/[0.01]">
                  <td className="py-2 px-2 text-slate-300 font-medium">{m.name}</td>
                  <td className="py-2 px-2 text-right text-slate-400">{m.us_locations.toLocaleString()}</td>
                  <td className="py-2 px-2 text-right text-amber-400 font-medium">{m.ca_locations}</td>
                  <td className="py-2 px-2 text-slate-500 text-[9px]">{m.market_position}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="text-[9px] text-slate-600 mt-2">
          MSOs (Multi-Shop Operators) = 3+ locations. Consolidators growing 15-22% per year. PE = Private Equity backed.
        </div>
      </div>

      {/* OEM Certifications + Repair Economics */}
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-2xl border border-white/[0.06] bg-gradient-to-b from-white/[0.02] to-transparent p-4">
          <h3 className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-3">
            🏭 OEM Certifications (% of certified shops)
          </h3>
          <div className="space-y-1.5">
            {data.market_intel.oem_certifications.top_certs.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-[10px] text-slate-400 w-28">{c.make}</span>
                <div className="flex-1 h-1.5 rounded-full bg-white/[0.03]">
                  <div className="h-full rounded-full bg-purple-500/60" style={{width: `${c.pct_of_certified}%`}}/>
                </div>
                <span className="text-[10px] text-slate-500 w-8 text-right">{c.pct_of_certified}%</span>
              </div>
            ))}
          </div>
          <div className="text-[9px] text-slate-600 mt-3">
            {data.market_intel.oem_certifications.pct_shops_certified}% of shops hold ≥1 OEM certification
          </div>
        </div>

        <div className="rounded-2xl border border-white/[0.06] bg-gradient-to-b from-white/[0.02] to-transparent p-4">
          <h3 className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-3">
            🔧 Repair Economics
          </h3>
          <div className="space-y-1.5">
            {[
              ['Avg repair cost (2025)', '$' + data.market_intel.repair_economics.avg_repair_cost_2025.toLocaleString()],
              ['10-year increase', '+' + data.market_intel.repair_economics.increase_10yr_pct + '% (was $2,169 in 2014)'],
              ['CA labor rate/hr', '$' + data.market_intel.repair_economics.labor_rate_ca],
              ['US avg labor rate/hr', '$' + data.market_intel.repair_economics.labor_rate_avg],
              ['Total loss %', data.market_intel.repair_economics.total_loss_pct + '% of claims'],
              ['Avg vehicle age repaired', data.market_intel.repair_economics.avg_vehicle_age_at_repair + ' years'],
              ['EV repair premium', '+' + data.market_intel.repair_economics.ev_repair_premium_pct + '% vs gas'],
            ].map(([label, val], i) => (
              <div key={i} className="flex justify-between py-1.5 text-[10px] border-b border-white/[0.02]">
                <span className="text-slate-400">{label}</span>
                <span className="text-white font-medium">{val}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-3 gap-1 text-center text-[9px]">
            <div className="rounded-lg bg-white/[0.02] p-2">
              <div className="text-white font-bold">{data.market_intel.repair_economics.oem_parts_pct}%</div>
              <div className="text-slate-500">OEM Parts</div>
            </div>
            <div className="rounded-lg bg-white/[0.02] p-2">
              <div className="text-white font-bold">{data.market_intel.repair_economics.aftermarket_parts_pct}%</div>
              <div className="text-slate-500">Aftermarket</div>
            </div>
            <div className="rounded-lg bg-white/[0.02] p-2">
              <div className="text-white font-bold">{data.market_intel.repair_economics.recycled_parts_pct}%</div>
              <div className="text-slate-500">Recycled</div>
            </div>
          </div>
        </div>
      </div>
    </>}

    {/* Luxury Claims */}
    <div className="rounded-2xl border border-white/[0.06] bg-gradient-to-b from-white/[0.02] to-transparent p-5">
      <h3 className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-3">
        🏎️ Luxury Brand Claims ({data.ccr_year} Police-Reported)
      </h3>
      <div className="flex flex-wrap gap-2">
        {data.luxury_claims.map((l, i) => (
          <div key={i} className="rounded-xl bg-white/[0.01] border border-white/[0.04] px-3 py-2 flex items-center gap-3">
            <span className="text-xs font-medium text-white">{l.make}</span>
            <span className="text-[10px] text-slate-500">{l.crashes.toLocaleString()} crashes</span>
            <span className="text-[10px] text-amber-400">{l.tow_aways.toLocaleString()} towed</span>
            <span className="text-[10px] text-red-400">{l.injury_rate}% injury</span>
          </div>
        ))}
      </div>
    </div>
  </div>;
}

// ── Revenue Radar ─────────────────────────────────────────────────────

function RevenueRadar() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedLoc, setSelectedLoc] = useState(null);

  useEffect(() => {
    fetch(`${API}/revenue-radar?year=2025`).then(r => r.json()).then(d => { setData(d); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-5 space-y-4"><Skeleton h={80}/><Skeleton h={400}/></div>;
  if (!data?.radar?.length) return <div className="p-10 text-center text-slate-500">No data available.</div>;

  const radar = data.radar;

  return <div className="p-5 space-y-4">
    <div className="flex items-center justify-between">
      <div>
        <h2 className="text-lg font-bold text-white">📡 Revenue Radar</h2>
        <p className="text-[11px] text-slate-500 mt-0.5">Inteligencia competitiva por ubicación — competidores, aseguradoras, reputación, oportunidad</p>
      </div>
    </div>

    {/* Top locations by opportunity */}
    <div className="grid grid-cols-4 gap-3">
      {radar.slice(0, 4).map((r, i) => (
        <button key={i} onClick={() => setSelectedLoc(selectedLoc?.acg_name === r.acg_name ? null : r)}
          className={`rounded-2xl p-4 text-left transition-all border ${
            selectedLoc?.acg_name === r.acg_name ? 'border-white/[0.12] bg-white/[0.04]' : 'border-white/[0.06] bg-gradient-to-b from-white/[0.02] to-transparent hover:border-white/[0.1]'}`}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-semibold text-white truncate">{r.acg_name}</span>
            <span className="text-[10px] font-bold text-amber-400">{r.opportunity_score}</span>
          </div>
          <div className="space-y-1 text-[9px]">
            <div className="flex justify-between"><span className="text-slate-500">{r.competitors_nearby} competidores</span><span className="text-slate-400">{r.monthly_crashes} crashes/mo</span></div>
            <div className="flex justify-between"><span className="text-slate-500">{r.reputation.google_rating}★ ({r.reputation.google_reviews})</span><span className="text-emerald-400">${(r.monthly_revenue_opportunity/1000).toFixed(0)}K opp</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Fleet luxury</span><span className="text-purple-400">{(r.fleet_luxury_10mi/1000).toFixed(0)}K</span></div>
          </div>
        </button>
      ))}
    </div>

    {/* Full radar table */}
    <div className="rounded-2xl border border-white/[0.06] bg-gradient-to-b from-white/[0.02] to-transparent p-5">
      <h3 className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-3">
        📊 Revenue Radar — All 13 ACG Locations
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-[10px]">
          <thead>
            <tr className="text-slate-500 border-b border-white/[0.04]">
              <th className="text-left py-2 px-2 font-medium">ACG Location</th>
              <th className="text-center py-2 px-2 font-medium">Score</th>
              <th className="text-center py-2 px-2 font-medium">Competitors</th>
              <th className="text-center py-2 px-2 font-medium">Reputation</th>
              <th className="text-center py-2 px-2 font-medium">Insurer Flow</th>
              <th className="text-right py-2 px-2 font-medium">Fleet Luxury</th>
              <th className="text-right py-2 px-2 font-medium">Monthly $ Opp</th>
            </tr>
          </thead>
          <tbody>
            {radar.map((r, i) => (
              <tr key={i} onClick={() => setSelectedLoc(selectedLoc?.acg_name === r.acg_name ? null : r)}
                className={`border-b border-white/[0.02] hover:bg-white/[0.01] cursor-pointer transition ${
                  selectedLoc?.acg_name === r.acg_name ? 'bg-white/[0.03]' : ''}`}>
                <td className="py-2.5 px-2 text-slate-300 font-medium">{r.acg_name}</td>
                <td className="py-2.5 px-2 text-center">
                  <span className={`px-2 py-1 rounded-full text-[9px] font-bold ${
                    r.opportunity_score >= 70 ? 'bg-emerald-500/15 text-emerald-400' :
                    r.opportunity_score >= 50 ? 'bg-amber-500/10 text-amber-400' : 'bg-slate-500/10 text-slate-400'}`}>
                    {r.opportunity_score}
                  </span>
                </td>
                <td className="py-2.5 px-2 text-center">
                  <div className="text-white font-medium">{r.competitors_nearby}</div>
                  <div className="text-[8px] text-slate-500">{r.nearest_competitors?.[0]?.split(' ')[0] || 'N/A'}</div>
                </td>
                <td className="py-2.5 px-2 text-center">
                  <div className="text-white">{r.reputation.google_rating}★</div>
                  <div className="text-[8px] text-slate-500">{r.reputation.google_reviews} reviews</div>
                </td>
                <td className="py-2.5 px-2 text-center">
                  <div className="text-[9px] text-slate-300">{r.insurer_flow?.[0]?.company}</div>
                  <div className="text-[8px] text-slate-500">{r.insurer_flow?.[0]?.market_share_pct}% share</div>
                </td>
                <td className="py-2.5 px-2 text-right text-purple-400 font-medium">{(r.fleet_luxury_10mi/1000).toFixed(0)}K</td>
                <td className="py-2.5 px-2 text-right text-emerald-400 font-medium">${(r.monthly_revenue_opportunity/1000).toFixed(0)}K</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>

    {/* Selected location detail */}
    {selectedLoc && <div className="rounded-2xl border border-white/[0.08] bg-gradient-to-b from-white/[0.03] to-transparent p-5">
      <h3 className="text-base font-bold text-white mb-4">📍 {selectedLoc.acg_name} — Opportunity Score: {selectedLoc.opportunity_score}</h3>

      <div className="grid grid-cols-3 gap-4 mb-4">
        {/* Competitors */}
        <div className="rounded-xl border border-red-500/10 bg-red-500/[0.03] p-4">
          <h4 className="text-[10px] font-semibold text-red-400 uppercase mb-2">🦈 Competitors Nearby</h4>
          {selectedLoc.competitors_nearby === 0 ? (
            <div className="text-emerald-400 text-xs">✅ No direct competitors within 15 miles</div>
          ) : (
            <div className="space-y-1.5">
              {selectedLoc.nearest_competitors?.map((c, i) => (
                <div key={i} className="flex justify-between text-[10px]">
                  <span className="text-slate-300">{c}</span>
                </div>
              ))}
            </div>
          )}
          <div className="mt-3 pt-3 border-t border-white/[0.04]">
            <div className="flex justify-between text-[10px]">
              <span className="text-slate-500">Competition Level</span>
              <span className={`font-bold ${selectedLoc.competitor_score > 60 ? 'text-red-400' : selectedLoc.competitor_score > 30 ? 'text-amber-400' : 'text-emerald-400'}`}>
                {selectedLoc.competitor_score > 60 ? 'HIGH' : selectedLoc.competitor_score > 30 ? 'MODERATE' : 'LOW'}
              </span>
            </div>
          </div>
        </div>

        {/* Reputation */}
        <div className="rounded-xl border border-blue-500/10 bg-blue-500/[0.03] p-4">
          <h4 className="text-[10px] font-semibold text-blue-400 uppercase mb-2">⭐ Reputation</h4>
          <div className="text-center">
            <div className="text-2xl font-bold text-white">{selectedLoc.reputation.google_rating}★</div>
            <div className="text-[10px] text-slate-500 mt-1">{selectedLoc.reputation.google_reviews} Google reviews</div>
          </div>
          <div className="mt-3 space-y-1 text-[10px]">
            <div className="flex justify-between"><span className="text-slate-500">Reputation Score</span><span className="text-white font-bold">{selectedLoc.reputation.score}/100</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Gap to 4.8★</span><span className="text-amber-400">+{Math.max(0, Math.round((4.8 - selectedLoc.reputation.google_rating) * 25))} reviews needed</span></div>
          </div>
        </div>

        {/* Insurer Flow */}
        <div className="rounded-xl border border-purple-500/10 bg-purple-500/[0.03] p-4">
          <h4 className="text-[10px] font-semibold text-purple-400 uppercase mb-2">🏢 Insurer Flow</h4>
          <div className="space-y-1.5">
            {selectedLoc.insurer_flow?.slice(0, 5).map((ins, i) => (
              <div key={i} className="flex items-center justify-between text-[10px]">
                <span className="text-slate-300 truncate max-w-[120px]">{ins.company}</span>
                <span className="text-slate-500">{ins.market_share_pct}% · {ins.est_monthly_claims} claims/mo</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Score Breakdown */}
      <div className="p-4 rounded-xl bg-white/[0.01] border border-white/[0.04]">
        <h4 className="text-[10px] font-semibold text-slate-500 uppercase mb-3">📊 Opportunity Score Breakdown</h4>
        <div className="grid grid-cols-4 gap-3">
          {[
            {label:'Low Competition',v:selectedLoc.score_breakdown.competition,color:'#10b981'},
            {label:'Reputation',v:selectedLoc.score_breakdown.reputation,color:'#3b82f6'},
            {label:'Luxury Density',v:selectedLoc.score_breakdown.luxury_density,color:'#a78bfa'},
            {label:'Crash Volume',v:selectedLoc.score_breakdown.crash_volume,color:'#f97316'},
          ].map((s, i) => (
            <div key={i} className="text-center">
              <div className="relative inline-flex items-center justify-center" style={{width:52,height:52}}>
                <svg width="52" height="52" viewBox="0 0 52 52" className="-rotate-90">
                  <circle cx="26" cy="26" r="22" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="3"/>
                  <circle cx="26" cy="26" r="22" fill="none" stroke={s.color} strokeWidth="3"
                    strokeDasharray={`${(s.v/100)*138} 138`} strokeLinecap="round"
                    style={{filter:`drop-shadow(0 0 3px ${s.color}44)`}}/>
                </svg>
                <span className="absolute text-[11px] font-bold text-white">{s.v}</span>
              </div>
              <div className="text-[8px] text-slate-500 mt-1">{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>}
  </div>;
}

// ── Sidebar ─────────────────────────────────────────────────────────

function Sidebar({view,setView}) {
  const items=[{id:'dashboard',icon:'◉',label:'Dashboard',desc:'KPIs & Trends'},{id:'forecast',icon:'🌧️',label:'Forecast',desc:'Crash Weather'},{id:'ad-intel',icon:'◆',label:'Ad Intel',desc:'Geo-Fence Zones'},{id:'radar',icon:'📡',label:'Revenue Radar',desc:'Intel Competitiva'},{id:'locations',icon:'◇',label:'ACG Centers',desc:'Location Intel'},{id:'map',icon:'○',label:'Heat Map',desc:'Interactive'},{id:'brands',icon:'▽',label:'Brands',desc:'Makes & Demographics'},{id:'mailer',icon:'🎯',label:'Mailer Targets',desc:'Luxury ZIP Targeting'},{id:'towing',icon:'🚛',label:'Tow Network',desc:'Grúas & CHP'},{id:'dmv',icon:'🚗',label:'DMV Luxury',desc:'Vehículos por ZIP'},{id:'claims',icon:'💰',label:'Claims Intel',desc:'Mercado Real'}];
  return <aside className="w-[200px] flex-shrink-0 flex flex-col bg-black/50 border-r border-white/[0.04] backdrop-blur-xl">
    <div className="p-4 border-b border-white/[0.04]">
      <img src={LOGO} alt="ACG" className="h-6 w-auto mb-2.5 opacity-80"/>
      <div className="flex items-center gap-2"><span className="relative flex h-1.5 w-1.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"/><span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-red-500"/></span><span className="text-[9px] uppercase tracking-[0.25em] text-slate-500 font-semibold">Crash Intel</span></div>
    </div>
    <nav className="flex-1 p-2 space-y-0.5">{items.map(item=><button key={item.id} onClick={()=>setView(item.id)} className={`w-full text-left px-3 py-2 rounded-xl transition-all duration-200 font-medium text-[12px] ${view===item.id?'bg-white/[0.04] text-white border border-white/[0.06]':'text-slate-500 hover:text-slate-300 border border-transparent hover:bg-white/[0.01]'}`}><div className="flex items-center gap-2.5"><span className="text-[10px]">{item.icon}</span><div><div className="font-semibold">{item.label}</div><div className="text-[9px] opacity-50">{item.desc}</div></div></div></button>)}</nav>
    <div className="p-3 border-t border-white/[0.04] text-[9px] text-slate-600">CHP CCRS 2016–2026<br/>ACG Command Center</div>
  </aside>;
}

// ── App ─────────────────────────────────────────────────────────────

export default function App() {
  const {filters,options,error:filterError,toggle,clearAll,fLoading}=useFilters();
  const {data,loading,error}=useDashboard(filters);
  const [view,setView]=useState('dashboard');

  if(filterError||error) return <div className="flex items-center justify-center h-screen bg-[#020617]">
    <div className="text-center"><div className="text-4xl mb-4">⚠️</div><div className="text-red-400 text-lg font-semibold mb-2">Connection Error</div><div className="text-slate-500 text-sm mb-5">{filterError||error}</div>
    <button onClick={()=>location.reload()} className="px-5 py-2.5 bg-white text-black rounded-xl text-sm font-semibold hover:bg-gray-200 transition">Retry</button></div></div>;

  if(fLoading) return <div className="flex items-center justify-center h-screen bg-[#020617]"><div className="flex items-center gap-3 text-slate-500 text-sm"><img src={LOGO} className="h-8 opacity-30"/><span className="animate-pulse">Loading…</span></div></div>;

  const s=data||{};
  const loadingAll = loading && !data;

  return <div className="flex h-screen bg-[#020617] overflow-hidden">
    <Sidebar view={view} setView={setView}/>

    <main className="flex-1 flex flex-col overflow-hidden">
      <FilterBar options={options} filters={filters} toggle={toggle} clearAll={clearAll}/>

      <div className="flex-1 overflow-y-auto" style={{display:view==='dashboard'?'block':'none'}}>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-5 gap-3">
            <KPI title="Total Incidents" value={s.stats?.total_crashes} loading={loadingAll}/>
            <KPI title="Injuries" value={s.stats?.total_injured} color={GOLD} loading={loadingAll}/>
            <KPI title="Fatalities" value={s.stats?.total_killed} color="#ef4444" loading={loadingAll}/>
            <KPI title="Avg Injuries" value={s.stats?.avg_injured_per_crash} color="#10b981" loading={loadingAll} suffix="/incident"/>
            <KPI title="Top Type" value={s.stats?.top_collision_type} color="#8b5cf6" loading={loadingAll}/>
          </div>
          <div className="grid grid-cols-3 gap-4" style={{height:380}}>
            <div className="col-span-2 rounded-2xl overflow-hidden border border-white/[0.06] shadow-2xl shadow-black/40" style={{height:380}}>
              <CrashMap filters={filters} mapKey={view}/>
            </div>
            <TopMakes makes={s.makes}/>
          </div>
          <div className="grid grid-cols-3 gap-4" style={{height:290}}>
            <div className="col-span-2"><TrendChart months={s.months}/></div>
            <CollisionDonut types={s.types}/>
          </div>
          <div className="grid grid-cols-2 gap-4" style={{height:280}}>
            <CityBars cities={s.cities}/>
            <DayHour days={s.days} hours={s.hours}/>
          </div>
          <div className="grid grid-cols-2 gap-4" style={{height:330}}>
            <LuxuryBrands luxury={s.luxury}/>
            <Demographics age_groups={s.age_groups}/>
          </div>
          <div className="h-6"/>
        </div>
      </div>

      <div className="flex-1 overflow-hidden" style={{display:view==='forecast'?'block':'none'}}>
        <ForecastView/>
      </div>

      <div className="flex-1 overflow-hidden" style={{display:view==='ad-intel'?'block':'none'}}>
        <AdIntel/>
      </div>

      <div className="flex-1 overflow-y-auto" style={{display:view==='locations'?'block':'none'}}>
        <AcgLocations filters={filters}/>
      </div>

      <div className="flex-1 p-3" style={{display:view==='map'?'block':'none'}}>
        <div className="rounded-2xl overflow-hidden h-full border border-white/[0.06] shadow-2xl shadow-black/40">
          <CrashMap filters={filters} mapKey={view}/>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto" style={{display:view==='brands'?'block':'none'}}>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4" style={{height:460}}><LuxuryBrands luxury={s.luxury}/><TopMakes makes={s.makes}/></div>
          <div style={{height:300}}><Demographics age_groups={s.age_groups}/></div>
          <div style={{height:290}}><CollisionDonut types={s.types}/></div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto" style={{display:view==='mailer'?'block':'none'}}>
        <MailerView/>
      </div>

      <div className="flex-1 overflow-y-auto" style={{display:view==='towing'?'block':'none'}}>
        <TowNetworkView/>
      </div>

      <div className="flex-1 overflow-y-auto" style={{display:view==='dmv'?'block':'none'}}>
        <DmvLuxuryView/>
      </div>

      <div className="flex-1 overflow-y-auto" style={{display:view==='claims'?'block':'none'}}>
        <ClaimsIntel/>
      </div>

      <div className="flex-1 overflow-y-auto" style={{display:view==='radar'?'block':'none'}}>
        <RevenueRadar/>
      </div>
    </main>
  </div>;
}

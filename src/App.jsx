import { useState, useEffect, useMemo } from "react";

/* ───────────────── DATA ───────────────── */
const SEASONS = { summer: "여름", winter: "겨울", spring: "봄" };
const SEASON_TEMPS = {
  summer: [26,25,25,24,24,24,28,30,31,32,33,33,33,33,32,31,30,29,28,27,27,26,26,26],
  winter: [-7,-8,-9,-10,-9,-8,-5,-3,0,1,2,2,2,0,-2,-3,-5,-6,-6,-7,-7,-7,-7,-7],
  spring: [9,8,7,6,6,8,12,14,16,17,18,18,18,17,15,13,12,11,10,10,9,9,9,9],
};
// 지중 온도 - 연중 거의 일정
const GROUND_TEMPS = { summer: 16.2, winter: 14.8, spring: 15.5 };

const BUILDING_FLOORS = [
  { id:"7F", label:"7F 회의실", type:"meeting" },
  { id:"6F", label:"6F 오피스", type:"office" },
  { id:"5F", label:"5F 오피스", type:"office" },
  { id:"4F", label:"4F 데이터센터", type:"datacenter" },
  { id:"3F", label:"3F 카페", type:"cafe" },
  { id:"2F", label:"2F 카페", type:"cafe" },
  { id:"1F", label:"1F 로비", type:"lobby" },
];

const B1_ZONES = [
  { id:"conf1", label:"Conference 1", w:"42%", h:"38%", x:"0%", y:"0%", type:"conference" },
  { id:"conf2", label:"Conference 2", w:"42%", h:"28%", x:"0%", y:"42%", type:"conference" },
  { id:"corridor", label:"Corridor", w:"25%", h:"28%", x:"20%", y:"42%", type:"corridor" },
  { id:"lobby", label:"Lobby", w:"55%", h:"68%", x:"45%", y:"0%", type:"lobby" },
  { id:"machine", label:"Machine Room (GSHP)", w:"45%", h:"30%", x:"0%", y:"72%", type:"machine" },
  { id:"restroom", label:"Restroom", w:"30%", h:"30%", x:"45%", y:"72%", type:"restroom" },
];

function computeData(season, hour, hmTemp, setTemp, ecoOn) {
  const oat = SEASON_TEMPS[season][hour];
  const groundTemp = GROUND_TEMPS[season];
  const isWork = hour >= 8 && hour <= 18;
  const isPeak = hour >= 13 && hour <= 15;
  const isHeatingMode = season === "winter";
  const isCoolingMode = !isHeatingMode;

  // GSHP COP — 지중 온도가 안정적이라 COP도 안정적
  let gshpCOP;
  if (isCoolingMode) {
    // 냉수 온도↑ → 리프트 감소 → COP↑
    gshpCOP = 5.0 + (hmTemp - 7) * 0.4;  // 4.2~7.0 범위
  } else {
    // 온수 온도↓ → 리프트 감소 → COP↑
    gshpCOP = 4.0 + (45 - hmTemp) * 0.08;  // 3.2~4.4 범위
  }

  const ecoActive = ecoOn && oat < 18 && isCoolingMode;
  const needsConditioning = isWork || isHeatingMode;
  const gshpRunning = needsConditioning && !ecoActive;

  const floors = BUILDING_FLOORS.map(f => {
    let temp, load;
    if (f.type === "datacenter") {
      temp = 19 + (isCoolingMode ? (hmTemp - 7) * 0.3 : 0);
      load = 85;
    } else if (isCoolingMode) {
      const occFactor = isWork ? (isPeak ? 0.9 : 0.6) : 0.1;
      if (f.type === "cafe") {
        temp = setTemp + (isPeak ? 1.2 : 0) + (oat > 30 ? 0.8 : 0);
        load = (setTemp < oat ? (oat - setTemp) * 4 : 5) * occFactor;
      } else if (f.type === "office") {
        temp = setTemp + (isPeak ? 1.0 : 0);
        load = (setTemp < oat ? (oat - setTemp) * 3.5 : 3) * occFactor;
      } else if (f.type === "meeting") {
        temp = setTemp - 0.5;
        load = isWork ? 15 : 3;
      } else {
        temp = setTemp + 0.5;
        load = isWork ? 25 : 5;
      }
      if (ecoActive) load *= 0.6;
    } else {
      // 난방 모드
      const occFactor = isWork ? (isPeak ? 0.9 : 0.6) : 0.2;
      if (f.type === "cafe") {
        temp = setTemp - 0.5;
        load = (setTemp - oat) * 2.2 * occFactor;
      } else if (f.type === "office") {
        temp = setTemp - 0.3;
        load = (setTemp - oat) * 2.0 * occFactor;
      } else if (f.type === "meeting") {
        temp = setTemp - 1;
        load = isWork ? 18 : 4;
      } else {
        temp = setTemp - 0.3;
        load = isWork ? 22 : 6;
      }
    }
    return { ...f, temp: Math.round(temp * 10) / 10, load: Math.min(Math.max(Math.round(load), 2), 100) };
  });

  const b1zones = B1_ZONES.map(z => {
    let temp, load;
    if (z.type === "conference") {
      temp = setTemp - (isCoolingMode ? 1 : 0.5);
      load = isWork ? 12 : 3;
    } else if (z.type === "lobby") {
      if (isCoolingMode) {
        temp = setTemp + (oat > 30 ? 2 : 0.5);
        load = isWork ? (isPeak ? 45 : 30) : 8;
      } else {
        temp = setTemp - 0.5;
        load = isWork ? 35 : 10;
      }
    } else if (z.type === "corridor") {
      temp = setTemp + 0.5;
      load = 8;
    } else if (z.type === "machine") {
      temp = gshpRunning ? 26 : 21;
      load = gshpRunning ? 45 : 5;
    } else {
      temp = setTemp + 1;
      load = 5;
    }
    if (ecoActive && isCoolingMode && z.type !== "machine" && z.type !== "restroom") load = Math.round(load * 0.6);
    return { ...z, temp: Math.round(temp * 10) / 10, load: Math.min(Math.max(load, 2), 100) };
  });

  // 에너지 계산 - GSHP + 팬 + 지중순환펌프
  const totalLoad = floors.reduce((s, f) => s + f.load, 0) * 0.12;
  const gshpPower = gshpRunning ? totalLoad / Math.max(gshpCOP, 1) : 0;
  const fanPower = isWork ? (isPeak ? 4.8 : 3.2) : 0.4;
  const pumpPower = gshpRunning ? 1.6 : 0.2;
  const totalEnergy = Math.round((gshpPower + fanPower + pumpPower + 2) * 10) / 10;

  return {
    oat, groundTemp, floors, b1zones, totalEnergy,
    fanPower: Math.round(fanPower * 10) / 10,
    gshpCOP: gshpRunning ? Math.round(gshpCOP * 10) / 10 : 0,
    gshpPower: Math.round(gshpPower * 10) / 10,
    pumpPower: Math.round(pumpPower * 10) / 10,
    gshpRunning, isHeatingMode, isCoolingMode, ecoActive,
  };
}

// 24시간 전체 데이터 계산 (그래프용)
function compute24h(season, hmTemp, setTemp, ecoOn) {
  return Array.from({length:24}, (_,h) => computeData(season, h, hmTemp, setTemp, ecoOn));
}

/* ───────────────── UTILS ───────────────── */
function tColor(t, a = 1) {
  const r = Math.max(12, Math.min(38, t));
  const ratio = (r - 12) / 26;
  return `rgba(${Math.round(40+ratio*210)},${Math.round(140-ratio*70)},${Math.round(240-ratio*190)},${a})`;
}

function arc(cx, cy, r, s, e) {
  const p = d => { const a=(d-90)*Math.PI/180; return {x:cx+r*Math.cos(a),y:cy+r*Math.sin(a)}; };
  const a=p(e), b=p(s);
  return `M${a.x} ${a.y}A${r} ${r} 0 ${e-s>180?1:0} 0 ${b.x} ${b.y}`;
}

function Gauge({v,max,unit,label,color,w=72}){
  const a=Math.min(v/max,1)*240-120, r=w/2-7;
  return <div style={{textAlign:"center",width:w+12}}>
    <svg width={w} height={w*.65} viewBox={`0 0 ${w} ${w*.65}`}>
      <path d={arc(w/2,w*.56,r,-120,120)} fill="none" stroke="rgba(255,255,255,.06)" strokeWidth={4.5} strokeLinecap="round"/>
      <path d={arc(w/2,w*.56,r,-120,a)} fill="none" stroke={color} strokeWidth={4.5} strokeLinecap="round" style={{transition:"all .5s"}}/>
      <text x={w/2} y={w*.5} textAnchor="middle" fill="#e0e0e0" fontSize={w*.21} fontWeight="700" style={{fontFamily:"'DM Mono',monospace"}}>{v.toFixed(1)}</text>
      <text x={w/2} y={w*.5+w*.12} textAnchor="middle" fill="rgba(255,255,255,.3)" fontSize={w*.09} style={{fontFamily:"'DM Mono',monospace"}}>{unit}</text>
    </svg>
    <div style={{fontSize:9,color:"rgba(255,255,255,.35)",marginTop:-2,letterSpacing:".04em"}}>{label}</div>
  </div>;
}

// 멀티 라인 차트 - 여러 시리즈를 겹쳐서 보여줌
function LineChart({series, currentHour, unit="kW", height=180}) {
  const width = 500;
  const padL = 36, padR = 14, padT = 12, padB = 22;
  const chartW = width - padL - padR;
  const chartH = height - padT - padB;

  const allValues = series.flatMap(s => s.data);
  const max = Math.max(...allValues, 0.1) * 1.15;
  const min = 0;

  const xAt = h => padL + (h / 23) * chartW;
  const yAt = v => padT + chartH - ((v - min) / (max - min)) * chartH;

  const yTicks = [0, max*0.25, max*0.5, max*0.75, max];

  return <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{display:"block"}}>
    {/* Grid lines */}
    {yTicks.map((v,i) => <g key={i}>
      <line x1={padL} y1={yAt(v)} x2={width-padR} y2={yAt(v)} stroke="rgba(255,255,255,.04)" strokeWidth={1}/>
      <text x={padL-4} y={yAt(v)+3} textAnchor="end" fontSize={8} fill="rgba(255,255,255,.25)" style={{fontFamily:"'DM Mono',monospace"}}>{v.toFixed(v<10?1:0)}</text>
    </g>)}

    {/* Business hours shade */}
    <rect x={xAt(8)} y={padT} width={xAt(18)-xAt(8)} height={chartH} fill="rgba(100,181,246,.03)"/>

    {/* X axis labels */}
    {[0,6,12,18,23].map(h => <text key={h} x={xAt(h)} y={height-6} textAnchor="middle" fontSize={8} fill="rgba(255,255,255,.3)" style={{fontFamily:"'DM Mono',monospace"}}>{String(h).padStart(2,"0")}</text>)}

    {/* Series - stacked area or lines */}
    {series.map((s,i) => {
      const points = s.data.map((v,h) => `${xAt(h)},${yAt(v)}`).join(" ");
      const areaPath = `M ${xAt(0)},${yAt(0)} L ${s.data.map((v,h)=>`${xAt(h)},${yAt(v)}`).join(" L ")} L ${xAt(23)},${yAt(0)} Z`;
      return <g key={s.name}>
        {s.filled !== false && <path d={areaPath} fill={s.color} fillOpacity={0.15}/>}
        <polyline points={points} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" style={{filter:`drop-shadow(0 0 4px ${s.color}40)`}}/>
      </g>;
    })}

    {/* Current hour marker */}
    <line x1={xAt(currentHour)} y1={padT} x2={xAt(currentHour)} y2={padT+chartH} stroke="#fff" strokeWidth={1} strokeDasharray="3 3" opacity={0.4}/>
    <circle cx={xAt(currentHour)} cy={padT-6} r={3} fill="#fff"/>

    {/* Current value labels */}
    {series.map((s,i) => {
      const y = yAt(s.data[currentHour]);
      return <g key={"mark-"+s.name}>
        <circle cx={xAt(currentHour)} cy={y} r={3.5} fill={s.color} stroke="#080b10" strokeWidth={1.5}/>
      </g>;
    })}

    {/* Unit label */}
    <text x={padL-4} y={padT-4} textAnchor="end" fontSize={8} fill="rgba(255,255,255,.25)" style={{fontFamily:"'DM Mono',monospace"}}>{unit}</text>
  </svg>;
}

// 차트 범례
function ChartLegend({series, data24, currentHour}) {
  return <div style={{display:"flex",flexWrap:"wrap",gap:"6px 10px",marginTop:6,padding:"6px 8px",background:"rgba(0,0,0,.15)",borderRadius:6}}>
    {series.map(s => <div key={s.name} style={{display:"flex",alignItems:"center",gap:4,fontSize:10}}>
      <div style={{width:8,height:2,background:s.color,borderRadius:1}}/>
      <span style={{color:"rgba(255,255,255,.55)"}}>{s.name}</span>
      <span style={{...mono, color:s.color, fontWeight:600}}>{s.data[currentHour].toFixed(1)}</span>
    </div>)}
  </div>;
}

const P = {background:"rgba(255,255,255,.025)",borderRadius:12,border:"1px solid rgba(255,255,255,.05)"};
const mono = {fontFamily:"'DM Mono',monospace"};

/* ───────────────── COMPONENT ───────────────── */
export default function App(){
  const [season,setSeason]=useState("summer");
  const [hour,setHour]=useState(14);
  const [chwTemp,setChwTemp]=useState(7);    // 냉수 (5~12°C)
  const [hwTemp,setHwTemp]=useState(45);     // 온수 (40~55°C)
  const [setTemp,setSetTemp]=useState(24);
  const [ecoOn,setEcoOn]=useState(false);
  const [selZone,setSelZone]=useState(null);
  const [selFloor,setSelFloor]=useState(null);
  const [chartView,setChartView]=useState("equipment");

  const isHeating = season === "winter";
  const hmTemp = isHeating ? hwTemp : chwTemp;
  const setHmTemp = isHeating ? setHwTemp : setChwTemp;

  const data = useMemo(()=>computeData(season,hour,hmTemp,setTemp,ecoOn),[season,hour,hmTemp,setTemp,ecoOn]);
  const base = useMemo(()=>computeData(season,hour,isHeating?45:7,24,false),[season,hour,isHeating]);

  // 24시간 시계열 데이터
  const data24 = useMemo(()=>compute24h(season,hmTemp,setTemp,ecoOn),[season,hmTemp,setTemp,ecoOn]);

  // 설비별 시리즈 (kW)
  const equipmentSeries = useMemo(()=>[
    { name:"GSHP", color:"#66bb6a", data: data24.map(d=>d.gshpPower) },
    { name:"AHU 팬", color:"#ab47bc", data: data24.map(d=>d.fanPower) },
    { name:"지중펌프", color:"#8d6e63", data: data24.map(d=>d.pumpPower) },
    { name:"기타", color:"#78909c", data: data24.map(()=>2) },
  ],[data24]);

  // 층별 전력 시리즈 (층 부하 × 환산 계수)
  const floorColors = {
    "1F":"#ffb74d", "2F":"#e57373", "3F":"#f06292",
    "4F":"#42a5f5", "5F":"#81c784", "6F":"#9575cd", "7F":"#4dd0e1",
  };
  const floorSeries = useMemo(()=>{
    return BUILDING_FLOORS.map(f => ({
      name: f.id,
      color: floorColors[f.id],
      data: data24.map(d => {
        const floor = d.floors.find(x=>x.id===f.id);
        return Math.round(floor.load * 0.08 * 10) / 10;
      }),
    }));
  },[data24]);

  const fh = h => `${String(h).padStart(2,"0")}:00`;
  const diff = (cur,bas,goodIfLow=true) => {
    const d=cur-bas;const g=goodIfLow?d<0:d>0;
    return{d,g,c:d===0?"rgba(255,255,255,.15)":g?"#43a047":"#e53935",t:d===0?"—":`${d>0?"+":""}${d.toFixed(1)}`};
  };

  const insights = useMemo(()=>{
    const m=[];
    if(chwTemp===7&&hwTemp===45&&setTemp===24&&!ecoOn)
      m.push({t:"슬라이더와 토글을 조작하여 에너지 변화를 확인해보세요",c:"rgba(255,255,255,.3)"});
    if(isHeating)
      m.push({t:"난방 시즌: GSHP 난방 모드 — 가스 사용 없음",c:"#64b5f6"});
    if(isHeating&&hwTemp!==45)
      m.push({t:`온수 ${hwTemp}°C → 난방 COP ${(4.0+(45-hwTemp)*0.08).toFixed(1)} — 지열은 사계절 최적화 가능`,c:"#66bb6a"});
    if(!isHeating&&chwTemp>7&&data.gshpRunning)
      m.push({t:`냉수 ${chwTemp}°C → 냉방 COP ${(5.0+(chwTemp-7)*0.4).toFixed(1)}로 개선`,c:"#66bb6a"});
    if(!isHeating&&chwTemp>=10)
      m.push({t:"⚠ 10°C 이상 제습 능력 저하 주의",c:"#ffa726"});
    if(setTemp>24&&!isHeating)
      m.push({t:`설정 ${setTemp}°C → 냉방 에너지 약 ${Math.round((setTemp-24)*8)}% 절감`,c:"#66bb6a"});
    if(setTemp>=28)
      m.push({t:"⚠ 28°C 이상 쾌적성 저하 — 카페 고객 이탈 우려",c:"#ffa726"});
    if(setTemp<24&&!isHeating)
      m.push({t:`설정 ${setTemp}°C → 냉방 에너지 약 ${Math.round((24-setTemp)*12)}% 증가`,c:"#e53935"});
    if(ecoOn&&data.oat<18&&!isHeating)
      m.push({t:"외기 냉방 활성: GSHP 가동 시간 대폭 감소",c:"#66bb6a"});
    if(ecoOn&&data.oat>=18)
      m.push({t:`외기 ${data.oat}°C — 18°C 이하에서 활성화됩니다`,c:"rgba(255,255,255,.35)"});
    if(selFloor==="4F"&&isHeating)
      m.push({t:"데이터센터는 겨울에도 24시간 냉방 유지 필요",c:"#64b5f6"});
    if(season==="spring"&&!ecoOn)
      m.push({t:"봄철 외기 활용 가능 — 이코노마이저를 켜보세요",c:"#81c784"});
    // 외기 vs 지중 온도차 인사이트
    const diff_oat = Math.abs(data.oat - data.groundTemp);
    if(diff_oat > 15)
      m.push({t:`외기 ${data.oat}°C vs 지중 ${data.groundTemp}°C → GSHP가 공기열원 대비 유리한 조건`,c:"#4fc3f7"});
    return m;
  },[season,hour,chwTemp,hwTemp,setTemp,ecoOn,data,selFloor,isHeating]);

  return <div style={{minHeight:"100vh",background:"#080b10",color:"#e0e0e0",fontFamily:"'Pretendard','Noto Sans KR',system-ui,sans-serif"}}>
    <link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Sora:wght@300;500;700;800&display=swap" rel="stylesheet"/>
    <style>{`input[type=range]{-webkit-appearance:none;background:transparent;cursor:pointer;height:20px}input[type=range]::-webkit-slider-runnable-track{height:3px;border-radius:2px;background:rgba(255,255,255,.08)}input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;border-radius:50%;background:#fff;margin-top:-5.5px;box-shadow:0 0 6px rgba(0,0,0,.4)}`}</style>

    <div style={{position:"fixed",inset:0,opacity:.015,backgroundImage:"radial-gradient(rgba(255,255,255,.5) 1px,transparent 1px)",backgroundSize:"24px 24px",pointerEvents:"none"}}/>

    <div style={{position:"relative",zIndex:1,padding:"24px 28px"}}>
      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",marginBottom:20,borderBottom:"1px solid rgba(255,255,255,.04)",paddingBottom:16}}>
        <div>
          <div style={{fontSize:9,letterSpacing:".25em",color:"rgba(255,255,255,.2)",textTransform:"uppercase"}}>Mossland · EnergyPlus Simulation · GSHP</div>
          <h1 style={{fontFamily:"'Sora',sans-serif",fontWeight:800,fontSize:22,margin:"4px 0 0",color:"#f0f0f0",letterSpacing:"-.02em"}}>에너지 시뮬레이션 <span style={{fontSize:12,color:"#66bb6a",fontWeight:500,marginLeft:8}}>· 지열 히트펌프</span></h1>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div style={{padding:"4px 10px",background:"rgba(102,187,106,.1)",border:"1px solid rgba(102,187,106,.2)",borderRadius:4,fontSize:9,color:"#66bb6a",...mono,fontWeight:600,letterSpacing:".08em"}}>NO GAS · 100% ELECTRIC</div>
          <div style={{fontSize:9,color:"rgba(255,255,255,.18)",...mono}}>ASHRAE 90.1 · 에너지절약설계기준</div>
        </div>
      </div>

      <div style={{display:"flex",gap:16}}>
        {/* ── LEFT ── */}
        <div style={{flex:"0 0 300px",display:"flex",flexDirection:"column",gap:10}}>
          {/* B1F Zone Map */}
          <div style={{...P,padding:"12px"}}>
            <div style={{fontSize:9,color:"rgba(255,255,255,.2)",letterSpacing:".08em",marginBottom:8}}>B1F — Hub 평면도</div>
            <div style={{position:"relative",width:"100%",paddingBottom:"75%",background:"rgba(0,0,0,.2)",borderRadius:8,overflow:"hidden"}}>
              {data.b1zones.map(z=>{
                const act=selZone===z.id;
                return <div key={z.id} onClick={()=>setSelZone(act?null:z.id)} style={{
                  position:"absolute",left:z.x,top:z.y,width:z.w,height:z.h,
                  background:tColor(z.temp,act?.45:.2),border:act?`1.5px solid ${tColor(z.temp,.8)}`:"1px solid rgba(255,255,255,.06)",
                  cursor:"pointer",transition:"all .4s",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:4,
                }}>
                  <div style={{fontSize:z.type==="machine"?8:9,fontWeight:600,color:"rgba(255,255,255,.6)",textAlign:"center",lineHeight:1.2}}>{z.label}</div>
                  <div style={{fontSize:15,fontWeight:700,...mono,color:"#f0f0f0"}}>{z.temp}°</div>
                </div>;
              })}
            </div>
            {selZone&&(()=>{const z=data.b1zones.find(x=>x.id===selZone);return <div style={{marginTop:8,padding:10,background:"rgba(0,0,0,.5)",borderRadius:8,border:"1px solid rgba(255,255,255,.06)"}}>
              <div style={{fontSize:12,fontWeight:700,marginBottom:4}}>{z.label}</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"3px 12px",fontSize:10,...mono}}>
                <span style={{color:"rgba(255,255,255,.3)"}}>온도</span><span>{z.temp}°C</span>
                <span style={{color:"rgba(255,255,255,.3)"}}>부하</span><span>{z.load}%</span>
                <span style={{color:"rgba(255,255,255,.3)"}}>유형</span><span>{z.type}</span>
              </div>
            </div>;})()}
          </div>

          {/* Building Floors */}
          <div style={{...P,padding:"12px",flex:1}}>
            <div style={{fontSize:9,color:"rgba(255,255,255,.2)",letterSpacing:".08em",marginBottom:8}}>층별 에너지</div>
            {data.floors.map(f=>{
              const act=selFloor===f.id;
              return <div key={f.id} onClick={()=>{setSelFloor(act?null:f.id);setSelZone(null);}} style={{
                display:"flex",alignItems:"center",gap:8,padding:"5px 8px",marginBottom:3,borderRadius:6,cursor:"pointer",transition:"all .3s",
                background:act?"rgba(255,255,255,.06)":"transparent",border:act?"1px solid rgba(255,255,255,.08)":"1px solid transparent",
              }}>
                <div style={{width:32,fontSize:10,fontWeight:600,...mono,color:f.type==="datacenter"?"#42a5f5":"rgba(255,255,255,.5)"}}>{f.id}</div>
                <div style={{flex:1,height:6,background:"rgba(255,255,255,.04)",borderRadius:3,overflow:"hidden"}}>
                  <div style={{height:"100%",width:`${f.load}%`,background:tColor(f.temp,.6),borderRadius:3,transition:"width .5s"}}/>
                </div>
                <div style={{width:36,fontSize:10,...mono,textAlign:"right",color:tColor(f.temp,.9)}}>{f.temp}°</div>
                <div style={{width:28,fontSize:9,...mono,textAlign:"right",color:"rgba(255,255,255,.25)"}}>{f.load}%</div>
              </div>;
            })}
          </div>

          {/* 지중 열교환기 시각화 */}
          <div style={{...P,padding:"12px"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <span style={{fontSize:9,color:"rgba(255,255,255,.2)",letterSpacing:".08em"}}>지중 열교환기</span>
              <span style={{fontSize:10,...mono,color:"#8d6e63"}}>연중 {data.groundTemp}°C</span>
            </div>
            <div style={{position:"relative",height:50,background:"linear-gradient(180deg, rgba(139,110,99,0) 0%, rgba(93,64,55,.4) 100%)",borderRadius:6,overflow:"hidden"}}>
              {[20,40,60,80].map(x=><div key={x} style={{position:"absolute",left:`${x}%`,top:4,bottom:4,width:2,background:"linear-gradient(180deg,rgba(102,187,106,.3),rgba(139,110,99,.6))",borderRadius:1}}/>)}
              <div style={{position:"absolute",top:6,left:6,fontSize:8,color:"rgba(255,255,255,.3)",...mono}}>외기 {data.oat}°C</div>
              <div style={{position:"absolute",bottom:4,right:6,fontSize:8,color:"rgba(141,110,99,.9)",...mono}}>지중 {data.groundTemp}°C</div>
            </div>
            <div style={{fontSize:9,color:"rgba(255,255,255,.3)",marginTop:6,lineHeight:1.4}}>지중 온도는 외기 {Math.abs(data.oat-data.groundTemp).toFixed(0)}°C 차이에도 <span style={{color:"#8d6e63",fontWeight:600}}>연중 안정</span></div>
          </div>
        </div>

        {/* ── CENTER ── */}
        <div style={{flex:1,display:"flex",flexDirection:"column",gap:10}}>
          {/* Controls */}
          <div style={{...P,padding:"14px 18px"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
              <div style={{fontFamily:"'Sora',sans-serif",fontWeight:700,fontSize:13}}>What-if 시나리오</div>
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                <div style={{fontSize:10,...mono,color:tColor(data.oat,.7)}}>외기 {data.oat}°C</div>
                <div style={{width:1,height:10,background:"rgba(255,255,255,.1)"}}/>
                <div style={{fontSize:10,...mono,color:isHeating?"#ef5350":"#26c6da",fontWeight:600}}>{isHeating?"난방 모드":"냉방 모드"}</div>
              </div>
            </div>

            <div style={{display:"flex",gap:12,marginBottom:14,alignItems:"flex-end"}}>
              <div style={{flex:"0 0 auto"}}>
                <div style={{fontSize:9,color:"rgba(255,255,255,.25)",marginBottom:4}}>계절</div>
                <div style={{display:"flex",gap:2}}>
                  {Object.entries(SEASONS).map(([k,v])=><button key={k} onClick={()=>setSeason(k)} style={{
                    padding:"5px 12px",borderRadius:5,border:"none",cursor:"pointer",fontSize:11,fontWeight:600,transition:"all .2s",
                    background:season===k?"rgba(255,255,255,.1)":"transparent",color:season===k?"#f0f0f0":"rgba(255,255,255,.25)",
                  }}>{v}</button>)}
                </div>
              </div>
              <div style={{flex:1}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                  <span style={{fontSize:9,color:"rgba(255,255,255,.25)"}}>시각</span>
                  <span style={{fontSize:12,...mono,color:"#64b5f6",fontWeight:600}}>{fh(hour)}</span>
                </div>
                <input type="range" min={0} max={23} step={1} value={hour} onChange={e=>setHour(+e.target.value)} style={{width:"100%"}}/>
              </div>
            </div>

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 16px"}}>
              <div style={{marginBottom:10}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                  <span style={{fontSize:9,color:"rgba(255,255,255,.25)"}}>
                    {isHeating?"온수 공급 온도":"냉수 공급 온도"}
                    <span style={{fontSize:8,color:"rgba(255,255,255,.15)",marginLeft:4}}>({isHeating?"40~55°C":"5~12°C"})</span>
                  </span>
                  <span style={{fontSize:11,...mono,color:isHeating?"#ef5350":"#26c6da",fontWeight:600}}>{hmTemp}°C</span>
                </div>
                <input
                  type="range"
                  min={isHeating?40:5}
                  max={isHeating?55:12}
                  step={1}
                  value={hmTemp}
                  onChange={e=>setHmTemp(+e.target.value)}
                  style={{width:"100%"}}
                />
              </div>
              <div style={{marginBottom:10}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                  <span style={{fontSize:9,color:"rgba(255,255,255,.25)"}}>실내 설정 온도</span>
                  <span style={{fontSize:11,...mono,color:"#ffa726",fontWeight:600}}>{setTemp}°C</span>
                </div>
                <input type="range" min={22} max={28} step={1} value={setTemp} onChange={e=>setSetTemp(+e.target.value)} style={{width:"100%"}}/>
              </div>
            </div>

            <div style={{display:"flex",alignItems:"center",gap:8,marginTop:2}}>
              <div onClick={()=>setEcoOn(!ecoOn)} style={{width:36,height:19,borderRadius:10,padding:2,cursor:"pointer",transition:"all .3s",background:ecoOn?"#43a047":"rgba(255,255,255,.08)"}}>
                <div style={{width:15,height:15,borderRadius:8,background:"#fff",transition:"all .3s",transform:ecoOn?"translateX(17px)":"translateX(0)"}}/>
              </div>
              <span style={{fontSize:11,color:"rgba(255,255,255,.45)"}}>이코노마이저 (외기냉방)</span>
              {data.ecoActive&&<span style={{fontSize:9,color:"#43a047",fontWeight:600,...mono}}>ACTIVE</span>}
              {isHeating&&<span style={{fontSize:9,color:"rgba(255,255,255,.2)",...mono}}>(난방 시 비활성)</span>}
            </div>
          </div>

          {/* Gauges - 보일러 대신 지중온도 */}
          <div style={{...P,display:"flex",justifyContent:"center",gap:4,padding:"10px 12px"}}>
            <Gauge v={data.oat} max={40} unit="°C" label="외기" color="#ff9800" w={72}/>
            <Gauge v={data.totalEnergy} max={40} unit="kW" label="총 전력" color="#42a5f5" w={72}/>
            <Gauge v={data.gshpCOP} max={8} unit="COP" label="GSHP" color="#66bb6a" w={72}/>
            <Gauge v={data.fanPower} max={6} unit="kW" label="팬" color="#ab47bc" w={72}/>
            <Gauge v={data.groundTemp} max={30} unit="°C" label="지중" color="#8d6e63" w={72}/>
          </div>

          {/* Comparison Cards */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
            {[
              {label:"총 에너지",cur:data.totalEnergy,bas:base.totalEnergy,unit:"kW",c:"#42a5f5",low:true},
              {label:"GSHP COP",cur:data.gshpCOP,bas:base.gshpCOP,unit:"",c:"#66bb6a",low:false},
              {label:"팬 전력",cur:data.fanPower,bas:base.fanPower,unit:"kW",c:"#ab47bc",low:true},
            ].map((m,i)=>{const d=diff(m.cur,m.bas,m.low);return <div key={i} style={{...P,padding:"12px",textAlign:"center"}}>
              <div style={{fontSize:9,color:"rgba(255,255,255,.2)",marginBottom:4}}>{m.label}</div>
              <div style={{fontSize:20,fontWeight:700,...mono,color:m.c}}>{m.cur.toFixed(1)}<span style={{fontSize:9,color:"rgba(255,255,255,.2)"}}> {m.unit}</span></div>
              <div style={{fontSize:10,...mono,marginTop:2,color:d.c}}>{d.t}</div>
            </div>;})}
          </div>

          {/* 24h Chart Viewer with dropdown */}
          <div style={{...P,padding:"12px 16px",flex:1}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <div style={{fontSize:10,color:"rgba(255,255,255,.4)",...mono}}>24시간 시계열</div>
              <select
                value={chartView}
                onChange={e=>setChartView(e.target.value)}
                style={{
                  background:"rgba(0,0,0,.4)",
                  color:"#e0e0e0",
                  border:"1px solid rgba(255,255,255,.1)",
                  borderRadius:4,
                  padding:"3px 8px",
                  fontSize:11,
                  cursor:"pointer",
                  outline:"none",
                  fontFamily:"'Pretendard','Noto Sans KR',system-ui,sans-serif",
                }}
              >
                <option value="equipment">설비별 전력</option>
                <option value="floor">층별 전력</option>
                <option value="zoneLoad">존별 부하율</option>
              </select>
            </div>

            {chartView === "zoneLoad" && (
              <>
                <div style={{fontSize:9,color:"rgba(255,255,255,.18)",marginBottom:4}}>기준 대비 현재 설정 · 부하율(%)</div>
                {data.floors.map(f=>{
                  const bf=base.floors.find(x=>x.id===f.id);
                  const d=f.load-bf.load;
                  return <div key={f.id} style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
                    <span style={{fontSize:9,width:24,...mono,color:f.type==="datacenter"?"#42a5f5":"rgba(255,255,255,.35)",fontWeight:600}}>{f.id}</span>
                    <div style={{flex:1,height:10,background:"rgba(255,255,255,.025)",borderRadius:3,position:"relative",overflow:"hidden"}}>
                      <div style={{position:"absolute",top:0,left:0,height:"45%",width:`${bf.load}%`,background:"rgba(255,255,255,.07)",transition:"width .5s"}}/>
                      <div style={{position:"absolute",bottom:0,left:0,height:"45%",width:`${f.load}%`,background:tColor(f.temp,.4),transition:"width .5s"}}/>
                    </div>
                    <span style={{fontSize:9,...mono,width:28,textAlign:"right",color:d>2?"#ef5350":d<-2?"#43a047":"rgba(255,255,255,.2)"}}>{f.load}%</span>
                  </div>;
                })}
                <div style={{fontSize:8,color:"rgba(255,255,255,.15)",marginTop:4,...mono}}>▫ 상단: 기본값 &nbsp;▪ 하단: 현재</div>
              </>
            )}

            {chartView === "equipment" && (
              <>
                <LineChart series={equipmentSeries} currentHour={hour} unit="kW" height={180}/>
                <ChartLegend series={equipmentSeries} data24={data24} currentHour={hour}/>
              </>
            )}

            {chartView === "floor" && (
              <>
                <LineChart series={floorSeries} currentHour={hour} unit="kW" height={180}/>
                <ChartLegend series={floorSeries} data24={data24} currentHour={hour}/>
              </>
            )}

            {data.ecoActive&&<div style={{marginTop:10,padding:"7px 10px",background:"rgba(67,160,71,.06)",borderRadius:6,border:"1px solid rgba(67,160,71,.1)",fontSize:10,color:"#66bb6a"}}>🌿 이코노마이저 활성: 냉방 에너지 약 40% 절감</div>}
            {isHeating&&<div style={{marginTop:10,padding:"7px 10px",background:"rgba(100,181,246,.06)",borderRadius:6,border:"1px solid rgba(100,181,246,.1)",fontSize:10,color:"#64b5f6"}}>❄ GSHP 난방 모드: 지중 {data.groundTemp}°C에서 열 추출 · 가스 사용 0</div>}
          </div>
        </div>

        {/* ── RIGHT ── */}
        <div style={{flex:"0 0 185px",display:"flex",flexDirection:"column",gap:10}}>
          {/* Equipment status - 지열용으로 변경 */}
          <div style={{...P,padding:"12px"}}>
            <div style={{fontSize:9,color:"rgba(255,255,255,.18)",marginBottom:8,letterSpacing:".06em"}}>설비 상태</div>
            {[
              {n:"GSHP",on:data.gshpRunning,v:data.gshpRunning?`COP ${data.gshpCOP} · ${isHeating?"난방":"냉방"}`:"정지",c:"#66bb6a"},
              {n:"지중순환펌프",on:data.gshpRunning,v:data.gshpRunning?`${data.pumpPower}kW`:"정지",c:"#8d6e63"},
              {n:"AHU",on:data.fanPower>1,v:`${data.fanPower}kW`,c:"#ff9800"},
              {n:"PTHP 6F",on:true,v:"가동",c:"#ab47bc"},
              {n:"PTHP 7F",on:true,v:"가동",c:"#ab47bc"},
              {n:"가스",on:false,v:"미사용",c:"#555"},
            ].map((it,i)=><div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 0",borderBottom:i<5?"1px solid rgba(255,255,255,.02)":"none"}}>
              <div style={{display:"flex",alignItems:"center",gap:5}}>
                <div style={{width:4,height:4,borderRadius:"50%",background:it.on?it.c:"rgba(255,255,255,.1)",boxShadow:it.on?`0 0 5px ${it.c}30`:"none",transition:"all .4s"}}/>
                <span style={{fontSize:10,color:"rgba(255,255,255,.4)"}}>{it.n}</span>
              </div>
              <span style={{fontSize:9,...mono,color:it.on?it.c:"rgba(255,255,255,.15)"}}>{it.v}</span>
            </div>)}
          </div>

          {/* Current settings */}
          <div style={{...P,padding:"12px"}}>
            <div style={{fontSize:9,color:"rgba(255,255,255,.18)",marginBottom:6}}>현재 설정</div>
            {[
              {l:"계절",v:SEASONS[season],c:"#fff"},
              {l:"시각",v:fh(hour),c:"#64b5f6"},
              {l:"외기",v:`${data.oat}°C`,c:"#ff9800"},
              {l:"지중",v:`${data.groundTemp}°C`,c:"#8d6e63"},
              {l:isHeating?"온수":"냉수",v:`${hmTemp}°C`,c:isHeating?"#ef5350":"#26c6da"},
              {l:"설정",v:`${setTemp}°C`,c:"#ffa726"},
              {l:"ECO",v:ecoOn?"ON":"OFF",c:ecoOn?"#43a047":"#555"},
            ].map((x,i)=><div key={i} style={{display:"flex",justifyContent:"space-between",padding:"3px 0"}}>
              <span style={{fontSize:9,color:"rgba(255,255,255,.25)"}}>{x.l}</span>
              <span style={{fontSize:10,...mono,color:x.c,fontWeight:500}}>{x.v}</span>
            </div>)}
          </div>

          {/* Insights */}
          <div style={{...P,padding:"12px",flex:1,overflow:"auto"}}>
            <div style={{fontSize:9,color:"rgba(255,255,255,.18)",marginBottom:6}}>💡 인사이트</div>
            {insights.length===0?<div style={{fontSize:10,color:"rgba(255,255,255,.2)"}}>파라미터를 조작해보세요</div>
            :insights.map((m,i)=><div key={i} style={{fontSize:10,color:m.c,lineHeight:1.6,marginBottom:4}}>{m.t}</div>)}
          </div>
        </div>
      </div>
    </div>
  </div>;
}

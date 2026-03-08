import { useState, useCallback, useEffect, useRef, memo } from "react";

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=JetBrains+Mono:wght@400;600;700&family=Noto+Sans+JP:wght@400;500;700;900&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --navy:#0B1628;--navy2:#142038;--navy3:#1E3050;
  --blue:#1D6FE8;--blue-light:#3B82F6;
  --green:#16A34A;--green-light:#22C55E;
  --amber:#D97706;--amber-light:#F59E0B;
  --red:#DC2626;--red-light:#EF4444;
  --slate:#64748B;--slate-light:#94A3B8;
  --white:#F8FAFC;--dim:#CBD5E1;
  --surface:#162035;--surface2:#1C2B45;--surface3:#243550;
  --border:rgba(255,255,255,0.08);--border2:rgba(255,255,255,0.14);
  --shadow:0 4px 24px rgba(0,0,0,0.4);
  --glow-blue:0 0 20px rgba(29,111,232,0.3);
  --glow-green:0 0 20px rgba(34,197,94,0.3);
  --radius:12px;
  --font-display:'Bebas Neue',sans-serif;
  --font-mono:'JetBrains Mono',monospace;
  --font-body:'Noto Sans JP',sans-serif;
}
html,body,#root{height:100%;width:100%;overflow:hidden;}
body{background:var(--navy);color:var(--white);-webkit-font-smoothing:antialiased;}
#root{height:100dvh;display:flex;flex-direction:column;max-width:480px;margin:0 auto;background:var(--navy)}
.app-body{flex:1;overflow:hidden;display:flex;flex-direction:column}
.app-body::-webkit-scrollbar{width:3px}
.app-body::-webkit-scrollbar-thumb{background:var(--border2);border-radius:2px}
button{-webkit-tap-highlight-color:transparent;user-select:none;}
@keyframes notifAnim {
  0%   { opacity:0; transform:translateY(-10px); }
  10%  { opacity:1; transform:translateY(0); }
  80%  { opacity:1; transform:translateY(0); }
  100% { opacity:0; transform:translateY(-8px); }
}
@keyframes pulse {
  0%,100% { opacity:1; }
  50%      { opacity:0.4; }
}
@keyframes spin {
  from { transform:rotate(0deg); }
  to   { transform:rotate(360deg); }
}
`;

// ═══════════════════════════════════════════════════════════════════
//  RUNNER LOGIC
// ═══════════════════════════════════════════════════════════════════
function hitAdvance(bases, advance) {
  let runs = 0, rbi = 0;
  let { first, second, third } = bases;
  const runners = [third ? 3 : null, second ? 2 : null, first ? 1 : null].filter(Boolean);
  runners.forEach(b => { if (b + advance > 3) { runs++; rbi++; } });
  first = false; second = false; third = false;
  runners.forEach(b => { const n = b + advance; if (n === 1) first = true; if (n === 2) second = true; if (n === 3) third = true; });
  if (advance === 4) { runs++; rbi++; } else if (advance === 3) third = true; else if (advance === 2) second = true; else first = true;
  return { bases: { first, second, third }, runs, outs: 0, rbi };
}
function walkAdvance(bases) {
  let runs = 0, { first, second, third } = bases;
  if (first && second && third) runs++;
  if (second && first) third = true; if (first) second = true; first = true;
  return { bases: { first, second, third }, runs, outs: 0, rbi: runs };
}
function resolvePlay(bases, t) {
  switch (t) {
    case "single": return hitAdvance(bases, 1); case "double": return hitAdvance(bases, 2);
    case "triple": return hitAdvance(bases, 3); case "home_run": return hitAdvance(bases, 4);
    case "walk": return walkAdvance(bases);
    case "ground_out": case "fly_out": case "strikeout": return { bases, runs: 0, outs: 1, rbi: 0 };
    case "sac_fly": { let { first, second, third } = bases, runs = 0, rbi = 0; if (third) { runs = 1; rbi = 1; third = false; } return { bases: { first, second, third }, runs, outs: 1, rbi }; }
    case "double_play": { let { first, second, third } = bases; if (first) first = false; return { bases: { first: false, second, third }, runs: 0, outs: 2, rbi: 0 }; }
    default: return { bases, runs: 0, outs: 0, rbi: 0 };
  }
}
function derivePlayType(pitch) {
  // 新しい result 体系
  if (pitch.result === "out")  return pitch.battedType === "ground" ? "ground_out" : "fly_out";
  if (pitch.result === "hit")  return pitch.hitType  || "single";
  if (pitch.result === "reach") return pitch.reachType === "fielding_error" ? "ground_out" : "ground_out"; // 走者は出るがアウトカウントなし
  // 旧 inplay 互換
  if (!pitch.outcome) return "fly_out";
  if (pitch.outcome === "out") return pitch.battedType === "ground" ? "ground_out" : "fly_out";
  if (pitch.outcome === "hit") return pitch.hitType || "single";
  return "single";
}
function checkInningEnd(s) {
  if (s.outs < 3) return s;
  if (s.half === "top") return { ...s, half: "bottom", outs: 0, balls: 0, strikes: 0, bases: { first: false, second: false, third: false } };
  return { ...s, half: "top", inning: s.inning + 1, outs: 0, balls: 0, strikes: 0, bases: { first: false, second: false, third: false } };
}

// ═══════════════════════════════════════════════════════════════════
//  FLICK LOGIC
// ═══════════════════════════════════════════════════════════════════
// 8方向: 上=0, 右上=1, 右=2, 右下=3, 下=4, 左下=5, 左=6, 左上=7, タップ=8
const PITCH_FLICK = {
  8: "ストレート", 0: "カーブ",    1: "スライダー", 2: "カット",
  3: "チェンジ",   4: "フォーク",  5: "シンカー",   6: "ツーシーム", 7: "シュート",
};
// 4方向 + タップ
const RESULT_FLICK = {
  0: "strike_looking", 2: "ball", 4: "strike_swinging",
};
const PITCH_COLORS = {
  "ストレート":"#E2E8F0","スライダー":"#60A5FA","カーブ":"#A78BFA","フォーク":"#F87171",
  "チェンジ":"#34D399","カット":"#FBBF24","シンカー":"#FB923C","ツーシーム":"#38BDF8","シュート":"#F472B6",
};
const RESULT_INFO = {
  strike_looking: { short:"見逃し",   color:"#3B82F6", icon:"👁",  hint:"↑" },
  strike_swinging:{ short:"空振り",   color:"#F59E0B", icon:"💨", hint:"↓" },
  foul:           { short:"ファウル", color:"#94A3B8", icon:"⚡",  hint:"←" },
  ball:           { short:"ボール",   color:"#22C55E", icon:"✓",   hint:"→" },
  inplay:         { short:"インプレー",color:"#EF4444",icon:"🔥", hint:"●" },
  hit:            { short:"安打",     color:"#22C55E", icon:"⚾",  hint:"" },
  out:            { short:"アウト",   color:"#EF4444", icon:"🚫",  hint:"" },
  reach:          { short:"出塁",     color:"#F59E0B", icon:"🟡",  hint:"" },
};

function getDir8(dx, dy, th = 16) {
  const d = Math.hypot(dx, dy);
  if (d < th) return 8;
  const a = Math.atan2(dy, dx) * 180 / Math.PI;
  if (a >= -22.5 && a < 22.5)   return 2;
  if (a >= 22.5  && a < 67.5)   return 3;
  if (a >= 67.5  && a < 112.5)  return 4;
  if (a >= 112.5 && a < 157.5)  return 5;
  if (a >= 157.5 || a < -157.5) return 6;
  if (a >= -157.5 && a < -112.5) return 7;
  if (a >= -112.5 && a < -67.5) return 0;
  return 1;
}
function getDir4(dx, dy, th = 18) {
  const d = Math.hypot(dx, dy);
  if (d < th) return 8;
  const a = Math.atan2(dy, dx) * 180 / Math.PI;
  if (a >= -45 && a < 45)   return 2;
  if (a >= 45  && a < 135)  return 4;
  if (a >= 135 || a < -135) return 6;
  return 0;
}

// ═══════════════════════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════════════════════
const EMPTY_LINEUP = Array.from({length:9}, (_,i) => ({ name:"", order: i+1 }));
const INIT_GAME = { inning:1,half:"top",balls:0,strikes:0,outs:0,bases:{first:false,second:false,third:false},score:{home:0,away:0},pitchHistory:[],history:[],redoStack:[],lineup:{home:[...EMPTY_LINEUP.map(p=>({...p}))],away:[...EMPTY_LINEUP.map(p=>({...p}))]},batterIdx:{home:0,away:0},pitcher:{home:"",away:""} };
const INIT_PITCH = { pitchType:null,zone:null,result:null,battedType:null,landingPos:null,direction:null,outcome:null,speed:null,hitType:null,reachType:null,batter:null };

function gameReducer(state, action) {
  switch (action.type) {
    case "RECORD_PITCH": {
      const snap = { inning:state.inning,half:state.half,balls:state.balls,strikes:state.strikes,outs:state.outs,bases:{...state.bases},score:{...state.score},pitchHistory:state.pitchHistory };
      // 新しい投球が来たらredoをクリア
      const p = action.pitch;
      const currentSide = state.half === "top" ? "away" : "home";
      const currentBatterName = state.lineup[currentSide][state.batterIdx[currentSide]]?.name || `#${state.batterIdx[currentSide] + 1}`;
      const newPH = [...state.pitchHistory, {
        ...p,
        pitchNumber: state.pitchHistory.length + 1,
        inning: state.inning,
        half:   state.half,
        batter: currentBatterName,
        pitcher: state.pitcher[currentSide === "away" ? "home" : "away"] || `P`, // 守備側=ピッチャー
        // 投球時点の BSO・走者状態をスナップショット
        ballsBefore:   state.balls,
        strikesBefore: state.strikes,
        outsBefore:    state.outs,
        basesBefore:   { ...state.bases },
      }];
      let next = { ...state, pitchHistory:newPH, history:[...state.history,snap], redoStack:[] };
      // 打席終了判定 → 次の打者へ
      const _side = state.half === "top" ? "away" : "home";
      const _isPA_End = (
        (p.result==="strike_looking"||p.result==="strike_swinging") && state.strikes===2 // 三振
        || p.result==="ball" && state.balls===3                                           // 四球
        || p.result==="hit" || p.result==="reach"                                         // 安打・出塁
        || p.result==="out"                                                               // アウト
        || (p.result==="inplay" && p.outcome)                                            // inplay確定
      );
      if (_isPA_End) {
        const _nextIdx = (state.batterIdx[_side] + 1) % 9;
        next = { ...next, batterIdx: { ...next.batterIdx, [_side]: _nextIdx } };
      }
      if (p.result==="strike_looking"||p.result==="strike_swinging") {
        if (next.strikes<2) next={...next,strikes:next.strikes+1};
        else { next={...next,outs:next.outs+1,balls:0,strikes:0}; next=checkInningEnd(next); }
      } else if (p.result==="foul") { if (next.strikes<2) next={...next,strikes:next.strikes+1}; }
      else if (p.result==="ball") {
        if (next.balls<3) next={...next,balls:next.balls+1};
        else { const r=walkAdvance(next.bases),side=next.half==="top"?"away":"home"; next={...next,bases:r.bases,score:{...next.score,[side]:next.score[side]+r.runs},balls:0,strikes:0}; }
      } else if (p.result==="inplay"&&p.outcome) {
        const r=resolvePlay(next.bases,derivePlayType(p)),side=next.half==="top"?"away":"home";
        next={...next,bases:r.bases,outs:next.outs+r.outs,score:{...next.score,[side]:next.score[side]+r.runs},balls:0,strikes:0};
        next=checkInningEnd(next);
      } else if (p.result==="hit") {
        const r=resolvePlay(next.bases,p.hitType||"single"),side=next.half==="top"?"away":"home";
        next={...next,bases:r.bases,outs:next.outs+r.outs,score:{...next.score,[side]:next.score[side]+r.runs},balls:0,strikes:0};
        next=checkInningEnd(next);
      } else if (p.result==="out") {
        const r=resolvePlay(next.bases,p.battedType==="ground"?"ground_out":"fly_out"),side=next.half==="top"?"away":"home";
        next={...next,bases:r.bases,outs:next.outs+r.outs,score:{...next.score,[side]:next.score[side]+r.runs},balls:0,strikes:0};
        next=checkInningEnd(next);
      } else if (p.result==="reach") {
        // エラー/野選: 打者は一塁へ（walkAdvanceと同じ処理）
        const r=walkAdvance(next.bases),side=next.half==="top"?"away":"home";
        next={...next,bases:r.bases,score:{...next.score,[side]:next.score[side]+r.runs},balls:0,strikes:0};
      }
      return next;
    }
    case "UNDO": {
      if (!state.history.length) return state;
      const last = state.history[state.history.length - 1];
      // 現在のゲーム状態をredoスタックに積む
      const redoSnap = { inning:state.inning,half:state.half,balls:state.balls,strikes:state.strikes,outs:state.outs,bases:{...state.bases},score:{...state.score},pitchHistory:state.pitchHistory };
      return { ...state, ...last, history:state.history.slice(0,-1), redoStack:[...state.redoStack, redoSnap] };
    }
    case "REDO": {
      if (!state.redoStack.length) return state;
      const next = state.redoStack[state.redoStack.length - 1];
      const undoSnap = { inning:state.inning,half:state.half,balls:state.balls,strikes:state.strikes,outs:state.outs,bases:{...state.bases},score:{...state.score},pitchHistory:state.pitchHistory };
      return { ...state, ...next, history:[...state.history, undoSnap], redoStack:state.redoStack.slice(0,-1) };
    }
    case "TOGGLE_BASE": return {...state,bases:{...state.bases,[action.base]:!state.bases[action.base]}};
    case "NEXT_BATTER": {
      const side = state.half === "top" ? "away" : "home";
      const next = (state.batterIdx[side] + 1) % 9;
      return {...state, batterIdx:{...state.batterIdx,[side]:next}};
    }
    case "SET_BATTER": {
      const {side,idx} = action;
      return {...state, batterIdx:{...state.batterIdx,[side]:idx}};
    }
    case "SET_LINEUP": {
      const {side,lineup} = action;
      return {...state, lineup:{...state.lineup,[side]:lineup}};
    }
    case "SET_PITCHER": {
      const {side, name} = action;
      return {...state, pitcher:{...state.pitcher, [side]:name}};
    }
    case "SUBSTITUTE": {
      const {side,order,name} = action; // order: 0-8
      const newLineup = state.lineup[side].map((p,i) => i===order ? {...p,name} : p);
      return {...state, lineup:{...state.lineup,[side]:newLineup}};
    }
    case "RESET": return {...INIT_GAME};
    default: return state;
  }
}

// ═══════════════════════════════════════════════════════════════════
//  PITCH FLICK WHEEL
//  押した瞬間に放射状ポップアップが中心円から展開。
//  ポップアップは overflow:visible な親div + position:absolute で
//  トリガー自身が pointer イベントを全て処理する。
// ═══════════════════════════════════════════════════════════════════
const PitchFlickWheel = memo(({ selected, onSelect, speed, onSpeed }) => {
  const [active, setActive]   = useState(false);
  const [dir, setDir]         = useState(8);
  const start = useRef(null);

  const DA = {0:-90, 1:-45, 2:0, 3:45, 4:90, 5:135, 6:180, 7:-135};
  const R  = 78; // ラベルまでの距離 px（中心円の外側）

  const onDown = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { x: e.clientX, y: e.clientY };
    setActive(true);
    setDir(8);
  };
  const onMove = (e) => {
    if (!start.current) return;
    setDir(getDir8(e.clientX - start.current.x, e.clientY - start.current.y, 18));
  };
  const onUp = (e) => {
    if (!start.current) return;
    const d  = getDir8(e.clientX - start.current.x, e.clientY - start.current.y, 18);
    const pt = PITCH_FLICK[d];
    if (pt) onSelect(pt);
    start.current = null;
    setActive(false);
    setDir(8);
  };
  const onCancel = () => { start.current = null; setActive(false); setDir(8); };

  const curPt  = active ? PITCH_FLICK[dir]  : null;
  const selCol = selected ? PITCH_COLORS[selected] : null;
  const curCol = curPt   ? PITCH_COLORS[curPt]    : null;
  const ringCol = active ? (curCol || "#3B82F6") : selCol ? selCol + "99" : "var(--border2)";

  return (
    <div style={{background:"var(--surface)", borderBottom:"1px solid var(--border)",
                 padding:"4px 12px 4px", display:"flex", alignItems:"center", gap:10, flexShrink:0}}>

      {/* 球種ブロック */}
      <div style={{display:"flex", flexDirection:"column", alignItems:"center", gap:0, flex:1}}>
        <div style={{fontSize:8, fontFamily:"var(--font-mono)", letterSpacing:2,
                     color:"var(--slate)", marginBottom:8, textTransform:"uppercase"}}>
          球種
        </div>
        {/* ─── overflow:visible wrapper ─── */}
        <div style={{position:"relative", width:66, height:66}}>

        {/* ── ポップアップ（中心円 absolute children） ── */}
        {active && Object.entries(DA).map(([d, ang]) => {
          const n   = parseInt(d);
          const rad = ang * Math.PI / 180;
          const px  = 38 + R * Math.cos(rad);   // wrapper中心(38,38)から
          const py  = 38 + R * Math.sin(rad);
          const pt  = PITCH_FLICK[n];
          const col = PITCH_COLORS[pt] || "#94A3B8";
          const hl  = dir === n;
          return (
            <div key={d} style={{
              position:"absolute",
              left: px, top: py,
              transform: hl ? "translate(-50%,-50%) scale(1.15)" : "translate(-50%,-50%) scale(1)",
              padding: hl ? "5px 12px" : "3px 9px",
              borderRadius: 8,
              fontSize: hl ? 13 : 10,
              fontWeight: hl ? 900 : 600,
              fontFamily: "var(--font-body)",
              color: hl ? col : "#94A3B8",
              background: hl ? `${col}30` : "rgba(14,24,44,0.93)",
              border: hl ? `1.5px solid ${col}` : "1px solid rgba(255,255,255,0.12)",
              boxShadow: hl ? `0 0 18px ${col}55, 0 4px 14px rgba(0,0,0,0.6)` : "0 2px 8px rgba(0,0,0,0.5)",
              textShadow: hl ? `0 0 10px ${col}` : "none",
              whiteSpace: "nowrap",
              transition: "all 0.07s",
              pointerEvents: "none",
              zIndex: 20,
            }}>{pt}</div>
          );
        })}



        {/* ── 中心円（最前面・イベント受付） ── */}
        <div
          onPointerDown={onDown} onPointerMove={onMove}
          onPointerUp={onUp}    onPointerCancel={onCancel}
          style={{
            position:"absolute", left:0, top:0,
            width:66, height:66, borderRadius:"50%",
            background: active
              ? "radial-gradient(circle,#1E3050 0%,#0B1628 100%)"
              : selCol
                ? `radial-gradient(circle,${selCol}28 0%,#142038 100%)`
                : "radial-gradient(circle,#1C2B45 0%,#0B1628 100%)",
            border: `2.5px solid ${ringCol}`,
            boxShadow: active
              ? `0 0 0 4px ${curCol||"#3B82F6"}22, 0 0 34px ${curCol||"#3B82F6"}44`
              : selCol
                ? `0 0 0 3px ${selCol}18, 0 0 20px ${selCol}33`
                : "none",
            cursor: "pointer", userSelect:"none", touchAction:"none",
            display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:3,
            transition: "border-color 0.1s, box-shadow 0.15s, background 0.12s",
            zIndex: 30,
          }}
        >
          {/* 方向矢印 */}
          {active && dir !== 8 && (
            <div style={{
              position:"absolute", fontSize:9,
              color: curCol || "#fff",
              transform:`rotate(${DA[dir]+90}deg)`,
              transition:"transform 0.07s",
              opacity:0.7, pointerEvents:"none",
            }}>▲</div>
          )}
          {/* ラベル */}
          <div style={{
            fontSize: active ? 10 : 12,
            fontWeight: 800,
            fontFamily:"var(--font-body)",
            color: active ? (curCol||"var(--dim)") : selCol || "var(--dim)",
            textAlign:"center", lineHeight:1.2, maxWidth:72,
            transition:"color 0.08s", pointerEvents:"none",
          }}>
            {active ? (curPt || "…") : (selected || "球種")}
          </div>
          {!active && !selected && (
            <div style={{fontSize:8, color:"var(--slate)", fontFamily:"var(--font-mono)",
                         letterSpacing:1, pointerEvents:"none"}}>PRESS</div>
          )}
        </div>
        </div>
      </div>{/* /球種ブロック */}

      {/* 球速ブロック */}
      <SpeedInput speed={speed} onSpeed={onSpeed} />

    </div>
  );
});

// ═══════════════════════════════════════════════════════════════════
//  SPEED INPUT
// ═══════════════════════════════════════════════════════════════════
// Drum をトップレベルで定義（毎レンダーで再生成されないようにするため）
const DrumRoll = ({ digits, current, onChange, bgColor }) => {
  const ITEM_H = 38;
  const SHOW   = 5;
  const N      = digits.length;

  const [liveIdx,  setLiveIdx]  = useState(null);
  const [offsetPx, setOffsetPx] = useState(0);

  const startY    = useRef(0);
  const startIdx  = useRef(0);
  const active    = useRef(false);

  const displayIdx = liveIdx !== null
    ? liveIdx
    : (current !== null && current !== undefined ? digits.indexOf(current) : 0);

  const onDown = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    active.current   = true;
    startY.current   = e.clientY;
    // ドラッグ開始時点の displayIdx を記録
    startIdx.current = current !== null && current !== undefined
      ? digits.indexOf(current) : 0;
    setLiveIdx(startIdx.current);
    setOffsetPx(0);
  };

  const onMove = (e) => {
    if (!active.current) return;
    const dy    = e.clientY - startY.current;
    const steps = -Math.round(dy / ITEM_H);          // 上スワイプ=値増加
    const newIdx = ((startIdx.current + steps) % N + N) % N;
    const subPx  = dy + steps * ITEM_H;              // スナップ後の余りpx（指追従）
    setLiveIdx(newIdx);
    setOffsetPx(subPx);
  };

  const onUp = (e) => {
    if (!active.current) return;
    active.current = false;
    const dy      = e.clientY - startY.current;
    const steps   = -Math.round(dy / ITEM_H);
    const nextIdx = ((startIdx.current + steps) % N + N) % N;
    onChange(digits[nextIdx]);
    setLiveIdx(null);
    setOffsetPx(0);
  };

  const mid = Math.floor(SHOW / 2);
  const BG  = bgColor || "#0B1628";

  return (
    <div
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      style={{
        width:50, height:ITEM_H * SHOW,
        position:"relative", overflow:"hidden",
        cursor:"ns-resize", touchAction:"none",
        userSelect:"none", WebkitTapHighlightColor:"transparent",
      }}
    >
      {/* 数字列: mid行目が中央、offsetPxで指に追従 */}
      <div style={{
        position:"absolute", left:0, right:0,
        top: mid * ITEM_H + offsetPx,
      }}>
        {Array.from({length: SHOW + 2}, (_, i) => {
          const delta    = i - (mid + 1);
          const dataIdx  = ((displayIdx + delta) % N + N) % N;
          const v        = digits[dataIdx];
          const dist     = Math.abs(delta);
          const isCurr   = delta === 0;
          return (
            <div key={i} style={{
              height: ITEM_H,
              display:"flex", alignItems:"center", justifyContent:"center",
              fontSize:   isCurr ? 24 : Math.max(13, 21 - dist * 4),
              fontWeight: isCurr ? 700 : 400,
              fontFamily:"var(--font-mono)",
              color:   isCurr ? "#63B3ED" : "#94A3B8",
              opacity: isCurr ? 1 : Math.max(0.1, 0.6 - dist * 0.22),
              pointerEvents:"none",
              flexShrink:0,
            }}>{v}</div>
          );
        })}
      </div>

      {/* 選択枠ライン */}
      <div style={{
        position:"absolute",
        top:mid*ITEM_H, left:4, right:4, height:ITEM_H,
        borderTop:"1px solid rgba(99,179,237,0.35)",
        borderBottom:"1px solid rgba(99,179,237,0.35)",
        borderRadius:4,
        pointerEvents:"none", zIndex:2,
      }}/>
      {/* 上フェード */}
      <div style={{
        position:"absolute", top:0, left:0, right:0, height:mid*ITEM_H,
        background:`linear-gradient(to bottom,${BG} 0%,transparent 100%)`,
        pointerEvents:"none", zIndex:1,
      }}/>
      {/* 下フェード */}
      <div style={{
        position:"absolute", bottom:0, left:0, right:0, height:mid*ITEM_H,
        background:`linear-gradient(to top,${BG} 0%,transparent 100%)`,
        pointerEvents:"none", zIndex:1,
      }}/>
    </div>
  );
};

function SpeedInput({ speed, onSpeed }) {
  const val = speed ?? null;
  const h = val !== null ? Math.floor(val / 100)        : null;
  const t = val !== null ? Math.floor((val % 100) / 10) : null;
  const u = val !== null ? val % 10                     : null;

  const commit = (newH, newT, newU) => {
    const v = Math.max(50, Math.min(199, newH*100 + newT*10 + newU));
    onSpeed(v);
  };

  // ── シンプルドラム ──────────────────────────────────────────
  // 状態: offsetPx (ドラッグ量px) だけ管理
  // offsetPx が ±ITEM_H を超えたら値を1ステップ変化させてoffsetをリセット
  const Drum = ({ digits, current, onChange }) => {
    const ITEM_H = 48;
    const N = digits.length;
    const curIdx = (current != null) ? digits.indexOf(current) : 0;

    const [offsetPx, setOffsetPx] = useState(0);
    const startY = useRef(null);

    const onDown = (e) => {
      if (val === null) { commit(1, 4, 0); return; }
      e.currentTarget.setPointerCapture(e.pointerId);
      startY.current = e.clientY;
      setOffsetPx(0);
    };

    const onMove = (e) => {
      if (startY.current === null) return;
      setOffsetPx(e.clientY - startY.current);
    };

    const onUp = (e) => {
      if (startY.current === null) return;
      const dy    = e.clientY - startY.current;
      // 上スワイプ(dy<0) → 値増加(+steps)
      const steps = -Math.round(dy / ITEM_H);
      const nextIdx = ((curIdx + steps) % N + N) % N;
      onChange(digits[nextIdx]);
      startY.current = null;
      setOffsetPx(0);
    };

    // 表示する3つの値: prev(上)・current(中)・next(下)
    // offsetPx 分だけ全体をずらす → 指に追従
    const prevIdx = ((curIdx - 1) + N) % N;
    const nextIdx = (curIdx + 1) % N;

    const items = [
      { v: digits[prevIdx], delta: -1 },
      { v: digits[curIdx],  delta:  0 },
      { v: digits[nextIdx], delta:  1 },
    ];

    return (
      <div
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        style={{
          width:58, height:ITEM_H * 3,
          position:"relative", overflow:"hidden",
          cursor:"ns-resize", touchAction:"none",
          userSelect:"none", WebkitTapHighlightColor:"transparent",
          borderRadius:8,
        }}
      >
        {/* アイテム群: offsetPxでスライド */}
        {items.map(({v, delta}) => {
          const isCur = delta === 0;
          // 中央=0、上=-ITEM_H、下=+ITEM_H にoffsetPxを加算
          const y = ITEM_H + delta * ITEM_H + offsetPx;
          return (
            <div key={delta} style={{
              position:"absolute",
              left:0, right:0,
              top: y - ITEM_H/2,
              height:ITEM_H,
              display:"flex", alignItems:"center", justifyContent:"center",
              pointerEvents:"none",
            }}>
              <span style={{
                fontSize:    isCur ? 36 : 22,
                fontWeight:  isCur ? 800 : 300,
                fontFamily:  "var(--font-mono)",
                color:       isCur ? "#FFFFFF" : "#3A5070",
                lineHeight:  1,
                transition:  startY.current !== null ? "none" : "font-size 0.1s",
              }}>{v}</span>
            </div>
          );
        })}

        {/* 選択帯 */}
        <div style={{
          position:"absolute",
          top:ITEM_H, left:0, right:0, height:ITEM_H,
          background:"rgba(99,179,237,0.10)",
          borderTop:"1.5px solid rgba(99,179,237,0.5)",
          borderBottom:"1.5px solid rgba(99,179,237,0.5)",
          pointerEvents:"none", zIndex:2,
        }}/>
        {/* 上フェード */}
        <div style={{
          position:"absolute", top:0, left:0, right:0, height:ITEM_H*0.85,
          background:"linear-gradient(to bottom,#0B1628 0%,transparent 100%)",
          pointerEvents:"none", zIndex:3,
        }}/>
        {/* 下フェード */}
        <div style={{
          position:"absolute", bottom:0, left:0, right:0, height:ITEM_H*0.85,
          background:"linear-gradient(to top,#0B1628 0%,transparent 100%)",
          pointerEvents:"none", zIndex:3,
        }}/>
      </div>
    );
  };

  return (
    <div style={{
      display:"flex", flexDirection:"column", alignItems:"center",
      flexShrink:0, gap:0,
    }}>
      <div style={{
        fontSize:8, fontFamily:"monospace", letterSpacing:2,
        color:"var(--slate)", marginBottom:4, textTransform:"uppercase",
      }}>球速</div>

      {/* 現在値サマリー */}
      <div style={{
        fontSize:13, fontWeight:700, fontFamily:"var(--font-mono)",
        color: val !== null ? "#63B3ED" : "#2A3A50",
        marginBottom:6, height:16, display:"flex", alignItems:"center", gap:3,
      }}>
        {val !== null
          ? <>{val}<span style={{fontSize:9, fontWeight:400, color:"#475569", marginLeft:2}}>km/h</span></>
          : <span style={{fontSize:10,color:"#2A3A50"}}>tap to set</span>
        }
      </div>

      {/* 3列ドラム */}
      <div style={{
        display:"flex", alignItems:"stretch",
        background:"#0d1e35",
        border:"1.5px solid rgba(99,179,237,0.25)",
        borderRadius:12, overflow:"hidden", gap:0,
      }}
        onClick={() => { if (val === null) commit(1,4,0); }}
      >
        <Drum digits={[0,1]} current={h}
          onChange={v => commit(v, t??4, u??0)} />
        <div style={{width:"1px", background:"rgba(99,179,237,0.15)"}}/>
        <Drum digits={[0,1,2,3,4,5,6,7,8,9]} current={t}
          onChange={v => commit(h??1, v, u??0)} />
        <Drum digits={[0,1,2,3,4,5,6,7,8,9]} current={u}
          onChange={v => commit(h??1, t??4, v)} />
      </div>

      {val !== null && (
        <button onClick={() => onSpeed(null)} style={{
          marginTop:5, fontSize:8, color:"#475569", background:"none",
          border:"1px solid rgba(255,255,255,0.1)",
          borderRadius:4, padding:"2px 10px",
          cursor:"pointer", fontFamily:"monospace",
          WebkitTapHighlightColor:"transparent",
        }}>CLR</button>
      )}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════
//  RESULT FLICK PAD
//  押した瞬間に十字ポップアップが中心から展開。
//  PitchFlickWheel と同じ overflow:visible 方式。
// ═══════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════
//  FIELD SVG — グラウンドマップ（共通）
// ═══════════════════════════════════════════════════════════════════
const W=320, H=300, HX=160, HY=285, BS=55;
function fieldArc(r, a1, a2) {
  const p = a => ({ x: HX + r*Math.sin(a*Math.PI/180), y: HY - r*Math.cos(a*Math.PI/180) });
  const s=p(a1), en=p(a2);
  return `M ${HX} ${HY} L ${s.x} ${s.y} A ${r} ${r} 0 0 1 ${en.x} ${en.y} Z`;
}
const BX = {
  home:{x:HX,y:HY}, first:{x:HX+BS,y:HY-BS},
  sec:{x:HX,y:HY-BS*2}, third:{x:HX-BS,y:HY-BS},
};
const BPTS = `${BX.home.x},${BX.home.y} ${BX.first.x},${BX.first.y} ${BX.sec.x},${BX.sec.y} ${BX.third.x},${BX.third.y}`;

function FieldSVG({ svgRef, onTap, marker, tc }) {
  return (
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`}
      style={{width:"100%",flex:1,display:"block",cursor:"crosshair",touchAction:"none"}}
      onPointerDown={onTap}
    >
      <rect width={W} height={H} fill="#0a180d"/>
      <path d={fieldArc(240,-55,55)} fill="#0d2010"/>
      <path d={fieldArc(200,-52,52)} fill="#133d18"/>
      <path d={fieldArc(130,-50,50)} fill="#1a5420"/>
      <path d={fieldArc(72,-47,47)}  fill="#226b27"/>
      <polygon points={BPTS} fill="#7c5a2e" opacity={0.75}/>
      {[-52,52].map((a,i)=>(
        <line key={i} x1={HX} y1={HY} x2={HX+240*Math.sin(a*Math.PI/180)} y2={HY-240*Math.cos(a*Math.PI/180)} stroke="#fff" strokeWidth={1} opacity={0.18}/>
      ))}
      {(()=>{ const r=200,a1=-52,a2=52,sx=HX+r*Math.sin(a1*Math.PI/180),sy=HY-r*Math.cos(a1*Math.PI/180),ex=HX+r*Math.sin(a2*Math.PI/180),ey=HY-r*Math.cos(a2*Math.PI/180); return <path d={`M ${sx} ${sy} A ${r} ${r} 0 0 1 ${ex} ${ey}`} fill="none" stroke="#4ade80" strokeWidth={2} opacity={0.5}/>; })()}
      {(()=>{ const r=72,a1=-45,a2=45,sx=HX+r*Math.sin(a1*Math.PI/180),sy=HY-r*Math.cos(a1*Math.PI/180),ex=HX+r*Math.sin(a2*Math.PI/180),ey=HY-r*Math.cos(a2*Math.PI/180); return <path d={`M ${sx} ${sy} A ${r} ${r} 0 0 1 ${ex} ${ey}`} fill="none" stroke="#92691a" strokeWidth={1.5} opacity={0.6}/>; })()}
      <polygon points={BPTS} fill="none" stroke="#fff" strokeWidth={1.5} opacity={0.55}/>
      {Object.entries(BX).map(([k,b])=>(
        k==="home"
          ? <polygon key={k} points={`${b.x},${b.y-8} ${b.x+7},${b.y} ${b.x},${b.y+5} ${b.x-7},${b.y}`} fill="#fff" opacity={0.9}/>
          : <rect key={k} x={b.x-6} y={b.y-6} width={12} height={12} fill="#fff" opacity={0.9} transform={`rotate(45,${b.x},${b.y})`}/>
      ))}
      <ellipse cx={HX} cy={HY-BS} rx={9} ry={6} fill="#7c5a2e" opacity={0.8}/>
      <circle cx={HX} cy={HY-BS} r={3} fill="#fff" opacity={0.5}/>
      {[{x:HX,y:HY-165,t:"センター"},{x:HX+110,y:HY-108,t:"ライト"},{x:HX-110,y:HY-108,t:"レフト"},{x:HX+80,y:HY-55,t:"一塁側"},{x:HX-80,y:HY-55,t:"三塁側"},{x:HX+82,y:HY-148,t:"右中間"},{x:HX-82,y:HY-148,t:"左中間"}].map((l,i)=>(
        <text key={i} x={l.x} y={l.y} textAnchor="middle" fontSize={10} fill="#fff" opacity={0.25} fontFamily="sans-serif">{l.t}</text>
      ))}
      {!marker && <text x={HX} y={HY-108} textAnchor="middle" fontSize={14} fill="#fff" opacity={0.35} fontFamily="sans-serif">タップして位置を指定</text>}
      {marker && (
        <g>
          <circle cx={marker.svgX} cy={marker.svgY} r={22} fill={`${tc}15`} stroke={tc} strokeWidth={1.5} opacity={0.6}/>
          <line x1={marker.svgX-12} y1={marker.svgY} x2={marker.svgX+12} y2={marker.svgY} stroke={tc} strokeWidth={2.5} opacity={0.95}/>
          <line x1={marker.svgX} y1={marker.svgY-12} x2={marker.svgX} y2={marker.svgY+12} stroke={tc} strokeWidth={2.5} opacity={0.95}/>
          <circle cx={marker.svgX} cy={marker.svgY} r={5} fill={tc} opacity={1}/>
          <circle cx={marker.svgX} cy={marker.svgY} r={2} fill="#fff" opacity={0.95}/>
        </g>
      )}
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  RESULT PAD
//  ・フリックパッド: 見逃し / 空振り / ボール
//  ・3ボタン: 安打（→モーダル）/ アウト（即確定）/ 出塁（→モーダル）
//  ・グラウンドマップ: 安打・アウト・出塁・ファウル を一括表示
//    マップ下部ボタン = 安打 / アウト / 出塁 / ファウル
//  ・安打/出塁 選択後 → スライドモーダルで詳細選択
// ═══════════════════════════════════════════════════════════════════
// useFlick: カスタムフック（コンポーネント外のトップレベルで定義）
function useFlick(dirs, onCommit, threshold=20) {
  const [active, setActive] = useState(false);
  const [dir,    setDir]    = useState(-1);
  const start  = useRef(null);
  const padRef = useRef(null);
  const center = useRef({x:0,y:0});
  const POPUP_R = 76;

  const onDown = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = padRef.current?.getBoundingClientRect();
    if (rect) center.current = {x:rect.left+rect.width/2, y:rect.top+rect.height/2};
    start.current = {x:e.clientX, y:e.clientY};
    setActive(true); setDir(-1);
  };
  const onMove = (e) => {
    if (!start.current) return;
    const dx=e.clientX-start.current.x, dy=e.clientY-start.current.y;
    if (Math.sqrt(dx*dx+dy*dy) < threshold) { setDir(-1); return; }
    const ang = Math.atan2(dy,dx)*180/Math.PI;
    let best=-1, bestDiff=999;
    dirs.forEach(({d,angle})=>{
      let diff=Math.abs(ang-angle); if(diff>180) diff=360-diff;
      if(diff<bestDiff){bestDiff=diff;best=d;}
    });
    setDir(best);
  };
  const onUp = (e) => {
    if (!start.current) return;
    const dx=e.clientX-start.current.x, dy=e.clientY-start.current.y;
    if (Math.sqrt(dx*dx+dy*dy) >= threshold) {
      const ang = Math.atan2(dy,dx)*180/Math.PI;
      let best=-1, bestDiff=999;
      dirs.forEach(({d,angle})=>{
        let diff=Math.abs(ang-angle); if(diff>180) diff=360-diff;
        if(diff<bestDiff){bestDiff=diff;best=d;}
      });
      if (best >= 0) onCommit(best);
    }
    start.current=null; setActive(false); setDir(-1);
  };
  const onCancel = () => { start.current=null; setActive(false); setDir(-1); };
  return {active, dir, padRef, center, POPUP_R, onDown, onMove, onUp, onCancel};
}

const ResultFlickPad = memo(({ selected, onSelect, onHitType, onReachType, onMapCommit, onFullCommit, hitType, reachType, pitch }) => {
  const [overlay,   setOverlay]   = useState(null);
  const [marker,    setMarker]    = useState(null);
  const [mapResult, setMapResult] = useState(null);
  const svgRef = useRef(null);

  const prevSel = useRef(selected);
  if (prevSel.current !== selected) {
    prevSel.current = selected;
    setMarker(null); setMapResult(null); setOverlay(null);
  }

  const tc = {hit:"#22C55E", out:"#EF4444", foul:"#94A3B8"}[mapResult] || "#94A3B8";

  const BSF_DIRS = [
    {d:0, key:"strike_looking",  angle:-90, label:"見逃し",     icon:"👁",  color:"#3B82F6"},
    {d:1, key:"ball",            angle:180,  label:"ボール",     icon:"✓",   color:"#22C55E"},
    {d:2, key:"strike_swinging", angle:90,   label:"空振り",     icon:"💨",  color:"#F59E0B"},
    {d:3, key:"foul",            angle:0,    label:"ファウル",   icon:"⚡",  color:"#94A3B8"},
  ];
  const HIT_DIRS = [
    {d:0, key:"single",   angle:-90, label:"単打",     icon:"①", color:"#22C55E"},
    {d:1, key:"double",   angle:180,  label:"二塁打",   icon:"②", color:"#34D399"},
    {d:2, key:"triple",   angle:90,   label:"三塁打",   icon:"③", color:"#F59E0B"},
    {d:3, key:"home_run", angle:0,    label:"本塁打",   icon:"🏠", color:"#EF4444"},
  ];
  const OUT_DIRS = [
    {d:0, key:"ground", angle:-90, label:"ゴロ",    icon:"🔽", color:"#EF4444"},
    {d:1, key:"fly",    angle:180,  label:"フライ",  icon:"🔼", color:"#F87171"},
    {d:2, key:"liner",  angle:90,   label:"ライナー",icon:"▶",  color:"#FCA5A5"},
  ];
  const REACH_DIRS = [
    {d:0, key:"walk",          angle:-90, label:"四球",       icon:"🟢", color:"#F59E0B"},
    {d:1, key:"hit_by_pitch",  angle:180,  label:"死球",       icon:"💥", color:"#FB923C"},
    {d:2, key:"fielding_error",angle:90,   label:"エラー",     icon:"❌", color:"#F59E0B"},
    {d:3, key:"fc",            angle:0,    label:"野選",       icon:"🔀", color:"#FCD34D"},
  ];

  const bsf   = useFlick(BSF_DIRS,   (d) => {
    const k = BSF_DIRS.find(x=>x.d===d)?.key;
    if (k==="foul") { setMapResult("foul"); setOverlay("map"); }
    else if (k) onSelect(k);
  });
  const hit   = useFlick(HIT_DIRS,   (d) => {
    const item = HIT_DIRS.find(x=>x.d===d); if(!item) return;
    if (item.key==="home_run") {
      onFullCommit({result:"hit",hitType:"home_run",landingPos:null,direction:null,battedType:null,outcome:null,reachType:null});
    } else {
      onHitType(item.key); setMapResult("hit"); setOverlay("map");
    }
  });
  const out   = useFlick(OUT_DIRS,   (d) => {
    const item = OUT_DIRS.find(x=>x.d===d); if(!item) return;
    onFullCommit({result:"out",battedType:item.key,outcome:"out",landingPos:null,direction:null,hitType:null,reachType:null});
    setMapResult("out"); setOverlay("map");
  });
  const reach = useFlick(REACH_DIRS, (d) => {
    const item = REACH_DIRS.find(x=>x.d===d); if(!item) return;
    if (item.key==="walk"||item.key==="hit_by_pitch") {
      onFullCommit({result:"reach",reachType:item.key,landingPos:null,direction:null,battedType:null,outcome:null,hitType:null});
    } else {
      onFullCommit({result:"reach",reachType:item.key,landingPos:null,direction:null,battedType:null,outcome:null,hitType:null});
      setMapResult("reach"); setOverlay("map");
    }
  });

  // マップ
  const handleMapTap = (e) => {
    const svg=svgRef.current; if(!svg) return;
    const rect=svg.getBoundingClientRect();
    const nx=(e.clientX-rect.left)/rect.width, ny=(e.clientY-rect.top)/rect.height;
    if(ny>0.97) return;
    const {zone,legacyDir}=resolveFieldArea(nx,ny);
    setMarker({nx,ny,svgX:nx*W,svgY:ny*H,zone,legacyDir});
  };
  const commitMap = () => {
    if(!marker) return;
    onMapCommit({landingPos:marker,direction:marker.legacyDir});
    setOverlay(null);
  };

  // ポップアップ描画
  const FlickPopup = ({flick, dirs}) => {
    if (!flick.active) return null;
    const rect = flick.padRef.current?.getBoundingClientRect();
    const cx = rect ? flick.center.current.x - rect.left : 0;
    const cy = rect ? flick.center.current.y - rect.top  : 0;
    return (
      <div style={{position:"absolute",inset:0,pointerEvents:"none",zIndex:20,overflow:"visible"}}>
        {dirs.map(pd => {
          const rad=pd.angle*Math.PI/180;
          const px=cx+flick.POPUP_R*Math.cos(rad), py=cy+flick.POPUP_R*Math.sin(rad);
          const hl=flick.dir===pd.d;
          return (
            <div key={pd.d} style={{
              position:"absolute",left:px,top:py,
              transform:hl?"translate(-50%,-50%) scale(1.15)":"translate(-50%,-50%)",
              padding:hl?"6px 14px":"4px 10px",borderRadius:10,
              background:hl?`${pd.color}30`:"rgba(14,24,44,0.95)",
              border:hl?`2px solid ${pd.color}`:"1px solid rgba(255,255,255,0.15)",
              boxShadow:hl?`0 0 18px ${pd.color}66`:"0 2px 8px rgba(0,0,0,0.5)",
              display:"flex",flexDirection:"column",alignItems:"center",gap:2,
              whiteSpace:"nowrap",transition:"all 0.07s",
            }}>
              <div style={{fontSize:hl?18:14,lineHeight:1}}>{pd.icon}</div>
              <div style={{fontSize:hl?11:9,fontWeight:800,color:hl?pd.color:"var(--slate-light)",fontFamily:"var(--font-body)"}}>{pd.label}</div>
            </div>
          );
        })}
        {dirs.map(pd => {
          const hl=flick.dir===pd.d;
          return (
            <div key={`g${pd.d}`} style={{
              position:"absolute",left:cx,top:cy,
              width:flick.POPUP_R-36,height:1.5,
              background:hl?pd.color:"rgba(255,255,255,0.06)",
              transformOrigin:"0 50%",
              transform:`translate(0,-50%) rotate(${pd.angle}deg)`,
              transition:"background 0.07s",
            }}/>
          );
        })}
      </div>
    );
  };

  // パッド描画
  const FlickPad = ({flick, dirs, selKey, label, height=40}) => {
    const selItem = selKey ? dirs.find(x=>x.key===selKey) : null;
    const curItem = flick.active ? dirs.find(x=>x.d===flick.dir) : null;
    const borderCol = flick.active?(curItem?.color||"var(--border2)"):selItem?`${selItem.color}88`:"var(--border2)";
    return (
      <div ref={flick.padRef} style={{position:"relative",flex:1}}>
        <FlickPopup flick={flick} dirs={dirs}/>
        <div
          onPointerDown={flick.onDown} onPointerMove={flick.onMove}
          onPointerUp={flick.onUp}    onPointerCancel={flick.onCancel}
          style={{
            height,borderRadius:10,cursor:"pointer",userSelect:"none",touchAction:"none",
            background:selItem?`${selItem.color}14`:"var(--surface2)",
            border:`1.5px solid ${borderCol}`,
            display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:2,
            transition:"border-color 0.1s",position:"relative",zIndex:30,
          }}
        >
          {selItem&&!flick.active ? (
            <><div style={{fontSize:16,lineHeight:1}}>{selItem.icon}</div>
              <div style={{fontSize:10,fontWeight:800,color:selItem.color,fontFamily:"var(--font-body)"}}>{selItem.label}</div></>
          ) : !flick.active ? (
            <><div style={{fontSize:11,color:"var(--slate-light)",fontFamily:"var(--font-body)",fontWeight:600}}>{label}</div>
              <div style={{fontSize:7,color:"var(--slate)",fontFamily:"var(--font-mono)"}}>FLICK</div></>
          ) : null}
        </div>
      </div>
    );
  };

  const hitSel   = selected==="hit"   ? hitType              : null;
  const outSel   = selected==="out"   ? pitch?.battedType    : null;
  const reachSel = selected==="reach" ? reachType            : null;
  const bsfSel   = ["strike_looking","ball","strike_swinging","foul"].includes(selected) ? selected : null;

  return (
    <>
      {/* グラウンドマップ */}
      {overlay==="map" && (
        <div style={{position:"fixed",inset:0,zIndex:500,background:"#0B1628",display:"flex",flexDirection:"column",maxWidth:480,margin:"0 auto"}}>
          <div style={{padding:"10px 14px 8px",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"space-between",borderBottom:"1px solid rgba(255,255,255,0.1)"}}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <button onClick={()=>setOverlay(null)} style={{width:30,height:30,borderRadius:8,border:"1px solid rgba(255,255,255,0.15)",background:"rgba(255,255,255,0.05)",color:"#94A3B8",fontSize:15,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>←</button>
              <div style={{fontSize:10,color:"#64748B",fontFamily:"monospace",letterSpacing:1}}>打球位置をタップ</div>
            </div>
            {marker && (
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <div style={{fontSize:11,color:"#60A5FA",fontWeight:700}}>📍 {marker.zone}</div>
                <button onClick={commitMap} style={{height:28,padding:"0 12px",borderRadius:7,border:"none",background:"var(--blue-light)",color:"#fff",fontSize:11,fontWeight:700,cursor:"pointer"}}>確定</button>
              </div>
            )}
          </div>
          <div style={{flex:1,display:"flex",padding:"6px 10px 0",minHeight:0}}>
            <FieldSVG svgRef={svgRef} onTap={handleMapTap} marker={marker} tc={tc}/>
          </div>
          {!marker&&<div style={{padding:"12px",textAlign:"center",fontSize:11,color:"var(--slate)",flexShrink:0}}>フィールドをタップして打球位置を指定</div>}
        </div>
      )}

      {/* メインUI */}
      <div style={{padding:"3px 10px 2px",flexShrink:0}}>
        <div style={{fontSize:8,fontFamily:"var(--font-mono)",letterSpacing:2,color:"var(--slate)",marginBottom:4}}>結果</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:5,marginBottom:5}}>
          <FlickPad flick={hit}   dirs={HIT_DIRS}   selKey={hitSel}   label="安打"   height={40}/>
          <FlickPad flick={out}   dirs={OUT_DIRS}   selKey={outSel}   label="アウト" height={40}/>
          <FlickPad flick={reach} dirs={REACH_DIRS} selKey={reachSel} label="出塁"   height={40}/>
        </div>
        <FlickPad flick={bsf} dirs={BSF_DIRS} selKey={bsfSel} label="ボール  /  ストライク  /  ファウル" height={40}/>
        <div style={{marginTop:3,display:"flex",justifyContent:"center",gap:8,flexWrap:"wrap"}}>
          {BSF_DIRS.map(d=>(
            <div key={d.key} style={{display:"flex",alignItems:"center",gap:2,fontSize:8,color:"var(--slate)"}}>
              <span style={{color:d.color}}>{d.label}</span>
              <span style={{color:"rgba(255,255,255,0.15)"}}>{d.angle===-90?"↑":d.angle===90?"↓":d.angle===180?"←":"→"}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
});

const BSODots = memo(({ value, max, type }) => {
  const cols={ball:"#22C55E",strike:"#F59E0B",out:"#EF4444"};
  const col=cols[type];
  return (
    <div style={{display:"flex",alignItems:"center",gap:4}}>
      <span style={{fontFamily:"var(--font-mono)",fontSize:9,color:"var(--slate-light)",letterSpacing:1,width:10}}>{type[0].toUpperCase()}</span>
      <div style={{display:"flex",gap:3}}>
        {Array.from({length:max}).map((_,i)=>(
          <div key={i} style={{width:9,height:9,borderRadius:"50%",border:`1.5px solid ${col}`,background:i<value?col:"transparent",boxShadow:i<value?`0 0 4px ${col}88`:"none",transition:"background 0.15s"}}/>
        ))}
      </div>
    </div>
  );
});

const Diamond = memo(({ bases, onToggle }) => {
  const bp=[{key:"second",cx:26,cy:2},{key:"third",cx:2,cy:26},{key:"first",cx:50,cy:26}];
  return (
    <svg width={58} height={52} viewBox="0 0 58 52" style={{cursor:"pointer",flexShrink:0}}>
      <rect x={20} y={37} width={13} height={13} transform="rotate(45 26.5 43.5)" fill="var(--slate)" opacity={0.35}/>
      {bp.map(b=>{
        const on=bases[b.key];
        return <rect key={b.key} x={b.cx} y={b.cy} width={13} height={13} transform={`rotate(45 ${b.cx+6.5} ${b.cy+6.5})`} fill={on?"#F59E0B":"none"} stroke={on?"#F59E0B":"var(--slate)"} strokeWidth={1.5} style={{filter:on?"drop-shadow(0 0 5px #F59E0B)":"none",cursor:"pointer"}} onClick={()=>onToggle(b.key)}/>;
      })}
    </svg>
  );
});

const ZoneGrid = memo(({ selected, onSelect }) => {
  // pitcher=投手視点(打者の顔が見える), batter=打者視点(捕手から・背中が見える)
  const [view, setView] = useState("pitcher");

  // ゾーン配置: pitcher視点は打者から見て左=三塁側=1,4,7
  // batter視点(捕手方向)は左右反転
  const GRIDS = {
    pitcher: [[1,2,3],[4,5,6],[7,8,9]],
    batter:  [[3,2,1],[6,5,4],[9,8,7]],
  };
  const grid = GRIDS[view];

  const W=300, H=196;
  const ZX=82, ZY=12, ZW=136, ZH=112;
  const CW=ZW/3, CH=ZH/3;
  const ZCX=ZX+ZW/2;

  // ホームベース
  const HBY=ZY+ZH+8, HBW=ZW*0.78, HBH=22;
  const hbPts=[
    [ZCX-HBW/2,HBY],[ZCX+HBW/2,HBY],
    [ZCX+HBW/2,HBY+HBH*0.55],[ZCX,HBY+HBH],[ZCX-HBW/2,HBY+HBH*0.55],
  ].map(p=>p.join(",")).join(" ");

  const handleTap = (e) => {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const tx=(e.clientX-rect.left)/rect.width*W;
    const ty=(e.clientY-rect.top)/rect.height*H;
    if(tx<ZX||tx>ZX+ZW||ty<ZY||ty>ZY+ZH) return;
    const ci=Math.floor((tx-ZX)/CW);
    const ri=Math.floor((ty-ZY)/CH);
    onSelect(grid[ri][ci]);
  };

  // ── 投手方向シルエット（正面・顔が見える）ゾーン左側 ──
  // 右打者、投手から見て打者の左（三塁側）に立つ → SVG左端
  const PitcherBatter = () => {
    // スケール・オフセット: ゾーン左側に収める
    const ox=2, oy=12, sc=0.62;
    const t=(x,y)=>[ox+x*sc, oy+y*sc];
    const pts = (arr) => arr.map(([x,y])=>t(x,y).join(",")).join(" ");

    // 各パーツ（元のviewBox: -10 0 170 220 を基準）
    return (
      <g style={{pointerEvents:"none"}}>
        {/* 地面シャドウ */}
        <ellipse cx={t(75,210)[0]} cy={t(75,210)[1]} rx={42*sc} ry={7*sc} fill="rgba(0,0,0,0.4)"/>
        {/* 奥の脚（右・後ろ足） */}
        <polygon points={pts([[96,197],[114,202],[118,198],[116,192],[96,191]])} fill="#364E68"/>
        <polygon points={pts([[100,156],[106,177],[96,197],[90,200],[84,197],[92,178],[94,157]])} fill="#364E68"/>
        <ellipse cx={t(97,156)[0]} cy={t(97,156)[1]} rx={9*sc} ry={8*sc} fill="#304460"/>
        <polygon points={pts([[74,108],[96,118],[100,142],[100,158],[92,162],[84,164],[80,158],[82,138],[72,120]])} fill="#364E68"/>
        {/* 手前の脚（左・前足） */}
        <polygon points={pts([[44,198],[26,203],[22,199],[24,193],[44,192]])} fill="#5A7898"/>
        <polygon points={pts([[44,158],[38,178],[44,198],[50,202],[58,198],[54,178],[48,158]])} fill="#5A7898"/>
        <ellipse cx={t(46,158)[0]} cy={t(46,158)[1]} rx={10*sc} ry={9*sc} fill="#526888"/>
        <polygon points={pts([[66,108],[46,120],[42,144],[42,160],[50,164],[60,166],[64,158],[62,136],[68,120]])} fill="#5A7898"/>
        {/* 腰 */}
        <polygon points={pts([[44,100],[46,118],[70,122],[96,118],[98,100],[94,86],[70,82],[46,86]])} fill="#4A6480"/>
        {/* 胴体 */}
        <polygon points={pts([[40,42],[28,56],[28,78],[30,98],[48,106],[58,112],[70,112],[84,112],[94,106],[112,98],[112,78],[112,56],[102,42]])} fill="#4E6278"/>
        {/* 左上腕(手前) */}
        <polygon points={pts([[44,46],[28,42],[18,32],[22,22],[28,24],[36,34],[46,42]])} fill="#5A7898"/>
        {/* 左前腕 */}
        <polygon points={pts([[18,32],[10,20],[14,12],[20,8],[26,12],[24,22],[22,30]])} fill="#5A7898"/>
        {/* 右上腕(奥) */}
        <polygon points={pts([[96,46],[112,40],[122,30],[118,22],[112,24],[106,34],[96,42]])} fill="#364E68"/>
        {/* 右前腕(奥) */}
        <polygon points={pts([[122,30],[130,20],[128,12],[122,8],[118,12],[120,20],[116,28]])} fill="#364E68"/>
        {/* グリップ */}
        <polygon points={pts([[22,20],[118,16],[120,14],[120,10],[118,6],[116,8],[22,12],[20,14],[20,18]])} fill="#425E78"/>
        {/* バット */}
        <polygon points={pts([[118,8],[122,10],[90,-12],[84,-14],[82,-10],[84,-4]])} fill="#C8965A"/>
        <ellipse cx={t(83,-7)[0]} cy={t(83,-7)[1]} rx={5*sc} ry={4*sc} fill="#D4A86A"/>
        {/* 首 */}
        <polygon points={pts([[58,34],[64,28],[72,28],[80,28],[86,34],[86,44],[82,46],[72,50],[62,46],[58,44]])} fill="#425E76"/>
        {/* 頭 */}
        <ellipse cx={t(72,21)[0]} cy={t(72,21)[1]} rx={17*sc} ry={18*sc} fill="rgba(90,112,145,0.88)"/>
        {/* ヘルメット */}
        <polygon points={pts([[55,14],[54,1],[72,-1],[92,-1],[92,14],[86,28],[78,32],[70,32],[60,30],[56,24]])} fill="#2A3E58" stroke="#1E3050" strokeWidth={1}/>
        {/* つば */}
        <polygon points={pts([[55,14],[50,16],[44,22],[50,28],[58,24],[58,20]])} fill="#243450" stroke="#1E3050" strokeWidth={0.8}/>
        {/* 耳あて */}
        <polygon points={pts([[56,20],[50,24],[52,32],[56,36],[60,32],[58,26]])} fill="#1E3050"/>
        {/* ハイライト */}
        <polygon points={pts([[62,2],[76,0],[86,8],[76,4],[62,6]])} fill="rgba(255,255,255,0.09)"/>
      </g>
    );
  };

  // ── 打者視点シルエット（捕手方向・背中が見える）ゾーン右側 ──
  const BatterBacker = () => {
    // 右打者の背中 → ゾーン右側（右打者は三塁側=左に立つ→捕手から見て右側に見える）
    const ox=ZX+ZW+4, oy=12, sc=0.62;
    const t=(x,y)=>[ox+x*sc, oy+y*sc];
    const pts=(arr)=>arr.map(([x,y])=>t(x,y).join(",")).join(" ");

    return (
      <g style={{pointerEvents:"none"}}>
        <ellipse cx={t(74,210)[0]} cy={t(74,210)[1]} rx={42*sc} ry={7*sc} fill="rgba(0,0,0,0.4)"/>
        {/* 後ろ足（右・手前=捕手側） */}
        <polygon points={pts([[92,198],[110,203],[114,200],[112,194],[92,193]])} fill="#5A7090"/>
        <polygon points={pts([[96,158],[102,178],[92,198],[86,201],[80,198],[88,178],[90,158]])} fill="#5A7090"/>
        <ellipse cx={t(93,158)[0]} cy={t(93,158)[1]} rx={10*sc} ry={9*sc} fill="#506882"/>
        <polygon points={pts([[68,106],[88,116],[96,140],[96,158],[88,162],[80,164],[76,158],[80,136],[68,118]])} fill="#5A7090"/>
        {/* 前足（左・踏み込み・奥） */}
        <polygon points={pts([[50,196],[32,200],[28,197],[30,191],[50,190]])} fill="#3D5270"/>
        <polygon points={pts([[50,156],[44,175],[50,196],[56,199],[62,196],[58,176],[54,156]])} fill="#3D5270"/>
        <ellipse cx={t(52,156)[0]} cy={t(52,156)[1]} rx={9*sc} ry={8*sc} fill="#364A66"/>
        <polygon points={pts([[70,106],[54,118],[48,140],[48,156],[56,160],[64,162],[68,156],[66,134],[72,118]])} fill="#3D5270"/>
        {/* 腰 */}
        <polygon points={pts([[46,100],[48,116],[70,120],[92,116],[96,100],[92,88],[70,84],[48,88]])} fill="#4A6280"/>
        {/* 胴体 */}
        <polygon points={pts([[38,44],[26,56],[26,78],[28,96],[46,104],[58,110],[70,110],[82,110],[94,104],[112,96],[112,78],[112,56],[100,44]])} fill="#526478"/>
        {/* 脊椎ライン */}
        <line x1={t(68,46)[0]} y1={t(68,46)[1]} x2={t(70,104)[0]} y2={t(70,104)[1]} stroke="rgba(255,255,255,0.06)" strokeWidth={3} strokeLinecap="round"/>
        {/* 右上腕（外・テイクバック） */}
        <polygon points={pts([[98,48],[116,44],[124,34],[120,26],[114,28],[108,38],[96,44]])} fill="#5A7090"/>
        {/* 右前腕 */}
        <polygon points={pts([[124,34],[132,24],[130,16],[124,12],[120,16],[122,24],[118,32]])} fill="#5A7090"/>
        {/* 左上腕 */}
        <polygon points={pts([[42,48],[26,44],[18,36],[22,28],[28,30],[34,40],[44,46]])} fill="#3D5270"/>
        {/* 左前腕 */}
        <polygon points={pts([[18,36],[12,26],[14,18],[20,14],[24,18],[22,26],[26,34]])} fill="#3D5270"/>
        {/* グリップ */}
        <polygon points={pts([[20,78],[22,82],[120,78],[122,74],[120,70],[22,74]])} fill="#425E78"/>
        {/* バット */}
        <polygon points={pts([[120,16],[124,18],[80,-4],[74,-6],[72,-2],[74,4]])} fill="#C8965A"/>
        <ellipse cx={t(76,1)[0]} cy={t(76,1)[1]} rx={5*sc} ry={4*sc} fill="#D4A86A"/>
        {/* 首 */}
        <polygon points={pts([[60,36],[66,30],[74,30],[82,30],[88,36],[88,46],[84,48],[74,52],[66,48],[62,46]])} fill="#4A6078"/>
        {/* 頭 */}
        <ellipse cx={t(73,22)[0]} cy={t(73,22)[1]} rx={17*sc} ry={18*sc} fill="rgba(90,112,145,0.85)"/>
        {/* ヘルメット後頭部 */}
        <polygon points={pts([[56,16],[54,2],[72,0],[92,0],[94,16],[94,26],[88,30],[80,34],[72,34],[62,32],[58,26]])} fill="#2A3E58" stroke="#1E3050" strokeWidth={1}/>
        {/* 後部フラップ */}
        <polygon points={pts([[90,14],[100,20],[102,30],[98,36],[90,30]])} fill="#243450"/>
        {/* ハイライト */}
        <polygon points={pts([[64,4],[78,2],[88,10],[78,6],[64,8]])} fill="rgba(255,255,255,0.09)"/>
      </g>
    );
  };

  return (
    <div style={{padding:"0 12px 2px",flex:1,display:"flex",flexDirection:"column",minHeight:0}}>
      {/* ヘッダー */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}>
        <div style={{fontSize:8,fontFamily:"var(--font-mono)",letterSpacing:2,color:"var(--slate)",textTransform:"uppercase"}}>コース</div>
        <div style={{display:"flex",borderRadius:6,overflow:"hidden",border:"1px solid rgba(255,255,255,0.12)"}}>
          {[["pitcher","投手視点"],["batter","打者視点"]].map(([v,lbl])=>(
            <button key={v} onClick={()=>setView(v)} style={{
              padding:"3px 11px",fontSize:9,fontWeight:600,
              fontFamily:"var(--font-mono)",border:"none",cursor:"pointer",
              background:view===v?"var(--blue-light)":"transparent",
              color:view===v?"#fff":"var(--slate)",
              transition:"all 0.12s",
            }}>{lbl}</button>
          ))}
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",height:"100%",flex:1,display:"block",cursor:"crosshair",touchAction:"none",overflow:"visible"}} onPointerDown={handleTap}>

        {/* 打者シルエット */}
        {view==="pitcher" ? PitcherBatter() : BatterBacker()}

        {/* ゾーンセル */}
        {grid.map((row,ri)=>row.map((zn,ci)=>{
          const x=ZX+ci*CW, y=ZY+ri*CH;
          const sel=selected===zn;
          const corner=[1,3,7,9].includes(zn);
          return (
            <g key={zn}>
              <rect x={x+1} y={y+1} width={CW-2} height={CH-2} rx={3}
                fill={sel?"rgba(59,130,246,0.28)":corner?"rgba(255,255,255,0.03)":"rgba(255,255,255,0.07)"}
                stroke={sel?"#63B3ED":"rgba(255,255,255,0.16)"} strokeWidth={sel?1.5:1}/>
              {sel&&<rect x={x+1} y={y+1} width={CW-2} height={CH-2} rx={3}
                fill="none" stroke="#63B3ED" strokeWidth={2.5}
                style={{filter:"drop-shadow(0 0 5px rgba(99,179,237,0.7))"}}/>}
              <text x={x+CW/2} y={y+CH/2+6} textAnchor="middle"
                fontSize={corner?13:17} fontWeight={sel?900:600}
                fill={sel?"#93C5FD":corner?"rgba(255,255,255,0.28)":"rgba(255,255,255,0.6)"}
                fontFamily="monospace" style={{pointerEvents:"none"}}>{zn}</text>
            </g>
          );
        }))}

        {/* ゾーン外枠 */}
        <rect x={ZX} y={ZY} width={ZW} height={ZH} fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth={1.5} rx={2}/>

        {/* ホームベース */}
        <polygon points={hbPts} fill="rgba(255,255,255,0.1)" stroke="rgba(255,255,255,0.5)" strokeWidth={1.5}/>

        {/* ラベル */}
        <text x={W/2} y={H-4} textAnchor="middle" fontSize={8} fill="rgba(255,255,255,0.18)" fontFamily="monospace" style={{pointerEvents:"none"}}>
          {view==="pitcher" ? "← 三塁側　内角（右打者）　外角　一塁側 →" : "← 一塁側　外角（右打者）　内角　三塁側 →"}
        </text>
      </svg>
    </div>
  );
});


// ═══════════════════════════════════════════════════════════════════
//  resolveFieldArea — タップ座標 → エリア名
// ═══════════════════════════════════════════════════════════════════
function resolveFieldArea(nx, ny) {
  const angle = Math.atan2(nx - 0.5, 1 - ny) * 180 / Math.PI;
  const dist  = Math.sqrt((nx - 0.5) ** 2 + (1 - ny) ** 2);
  let dir;
  if      (angle > -22 && angle < 22)   dir = "center";
  else if (angle >= 22  && angle < 70)  dir = "right-center";
  else if (angle >= 70  && angle < 110) dir = "right";
  else if (angle >= 110)                dir = "foul-right";
  else if (angle <= -22 && angle > -70) dir = "left-center";
  else if (angle <= -70 && angle > -110)dir = "left";
  else                                   dir = "foul-left";
  const zm = {
    "center":      {i:"二遊間",  m:"センター前", o:"センター"},
    "right-center":{i:"一二塁間",m:"右中間",     o:"右中間"},
    "right":       {i:"一塁線",  m:"ライト前",   o:"ライト"},
    "foul-right":  {i:"一塁ファウル",m:"ライトF",o:"ライトF"},
    "left-center": {i:"三遊間",  m:"左中間",     o:"左中間"},
    "left":        {i:"三塁線",  m:"レフト前",   o:"レフト"},
    "foul-left":   {i:"三塁ファウル",m:"レフトF",o:"レフトF"},
  };
  const z = zm[dir] || zm["center"];
  const zone = dist < 0.35 ? z.i : dist < 0.62 ? z.m : z.o;
  const legacyDir = dir.includes("left") ? "left" : dir.includes("right") ? "right" : "center";
  return { zone, legacyDir };
}

// ═══════════════════════════════════════════════════════════════════
//  ROSTER SCREEN — 打者・投手メンバー管理 & スタッツ
// ═══════════════════════════════════════════════════════════════════
function RosterScreen({ game, dispatchGame }) {
  const [editSide,    setEditSide]    = useState("away");
  const [viewMode,    setViewMode]    = useState("batter"); // "batter" | "pitcher"
  const [editIdx,     setEditIdx]     = useState(null);
  const [inputVal,    setInputVal]    = useState("");
  const [statsTarget, setStatsTarget] = useState(null); // {type:"batter"|"pitcher", side, idx?, name}

  const lineup    = game.lineup[editSide];
  const batterIdx = game.batterIdx[editSide];
  const pitcherName = (side) => game.pitcher?.[side] || "";

  const displayName = (p, i) => p.name || `#${i + 1}`;

  // ── 打者編集 ──
  const openBatterEdit = (i) => { setEditIdx(i); setInputVal(lineup[i].name); };
  const commitBatterEdit = () => {
    if (editIdx === null) return;
    dispatchGame({ type:"SUBSTITUTE", side:editSide, order:editIdx, name:inputVal.trim() });
    setEditIdx(null); setInputVal("");
  };
  const jumpBatter = (i) => dispatchGame({ type:"SET_BATTER", side:editSide, idx:i });

  // ── 投手編集 ──
  const [pitcherEdit, setPitcherEdit] = useState(null); // "away"|"home"|null
  const [pitcherInput, setPitcherInput] = useState("");
  const openPitcherEdit = (side) => { setPitcherEdit(side); setPitcherInput(pitcherName(side)); };
  const commitPitcherEdit = () => {
    if (!pitcherEdit) return;
    dispatchGame({ type:"SET_PITCHER", side:pitcherEdit, name:pitcherInput.trim() });
    setPitcherEdit(null); setPitcherInput("");
  };

  // ── 打者スタッツ集計 ──
  const calcBatterStats = (side, idx) => {
    const name = game.lineup[side][idx]?.name || `#${idx + 1}`;
    const targetHalf = side === "away" ? "top" : "bottom";
    const pitches = game.pitchHistory.filter(p => p.batter === name && p.half === targetHalf);
    const total   = pitches.length;
    const balls   = pitches.filter(p => p.result === "ball").length;
    const strikes = pitches.filter(p => ["strike_looking","strike_swinging","foul"].includes(p.result)).length;
    const fouls   = pitches.filter(p => p.result === "foul").length;
    const hits    = pitches.filter(p => p.result === "hit").length;
    const outs    = pitches.filter(p => p.result === "out").length;
    const reaches = pitches.filter(p => p.result === "reach").length;
    const singles  = pitches.filter(p => p.result==="hit" && p.hitType==="single").length;
    const doubles  = pitches.filter(p => p.result==="hit" && p.hitType==="double").length;
    const triples  = pitches.filter(p => p.result==="hit" && p.hitType==="triple").length;
    const homeRuns = pitches.filter(p => p.result==="hit" && p.hitType==="home_run").length;
    const byPitch = {}, byZone = {};
    pitches.forEach(p => {
      if (p.pitchType) byPitch[p.pitchType] = (byPitch[p.pitchType]||0)+1;
      if (p.zone)      byZone[p.zone]        = (byZone[p.zone]||0)+1;
    });
    return { name, total, balls, strikes, fouls, hits, outs, reaches, singles, doubles, triples, homeRuns, byPitch, byZone };
  };

  // ── 投手スタッツ集計 ──
  const calcPitcherStats = (side) => {
    const name = pitcherName(side) || (side==="away"?"AWAY投手":"HOME投手");
    // 投手の守備側 = 相手の攻撃イニング
    const targetHalf = side === "away" ? "bottom" : "top"; // away投手はhome攻撃(bottom)時に投げる
    const pitches = game.pitchHistory.filter(p => p.pitcher === name && p.half === targetHalf);
    // 名前未設定時はhalf/sideで絞る
    const allP = pitches.length > 0 ? pitches
      : game.pitchHistory.filter(p => p.half === targetHalf);
    const ps    = allP;
    const total  = ps.length;
    const balls  = ps.filter(p => p.result==="ball").length;
    const strikeLooking = ps.filter(p => p.result==="strike_looking").length;
    const strikeSwing   = ps.filter(p => p.result==="strike_swinging").length;
    const fouls         = ps.filter(p => p.result==="foul").length;
    const totalStrikes  = strikeLooking + strikeSwing + fouls;
    const hits   = ps.filter(p => p.result==="hit").length;
    const outs   = ps.filter(p => p.result==="out").length;
    const reaches= ps.filter(p => p.result==="reach").length;
    const inplay = ps.filter(p => p.result==="inplay").length;
    const homeRuns = ps.filter(p => p.result==="hit"&&p.hitType==="home_run").length;
    const byPitch = {}, byZone = {}, byBatter = {};
    ps.forEach(p => {
      if (p.pitchType) byPitch[p.pitchType] = (byPitch[p.pitchType]||0)+1;
      if (p.zone)      byZone[p.zone]        = (byZone[p.zone]||0)+1;
      if (p.batter)    byBatter[p.batter]    = (byBatter[p.batter]||0)+1;
    });
    const strikeRate = total > 0 ? Math.round(totalStrikes/total*100) : 0;
    return { name, total, balls, strikeLooking, strikeSwing, fouls, totalStrikes, strikeRate,
             hits, outs, reaches, inplay, homeRuns, byPitch, byZone, byBatter };
  };

  // ── スタッツモーダル ──
  const StatsModal = () => {
    if (!statsTarget) return null;
    const isBatter = statsTarget.type === "batter";
    const d = isBatter ? calcBatterStats(statsTarget.side, statsTarget.idx) : calcPitcherStats(statsTarget.side);

    return (
      <div style={{position:"fixed",inset:0,zIndex:700,background:"rgba(0,0,0,0.85)",display:"flex",flexDirection:"column",justifyContent:"flex-end",maxWidth:480,margin:"0 auto"}}
        onClick={()=>setStatsTarget(null)}>
        <div style={{background:"var(--surface2)",borderRadius:"16px 16px 0 0",padding:16,maxHeight:"78dvh",display:"flex",flexDirection:"column",overflowY:"auto"}}
          onClick={e=>e.stopPropagation()}>

          {/* モーダルヘッダー */}
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14,flexShrink:0}}>
            <div>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontSize:13}}>{isBatter?"🏏":"⚾"}</span>
                <span style={{fontSize:18,fontWeight:700,color:"var(--white)",fontFamily:"var(--font-body)"}}>{d.name}</span>
              </div>
              <div style={{fontSize:10,color:"var(--slate)",fontFamily:"var(--font-mono)",marginTop:2}}>
                {statsTarget.side==="away"?"AWAY":"HOME"} · {isBatter?`${statsTarget.idx+1}番打者`:"投手"}
              </div>
            </div>
            <button onClick={()=>setStatsTarget(null)} style={{width:32,height:32,borderRadius:8,border:"1px solid var(--border2)",background:"var(--surface3)",color:"var(--slate-light)",fontSize:16,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
          </div>

          {d.total === 0 ? (
            <div style={{textAlign:"center",color:"var(--slate)",fontFamily:"var(--font-mono)",fontSize:12,padding:"24px 0"}}>記録なし</div>
          ) : isBatter ? (
            // ── 打者スタッツ ──
            <>
              <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6,marginBottom:12}}>
                {[["投球数",d.total,"var(--white)"],["安打",d.hits,"var(--green-light)"],["アウト",d.outs,"var(--red-light)"],["出塁",d.reaches,"var(--amber-light)"]].map(([l,v,c])=>(
                  <div key={l} style={{background:"var(--surface3)",borderRadius:8,padding:"8px 4px",textAlign:"center"}}>
                    <div style={{fontSize:18,fontWeight:700,color:c,fontFamily:"var(--font-mono)"}}>{v}</div>
                    <div style={{fontSize:9,color:"var(--slate)",fontFamily:"var(--font-mono)",marginTop:2}}>{l}</div>
                  </div>
                ))}
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6,marginBottom:12}}>
                {[["ボール",d.balls,"var(--green-light)"],["ストライク",d.strikes,"var(--blue-light)"],["ファウル",d.fouls,"var(--slate-light)"]].map(([l,v,c])=>(
                  <div key={l} style={{background:"rgba(255,255,255,0.04)",borderRadius:8,padding:"6px 4px",textAlign:"center",border:"1px solid var(--border)"}}>
                    <div style={{fontSize:15,fontWeight:700,color:c,fontFamily:"var(--font-mono)"}}>{v}</div>
                    <div style={{fontSize:9,color:"var(--slate)",fontFamily:"var(--font-mono)",marginTop:1}}>{l}</div>
                  </div>
                ))}
              </div>
              {d.hits > 0 && (
                <div style={{marginBottom:12}}>
                  <div style={{fontSize:9,color:"var(--slate)",fontFamily:"var(--font-mono)",letterSpacing:2,marginBottom:6}}>安打内訳</div>
                  <div style={{display:"flex",gap:6}}>
                    {[["単打",d.singles,"#22C55E"],["二塁打",d.doubles,"#3B82F6"],["三塁打",d.triples,"#F59E0B"],["本塁打",d.homeRuns,"#EF4444"]].map(([l,v,c])=>v>0?(
                      <div key={l} style={{flex:1,background:`rgba(${c==='#22C55E'?'34,197,94':c==='#3B82F6'?'59,130,246':c==='#F59E0B'?'245,158,11':'239,68,68'},0.1)`,border:`1px solid ${c}40`,borderRadius:8,padding:"6px 4px",textAlign:"center"}}>
                        <div style={{fontSize:14,fontWeight:700,color:c,fontFamily:"var(--font-mono)"}}>{v}</div>
                        <div style={{fontSize:9,color:"var(--slate)",fontFamily:"var(--font-mono)"}}>{l}</div>
                      </div>
                    ):null)}
                  </div>
                </div>
              )}
              {Object.keys(d.byPitch).length > 0 && (
                <div style={{marginBottom:12}}>
                  <div style={{fontSize:9,color:"var(--slate)",fontFamily:"var(--font-mono)",letterSpacing:2,marginBottom:6}}>受けた球種</div>
                  <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                    {Object.entries(d.byPitch).sort((a,b)=>b[1]-a[1]).map(([pt,cnt])=>(
                      <div key={pt} style={{background:"var(--surface3)",borderRadius:6,padding:"4px 10px",display:"flex",gap:6,alignItems:"center"}}>
                        <span style={{fontSize:11,color:"var(--dim)"}}>{pt}</span>
                        <span style={{fontSize:12,fontWeight:700,color:"var(--white)",fontFamily:"var(--font-mono)"}}>{cnt}</span>
                        <span style={{fontSize:9,color:"var(--slate)"}}>{Math.round(cnt/d.total*100)}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {Object.keys(d.byZone).length > 0 && (
                <div>
                  <div style={{fontSize:9,color:"var(--slate)",fontFamily:"var(--font-mono)",letterSpacing:2,marginBottom:6}}>コース別（受けた球）</div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:3,maxWidth:180,margin:"0 auto"}}>
                    {[1,2,3,4,5,6,7,8,9].map(z=>{
                      const cnt=d.byZone[z]||0,max=Math.max(...Object.values(d.byZone));
                      return <div key={z} style={{height:44,borderRadius:6,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:`rgba(59,130,246,${0.05+(max>0?cnt/max*0.5:0)})`,border:`1px solid rgba(99,179,237,${0.1+(max>0?cnt/max*0.4:0)})`}}>
                        <span style={{fontSize:13,fontWeight:700,color:cnt>0?"var(--white)":"var(--slate)",fontFamily:"var(--font-mono)"}}>{cnt||"·"}</span>
                        <span style={{fontSize:8,color:"var(--slate)",fontFamily:"var(--font-mono)"}}>{z}</span>
                      </div>;
                    })}
                  </div>
                </div>
              )}
            </>
          ) : (
            // ── 投手スタッツ ──
            <>
              <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6,marginBottom:12}}>
                {[["総投球数",d.total,"var(--white)"],["打たれた安打",d.hits,"var(--red-light)"],["奪アウト",d.outs,"var(--green-light)"],["被本塁打",d.homeRuns,"#F97316"]].map(([l,v,c])=>(
                  <div key={l} style={{background:"var(--surface3)",borderRadius:8,padding:"8px 4px",textAlign:"center"}}>
                    <div style={{fontSize:18,fontWeight:700,color:c,fontFamily:"var(--font-mono)"}}>{v}</div>
                    <div style={{fontSize:8,color:"var(--slate)",fontFamily:"var(--font-mono)",marginTop:2,lineHeight:1.2}}>{l}</div>
                  </div>
                ))}
              </div>
              {/* ストライク率 */}
              <div style={{marginBottom:12,background:"var(--surface3)",borderRadius:10,padding:"10px 14px"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                  <span style={{fontSize:10,color:"var(--slate)",fontFamily:"var(--font-mono)"}}>ストライク率</span>
                  <span style={{fontSize:16,fontWeight:700,color:"var(--blue-light)",fontFamily:"var(--font-mono)"}}>{d.strikeRate}%</span>
                </div>
                <div style={{height:6,borderRadius:3,background:"rgba(255,255,255,0.08)",overflow:"hidden"}}>
                  <div style={{height:"100%",width:`${d.strikeRate}%`,background:"linear-gradient(90deg,var(--blue),var(--blue-light))",borderRadius:3,transition:"width 0.4s"}}/>
                </div>
                <div style={{display:"flex",justifyContent:"space-between",marginTop:8,gap:6}}>
                  {[["見逃し",d.strikeLooking,"var(--blue-light)"],["空振り",d.strikeSwing,"var(--amber-light)"],["ファウル",d.fouls,"var(--slate-light)"],["ボール",d.balls,"var(--green-light)"]].map(([l,v,c])=>(
                    <div key={l} style={{flex:1,textAlign:"center"}}>
                      <div style={{fontSize:13,fontWeight:700,color:c,fontFamily:"var(--font-mono)"}}>{v}</div>
                      <div style={{fontSize:8,color:"var(--slate)",fontFamily:"var(--font-mono)"}}>{l}</div>
                    </div>
                  ))}
                </div>
              </div>
              {/* 球種構成 */}
              {Object.keys(d.byPitch).length > 0 && (
                <div style={{marginBottom:12}}>
                  <div style={{fontSize:9,color:"var(--slate)",fontFamily:"var(--font-mono)",letterSpacing:2,marginBottom:6}}>球種構成</div>
                  <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                    {Object.entries(d.byPitch).sort((a,b)=>b[1]-a[1]).map(([pt,cnt])=>(
                      <div key={pt} style={{background:"var(--surface3)",borderRadius:6,padding:"4px 10px",display:"flex",gap:6,alignItems:"center"}}>
                        <span style={{fontSize:11,color:"var(--dim)"}}>{pt}</span>
                        <span style={{fontSize:12,fontWeight:700,color:"var(--white)",fontFamily:"var(--font-mono)"}}>{cnt}</span>
                        <span style={{fontSize:9,color:"var(--slate)"}}>{Math.round(cnt/d.total*100)}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {/* 投球コースヒートマップ */}
              {Object.keys(d.byZone).length > 0 && (
                <div style={{marginBottom:12}}>
                  <div style={{fontSize:9,color:"var(--slate)",fontFamily:"var(--font-mono)",letterSpacing:2,marginBottom:6}}>投球コース分布</div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:3,maxWidth:180,margin:"0 auto"}}>
                    {[1,2,3,4,5,6,7,8,9].map(z=>{
                      const cnt=d.byZone[z]||0,max=Math.max(...Object.values(d.byZone));
                      return <div key={z} style={{height:44,borderRadius:6,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:`rgba(239,68,68,${0.05+(max>0?cnt/max*0.5:0)})`,border:`1px solid rgba(252,165,165,${0.1+(max>0?cnt/max*0.4:0)})`}}>
                        <span style={{fontSize:13,fontWeight:700,color:cnt>0?"var(--white)":"var(--slate)",fontFamily:"var(--font-mono)"}}>{cnt||"·"}</span>
                        <span style={{fontSize:8,color:"var(--slate)",fontFamily:"var(--font-mono)"}}>{z}</span>
                      </div>;
                    })}
                  </div>
                </div>
              )}
              {/* 対戦打者別 */}
              {Object.keys(d.byBatter).length > 0 && (
                <div>
                  <div style={{fontSize:9,color:"var(--slate)",fontFamily:"var(--font-mono)",letterSpacing:2,marginBottom:6}}>対戦打者別</div>
                  <div style={{display:"flex",flexDirection:"column",gap:4}}>
                    {Object.entries(d.byBatter).sort((a,b)=>b[1]-a[1]).map(([batter,cnt])=>(
                      <div key={batter} style={{display:"flex",alignItems:"center",gap:8,padding:"4px 8px",borderRadius:6,background:"rgba(255,255,255,0.04)"}}>
                        <span style={{flex:1,fontSize:12,color:"var(--dim)",fontFamily:"var(--font-body)"}}>{batter}</span>
                        <div style={{height:4,width:80,borderRadius:2,background:"rgba(255,255,255,0.08)",overflow:"hidden"}}>
                          <div style={{height:"100%",width:`${cnt/d.total*100}%`,background:"var(--blue-light)",borderRadius:2}}/>
                        </div>
                        <span style={{fontSize:11,fontWeight:600,color:"var(--white)",fontFamily:"var(--font-mono)",width:20,textAlign:"right"}}>{cnt}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <div style={{display:"flex", flexDirection:"column", flex:1, minHeight:0}}>
      <StatsModal/>

      {/* ── チーム × 打者/投手 タブ ── */}
      <div style={{flexShrink:0, borderBottom:"1px solid var(--border)"}}>
        {/* チーム行 */}
        <div style={{display:"flex"}}>
          {["away","home"].map(s=>(
            <button key={s} onClick={()=>{setEditSide(s);setEditIdx(null);setPitcherEdit(null);}} style={{
              flex:1,padding:"6px 0",background:"none",border:"none",
              borderBottom:`2px solid ${editSide===s?"var(--blue-light)":"transparent"}`,
              color:editSide===s?"var(--blue-light)":"var(--slate-light)",
              fontFamily:"var(--font-body)",fontSize:12,fontWeight:600,cursor:"pointer",
            }}>{s==="away"?"AWAY":"HOME"}</button>
          ))}
        </div>
        {/* 打者/投手 切替 */}
        <div style={{display:"flex",padding:"4px 12px 6px",gap:6}}>
          {[["batter","🏏 打者"],["pitcher","⚾ 投手"]].map(([mode,label])=>(
            <button key={mode} onClick={()=>{setViewMode(mode);setEditIdx(null);setPitcherEdit(null);}} style={{
              flex:1,padding:"5px 0",borderRadius:7,border:"none",cursor:"pointer",fontSize:11,fontWeight:600,
              fontFamily:"var(--font-body)",
              background:viewMode===mode?"var(--surface3)":"transparent",
              color:viewMode===mode?"var(--white)":"var(--slate)",
              transition:"all 0.15s",
            }}>{label}</button>
          ))}
        </div>
      </div>

      {/* ── コンテンツ ── */}
      <div style={{flex:1,overflowY:"auto",padding:"8px 12px"}}>

        {viewMode === "pitcher" ? (
          // ── 投手ビュー ──
          <div>
            {/* 現在の投手カード */}
            {["away","home"].map(side => {
              const name = pitcherName(side);
              const displayP = name || (side==="away"?"AWAY投手":"HOME投手");
              const isEditing = pitcherEdit === side;
              return (
                <div key={side} style={{marginBottom:10,padding:"12px 12px",borderRadius:12,background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.1)"}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:isEditing?8:0}}>
                    <div style={{width:32,height:32,borderRadius:8,background:"rgba(59,130,246,0.15)",border:"1px solid rgba(59,130,246,0.3)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,flexShrink:0}}>⚾</div>
                    <div style={{flex:1}}>
                      <div style={{fontSize:9,color:"var(--slate)",fontFamily:"var(--font-mono)",letterSpacing:1}}>{side==="away"?"AWAY":"HOME"} PITCHER</div>
                      {!isEditing && (
                        <div onClick={()=>setStatsTarget({type:"pitcher",side})} style={{fontSize:14,fontWeight:600,color:name?"var(--white)":"var(--slate)",fontFamily:"var(--font-body)",cursor:"pointer",marginTop:1}}>
                          {displayP}
                        </div>
                      )}
                    </div>
                    {!isEditing && (
                      <button onClick={()=>openPitcherEdit(side)} style={{height:26,padding:"0 10px",borderRadius:6,border:"1px solid rgba(255,255,255,0.12)",background:"rgba(255,255,255,0.04)",color:"var(--slate-light)",fontSize:10,cursor:"pointer"}}>編集</button>
                    )}
                  </div>
                  {isEditing && (
                    <div style={{display:"flex",gap:6}}>
                      <input autoFocus value={pitcherInput}
                        onChange={e=>setPitcherInput(e.target.value)}
                        onKeyDown={e=>{if(e.key==="Enter")commitPitcherEdit();if(e.key==="Escape")setPitcherEdit(null);}}
                        placeholder="投手名を入力"
                        style={{flex:1,height:30,borderRadius:7,border:"1.5px solid var(--blue-light)",background:"#0d1e35",color:"#fff",fontSize:13,padding:"0 10px",fontFamily:"var(--font-body)",outline:"none"}}
                      />
                      <button onClick={commitPitcherEdit} style={{height:30,padding:"0 12px",borderRadius:7,border:"none",background:"var(--blue-light)",color:"#fff",fontSize:11,fontWeight:700,cursor:"pointer"}}>確定</button>
                      <button onClick={()=>setPitcherEdit(null)} style={{height:30,padding:"0 8px",borderRadius:7,border:"1px solid rgba(255,255,255,0.15)",background:"none",color:"var(--slate-light)",fontSize:11,cursor:"pointer"}}>✕</button>
                    </div>
                  )}
                  {!isEditing && (
                    <button onClick={()=>setStatsTarget({type:"pitcher",side})} style={{marginTop:8,width:"100%",padding:"5px 0",borderRadius:7,border:"1px solid rgba(59,130,246,0.2)",background:"rgba(59,130,246,0.06)",color:"var(--blue-light)",fontSize:10,fontWeight:600,cursor:"pointer",fontFamily:"var(--font-mono)"}}>
                      📊 スタッツを見る
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          // ── 打者ビュー ──
          <div>
            {lineup.map((p, i) => {
              const isCurrent = i === batterIdx;
              const isEditing = editIdx === i;
              const name = displayName(p, i);
              return (
                <div key={i} style={{
                  display:"flex",alignItems:"center",gap:8,marginBottom:5,
                  padding:"7px 10px",borderRadius:10,
                  background:isCurrent?"rgba(59,130,246,0.12)":"rgba(255,255,255,0.03)",
                  border:isCurrent?"1px solid rgba(59,130,246,0.35)":"1px solid rgba(255,255,255,0.07)",
                }}>
                  <div style={{width:26,height:26,borderRadius:"50%",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",background:isCurrent?"var(--blue-light)":"rgba(255,255,255,0.08)",color:isCurrent?"#fff":"var(--slate-light)",fontSize:11,fontWeight:700,fontFamily:"var(--font-mono)"}}>{i+1}</div>
                  {isEditing ? (
                    <input autoFocus value={inputVal}
                      onChange={e=>setInputVal(e.target.value)}
                      onKeyDown={e=>{if(e.key==="Enter")commitBatterEdit();if(e.key==="Escape")setEditIdx(null);}}
                      placeholder="選手名を入力"
                      style={{flex:1,height:30,borderRadius:7,border:"1.5px solid var(--blue-light)",background:"#0d1e35",color:"#fff",fontSize:13,padding:"0 10px",fontFamily:"var(--font-body)",outline:"none"}}
                    />
                  ) : (
                    <div onClick={()=>setStatsTarget({type:"batter",side:editSide,idx:i})}
                      style={{flex:1,fontSize:13,fontWeight:isCurrent?700:400,color:isCurrent?"#fff":p.name?"var(--dim)":"var(--slate)",fontFamily:"var(--font-body)",cursor:"pointer",padding:"2px 0"}}>
                      {name}{!p.name&&<span style={{fontSize:9,color:"var(--slate)",fontFamily:"var(--font-mono)",marginLeft:4}}>未入力</span>}
                    </div>
                  )}
                  <div style={{display:"flex",gap:4,flexShrink:0}}>
                    {isEditing ? (
                      <>
                        <button onClick={commitBatterEdit} style={{height:26,padding:"0 10px",borderRadius:6,border:"none",background:"var(--blue-light)",color:"#fff",fontSize:11,fontWeight:700,cursor:"pointer"}}>確定</button>
                        <button onClick={()=>setEditIdx(null)} style={{height:26,padding:"0 8px",borderRadius:6,border:"1px solid rgba(255,255,255,0.15)",background:"none",color:"var(--slate-light)",fontSize:11,cursor:"pointer"}}>✕</button>
                      </>
                    ) : (
                      <>
                        <button onClick={()=>openBatterEdit(i)} style={{height:26,padding:"0 8px",borderRadius:6,border:"1px solid rgba(255,255,255,0.12)",background:"rgba(255,255,255,0.04)",color:"var(--slate-light)",fontSize:10,cursor:"pointer"}}>編集</button>
                        {isCurrent
                          ? <div style={{height:26,padding:"0 6px",display:"flex",alignItems:"center",fontSize:10,color:"var(--blue-light)",fontWeight:700}}>🏏</div>
                          : <button onClick={()=>jumpBatter(i)} style={{height:26,padding:"0 7px",borderRadius:6,border:"1px solid rgba(59,130,246,0.3)",background:"rgba(59,130,246,0.08)",color:"var(--blue-light)",fontSize:10,cursor:"pointer"}}>打席</button>
                        }
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
const LogScreen = ({ pitchHistory, onExport }) => {
  const RESULT_LABEL = {
    strike_looking: { label:"見逃し",   short:"見",  col:"#3B82F6" },
    strike_swinging:{ label:"空振り",   short:"空",  col:"#F59E0B" },
    foul:           { label:"ファウル", short:"F",   col:"#94A3B8" },
    ball:           { label:"ボール",   short:"B",   col:"#22C55E" },
    inplay:         { label:"インプレー",short:"IN", col:"#EF4444" },
  };
  const BATTED_LABEL = { ground:"ゴロ", liner:"ライナー", fly:"フライ" };
  const OUTCOME_LABEL = { out:"アウト", hit:"ヒット", error:"エラー" };
  const HALF_LABEL    = { top:"表", bottom:"裏" };

  const baseDots = (bases) => {
    if (!bases) return "---";
    return [bases.first?"1":"−", bases.second?"2":"−", bases.third?"3":"−"].join("");
  };

  return (
    <div style={{flex:1, display:"flex", flexDirection:"column", minHeight:0, overflowY:"auto"}}>
      {pitchHistory.length === 0 && (
        <div style={{flex:1, display:"flex", alignItems:"center", justifyContent:"center", color:"var(--slate)", fontFamily:"var(--font-mono)", fontSize:12}}>
          記録がありません
        </div>
      )}
      {[...pitchHistory].reverse().map((p, idx) => {
        const rl = RESULT_LABEL[p.result] || { label: p.result, short:"?", col:"#94A3B8" };
        const isInplay = p.result === "inplay" || p.result === "hit" || p.result === "out" || p.result === "reach";
        const HIT_LABEL = {single:"単打",double:"二塁打",triple:"三塁打",home_run:"本塁打"};
        const REACH_LABEL = {fielding_error:"エラー",fc:"野選"};
        return (
          <div key={idx} style={{
            margin:"4px 10px", padding:"8px 10px", borderRadius:10,
            background:"var(--surface2)", border:"1px solid var(--border)",
          }}>
            <div style={{display:"flex", alignItems:"center", gap:6, flexWrap:"wrap"}}>
              <span style={{fontFamily:"var(--font-mono)", fontSize:11, color:"var(--slate-light)"}}>{p.pitchNumber}</span>
              <span style={{fontFamily:"var(--font-mono)", fontSize:10, color:"var(--dim)"}}>{p.inning}{HALF_LABEL[p.half]||p.half}</span>
              {p.batter && <span style={{fontFamily:"var(--font-body)", fontSize:11, color:"var(--white)", fontWeight:600}}>{p.batter}</span>}
              {p.speed && <span style={{fontFamily:"var(--font-mono)", fontSize:10, color:"var(--amber-light)"}}>{p.speed}km/h</span>}
              {p.pitchType && <span style={{fontSize:10, color:"var(--slate-light)"}}>{p.pitchType}</span>}
              {p.zone && <span style={{fontFamily:"var(--font-mono)", fontSize:10, color:"var(--slate)"}}>z{p.zone}</span>}
              <span style={{fontSize:11, fontWeight:700, color:rl.col}}>{rl.short}</span>
              {p.result==="hit"   && p.hitType   && <span style={{fontSize:10, color:"#22C55E"}}>{HIT_LABEL[p.hitType]}</span>}
              {p.result==="reach" && p.reachType && <span style={{fontSize:10, color:"#F59E0B"}}>{REACH_LABEL[p.reachType]}</span>}
            </div>
            {isInplay && p.landingPos?.zone && (
              <div style={{marginTop:4, fontSize:10, color:"var(--slate)"}}>
                📍 {p.landingPos.zone}
                {BATTED_LABEL[p.battedType] && ` · ${BATTED_LABEL[p.battedType]}`}
                {OUTCOME_LABEL[p.outcome] && ` · ${OUTCOME_LABEL[p.outcome]}`}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

function App() {
  const [game, dispatch]  = useState(INIT_GAME);
  const [pitch, setPitch] = useState(INIT_PITCH);
  const [tab, setTab]     = useState("input");
  const [notif, setNotif] = useState(null);
  const [csvModal, setCsvModal] = useState(null); // null | string(CSV text)
  const timer = useRef(null);

  const dispatchGame = useCallback(a => dispatch(p => gameReducer(p, a)), []);

  const showNotif = useCallback((msg, type="") => {
    if (timer.current) clearTimeout(timer.current);
    setNotif({ msg, type });
    timer.current = setTimeout(() => setNotif(null), 2000);
  }, []);

  const handleResult = useCallback(r => {
    setPitch(p => ({ ...p, result: r, battedType: null, landingPos: null, direction: null, outcome: null, hitType: null, reachType: null }));
  }, []);

  const confirmable = (() => {
    if (!pitch.pitchType || !pitch.zone || !pitch.result) return false;
    if (pitch.result === "foul")  return true; // ファウルはフリックで完結
    if (pitch.result === "hit")   return !!pitch.hitType;
    if (pitch.result === "reach") return !!pitch.reachType;
    if (pitch.result === "out")   return !!pitch.battedType;
    return true;
  })();

  const handleConfirm = useCallback(() => {
    if (!confirmable) return;
    if ((pitch.result === "strike_looking" || pitch.result === "strike_swinging") && game.strikes === 2) showNotif("三 振 !", "strikeout");
    else if (pitch.result === "ball" && game.balls === 3) showNotif("四 球", "walk");
    else if (pitch.result === "hit" && pitch.hitType === "home_run") showNotif("ホームラン！", "homerun");
    dispatchGame({ type: "RECORD_PITCH", pitch: { ...pitch } });
    setPitch(INIT_PITCH);
  }, [pitch, game, dispatchGame, showNotif, confirmable]);

  const handleCSV = useCallback(() => {
    const RESULT_JP = {
      strike_looking:"見逃しストライク", strike_swinging:"空振りストライク",
      foul:"ファウル", ball:"ボール", inplay:"インプレー",
      hit:"安打", out:"アウト", reach:"出塁",
    };
    const HIT_JP    = { single:"単打", double:"二塁打", triple:"三塁打", home_run:"本塁打" };
    const REACH_JP  = { fielding_error:"エラー", fc:"野選" };
    const BATTED_JP = { ground:"ゴロ", liner:"ライナー", fly:"フライ" };
    const OUTCOME_JP= { out:"アウト", hit:"ヒット", error:"エラー" };
    const HALF_JP   = { top:"表", bottom:"裏" };
    const esc = (v) => { const s = String(v ?? ""); return s.includes(",") ? `"${s}"` : s; };

    const header = [
      "投球番号","イニング","表裏","打者名","球速(km/h)",
      "投球前B","投球前S","投球前O",
      "走者(1塁)","走者(2塁)","走者(3塁)",
      "球種","コース(1-9)",
      "結果","安打種別","出塁種別",
      "打球種別","着弾エリア","打球方向","打球結果",
    ].map(esc).join(",");

    const rows = game.pitchHistory.map(p => {
      const bases = p.basesBefore || {};
      return [
        p.pitchNumber, p.inning, HALF_JP[p.half]||p.half,
        p.batter||"", p.speed??"",
        p.ballsBefore??"", p.strikesBefore??"", p.outsBefore??"",
        bases.first?"○":"−", bases.second?"○":"−", bases.third?"○":"−",
        p.pitchType||"", p.zone||"",
        RESULT_JP[p.result]||p.result||"",
        HIT_JP[p.hitType]||"", REACH_JP[p.reachType]||"",
        BATTED_JP[p.battedType]||"",
        p.landingPos?.zone||"",
        p.direction==="left"?"左":p.direction==="right"?"右":p.direction==="center"?"中":"",
        OUTCOME_JP[p.outcome]||"",
      ].map(esc).join(",");
    });

    // BOMなしでモーダル表示（コピー用）
    const csvPlain = [header, ...rows].join("\n");
    setCsvModal(csvPlain);
  }, [game.pitchHistory, setCsvModal]);

  const halfLabel = game.half === "top" ? "表" : "裏";
  const total = game.pitchHistory.length;

  return (
    <>
      <style>{CSS}</style>
      <div id="root">

        {/* 通知 */}
        {notif && (
          <div style={{position:"fixed",top:0,left:"50%",transform:"translateX(-50%)",zIndex:200,width:"100%",maxWidth:480,display:"flex",justifyContent:"center",paddingTop:58,pointerEvents:"none"}}>
            <div style={{background:"var(--surface3)",border:`1px solid ${notif.type==="strikeout"?"var(--red)":notif.type==="walk"?"var(--green)":"var(--amber)"}`,borderRadius:12,padding:"10px 26px",fontFamily:"var(--font-display)",fontSize:22,letterSpacing:3,color:notif.type==="strikeout"?"var(--red-light)":notif.type==="walk"?"var(--green-light)":"var(--amber-light)",boxShadow:"var(--shadow)",animation:"notifAnim 2s forwards"}}>{notif.msg}</div>
          </div>
        )}

        {/* CSVモーダル */}
        {csvModal !== null && (
          <div style={{position:"fixed",inset:0,zIndex:800,background:"rgba(0,0,0,0.88)",display:"flex",flexDirection:"column",maxWidth:480,margin:"0 auto"}} onClick={()=>setCsvModal(null)}>
            <div style={{margin:"auto 0",background:"var(--surface2)",borderRadius:"16px 16px 0 0",padding:16,maxHeight:"80dvh",display:"flex",flexDirection:"column"}} onClick={e=>e.stopPropagation()}>
              {/* ヘッダー */}
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
                <div style={{fontFamily:"var(--font-mono)",fontSize:11,color:"var(--slate-light)",letterSpacing:1}}>
                  📊 CSV — {game.pitchHistory.length}球
                </div>
                <div style={{display:"flex",gap:8}}>
                  <button onClick={()=>{
                    if(navigator.clipboard){
                      navigator.clipboard.writeText(csvModal).then(()=>showNotif("コピーしました","walk"));
                    } else {
                      // フォールバック: テキスト選択
                      const ta = document.querySelector("#csv-textarea");
                      if(ta){ ta.select(); document.execCommand("copy"); showNotif("コピーしました","walk"); }
                    }
                  }} style={{padding:"6px 14px",borderRadius:8,border:"none",background:"var(--blue-light)",color:"#fff",fontFamily:"var(--font-body)",fontSize:12,fontWeight:700,cursor:"pointer"}}>
                    📋 全コピー
                  </button>
                  <button onClick={()=>setCsvModal(null)} style={{width:32,height:32,borderRadius:8,border:"1px solid var(--border2)",background:"var(--surface3)",color:"var(--slate-light)",fontSize:16,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
                </div>
              </div>
              {/* テキストエリア */}
              <textarea id="csv-textarea" readOnly value={csvModal}
                style={{flex:1,minHeight:200,maxHeight:"55dvh",background:"var(--navy)",color:"var(--dim)",fontFamily:"var(--font-mono)",fontSize:10,lineHeight:1.6,padding:10,borderRadius:8,border:"1px solid var(--border2)",resize:"none",outline:"none",overflowY:"auto"}}
              />
              <div style={{marginTop:10,fontSize:10,color:"var(--slate)",fontFamily:"var(--font-mono)",textAlign:"center"}}>
                「全コピー」→ メモ帳 / Numbers / Excelなどに貼り付け
              </div>
            </div>
          </div>
        )}

        {/* ヘッダー */}
        {(()=>{
          const batSide = game.half==="top" ? "away" : "home";
          const batIdx  = game.batterIdx[batSide];
          const batName = game.lineup[batSide][batIdx]?.name || `#${batIdx+1}`;
          const pitName = game.pitcher?.[game.half==="top"?"home":"away"] || null;
          const isTop   = game.half === "top";

          // 菱形走者SVG
          const BaseDiamond = () => {
            const bases = game.bases;
            // 野球場を真上から見た菱形を四等分
            // 本塁(下)を除いた3ピース: 三塁(左)・二塁(上)・一塁(右)
            // 全体の菱形: 中心(cx,cy), 半径R
            const R = 14, cx = 22, cy = 19;
            // 四等分の頂点
            const top    = [cx,    cy - R]; // 二塁
            const right  = [cx+R,  cy    ]; // 一塁側
            const bottom = [cx,    cy + R]; // 本塁側(非表示)
            const left   = [cx-R,  cy    ]; // 三塁側
            const center = [cx,    cy    ]; // 中心

            // 三塁ピース: center→left→top  (左上)
            const thirdPts  = `${center[0]},${center[1]} ${left[0]},${left[1]} ${top[0]},${top[1]}`;
            // 二塁ピース: center→top→right (右上)
            const secondPts = `${center[0]},${center[1]} ${top[0]},${top[1]} ${right[0]},${right[1]}`;
            // 一塁ピース: center→right→bottom... でなく三塁と対称に
            // 一塁: center→top→right (右上三角) → いや正しくは
            // 三塁: left-center-top の三角  (左上象限)
            // 二塁: top-center はなく, 上の頂点を共有する上半分
            // 一塁: right-center-top (右上象限)
            // ただし隙間なく並べるため:
            //   三塁 = left→top→center (左上三角形)
            //   二塁 = (上の切れ目なし): top→right→left の上三角
            //   一塁 = right→center→top (右上三角形)
            // → 実際は中心から放射状に三等分ではなく、菱形を対角線で4分割した3つ
            //   3塁 = 左の三角(left, top, center)
            //   2塁 = 上の三角(top, ... ) ← 本来は top+right+left の上半菱形
            //         でも四等分なら top-right-center と top-left-center の2つが2塁
            //   1塁 = 右の三角(right, bottom, center)
            // シンプルに: 上半菱形=2塁, 左下=3塁, 右下=1塁, 下=本塁(非表示)
            const secondP = `${left[0]},${left[1]} ${top[0]},${top[1]} ${right[0]},${right[1]} ${cx},${cy}`;
            const thirdP  = `${cx},${cy} ${left[0]},${left[1]} ${cx},${cy+R}`;
            const firstP  = `${cx},${cy} ${right[0]},${right[1]} ${cx},${cy+R}`;

            const W = cx * 2, H = cy + R + 1;
            const GAP = 1.5; // ピース間の隙間

            const pieceStyle = (key, pts) => {
              const on = bases[key];
              return (
                <polygon key={key} points={pts}
                  fill={on ? "#F59E0B" : "rgba(255,255,255,0.06)"}
                  stroke="var(--navy2)"
                  strokeWidth={GAP}
                  style={{filter: on ? "drop-shadow(0 0 4px #F59E0BAA)" : "none", cursor:"pointer"}}
                  onClick={() => dispatchGame({type:"TOGGLE_BASE", base:key})}
                />
              );
            };

            return (
              <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{flexShrink:0}}>
                {/* 外枠（全体菱形のストローク） */}
                <polygon points={`${left[0]},${left[1]} ${top[0]},${top[1]} ${right[0]},${right[1]} ${cx},${cy+R}`}
                  fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth={1}/>
                {pieceStyle("second", secondP)}
                {pieceStyle("third",  thirdP)}
                {pieceStyle("first",  firstP)}
              </svg>
            );
          };

    return (
            <div style={{background:"var(--navy2)",borderBottom:"1px solid var(--border2)",padding:"6px 12px 5px",flexShrink:0}}>

              {/* 上段: イニング＋表裏 ／ スコア ／ 走者 */}
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:5}}>

                {/* イニング + 表裏三角 */}
                <div style={{display:"flex",alignItems:"center",gap:5,minWidth:52}}>
                  <span style={{fontFamily:"var(--font-display)",fontSize:26,lineHeight:1,color:"var(--white)"}}>{game.inning}</span>
                  <div style={{display:"flex",flexDirection:"column",gap:3}}>
                    {/* 表=上向き三角, 裏=下向き三角 */}
                    <svg width={12} height={8} viewBox="0 0 12 8">
                      <polygon points="6,0 12,8 0,8"
                        fill={isTop?"var(--white)":"rgba(255,255,255,0.18)"}
                        style={{filter:isTop?"drop-shadow(0 0 4px rgba(255,255,255,0.6))":"none"}}/>
                    </svg>
                    <svg width={12} height={8} viewBox="0 0 12 8">
                      <polygon points="6,8 12,0 0,0"
                        fill={!isTop?"var(--white)":"rgba(255,255,255,0.18)"}
                        style={{filter:!isTop?"drop-shadow(0 0 4px rgba(255,255,255,0.6))":"none"}}/>
                    </svg>
                  </div>
                </div>

                {/* スコア */}
                <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:0}}>
                  <div style={{textAlign:"center",minWidth:48}}>
                    <div style={{fontSize:8,color:"var(--blue-light)",fontFamily:"var(--font-mono)",letterSpacing:1,marginBottom:1}}>AWAY</div>
                    <div style={{fontSize:26,lineHeight:1,color:"var(--blue-light)",fontFamily:"var(--font-mono)",fontWeight:700}}>{game.score.away}</div>
                  </div>
                  <div style={{fontSize:14,color:"rgba(255,255,255,0.2)",fontFamily:"var(--font-mono)",padding:"0 6px",marginTop:8}}>–</div>
                  <div style={{textAlign:"center",minWidth:48}}>
                    <div style={{fontSize:8,color:"var(--amber-light)",fontFamily:"var(--font-mono)",letterSpacing:1,marginBottom:1}}>HOME</div>
                    <div style={{fontSize:26,lineHeight:1,color:"var(--amber-light)",fontFamily:"var(--font-mono)",fontWeight:700}}>{game.score.home}</div>
                  </div>
                </div>

                {/* 走者菱形 */}
                <BaseDiamond/>
              </div>

              {/* 下段: BSO ／ 打者・投手名 */}
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                {/* BSO */}
                <div style={{display:"flex",gap:5,alignItems:"center"}}>
                  {[
                    {label:"B",val:game.balls,  max:3,col:"#22C55E"},
                    {label:"S",val:game.strikes,max:2,col:"#F59E0B"},
                    {label:"O",val:game.outs,   max:2,col:"#EF4444"},
                  ].map(({label,val,max,col})=>(
                    <div key={label} style={{display:"flex",alignItems:"center",gap:3}}>
                      <span style={{fontSize:9,color:"rgba(255,255,255,0.3)",fontFamily:"var(--font-mono)",width:8}}>{label}</span>
                      {Array.from({length:max}).map((_,i)=>(
                        <div key={i} style={{width:8,height:8,borderRadius:"50%",background:i<val?col:"transparent",border:`1.5px solid ${i<val?col:"rgba(255,255,255,0.2)"}`,boxShadow:i<val?`0 0 5px ${col}99`:"none",transition:"all 0.12s"}}/>
                      ))}
                    </div>
                  ))}
                </div>

                {/* 打者 / 投手 */}
                <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:1}}>
                  <div style={{display:"flex",alignItems:"center",gap:4}}>
                    <span style={{fontSize:8,color:"var(--slate)",fontFamily:"var(--font-mono)"}}>🏏</span>
                    <span style={{fontSize:10,fontWeight:700,color:"var(--white)",fontFamily:"var(--font-body)"}}>{batIdx+1}番 {batName}</span>
                  </div>
                  {pitName && (
                    <div style={{display:"flex",alignItems:"center",gap:4}}>
                      <span style={{fontSize:8,color:"var(--slate)",fontFamily:"var(--font-mono)"}}>⚾</span>
                      <span style={{fontSize:9,color:"var(--slate-light)",fontFamily:"var(--font-body)"}}>{pitName}</span>
                    </div>
                  )}
                </div>
              </div>

            </div>
          );
        })()}

        {/* タブ */}
        <div style={{display:"flex",background:"var(--surface)",borderBottom:"1px solid var(--border)",flexShrink:0}}>
          {[["input","⚾ 投球入力"],["log",`📋 ログ (${total})`],["roster","👥 メンバー"]].map(([t,l])=>(
            <button key={t} onClick={()=>setTab(t)} style={{flex:1,padding:"5px 0",background:"none",border:"none",borderBottom:`2px solid ${tab===t?"var(--blue-light)":"transparent"}`,color:tab===t?"var(--blue-light)":"var(--slate-light)",fontFamily:"var(--font-body)",fontSize:12,fontWeight:600,cursor:"pointer",transition:"all 0.15s",letterSpacing:0.5}}>{l}</button>
          ))}
        </div>

        {/* ボディ */}
        <div className="app-body">
          {tab==="input" ? (
            <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",minHeight:0}}>
              <PitchFlickWheel selected={pitch.pitchType} onSelect={pt=>setPitch(p=>({...p,pitchType:pt}))} speed={pitch.speed} onSpeed={v=>setPitch(p=>({...p,speed:v}))}/>
              <ZoneGrid selected={pitch.zone} onSelect={z=>setPitch(p=>({...p,zone:z}))}/>
              <ResultFlickPad selected={pitch.result} onSelect={handleResult} hitType={pitch.hitType} reachType={pitch.reachType} onHitType={v=>setPitch(p=>({...p,hitType:v}))} onReachType={v=>setPitch(p=>({...p,reachType:v}))} onMapCommit={fields=>setPitch(p=>({...p,...fields}))} onFullCommit={fields=>setPitch(p=>({...p,...fields}))} pitch={pitch}/>
            </div>
          ) : tab==="log" ? (
            <LogScreen pitchHistory={game.pitchHistory} onExport={handleCSV}/>
          ) : (
            <RosterScreen game={game} dispatchGame={dispatchGame}/>
          )}
        </div>

        {/* ボトムバー */}
        <div style={{padding:"4px 12px 6px",background:"var(--surface)",borderTop:"1px solid var(--border)",flexShrink:0,display:"flex",gap:8,alignItems:"center"}}>
          {/* ◀ 一球戻る */}
          <button
            onClick={()=>{dispatchGame({type:"UNDO"});setPitch(INIT_PITCH);}}
            disabled={!game.history.length}
            title="一球戻る"
            style={{
              width:44,height:44,borderRadius:10,flexShrink:0,
              border:"1.5px solid var(--border2)",
              background:"var(--surface2)",
              color:"var(--slate-light)",
              fontSize:18, cursor:"pointer",
              display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:1,
              opacity:game.history.length?1:0.25,
              transition:"opacity 0.2s",
            }}
          >
            <span style={{fontSize:16,lineHeight:1}}>◀</span>
            <span style={{fontSize:7,fontFamily:"var(--font-mono)",letterSpacing:0.5,color:"var(--slate)"}}>UNDO</span>
          </button>
          {/* ▶ 一球進む */}
          <button
            onClick={()=>{dispatchGame({type:"REDO"});setPitch(INIT_PITCH);}}
            disabled={!game.redoStack?.length}
            title="一球進む"
            style={{
              width:44,height:44,borderRadius:10,flexShrink:0,
              border:"1.5px solid var(--border2)",
              background:"var(--surface2)",
              color:"var(--slate-light)",
              fontSize:18, cursor:"pointer",
              display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:1,
              opacity:game.redoStack?.length?1:0.25,
              transition:"opacity 0.2s",
            }}
          >
            <span style={{fontSize:16,lineHeight:1}}>▶</span>
            <span style={{fontSize:7,fontFamily:"var(--font-mono)",letterSpacing:0.5,color:"var(--slate)"}}>REDO</span>
          </button>

          {tab==="input" && (
            <button onClick={handleConfirm} disabled={!confirmable} style={{flex:1,height:44,borderRadius:10,border:"none",background:confirmable?"linear-gradient(135deg,var(--green) 0%,#15803d 100%)":"var(--surface3)",color:confirmable?"#fff":"var(--slate)",fontFamily:"var(--font-body)",fontSize:16,fontWeight:700,cursor:confirmable?"pointer":"default",boxShadow:confirmable?"var(--glow-green)":"none",transition:"all 0.2s",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
              {confirmable?"✓  確 定":"球種・コース・結果を選択"}
            </button>
          )}
          {tab==="log" && (<>
            <button onClick={handleCSV} disabled={!game.pitchHistory.length} style={{flex:1,height:44,borderRadius:10,border:"none",background:game.pitchHistory.length?"linear-gradient(135deg,#16A34A,#15803d)":"var(--surface3)",color:game.pitchHistory.length?"#fff":"var(--slate)",fontFamily:"var(--font-body)",fontSize:13,fontWeight:700,cursor:game.pitchHistory.length?"pointer":"default",display:"flex",alignItems:"center",justifyContent:"center",gap:6,boxShadow:game.pitchHistory.length?"0 0 16px rgba(22,163,74,0.35)":"none",transition:"all 0.2s"}}>📥 CSV保存</button>
            <button onClick={()=>{if(!game.pitchHistory.length||confirm("試合データをリセットしますか？")){dispatch(()=>({...INIT_GAME,lineup:{home:[...EMPTY_LINEUP.map(p=>({...p}))],away:[...EMPTY_LINEUP.map(p=>({...p}))]},batterIdx:{home:0,away:0},pitcher:{home:"",away:""}}));setPitch(INIT_PITCH);}}} style={{width:44,height:44,borderRadius:10,border:"1px solid var(--border2)",background:"var(--surface2)",color:"var(--slate-light)",fontFamily:"var(--font-body)",fontSize:11,fontWeight:600,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>🔄</button>
          </>)}

          <div style={{display:"flex",alignItems:"center",gap:4,fontFamily:"var(--font-mono)",fontSize:9,color:"var(--green-light)",flexShrink:0}}>
            <div style={{width:6,height:6,borderRadius:"50%",background:"var(--green-light)",animation:"pulse 2s infinite"}}/>
            <span>保存済み</span>
          </div>
        </div>

      </div>
    </>
  );
}

export default App;

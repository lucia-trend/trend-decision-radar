"use client";

import { useMemo, useState } from "react";

type Ticker = { tmId: number; tickerName: string; tickerSymbol?: string; asset?: string; asOfDate?: string };
type Snapshot = Ticker & Record<string, string | number | boolean | null | undefined>;

const FIELD_LABELS: Record<string, string> = {
  return1m: "近1月", return3m: "近3月", returnYTD: "今年以来",
  trendTemperatureCurr: "趋势温度", trendPhaseCurr: "趋势阶段",
  trendStrengthGlobalCurr: "全局强度", daysSinceTrendEntry: "右侧天数",
};

const DEFAULT_FIELDS = ["return1m", "return3m", "returnYTD", "trendTemperatureCurr", "trendPhaseCurr", "trendStrengthGlobalCurr", "daysSinceTrendEntry"];

function fmt(key: string, value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (key.startsWith("return") && typeof value === "number") return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
  if (typeof value === "boolean") return value ? "是" : "否";
  return String(value);
}

export default function Home() {
  const [keyword, setKeyword] = useState("AI ETF");
  const [results, setResults] = useState<Ticker[]>([]);
  const [selected, setSelected] = useState<Ticker[]>([]);
  const [rows, setRows] = useState<Snapshot[]>([]);
  const [status, setStatus] = useState<{ asOfDate?: string; updateDt?: string } | null>(null);
  const [cost, setCost] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("先搜索品种，建立你的观察池");

  async function api(body: object) {
    const res = await fetch("/api/trend", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "请求失败");
    return json;
  }

  async function search() {
    if (!keyword.trim()) return;
    setLoading(true); setMessage("正在定位品种…");
    try { const json = await api({ action: "search", keyword }); setResults(json.data || []); setMessage(`找到 ${json.data?.length || 0} 个匹配品种`); }
    catch (e) { setMessage(e instanceof Error ? e.message : "搜索失败"); }
    finally { setLoading(false); }
  }

  function toggle(t: Ticker) {
    setSelected((old) => old.some(x => x.tmId === t.tmId) ? old.filter(x => x.tmId !== t.tmId) : old.length < 20 ? [...old, t] : old);
  }

  async function inspect() {
    if (!selected.length) return;
    setLoading(true); setMessage("先核对数据日期与字段价格，再获取趋势快照…");
    try {
      const json = await api({ action: "inspect", tmIds: selected.map(x => x.tmId), fields: DEFAULT_FIELDS });
      setRows(json.data || []); setStatus(json.status || null); setCost(json.estimatedCost ?? null);
      setMessage(`已完成 ${json.data?.length || 0} 个品种的趋势巡检`);
    } catch (e) { setMessage(e instanceof Error ? e.message : "巡检失败"); }
    finally { setLoading(false); }
  }

  const sorted = useMemo(() => [...rows].sort((a,b) => Number(b.trendStrengthGlobalCurr || -1) - Number(a.trendStrengthGlobalCurr || -1)), [rows]);

  return <main>
    <header className="topbar"><div><span className="mark">趋</span><b>趋势决策台</b></div><span className="live"><i /> 趋势动物 API</span></header>
    <section className="hero">
      <p className="eyebrow">MOBILE INVESTMENT CONSOLE</p>
      <h1>把趋势事实，<br/><em>变成可复核的决策。</em></h1>
      <p className="sub">聚焦 AI 主题 ETF、组合成分与 BTC 美股代理。每次查询先核对日期与费用，再给判断。</p>
      <div className="date-card"><span>数据状态</span><strong>{status?.asOfDate || "等待首次巡检"}</strong><small>{status?.updateDt ? `更新于 ${status.updateDt}` : "将按目标资产匹配更新日期"}</small></div>
    </section>

    <section className="panel search-panel">
      <div className="section-title"><span>01</span><div><h2>建立观察池</h2><p>优先搜索获取 tmId · 单次最多 20 个</p></div></div>
      <div className="searchbox"><input value={keyword} onChange={e=>setKeyword(e.target.value)} onKeyDown={e=>e.key==="Enter"&&search()} placeholder="搜索 AI ETF、MSTR、科创 AI…"/><button onClick={search} disabled={loading}>搜索</button></div>
      <div className="quick">{["AI ETF","科创 AI","创业板 AI","MSTR","ABTC"].map(k=><button key={k} onClick={()=>setKeyword(k)}>{k}</button>)}</div>
      {!!results.length && <div className="results">{results.slice(0,10).map(t=><button className={selected.some(x=>x.tmId===t.tmId)?"picked":""} onClick={()=>toggle(t)} key={t.tmId}><span><b>{t.tickerName}</b><small>{t.tickerSymbol || t.asset || `tmId ${t.tmId}`}</small></span><i>{selected.some(x=>x.tmId===t.tmId)?"✓":"+"}</i></button>)}</div>}
      {!!selected.length && <div className="selection"><span>已选 {selected.length} 个</span><button onClick={()=>setSelected([])}>清空</button></div>}
      <button className="primary" disabled={!selected.length||loading} onClick={inspect}>{loading ? "正在处理…" : "开始趋势巡检"}</button>
      <p className="message">{message}</p>
    </section>

    {!!sorted.length && <section className="panel">
      <div className="section-title"><span>02</span><div><h2>趋势横截面</h2><p>按接口返回的全局强度降序</p></div></div>
      <div className="cards">{sorted.map((r, idx)=><article key={r.tmId}>
        <div className="rank">{String(idx+1).padStart(2,"0")}</div>
        <div className="asset-head"><div><h3>{r.tickerName}</h3><p>{r.tickerSymbol || r.asset} · {r.asOfDate}</p></div><span className="hot">{fmt("trendPhaseCurr",r.trendPhaseCurr)}</span></div>
        <div className="metrics">{DEFAULT_FIELDS.filter(k=>k!=="trendPhaseCurr").map(k=><div key={k}><small>{FIELD_LABELS[k]}</small><strong className={k.startsWith("return") && Number(r[k])<0?"neg":""}>{fmt(k,r[k])}</strong></div>)}</div>
      </article>)}</div>
      <div className="cost"><span>本轮预估快照费用</span><strong>{cost === null ? "—" : `¥${cost.toFixed(3)}`}</strong><small>最终扣费以账户账单为准；命中缓存可能不计费</small></div>
    </section>}

    <section className="panel method">
      <div className="section-title"><span>03</span><div><h2>判断边界</h2><p>把事实与策略严格分开</p></div></div>
      <div className="boundary"><div><b>接口事实</b><p>日期、收益、温度、趋势阶段与强度均原样来自趋势动物 API。</p></div><div><b>分析判断</b><p>页面只按全局强度排序。实时文档未提供独立的“趋势右侧”快照字段，因此页面不自行推断右侧状态。</p></div></div>
      <p className="btc-note"><b>BTC 说明</b> 当前巡检以 MSTR、ABTC 等美股代理作为风险温度辅助。BTC 现货本体需要另接专门行情源；本文档未提供该行情源。</p>
    </section>

    <footer>数据来源：趋势动物 API<br/>趋势动物的指标和分析结果仅供参考，不构成投资建议，交易盈亏需用户自行承担。</footer>
  </main>;
}

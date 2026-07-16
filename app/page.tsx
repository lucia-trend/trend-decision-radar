"use client";

import { useEffect, useMemo, useState } from "react";

type Ticker={tmId:number;tickerName:string;tickerSymbol?:string;asset?:string;assetCategory?:string;asOfDate?:string};
type Row=Ticker&Record<string,string|number|boolean|null|undefined>;
type SignalKey="大暑"|"小暑"|"温转热"|"开香槟"|"危险信号"|"沸"|"温转平"|"平转凉";
const SIGNALS:SignalKey[]=["大暑","小暑","温转热","开香槟","危险信号","沸","温转平","平转凉"];
const FIELDS=["return1m","return3m","returnYTD","trendTemperatureCurr","isTrendRightSide","trendStrengthGlobalCurr","trendPhaseCurr"];

function fmt(key:string,v:unknown){if(v===null||v===undefined||v==="")return"—";if(key.startsWith("return")&&typeof v==="number")return`${v>0?"+":""}${(v*100).toFixed(2)}%`;if(typeof v==="boolean")return v?"是":"否";return String(v)}
declare global{interface Window{__TREND_API_ENDPOINT__?:string}}
async function request(body:object){const endpoint=typeof window!=="undefined"&&window.__TREND_API_ENDPOINT__?window.__TREND_API_ENDPOINT__:"/api/trend";const res=await fetch(endpoint,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});const json=await res.json();if(!res.ok)throw new Error(json.error||"请求失败");return json}

export default function Home(){
 const [tab,setTab]=useState("总览");const [loading,setLoading]=useState("");const [note,setNote]=useState("点击同步，获取最新趋势事实");
 const [overview,setOverview]=useState<Row[]>([]);const [derived,setDerived]=useState<Record<string,{value:number|null;label:string;formula:string}>>({});const [keyword,setKeyword]=useState("AI ETF");const [results,setResults]=useState<Ticker[]>([]);
 const [watch,setWatch]=useState<Ticker[]>([]);const [watchRows,setWatchRows]=useState<Row[]>([]);const [signals,setSignals]=useState<Record<string,Ticker[]>>({});
 const [signal,setSignal]=useState<SignalKey>("大暑");const [etfs,setEtfs]=useState<Row[]>([]);const [componentTarget,setComponentTarget]=useState<Ticker|null>(null);const [components,setComponents]=useState<Row[]>([]);const [cost,setCost]=useState<number|null>(null);
 useEffect(()=>{try{const saved=localStorage.getItem("trend-watchlist-v2");if(saved)setWatch(JSON.parse(saved))}catch{}},[]);
 useEffect(()=>{localStorage.setItem("trend-watchlist-v2",JSON.stringify(watch))},[watch]);
 async function run(name:string,body:object,onDone:(j:any)=>void){setLoading(name);setNote("正在核对数据日期与费用…");try{const j=await request(body);onDone(j);if(j.estimatedCost!==undefined)setCost(j.estimatedCost);setNote(j.message||"数据已更新")}catch(e){setNote(e instanceof Error?e.message:"请求失败")}finally{setLoading("")}}
 function toggle(t:Ticker){setWatch(old=>old.some(x=>x.tmId===t.tmId)?old.filter(x=>x.tmId!==t.tmId):old.length<20?[...old,t]:old)}
 async function syncOverview(){run("overview",{action:"overview"},j=>{setOverview(j.data||[]);setDerived(j.derived||{})})}
 async function search(){run("search",{action:"search",keyword},j=>setResults(j.data||[]))}
 async function inspect(){run("watch",{action:"inspect",tmIds:watch.map(x=>x.tmId),fields:FIELDS},j=>setWatchRows(j.data||[]))}
 async function loadSignal(k:SignalKey){setSignal(k);run("signal",{action:"signal",signal:k,watchTmIds:watch.map(x=>x.tmId)},j=>setSignals(x=>({...x,[k]:j.data||[]})))}
 async function loadEtfs(){run("etf",{action:"etfRanking"},j=>setEtfs(j.data||[]))}
 async function previewComponents(full=false){if(!componentTarget)return;setLoading("component");try{const p=await request({action:"componentEstimate",ticker:componentTarget,full});const ok=!full||confirm(`预计成分接口费用约 ¥${Number(p.estimatedCost).toFixed(3)}，返回行数可能与估算不同。确认执行全量穿透？`);if(!ok){setLoading("");return}const j=await request({action:"components",ticker:componentTarget,full});setComponents(j.data||[]);setCost(j.estimatedCost);setNote(j.message)}catch(e){setNote(e instanceof Error?e.message:"请求失败")}finally{setLoading("")}}
 const overviewMap=Object.fromEntries(overview.map(x=>[x.asset,x]));const sorted=[...watchRows].sort((a,b)=>Number(b.trendStrengthGlobalCurr||-1)-Number(a.trendStrengthGlobalCurr||-1));
 return <main>
  <header className="topbar"><div><span className="mark">趋</span><b>趋势决策台</b></div><button className="sync" onClick={syncOverview} disabled={!!loading}>{loading==="overview"?"同步中":"同步"}</button></header>
  <section className="hero compact"><p className="eyebrow">MOBILE INVESTMENT CONSOLE</p><h1>今日趋势，<br/><em>先看事实再决策。</em></h1><p className="sub">市场状态、纪律信号、ETF 强度与固定观察池，一屏完成复核。</p><div className="statusline"><i/> {note}{cost!==null&&<b> · 预估 ¥{cost.toFixed(3)}</b>}</div></section>
  <nav className="tabs">{["总览","信号","ETF","观察池","拆解"].map(x=><button className={tab===x?"active":""} onClick={()=>setTab(x)} key={x}>{x}</button>)}</nav>

  {tab==="总览"&&<><section className="panel market"><div className="section-title"><span>01</span><div><h2>市场整体情况</h2><p>接口事实 · 各资产日期独立匹配</p></div></div>
   <div className="market-grid"><div className="market-main"><small>A股市场温度</small><strong>{fmt("trendTemperatureCurr",overviewMap["A股"]?.trendTemperatureCurr)}</strong><p>API 事实 · {overviewMap["A股"]?.asOfDate||"待同步"}</p></div>{["恐贪指数","高开指数","高走指数"].map(x=><div className="derived-card" key={x}><small>{x}<i>策略推导</i></small><strong>{derived[x]?.value??"—"}</strong><p>{derived[x]?.label||"同步后计算"}</p></div>)}</div>
   {!!Object.keys(derived).length&&<details className="formula"><summary>查看自建指标计算方法</summary>{Object.entries(derived).map(([k,v])=><div key={k}><b>{k}</b><p>{v.formula}</p></div>)}<p className="formula-foot">以上不是趋势动物官方指数，仅用于当前页面的统一观察尺度。</p></details>}
   {!!overview.length&&<div className="asset-strip">{overview.map(x=><div key={x.tmId}><span>{x.asset}</span><b>{fmt("trendTemperatureCurr",x.trendTemperatureCurr)}</b><small>强度 {fmt("trendStrengthGlobalCurr",x.trendStrengthGlobalCurr)}</small></div>)}</div>}
  </section><section className="panel"><div className="section-title"><span>02</span><div><h2>趋势交易观察框架</h2><p>先判断市场环境，再考虑交易动作</p></div></div><div className="summary-cards"><div><b>01 · 量价确认</b><p>市场无量拉升可能只是脆弱或虚假的趋势，缺少成交确认时应谨慎追加仓位。</p></div><div><b>02 · 主线内部健康度</b><p>若半导体等主线板块内部大量个股集中出现危险信号，板块趋势可能正在瓦解。</p></div><div><b>03 · 恐慌中的克制</b><p>长期下跌后突发集体恐慌杀跌，非理性情绪尚未释放完毕前，不宜仅因跌幅而盲目抄底。</p></div></div></section></>}

  {tab==="信号"&&<section className="panel"><div className="section-title"><span>01</span><div><h2>纪律信号清单</h2><p>点击标签才调取对应官方组合</p></div></div><div className="signal-group"><small>观察信号</small><div>{SIGNALS.slice(0,3).map(x=><button className={signal===x?"selected good":"good"} onClick={()=>loadSignal(x)} key={x}>{x}</button>)}</div></div><div className="signal-group"><small>卖出 / 风险复核</small><div>{SIGNALS.slice(3).map(x=><button className={signal===x?"selected risk":"risk"} onClick={()=>loadSignal(x)} key={x}>{x}</button>)}</div></div><List rows={signals[signal]||[]} empty={loading==="signal"?"正在加载清单…":`${signal} 暂无已加载结果`}/><p className="boundary-note">开香槟、危险信号与沸：官方搜索未提供独立组合，页面仅在你的固定观察池中按实时标志筛选。</p></section>}

  {tab==="ETF"&&<section className="panel"><div className="section-title"><span>01</span><div><h2>当日 ETF 强度排序</h2><p>来自“全市场趋势龙头(ETF基金)”组合</p></div></div><button className="primary" onClick={loadEtfs} disabled={!!loading}>{loading==="etf"?"计算中…":"获取今日排序"}</button><div className="rank-list">{etfs.map((x,i)=><article key={x.tmId}><span>{String(i+1).padStart(2,"0")}</span><div><b>{x.tickerName}</b><small>{x.tickerSymbol||x.asset} · {x.asOfDate}</small></div><strong>{fmt("trendStrengthGlobalCurr",x.trendStrengthGlobalCurr)}</strong></article>)}</div><p className="boundary-note">这是官方趋势龙头 ETF 组合的内部强度排序，不代表全部 ETF 基金全量排名。</p></section>}

  {tab==="观察池"&&<><section className="panel"><div className="section-title"><span>01</span><div><h2>固定观察池</h2><p>保存在当前设备 · 最多 20 个</p></div></div><div className="searchbox"><input value={keyword} onChange={e=>setKeyword(e.target.value)} onKeyDown={e=>e.key==="Enter"&&search()} placeholder="AI ETF、科创 AI、创业板 AI、MSTR…"/><button onClick={search}>搜索</button></div><div className="quick">{["AI ETF","科创 AI","创业板 AI","MSTR","ABTC"].map(k=><button onClick={()=>setKeyword(k)} key={k}>{k}</button>)}</div><div className="search-results">{results.slice(0,10).map(t=><button className={watch.some(x=>x.tmId===t.tmId)?"picked":""} onClick={()=>toggle(t)} key={t.tmId}><span><b>{t.tickerName}</b><small>{t.tickerSymbol||t.asset}</small></span><i>{watch.some(x=>x.tmId===t.tmId)?"✓":"+"}</i></button>)}</div><div className="watch-chips">{watch.map(x=><button onClick={()=>toggle(x)} key={x.tmId}>{x.tickerName} ×</button>)}</div><button className="primary" onClick={inspect} disabled={!watch.length||!!loading}>{loading==="watch"?"巡检中…":`巡检 ${watch.length} 个标的`}</button></section>
   {!!sorted.length&&<section className="panel"><div className="section-title"><span>02</span><div><h2>趋势横截面</h2><p>按全局强度降序</p></div></div><div className="cards">{sorted.map((r,i)=><article key={r.tmId}><div className="rank">{String(i+1).padStart(2,"0")}</div><div className="asset-head"><div><h3>{r.tickerName}</h3><p>{r.tickerSymbol||r.asset} · {r.asOfDate}</p></div><span className={r.isTrendRightSide?"hot":"cool"}>{r.isTrendRightSide?"右侧":"非右侧"}</span></div><div className="metrics">{[["近1月","return1m"],["近3月","return3m"],["今年以来","returnYTD"],["趋势温度","trendTemperatureCurr"],["趋势节气","trendPhaseCurr"],["全局强度","trendStrengthGlobalCurr"]].map(([l,k])=><div key={k}><small>{l}</small><strong>{fmt(k,r[k])}</strong></div>)}</div></article>)}</div></section>}
  </>}

  {tab==="拆解"&&<section className="panel"><div className="section-title"><span>01</span><div><h2>组合 / 榜单拆解</h2><p>先搜索定位，再估费执行</p></div></div><div className="searchbox"><input value={keyword} onChange={e=>setKeyword(e.target.value)} placeholder="搜索 AI 组合或 ETF"/><button onClick={search}>搜索</button></div><div className="target-list">{results.slice(0,8).map(x=><button className={componentTarget?.tmId===x.tmId?"active":""} onClick={()=>setComponentTarget(x)} key={x.tmId}><b>{x.tickerName}</b><small>{x.asset}</small></button>)}</div>{componentTarget&&<div className="component-actions"><p>已选：<b>{componentTarget.tickerName}</b></p><button onClick={()=>previewComponents(false)}>直接成分</button><button className="danger-outline" onClick={()=>previewComponents(true)}>全量穿透并估费</button></div>}<List rows={components} empty={loading==="component"?"正在拆解…":"选择对象后查看成分"}/></section>}

  <footer>数据来源：趋势动物 API<br/>趋势动物指标仅供趋势交易研究与纪律执行参考，不构成投资建议；交易盈亏需用户自行承担。</footer>
 </main>
}

function List({rows,empty}:{rows:Ticker[];empty:string}){return <div className="list">{rows.length?rows.map((x,i)=><div key={x.tmId}><span>{String(i+1).padStart(2,"0")}</span><div><b>{x.tickerName}</b><small>{x.tickerSymbol||x.asset} · {x.asOfDate||"—"}</small></div></div>):<p>{empty}</p>}</div>}

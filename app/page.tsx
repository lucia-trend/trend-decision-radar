"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Ticker = {
  tmId: number;
  tickerName: string;
  tickerSymbol?: string;
  asset?: string;
  assetCategory?: string;
  asOfDate?: string;
};

type Row = Ticker & Record<string, string | number | boolean | null | undefined>;
type SignalKey = "大暑" | "小暑" | "温转热" | "开香槟" | "危险信号" | "沸" | "温转平" | "平转凉";
type User = { id: string; username: string; displayName: string };
type CloudState = "local" | "loading" | "saving" | "saved" | "error";
type FrameworkCard = { title: string; fact: string; judgment: string; tone: "lime" | "red" | "blue" };
type DerivedMap = Record<string, { value: number | null; label: string; formula: string }>;
type ApiResponse = {
  data?: Row[];
  derived?: DerivedMap;
  estimatedCost?: number;
  message?: string;
  token?: string;
  user?: User;
  updatedAt?: number | null;
  error?: string;
};

const SIGNALS: SignalKey[] = ["大暑", "小暑", "温转热", "开香槟", "危险信号", "沸", "温转平", "平转凉"];
const FIELDS = [
  "return1m",
  "return3m",
  "returnYTD",
  "trendTemperatureCurr",
  "isTrendRightSide",
  "trendStrengthGlobalCurr",
  "trendPhaseCurr",
  "stopwinFlagByDangerSignal",
  "stopwinFlagByBoilingTemperature",
  "stopwinFlagByPopChampagne",
];
const WATCH_KEY = "trend-watchlist-v2";
const TOKEN_KEY = "trend-auth-token-v1";

function fmt(key: string, value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (key.startsWith("return") && typeof value === "number") return `${value > 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
  if (typeof value === "boolean") return value ? "是" : "否";
  return String(value);
}

function mergeWatchlists(local: Ticker[], remote: Ticker[]) {
  const merged = new Map<number, Ticker>();
  [...remote, ...local].forEach((item) => {
    if (item?.tmId && item.tickerName) merged.set(item.tmId, item);
  });
  return [...merged.values()].slice(0, 20);
}

declare global {
  interface Window {
    __TREND_API_ENDPOINT__?: string;
  }
}

async function request(body: object, tokenOverride?: string | null) {
  const endpoint = typeof window !== "undefined" && window.__TREND_API_ENDPOINT__ ? window.__TREND_API_ENDPOINT__ : "/api/trend";
  const headers: Record<string, string> = { "content-type": "application/json" };
  const token = tokenOverride === undefined && typeof window !== "undefined" ? localStorage.getItem(TOKEN_KEY) : tokenOverride;
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(body) });
  const json = await response.json() as ApiResponse;
  if (!response.ok) throw new Error(json.error || "请求失败");
  return json;
}

function buildFramework(watch: Ticker[], rows: Row[]): FrameworkCard[] {
  if (!watch.length) {
    return [
      { title: "先建立你的样本", fact: "观察池 0 个标的", judgment: "添加主线 ETF、核心个股或风险代理后，总览会把它们转换为三条个性化纪律提示。", tone: "lime" },
      { title: "保留市场基准", fact: "市场温度与自建指数", judgment: "先看整体风险环境，再把观察池强弱放回市场背景中判断，避免只盯单一标的。", tone: "red" },
      { title: "等待数据确认", fact: "尚未形成观察池截面", judgment: "没有样本时不做个性化推断；先添加标的，再点击总览同步。", tone: "blue" },
    ];
  }

  if (!rows.length) {
    return [
      { title: "观察池等待巡检", fact: `已存档 ${watch.length} 个标的`, judgment: "点击顶部“同步”，页面会同时巡检观察池并生成当日纪律摘要。", tone: "lime" },
      { title: "右侧状态待确认", fact: "尚无当日截面", judgment: "在 isTrendRightSide 返回前，不依据历史印象追加仓位。", tone: "red" },
      { title: "内部结构待确认", fact: "风险标志尚未读取", judgment: "危险信号、沸与开香槟需要以本轮接口事实为准。", tone: "blue" },
    ];
  }

  const total = rows.length;
  const rightSide = rows.filter((row) => row.isTrendRightSide === true).length;
  const riskRows = rows.filter((row) => row.stopwinFlagByDangerSignal === true || row.stopwinFlagByBoilingTemperature === true || row.stopwinFlagByPopChampagne === true);
  const strengths = rows.map((row) => Number(row.trendStrengthGlobalCurr)).filter(Number.isFinite);
  const averageStrength = strengths.length ? strengths.reduce((sum, value) => sum + value, 0) / strengths.length : null;
  const strongRows = rows.filter((row) => Number(row.trendStrengthGlobalCurr) >= 75 || ["热", "沸"].includes(String(row.trendTemperatureCurr))).length;
  const weakRows = rows.filter((row) => Number(row.trendStrengthGlobalCurr) < 45 || ["冻", "寒", "凉"].includes(String(row.trendTemperatureCurr))).length;
  const riskNames = riskRows.slice(0, 3).map((row) => row.tickerName).join("、");

  return [
    {
      title: "右侧参与度",
      fact: `${rightSide}/${total} 个标的处于趋势右侧`,
      judgment: rightSide === 0 ? "观察池尚无右侧确认，强度再高也更适合等待，而不是只凭排名追入。" : rightSide / total < 0.5 ? "右侧确认仍集中在少数标的，控制试错仓位并等待扩散。" : "右侧结构已有一定广度，可继续跟踪，但仍需结合温度和风险标志控制节奏。",
      tone: "lime",
    },
    {
      title: "内部风险密度",
      fact: riskRows.length ? `${riskRows.length}/${total} 个触发风险标志${riskNames ? `：${riskNames}` : ""}` : `${total} 个标的暂未触发三类风险标志`,
      judgment: riskRows.length / total >= 0.3 ? "风险信号已呈现集中化，主线内部健康度可能下降，应优先复核减仓纪律。" : riskRows.length ? "风险仍是局部现象，避免忽视已触发标的，同时观察是否继续扩散。" : "暂未出现集中风险，不等于可无条件加仓；继续等待价格与右侧状态确认。",
      tone: "red",
    },
    {
      title: "强弱结构",
      fact: `${strongRows} 个偏强 · ${weakRows} 个偏弱${averageStrength === null ? "" : ` · 平均强度 ${averageStrength.toFixed(1)}`}`,
      judgment: strongRows > 0 && rightSide === 0 ? "样本有强度但缺少右侧确认，属于值得观察但不宜只凭强度追入的状态。" : weakRows > strongRows ? "弱势样本占优，先降低主动进攻假设，等待强弱结构改善。" : "强势样本占优时仍要检查是否过热；市场无量拉升时谨慎追加仓位。",
      tone: "blue",
    },
  ];
}

export default function Home() {
  const [tab, setTab] = useState("总览");
  const [loading, setLoading] = useState("");
  const [note, setNote] = useState("点击同步，获取最新趋势事实");
  const [overview, setOverview] = useState<Row[]>([]);
  const [derived, setDerived] = useState<DerivedMap>({});
  const [keyword, setKeyword] = useState("AI ETF");
  const [results, setResults] = useState<Ticker[]>([]);
  const [watch, setWatch] = useState<Ticker[]>([]);
  const [watchRows, setWatchRows] = useState<Row[]>([]);
  const [signals, setSignals] = useState<Record<string, Ticker[]>>({});
  const [signal, setSignal] = useState<SignalKey>("大暑");
  const [etfs, setEtfs] = useState<Row[]>([]);
  const [componentTarget, setComponentTarget] = useState<Ticker | null>(null);
  const [components, setComponents] = useState<Row[]>([]);
  const [cost, setCost] = useState<number | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const [cloudState, setCloudState] = useState<CloudState>("loading");
  const [showAccount, setShowAccount] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authName, setAuthName] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authBusy, setAuthBusy] = useState(false);

  useEffect(() => {
    let active = true;
    const restore = async () => {
      let localWatch: Ticker[] = [];
      try {
        const saved = localStorage.getItem(WATCH_KEY);
        if (saved) localWatch = JSON.parse(saved);
      } catch {}
      if (active) setWatch(localWatch);
      const token = localStorage.getItem(TOKEN_KEY);
      if (!token) {
        if (active) {
          setCloudState("local");
          setStorageReady(true);
        }
        return;
      }
      try {
        const session = await request({ action: "authSession" }, token);
        const saved = await request({ action: "watchlistGet" }, token);
        const remoteWatch = Array.isArray(saved.data) ? saved.data : [];
        const merged = mergeWatchlists(localWatch, remoteWatch);
        if (!active) return;
        if (!session.user) throw new Error("账号信息缺失");
        setUser(session.user);
        setAuthToken(token);
        setWatch(merged);
        setCloudState("saved");
        if (JSON.stringify(merged) !== JSON.stringify(remoteWatch)) {
          await request({ action: "watchlistSave", items: merged }, token);
        }
      } catch {
        localStorage.removeItem(TOKEN_KEY);
        if (active) {
          setUser(null);
          setAuthToken(null);
          setCloudState("local");
        }
      } finally {
        if (active) setStorageReady(true);
      }
    };
    restore();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    localStorage.setItem(WATCH_KEY, JSON.stringify(watch));
    if (!user || !authToken) return;
    const timer = window.setTimeout(async () => {
      setCloudState("saving");
      try {
        await request({ action: "watchlistSave", items: watch }, authToken);
        setCloudState("saved");
      } catch {
        setCloudState("error");
      }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [watch, user, authToken, storageReady]);

  async function run(name: string, body: object, onDone: (json: ApiResponse) => void) {
    setLoading(name);
    setNote("正在核对数据日期与费用…");
    try {
      const json = await request(body);
      onDone(json);
      if (json.estimatedCost !== undefined) setCost(json.estimatedCost);
      setNote(json.message || "数据已更新");
    } catch (error) {
      setNote(error instanceof Error ? error.message : "请求失败");
    } finally {
      setLoading("");
    }
  }

  function toggle(ticker: Ticker) {
    if (user) setCloudState("saving");
    setWatch((current) => current.some((item) => item.tmId === ticker.tmId) ? current.filter((item) => item.tmId !== ticker.tmId) : current.length < 20 ? [...current, ticker] : current);
    setWatchRows((current) => current.filter((item) => item.tmId !== ticker.tmId));
  }

  async function syncOverview() {
    setLoading("overview");
    setNote(watch.length ? "正在同步市场与个性化观察池…" : "正在同步市场状态…");
    try {
      const [market, personal] = await Promise.all([
        request({ action: "overview" }),
        watch.length ? request({ action: "inspect", tmIds: watch.map((item) => item.tmId), fields: FIELDS }) : Promise.resolve(null),
      ]);
      setOverview(market.data || []);
      setDerived(market.derived || {});
      if (personal) setWatchRows(personal.data || []);
      const totalCost = Number(market.estimatedCost || 0) + Number(personal?.estimatedCost || 0);
      setCost(totalCost);
      setNote(personal ? `市场与 ${personal.data?.length || 0} 个观察标的已同步` : market.message || "市场状态已同步");
    } catch (error) {
      setNote(error instanceof Error ? error.message : "请求失败");
    } finally {
      setLoading("");
    }
  }

  async function search() {
    run("search", { action: "search", keyword }, (json) => setResults(json.data || []));
  }

  async function inspect() {
    run("watch", { action: "inspect", tmIds: watch.map((item) => item.tmId), fields: FIELDS }, (json) => setWatchRows(json.data || []));
  }

  async function loadSignal(key: SignalKey) {
    setSignal(key);
    run("signal", { action: "signal", signal: key, watchTmIds: watch.map((item) => item.tmId) }, (json) => setSignals((current) => ({ ...current, [key]: json.data || [] })));
  }

  async function loadEtfs() {
    run("etf", { action: "etfRanking" }, (json) => setEtfs(json.data || []));
  }

  async function previewComponents(full = false) {
    if (!componentTarget) return;
    setLoading("component");
    try {
      const preview = await request({ action: "componentEstimate", ticker: componentTarget, full });
      const confirmed = !full || confirm(`预计成分接口费用约 ¥${Number(preview.estimatedCost).toFixed(3)}，返回行数可能与估算不同。确认执行全量穿透？`);
      if (!confirmed) return;
      const json = await request({ action: "components", ticker: componentTarget, full });
      setComponents(json.data || []);
      if (json.estimatedCost !== undefined) setCost(json.estimatedCost);
      setNote(json.message || "成分已更新");
    } catch (error) {
      setNote(error instanceof Error ? error.message : "请求失败");
    } finally {
      setLoading("");
    }
  }

  async function submitAuth(event: FormEvent) {
    event.preventDefault();
    setAuthBusy(true);
    setAuthError("");
    try {
      const json = await request({ action: authMode === "login" ? "authLogin" : "authRegister", username: authName, password: authPassword }, null);
      const token = String(json.token);
      localStorage.setItem(TOKEN_KEY, token);
      setAuthToken(token);
      if (!json.user) throw new Error("账号信息缺失");
      setUser(json.user);
      const saved = await request({ action: "watchlistGet" }, token);
      const merged = mergeWatchlists(watch, Array.isArray(saved.data) ? saved.data : []);
      setWatch(merged);
      await request({ action: "watchlistSave", items: merged }, token);
      setCloudState("saved");
      setAuthPassword("");
      setShowAccount(false);
      setNote(json.message || "已连接云端观察池");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "登录失败");
    } finally {
      setAuthBusy(false);
    }
  }

  async function logout() {
    try {
      await request({ action: "authLogout" }, authToken);
    } catch {}
    localStorage.removeItem(TOKEN_KEY);
    setUser(null);
    setAuthToken(null);
    setCloudState("local");
    setShowAccount(false);
    setNote("已退出登录，本机观察池仍保留");
  }

  async function deleteAccount() {
    const password = prompt("请输入当前密码，确认删除账号与云端观察池：");
    if (!password || !confirm("删除后无法恢复云端账号和观察池，确定继续？")) return;
    setAuthBusy(true);
    setAuthError("");
    try {
      await request({ action: "authDelete", password }, authToken);
      localStorage.removeItem(TOKEN_KEY);
      setUser(null);
      setAuthToken(null);
      setCloudState("local");
      setShowAccount(false);
      setNote("账号与云端观察池已删除，本机观察池仍保留");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "删除失败");
    } finally {
      setAuthBusy(false);
    }
  }

  const overviewMap = Object.fromEntries(overview.map((item) => [item.asset, item]));
  const sorted = [...watchRows].sort((left, right) => Number(right.trendStrengthGlobalCurr || -1) - Number(left.trendStrengthGlobalCurr || -1));
  const framework = useMemo(() => buildFramework(watch, watchRows), [watch, watchRows]);
  const cloudLabel = cloudState === "saving" ? "云端保存中" : cloudState === "saved" ? "云端已存档" : cloudState === "error" ? "云端保存失败" : cloudState === "loading" ? "正在恢复账号" : "仅保存在本机";

  return <main>
    <header className="topbar">
      <div><span className="mark">趋</span><b>趋势决策台</b></div>
      <div className="top-actions">
        <button className={user ? "account signed" : "account"} onClick={() => setShowAccount(true)}>{user ? user.displayName : "登录 / 存档"}</button>
        <button className="sync" onClick={syncOverview} disabled={!!loading}>{loading === "overview" ? "同步中" : "同步"}</button>
      </div>
    </header>

    <section className="hero compact">
      <p className="eyebrow">MOBILE INVESTMENT CONSOLE</p>
      <h1>今日趋势，<br/><em>先看事实再决策。</em></h1>
      <p className="sub">市场状态、纪律信号、ETF 强度与固定观察池，一屏完成复核。</p>
      <div className="status-row">
        <div className="statusline"><i/> {note}{cost !== null && <b> · 预估 ¥{cost.toFixed(3)}</b>}</div>
        <button className="guide-link" onClick={() => setShowGuide(true)}>使用说明</button>
      </div>
    </section>

    <nav className="tabs">{["总览", "信号", "ETF", "观察池", "拆解"].map((item) => <button className={tab === item ? "active" : ""} onClick={() => setTab(item)} key={item}>{item}</button>)}</nav>

    {tab === "总览" && <>
      <section className="panel market">
        <div className="section-title"><span>01</span><div><h2>市场整体情况</h2><p>接口事实 · 各资产日期独立匹配</p></div></div>
        <div className="market-grid">
          <div className="market-main"><small>A股市场温度</small><strong>{fmt("trendTemperatureCurr", overviewMap.A股?.trendTemperatureCurr)}</strong><p>API 事实 · {overviewMap.A股?.asOfDate || "待同步"}</p></div>
          {["恐贪指数", "高开指数", "高走指数"].map((item) => <div className="derived-card" key={item}><small>{item}<i>策略推导</i></small><strong>{derived[item]?.value ?? "—"}</strong><p>{derived[item]?.label || "同步后计算"}</p></div>)}
        </div>
        {!!Object.keys(derived).length && <details className="formula"><summary>查看自建指标计算方法</summary>{Object.entries(derived).map(([key, value]) => <div key={key}><b>{key}</b><p>{value.formula}</p></div>)}<p className="formula-foot">以上不是趋势动物官方指数，仅用于当前页面的统一观察尺度。</p></details>}
        {!!overview.length && <div className="asset-strip">{overview.map((item) => <div key={item.tmId}><span>{item.asset}</span><b>{fmt("trendTemperatureCurr", item.trendTemperatureCurr)}</b><small>强度 {fmt("trendStrengthGlobalCurr", item.trendStrengthGlobalCurr)}</small></div>)}</div>}
      </section>
      <section className="panel">
        <div className="section-title"><span>02</span><div><h2>你的趋势交易观察框架</h2><p>{watchRows.length ? `基于 ${watchRows.length} 个观察标的的当日截面` : watch.length ? `已存档 ${watch.length} 个标的 · 同步后个性化` : "建立观察池后自动个性化"}</p></div></div>
        <div className="summary-cards personalized">{framework.map((item) => <div className={item.tone} key={item.title}><b>{item.title}</b><small>观察池事实 · {item.fact}</small><p>{item.judgment}</p></div>)}</div>
      </section>
    </>}

    {tab === "信号" && <section className="panel">
      <div className="section-title"><span>01</span><div><h2>纪律信号清单</h2><p>点击标签才调取对应官方组合</p></div></div>
      <div className="signal-group"><small>观察信号</small><div>{SIGNALS.slice(0, 3).map((item) => <button className={signal === item ? "selected good" : "good"} onClick={() => loadSignal(item)} key={item}>{item}</button>)}</div></div>
      <div className="signal-group"><small>卖出 / 风险复核</small><div>{SIGNALS.slice(3).map((item) => <button className={signal === item ? "selected risk" : "risk"} onClick={() => loadSignal(item)} key={item}>{item}</button>)}</div></div>
      <List rows={signals[signal] || []} empty={loading === "signal" ? "正在加载清单…" : `${signal} 暂无已加载结果`}/>
      <p className="boundary-note">开香槟、危险信号与沸：官方搜索未提供独立组合，页面仅在你的固定观察池中按实时标志筛选。</p>
    </section>}

    {tab === "ETF" && <section className="panel">
      <div className="section-title"><span>01</span><div><h2>当日 ETF 强度排序</h2><p>来自“全市场趋势龙头(ETF基金)”组合</p></div></div>
      <button className="primary" onClick={loadEtfs} disabled={!!loading}>{loading === "etf" ? "计算中…" : "获取今日排序"}</button>
      <div className="rank-list">{etfs.map((item, index) => <article key={item.tmId}><span>{String(index + 1).padStart(2, "0")}</span><div><b>{item.tickerName}</b><small>{item.tickerSymbol || item.asset} · {item.asOfDate}</small></div><strong>{fmt("trendStrengthGlobalCurr", item.trendStrengthGlobalCurr)}</strong></article>)}</div>
      <p className="boundary-note">这是官方趋势龙头 ETF 组合的内部强度排序，不代表全部 ETF 基金全量排名。</p>
    </section>}

    {tab === "观察池" && <>
      <section className="panel">
        <div className="section-title"><span>01</span><div><h2>固定观察池</h2><p>{user ? `${user.displayName} · ${cloudLabel}` : `${cloudLabel} · 登录可跨设备恢复`} · 最多 20 个</p></div></div>
        <div className="archive-banner"><span className={cloudState}><i/>{cloudLabel}</span>{!user && <button onClick={() => setShowAccount(true)}>登录开启云存档</button>}</div>
        <div className="searchbox"><input value={keyword} onChange={(event) => setKeyword(event.target.value)} onKeyDown={(event) => event.key === "Enter" && search()} placeholder="AI ETF、科创 AI、创业板 AI、MSTR…"/><button onClick={search}>搜索</button></div>
        <div className="quick">{["AI ETF", "科创 AI", "创业板 AI", "MSTR", "ABTC"].map((item) => <button onClick={() => setKeyword(item)} key={item}>{item}</button>)}</div>
        <div className="search-results">{results.slice(0, 10).map((item) => <button className={watch.some((saved) => saved.tmId === item.tmId) ? "picked" : ""} onClick={() => toggle(item)} key={item.tmId}><span><b>{item.tickerName}</b><small>{item.tickerSymbol || item.asset}</small></span><i>{watch.some((saved) => saved.tmId === item.tmId) ? "✓" : "+"}</i></button>)}</div>
        <div className="watch-chips">{watch.map((item) => <button onClick={() => toggle(item)} key={item.tmId}>{item.tickerName} ×</button>)}</div>
        <button className="primary" onClick={inspect} disabled={!watch.length || !!loading}>{loading === "watch" ? "巡检中…" : `巡检 ${watch.length} 个标的`}</button>
      </section>
      {!!sorted.length && <section className="panel">
        <div className="section-title"><span>02</span><div><h2>趋势横截面</h2><p>按全局强度降序</p></div></div>
        <div className="cards">{sorted.map((row, index) => <article key={row.tmId}><div className="rank">{String(index + 1).padStart(2, "0")}</div><div className="asset-head"><div><h3>{row.tickerName}</h3><p>{row.tickerSymbol || row.asset} · {row.asOfDate}</p></div><span className={row.isTrendRightSide ? "hot" : "cool"}>{row.isTrendRightSide ? "右侧" : "非右侧"}</span></div><div className="metrics">{[["近1月", "return1m"], ["近3月", "return3m"], ["今年以来", "returnYTD"], ["趋势温度", "trendTemperatureCurr"], ["趋势节气", "trendPhaseCurr"], ["全局强度", "trendStrengthGlobalCurr"]].map(([label, key]) => <div key={key}><small>{label}</small><strong>{fmt(key, row[key])}</strong></div>)}</div></article>)}</div>
      </section>}
    </>}

    {tab === "拆解" && <section className="panel">
      <div className="section-title"><span>01</span><div><h2>组合 / 榜单拆解</h2><p>先搜索定位，再估费执行</p></div></div>
      <div className="searchbox"><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索 AI 组合或 ETF"/><button onClick={search}>搜索</button></div>
      <div className="target-list">{results.slice(0, 8).map((item) => <button className={componentTarget?.tmId === item.tmId ? "active" : ""} onClick={() => setComponentTarget(item)} key={item.tmId}><b>{item.tickerName}</b><small>{item.asset}</small></button>)}</div>
      {componentTarget && <div className="component-actions"><p>已选：<b>{componentTarget.tickerName}</b></p><button onClick={() => previewComponents(false)}>直接成分</button><button className="danger-outline" onClick={() => previewComponents(true)}>全量穿透并估费</button></div>}
      <List rows={components} empty={loading === "component" ? "正在拆解…" : "选择对象后查看成分"}/>
    </section>}

    <footer>数据来源：趋势动物 API<br/>趋势动物指标仅供趋势交易研究与纪律执行参考，不构成投资建议；交易盈亏需用户自行承担。<button onClick={() => setShowGuide(true)}>查看使用说明</button></footer>

    {showAccount && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setShowAccount(false)}>
      <section className="modal" role="dialog" aria-modal="true" aria-label="账号与云端存档">
        <button className="modal-close" onClick={() => setShowAccount(false)} aria-label="关闭">×</button>
        {user ? <div className="account-panel"><span className="avatar">{user.displayName.slice(0, 1).toUpperCase()}</span><p className="eyebrow">CLOUD ARCHIVE</p><h2>{user.displayName}</h2><p>观察池已与账号关联。换设备登录同一账号，即可恢复最多 20 个固定观察标的。</p><div className="account-status"><span>{cloudLabel}</span><b>{watch.length} 个标的</b></div>{authError && <p className="auth-error">{authError}</p>}<button className="secondary wide" onClick={logout}>退出登录</button><button className="delete-account" onClick={deleteAccount} disabled={authBusy}>{authBusy ? "处理中…" : "删除账号与云端存档"}</button></div> : <>
          <p className="eyebrow">PRIVATE WATCHLIST</p><h2>{authMode === "login" ? "登录云端观察池" : "创建轻量账号"}</h2><p className="modal-intro">使用用户名和密码保存观察池。密码只保存不可逆摘要，不会写入前端或 GitHub。</p>
          <div className="auth-switch"><button className={authMode === "login" ? "active" : ""} onClick={() => { setAuthMode("login"); setAuthError(""); }}>登录</button><button className={authMode === "register" ? "active" : ""} onClick={() => { setAuthMode("register"); setAuthError(""); }}>注册</button></div>
          <form className="auth-form" onSubmit={submitAuth}><label>用户名<input autoComplete="username" value={authName} onChange={(event) => setAuthName(event.target.value)} placeholder="3–24 位中文、字母或数字"/></label><label>密码<input type="password" autoComplete={authMode === "login" ? "current-password" : "new-password"} value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} placeholder="至少 8 位"/></label>{authError && <p className="auth-error">{authError}</p>}<button className="primary" disabled={authBusy}>{authBusy ? "处理中…" : authMode === "login" ? "登录并恢复观察池" : "注册并开启云存档"}</button></form>
          <p className="privacy-note">当前为简单账号体系：暂不支持找回密码，请自行妥善保存。登录令牌有效期 30 天，可随时退出使本机令牌失效。</p>
        </>}
      </section>
    </div>}

    {showGuide && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setShowGuide(false)}>
      <section className="modal guide" role="dialog" aria-modal="true" aria-label="使用说明">
        <button className="modal-close" onClick={() => setShowGuide(false)} aria-label="关闭">×</button>
        <p className="eyebrow">QUICK START</p><h2>五步使用趋势决策台</h2>
        <ol className="guide-steps">
          <li><span>01</span><div><b>登录并建立观察池</b><p>不登录也能本机使用；登录后观察池会自动云端存档，并可在其他设备恢复。</p></div></li>
          <li><span>02</span><div><b>先搜索，再添加</b><p>在观察池搜索 AI ETF、科创 AI、创业板 AI、MSTR 等，点击“+”加入，最多 20 个。</p></div></li>
          <li><span>03</span><div><b>同步总览</b><p>点击顶部“同步”，页面会先确认数据状态，再读取市场与观察池截面，生成三条个性化纪律摘要。</p></div></li>
          <li><span>04</span><div><b>按需调取付费数据</b><p>信号、ETF 排序、巡检和组合拆解仅在点击时调用；全量穿透会先估费并再次确认。</p></div></li>
          <li><span>05</span><div><b>区分事实与判断</b><p>温度、强度、右侧和信号是接口事实；恐贪、高开、高走以及纪律摘要是本页面的策略推导。</p></div></li>
        </ol>
        <div className="guide-note"><b>使用边界</b><p>文档未提供的字段或缺失原因不会自行猜测。趋势动物指标和页面推导仅供研究参考，不构成投资建议。</p></div>
      </section>
    </div>}
  </main>;
}

function List({ rows, empty }: { rows: Ticker[]; empty: string }) {
  return <div className="list">{rows.length ? rows.map((item, index) => <div key={item.tmId}><span>{String(index + 1).padStart(2, "0")}</span><div><b>{item.tickerName}</b><small>{item.tickerSymbol || item.asset} · {item.asOfDate || "—"}</small></div></div>) : <p>{empty}</p>}</div>;
}

import { and, eq, gt, lt } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../db";
import { authLimits, sessions, users, watchlists } from "../../../db/schema";

const BASE = "https://www.trendtrader.cn/apiData/data";
const ALLOWED_ORIGIN = "https://lucia-trend.github.io";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const REGISTER_WINDOW_MS = 60 * 60 * 1000;
const PBKDF2_ITERATIONS = 120_000;
const encoder = new TextEncoder();

const CORS = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
  "Cache-Control": "no-store",
  Vary: "Origin",
};

const ALLOWED = new Set([
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
]);

const SIGNAL_TMIDS: Record<string, number> = {
  大暑: 624513,
  小暑: 624512,
  温转热: 624503,
  温转平: 624571,
  平转凉: 683734,
};

type Ticker = {
  tmId: number;
  tickerName: string;
  tickerSymbol?: string;
  asset?: string;
  assetCategory?: string;
  asOfDate?: string;
};

class HttpError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

function originAllowed(req: NextRequest) {
  return req.headers.get("origin") === ALLOWED_ORIGIN;
}

function bytesToBase64Url(bytes: Uint8Array) {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function derivePasswordHash(password: string, salt: Uint8Array) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const saltBuffer = Uint8Array.from(salt).buffer;
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: saltBuffer, iterations: PBKDF2_ITERATIONS },
    key,
    256,
  );
  return bytesToBase64Url(new Uint8Array(bits));
}

function constantTimeEqual(left: string, right: string) {
  const length = Math.max(left.length, right.length);
  let mismatch = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    mismatch |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return mismatch === 0;
}

function normalizeUsername(raw: unknown) {
  return String(raw || "").trim().toLocaleLowerCase("zh-CN");
}

function validateCredentials(rawUsername: unknown, rawPassword: unknown) {
  const displayName = String(rawUsername || "").trim();
  const username = normalizeUsername(displayName);
  const password = String(rawPassword || "");
  if (!/^[\p{L}\p{N}_.-]{3,24}$/u.test(displayName)) {
    throw new HttpError("用户名需为 3–24 位中文、字母、数字、点、横线或下划线");
  }
  if (password.length < 8 || password.length > 128) {
    throw new HttpError("密码长度需为 8–128 位");
  }
  return { displayName, username, password };
}

function requestIp(req: NextRequest) {
  return req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

async function rateLimitKey(prefix: string, req: NextRequest, username = "") {
  return `${prefix}:${await sha256Hex(`${requestIp(req)}|${username}`)}`;
}

async function consumeFixedWindow(key: string, limit: number, windowMs: number) {
  const db = getDb();
  const now = Date.now();
  const [record] = await db.select().from(authLimits).where(eq(authLimits.key, key)).limit(1);
  if (record?.blockedUntil && record.blockedUntil > now) {
    throw new HttpError("尝试次数过多，请稍后再试", 429);
  }
  const inWindow = record && now - record.windowStart < windowMs;
  const attempts = inWindow ? record.attempts + 1 : 1;
  const windowStart = inWindow ? record.windowStart : now;
  const blockedUntil = attempts > limit ? windowStart + windowMs : 0;
  await db
    .insert(authLimits)
    .values({ key, attempts, windowStart, blockedUntil })
    .onConflictDoUpdate({ target: authLimits.key, set: { attempts, windowStart, blockedUntil } });
  if (blockedUntil > now) throw new HttpError("尝试次数过多，请稍后再试", 429);
}

async function clearLimit(key: string) {
  await getDb().delete(authLimits).where(eq(authLimits.key, key));
}

async function createSession(userId: string) {
  const token = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = await sha256Hex(token);
  const now = Date.now();
  const db = getDb();
  await db.delete(sessions).where(and(eq(sessions.userId, userId), lt(sessions.expiresAt, now)));
  await db.insert(sessions).values({ tokenHash, userId, createdAt: now, expiresAt: now + SESSION_TTL_MS });
  return token;
}

function bearerToken(req: NextRequest) {
  const header = req.headers.get("authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

async function requireUser(req: NextRequest) {
  const token = bearerToken(req);
  if (!token) throw new HttpError("请先登录", 401);
  const tokenHash = await sha256Hex(token);
  const now = Date.now();
  const [row] = await getDb()
    .select({
      tokenHash: sessions.tokenHash,
      userId: users.id,
      username: users.username,
      displayName: users.displayName,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, now)))
    .limit(1);
  if (!row) throw new HttpError("登录已过期，请重新登录", 401);
  return row;
}

function sanitizeWatchlist(value: unknown) {
  if (!Array.isArray(value)) throw new HttpError("观察池格式不正确");
  const unique = new Map<number, Ticker>();
  for (const raw of value.slice(0, 20)) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const tmId = Number(item.tmId);
    const tickerName = String(item.tickerName || "").trim().slice(0, 80);
    if (!Number.isFinite(tmId) || tmId <= 0 || !tickerName) continue;
    unique.set(tmId, {
      tmId,
      tickerName,
      tickerSymbol: String(item.tickerSymbol || "").slice(0, 40) || undefined,
      asset: String(item.asset || "").slice(0, 40) || undefined,
      assetCategory: String(item.assetCategory || "").slice(0, 40) || undefined,
      asOfDate: String(item.asOfDate || "").slice(0, 20) || undefined,
    });
  }
  return [...unique.values()];
}

async function call(name: string, params: Record<string, string> = {}) {
  const key = process.env.TRENDTRADER_API_KEY;
  if (!key) throw new Error("服务端尚未配置趋势动物 API Key");
  const url = new URL(`${BASE}/${name}`);
  url.searchParams.set("apiKey", key);
  Object.entries(params).forEach(([param, value]) => url.searchParams.set(param, value));
  const res = await fetch(url, { cache: "no-store" });
  const json = await res.json();
  if (!res.ok || json.code !== "00000" || json.success === false) throw new Error(json.msg || `${name} 调用失败`);
  return json;
}

async function billing(fields: string[], rows: number) {
  const response = await call("getSnapshotColumnBilling");
  const prices = new Map<string, number>(
    (response.data || []).map((item: { columnName: string; priceCost: number }) => [item.columnName, Number(item.priceCost) || 0]),
  );
  return fields.reduce((sum, field) => sum + (prices.get(field) || 0), 0) * rows;
}

async function snapshot(tmIds: number[], fields: string[]) {
  const estimatedCost = await billing(fields, tmIds.length);
  if (estimatedCost >= 1) throw new Error(`本轮预估快照费用 ¥${estimatedCost.toFixed(3)}，达到 1 元，已停止`);
  const response = await call("getTickerSnapshot", { tmIds: tmIds.join(","), fields: fields.join(",") });
  return { data: response.data || [], estimatedCost };
}

async function handleAuth(req: NextRequest, body: Record<string, unknown>) {
  const db = getDb();

  if (body.action === "authRegister") {
    const { username, displayName, password } = validateCredentials(body.username, body.password);
    await consumeFixedWindow(await rateLimitKey("register", req), 3, REGISTER_WINDOW_MS);
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.username, username)).limit(1);
    if (existing) throw new HttpError("用户名已被使用", 409);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const userId = crypto.randomUUID();
    await db.insert(users).values({
      id: userId,
      username,
      displayName,
      passwordSalt: bytesToBase64Url(salt),
      passwordHash: await derivePasswordHash(password, salt),
      createdAt: Date.now(),
    });
    const token = await createSession(userId);
    return NextResponse.json({ user: { id: userId, username, displayName }, token, message: "账号已创建，观察池将自动同步" });
  }

  if (body.action === "authLogin") {
    const { username, password } = validateCredentials(body.username, body.password);
    const limitKey = await rateLimitKey("login", req, username);
    const [account] = await db.select().from(users).where(eq(users.username, username)).limit(1);
    const fallbackSalt = new Uint8Array(16);
    const candidateHash = await derivePasswordHash(password, account ? base64UrlToBytes(account.passwordSalt) : fallbackSalt);
    if (!account || !constantTimeEqual(candidateHash, account.passwordHash)) {
      await consumeFixedWindow(limitKey, 5, LOGIN_WINDOW_MS);
      throw new HttpError("用户名或密码不正确", 401);
    }
    await clearLimit(limitKey);
    const token = await createSession(account.id);
    return NextResponse.json({
      user: { id: account.id, username: account.username, displayName: account.displayName },
      token,
      message: "已登录并连接云端观察池",
    });
  }

  if (body.action === "authSession") {
    const account = await requireUser(req);
    return NextResponse.json({
      user: { id: account.userId, username: account.username, displayName: account.displayName },
      message: "登录状态有效",
    });
  }

  if (body.action === "authLogout") {
    const token = bearerToken(req);
    if (token) await db.delete(sessions).where(eq(sessions.tokenHash, await sha256Hex(token)));
    return NextResponse.json({ message: "已退出登录，本机观察池仍保留" });
  }

  if (body.action === "authDelete") {
    const session = await requireUser(req);
    const password = String(body.password || "");
    const [account] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
    if (!account || !password) throw new HttpError("请输入密码确认删除账号", 400);
    const candidateHash = await derivePasswordHash(password, base64UrlToBytes(account.passwordSalt));
    if (!constantTimeEqual(candidateHash, account.passwordHash)) throw new HttpError("密码不正确", 401);
    await db.delete(users).where(eq(users.id, account.id));
    return NextResponse.json({ message: "账号及云端观察池已删除" });
  }

  if (body.action === "watchlistGet") {
    const account = await requireUser(req);
    const [saved] = await db.select().from(watchlists).where(eq(watchlists.userId, account.userId)).limit(1);
    return NextResponse.json({
      data: saved ? sanitizeWatchlist(JSON.parse(saved.itemsJson)) : [],
      updatedAt: saved?.updatedAt || null,
      message: saved ? "云端观察池已载入" : "云端观察池尚为空",
    });
  }

  if (body.action === "watchlistSave") {
    const account = await requireUser(req);
    const items = sanitizeWatchlist(body.items);
    const updatedAt = Date.now();
    await db
      .insert(watchlists)
      .values({ userId: account.userId, itemsJson: JSON.stringify(items), updatedAt })
      .onConflictDoUpdate({ target: watchlists.userId, set: { itemsJson: JSON.stringify(items), updatedAt } });
    return NextResponse.json({ data: items, updatedAt, message: `已云端保存 ${items.length} 个观察标的` });
  }

  return null;
}

async function handle(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const authResponse = await handleAuth(req, body);
    if (authResponse) return authResponse;

    if (body.action === "search") {
      const keyword = String(body.keyword || "").trim().slice(0, 40);
      if (!keyword) throw new HttpError("请输入关键词");
      const response = await call("searchTicker", { keyword });
      return NextResponse.json({ data: response.data, message: `找到 ${response.data?.length || 0} 个匹配品种` });
    }

    if (body.action === "overview") {
      await call("getUpdateStatus");
      const ids = [303121, 377042, 332171, 327801];
      const fields = ["trendTemperatureCurr", "trendStrengthGlobalCurr", "isTrendRightSide", "return1d", "return1m", "Op", "Hi", "Lo", "Cl"];
      const result = await snapshot(ids, fields);
      const market = result.data.find((item: Record<string, unknown>) => item.asset === "A股") || {};
      const clamp = (value: number) => Math.max(0, Math.min(100, value));
      const temperatureScore: Record<string, number> = { 冻: 5, 寒: 18, 凉: 32, 平: 48, 温: 62, 热: 80, 沸: 95 };
      const strength = Number(market.trendStrengthGlobalCurr || 50);
      const return1m = Number(market.return1m || 0);
      const fearGreed = Math.round(clamp((temperatureScore[String(market.trendTemperatureCurr)] ?? 50) * 0.4 + strength * 0.4 + clamp(50 + return1m * 500) * 0.2));
      const open = Number(market.Op);
      const high = Number(market.Hi);
      const low = Number(market.Lo);
      const close = Number(market.Cl);
      const return1d = Number(market.return1d);
      const previousClose = close && Number.isFinite(return1d) ? close / (1 + return1d) : 0;
      const gap = previousClose ? open / previousClose - 1 : Number.NaN;
      const highOpen = Number.isFinite(gap) ? Math.round(clamp(50 + gap * 1000)) : null;
      const range = high - low;
      const walk = open && range > 0 ? (close - open) / range : Number.NaN;
      const highWalk = Number.isFinite(walk) ? Math.round(clamp(50 + walk * 50)) : null;
      const zone = (value: number | null) => value === null ? "数据不足" : value >= 75 ? "偏强" : value >= 55 ? "中性偏强" : value >= 45 ? "中性" : value >= 25 ? "中性偏弱" : "偏弱";
      const derived = {
        恐贪指数: { value: fearGreed, label: zone(fearGreed), formula: "40% 趋势温度映射 + 40% 全局趋势相对强度 + 20% 近1月回报动量（回报按 ±10% 映射到 0–100），结果截断在 0–100。样本为 A股资产大类。" },
        高开指数: { value: highOpen, label: zone(highOpen), formula: "先用 收盘价 ÷ (1 + 日回报) 反推前收，再计算开盘跳空率；0% 对应 50 分，每 +1% 增加 10 分，截断在 0–100。样本为 A股资产大类。" },
        高走指数: { value: highWalk, label: zone(highWalk), formula: "50 + 50 × (收盘价 − 开盘价) ÷ (最高价 − 最低价)，截断在 0–100；衡量收盘相对开盘及日内区间的位置。样本为 A股资产大类。" },
      };
      return NextResponse.json({ ...result, data: result.data, derived, message: "市场状态已同步；三项自建指数均为策略推导，不是 API 直接字段" });
    }

    if (body.action === "inspect") {
      const ids = Array.isArray(body.tmIds) ? body.tmIds.map(Number).filter(Number.isFinite).slice(0, 20) : [];
      if (!ids.length) throw new HttpError("观察池为空");
      const fields = (Array.isArray(body.fields) ? body.fields : []).map(String).filter((field) => ALLOWED.has(field));
      const result = await snapshot(ids, fields);
      return NextResponse.json({ ...result, message: `已巡检 ${result.data.length} 个固定观察标的` });
    }

    if (body.action === "signal") {
      const signal = String(body.signal);
      if (SIGNAL_TMIDS[signal]) {
        await call("getUpdateStatus");
        const response = await call("getComponentTicker", { tmId: String(SIGNAL_TMIDS[signal]) });
        return NextResponse.json({ data: response.data || [], estimatedCost: 0.1 + (response.data?.length || 0) * 0.005, message: `已加载 ${signal} 官方组合` });
      }
      const flag: Record<string, string> = { 开香槟: "stopwinFlagByPopChampagne", 危险信号: "stopwinFlagByDangerSignal", 沸: "stopwinFlagByBoilingTemperature" };
      const ids = Array.isArray(body.watchTmIds) ? body.watchTmIds.map(Number).filter(Number.isFinite).slice(0, 20) : [];
      if (!ids.length) return NextResponse.json({ data: [], message: "该信号需先建立固定观察池" });
      const result = await snapshot(ids, [flag[signal]]);
      return NextResponse.json({ ...result, data: result.data.filter((item: Record<string, unknown>) => item[flag[signal]] === true), message: `已在固定观察池筛选 ${signal}` });
    }

    if (body.action === "etfRanking") {
      await call("getUpdateStatus");
      const components = await call("getComponentTicker", { tmId: "704614" });
      const ids = (components.data || []).map((item: { tmId: number }) => item.tmId).slice(0, 100);
      const result = await snapshot(ids, ["trendStrengthGlobalCurr", "trendTemperatureCurr", "isTrendRightSide", "return1d"]);
      result.data.sort((left: Record<string, unknown>, right: Record<string, unknown>) => Number(right.trendStrengthGlobalCurr || -1) - Number(left.trendStrengthGlobalCurr || -1));
      return NextResponse.json({ ...result, estimatedCost: result.estimatedCost + 0.1 + (components.data?.length || 0) * 0.005, message: `已排序 ${result.data.length} 只趋势龙头 ETF` });
    }

    if (body.action === "componentEstimate") {
      const ticker = (body.ticker || {}) as Record<string, unknown>;
      const result = await snapshot([Number(ticker.tmId)], ["constituentCount"]);
      const count = Number(result.data[0]?.constituentCount || 0);
      const perRow = ticker.assetCategory === "资产组合" ? 0.005 : 0.0002;
      return NextResponse.json({ estimatedCost: 0.1 + count * perRow, count, message: count ? "基于 constituentCount 估算" : "文档未提供可用成分数，实际行数不确定" });
    }

    if (body.action === "components") {
      const ticker = (body.ticker || {}) as Record<string, unknown>;
      await call("getUpdateStatus");
      const response = await call("getComponentTicker", { tmId: String(ticker.tmId), ...(body.full ? { getAllBasicComponentsFlag: "1" } : {}) });
      const rows = response.data || [];
      const perRow = ticker.assetCategory === "资产组合" ? 0.005 : 0.0002;
      const ids = rows.map((item: { tmId: number }) => item.tmId).slice(0, 100);
      let data = rows;
      if (ids.length) {
        const result = await snapshot(ids, ["trendStrengthGlobalCurr", "trendTemperatureCurr", "isTrendRightSide"]);
        const statuses = new Map(result.data.map((item: { tmId: number }) => [item.tmId, item]));
        data = rows
          .map((item: Record<string, unknown>) => ({ ...item, ...(statuses.get(item.tmId as number) || {}) }))
          .sort((left: Record<string, unknown>, right: Record<string, unknown>) => Number(right.trendStrengthGlobalCurr || -1) - Number(left.trendStrengthGlobalCurr || -1));
      }
      return NextResponse.json({ data, estimatedCost: 0.1 + rows.length * perRow, message: `返回 ${rows.length} 个成分；前 ${ids.length} 个已补充趋势状态` });
    }

    return NextResponse.json({ error: "不支持的操作" }, { status: 400 });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "服务异常" }, { status });
  }
}

export async function OPTIONS(req: NextRequest) {
  return originAllowed(req) ? new NextResponse(null, { status: 204, headers: CORS }) : new NextResponse(null, { status: 403 });
}

export async function POST(req: NextRequest) {
  if (!originAllowed(req)) return NextResponse.json({ error: "来源未授权" }, { status: 403 });
  if (!req.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return NextResponse.json({ error: "仅接受 JSON 请求" }, { status: 415, headers: CORS });
  }
  const contentLength = Number(req.headers.get("content-length") || 0);
  if (contentLength > 8192) return NextResponse.json({ error: "请求体过大" }, { status: 413, headers: CORS });
  const response = await handle(req);
  Object.entries(CORS).forEach(([key, value]) => response.headers.set(key, value));
  return response;
}

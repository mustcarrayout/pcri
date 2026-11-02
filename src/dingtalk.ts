// 钉钉日历同步：企业内部应用凭证直连（只读拉取日程）
// 凭证走 Android Keystore 安全存储（浏览器预览仅内存，不落盘）；
// 真机用 Capacitor 原生网络栈直连钉钉 API，浏览器开发走 vite 代理。
import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { SecureStoragePlugin } from "capacitor-secure-storage-plugin";

export interface DingTalkConfig {
  clientId: string;
  clientSecret: string;
  /** 注册钉钉的手机号，用于定位"我自己"的账号 */
  mobile: string;
}
/** 同步用的最小事件字段：外部 ID + 钉钉侧可变字段 */
export interface DingTalkEventDraft {
  externalId: string;
  title: string;
  /** 本地日期 YYYY-MM-DD */
  date: string;
  /** 本地时间 HH:MM，全天日程为 00:00 */
  time: string;
}
// 钉钉接口返回结构宽松，这里统一收窄为 Record<string, any> 后逐字段取值
type DingJson = Record<string, any>;

const storageKey = "shixu-dingtalk-config-v1";
const syncStampKey = "shixu-dingtalk-sync-v1";
const OPENAPI_HOST = "https://api.dingtalk.com";
const OAPI_HOST = "https://oapi.dingtalk.com";
// 浏览器预览经 vite dev 代理转发（见 vite.config.js），避免 CORS
const OPENAPI_PROXY = "/dingtalk-openapi";
const OAPI_PROXY = "/dingtalk-oapi";

// ── 凭证存取（同 AI Key 模式：真机 Keystore，浏览器仅内存） ──
export async function loadDingTalkConfig(): Promise<DingTalkConfig | null> {
  if (!Capacitor.isNativePlatform()) return null; // 浏览器预览不落盘
  try {
    const { value } = await SecureStoragePlugin.get({ key: storageKey });
    const parsed = JSON.parse(value) as DingTalkConfig;
    if (parsed?.clientId && parsed?.clientSecret && parsed?.mobile)
      return parsed;
  } catch {
    /* 尚未配置过 */
  }
  return null;
}
export async function persistDingTalkConfig(config: DingTalkConfig) {
  if (!Capacitor.isNativePlatform()) return; // 真机才写入 Android Keystore
  await SecureStoragePlugin.set({
    key: storageKey,
    value: JSON.stringify(config),
  });
}
export async function clearDingTalkConfig() {
  if (Capacitor.isNativePlatform()) {
    try {
      await SecureStoragePlugin.remove({ key: storageKey });
    } catch {
      /* 本地状态仍会清除 */
    }
  }
  tokenCache = null;
}

// ── 同步时间戳（非敏感，本地 localStorage 即可） ──
export function loadDingTalkSyncStamp(): string {
  try {
    return localStorage.getItem(syncStampKey) || "";
  } catch {
    return "";
  }
}
export function saveDingTalkSyncStamp(at = new Date()): string {
  const stamp = `${dateKey(at)} ${at.toTimeString().slice(0, 5)}`;
  try {
    localStorage.setItem(syncStampKey, stamp);
  } catch {
    /* 浏览器禁用时只留在本次会话 */
  }
  return stamp;
}

// ── 传输层（真机 CapacitorHttp 不受 CORS 限制；浏览器走代理） ──
function openApiUrl(path: string, query?: Record<string, string>): string {
  const base = Capacitor.isNativePlatform() ? OPENAPI_HOST : OPENAPI_PROXY;
  const search = query ? `?${new URLSearchParams(query).toString()}` : "";
  return `${base}${path}${search}`;
}
function oApiUrl(path: string, accessToken: string): string {
  const base = Capacitor.isNativePlatform() ? OAPI_HOST : OAPI_PROXY;
  return `${base}${path}?access_token=${encodeURIComponent(accessToken)}`;
}
async function httpPostJson(
  url: string,
  body: DingJson,
  headers: Record<string, string> = {},
): Promise<DingJson> {
  if (Capacitor.isNativePlatform()) {
    const response = await CapacitorHttp.post({
      url,
      headers: { "Content-Type": "application/json", ...headers },
      data: body,
      connectTimeout: 15000,
      readTimeout: 30000,
    });
    return (response.data || {}) as DingJson;
  }
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return (await response.json().catch(() => ({}))) as DingJson;
}
async function httpGetJson(
  url: string,
  headers: Record<string, string> = {},
): Promise<DingJson> {
  if (Capacitor.isNativePlatform()) {
    const response = await CapacitorHttp.get({
      url,
      headers,
      connectTimeout: 15000,
      readTimeout: 30000,
    });
    return (response.data || {}) as DingJson;
  }
  const response = await fetch(url, { headers });
  return (await response.json().catch(() => ({}))) as DingJson;
}
function assertOpenApiOk(data: DingJson, what: string) {
  if (data.code || data.message)
    throw new Error(`${what}失败：${data.message || data.code}`);
}
function assertOApiOk(data: DingJson, what: string) {
  if (Number(data.errcode || 0) !== 0)
    throw new Error(`${what}失败：${data.errmsg || data.errcode}`);
}

// ── 企业凭证（内存缓存，提前 5 分钟过期） ──
let tokenCache: { token: string; expireAt: number } | null = null;
async function getAccessToken(config: DingTalkConfig): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expireAt) return tokenCache.token;
  const data = await httpPostJson(openApiUrl("/v1.0/oauth2/accessToken"), {
    appKey: config.clientId,
    appSecret: config.clientSecret,
  });
  assertOpenApiOk(data, "获取钉钉应用凭证");
  const token = String(data.accessToken || "");
  if (!token) throw new Error("钉钉未返回应用凭证，请检查 Client ID/Secret。");
  const expireIn = Number(data.expireIn || 7200);
  tokenCache = {
    token,
    expireAt: Date.now() + Math.max(60, expireIn - 300) * 1000,
  };
  return token;
}

// ── 身份：手机号 → userid → unionId ──
async function resolveUnionId(
  config: DingTalkConfig,
  accessToken: string,
): Promise<string> {
  const byMobile = await httpPostJson(
    oApiUrl("/topapi/v2/user/getbymobile", accessToken),
    { mobile: config.mobile },
  );
  assertOApiOk(byMobile, "通过手机号查找钉钉账号");
  const userid = String(byMobile.result?.userid || "");
  if (!userid)
    throw new Error("没有找到该手机号对应的钉钉账号，请检查应用可见范围。");
  const detail = await httpPostJson(oApiUrl("/topapi/v2/user/get", accessToken), {
    userid,
  });
  assertOApiOk(detail, "查询钉钉账号信息");
  const unionid = String(detail.result?.unionid || "");
  if (!unionid) throw new Error("未取到钉钉 unionId。");
  return unionid;
}

// ── 日历：默认日历 → 时间窗内日程（游标翻页） ──
async function primaryCalendarId(
  unionId: string,
  accessToken: string,
): Promise<string> {
  const data = await httpGetJson(
    openApiUrl(`/v1.0/calendar/users/${encodeURIComponent(unionId)}/calendars`),
    { "x-acs-dingtalk-access-token": accessToken },
  );
  assertOpenApiOk(data, "查询钉钉日历");
  const calendars = Array.isArray(data.calendars) ? data.calendars : [];
  const primary =
    calendars.find(
      (item: DingJson) =>
        item.type === "primary" ||
        item.isPrimary === true ||
        item.isDefault === true,
    ) || calendars[0];
  const calendarId = String(primary?.calendarId || "");
  if (!calendarId)
    throw new Error("没有可读取的钉钉日历，请确认已开通日历权限。");
  return calendarId;
}
function toIsoLocal(at: Date): string {
  const offsetMinutes = -at.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  const zone = `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
  return `${new Date(at.getTime() - at.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 19)}${zone}`;
}
function splitStart(value: string): { date: string; time: string } {
  const normalized = value.replace("T", " ").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return { date: normalized, time: "00:00" };
  const [date = "", time = ""] = normalized.split(" ");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { date: "", time: "00:00" };
  return { date, time: time.slice(0, 5) || "00:00" };
}
function toDraft(event: DingJson): DingTalkEventDraft | null {
  const externalId = String(event.id || "");
  if (!externalId) return null;
  const rawStart = String(event.start?.date || event.start?.dateTime || "");
  const { date, time } = splitStart(rawStart);
  if (!date) return null;
  const title = String(event.title || "").trim() || "（无标题日程）";
  return { externalId, title, date, time };
}
export async function fetchDingTalkEvents(
  config: DingTalkConfig,
  from: Date,
  to: Date,
): Promise<DingTalkEventDraft[]> {
  const accessToken = await getAccessToken(config);
  const unionId = await resolveUnionId(config, accessToken);
  const calendarId = await primaryCalendarId(unionId, accessToken);
  const drafts: DingTalkEventDraft[] = [];
  let cursor: string | undefined;
  do {
    const query: Record<string, string> = {
      timeMin: toIsoLocal(from),
      timeMax: toIsoLocal(to),
      maxResults: "50",
    };
    if (cursor) query.nextCursor = cursor;
    const data = await httpGetJson(
      openApiUrl(
        `/v1.0/calendar/users/${encodeURIComponent(unionId)}/calendars/${encodeURIComponent(calendarId)}/events/query`,
        query,
      ),
      { "x-acs-dingtalk-access-token": accessToken },
    );
    assertOpenApiOk(data, "拉取钉钉日程");
    for (const event of Array.isArray(data.events) ? data.events : []) {
      const draft = toDraft(event);
      if (draft) drafts.push(draft);
    }
    cursor = data.nextCursor ? String(data.nextCursor) : undefined;
  } while (cursor);
  return drafts;
}

function dateKey(value: Date): string {
  return new Date(value.getTime() - value.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 10);
}

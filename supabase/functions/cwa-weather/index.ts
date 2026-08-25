import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.7";

const CWA_BASE = "https://opendata.cwa.gov.tw/api/v1/rest/datastore";
const CWA_KEY = Deno.env.get("CWA_API_KEY") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const db = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Cache-Control": "no-store",
};

const COUNTIES = [
  "基隆市", "臺北市", "新北市", "桃園市", "新竹市", "新竹縣", "苗栗縣",
  "臺中市", "彰化縣", "南投縣", "雲林縣", "嘉義市", "嘉義縣", "臺南市",
  "高雄市", "屏東縣", "宜蘭縣", "花蓮縣", "臺東縣", "澎湖縣", "金門縣", "連江縣",
];

const TOWN_DATASET_BY_COUNTY: Record<string, string> = {
  "宜蘭縣": "F-D0047-001",
  "桃園市": "F-D0047-005",
  "新竹縣": "F-D0047-009",
  "苗栗縣": "F-D0047-013",
  "彰化縣": "F-D0047-017",
  "南投縣": "F-D0047-021",
  "雲林縣": "F-D0047-025",
  "嘉義縣": "F-D0047-029",
  "屏東縣": "F-D0047-033",
  "臺東縣": "F-D0047-037",
  "花蓮縣": "F-D0047-041",
  "澎湖縣": "F-D0047-045",
  "基隆市": "F-D0047-049",
  "新竹市": "F-D0047-053",
  "嘉義市": "F-D0047-057",
  "臺北市": "F-D0047-061",
  "高雄市": "F-D0047-065",
  "新北市": "F-D0047-069",
  "臺中市": "F-D0047-073",
  "臺南市": "F-D0047-077",
  "連江縣": "F-D0047-081",
  "金門縣": "F-D0047-085",
};

const BULLETIN_DEFINITIONS = [
  { key: "heat", label: "高溫資訊", dataset: "W-C0033-005", sourceUrl: "https://www.cwa.gov.tw/V8/C/P/Warning/W29.html" },
  { key: "typhoon", label: "颱風消息", dataset: "W-C0034-001", sourceUrl: "https://www.cwa.gov.tw/V8/C/P/Typhoon/TY_NEWS.html" },
  { key: "rain", label: "豪大雨特報", dataset: "W-C0033-003", sourceUrl: "https://www.cwa.gov.tw/V8/C/P/Warning/W26.html" },
];

const HOMEPAGE_BULLETIN_META: Record<string, { key: string; label: string; sourceUrl: string }> = {
  W29: { key: "heat", label: "高溫資訊", sourceUrl: "https://www.cwa.gov.tw/V8/C/P/Warning/W29.html" },
  W37: { key: "swell", label: "長浪即時訊息", sourceUrl: "https://www.cwa.gov.tw/V8/C/P/Warning/W37.html" },
  W25: { key: "wind", label: "陸上強風特報", sourceUrl: "https://www.cwa.gov.tw/V8/C/P/Warning/W25.html" },
  TY_NEWS: { key: "typhoon", label: "颱風消息", sourceUrl: "https://www.cwa.gov.tw/V8/C/P/Typhoon/TY_NEWS.html" },
  W26: { key: "rain", label: "豪大雨特報", sourceUrl: "https://www.cwa.gov.tw/V8/C/P/Warning/W26.html" },
};

type JsonObject = Record<string, unknown>;
type CountyWeather = {
  county: string;
  weather: string | null;
  weatherCode: string | null;
  minTemperature: number | null;
  maxTemperature: number | null;
  rainProbability: number | null;
  temperature: number | null;
  humidity: number | null;
  windSpeed: number | null;
  rainfall: number | null;
  observedAt: string | null;
  stationName: string | null;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
  });
}

function canonicalCounty(value: unknown) {
  return String(value || "").trim().replaceAll("台", "臺");
}

function record(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function array(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return value == null ? [] : [value];
}

function pick(obj: unknown, names: string[]): unknown {
  const source = record(obj);
  for (const name of names) {
    if (source[name] !== undefined && source[name] !== null) return source[name];
    const match = Object.keys(source).find((key) => key.toLowerCase() === name.toLowerCase());
    if (match && source[match] !== undefined && source[match] !== null) return source[match];
  }
  return undefined;
}

function textValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (["string", "number", "boolean"].includes(typeof value)) return String(value).trim() || null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = textValue(item);
      if (found) return found;
    }
    return null;
  }
  const source = record(value);
  const preferred = [
    "parameterName", "ParameterName", "value", "Value", "Weather", "WeatherCode",
    "Temperature", "MaxTemperature", "MinTemperature", "ProbabilityOfPrecipitation",
    "AirTemperature", "RelativeHumidity", "WindSpeed", "Precipitation",
  ];
  for (const name of preferred) {
    const found = pick(source, [name]);
    if (found !== undefined && found !== value) {
      const result = textValue(found);
      if (result) return result;
    }
  }
  for (const item of Object.values(source)) {
    const result = textValue(item);
    if (result) return result;
  }
  return null;
}

function numberValue(value: unknown): number | null {
  const raw = textValue(value);
  if (raw === null) return null;
  const valueNumber = Number.parseFloat(raw.replace(/[^0-9+.-]/g, ""));
  if (!Number.isFinite(valueNumber) || valueNumber <= -90 || valueNumber >= 9999) return null;
  return valueNumber;
}

function findArraysByKey(root: unknown, names: string[], depth = 0): unknown[][] {
  if (depth > 8 || root == null) return [];
  if (Array.isArray(root)) return root.flatMap((item) => findArraysByKey(item, names, depth + 1));
  if (typeof root !== "object") return [];
  const source = root as JsonObject;
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  const found: unknown[][] = [];
  for (const [key, value] of Object.entries(source)) {
    if (wanted.has(key.toLowerCase())) found.push(array(value));
    found.push(...findArraysByKey(value, names, depth + 1));
  }
  return found;
}

function firstTime(element: unknown): JsonObject {
  const times = array(pick(element, ["time", "Time"])).map(record);
  if (!times.length) return {};
  const now = Date.now();
  return times.find((item) => {
    const end = Date.parse(String(pick(item, ["endTime", "EndTime", "DataTime"]) || ""));
    return !Number.isFinite(end) || end >= now;
  }) || times[0];
}

function forecastElementValue(element: unknown): { value: string | null; code: string | null } {
  const time = firstTime(element);
  const parameter = pick(time, ["parameter", "Parameter"]);
  const elementValue = pick(time, ["elementValue", "ElementValue"]);
  const value = textValue(parameter) || textValue(elementValue) || textValue(time);
  const code = textValue(pick(record(parameter), ["parameterValue", "ParameterValue"])) ||
    textValue(pick(record(array(elementValue)[0]), ["WeatherCode", "value", "Value"]));
  return { value, code };
}

function parseCountyForecast(data: unknown): Map<string, Partial<CountyWeather>> {
  const result = new Map<string, Partial<CountyWeather>>();
  const candidates = findArraysByKey(data, ["location", "Location"])
    .flat()
    .map(record)
    .filter((item) => COUNTIES.includes(canonicalCounty(pick(item, ["locationName", "LocationName"]))));

  for (const location of candidates) {
    const county = canonicalCounty(pick(location, ["locationName", "LocationName"]));
    const elements = array(pick(location, ["weatherElement", "WeatherElement"]));
    if (!elements.length) continue;
    const byName = new Map<string, { value: string | null; code: string | null }>();
    for (const element of elements) {
      const name = String(pick(element, ["elementName", "ElementName"]) || "");
      byName.set(name, forecastElementValue(element));
    }
    const get = (...names: string[]) => {
      for (const name of names) if (byName.has(name)) return byName.get(name)!;
      return { value: null, code: null };
    };
    const weather = get("Wx", "天氣現象", "天氣");
    result.set(county, {
      county,
      weather: weather.value,
      weatherCode: weather.code,
      minTemperature: numberValue(get("MinT", "最低溫度").value),
      maxTemperature: numberValue(get("MaxT", "最高溫度").value),
      rainProbability: numberValue(get("PoP", "PoP12h", "降雨機率", "12小時降雨機率").value),
    });
  }
  return result;
}

function observationScore(station: JsonObject): number {
  const weather = record(pick(station, ["WeatherElement", "weatherElement"]));
  const temperature = numberValue(pick(weather, ["AirTemperature", "airTemperature"]));
  const altitude = numberValue(pick(record(pick(station, ["GeoInfo", "geoInfo"])), ["StationAltitude", "stationAltitude"])) || 9999;
  const stationName = String(pick(station, ["StationName", "stationName"]) || "");
  const preferred = /^(臺北|板橋|基隆|新屋|新竹|臺中|彰化|日月潭|嘉義|臺南|高雄|恆春|宜蘭|花蓮|臺東|澎湖|金門|馬祖)$/u.test(stationName);
  return (temperature === null ? 100000 : 0) + (preferred ? -5000 : 0) + altitude;
}

function parseObservations(data: unknown): Map<string, Partial<CountyWeather>> {
  const result = new Map<string, Partial<CountyWeather>>();
  const stations = findArraysByKey(data, ["Station", "station"]).flat().map(record)
    .filter((item) => Object.keys(item).some((key) => /StationName/i.test(key)));
  const grouped = new Map<string, JsonObject[]>();
  for (const station of stations) {
    const geo = record(pick(station, ["GeoInfo", "geoInfo"]));
    const county = canonicalCounty(pick(geo, ["CountyName", "countyName", "County", "county"]));
    if (!COUNTIES.includes(county)) continue;
    grouped.set(county, [...(grouped.get(county) || []), station]);
  }
  for (const [county, items] of grouped) {
    const station = [...items].sort((a, b) => observationScore(a) - observationScore(b))[0];
    const weather = record(pick(station, ["WeatherElement", "weatherElement"]));
    const precipitation = pick(record(pick(weather, ["Now", "now"])), ["Precipitation", "precipitation"]) ??
      pick(weather, ["Precipitation", "precipitation"]);
    result.set(county, {
      county,
      temperature: numberValue(pick(weather, ["AirTemperature", "airTemperature"])),
      humidity: numberValue(pick(weather, ["RelativeHumidity", "relativeHumidity"])),
      windSpeed: numberValue(pick(weather, ["WindSpeed", "windSpeed"])),
      rainfall: numberValue(precipitation),
      observedAt: textValue(pick(record(pick(station, ["ObsTime", "obsTime"])), ["DateTime", "dateTime"])) ||
        textValue(pick(station, ["ObsTime", "obsTime"])),
      stationName: textValue(pick(station, ["StationName", "stationName"])),
    });
  }
  return result;
}

function datasetObjects(data: unknown): JsonObject[] {
  const values = findArraysByKey(data, ["dataset", "Dataset"]).flat().map(record);
  return values.filter((item) => Object.keys(item).length > 0);
}

function affectedAreas(info: unknown): string[] {
  const values = findArraysByKey(info, ["location", "Location"]).flat().map((item) =>
    canonicalCounty(pick(item, ["locationName", "LocationName"]))
  ).filter(Boolean);
  return [...new Set(values)];
}

function parseEventAlerts(data: unknown) {
  const alerts: JsonObject[] = [];
  for (const dataset of datasetObjects(data)) {
    const info = record(pick(dataset, ["datasetInfo", "DatasetInfo"]));
    const title = textValue(pick(info, ["datasetDescription", "DatasetDescription"])) || "氣象警特報";
    const content = textValue(pick(record(array(pick(record(pick(dataset, ["contents", "Contents"])), ["content", "Content"]))[0]), ["contentText", "ContentText"]));
    const hazards = findArraysByKey(pick(dataset, ["hazardConditions", "HazardConditions"]), ["hazard", "Hazard"]).flat();
    const areas: string[] = [];
    const phenomena: string[] = [];
    for (const hazard of hazards) {
      const hazardInfo = record(pick(hazard, ["info", "Info"]) ?? hazard);
      const phenomenon = textValue(pick(hazardInfo, ["phenomena", "Phenomena"]));
      const significance = textValue(pick(hazardInfo, ["significance", "Significance"]));
      if (phenomenon) phenomena.push(`${phenomenon}${significance || ""}`);
      areas.push(...affectedAreas(hazardInfo));
    }
    if (!hazards.length && !content) continue;
    const valid = record(pick(info, ["validTime", "ValidTime"]));
    alerts.push({
      title,
      type: [...new Set(phenomena)].join("、") || title,
      areas: [...new Set(areas)],
      content,
      issuedAt: textValue(pick(info, ["issueTime", "IssueTime", "update", "Update"])),
      startsAt: textValue(pick(valid, ["startTime", "StartTime"])),
      endsAt: textValue(pick(valid, ["endTime", "EndTime"])),
    });
  }
  return alerts;
}

function parseCountyAlerts(data: unknown) {
  const byKey = new Map<string, JsonObject>();
  const locations = findArraysByKey(data, ["location", "Location"]).flat().map(record);
  for (const location of locations) {
    const county = canonicalCounty(pick(location, ["locationName", "LocationName"]));
    if (!COUNTIES.includes(county)) continue;
    const hazards = findArraysByKey(pick(location, ["hazardConditions", "HazardConditions"]), ["hazard", "Hazard"]).flat();
    for (const hazard of hazards) {
      const info = record(pick(hazard, ["info", "Info"]) ?? hazard);
      const phenomena = textValue(pick(info, ["phenomena", "Phenomena"]));
      const significance = textValue(pick(info, ["significance", "Significance"]));
      if (!phenomena) continue;
      const title = `${phenomena}${significance || ""}`;
      const existing = byKey.get(title) || { title, type: title, areas: [], content: null };
      existing.areas = [...new Set([...(existing.areas as string[]), county])];
      byKey.set(title, existing);
    }
  }
  return [...byKey.values()];
}

function parseFlatAlerts(data: unknown) {
  const grouped = new Map<string, JsonObject>();
  const rows = findArraysByKey(data, ["record", "Record", "location", "Location"]).flat().map(record);
  for (const row of rows) {
    const phenomenon = textValue(pick(row, ["phenomena", "Phenomena"]));
    const significance = textValue(pick(row, ["significance", "Significance"]));
    const description = textValue(pick(row, ["datasetDescription", "DatasetDescription"]));
    const content = textValue(pick(row, ["contentText", "ContentText"]));
    const area = canonicalCounty(pick(row, ["locationName", "LocationName"]));
    if (!phenomenon && !significance && !content) continue;
    const title = description || `${phenomenon || "氣象"}${significance || "警特報"}`;
    const key = `${title}|${content || ""}`;
    const current = grouped.get(key) || {
      title,
      type: `${phenomenon || title}${significance || ""}`,
      areas: [],
      content,
      issuedAt: textValue(pick(row, ["issueTime", "IssueTime", "update", "Update"])),
      startsAt: textValue(pick(row, ["startTime", "StartTime"])),
      endsAt: textValue(pick(row, ["endTime", "EndTime"])),
    };
    if (area) current.areas = [...new Set([...(current.areas as string[]), area])];
    grouped.set(key, current);
  }
  return [...grouped.values()];
}

function findObjects(root: unknown, predicate: (item: JsonObject) => boolean, depth = 0): JsonObject[] {
  if (depth > 10 || root == null) return [];
  if (Array.isArray(root)) return root.flatMap((item) => findObjects(item, predicate, depth + 1));
  if (typeof root !== "object") return [];
  const source = root as JsonObject;
  const found = predicate(source) ? [source] : [];
  return found.concat(Object.values(source).flatMap((item) => findObjects(item, predicate, depth + 1)));
}

function cwaTime(value: unknown): string | null {
  const raw = textValue(value);
  if (!raw) return null;
  if (/^\d{4}[-/]\d{2}[-/]\d{2} \d{2}:\d{2}/u.test(raw) && !/[+-]\d{2}:?\d{2}$/u.test(raw)) {
    return raw.replaceAll("/", "-").replace(" ", "T") + "+08:00";
  }
  return raw;
}

function parseCapAlerts(data: unknown) {
  const grouped = new Map<string, JsonObject>();
  const candidates = findObjects(data, (item) => Boolean(
    pick(item, ["headline", "Headline"]) &&
    (pick(item, ["description", "Description"]) || pick(item, ["event", "Event"]))
  ));
  for (const item of candidates) {
    const title = textValue(pick(item, ["headline", "Headline"])) || "氣象重要資訊";
    const content = textValue(pick(item, ["description", "Description"])) || "";
    const event = textValue(pick(item, ["event", "Event"])) || title;
    const startsAt = cwaTime(pick(item, ["onset", "Onset", "effective", "Effective"]));
    const endsAt = cwaTime(pick(item, ["expires", "Expires"]));
    const issuedAt = cwaTime(pick(item, ["sent", "Sent", "effective", "Effective"]));
    const urgency = textValue(pick(item, ["urgency", "Urgency"])) || "";
    const endTime = endsAt ? Date.parse(endsAt) : Number.NaN;
    const active = !/解除|取消/u.test(title) && urgency.toLowerCase() !== "past" &&
      (!Number.isFinite(endTime) || endTime > Date.now());
    const areas = findObjects(item, (area) => pick(area, ["areaDesc", "AreaDesc"]) !== undefined)
      .map((area) => textValue(pick(area, ["areaDesc", "AreaDesc"]))).filter(Boolean) as string[];
    const key = `${title}|${content}`;
    const current = grouped.get(key) || {
      title,
      type: event,
      areas: [],
      content,
      issuedAt,
      startsAt,
      endsAt,
      active,
      severity: textValue(pick(item, ["severity", "Severity"])),
      sourceUrl: textValue(pick(item, ["web", "Web"])),
    };
    current.areas = [...new Set([...(current.areas as string[]), ...areas])];
    grouped.set(key, current);
  }
  return [...grouped.values()].sort((a, b) => Date.parse(String(b.issuedAt || b.startsAt || 0)) - Date.parse(String(a.issuedAt || a.startsAt || 0)));
}

function decodeJsString(value: string) {
  return value.replace(/\\u([0-9a-f]{4})/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/\\r/g, "\r").replace(/\\n/g, "\n").replace(/\\t/g, "\t")
    .replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

function rocTyphoonTime(value: string | null) {
  const match = String(value || "").match(/民國(\d{3})年(\d{2})月(\d{2})日(\d{2})時/u);
  if (!match) return null;
  const year = Number(match[1]) + 1911;
  return `${year}-${match[2]}-${match[3]}T${match[4]}:00:00+08:00`;
}

async function fetchTyphoonHomepageStatus() {
  const response = await fetch(`https://www.cwa.gov.tw/Data/js/typhoon/TY_NEWS-Data.js?T=${Date.now()}`, {
    headers: { Accept: "text/javascript" },
  });
  if (!response.ok) throw new Error(`中央氣象署颱風消息回應 ${response.status}`);
  const script = await response.text();
  // [^'] 原本也吃得下反斜線，跟 \\. 這個分支重疊；含大量 \\& 的輸入會逼出指數回溯。
  // 從字元類排除反斜線後，逸出序列只剩 \\. 一條路徑，語意不變但沒有歧義。
  const timeText = script.match(/var\s+TY_TIME\s*=\s*\{[\s\S]*?'C'\s*:\s*'((?:\\.|[^'\\])*)'/u)?.[1] || null;
  const counts = script.match(/var\s+TY_COUNT\s*=\s*\[\s*(\d+)\s*,\s*(\d+)\s*\]/u);
  const tropicalDepressionCount = Number(counts?.[1] || 0);
  const typhoonCount = Number(counts?.[2] || 0);
  const countParts = [];
  if (typhoonCount > 0) countParts.push(`有 ${typhoonCount} 個颱風`);
  if (tropicalDepressionCount > 0) countParts.push(`有 ${tropicalDepressionCount} 個熱帶性低氣壓`);
  const decodedTime = timeText ? decodeJsString(timeText) : null;
  return {
    active: typhoonCount + tropicalDepressionCount > 0,
    issuedAt: rocTyphoonTime(decodedTime),
    content: decodedTime && countParts.length
      ? `目前 (${decodedTime}) 太平洋地區${countParts.join("，")}。`
      : "中央氣象署目前發布颱風消息，請點擊查看最新內容。",
  };
}

async function fetchHomepageBulletins() {
  const response = await fetch(`https://www.cwa.gov.tw/Data/js/warn/Warning_Content.js?v=${Date.now()}`, {
    headers: { Accept: "text/javascript" },
  });
  if (!response.ok) throw new Error(`中央氣象署重要資訊回應 ${response.status}`);
  const script = await response.text();
  const listed = script.match(/var\s+WarnAll\s*=\s*\[([^\]]*)\]/u)?.[1]
    .split(",").map((item) => item.trim().replace(/^['"]|['"]$/g, "")) || [];
  const typhoonStatus = listed.includes("TY_NEWS")
    ? await fetchTyphoonHomepageStatus().catch(() => null)
    : null;
  return listed.filter((code) => HOMEPAGE_BULLETIN_META[code]).map((code) => {
    const meta = HOMEPAGE_BULLETIN_META[code];
    const section = script.match(new RegExp(`'${code}'\\s*:\\s*\\{\\s*'C'\\s*:\\s*\\{([\\s\\S]*?)\\n\\s*\\},\\s*\\n\\s*'E'`, "u"))?.[1] || "";
    const field = (name: string) => {
    const match = section.match(new RegExp(`'${name}'\\s*:\\s*'((?:\\\\.|[^'])*)'`, "u"));
    return match ? decodeJsString(match[1]) : null;
    };
    const title = field("title") || meta.label;
    const issuedAt = code === "TY_NEWS" ? typhoonStatus?.issuedAt || null : cwaTime(field("issued"));
    return {
      key: meta.key,
      label: meta.label,
      dataset: null,
      sourceUrl: meta.sourceUrl,
      status: code === "TY_NEWS" && typhoonStatus ? (typhoonStatus.active ? "active" : "clear") : (/解除|取消/u.test(title) ? "ended" : "active"),
      title,
      content: code === "TY_NEWS" ? typhoonStatus?.content || "中央氣象署目前發布颱風消息，請點擊查看最新內容。" : field("content"),
      areas: [],
      issuedAt,
      endsAt: cwaTime(field("validto")),
    };
  });
}

function bulletin(definition: typeof BULLETIN_DEFINITIONS[number], data: unknown) {
  const item = parseCapAlerts(data)[0] || null;
  return {
    key: definition.key,
    label: definition.label,
    dataset: definition.dataset,
    sourceUrl: item?.sourceUrl || definition.sourceUrl,
    status: item ? (item.active ? "active" : "ended") : "clear",
    title: item?.title || `目前無${definition.label}`,
    content: item?.content || null,
    areas: item?.areas || [],
    issuedAt: item?.issuedAt || null,
    endsAt: item?.endsAt || null,
  };
}

function mergeAlerts(eventAlerts: JsonObject[], countyAlerts: JsonObject[]) {
  const result: JsonObject[] = [];
  for (const alert of eventAlerts) {
    const matched = result.find((item) => String(item.title || item.type) === String(alert.title || alert.type) &&
      String(item.content || "") === String(alert.content || ""));
    if (matched) {
      matched.areas = [...new Set([...(array(matched.areas).map(String)), ...(array(alert.areas).map(String))])];
    } else result.push(alert);
  }
  for (const fallback of countyAlerts) {
    const matched = result.find((item) => String(item.type || item.title).includes(String(fallback.type || "")) ||
      String(fallback.type || "").includes(String(item.type || item.title)));
    if (matched) {
      matched.areas = [...new Set([...(array(matched.areas).map(String)), ...(array(fallback.areas).map(String))])];
    } else result.push(fallback);
  }
  return result.slice(0, 30);
}

function townElementValue(element: unknown) {
  const name = String(pick(element, ["elementName", "ElementName"]) || "");
  const time = firstTime(element);
  const values = array(pick(time, ["elementValue", "ElementValue"]));
  const item = record(values[0] ?? time);
  const specific = pick(item, [
    "Weather", "WeatherCode", "Temperature", "MaxTemperature", "MinTemperature",
    "ProbabilityOfPrecipitation", "RelativeHumidity", "WindSpeed", "WeatherDescription",
  ]);
  return { name, value: textValue(specific ?? item), code: textValue(pick(item, ["WeatherCode"])) };
}

function parseTownForecast(data: unknown, county: string) {
  const candidates = findArraysByKey(data, ["Location", "location"]).flat().map(record);
  const towns = candidates.filter((item) => {
    const name = textValue(pick(item, ["LocationName", "locationName"]));
    return name && !COUNTIES.includes(canonicalCounty(name)) && pick(item, ["WeatherElement", "weatherElement"]);
  });
  return towns.map((town) => {
    const values = new Map<string, { name: string; value: string | null; code: string | null }>();
    for (const element of array(pick(town, ["WeatherElement", "weatherElement"]))) {
      const parsed = townElementValue(element);
      values.set(parsed.name, parsed);
    }
    const get = (...names: string[]) => {
      for (const name of names) if (values.has(name)) return values.get(name)!;
      return { value: null, code: null };
    };
    const weather = get("天氣現象", "Wx", "天氣");
    return {
      county,
      town: textValue(pick(town, ["LocationName", "locationName"])),
      latitude: numberValue(pick(town, ["Latitude", "latitude"])),
      longitude: numberValue(pick(town, ["Longitude", "longitude"])),
      weather: weather.value,
      weatherCode: weather.code,
      temperature: numberValue(get("平均溫度", "溫度", "T").value),
      minTemperature: numberValue(get("最低溫度", "MinT").value),
      maxTemperature: numberValue(get("最高溫度", "MaxT").value),
      rainProbability: numberValue(get("12小時降雨機率", "降雨機率", "PoP12h", "PoP").value),
      humidity: numberValue(get("平均相對濕度", "相對濕度", "RH").value),
      windSpeed: get("風向風速", "風速", "WS").value,
      description: get("天氣預報綜合描述", "WeatherDescription").value,
      startsAt: textValue(pick(firstTime(array(pick(town, ["WeatherElement", "weatherElement"]))[0]), ["StartTime", "startTime", "DataTime"])),
    };
  }).filter((item) => item.town);
}

async function fetchCwa(dataset: string, params: Record<string, string> = {}) {
  const url = new URL(`${CWA_BASE}/${dataset}`);
  url.searchParams.set("Authorization", CWA_KEY);
  url.searchParams.set("format", "JSON");
  for (const [name, value] of Object.entries(params)) if (value) url.searchParams.set(name, value);
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`中央氣象署 ${dataset} 回應 ${response.status}`);
  const payload = await response.json();
  if (payload?.success === "false" || payload?.success === false) {
    throw new Error(String(payload?.message || `${dataset} 資料讀取失敗`));
  }
  return payload;
}

async function readCache(cacheKey: string) {
  const { data, error } = await db.from("weather_api_cache").select("*").eq("cache_key", cacheKey).maybeSingle();
  if (error && error.code !== "PGRST116" && error.code !== "42P01") console.warn("weather cache read", error.message);
  return data || null;
}

async function writeCache(cacheKey: string, payload: unknown, ttlSeconds: number) {
  const now = new Date();
  const expires = new Date(now.getTime() + ttlSeconds * 1000);
  const { error } = await db.from("weather_api_cache").upsert({
    cache_key: cacheKey,
    payload,
    source_updated_at: record(payload).updatedAt || now.toISOString(),
    fetched_at: now.toISOString(),
    expires_at: expires.toISOString(),
    status: "ok",
    last_error: null,
    updated_at: now.toISOString(),
  });
  if (error) console.warn("weather cache write", error.message);
}

async function cachedResponse(cacheKey: string, ttlSeconds: number, loader: () => Promise<JsonObject>): Promise<JsonObject> {
  const cached = await readCache(cacheKey);
  if (cached && Date.parse(cached.expires_at) > Date.now()) {
    return { ...record(cached.payload), cached: true, stale: false };
  }
  try {
    const payload = await loader();
    await writeCache(cacheKey, payload, ttlSeconds);
    return { ...payload, cached: false, stale: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (cached?.payload) return { ...record(cached.payload), cached: true, stale: true, warning: `目前顯示最近一次快取：${message}` };
    throw error;
  }
}

async function loadSummary() {
  const settled = await Promise.allSettled([
    fetchCwa("F-C0032-001"),
    fetchCwa("O-A0003-001"),
    fetchCwa("W-C0033-001"),
    fetchCwa("W-C0033-002"),
    ...BULLETIN_DEFINITIONS.map((item) => fetchCwa(item.dataset)),
    fetchHomepageBulletins(),
  ]);
  const errors = settled.filter((item) => item.status === "rejected").map((item) => String((item as PromiseRejectedResult).reason));
  if (settled.every((item) => item.status === "rejected")) throw new Error(errors.join("；"));
  const value = (index: number) => settled[index].status === "fulfilled" ? (settled[index] as PromiseFulfilledResult<unknown>).value : {};
  const forecast = parseCountyForecast(value(0));
  const observations = parseObservations(value(1));
  const capAlerts = BULLETIN_DEFINITIONS.flatMap((_, index) => parseCapAlerts(value(index + 4)));
  const eventAlerts = [...parseEventAlerts(value(3)), ...parseFlatAlerts(value(3)), ...capAlerts.filter((item) => item.active)];
  const alerts = mergeAlerts(eventAlerts, parseCountyAlerts(value(2)));
  const homepageBulletins = value(4 + BULLETIN_DEFINITIONS.length);
  const bulletins = Array.isArray(homepageBulletins) && homepageBulletins.length ? homepageBulletins : [
    bulletin(BULLETIN_DEFINITIONS[0], value(4)),
    bulletin(BULLETIN_DEFINITIONS[1], value(5)),
    bulletin(BULLETIN_DEFINITIONS[2], value(6)),
  ];
  const counties = COUNTIES.map((county): CountyWeather => ({
    county,
    weather: null,
    weatherCode: null,
    minTemperature: null,
    maxTemperature: null,
    rainProbability: null,
    temperature: null,
    humidity: null,
    windSpeed: null,
    rainfall: null,
    observedAt: null,
    stationName: null,
    ...(forecast.get(county) || {}),
    ...(observations.get(county) || {}),
  }));
  return {
    ok: true,
    configured: true,
    view: "summary",
    updatedAt: new Date().toISOString(),
    sourceWarnings: errors,
    bulletins,
    alerts,
    counties,
  };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (request.method !== "GET") return json({ ok: false, message: "僅支援 GET" }, 405);
  const url = new URL(request.url);
  const view = url.searchParams.get("view") || "summary";

  if (view === "health") {
    return json({ ok: true, configured: Boolean(CWA_KEY), service: "cwa-weather", time: new Date().toISOString() });
  }
  if (!CWA_KEY) {
    return json({ ok: false, configured: false, message: "尚未設定中央氣象署 CWA_API_KEY" }, 503);
  }

  try {
    if (view === "summary") return json(await cachedResponse("summary:v4", 600, loadSummary));
    if (view === "county") {
      const county = canonicalCounty(url.searchParams.get("county"));
      if (!COUNTIES.includes(county)) return json({ ok: false, message: "縣市名稱不正確" }, 400);
      const summary = await cachedResponse("summary:v4", 600, loadSummary);
      const countyWeather = array(summary.counties).map(record).find((item) => canonicalCounty(item.county) === county) || null;
      const alerts = array(summary.alerts).map(record).filter((item) => array(item.areas).some((area) => String(area).includes(county.replace(/[市縣]$/u, ""))));
      return json({ ok: true, configured: true, view, updatedAt: summary.updatedAt, stale: summary.stale, county: countyWeather, alerts });
    }
    if (view === "town") {
      const county = canonicalCounty(url.searchParams.get("county"));
      if (!COUNTIES.includes(county)) return json({ ok: false, message: "請指定正確縣市" }, 400);
      const dataset = TOWN_DATASET_BY_COUNTY[county];
      const payload = await cachedResponse(`town:v2:${county}`, 1800, async () => ({
        ok: true,
        configured: true,
        view,
        county,
        updatedAt: new Date().toISOString(),
        dataset,
        towns: parseTownForecast(await fetchCwa(dataset), county),
      }));
      return json(payload);
    }
    return json({ ok: false, message: "不支援的 view" }, 400);
  } catch (error) {
    console.error(error);
    return json({ ok: false, configured: true, message: error instanceof Error ? error.message : "氣象資料讀取失敗" }, 502);
  }
});

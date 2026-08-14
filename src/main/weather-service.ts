// Open-Meteo(무료, API 키·회원가입 불필요)로 오늘·내일 날씨 문장을 만든다. 지오코딩도 같은
// 서비스의 키 없는 엔드포인트를 쓴다. 대한민국(country_code === "KR")은 예보에
// models=kma_seamless를 붙여 기상청 기반 데이터를 우선 쓴다 — 다만 이 모델은 강수확률을
// 안 주는 경우가 있어(2026-08 커뮤니티 보고) 그 값이 없으면 강수 문구만 조용히 뺀다.
const { t } = require("../shared/i18n.js");

const GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const FETCH_TIMEOUT_MS = 8000;

type WeatherServiceDeps = {
  fetchImpl?: typeof fetch;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
};

type GeocodeResult = { latitude: number; longitude: number; countryCode: string };

// Open-Meteo 지오코딩(GeoNames 기반)은 한국 행정구역 이름 색인이 들쭉날쭉하다(실측, 2026-08).
// "경기도 성남시"처럼 도+시를 붙이면 통째로 못 찾지만 "성남시"만 넣으면 바로 찾고, 광역시는
// "서울" 같은 축약형은 없고 "서울특별시" 정식 명칭만 있다. 도 이름 자체는 지역마다 색인
// 상태가 달라(경기도는 되는데 충청남도는 안 됨) 일반화하지 않는다.
const METRO_CITY_FORMAL_NAMES: Record<string, string> = {
  "서울": "서울특별시",
  "부산": "부산광역시",
  "대구": "대구광역시",
  "인천": "인천광역시",
  "광주": "광주광역시",
  "대전": "대전광역시",
  "울산": "울산광역시"
};
const PROVINCE_PREFIX_SUFFIXES = ["특별자치도", "특별자치시", "광역시", "특별시", "도"];

// "OO도 OO시" 두 토큰 형태만 다룬다 — "서울특별시 강남구"처럼 구 단위까지 오면 손대지 않는다.
// "강남구"만 떼어 재검색하면 전혀 다른 동명 지명("강남구렁고개" 등)에 조용히 잘못 걸릴 수 있어,
// 차라리 못 찾았다고 알리는 편이 낫다.
function stripLeadingProvince(city: string): string | null {
  const parts = city.split(/\s+/);
  if (parts.length !== 2) return null;
  const [province, place] = parts;
  if (!PROVINCE_PREFIX_SUFFIXES.some((suffix) => province.endsWith(suffix))) return null;
  return place.endsWith("시") ? place : null;
}

type DailyForecast = {
  weathercode: Array<number | null>;
  max: Array<number | null>;
  min: Array<number | null>;
  precip: Array<number | null>;
};

const WEATHER_ICONS = {
  clear: "☀️",
  partlyCloudy: "⛅",
  cloudy: "☁️",
  fog: "🌫️",
  drizzle: "🌦️",
  rain: "🌧️",
  snow: "❄️",
  thunderstorm: "⛈️"
} as const;

// WMO 날씨 코드(Open-Meteo daily.weathercode) → 이모지 카테고리.
// https://open-meteo.com/en/docs 의 WMO Weather interpretation codes 표 기준.
function weatherCodeToIcon(code: number | null): string {
  if (code === 0) return WEATHER_ICONS.clear;
  if (code === 1 || code === 2) return WEATHER_ICONS.partlyCloudy;
  if (code === 3) return WEATHER_ICONS.cloudy;
  if (code === 45 || code === 48) return WEATHER_ICONS.fog;
  if ([51, 53, 55, 56, 57].includes(code as number)) return WEATHER_ICONS.drizzle;
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code as number)) return WEATHER_ICONS.rain;
  if ([71, 73, 75, 77, 85, 86].includes(code as number)) return WEATHER_ICONS.snow;
  if ([95, 96, 99].includes(code as number)) return WEATHER_ICONS.thunderstorm;
  return WEATHER_ICONS.cloudy;
}

function createWeatherService(deps: WeatherServiceDeps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const setTimeoutFn = deps.setTimeoutFn || setTimeout;
  const clearTimeoutFn = deps.clearTimeoutFn || clearTimeout;

  async function fetchJson(url: string): Promise<unknown | null> {
    const controller = new AbortController();
    const timer = setTimeoutFn(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetchImpl(url, { signal: controller.signal });
      if (!response.ok) return null;
      return await response.json();
    } catch {
      return null;
    } finally {
      clearTimeoutFn(timer);
    }
  }

  async function geocodeQuery(query: string): Promise<GeocodeResult | null> {
    const url = `${GEOCODING_URL}?name=${encodeURIComponent(query)}&count=1&language=ko&format=json`;
    const data = await fetchJson(url) as { results?: Array<Record<string, unknown>> } | null;
    const result = data?.results?.[0];
    if (!result || typeof result.latitude !== "number" || typeof result.longitude !== "number") return null;
    return {
      latitude: result.latitude,
      longitude: result.longitude,
      countryCode: typeof result.country_code === "string" ? result.country_code : ""
    };
  }

  async function geocodeCity(city: string): Promise<GeocodeResult | null> {
    const trimmed = city.trim();
    if (!trimmed) return null;
    const direct = await geocodeQuery(trimmed);
    if (direct) return direct;
    const metroFormalName = METRO_CITY_FORMAL_NAMES[trimmed];
    if (metroFormalName) {
      const metro = await geocodeQuery(metroFormalName);
      if (metro) return metro;
    }
    const strippedCity = stripLeadingProvince(trimmed);
    if (strippedCity) return geocodeQuery(strippedCity);
    return null;
  }

  async function fetchDailyForecastFromUrl(url: string): Promise<DailyForecast | null> {
    const data = await fetchJson(url) as { daily?: Record<string, unknown[]> } | null;
    const daily = data?.daily;
    if (!daily || !Array.isArray(daily.time) || daily.time.length < 2) return null;
    return {
      weathercode: daily.weathercode as Array<number | null>,
      max: daily.temperature_2m_max as Array<number | null>,
      min: daily.temperature_2m_min as Array<number | null>,
      precip: daily.precipitation_probability_max as Array<number | null>
    };
  }

  // kma_seamless는 이따금 이 지역·시각에 대해 모든 daily 필드를 null로 돌려준다(실측,
  // 2026-08). 그럴 때 "?"로만 채워진 문장을 보여주느니 기본 모델(best_match)로 조용히
  // 물러난다 — 대한민국 우선은 "쓸 수 있으면" 정도의 개선이지 강한 보장이 아니다.
  async function fetchDailyForecast(geo: GeocodeResult): Promise<DailyForecast | null> {
    const baseUrl = `${FORECAST_URL}?latitude=${geo.latitude}&longitude=${geo.longitude}` +
      `&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
      `&timezone=auto&forecast_days=2`;
    if (geo.countryCode === "KR") {
      const kmaForecast = await fetchDailyForecastFromUrl(`${baseUrl}&models=kma_seamless`);
      if (kmaForecast && kmaForecast.max.some((value) => typeof value === "number")) return kmaForecast;
    }
    return fetchDailyForecastFromUrl(baseUrl);
  }

  function formatDayLine(language: string, labelKey: string, index: number, forecast: DailyForecast): string {
    const code = forecast.weathercode?.[index] ?? null;
    const max = forecast.max?.[index];
    const min = forecast.min?.[index];
    const precip = forecast.precip?.[index];
    let line = t(language, "weather.dayLine", {
      label: t(language, labelKey),
      icon: weatherCodeToIcon(typeof code === "number" ? code : null),
      max: typeof max === "number" ? Math.round(max) : "?",
      min: typeof min === "number" ? Math.round(min) : "?"
    });
    if (typeof precip === "number") {
      line += t(language, "weather.precipSuffix", { percent: Math.round(precip) });
    }
    return line;
  }

  // 실패해도 예외를 던지지 않고 사용자에게 보여줄 안내 문구를 그대로 돌려준다 —
  // 호출부(알람 발동, 트레이 클릭)가 실패 케이스를 따로 처리할 필요가 없게 하기 위함.
  async function getWeatherBriefing(city: string, language: string): Promise<string> {
    if (!city.trim()) return t(language, "weather.locationMissing");
    const geo = await geocodeCity(city);
    if (!geo) return t(language, "weather.fetchFailed");
    const forecast = await fetchDailyForecast(geo);
    if (!forecast) return t(language, "weather.fetchFailed");
    const today = formatDayLine(language, "weather.todayLabel", 0, forecast);
    const tomorrow = formatDayLine(language, "weather.tomorrowLabel", 1, forecast);
    return `${today}\n${tomorrow}`;
  }

  return { getWeatherBriefing, geocodeCity, fetchDailyForecast };
}

export { createWeatherService, weatherCodeToIcon };
export type { WeatherServiceDeps };

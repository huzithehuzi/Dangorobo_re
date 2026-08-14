// Open-Meteo(무료, API 키·회원가입 불필요)로 오늘/내일의 오전·오후 날씨 문장 4줄을 만든다.
// 하루 평균(daily)이 아니라 시간별(hourly) 데이터를 받아 오전(6~11시)·오후(12~17시)
// 구간별로 최고/최저·강수확률을 다시 계산한다. 지오코딩도 같은 서비스의 키 없는 엔드포인트를
// 쓴다. 대한민국(country_code === "KR")은 예보에 models=kma_seamless를 붙여 기상청 기반
// 데이터를 우선 쓴다 — 다만 이 모델은 특정 시각에 값을 통째로 안 주는 경우가 있어(실측,
// 2026-08) 그럴 때는 기본 모델(best_match)로 물러난다.
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

// timezone=auto라 time은 "YYYY-MM-DDTHH:mm" 지역 표준시 그대로 온다 — 오전/오후를
// 나누려면 하루 평균값(daily)이 아니라 시간별(hourly) 값이 필요해 daily 대신 이걸 쓴다.
type HourlyForecast = {
  time: string[];
  weathercode: Array<number | null>;
  temperature: Array<number | null>;
  precip: Array<number | null>;
};

// icon은 WEATHER_ICONS 값 중 하나(이모지 한 글자, 알림 평문에만 쓴다), category는 펫 창이
// 이모지 대신 그릴 단색 SVG 배지를 고르는 키다(피드백, 2026-08 — 비 이모지가 파란 배지
// 배경에서 잘 안 보임). text는 아이콘이 빠진 나머지 문구.
type WeatherLine = { icon: string; category: WeatherCategory; text: string };
// lines는 성공했을 때만 채워진다. 실패(위치 미설정·조회 실패)하면 null이고 message만 보여준다.
type WeatherBriefing = { message: string; lines: WeatherLine[] | null };

// dayOffset 0=오늘, 1=내일.
const DAY_PERIODS = [
  { labelKey: "weather.todayMorningLabel", dayOffset: 0, startHour: 6, endHour: 11 },
  { labelKey: "weather.todayAfternoonLabel", dayOffset: 0, startHour: 12, endHour: 17 },
  { labelKey: "weather.tomorrowMorningLabel", dayOffset: 1, startHour: 6, endHour: 11 },
  { labelKey: "weather.tomorrowAfternoonLabel", dayOffset: 1, startHour: 12, endHour: 17 }
] as const;

// 순서 자체가 심각도다(맑음이 제일 가볍고 뇌우가 제일 무겁다) — 구간 안에서 가장 심한
// 조건을 뽑을 때 이 배열의 인덱스를 그대로 비교 기준으로 쓴다.
const WEATHER_CATEGORIES = ["clear", "partlyCloudy", "cloudy", "fog", "drizzle", "rain", "snow", "thunderstorm"] as const;
type WeatherCategory = typeof WEATHER_CATEGORIES[number];

const WEATHER_ICONS: Record<WeatherCategory, string> = {
  clear: "☀️",
  partlyCloudy: "⛅",
  cloudy: "☁️",
  fog: "🌫️",
  drizzle: "🌦️",
  rain: "🌧️",
  snow: "❄️",
  thunderstorm: "⛈️"
};

// WMO 날씨 코드(Open-Meteo weathercode) → 카테고리.
// https://open-meteo.com/en/docs 의 WMO Weather interpretation codes 표 기준.
function weatherCodeToCategory(code: number | null): WeatherCategory {
  if (code === 0) return "clear";
  if (code === 1 || code === 2) return "partlyCloudy";
  if (code === 3) return "cloudy";
  if (code === 45 || code === 48) return "fog";
  if ([51, 53, 55, 56, 57].includes(code as number)) return "drizzle";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code as number)) return "rain";
  if ([71, 73, 75, 77, 85, 86].includes(code as number)) return "snow";
  if ([95, 96, 99].includes(code as number)) return "thunderstorm";
  return "cloudy";
}

function weatherCodeToIcon(code: number | null): string {
  return WEATHER_ICONS[weatherCodeToCategory(code)];
}

// 구간 안 여러 시간 중 가장 심한 조건의 코드를 뽑는다. 강수확률처럼 최고/최저 기온도
// 구간 전체에서 뽑는데 아이콘만 특정 시각(예: 오전 9시) 하나로 정하면, "강수 100%"인데
// 그 9시엔 아직 안 와서 맑음 아이콘이 뜨는 모순이 생긴다(실측, 2026-08 사용자 보고).
function worstCodeInBucket(codes: number[]): number | null {
  if (codes.length === 0) return null;
  return codes.reduce((worst, current) => (
    WEATHER_CATEGORIES.indexOf(weatherCodeToCategory(current)) > WEATHER_CATEGORIES.indexOf(weatherCodeToCategory(worst))
      ? current
      : worst
  ));
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

  async function geocodeQuery(query: string, geocodeLanguage: string): Promise<GeocodeResult | null> {
    const url = `${GEOCODING_URL}?name=${encodeURIComponent(query)}&count=1&language=${geocodeLanguage}&format=json`;
    const data = await fetchJson(url) as { results?: Array<Record<string, unknown>> } | null;
    const result = data?.results?.[0];
    if (!result || typeof result.latitude !== "number" || typeof result.longitude !== "number") return null;
    return {
      latitude: result.latitude,
      longitude: result.longitude,
      countryCode: typeof result.country_code === "string" ? result.country_code : ""
    };
  }

  // 지오코딩의 language 파라미터는 결과 이름 표기만 바꾸는 게 아니라 실제로 어떤 후보가
  // 매칭되는지도 바꾼다(실측, 2026-08) — "New York"을 language=ko·ja로 조회하면 네브래스카의
  // 소도시 "York"가 대신 걸린다(이 경우는 아예 못 찾는 게 아니라 엉뚱한 결과가 걸리는 것이라
  // 이 폴백으로도 못 잡는다 — GeoNames 색인 자체의 한계로 남겨둔다). 앱 언어로 먼저 찾고,
  // 완전히 못 찾았을 때만 en·ko를 순서대로 한 번씩 더 시도한다 — 앱 언어가 en이어도 한글
  // 지명을(예: "성남시") 그대로 입력하는 경우까지 커버하기 위해 ko도 항상 후보에 둔다.
  async function geocodeCity(city: string, language: string): Promise<GeocodeResult | null> {
    const trimmed = city.trim();
    if (!trimmed) return null;
    const primaryLanguage = language === "ko" || language === "ja" ? language : "en";
    const direct = await geocodeQuery(trimmed, primaryLanguage);
    if (direct) return direct;
    for (const fallbackLanguage of ["en", "ko"]) {
      if (fallbackLanguage === primaryLanguage) continue;
      const viaFallback = await geocodeQuery(trimmed, fallbackLanguage);
      if (viaFallback) return viaFallback;
    }
    // 아래 두 폴백은 한국 행정구역 이름 전용이라 항상 language=ko로 시도한다.
    const metroFormalName = METRO_CITY_FORMAL_NAMES[trimmed];
    if (metroFormalName) {
      const metro = await geocodeQuery(metroFormalName, "ko");
      if (metro) return metro;
    }
    const strippedCity = stripLeadingProvince(trimmed);
    if (strippedCity) return geocodeQuery(strippedCity, "ko");
    return null;
  }

  async function fetchHourlyForecastFromUrl(url: string): Promise<HourlyForecast | null> {
    const data = await fetchJson(url) as { hourly?: Record<string, unknown[]> } | null;
    const hourly = data?.hourly;
    if (!hourly || !Array.isArray(hourly.time) || hourly.time.length === 0) return null;
    return {
      time: hourly.time as string[],
      weathercode: hourly.weathercode as Array<number | null>,
      temperature: hourly.temperature_2m as Array<number | null>,
      precip: hourly.precipitation_probability as Array<number | null>
    };
  }

  // kma_seamless는 이따금 이 지역·시각에 대해 모든 필드를 null로 돌려준다(실측, 2026-08).
  // 그럴 때 "?"로만 채워진 문장을 보여주느니 기본 모델(best_match)로 조용히 물러난다 —
  // 대한민국 우선은 "쓸 수 있으면" 정도의 개선이지 강한 보장이 아니다.
  async function fetchHourlyForecast(geo: GeocodeResult): Promise<HourlyForecast | null> {
    const baseUrl = `${FORECAST_URL}?latitude=${geo.latitude}&longitude=${geo.longitude}` +
      `&hourly=temperature_2m,weathercode,precipitation_probability` +
      `&timezone=auto&forecast_days=2`;
    if (geo.countryCode === "KR") {
      const kmaForecast = await fetchHourlyForecastFromUrl(`${baseUrl}&models=kma_seamless`);
      if (kmaForecast && kmaForecast.temperature.some((value) => typeof value === "number")) return kmaForecast;
    }
    return fetchHourlyForecastFromUrl(baseUrl);
  }

  // 아이콘은 텍스트 문구에 섞지 않고 따로 돌려준다 — 호출부(펫 창)가 이모지를 배지 안에
  // 크게 그려서 흰 배경에 묻히는 문제를 UI 쪽에서 해결할 수 있게 하기 위함이다.
  function buildPeriodLine(
    language: string,
    period: typeof DAY_PERIODS[number],
    forecast: HourlyForecast,
    dates: string[]
  ): WeatherLine | null {
    const date = dates[period.dayOffset];
    if (!date) return null;
    const indices = forecast.time
      .map((time, index) => ({ time, index }))
      .filter(({ time }) => {
        if (!time.startsWith(date)) return false;
        const hour = Number(time.slice(11, 13));
        return hour >= period.startHour && hour <= period.endHour;
      })
      .map(({ index }) => index);
    if (indices.length === 0) return null;

    const temps = indices.map((i) => forecast.temperature[i]).filter((v): v is number => typeof v === "number");
    const precips = indices.map((i) => forecast.precip[i]).filter((v): v is number => typeof v === "number");
    const codes = indices.map((i) => forecast.weathercode[i]).filter((v): v is number => typeof v === "number");
    const code = worstCodeInBucket(codes);

    let text = t(language, "weather.dayLine", {
      label: t(language, period.labelKey),
      max: temps.length ? Math.round(Math.max(...temps)) : "?",
      min: temps.length ? Math.round(Math.min(...temps)) : "?"
    });
    if (precips.length) {
      text += t(language, "weather.precipSuffix", { percent: Math.round(Math.max(...precips)) });
    }
    return { icon: weatherCodeToIcon(code), category: weatherCodeToCategory(code), text };
  }

  // 실패해도 예외를 던지지 않고 사용자에게 보여줄 안내 문구를 그대로 돌려준다 —
  // 호출부(알람 발동, 트레이 클릭)가 실패 케이스를 따로 처리할 필요가 없게 하기 위함.
  // lines가 null이면 실패(위치 미설정·조회 실패)라 message만 평문으로 보여주면 된다.
  async function getWeatherBriefing(city: string, language: string): Promise<WeatherBriefing> {
    if (!city.trim()) return { message: t(language, "weather.locationMissing"), lines: null };
    const geo = await geocodeCity(city, language);
    if (!geo) return { message: t(language, "weather.fetchFailed"), lines: null };
    const forecast = await fetchHourlyForecast(geo);
    if (!forecast) return { message: t(language, "weather.fetchFailed"), lines: null };
    const dates = [...new Set(forecast.time.map((time) => time.slice(0, 10)))];
    const lines = DAY_PERIODS
      .map((period) => buildPeriodLine(language, period, forecast, dates))
      .filter((line): line is WeatherLine => line !== null);
    if (lines.length === 0) return { message: t(language, "weather.fetchFailed"), lines: null };
    return { message: lines.map((line) => `${line.icon} ${line.text}`).join("\n"), lines };
  }

  return { getWeatherBriefing, geocodeCity, fetchHourlyForecast };
}

export { createWeatherService, weatherCodeToIcon };
export type { WeatherServiceDeps, WeatherLine, WeatherBriefing, WeatherCategory };

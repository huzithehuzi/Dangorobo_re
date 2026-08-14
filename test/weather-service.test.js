const test = require("node:test");
const assert = require("node:assert/strict");

const { createWeatherService, weatherCodeToIcon } = require("../src/main/weather-service.js");

/** @param {unknown} body */
function jsonResponse(body) {
  return { ok: true, json: async () => body };
}

const GEOCODE_KR = { results: [{ latitude: 37.566, longitude: 126.9784, country_code: "KR" }] };
const GEOCODE_JP = { results: [{ latitude: 35.6762, longitude: 139.6503, country_code: "JP" }] };

const DATES = ["2026-08-14", "2026-08-15"];
const RANGES = [
  { key: "todayMorning", date: DATES[0], start: 6, end: 11 },
  { key: "todayAfternoon", date: DATES[0], start: 12, end: 17 },
  { key: "tomorrowMorning", date: DATES[1], start: 6, end: 11 },
  { key: "tomorrowAfternoon", date: DATES[1], start: 12, end: 17 }
];

/**
 * 48시간(이틀치) hourly 응답을 만든다. periods의 각 구간은 { code, tempMin, precipMax }를
 * 받아 시간마다 값을 조금씩 다르게 채운다(온도는 시작에서 끝까지 1도씩 오르고, 강수확률은
 * 구간 끝에서 precipMax를 찍도록) — max/min을 진짜로 여러 시간 중에서 골라내는지 검증하기
 * 위함이다. 구간에 없는 시간이나 omitPrecip이면 해당 값은 null.
 * @param {Record<string, { code: number, tempMin: number, precipMax: number }>} periods
 * @param {{ omitPrecip?: boolean }} [options]
 */
function buildHourlyResponse(periods, options = {}) {
  const time = [];
  const weathercode = [];
  const temperature_2m = [];
  const precipitation_probability = [];
  for (const date of DATES) {
    for (let hour = 0; hour < 24; hour++) {
      time.push(`${date}T${String(hour).padStart(2, "0")}:00`);
      const range = RANGES.find((r) => r.date === date && hour >= r.start && hour <= r.end);
      const period = range && periods[range.key];
      if (!range || !period) {
        weathercode.push(null);
        temperature_2m.push(null);
        precipitation_probability.push(null);
        continue;
      }
      const offset = hour - range.start;
      weathercode.push(period.code);
      temperature_2m.push(period.tempMin + offset);
      precipitation_probability.push(options.omitPrecip ? null : Math.min(100, period.precipMax - (range.end - hour)));
    }
  }
  return { hourly: { time, weathercode, temperature_2m, precipitation_probability } };
}

function allNullHourlyResponse() {
  const time = [];
  for (const date of DATES) {
    for (let hour = 0; hour < 24; hour++) time.push(`${date}T${String(hour).padStart(2, "0")}:00`);
  }
  const nulls = time.map(() => null);
  return { hourly: { time, weathercode: nulls, temperature_2m: nulls, precipitation_probability: nulls } };
}

/**
 * @param {(url: string) => { ok: boolean, json: () => Promise<unknown> } | null} respond
 */
function createService(respond) {
  const calledUrls = /** @type {string[]} */ ([]);
  const service = createWeatherService({
    fetchImpl: /** @type {any} */ (async (/** @type {string} */ url) => {
      calledUrls.push(String(url));
      const response = respond(String(url));
      if (!response) throw new Error("network down");
      return response;
    }),
    setTimeoutFn: /** @type {any} */ (() => 0),
    clearTimeoutFn: () => {}
  });
  return { service, calledUrls };
}

test("지역이 비어 있으면 fetch 없이 위치 미설정 안내를 돌려준다", async () => {
  const { service, calledUrls } = createService(() => null);
  const briefing = await service.getWeatherBriefing("   ", "ko");
  assert.deepEqual(briefing, { message: "날씨 지역이 설정되지 않았어요. '일반' 탭에서 지역을 입력해주세요.", lines: null });
  assert.deepEqual(calledUrls, []);
});

test("지오코딩 결과가 없으면(오타 등) 실패 안내를 돌려준다", async () => {
  const { service } = createService((url) => (
    url.includes("geocoding-api") ? jsonResponse({ results: [] }) : jsonResponse({})
  ));
  const briefing = await service.getWeatherBriefing("asdkjqwhekjqhwe", "ko");
  assert.deepEqual(briefing, { message: "날씨 정보를 불러오지 못했어요.", lines: null });
});

test("네트워크 요청이 실패해도(예외) 실패 안내로 조용히 처리한다", async () => {
  const { service } = createService(() => null);
  const briefing = await service.getWeatherBriefing("Seoul", "en");
  assert.deepEqual(briefing, { message: "Couldn't fetch the weather.", lines: null });
});

test("일본처럼 KR이 아니면 기본 모델만 조회하고 오늘·내일 오전·오후 4줄을 아이콘·텍스트로 나눠 만든다", async () => {
  const { service, calledUrls } = createService((url) => {
    if (url.includes("geocoding-api")) return jsonResponse(GEOCODE_JP);
    return jsonResponse(buildHourlyResponse({
      todayMorning: { code: 0, tempMin: 24, precipMax: 10 },
      todayAfternoon: { code: 61, tempMin: 20, precipMax: 80 },
      tomorrowMorning: { code: 1, tempMin: 17, precipMax: 5 },
      tomorrowAfternoon: { code: 3, tempMin: 15, precipMax: 90 }
    }));
  });
  const briefing = await service.getWeatherBriefing("Tokyo", "ko");
  assert.deepEqual(briefing.lines, [
    { icon: "☀️", text: "오늘 오전 ▲29° ▼24° (강수 10%)" },
    { icon: "🌧️", text: "오늘 오후 ▲25° ▼20° (강수 80%)" },
    { icon: "⛅", text: "내일 오전 ▲22° ▼17° (강수 5%)" },
    { icon: "☁️", text: "내일 오후 ▲20° ▼15° (강수 90%)" }
  ]);
  // message는 아이콘을 포함한 평문 버전(펫 창이 배지를 못 그리는 경우의 대비책)으로 유지한다.
  assert.equal(
    briefing.message,
    "☀️ 오늘 오전 ▲29° ▼24° (강수 10%)\n🌧️ 오늘 오후 ▲25° ▼20° (강수 80%)\n" +
    "⛅ 내일 오전 ▲22° ▼17° (강수 5%)\n☁️ 내일 오후 ▲20° ▼15° (강수 90%)"
  );
  assert.ok(calledUrls.every((url) => !url.includes("models=")));
});

test("구간 도중 날씨가 궂어지면 강수확률 최고치와 일치하게 가장 궂은 아이콘을 쓴다", async () => {
  // 오전 6~10시는 맑다가(코드 0) 11시에 갑자기 비(코드 61)로 바뀐다 — 강수확률도 11시에
  // 급등. 대표 시각 하나(예: 9시)만 보고 아이콘을 정하면 "강수 100%인데 해가 떴다"는
  // 모순이 생긴다(실측 사용자 보고, 2026-08) — 구간 전체에서 가장 궂은 조건을 써야 한다.
  const time = /** @type {string[]} */ ([]);
  const weathercode = /** @type {Array<number | null>} */ ([]);
  const temperature_2m = /** @type {Array<number | null>} */ ([]);
  const precipitation_probability = /** @type {Array<number | null>} */ ([]);
  for (let hour = 0; hour < 24; hour++) {
    time.push(`2026-08-14T${String(hour).padStart(2, "0")}:00`);
    if (hour >= 6 && hour <= 11) {
      const isLastHour = hour === 11;
      weathercode.push(isLastHour ? 61 : 0);
      temperature_2m.push(20 + (hour - 6));
      precipitation_probability.push(isLastHour ? 100 : 5);
    } else {
      weathercode.push(null);
      temperature_2m.push(null);
      precipitation_probability.push(null);
    }
  }
  const { service } = createService((url) => (
    url.includes("geocoding-api")
      ? jsonResponse(GEOCODE_JP)
      : jsonResponse({ hourly: { time, weathercode, temperature_2m, precipitation_probability } })
  ));
  const briefing = await service.getWeatherBriefing("Tokyo", "ko");
  const todayMorning = briefing.lines?.[0];
  assert.ok(todayMorning, "오늘 오전 줄이 있어야 한다");
  assert.equal(todayMorning.icon, "🌧️");
  assert.equal(todayMorning.text, "오늘 오전 ▲25° ▼20° (강수 100%)");
});

test("대한민국은 kma_seamless 모델을 먼저 요청하고, 값이 있으면 그걸 쓴다", async () => {
  const { service, calledUrls } = createService((url) => {
    if (url.includes("geocoding-api")) return jsonResponse(GEOCODE_KR);
    if (url.includes("models=kma_seamless")) {
      // kma_seamless는 강수확률을 안 줄 때가 있다(실측) — omitPrecip으로 그 상황을 흉내낸다.
      return jsonResponse(buildHourlyResponse({
        todayMorning: { code: 3, tempMin: 20, precipMax: 0 },
        todayAfternoon: { code: 3, tempMin: 21, precipMax: 0 },
        tomorrowMorning: { code: 3, tempMin: 22, precipMax: 0 },
        tomorrowAfternoon: { code: 3, tempMin: 23, precipMax: 0 }
      }, { omitPrecip: true }));
    }
    // 기본 모델(폴백)이 불렸다면 kma 결과와 확실히 구별되는 값을 준다.
    return jsonResponse(buildHourlyResponse({
      todayMorning: { code: 0, tempMin: 99, precipMax: 0 },
      todayAfternoon: { code: 0, tempMin: 99, precipMax: 0 },
      tomorrowMorning: { code: 0, tempMin: 99, precipMax: 0 },
      tomorrowAfternoon: { code: 0, tempMin: 99, precipMax: 0 }
    }));
  });
  const briefing = await service.getWeatherBriefing("Seoul", "ko");
  // kma_seamless 값(20~28)을 썼는지, precip이 없어 강수 문구가 빠졌는지 함께 확인.
  assert.deepEqual(briefing.lines, [
    { icon: "☁️", text: "오늘 오전 ▲25° ▼20°" },
    { icon: "☁️", text: "오늘 오후 ▲26° ▼21°" },
    { icon: "☁️", text: "내일 오전 ▲27° ▼22°" },
    { icon: "☁️", text: "내일 오후 ▲28° ▼23°" }
  ]);
  assert.ok(calledUrls.some((url) => url.includes("models=kma_seamless")));
});

test("kma_seamless가 전부 null이면(모델 미제공 시각) 기본 모델로 물러난다", async () => {
  const { service } = createService((url) => {
    if (url.includes("geocoding-api")) return jsonResponse(GEOCODE_KR);
    if (url.includes("models=kma_seamless")) return jsonResponse(allNullHourlyResponse());
    return jsonResponse(buildHourlyResponse({
      todayMorning: { code: 1, tempMin: 21, precipMax: 40 },
      todayAfternoon: { code: 1, tempMin: 22, precipMax: 45 },
      tomorrowMorning: { code: 2, tempMin: 23, precipMax: 50 },
      tomorrowAfternoon: { code: 2, tempMin: 24, precipMax: 55 }
    }));
  });
  const briefing = await service.getWeatherBriefing("Seoul", "ko");
  assert.deepEqual(briefing.lines, [
    { icon: "⛅", text: "오늘 오전 ▲26° ▼21° (강수 40%)" },
    { icon: "⛅", text: "오늘 오후 ▲27° ▼22° (강수 45%)" },
    { icon: "⛅", text: "내일 오전 ▲28° ▼23° (강수 50%)" },
    { icon: "⛅", text: "내일 오후 ▲29° ▼24° (강수 55%)" }
  ]);
});

test("'도 시' 형태는 그대로 못 찾으면 도를 뗀 시 이름으로 재시도한다", async () => {
  const { service, calledUrls } = createService((url) => {
    if (url.includes(encodeURIComponent("경기도 성남시"))) return jsonResponse({ results: [] });
    if (url.includes(encodeURIComponent("성남시")) && url.includes("language=ko")) return jsonResponse(GEOCODE_KR);
    return jsonResponse({ results: [] });
  });
  const geo = await service.geocodeCity("경기도 성남시", "ko");
  assert.deepEqual(geo, { latitude: 37.566, longitude: 126.9784, countryCode: "KR" });
  // 직접 조회(ko) 실패 → en 재시도 실패 → "성남시"(ko) 재시도 성공, 총 3회.
  assert.equal(calledUrls.length, 3);
});

test("광역시 축약형(서울 등)은 못 찾으면 정식 명칭으로 재시도한다", async () => {
  const { service, calledUrls } = createService((url) => {
    if (url.includes(encodeURIComponent("서울특별시"))) return jsonResponse(GEOCODE_KR);
    return jsonResponse({ results: [] });
  });
  const geo = await service.geocodeCity("서울", "ko");
  assert.deepEqual(geo, { latitude: 37.566, longitude: 126.9784, countryCode: "KR" });
  assert.equal(calledUrls.length, 3);
});

test("'시/도 구' 형태는 구를 떼어 재시도하지 않는다(동명 지역 오검색 방지)", async () => {
  const { service, calledUrls } = createService(() => jsonResponse({ results: [] }));
  const geo = await service.geocodeCity("서울특별시 강남구", "ko");
  assert.equal(geo, null);
  // 직접(ko) + en 재시도, 총 2회 — "강남구"만 떼어 다시 부르지는 않는다.
  assert.equal(calledUrls.length, 2);
});

test("앱 언어가 영어여도 한글 지명은 language=ko로 재시도해서 찾는다", async () => {
  const { service, calledUrls } = createService((url) => {
    if (url.includes("language=ko")) return jsonResponse(GEOCODE_KR);
    return jsonResponse({ results: [] });
  });
  const geo = await service.geocodeCity("성남시", "en");
  assert.deepEqual(geo, { latitude: 37.566, longitude: 126.9784, countryCode: "KR" });
  // 직접(en) 실패 → ko 재시도 성공. en은 이미 시도했으니 fallback 목록에서 건너뛴다.
  assert.equal(calledUrls.length, 2);
});

test("앱 언어가 한국어여도 영문 지명은 language=en으로 재시도해서 찾는다", async () => {
  const { service, calledUrls } = createService((url) => {
    if (url.includes("language=en")) return jsonResponse(GEOCODE_JP);
    return jsonResponse({ results: [] });
  });
  const geo = await service.geocodeCity("Osaka", "ko");
  assert.deepEqual(geo, { latitude: 35.6762, longitude: 139.6503, countryCode: "JP" });
  assert.equal(calledUrls.length, 2);
});

test("weatherCodeToIcon은 WMO 코드를 이모지 카테고리로 매핑한다", () => {
  assert.equal(weatherCodeToIcon(0), "☀️");
  assert.equal(weatherCodeToIcon(2), "⛅");
  assert.equal(weatherCodeToIcon(3), "☁️");
  assert.equal(weatherCodeToIcon(45), "🌫️");
  assert.equal(weatherCodeToIcon(55), "🌦️");
  assert.equal(weatherCodeToIcon(65), "🌧️");
  assert.equal(weatherCodeToIcon(75), "❄️");
  assert.equal(weatherCodeToIcon(96), "⛈️");
  assert.equal(weatherCodeToIcon(null), "☁️");
});

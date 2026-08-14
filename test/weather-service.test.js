const test = require("node:test");
const assert = require("node:assert/strict");

const { createWeatherService, weatherCodeToIcon } = require("../src/main/weather-service.js");

/** @param {unknown} body */
function jsonResponse(body) {
  return { ok: true, json: async () => body };
}

const GEOCODE_KR = { results: [{ latitude: 37.566, longitude: 126.9784, country_code: "KR" }] };
const GEOCODE_JP = { results: [{ latitude: 35.6762, longitude: 139.6503, country_code: "JP" }] };

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
  const message = await service.getWeatherBriefing("   ", "ko");
  assert.equal(message, "날씨 지역이 설정되지 않았어요. '일반' 탭에서 지역을 입력해주세요.");
  assert.deepEqual(calledUrls, []);
});

test("지오코딩 결과가 없으면(오타 등) 실패 안내를 돌려준다", async () => {
  const { service } = createService((url) => (
    url.includes("geocoding-api") ? jsonResponse({ results: [] }) : jsonResponse({})
  ));
  assert.equal(await service.getWeatherBriefing("asdkjqwhekjqhwe", "ko"), "날씨 정보를 불러오지 못했어요.");
});

test("네트워크 요청이 실패해도(예외) 실패 안내로 조용히 처리한다", async () => {
  const { service } = createService(() => null);
  assert.equal(await service.getWeatherBriefing("Seoul", "en"), "Couldn't fetch the weather.");
});

test("일본처럼 KR이 아니면 기본 모델만 조회하고 오늘·내일 문장을 만든다", async () => {
  const { service, calledUrls } = createService((url) => {
    if (url.includes("geocoding-api")) return jsonResponse(GEOCODE_JP);
    return jsonResponse({
      daily: {
        time: ["2026-08-14", "2026-08-15"],
        weathercode: [0, 61],
        temperature_2m_max: [29.4, 24.6],
        temperature_2m_min: [23.1, 20.9],
        precipitation_probability_max: [10, 80]
      }
    });
  });
  const message = await service.getWeatherBriefing("Tokyo", "ko");
  assert.equal(message, "오늘 ☀️ 최고 29°/최저 23° (강수 10%)\n내일 🌧️ 최고 25°/최저 21° (강수 80%)");
  assert.ok(calledUrls.every((url) => !url.includes("models=")));
});

test("대한민국은 kma_seamless 모델을 먼저 요청하고, 값이 있으면 그걸 쓴다", async () => {
  const { service, calledUrls } = createService((url) => {
    if (url.includes("geocoding-api")) return jsonResponse(GEOCODE_KR);
    if (url.includes("models=kma_seamless")) {
      return jsonResponse({
        daily: {
          time: ["2026-08-14", "2026-08-15"],
          weathercode: [3, 3],
          temperature_2m_max: [27, 28],
          temperature_2m_min: [22, 23],
          precipitation_probability_max: [null, null]
        }
      });
    }
    // 기본 모델(폴백)이 불렸다면 kma 결과와 확실히 구별되는 값을 준다.
    return jsonResponse({
      daily: {
        time: ["2026-08-14", "2026-08-15"],
        weathercode: [0, 0],
        temperature_2m_max: [99, 99],
        temperature_2m_min: [99, 99],
        precipitation_probability_max: [0, 0]
      }
    });
  });
  const message = await service.getWeatherBriefing("Seoul", "ko");
  // kma_seamless 값(27/22)을 썼는지, precip이 null이라 강수 문구가 빠졌는지 함께 확인.
  assert.equal(message, "오늘 ☁️ 최고 27°/최저 22°\n내일 ☁️ 최고 28°/최저 23°");
  assert.ok(calledUrls.some((url) => url.includes("models=kma_seamless")));
});

test("kma_seamless가 전부 null이면(모델 미제공 시각) 기본 모델로 물러난다", async () => {
  const { service } = createService((url) => {
    if (url.includes("geocoding-api")) return jsonResponse(GEOCODE_KR);
    if (url.includes("models=kma_seamless")) {
      return jsonResponse({
        daily: {
          time: ["2026-08-14", "2026-08-15"],
          weathercode: [null, null],
          temperature_2m_max: [null, null],
          temperature_2m_min: [null, null],
          precipitation_probability_max: [null, null]
        }
      });
    }
    return jsonResponse({
      daily: {
        time: ["2026-08-14", "2026-08-15"],
        weathercode: [1, 2],
        temperature_2m_max: [26, 27],
        temperature_2m_min: [21, 22],
        precipitation_probability_max: [40, 50]
      }
    });
  });
  const message = await service.getWeatherBriefing("Seoul", "ko");
  assert.equal(message, "오늘 ⛅ 최고 26°/최저 21° (강수 40%)\n내일 ⛅ 최고 27°/최저 22° (강수 50%)");
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

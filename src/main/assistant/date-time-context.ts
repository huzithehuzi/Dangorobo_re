// 프롬프트에 들어가는 "지금 몇 시" 블록. **앱 언어로 만들어야 한다** — 이 블록만 한국어로
// 남아 있으면, 사용자 언어를 참고할 수 없는 상황(펫이 먼저 말을 거는 부르기·쓰다듬기·자동
// 말걸기)에서 모델이 프롬프트에 유일하게 섞인 그 자연어의 언어로 답한다. 영어·일본어 환경에서
// 펫이 한국어로 말하던 원인이었다(2026-08-20).
const { t } = require("../../shared/i18n.js");

const DATE_TIME_LOCALES: Record<string, string> = { ko: "ko-KR", en: "en-US", ja: "ja-JP" };

function formatUtcOffset(offsetMinutes: number): string {
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteMinutes = Math.abs(offsetMinutes);
  const hours = String(Math.floor(absoluteMinutes / 60)).padStart(2, "0");
  const minutes = String(absoluteMinutes % 60).padStart(2, "0");
  return `UTC${sign}${hours}:${minutes}`;
}

function currentDateTimeContext(now: Date | string | number = new Date(), language = "ko"): string {
  const date = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.getTime())) throw new TypeError("A valid date is required.");

  const resolved = Intl.DateTimeFormat().resolvedOptions();
  const timeZone = resolved.timeZone || t(language, "assistant.dateTimeZoneUnknown");
  const locale = DATE_TIME_LOCALES[language] || DATE_TIME_LOCALES.en;
  const localText = new Intl.DateTimeFormat(locale, { dateStyle: "full", timeStyle: "medium" }).format(date);
  const utcOffset = formatUtcOffset(-date.getTimezoneOffset());

  return [
    t(language, "assistant.dateTimeLocalLine", { value: localText }),
    t(language, "assistant.dateTimeZoneLine", { zone: timeZone, offset: utcOffset }),
    t(language, "assistant.dateTimeUtcLine", { value: date.toISOString() })
  ].join("\n");
}

export { currentDateTimeContext, formatUtcOffset };

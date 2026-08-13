function formatUtcOffset(offsetMinutes: number): string {
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteMinutes = Math.abs(offsetMinutes);
  const hours = String(Math.floor(absoluteMinutes / 60)).padStart(2, "0");
  const minutes = String(absoluteMinutes % 60).padStart(2, "0");
  return `UTC${sign}${hours}:${minutes}`;
}

function currentDateTimeContext(now: Date | string | number = new Date()): string {
  const date = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.getTime())) throw new TypeError("A valid date is required.");

  const resolved = Intl.DateTimeFormat().resolvedOptions();
  const timeZone = resolved.timeZone || "시스템 현지 시간대";
  const localDateText = new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long"
  }).format(date);
  const localHour = date.getHours();
  const period = localHour < 12 ? "오전" : "오후";
  const displayHour = localHour % 12 || 12;
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  const localText = `${localDateText} ${period} ${displayHour}시 ${minutes}분 ${seconds}초`;
  const utcOffset = formatUtcOffset(-date.getTimezoneOffset());

  return [
    `현재 PC 기준 날짜·시각: ${localText}`,
    `현재 PC 시간대: ${timeZone} (${utcOffset})`,
    `UTC 기준 시각: ${date.toISOString()}`
  ].join("\n");
}

export { currentDateTimeContext, formatUtcOffset };

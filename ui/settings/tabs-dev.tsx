// 개발자 탭(2026-08-15): 설정창 제목을 5번 클릭해야 나타나는 숨김 탭.
// 여기 있는 값은 Draft/설정 저장과 무관한 세션 전용 상태라 useSettings()의 d/set을 쓰지 않는다.
import { useState } from "react";
import { useSettings } from "./App";
import { Note, ToggleRow } from "./rows";

const EXPRESSION_KEYS = [
  "normal", "normal_blink", "happy", "angry", "sad", "alarm", "shocked"
] as const;

export function DevTab() {
  const { tt } = useSettings();
  const [forcedExpression, setForcedExpression] = useState<string | null>(null);
  const [debugOverlayEnabled, setDebugOverlayEnabled] = useState(false);

  const applyForcedExpression = (key: string | null) => {
    setForcedExpression(key);
    window.desktopPet.forceExpression(key);
  };

  return (
    <>
      <Note>{tt("settings.dev.subtitle")}</Note>
      <div className="settings-group">
        <h2>{tt("settings.dev.expressionHeading")}</h2>
        <Note>{tt("settings.dev.expressionNote")}</Note>
        <div className="button-row">
          <button
            type="button"
            className={forcedExpression === null ? "secondary-action active" : "secondary-action"}
            onClick={() => applyForcedExpression(null)}
          >
            {tt("settings.dev.expression.none")}
          </button>
          {EXPRESSION_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              className={forcedExpression === key ? "secondary-action active" : "secondary-action"}
              onClick={() => applyForcedExpression(key)}
            >
              {tt(`settings.dev.expression.${key}`)}
            </button>
          ))}
        </div>
      </div>
      <div className="settings-group">
        <h2>{tt("settings.dev.alertsHeading")}</h2>
        <Note>{tt("settings.dev.alertsNote")}</Note>
        <div className="button-row">
          <button type="button" className="secondary-action" onClick={() => window.desktopPet.testAlarm()}>
            {tt("settings.dev.testRestButton")}
          </button>
          <button type="button" className="secondary-action" onClick={() => window.desktopPet.testWeatherBriefing()}>
            {tt("settings.dev.testWeatherButton")}
          </button>
        </div>
      </div>
      <div className="settings-group">
        <h2>{tt("settings.dev.overlayHeading")}</h2>
        <ToggleRow
          checked={debugOverlayEnabled}
          onChange={(checked) => {
            setDebugOverlayEnabled(checked);
            window.desktopPet.setDebugOverlay(checked);
          }}
          label={tt("settings.dev.overlayToggle")}
        />
        <Note>{tt("settings.dev.overlayNote")}</Note>
      </div>
    </>
  );
}

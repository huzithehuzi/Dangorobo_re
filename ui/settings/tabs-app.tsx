// 앱 그룹 탭: 일반 / UI / 트레이 (2026-08-10, 바닐라 settings.js 포팅).
import { useSettings } from "./App";
import { ColorField } from "./components";
import { NumberRow, Note, SelectRow, SettingRow, TextField, ToggleRow } from "./rows";
import { BUBBLE_THEMES, CLICK_SOUND_OPTIONS } from "./store";
// 입력 범위와 저장 전 미리보기의 클램프는 같아야 한다 — 어긋나면 창은 그 배율로 커지는데
// 저장은 HTML 검증에 막힌다. 두 값의 원본은 창 공용 외형 모듈이다.
import {
  UI_FONT_SIZE_MAX_PERCENT, UI_FONT_SIZE_MIN_PERCENT,
  UI_SCALE_MAX_PERCENT, UI_SCALE_MIN_PERCENT
} from "../lib/appearance";

/* WCAG 상대 휘도 → 대비비. 커스텀 테마에서 안 보이는 글씨색·배경색 조합을 막지는 않되
   경고만 띄운다(4.5:1 = AA 본문 기준). */
function relativeLuminance(hex: string): number | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || "").trim());
  if (!m) return null;
  const channel = (v: string) => {
    const c = parseInt(v, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(m[1]) + 0.7152 * channel(m[2]) + 0.0722 * channel(m[3]);
}

export function GeneralTab() {
  const s = useSettings();
  const { d, set, tt } = s;
  // API 키 존재 여부에 따라 대화 탭의 "질문 기능 사용"이 켜질 수 있는지 정해진다.
  const keyWillExist = !d.assistantClearApiKey && (s.storedAssistantKey || d.assistantApiKey.trim().length > 0);
  const syncAssistantEnabled = (nextKey: string, nextClear: boolean) => {
    const willExist = !nextClear && (s.storedAssistantKey || nextKey.trim().length > 0);
    if (!willExist && d.assistantEnabled) set("assistantEnabled", false);
  };

  return (
    <>
      <div className="settings-group">
        <h2>{tt("settings.general.languageLabel")}</h2>
        <SelectRow
          label={tt("settings.general.languageLabel")}
          value={d.language}
          onChange={(value) => set("language", window.PetI18n.normalizeLanguage(value))}
          options={[{ value: "ko", label: "한국어" }, { value: "en", label: "English" }, { value: "ja", label: "日本語" }]}
        />
        <Note>{tt("settings.general.languageNote")}</Note>
      </div>
      <div className="settings-group">
        <h2>{tt("settings.general.apiKeyHeading")}</h2>
        <label className="text-field">
          <span>{tt("settings.general.apiKeyLabel")}</span>
          <input
            type="password"
            maxLength={300}
            autoComplete="off"
            placeholder={tt("settings.general.apiKeyPlaceholder")}
            value={d.assistantApiKey}
            disabled={d.assistantClearApiKey}
            onChange={(event) => {
              set("assistantApiKey", event.target.value);
              syncAssistantEnabled(event.target.value, d.assistantClearApiKey);
            }}
          />
        </label>
        {/* 바닐라는 대화 탭의 모델 필드를 로드 후 이 그룹으로 옮겼다(relocate) — 처음부터 여기 그린다 */}
        <TextField
          label={tt("settings.conversation.modelLabel")}
          value={d.assistantGeminiModel}
          maxLength={80}
          onChange={(value) => set("assistantGeminiModel", value)}
        />
        <div className={`setting-note ${keyWillExist ? "ready" : "missing"}`}>
          {keyWillExist ? tt("settings.general.apiKeyReady") : tt("settings.general.apiKeyMissing")}
        </div>
        <ToggleRow
          compact
          checked={d.assistantClearApiKey}
          onChange={(checked) => {
            set("assistantClearApiKey", checked);
            syncAssistantEnabled(d.assistantApiKey, checked);
          }}
          label={tt("settings.general.clearKeyLabel")}
        />
        <Note>{tt("settings.general.apiKeyNote")}</Note>
        <Note html={tt("settings.general.apiKeyGetLink")} />
      </div>
      <div className="settings-group">
        <h2>{tt("settings.general.weatherHeading")}</h2>
        <TextField
          label={tt("settings.general.weatherCityLabel")}
          value={d.weatherCity}
          maxLength={60}
          placeholder={tt("settings.general.weatherCityPlaceholder")}
          onChange={(value) => set("weatherCity", value)}
        />
        <Note>{tt("settings.general.weatherCityNote")}</Note>
      </div>
      <div className="settings-group">
        <h2>{tt("settings.general.dndHeading")}</h2>
        <ToggleRow checked={d.fullscreenDndEnabled} onChange={(checked) => set("fullscreenDndEnabled", checked)} label={tt("settings.general.dndToggle")} />
        <Note>{tt("settings.general.dndNote")}</Note>
      </div>
      <div className="settings-group">
        <h2>{tt("settings.general.dragModeHeading")}</h2>
        <SelectRow
          label={tt("settings.general.dragModeLabel")}
          value={d.petDragMode}
          onChange={(value) => set("petDragMode", value)}
          options={[
            { value: "always", label: tt("settings.general.dragModeAlways") },
            { value: "toggle", label: tt("settings.general.dragModeToggle") }
          ]}
        />
        <Note html={tt("settings.general.dragModeNote")} />
      </div>
      <div className="settings-group">
        <h2>{tt("settings.general.backupHeading")}</h2>
        <div className="alarm-add-form">
          <button
            className="secondary-action"
            type="button"
            onClick={async () => {
              s.clearError();
              const result = await window.desktopPet.exportAllSettings();
              if (result?.ok === false && !result.canceled) {
                s.showError(result.error || tt("customization.exportFailedError"));
              }
            }}
          >
            {tt("settings.general.backupExportButton")}
          </button>
          <button
            className="secondary-action"
            type="button"
            onClick={async () => {
              s.clearError();
              const result = await window.desktopPet.importAllSettings();
              if (result?.ok === false) {
                if (!result.canceled) {
                  const error = result.error || tt("settingsBackup.invalidFileError");
                  s.showError(result.recoveryIncomplete
                    ? `${error} ${tt("settings.footer.recoveryIncomplete")}`
                    : error);
                }
                return;
              }
              // 가져오기는 main에서 이미 적용·저장까지 끝났으므로 폼만 그 결과로 다시 채운다.
              if (result) s.applyLoaded(result as Record<string, unknown>);
            }}
          >
            {tt("settings.general.backupImportButton")}
          </button>
        </div>
        <Note>{tt("settings.general.backupNote")}</Note>
      </div>
      <div className="settings-group">
        <h2>{tt("settings.general.documentSummaryHeading")}</h2>
        <div className="alarm-add-form">
          <button className="secondary-action" type="button" onClick={() => window.desktopPet.openSummaryFolder()}>
            {tt("settings.general.openSummaryFolderButton")}
          </button>
        </div>
        <Note>{tt("settings.general.documentSummaryNote")}</Note>
      </div>
      <div className="settings-group">
        <h2>{tt("settings.general.clickSoundHeading")}</h2>
        <Note>{tt("settings.general.clickSoundNote")}</Note>
        <ToggleRow checked={d.keyboardClickEnabled} onChange={(checked) => set("keyboardClickEnabled", checked)} label={tt("settings.general.keyboardClickToggle")} />
        <SelectRow
          label={tt("settings.general.clickSoundLabel")}
          value={d.keyboardClickSound}
          onChange={(value) => set("keyboardClickSound", value)}
          options={CLICK_SOUND_OPTIONS.map((n) => ({ value: String(n), label: tt("settings.alerts.soundOption", { n, value: n }) }))}
        />
        <NumberRow label={tt("settings.general.clickVolumeLabel")} value={d.keyboardClickVolume} onChange={(value) => set("keyboardClickVolume", value)} min={0} max={100} step={5} unit="%" />
        <NumberRow label={tt("settings.general.clickMinPitchLabel")} value={d.keyboardClickMinPitch} onChange={(value) => set("keyboardClickMinPitch", value)} min={50} max={200} step={5} unit="%" />
        <NumberRow label={tt("settings.general.clickMaxPitchLabel")} value={d.keyboardClickMaxPitch} onChange={(value) => set("keyboardClickMaxPitch", value)} min={50} max={200} step={5} unit="%" />
        <hr className="settings-divider" />
        <ToggleRow checked={d.mouseClickEnabled} onChange={(checked) => set("mouseClickEnabled", checked)} label={tt("settings.general.mouseClickToggle")} />
        <SelectRow
          label={tt("settings.general.clickSoundLabel")}
          value={d.mouseClickSound}
          onChange={(value) => set("mouseClickSound", value)}
          options={CLICK_SOUND_OPTIONS.map((n) => ({ value: String(n), label: tt("settings.alerts.soundOption", { n, value: n }) }))}
        />
        <NumberRow label={tt("settings.general.clickVolumeLabel")} value={d.mouseClickVolume} onChange={(value) => set("mouseClickVolume", value)} min={0} max={100} step={5} unit="%" />
        <NumberRow label={tt("settings.general.clickMinPitchLabel")} value={d.mouseClickMinPitch} onChange={(value) => set("mouseClickMinPitch", value)} min={50} max={200} step={5} unit="%" />
        <NumberRow label={tt("settings.general.clickMaxPitchLabel")} value={d.mouseClickMaxPitch} onChange={(value) => set("mouseClickMaxPitch", value)} min={50} max={200} step={5} unit="%" />
      </div>
    </>
  );
}

export function UiTab() {
  const s = useSettings();
  const { d, set, tt } = s;
  const bgLum = relativeLuminance(d.bubbleThemeCustomBg);
  const textLum = relativeLuminance(d.bubbleThemeCustomText);
  const contrastLow =
    d.bubbleTheme === "custom" && bgLum !== null && textLum !== null &&
    (Math.max(bgLum, textLum) + 0.05) / (Math.min(bgLum, textLum) + 0.05) < 4.5;

  const recommendedFamilies = new Set(["malgun gothic", "gulim", "batang", "gungsuh"]);
  const installedOptions = s.installedFonts
    .filter((family) => !recommendedFamilies.has(String(family).toLocaleLowerCase()))
    .map((family) => ({ value: `local:${family}`, label: family }));
  const selectedUnavailable =
    d.uiFontPreset.startsWith("local:") && !installedOptions.some((option) => option.value === d.uiFontPreset);

  return (
    <>
      <div className="settings-group">
        <h2>{tt("settings.ui.bubbleHeading")}</h2>
        <SelectRow
          label={tt("settings.ui.bubbleThemeLabel")}
          value={d.bubbleTheme}
          onChange={(value) => s.previewBubbleThemeNow({ bubbleTheme: value })}
          options={BUBBLE_THEMES.map((theme) => ({ value: theme.id, label: tt(theme.labelKey) }))}
        />
        <Note>{tt("settings.ui.bubbleThemeNote")}</Note>
        {d.bubbleTheme === "custom" && (
          <div>
            <SettingRow asDiv label={tt("settings.ui.customBgLabel")}>
              <ColorField
                value={d.bubbleThemeCustomBg}
                placeholder="#20232b"
                onPreview={(hex) => s.previewBubbleThemeNow({ bubbleThemeCustomBg: hex })}
                onCommit={(hex) => {
                  s.previewBubbleThemeNow({ bubbleThemeCustomBg: hex });
                  s.markDirty();
                }}
              />
            </SettingRow>
            <SettingRow asDiv label={tt("settings.ui.customAccentLabel")}>
              <ColorField
                value={d.bubbleThemeCustomAccent}
                placeholder="#d75566"
                onPreview={(hex) => s.previewBubbleThemeNow({ bubbleThemeCustomAccent: hex })}
                onCommit={(hex) => {
                  s.previewBubbleThemeNow({ bubbleThemeCustomAccent: hex });
                  s.markDirty();
                }}
              />
            </SettingRow>
            <SettingRow asDiv label={tt("settings.ui.customTextLabel")}>
              <ColorField
                value={d.bubbleThemeCustomText}
                placeholder="#f7f7f9"
                onPreview={(hex) => s.previewBubbleThemeNow({ bubbleThemeCustomText: hex })}
                onCommit={(hex) => {
                  s.previewBubbleThemeNow({ bubbleThemeCustomText: hex });
                  s.markDirty();
                }}
              />
            </SettingRow>
            {contrastLow && <Note className="missing">{tt("settings.ui.customContrastWarning")}</Note>}
          </div>
        )}
      </div>
      <div className="settings-group">
        <h2>{tt("settings.ui.fontHeading")}</h2>
        <ToggleRow checked={d.uiFontEnabled} onChange={(checked) => set("uiFontEnabled", checked)} label={tt("settings.ui.fontToggle")} />
        <SettingRow label={tt("settings.ui.fontPresetLabel")}>
          <select value={d.uiFontPreset} disabled={!d.uiFontEnabled} onChange={(event) => set("uiFontPreset", event.target.value)}>
            <optgroup label={tt("settings.ui.fontRecommendedGroup")}>
              <option value="malgun">맑은 고딕</option>
              <option value="gulim">굴림</option>
              <option value="batang">바탕</option>
              <option value="gungsuh">궁서</option>
              <option value="monospace">고정폭</option>
            </optgroup>
            <optgroup label={tt("settings.ui.fontInstalledGroup")}>
              {selectedUnavailable && (
                <option value={d.uiFontPreset}>{tt("font.unavailableSuffix", { name: d.uiFontPreset.slice(6) })}</option>
              )}
              {installedOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </optgroup>
          </select>
        </SettingRow>
        <NumberRow label={tt("settings.ui.fontSizeLabel")} value={d.uiFontSizePercent} onChange={(value) => set("uiFontSizePercent", value)} min={UI_FONT_SIZE_MIN_PERCENT} max={UI_FONT_SIZE_MAX_PERCENT} step={5} unit="%" />
        <NumberRow label={tt("settings.ui.scaleLabel")} value={d.uiScalePercent} onChange={(value) => set("uiScalePercent", value)} min={UI_SCALE_MIN_PERCENT} max={UI_SCALE_MAX_PERCENT} step={5} unit="%" />
        <Note>{tt("settings.ui.scaleNote")}</Note>
      </div>
    </>
  );
}

const TRAY_ITEMS = [
  { key: "showHidePet", labelKey: "settings.tray.item.showHidePet" },
  { key: "moveMode", labelKey: "settings.tray.item.moveMode" },
  { key: "alarmCountdown", labelKey: "settings.tray.item.alarmCountdown" },
  { key: "qaLogs", labelKey: "settings.tray.item.qaLogs" },
  { key: "checklist", labelKey: "settings.tray.item.checklist" },
  { key: "assistant", labelKey: "settings.tray.item.assistant" },
  { key: "favorites", labelKey: "settings.tray.item.favorites" },
  { key: "autoStart", labelKey: "settings.tray.item.autoStart" },
  { key: "weather", labelKey: "settings.tray.item.weather" }
];

export function TrayTab() {
  const s = useSettings();
  const { d, set, tt } = s;
  return (
    <>
      <div className="settings-group">
        <h2>{tt("settings.tray.heading")}</h2>
        <Note>{tt("settings.tray.note")}</Note>
      </div>
      <div className="settings-group">
        <h2>{tt("settings.tray.visibleItemsHeading")}</h2>
        {TRAY_ITEMS.map((item) => (
          <ToggleRow
            key={item.key}
            checked={d.trayMenuItems[item.key] !== false}
            onChange={(checked) => set("trayMenuItems", { ...d.trayMenuItems, [item.key]: checked })}
            label={tt(item.labelKey)}
          />
        ))}
      </div>
      <div className="settings-group">
        <h2>{tt("settings.tray.favoritesHeading")}</h2>
        <ToggleRow
          checked={d.favoritesLayoutGrid}
          disabled={!d.favoritesEnabled}
          onChange={(checked) => set("favoritesLayoutGrid", checked)}
          label={tt("settings.favorites.gridToggle")}
        />
        <ToggleRow
          checked={d.favoritesTrayItemsEnabled}
          disabled={!d.favoritesEnabled}
          onChange={(checked) => set("favoritesTrayItemsEnabled", checked)}
          label={tt("settings.favorites.trayItemsToggle")}
        />
        <Note>{tt("settings.favorites.trayItemsNote")}</Note>
      </div>
    </>
  );
}

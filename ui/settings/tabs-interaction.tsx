// 알람과 조작 그룹 탭: 알람 / 단축키 / 바로가기 / 플레이어 (2026-08-10, 바닐라 settings.js 포팅).
import { useEffect, useRef, useState } from "react";
import { useSettings } from "./App";
import { ColorField, ShortcutRecorder } from "./components";
import { NumberRow, Note, SelectRow, SettingRow, ToggleRow } from "./rows";
import { ALARM_SOUND_OPTIONS, FAVORITE_ITEM_LIMIT, WEEKDAY_KEYS, Draft } from "./store";

function fileBaseName(filePath: string): string {
  return String(filePath || "").split(/[\\/]/).pop() || "";
}

export function AlertsTab() {
  const s = useSettings();
  const { d, set, tt } = s;
  // 알람 추가/편집 폼 상태 — 바닐라의 폼 입력 + editingAlarmId + selectedDailyDays.
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [type, setType] = useState("interval");
  const [intervalValue, setIntervalValue] = useState("60");
  const [hourlyValue, setHourlyValue] = useState("1");
  const [dailyValue, setDailyValue] = useState("15:00");
  const [onceValue, setOnceValue] = useState("30");
  const [selectedDays, setSelectedDays] = useState<Set<number>>(() => new Set([0, 1, 2, 3, 4, 5, 6]));
  const [pendingSoundFile, setPendingSoundFile] = useState("");
  const [editingAlarmId, setEditingAlarmId] = useState<string | null>(null);

  const resetForm = () => {
    setEditingAlarmId(null);
    setTitle("");
    setMessage("");
    setType("interval");
    setIntervalValue("60");
    setHourlyValue("1");
    setDailyValue("15:00");
    setOnceValue("30");
    setSelectedDays(new Set([0, 1, 2, 3, 4, 5, 6]));
    setPendingSoundFile("");
  };

  const enterEditMode = (alarm: AlarmItem) => {
    setEditingAlarmId(alarm.id);
    setTitle(alarm.title || "");
    setMessage(alarm.message || "");
    setType(alarm.type);
    if (alarm.type === "interval") setIntervalValue(String(alarm.intervalMinutes ?? 60));
    if (alarm.type === "hourly") setHourlyValue(String(alarm.hourlyInterval ?? 1));
    if (alarm.type === "daily") {
      setDailyValue(alarm.dailyTime || "15:00");
      const days = Array.isArray(alarm.daysOfWeek) && alarm.daysOfWeek.length ? alarm.daysOfWeek : [0, 1, 2, 3, 4, 5, 6];
      setSelectedDays(new Set(days));
    }
    if (alarm.type === "once") {
      const remainMs = new Date(alarm.fireAt || 0).getTime() - Date.now();
      setOnceValue(String(Math.min(1440, Math.max(1, Math.round(remainMs / 60000) || 30))));
    }
    setPendingSoundFile(alarm.soundFile || "");
  };

  const scheduleLabel = (alarm: AlarmItem): string => {
    if (alarm.type === "interval") return tt("settings.alerts.scheduleInterval", { minutes: alarm.intervalMinutes ?? 0 });
    if (alarm.type === "hourly") {
      const hours = alarm.hourlyInterval ?? 1;
      return hours === 1
        ? tt("settings.alerts.scheduleHourly")
        : tt("settings.alerts.scheduleHourlyEvery", { hours });
    }
    if (alarm.type === "daily") {
      const days = Array.isArray(alarm.daysOfWeek) && alarm.daysOfWeek.length ? alarm.daysOfWeek : [0, 1, 2, 3, 4, 5, 6];
      if (days.length === 7) return tt("settings.alerts.scheduleDaily", { time: alarm.dailyTime ?? "" });
      const dayLabels = days.slice().sort((a, b) => a - b).map((day) => tt(WEEKDAY_KEYS[day])).join(",");
      return tt("settings.alerts.scheduleDailyDays", { days: dayLabels, time: alarm.dailyTime ?? "" });
    }
    if (alarm.type === "once") {
      const remainMs = new Date(alarm.fireAt || 0).getTime() - Date.now();
      return tt("settings.alerts.scheduleOnce", { minutes: Math.max(0, Math.round(remainMs / 60000)) });
    }
    return "";
  };

  const addOrUpdateAlarm = () => {
    const existing = editingAlarmId ? s.alarms.find((entry) => entry.id === editingAlarmId) : null;
    const alarm: AlarmItem = {
      id: existing ? existing.id : `alarm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: title.trim().slice(0, 40) || tt("alarm.defaultTitle"),
      message: message.trim().slice(0, 80) || tt("alarm.defaultMessage"),
      type,
      enabled: existing && existing.type === type ? existing.enabled !== false : true,
      soundFile: pendingSoundFile
    };
    if (type === "interval") {
      alarm.intervalMinutes = Math.min(1440, Math.max(1, Number(intervalValue) || 60));
    } else if (type === "hourly") {
      // 클램프 범위는 settings-schema.ts의 normalizeAlarm()과 같아야 한다.
      alarm.hourlyInterval = Math.min(12, Math.max(1, Number(hourlyValue) || 1));
    } else if (type === "daily") {
      alarm.dailyTime = /^\d{2}:\d{2}$/.test(dailyValue) ? dailyValue : "15:00";
      alarm.daysOfWeek = selectedDays.size ? [...selectedDays].sort((a, b) => a - b) : [0, 1, 2, 3, 4, 5, 6];
    } else {
      const delayMinutes = Math.min(1440, Math.max(1, Number(onceValue) || 30));
      alarm.fireAt = new Date(Date.now() + delayMinutes * 60000).toISOString();
    }
    s.setAlarms(existing ? s.alarms.map((entry) => (entry.id === existing.id ? alarm : entry)) : [...s.alarms, alarm]);
    resetForm();
    s.markDirty();
  };

  return (
    <>
      <h2>{tt("settings.alerts.heading")}</h2>
      <ToggleRow checked={d.soundEnabled} onChange={(checked) => set("soundEnabled", checked)} label={tt("settings.alerts.soundToggle")} />
      <SelectRow
        label={tt("settings.alerts.soundLabel")}
        value={d.alarmSound}
        onChange={(value) => set("alarmSound", value)}
        options={ALARM_SOUND_OPTIONS.map((n) => ({ value: String(n), label: tt("settings.alerts.soundOption", { n, value: n }) }))}
      />
      <div className="favorite-items" aria-live="polite">
        {s.alarms.length === 0 && <div className="favorite-empty">{tt("settings.alerts.emptyList")}</div>}
        {s.alarms.map((alarm, index) => {
          const soundBadge = alarm.soundFile ? ` · ${tt("settings.alerts.customSoundBadge")}` : "";
          const disabledBadge = alarm.type !== "once" && alarm.enabled === false ? ` · ${tt("settings.alerts.disabledBadge")}` : "";
          return (
            <div key={alarm.id} className="favorite-item">
              <div className="favorite-item-row alarm-item-row">
                <span className="alarm-item-title" title={alarm.title || tt("alarm.defaultName")}>
                  {alarm.title || tt("alarm.defaultName")}
                </span>
                <div className="favorite-item-actions">
                  {alarm.type !== "once" && (
                    <input
                      type="checkbox"
                      className="alarm-item-toggle"
                      checked={alarm.enabled !== false}
                      title={tt("settings.alerts.enabledToggleTitle")}
                      onChange={(event) => {
                        const next = s.alarms.slice();
                        next[index] = { ...next[index], enabled: event.target.checked };
                        s.setAlarms(next);
                        s.markDirty();
                      }}
                    />
                  )}
                  <button className="favorite-edit" type="button" title={tt("settings.alerts.editButtonTitle")} onClick={() => enterEditMode(alarm)}>✎</button>
                  <button
                    className="favorite-remove"
                    type="button"
                    title={tt("common.delete")}
                    onClick={() => {
                      s.setAlarms(s.alarms.filter((_entry, entryIndex) => entryIndex !== index));
                      if (editingAlarmId === alarm.id) resetForm();
                      s.markDirty();
                    }}
                  >
                    ×
                  </button>
                </div>
              </div>
              <div className="favorite-target" title={alarm.message || ""}>
                {`${scheduleLabel(alarm)} · ${alarm.message || ""}${soundBadge}${disabledBadge}`}
              </div>
            </div>
          );
        })}
      </div>
      <div className="alarm-add-form">
        <label className="text-field">
          <span>{tt("settings.alerts.titleLabel")}</span>
          <input type="text" maxLength={40} placeholder={tt("alarm.defaultTitle")} value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label className="text-field">
          <span>{tt("settings.alerts.messageLabel")}</span>
          <textarea maxLength={80} rows={2} placeholder={tt("alarm.defaultMessage")} value={message} onChange={(event) => setMessage(event.target.value)} />
        </label>
        <SelectRow
          label={tt("settings.alerts.repeatLabel")}
          value={type}
          onChange={setType}
          options={[
            { value: "interval", label: tt("settings.alerts.repeatInterval") },
            { value: "hourly", label: tt("settings.alerts.repeatHourly") },
            { value: "daily", label: tt("settings.alerts.repeatDaily") },
            { value: "once", label: tt("settings.alerts.repeatOnce") }
          ]}
        />
        {type === "interval" && (
          <label className="setting-row">
            <span>{tt("settings.alerts.intervalLabel")}</span>
            <span className="input-wrap">
              <input type="number" min={1} max={1440} value={intervalValue} onChange={(event) => setIntervalValue(event.target.value)} />
              <span>{tt("settings.appearance.minutesUnit")}</span>
            </span>
          </label>
        )}
        {type === "hourly" && (
          <>
            <label className="setting-row">
              <span>{tt("settings.alerts.hourlyLabel")}</span>
              <span className="input-wrap">
                <input type="number" min={1} max={12} value={hourlyValue} onChange={(event) => setHourlyValue(event.target.value)} />
                <span>{tt("settings.alerts.hoursUnit")}</span>
              </span>
            </label>
            <Note>{tt("settings.alerts.hourlyNote")}</Note>
          </>
        )}
        {type === "daily" && (
          <>
            <label className="setting-row">
              <span>{tt("settings.alerts.dailyLabel")}</span>
              <span className="input-wrap">
                <input type="time" value={dailyValue} onChange={(event) => setDailyValue(event.target.value)} />
              </span>
            </label>
            <div className="setting-row">
              <span>{tt("settings.alerts.daysLabel")}</span>
              <div className="alarm-days-picker">
                {WEEKDAY_KEYS.map((key, day) => (
                  <button
                    key={key}
                    type="button"
                    className={`alarm-day-toggle${selectedDays.has(day) ? " active" : ""}`}
                    onClick={() => {
                      const next = new Set(selectedDays);
                      if (next.has(day)) next.delete(day);
                      else next.add(day);
                      setSelectedDays(next);
                    }}
                  >
                    {tt(key)}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
        {type === "once" && (
          <label className="setting-row">
            <span>{tt("settings.alerts.onceLabel")}</span>
            <span className="input-wrap">
              <input type="number" min={1} max={1440} value={onceValue} onChange={(event) => setOnceValue(event.target.value)} />
              <span>{tt("settings.appearance.minutesUnit")}</span>
            </span>
          </label>
        )}
        <SettingRow label={tt("settings.alerts.soundFileLabel")}>
          <button
            className="secondary-action"
            type="button"
            onClick={async () => {
              const result = await window.desktopPet.pickAlarmSound();
              if (!result?.ok || !result.filePath) return;
              setPendingSoundFile(result.filePath);
            }}
          >
            {tt("settings.alerts.soundFilePickButton")}
          </button>
          {pendingSoundFile && (
            <button className="secondary-action" type="button" onClick={() => setPendingSoundFile("")}>
              {tt("settings.alerts.soundFileClearButton")}
            </button>
          )}
        </SettingRow>
        <Note>
          {pendingSoundFile
            ? tt("settings.alerts.soundFileChosen", { name: fileBaseName(pendingSoundFile) })
            : tt("settings.alerts.soundFileNone")}
        </Note>
        <div className="alarm-form-actions">
          <button className="secondary-action" type="button" onClick={addOrUpdateAlarm}>
            {tt(editingAlarmId ? "settings.alerts.updateButton" : "settings.alerts.addButton")}
          </button>
          {editingAlarmId && (
            <button className="secondary-action" type="button" onClick={resetForm}>{tt("common.cancel")}</button>
          )}
        </div>
      </div>
      <Note>{tt("settings.alerts.note")}</Note>
      <button className="secondary-action" type="button" onClick={() => window.desktopPet.testAlarm(pendingSoundFile || undefined)}>
        {tt("settings.alerts.testButton")}
      </button>
    </>
  );
}

interface ShortcutRowDef {
  labelKey: string;
  shortcutKey: keyof Draft;
  enabledKey: keyof Draft;
}

function ShortcutRow({ def }: { def: ShortcutRowDef }) {
  const s = useSettings();
  const { d, set, tt } = s;
  const enabled = d[def.enabledKey] as boolean;
  return (
    <SettingRow label={tt(def.labelKey)}>
      <label className="shortcut-toggle">
        <input type="checkbox" checked={enabled} onChange={(event) => set(def.enabledKey, event.target.checked as never)} />
        <span>{tt("settings.shortcuts.enabledToggle")}</span>
      </label>
      <ShortcutRecorder
        value={d[def.shortcutKey] as string}
        enabled={enabled}
        recordingLabel={tt("settings.shortcuts.recordingPrompt")}
        tt={tt}
        onChange={(accelerator) => set(def.shortcutKey, accelerator as never)}
      />
    </SettingRow>
  );
}

export function ShortcutsTab() {
  const s = useSettings();
  const { d, set, tt } = s;
  return (
    <>
      <h2>{tt("settings.shortcuts.heading")}</h2>
      <ShortcutRow def={{ labelKey: "settings.shortcuts.assistantLabel", shortcutKey: "assistantShortcut", enabledKey: "assistantShortcutEnabled" }} />
      <ShortcutRow def={{ labelKey: "settings.shortcuts.favoritesLabel", shortcutKey: "favoritesShortcut", enabledKey: "favoritesShortcutEnabled" }} />
      <ShortcutRow def={{ labelKey: "settings.shortcuts.checklistLabel", shortcutKey: "checklistShortcut", enabledKey: "checklistShortcutEnabled" }} />
      <Note>{tt("settings.shortcuts.note")}</Note>
      <Note>{tt("settings.shortcuts.recorderNote")}</Note>
      <Note>{tt("settings.shortcuts.enabledNote")}</Note>
      <div className="settings-group">
        <h2>{tt("settings.shortcuts.imageResizeHeading")}</h2>
        <ShortcutRow def={{ labelKey: "settings.shortcuts.shortcutLabel", shortcutKey: "imageResizeShortcut", enabledKey: "imageResizeShortcutEnabled" }} />
        <SelectRow
          label={tt("imageResize.filterLabel")}
          value={d.imageResizeFilter}
          onChange={(value) => set("imageResizeFilter", value)}
          options={[
            { value: "nearest", label: tt("imageResize.filterNearest") },
            { value: "bilinear", label: tt("imageResize.filterBilinear") }
          ]}
        />
        <SelectRow
          label={tt("settings.shortcuts.defaultScaleLabel")}
          value={d.imageResizeScale}
          onChange={(value) => set("imageResizeScale", value)}
          options={["0.5", "2", "3", "4"].map((n) => ({ value: n, label: tt("imageResize.scaleOption", { n, value: n }) }))}
        />
        <Note>{tt("settings.shortcuts.imageResizeNote")}</Note>
      </div>
      <div className="settings-group">
        <h2>{tt("settings.shortcuts.translateHeading")}</h2>
        <ShortcutRow def={{ labelKey: "settings.shortcuts.shortcutLabel", shortcutKey: "translateShortcut", enabledKey: "translateShortcutEnabled" }} />
        <ToggleRow checked={d.translatePreferClipboard} onChange={(checked) => set("translatePreferClipboard", checked)} label={tt("settings.shortcuts.translatePreferClipboardToggle")} />
        <Note>{tt("settings.shortcuts.translatePreferClipboardNote")}</Note>
        <Note>{tt("settings.shortcuts.translateNote")}</Note>
      </div>
      <div className="settings-group">
        <h2>{tt("settings.shortcuts.documentSummaryHeading")}</h2>
        <ShortcutRow def={{ labelKey: "settings.shortcuts.shortcutLabel", shortcutKey: "documentSummaryShortcut", enabledKey: "documentSummaryShortcutEnabled" }} />
        <SelectRow
          label={tt("settings.shortcuts.documentSummaryThemeLabel")}
          value={d.documentSummaryTheme}
          onChange={(value) => set("documentSummaryTheme", value)}
          options={[
            { value: "app", label: tt("settings.shortcuts.documentSummaryThemeApp") },
            { value: "light", label: tt("settings.shortcuts.documentSummaryThemeLight") },
            { value: "dark", label: tt("settings.shortcuts.documentSummaryThemeDark") }
          ]}
        />
        <Note>{tt("settings.shortcuts.documentSummaryNote")}</Note>
      </div>
    </>
  );
}

/* 지금 펫 말풍선 테마의 강조색 — 즐겨찾기 아이콘 미리보기·스와치의 기본색으로 쓴다
   ("미리보기가 죄다 하얘서 안 보임" 피드백에 따른 바닐라 동작 유지). */
function currentAccentColor(): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue("--settings-accent").trim();
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#d75566";
}

function FavoriteIconPreview({ item, accentColor }: { item: FavoriteEditItem; accentColor: string }) {
  // svgMarkup/autoIconMarkup은 내장 템플릿 고정 문자열 + 색상 화이트리스트라 안전하다.
  if (item.customIcon) {
    const src = item.customIconDataUrl || `file:///${String(item.customIcon).replaceAll("\\", "/")}`;
    return <span className="favorite-icon-preview-icon"><img src={src} alt="" /></span>;
  }
  const markup = item.iconTemplate
    ? window.FavoriteIcons?.svgMarkup(item.iconTemplate, item.iconColor || accentColor) || ""
    : window.FavoriteIcons?.autoIconMarkup() || "";
  return <span className="favorite-icon-preview-icon" dangerouslySetInnerHTML={{ __html: markup }} />;
}

export function FavoritesTab() {
  const s = useSettings();
  const { d, set, tt } = s;
  const disabled = !d.favoritesEnabled;
  const [openPickerIndex, setOpenPickerIndex] = useState<number | null>(null);
  const [flipUp, setFlipUp] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  // 팝오버 바깥 클릭·Esc로 닫기 (바닐라와 동일 — 문서 수준 리스너).
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest(".favorite-icon-slot")) return;
      setOpenPickerIndex(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenPickerIndex(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  // 아래쪽 카드에서 팝오버가 창 밖이나 고정 저장 바 밑으로 들어가면 버튼 위로 뒤집는다.
  useEffect(() => {
    if (openPickerIndex === null || !pickerRef.current) return;
    setFlipUp(false);
    const picker = pickerRef.current;
    const footerTop = document.querySelector(".settings-footer")?.getBoundingClientRect().top;
    const limit = Math.min(window.innerHeight, footerTop || window.innerHeight);
    if (picker.getBoundingClientRect().bottom > limit) setFlipUp(true);
    picker.scrollIntoView({ block: "nearest" });
  }, [openPickerIndex]);

  const updateItem = (index: number, patch: Partial<FavoriteEditItem>) => {
    const next = s.favoriteItems.slice();
    next[index] = { ...next[index], ...patch };
    s.setFavoriteItems(next);
    s.markDirty();
  };

  const moveItem = (fromIndex: number, toIndex: number) => {
    if (toIndex < 0 || toIndex >= s.favoriteItems.length) return;
    const next = s.favoriteItems.slice();
    const [item] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, item);
    s.setFavoriteItems(next);
    s.markDirty();
  };

  const accentColor = currentAccentColor();

  return (
    <>
      <h2>{tt("settings.favorites.heading")}</h2>
      <ToggleRow checked={d.favoritesEnabled} onChange={(checked) => set("favoritesEnabled", checked)} label={tt("settings.favorites.enableToggle")} />
      <SelectRow
        label={tt("settings.favorites.displayModeLabel")}
        value={d.favoritesDisplayMode}
        disabled={disabled}
        onChange={(value) => set("favoritesDisplayMode", value)}
        options={[
          { value: "bubble", label: tt("settings.favorites.displayModeBubble") },
          { value: "window", label: tt("settings.favorites.displayModeWindow") },
          { value: "dock", label: tt("settings.favorites.displayModeDock") },
          { value: "cursor", label: tt("settings.favorites.displayModeCursor") }
        ]}
      />
      <Note>{tt("settings.favorites.displayModeNote")}</Note>
      <ToggleRow checked={d.favoritesLayoutGrid} disabled={disabled} onChange={(checked) => set("favoritesLayoutGrid", checked)} label={tt("settings.favorites.gridToggle")} />
      <ToggleRow
        checked={d.favoriteGridLabelsHidden}
        disabled={disabled || !d.favoritesLayoutGrid}
        onChange={(checked) => set("favoriteGridLabelsHidden", checked)}
        label={tt("settings.favorites.hideGridLabelsToggle")}
      />
      <div className="favorite-items" aria-live="polite">
        {s.favoriteItems.length === 0 && <div className="favorite-empty">{tt("settings.favorites.emptyList")}</div>}
        {s.favoriteItems.map((item, index) => {
          const pickerOpen = openPickerIndex === index;
          return (
            <div key={item.id} className="favorite-item">
              <div className="favorite-item-row">
                <div className="favorite-icon-slot">
                  <button
                    type="button"
                    className="favorite-icon-button"
                    aria-haspopup="true"
                    aria-expanded={pickerOpen}
                    disabled={disabled}
                    title={tt("settings.favorites.iconPickerLabel")}
                    onClick={() => setOpenPickerIndex(pickerOpen ? null : index)}
                  >
                    <FavoriteIconPreview item={item} accentColor={accentColor} />
                  </button>
                  {pickerOpen && (
                    <div ref={pickerRef} className={`favorite-icon-picker open${flipUp ? " flip-up" : ""}`}>
                      <div className="favorite-icon-picker-head">
                        <span className="favorite-icon-picker-title">{tt("settings.favorites.iconPickerLabel")}</span>
                        <span className="favorite-icon-preview-label">
                          {item.customIcon
                            ? tt("settings.favorites.iconCustom")
                            : item.iconTemplate
                              ? tt(window.FavoriteIcons?.TEMPLATES.find((tpl) => tpl.id === item.iconTemplate)?.labelKey || "")
                              : tt("settings.favorites.iconAuto")}
                        </span>
                      </div>
                      <div className="favorite-icon-row">
                        <button
                          type="button"
                          className={`favorite-icon-choice favorite-icon-auto${!item.iconTemplate && !item.customIcon ? " active" : ""}`}
                          title={tt("settings.favorites.iconAutoHint")}
                          disabled={disabled}
                          onClick={() => updateItem(index, { iconTemplate: "", customIcon: "", customIconDataUrl: "" })}
                          dangerouslySetInnerHTML={{ __html: window.FavoriteIcons?.autoIconMarkup() || "" }}
                        />
                        <button
                          type="button"
                          className="favorite-icon-choice favorite-icon-custom"
                          title={tt("settings.favorites.iconCustomHint")}
                          disabled={disabled}
                          onClick={async () => {
                            const result = await window.desktopPet.pickFavoriteIcon();
                            if (!result?.ok || !result.iconPath) return;
                            updateItem(index, { customIcon: result.iconPath, customIconDataUrl: result.iconDataUrl, iconTemplate: "" });
                          }}
                        >
                          {tt("settings.favorites.iconCustomButton")}
                        </button>
                        {(window.FavoriteIcons?.TEMPLATES || []).map((template) => (
                          <button
                            key={template.id}
                            type="button"
                            className={`favorite-icon-choice${item.iconTemplate === template.id && !item.customIcon ? " active" : ""}`}
                            title={tt(template.labelKey)}
                            disabled={disabled}
                            onClick={() => updateItem(index, { iconTemplate: template.id, customIcon: "", customIconDataUrl: "" })}
                            dangerouslySetInnerHTML={{ __html: window.FavoriteIcons?.svgMarkup(template.id, accentColor) || "" }}
                          />
                        ))}
                      </div>
                      <div className="favorite-icon-color-group">
                        <span className="favorite-icon-color-label">{tt("settings.favorites.iconColorLabel")}</span>
                        <ColorField
                          className="favorite-icon-color"
                          value={item.iconColor || accentColor}
                          placeholder={accentColor}
                          title={tt("settings.favorites.iconColorLabel")}
                          ariaLabel={tt("settings.favorites.iconColorLabel")}
                          disabled={disabled || !item.iconTemplate || Boolean(item.customIcon)}
                          onPreview={(hex) => updateItem(index, { iconColor: hex })}
                          onCommit={(hex) => updateItem(index, { iconColor: hex })}
                        />
                      </div>
                    </div>
                  )}
                </div>
                <div className="favorite-item-main">
                  <input
                    className="favorite-name"
                    type="text"
                    maxLength={32}
                    value={item.name || ""}
                    disabled={disabled}
                    aria-label={tt("settings.favorites.nameAriaLabel")}
                    onChange={(event) => updateItem(index, { name: event.target.value })}
                  />
                  <div className="favorite-target" title={item.target}>{item.target}</div>
                </div>
                <div className="favorite-item-actions">
                  <button className="favorite-move" type="button" title={tt("settings.favorites.moveUp")} aria-label={tt("settings.favorites.moveUp")} disabled={disabled || index === 0} onClick={() => moveItem(index, index - 1)}>▲</button>
                  <button className="favorite-move" type="button" title={tt("settings.favorites.moveDown")} aria-label={tt("settings.favorites.moveDown")} disabled={disabled || index === s.favoriteItems.length - 1} onClick={() => moveItem(index, index + 1)}>▼</button>
                  <button
                    className="favorite-remove"
                    type="button"
                    title={tt("common.delete")}
                    disabled={disabled}
                    onClick={() => {
                      s.setFavoriteItems(s.favoriteItems.filter((_entry, entryIndex) => entryIndex !== index));
                      s.markDirty();
                    }}
                  >
                    ×
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <button
        className="secondary-action"
        type="button"
        disabled={disabled || s.favoriteItems.length >= FAVORITE_ITEM_LIMIT}
        onClick={async () => {
          if (s.favoriteItems.length >= FAVORITE_ITEM_LIMIT) return;
          const result = await window.desktopPet.pickFavoriteTarget();
          if (!result?.ok || !result.target) return;
          s.setFavoriteItems([
            ...s.favoriteItems,
            { id: result.id || `favorite-${Date.now()}`, name: result.name || tt("favorites.defaultName"), target: result.target }
          ]);
          s.markDirty();
        }}
      >
        {tt("settings.favorites.addButton")}
      </button>
      <Note>{tt("settings.favorites.note")}</Note>
    </>
  );
}

export function PlayerTab() {
  const s = useSettings();
  const { d, set, tt } = s;
  return (
    <>
      <h2>{tt("settings.player.heading")}</h2>
      <Note>{tt("settings.player.note")}</Note>
      <ToggleRow checked={d.mediaPlayerEnabled} onChange={(checked) => set("mediaPlayerEnabled", checked)} label={tt("settings.player.enableToggle")} />
      <NumberRow label={tt("settings.player.scaleLabel")} value={d.mediaPlayerScale} onChange={(value) => set("mediaPlayerScale", value)} min={50} max={150} step={5} unit="%" />
      <NumberRow label={tt("settings.player.offsetLabel")} value={d.mediaPlayerOffset} onChange={(value) => set("mediaPlayerOffset", value)} min={-20} max={80} step={2} unit="px" />
      <NumberRow label={tt("settings.player.opacityLabel")} value={d.mediaPlayerOpacity} onChange={(value) => set("mediaPlayerOpacity", value)} min={20} max={100} step={5} unit="%" />
      <ToggleRow checked={d.mediaPlayerNodEnabled} onChange={(checked) => set("mediaPlayerNodEnabled", checked)} label={tt("settings.player.nodToggle")} />
    </>
  );
}

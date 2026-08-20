// 설정창 셸 — src/windows/settings/settings.js의 React 포팅 (2026-08-10).
// 탭 11개 · 저장 payload는 store.ts의 buildPayload()가 바닐라 submit과 1:1로 대응한다.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  Draft, ComplexState, GradientStop, LightingState,
  draftFromSettings, buildPayload, faceCustomizationPayload,
  normalizeBodyColors, normalizePartVariations
} from "./store";
import { AppearanceTab, CustomizationTab } from "./tabs-pet";
import { ConversationTab, MemoryTab } from "./tabs-talk";
import { AlertsTab, ShortcutsTab, FavoritesTab, PlayerTab } from "./tabs-interaction";
import { GeneralTab, UiTab, TrayTab } from "./tabs-app";
import { DevTab } from "./tabs-dev";
import { useCustomizationState } from "./use-customization-state";
import { useSettingsLifecycle } from "./use-settings-lifecycle";
// 창 외형을 <html>에 입히는 법은 창 공용 모듈이 갖는다. 설정창만 폼 값이 바뀔 때마다
// 낱개로 반영해야 해서 묶음(applyWindowAppearance) 대신 낱개 함수를 쓴다.
import { applyBubbleTheme, applyUiFont, applyUiFontSize, applyUiScale } from "../lib/appearance";

const TAB_GROUPS = [
  { labelKey: "settings.tabGroup.pet", tabs: [{ id: "appearance", labelKey: "settings.tab.appearance" }, { id: "customization", labelKey: "settings.tab.customization" }] },
  { labelKey: "settings.tabGroup.talk", tabs: [{ id: "conversation", labelKey: "settings.tab.conversation" }] },
  { labelKey: "settings.tabGroup.interaction", tabs: [{ id: "alerts", labelKey: "settings.tab.alerts" }, { id: "shortcuts", labelKey: "settings.tab.shortcuts" }, { id: "favorites", labelKey: "settings.tab.favorites" }, { id: "player", labelKey: "settings.tab.player" }] },
  { labelKey: "settings.tabGroup.app", tabs: [{ id: "general", labelKey: "settings.tab.general" }, { id: "ui", labelKey: "settings.tab.ui" }, { id: "tray", labelKey: "settings.tab.tray" }] }
];

export interface SettingsStore {
  d: Draft;
  set<K extends keyof Draft>(key: K, value: Draft[K]): void;
  tt(key: string, vars?: Record<string, string | number>): string;
  markDirty(): void;
  showError(message: string): void;
  clearError(): void;
  alarms: AlarmItem[];
  setAlarms(next: AlarmItem[]): void;
  favoriteItems: FavoriteEditItem[];
  setFavoriteItems(next: FavoriteEditItem[]): void;
  paletteStops: GradientStop[];
  setPaletteStops(next: GradientStop[]): void;
  selectedStop: number;
  setSelectedStop(next: number): void;
  lighting: LightingState;
  setLighting(next: LightingState): void;
  bodyColors: Array<{ id: string; color: string }>;
  setBodyColors(next: Array<{ id: string; color: string }>): void;
  partVariations: Array<{ id: string; variation: string }>;
  setPartVariations(next: Array<{ id: string; variation: string }>): void;
  presets: CustomizationPreset[];
  setPresets(next: CustomizationPreset[]): void;
  presetThumbnails: Record<string, string>;
  refreshPresetThumbnails(): void;
  installedFonts: string[];
  storedAssistantKey: boolean;
  customFaceKeys: string[];
  setCustomFaceKeys(keys: string[]): void;
  customBodyHas: boolean;
  setCustomBodyHas(has: boolean): void;
  previewLightingNow(lighting?: LightingState): void;
  previewBodyColorsNow(bodyColors?: Array<{ id: string; color: string }>): void;
  previewPartVariationsNow(partVariations?: Array<{ id: string; variation: string }>): void;
  previewFaceCustomizationNow(draft?: Draft): void;
  previewBubbleThemeNow(next?: Partial<Draft>): void;
  applyCustomizationSnapshot(preset: CustomizationPreset): void;
  applyLoaded(settings: Record<string, unknown>): void;
  refreshMemoryTick: number;
}

const Ctx = createContext<SettingsStore | null>(null);
export function useSettings(): SettingsStore {
  const store = useContext(Ctx);
  if (!store) throw new Error("SettingsStore missing");
  return store;
}

export default function App() {
  const [d, setDraft] = useState<Draft | null>(null);
  const [alarms, setAlarms] = useState<AlarmItem[]>([]);
  const [favoriteItems, setFavoriteItems] = useState<FavoriteEditItem[]>([]);
  const [installedFonts, setInstalledFonts] = useState<string[]>([]);
  const [storedAssistantKey, setStoredAssistantKey] = useState(false);
  // 외형·커스터마이징 상태는 use-customization-state.ts가 소유한다.
  const {
    paletteStops, setPaletteStops, selectedStop, setSelectedStop,
    lighting, setLighting, bodyColors, setBodyColors,
    partVariations, setPartVariations, presets, setPresets,
    presetThumbnails, refreshPresetThumbnails,
    customFaceKeys, setCustomFaceKeys, customBodyHas, setCustomBodyHas,
    previewLightingNow, previewBodyColorsNow, previewPartVariationsNow,
    applyFromSettings: applyCustomizationFromSettings
  } = useCustomizationState();
  const [activeTab, setActiveTab] = useState(() => sessionStorage.getItem("settings-active-tab") || "appearance");
  const [refreshMemoryTick, setRefreshMemoryTick] = useState(0);
  // 개발자 모드(2026-08-15): 창 제목을 1.5초 안에 5번 눌러야 숨김 탭이 나타난다. 설정으로
  // 저장하지 않는 세션 전용 상태라 창을 새로 열면 다시 잠긴다.
  const devUnlockClicks = useRef({ count: 0, lastClickAt: 0 });
  const [devModeUnlocked, setDevModeUnlocked] = useState(false);
  const handleTitleClick = useCallback(() => {
    if (devModeUnlocked) return;
    const state = devUnlockClicks.current;
    const now = Date.now();
    state.count = now - state.lastClickAt > 1500 ? 1 : state.count + 1;
    state.lastClickAt = now;
    if (state.count >= 5) setDevModeUnlocked(true);
  }, [devModeUnlocked]);
  // "기억 관리" 탭은 고급 사용자 전용 토글(d.memoryTabVisible)이 켜져 있을 때만 목록에 넣고,
  // "개발자" 탭은 위 숨김 제스처로 풀렸을 때만 넣는다.
  const tabGroups = useMemo(() => {
    let groups = TAB_GROUPS;
    if (d?.memoryTabVisible) {
      groups = groups.map((group) => group.labelKey !== "settings.tabGroup.talk"
        ? group
        : { ...group, tabs: [...group.tabs, { id: "memory", labelKey: "settings.tab.memory" }] });
    }
    if (devModeUnlocked) {
      groups = groups.map((group) => group.labelKey !== "settings.tabGroup.app"
        ? group
        : { ...group, tabs: [...group.tabs, { id: "dev", labelKey: "settings.tab.dev" }] });
    }
    return groups;
  }, [d?.memoryTabVisible, devModeUnlocked]);
  // 로드·수정·저장 수명주기는 use-settings-lifecycle.ts가 소유한다(dirty를 셋이 공유한다).
  const {
    loadStatus, saveError, saveSuccess,
    markDirty, markLoaded, markLoadFailed, markSaved,
    showError, clearError, isDirty
  } = useSettingsLifecycle();

  const language = d?.language ?? window.PetI18n.detectDefaultLanguage(navigator.language);
  const tt = useCallback(
    (key: string, vars?: Record<string, string | number>) => window.PetI18n.t(language, key, vars),
    [language]
  );

  const set = useCallback(<K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
    markDirty();
  }, [markDirty]);


  const applyLoaded = useCallback((settings: Record<string, unknown>) => {
    const draft = draftFromSettings(settings);
    setDraft(draft);
    setAlarms(Array.isArray(settings.alarms) ? (settings.alarms as AlarmItem[]).map((item) => ({ ...item })) : []);
    setFavoriteItems(Array.isArray(settings.favoriteItems) ? (settings.favoriteItems as FavoriteEditItem[]).map((item) => ({ ...item })) : []);
    applyCustomizationFromSettings(settings);
    setStoredAssistantKey(settings.assistantKeyConfigured === true);
    applyBubbleTheme(
      draft.bubbleTheme, draft.bubbleThemeCustomBg, draft.bubbleThemeCustomAccent, draft.bubbleThemeCustomText
    );
    setRefreshMemoryTick((tick) => tick + 1);
  }, [applyCustomizationFromSettings]);

  useEffect(() => {
    window.desktopPet.onQueryUnsaved(() => {
      window.desktopPet.replyUnsavedCheck(isDirty());
    });
    // 펫 쪽 편집기(펫 주변 색 고르기)는 즉시 확정·저장한다 — 폼의 색도 그 결과로 맞춰야
    // 이후 저장 버튼이 옛 색으로 덮어쓰지 않는다.
    window.desktopPet.onBodyColorsChanged((next) => {
      if (Array.isArray(next)) setBodyColors(normalizeBodyColors(next));
    });

    /* 테마 적용을 폰트 목록과 한 Promise.all에 묶지 않는다 — getInstalledFonts()는 초 단위로
       걸릴 수 있어서, 묶으면 data-ui-await-theme 게이트 때문에 창이 몇 초 빈 화면으로 남는다
       (바닐라와 같은 이유·같은 순서). 설정만 오면 곧바로 테마를 입히고 창을 연다. */
    const settingsPromise = window.desktopPet.getSettings() as Promise<Record<string, unknown>>;
    const fontsPromise = window.desktopPet.getInstalledFonts().catch(() => [] as string[]);

    settingsPromise
      .then((settings) => {
        applyBubbleTheme(
          String(settings.bubbleTheme || "charcoal"),
          String(settings.bubbleThemeCustomBg || ""),
          String(settings.bubbleThemeCustomAccent || ""),
          String(settings.bubbleThemeCustomText || "")
        );
        applyUiScale(settings.uiScalePercent);
        applyUiFontSize(settings.uiFontSizePercent);
      })
      .catch(() => {});

    fontsPromise.then((fonts) => {
      setInstalledFonts(Array.isArray(fonts) ? fonts : []);
    });

    settingsPromise
      .then((settings) => {
        applyLoaded(settings);
        markLoaded();
      })
      .catch((error) => {
        console.error("[Settings] Load settings failed:", error);
        markLoadFailed();
      });
  }, [applyLoaded, isDirty, markLoaded, markLoadFailed]);

  useEffect(() => {
    if (loadStatus !== "loading") window.PetUiMotion?.markReady();
  }, [loadStatus]);

  // 토글을 꺼서 "기억 관리" 탭이 목록에서 사라지면 그 탭에 머물러 있지 않게 대화 탭으로 옮긴다.
  useEffect(() => {
    if (activeTab === "memory" && d && !d.memoryTabVisible) activateTab("conversation");
  }, [activeTab, d?.memoryTabVisible]);

  // 이전 세션에서 개발자 탭에 머물러 있던 채로 창을 다시 열면(sessionStorage에 "dev"가
  // 남아 있음) 아직 잠금을 안 풀었어도 그 탭 내용이 그대로 보이는 걸 막는다.
  useEffect(() => {
    if (activeTab === "dev" && !devModeUnlocked) activateTab("general");
  }, [activeTab, devModeUnlocked]);

  // 프리셋 목록이 처음 로드되면 썸네일을 요청한다(펫 창이 그려주므로 비동기).
  useEffect(() => {
    if (loadStatus === "ready") refreshPresetThumbnails();
  }, [loadStatus, refreshPresetThumbnails]);

  // 설정창 자체 미리보기: UI 배율·글자 크기·폰트는 폼 값이 바뀌는 즉시 이 창에 반영한다.
  // 저장 전이라 값이 범위를 벗어나 있을 수 있고, 그 클램프는 공용 모듈이 갖는다.
  useEffect(() => {
    if (!d) return;
    applyUiScale(d.uiScalePercent);
  }, [d?.uiScalePercent]);
  useEffect(() => {
    if (!d) return;
    applyUiFontSize(d.uiFontSizePercent);
  }, [d?.uiFontSizePercent]);
  useEffect(() => {
    if (!d) return;
    applyUiFont(d.uiFontEnabled, d.uiFontPreset);
  }, [d?.uiFontEnabled, d?.uiFontPreset]);
  useEffect(() => {
    if (!d && loadStatus !== "failed") return;
    document.title = tt("window.settingsTitle");
    document.documentElement.lang = language;
  }, [tt, d, loadStatus, language]);

  const previewBubbleThemeNow = useCallback((next?: Partial<Draft>) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const merged = next ? { ...prev, ...next } : prev;
      applyBubbleTheme(merged.bubbleTheme, merged.bubbleThemeCustomBg, merged.bubbleThemeCustomAccent, merged.bubbleThemeCustomText);
      window.desktopPet.previewBubbleTheme(merged.bubbleTheme, merged.bubbleThemeCustomBg, merged.bubbleThemeCustomAccent, merged.bubbleThemeCustomText);
      return merged;
    });
  }, []);

  const previewFaceCustomizationNow = useCallback((draft?: Draft) => {
    setDraft((prev) => {
      const target = draft ?? prev;
      if (target) window.desktopPet.previewFaceCustomization(faceCustomizationPayload(target));
      return draft ?? prev;
    });
  }, []);

  const applyCustomizationSnapshot = useCallback((preset: CustomizationPreset) => {
    const nextBodyColors = normalizeBodyColors(preset.bodyColors);
    const nextPartVariations = normalizePartVariations(preset.partVariations);
    setBodyColors(nextBodyColors);
    setPartVariations(nextPartVariations);
    setDraft((prev) => {
      if (!prev) return prev;
      const merged: Draft = {
        ...prev,
        facePattern: String(preset.facePattern ?? 0),
        faceCosmetic: String(preset.faceCosmetic ?? 0),
        faceEyeStyle: String(preset.faceEyeStyle ?? 1),
        faceMouthStyle: String(preset.faceMouthStyle ?? 0),
        bodyCostume: String(preset.bodyCostume ?? 0),
        customFaceEnabled: preset.customFaceEnabled === true,
        customBodyEnabled: preset.customBodyEnabled === true
      };
      window.desktopPet.previewFaceCustomization(faceCustomizationPayload(merged));
      return merged;
    });
    window.desktopPet.previewBodyColors(nextBodyColors.map((entry) => ({ ...entry })));
    window.desktopPet.previewPartVariations(nextPartVariations.map((entry) => ({ ...entry })));
    // 프리셋마다 커스텀 얼굴·바디 이미지를 따로 갖는다 — 그 프리셋의 이미지를 활성 슬롯으로
    // 되돌린다. 이미지를 안 가진 프리셋(이 기능 전에 저장한 것)은 null이 와서 지금 이미지를 둔다.
    window.desktopPet.activatePresetAssets(String(preset.id || ""))
      .then((activation) => {
        if (!activation) return;
        if (activation.faceKeys.length) setCustomFaceKeys(activation.faceKeys);
        if (activation.hasBody) setCustomBodyHas(true);
      })
      .catch((error) => console.error("[Settings] Activate preset assets failed:", error));
    markDirty();
  }, [markDirty, setBodyColors, setPartVariations, setCustomFaceKeys, setCustomBodyHas]);

  const store = useMemo<SettingsStore | null>(() => {
    if (!d) return null;
    return {
      d, set, tt, markDirty, showError, clearError,
      alarms, setAlarms, favoriteItems, setFavoriteItems,
      paletteStops, setPaletteStops, selectedStop, setSelectedStop,
      lighting, setLighting, bodyColors, setBodyColors,
      partVariations, setPartVariations,
      presets, setPresets, presetThumbnails, refreshPresetThumbnails,
      installedFonts, storedAssistantKey,
      customFaceKeys, setCustomFaceKeys, customBodyHas, setCustomBodyHas,
      previewLightingNow, previewBodyColorsNow, previewPartVariationsNow,
      previewFaceCustomizationNow, previewBubbleThemeNow,
      applyCustomizationSnapshot, applyLoaded, refreshMemoryTick
    };
  }, [
    d, set, tt, markDirty, showError, clearError, alarms, favoriteItems,
    paletteStops, selectedStop, lighting, bodyColors, partVariations,
    presets, presetThumbnails, refreshPresetThumbnails, installedFonts,
    storedAssistantKey, customFaceKeys, customBodyHas,
    previewLightingNow, previewBodyColorsNow, previewPartVariationsNow,
    previewFaceCustomizationNow, previewBubbleThemeNow,
    applyCustomizationSnapshot, applyLoaded, refreshMemoryTick
  ]);

  const activateTab = (tab: string) => {
    setActiveTab(tab);
    sessionStorage.setItem("settings-active-tab", tab);
    window.scrollTo({ top: 0, behavior: "auto" });
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!d) return;
    clearError();
    const complex: ComplexState = { alarms, favoriteItems, paletteStops, lighting, bodyColors, partVariations };
    const result = await window.desktopPet.saveSettings(buildPayload(d, complex, tt("favorites.defaultName")));
    if (result?.ok === false) {
      const error = result.error || tt("settings.footer.saveError");
      showError(result.recoveryIncomplete
        ? `${error} ${tt("settings.footer.recoveryIncomplete")}`
        : error);
      return;
    }
    markSaved();
    // 조명·외곽선·팔레트가 방금 확정됐으니 프리셋 썸네일도 그 효과로 다시 그린다.
    refreshPresetThumbnails();
  };

  if (loadStatus === "failed") {
    return (
      <main className="settings-load-failure" lang={language}>
        <section className="tab-panel settings-load-failure-card" aria-labelledby="settings-load-failure-title">
          <h1 id="settings-load-failure-title">{tt("window.settingsTitle")}</h1>
          <p role="alert">{tt("settings.loadError")}</p>
          <button type="button" className="secondary-action" onClick={() => window.location.reload()}>
            {tt("common.retry")}
          </button>
        </section>
      </main>
    );
  }
  if (loadStatus !== "ready" || !store || !d) return null;

  return (
    <Ctx.Provider value={store}>
      <form id="settings-form" onSubmit={submit}>
        <aside className="settings-sidebar">
          <header className="settings-header">
            <h1 onClick={handleTitleClick}>{tt("window.settingsTitle")}</h1>
            <p>{tt("settings.subtitle")}</p>
          </header>
          <nav className="settings-tabs" role="tablist" aria-label={tt("settings.tabsAriaLabel")}>
            {tabGroups.map((group) => (
              <div key={group.labelKey} className="settings-tab-group">
                <span className="settings-tab-group-label">{tt(group.labelKey)}</span>
                {group.tabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    data-tab={tab.id}
                    className={`settings-tab${activeTab === tab.id ? " active" : ""}`}
                    aria-selected={activeTab === tab.id}
                    onClick={() => activateTab(tab.id)}
                  >
                    {tt(tab.labelKey)}
                  </button>
                ))}
              </div>
            ))}
          </nav>
        </aside>
        <div className="settings-content">
          <section className={`tab-panel${activeTab === "general" ? " active" : ""}`} hidden={activeTab !== "general"}><GeneralTab /></section>
          <section className={`tab-panel${activeTab === "appearance" ? " active" : ""}`} hidden={activeTab !== "appearance"}><AppearanceTab /></section>
          <section className={`tab-panel${activeTab === "player" ? " active" : ""}`} hidden={activeTab !== "player"}><PlayerTab /></section>
          <section className={`tab-panel${activeTab === "customization" ? " active" : ""}`} hidden={activeTab !== "customization"}><CustomizationTab /></section>
          <section className={`tab-panel${activeTab === "memory" ? " active" : ""}`} hidden={activeTab !== "memory"}><MemoryTab active={activeTab === "memory"} /></section>
          <section className={`tab-panel${activeTab === "alerts" ? " active" : ""}`} hidden={activeTab !== "alerts"}><AlertsTab /></section>
          <section className={`tab-panel${activeTab === "ui" ? " active" : ""}`} hidden={activeTab !== "ui"}><UiTab /></section>
          <section className={`tab-panel${activeTab === "conversation" ? " active" : ""}`} hidden={activeTab !== "conversation"}><ConversationTab /></section>
          <section className={`tab-panel${activeTab === "shortcuts" ? " active" : ""}`} hidden={activeTab !== "shortcuts"}><ShortcutsTab /></section>
          <section className={`tab-panel${activeTab === "tray" ? " active" : ""}`} hidden={activeTab !== "tray"}><TrayTab /></section>
          <section className={`tab-panel${activeTab === "favorites" ? " active" : ""}`} hidden={activeTab !== "favorites"}><FavoritesTab /></section>
          <section className={`tab-panel${activeTab === "dev" ? " active" : ""}`} hidden={activeTab !== "dev"}><DevTab /></section>
        </div>
        <footer className="settings-footer">
          {saveError && <div className="save-error">{saveError}</div>}
          {saveSuccess && <div className="save-success">{tt("settings.footer.saveSuccess")}</div>}
          <button className="save-button" type="submit">{tt("common.save")}</button>
        </footer>
      </form>
    </Ctx.Provider>
  );
}

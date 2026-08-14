import {
  normalizeTrayMenuItems,
  assistantShortcutLabel,
  favoritesShortcutLabel,
  checklistShortcutLabel
} from "../settings-schema.js";
const { t } = require("../../shared/i18n.js");

const CONTEXT_MENU_ITEM_HEIGHT = 28;
const CONTEXT_MENU_SEPARATOR_HEIGHT = 11;
const CONTEXT_MENU_PADDING = 12;

type PetMenuItem = {
  id?: string;
  label?: string;
  enabled?: boolean;
  type?: string;
  checked?: boolean;
  icon?: string | null;
  iconTemplate?: string | null;
  iconColor?: string | null;
  iconDataUrl?: string | null;
  target?: string | null;
  customIcon?: string | null;
  run?: () => unknown;
  items?: PetMenuItem[];
};
type SerializedPetMenuItem = {
  id?: string;
  label?: string;
  enabled: boolean;
  type?: string;
  checked?: boolean;
  icon?: string | null;
  iconTemplate?: string | null;
  iconColor?: string | null;
  iconDataUrl?: string | null;
  hideLabel?: boolean;
  items?: SerializedPetMenuItem[];
};
type PetMenuActions = {
  togglePet: () => unknown;
  toggleMoveMode: () => unknown;
  openSettings: () => unknown;
  openLogs: () => unknown;
  toggleChecklist: () => unknown;
  openAssistant: () => unknown;
  openFavorites: () => unknown;
  activateFavorite: (id: string) => unknown;
  toggleAutoStart: () => unknown;
  checkWeatherNow: () => unknown;
  quit: () => unknown;
};
type PetMenuFavorite = {
  id: string;
  name: string;
  target: string;
  iconTemplate?: string | null;
  iconColor?: string | null;
  customIcon?: string | null;
};
type PetMenuSettings = {
  language: string;
  trayMenuItems: unknown;
  checklistShortcut: unknown;
  assistantEnabled: boolean;
  assistantShortcut: unknown;
  favoritesEnabled: boolean;
  favoritesShortcut: unknown;
  favoritesTrayItemsEnabled: boolean;
  favoriteItems: PetMenuFavorite[];
  favoritesLayout: string;
  autoStartEnabled: boolean;
};
type PetMenuModelOptions = {
  settings: PetMenuSettings;
  countdown: string;
  clickThrough: boolean;
  restActive: boolean;
  alwaysDragEnabled: boolean;
  assistantKeyConfigured: boolean;
  assistantLogCount: number;
  checklistOpen: boolean;
  actions: PetMenuActions;
};

function buildPetMenuItems({
  settings,
  countdown,
  clickThrough,
  restActive,
  alwaysDragEnabled,
  assistantKeyConfigured,
  assistantLogCount,
  checklistOpen,
  actions
}: PetMenuModelOptions): PetMenuItem[] {
  const lang = settings.language;
  const trayItems = normalizeTrayMenuItems(settings.trayMenuItems);
  const items: PetMenuItem[] = [];

  if (trayItems.showHidePet) {
    items.push({
      id: "toggle-pet",
      iconTemplate: "heart",
      label: t(lang, "menu.showHidePet"),
      run: actions.togglePet
    });
  }
  // 상시 드래그에서는 별도 이동 모드가 의미 없으므로 항목 자체를 만들지 않는다.
  if (trayItems.moveMode && !alwaysDragEnabled) {
    items.push({
      id: "toggle-move-mode",
      iconTemplate: "bookmark",
      label: clickThrough ? t(lang, "menu.moveModeOn") : t(lang, "menu.moveModeOff"),
      enabled: !restActive,
      run: actions.toggleMoveMode
    });
  }
  if (items.length) items.push({ id: "sep-1", type: "separator" });

  if (trayItems.alarmCountdown) {
    items.push({
      id: "alarm-countdown",
      iconTemplate: "clock",
      label: t(lang, "menu.alarmCountdown", { countdown }),
      enabled: false
    });
  }
  // 메뉴 구성을 잘못 저장해도 설정창으로 되돌아갈 통로는 항상 남긴다.
  items.push({
    id: "open-settings",
    iconTemplate: "gear",
    label: t(lang, "menu.openSettings"),
    run: actions.openSettings
  });
  if (trayItems.qaLogs) {
    items.push({
      id: "open-logs",
      iconTemplate: "chat",
      label: t(lang, "menu.qaLogs", { count: assistantLogCount }),
      run: actions.openLogs
    });
  }
  if (trayItems.checklist) {
    items.push({
      id: "toggle-checklist",
      iconTemplate: "document",
      label: `${checklistOpen ? t(lang, "menu.checklistClose") : t(lang, "menu.checklistOpen")} · ${checklistShortcutLabel(settings.checklistShortcut)}`,
      run: actions.toggleChecklist
    });
  }
  if (trayItems.weather) {
    items.push({
      id: "check-weather",
      iconTemplate: "cloud",
      label: t(lang, "menu.checkWeather"),
      run: actions.checkWeatherNow
    });
  }
  if (trayItems.assistant && settings.assistantEnabled && assistantKeyConfigured) {
    items.push({
      id: "open-assistant",
      iconTemplate: "star",
      label: t(lang, "menu.openAssistant", { shortcut: assistantShortcutLabel(settings.assistantShortcut) }),
      enabled: !restActive,
      run: actions.openAssistant
    });
  }
  if (trayItems.favorites && settings.favoritesEnabled) {
    items.push({
      id: "open-favorites",
      iconTemplate: "folder",
      label: t(lang, "menu.openFavorites", { shortcut: favoritesShortcutLabel(settings.favoritesShortcut) }),
      enabled: !restActive,
      run: actions.openFavorites
    });
  }
  if (settings.favoritesEnabled && settings.favoritesTrayItemsEnabled && settings.favoriteItems.length) {
    items.push({ id: "sep-favorites", type: "separator" });
    const favoriteMenuItems = settings.favoriteItems.map((favorite) => ({
      id: `favorite:${favorite.id}`,
      icon: "favorite",
      iconDataUrl: null,
      target: favorite.target,
      customIcon: favorite.customIcon || null,
      iconTemplate: favorite.customIcon ? null : favorite.iconTemplate || null,
      iconColor: !favorite.customIcon && favorite.iconTemplate ? favorite.iconColor : null,
      label: favorite.name || t(lang, "favorites.defaultName"),
      enabled: !restActive,
      run: () => actions.activateFavorite(favorite.id)
    }));
    if (settings.favoritesLayout === "grid") {
      items.push({ id: "favorites-grid", type: "favorite-grid", items: favoriteMenuItems });
    } else {
      items.push(...favoriteMenuItems);
    }
  }
  if (trayItems.autoStart) {
    items.push({
      id: "toggle-autostart",
      iconTemplate: "clock",
      label: t(lang, "menu.autoStart"),
      type: "checkbox",
      checked: settings.autoStartEnabled,
      run: actions.toggleAutoStart
    });
  }
  items.push(
    { id: "sep-2", type: "separator" },
    { id: "quit", iconTemplate: "terminal", label: t(lang, "menu.quit"), run: actions.quit }
  );
  return items;
}

function serializeMenuItems(
  items: PetMenuItem[],
  favoriteGridLabelsHidden: boolean
): SerializedPetMenuItem[] {
  // 실행 콜백과 로컬 파일 경로(target/customIcon)는 main에만 남기고 허용 필드만 보낸다.
  return items.map(({ id, label, enabled, type, checked, icon, iconTemplate, iconColor, iconDataUrl, items: childItems }) => ({
    id,
    label,
    type,
    checked,
    icon,
    iconTemplate,
    iconColor,
    iconDataUrl,
    hideLabel: type === "favorite-grid" ? favoriteGridLabelsHidden === true : undefined,
    items: Array.isArray(childItems) ? serializeMenuItems(childItems, favoriteGridLabelsHidden) : undefined,
    enabled: enabled !== false
  }));
}

function contextMenuHeight(items: PetMenuItem[]): number {
  const body = items.reduce((sum, item) => (
    sum + (item.type === "separator"
      ? CONTEXT_MENU_SEPARATOR_HEIGHT
      : item.type === "favorite-grid"
        ? Math.ceil((item.items?.length || 0) / 4) * 62 + 10
        : CONTEXT_MENU_ITEM_HEIGHT)
  ), 0);
  return body + CONTEXT_MENU_PADDING;
}

export {
  buildPetMenuItems,
  serializeMenuItems,
  contextMenuHeight
};
export type { PetMenuItem, SerializedPetMenuItem, PetMenuActions, PetMenuModelOptions };

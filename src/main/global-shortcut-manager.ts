import type { GlobalShortcut } from "electron";
import {
  isMouseShortcut,
  formatShortcutLabel,
  normalizeAssistantShortcut,
  normalizeFavoritesShortcut,
  normalizeChecklistShortcut,
  normalizeTranslateShortcut,
  normalizeDocumentSummaryShortcut
} from "./settings-schema.js";
const { t } = require("../shared/i18n.js");

type Settings = {
  language: string;
  assistantEnabled: boolean;
  assistantShortcutEnabled: boolean;
  assistantShortcut: string;
  favoritesEnabled: boolean;
  favoritesShortcutEnabled: boolean;
  favoritesShortcut: string;
  imageResizeShortcutEnabled: boolean;
  imageResizeShortcut: string;
  checklistShortcutEnabled: boolean;
  checklistShortcut: string;
  translateShortcutEnabled: boolean;
  translateShortcut: string;
  documentSummaryShortcutEnabled: boolean;
  documentSummaryShortcut: string;
};
type ManagedShortcutId =
  | "assistant"
  | "favorites"
  | "imageResize"
  | "checklist"
  | "translate"
  | "documentSummary";
type MouseShortcutBinding = {
  button: number;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  handler: () => void;
};
type MouseShortcutEvent = {
  button?: unknown;
  ctrlKey?: unknown;
  metaKey?: unknown;
  altKey?: unknown;
  shiftKey?: unknown;
};
type GlobalShortcutManagerDependencies = {
  globalShortcut: Pick<GlobalShortcut, "register" | "unregister">;
  getSettings: () => Settings;
  isAssistantKeyConfigured: () => boolean;
  handlers: Record<ManagedShortcutId, () => void>;
};
type ActiveShortcut = { name: string; value: string };

/**
 * 앱 기능 6개의 키보드·마우스 단축키만 소유한다. 이동 모드·종료처럼 main.js가 별도로
 * 등록한 단축키는 이 매니저가 해제하지 않는다.
 */
function createGlobalShortcutManager({
  globalShortcut,
  getSettings,
  isAssistantKeyConfigured,
  handlers
}: GlobalShortcutManagerDependencies) {
  const registeredKeyboardShortcuts = new Map<ManagedShortcutId, string>();
  // Electron globalShortcut은 Mouse4/Mouse5를 accelerator로 받지 않으므로 OS 등록 대신
  // main.js의 uIOhook mousedown 이벤트가 아래 바인딩을 직접 전달한다.
  const mouseShortcutBindings = new Map<ManagedShortcutId, MouseShortcutBinding>();

  function parseMouseShortcut(value: unknown): Omit<MouseShortcutBinding, "handler"> | null {
    const parts = String(value || "").split("+");
    const keyName = parts[parts.length - 1];
    if (keyName !== "Mouse4" && keyName !== "Mouse5") return null;
    const modifiers = new Set(parts.slice(0, -1));
    return {
      button: keyName === "Mouse4" ? 4 : 5,
      ctrl: modifiers.has("CommandOrControl") || modifiers.has("Control") || modifiers.has("Cmd"),
      alt: modifiers.has("Alt"),
      shift: modifiers.has("Shift")
    };
  }

  function registerActiveShortcut(id: ManagedShortcutId, accelerator: string) {
    if (isMouseShortcut(accelerator)) {
      const parsed = parseMouseShortcut(accelerator);
      if (parsed) mouseShortcutBindings.set(id, { ...parsed, handler: handlers[id] });
      return true;
    }
    const registered = globalShortcut.register(accelerator, handlers[id]);
    if (registered) registeredKeyboardShortcuts.set(id, accelerator);
    return registered;
  }

  function unregisterShortcut(id: ManagedShortcutId) {
    mouseShortcutBindings.delete(id);
    const accelerator = registeredKeyboardShortcuts.get(id);
    if (!accelerator) return;
    globalShortcut.unregister(accelerator);
    registeredKeyboardShortcuts.delete(id);
  }

  function registerAssistantShortcut(
    candidateSettings = getSettings(),
    assistantKeyConfigured = isAssistantKeyConfigured()
  ) {
    unregisterShortcut("assistant");
    if (!candidateSettings.assistantEnabled || !assistantKeyConfigured ||
        candidateSettings.assistantShortcutEnabled === false) return true;
    return registerActiveShortcut(
      "assistant",
      normalizeAssistantShortcut(candidateSettings.assistantShortcut)
    );
  }

  function registerFavoritesShortcut(candidateSettings = getSettings()) {
    unregisterShortcut("favorites");
    if (!candidateSettings.favoritesEnabled || candidateSettings.favoritesShortcutEnabled === false) return true;
    return registerActiveShortcut(
      "favorites",
      normalizeFavoritesShortcut(candidateSettings.favoritesShortcut)
    );
  }

  function registerImageResizeShortcut(candidateSettings = getSettings()) {
    unregisterShortcut("imageResize");
    if (candidateSettings.imageResizeShortcutEnabled === false) return true;
    const accelerator = String(
      candidateSettings.imageResizeShortcut || "CommandOrControl+Shift+R"
    );
    return registerActiveShortcut("imageResize", accelerator);
  }

  function registerChecklistShortcut(candidateSettings = getSettings()) {
    unregisterShortcut("checklist");
    if (candidateSettings.checklistShortcutEnabled === false) return true;
    return registerActiveShortcut(
      "checklist",
      normalizeChecklistShortcut(candidateSettings.checklistShortcut)
    );
  }

  function registerTranslateShortcut(candidateSettings = getSettings()) {
    unregisterShortcut("translate");
    if (candidateSettings.translateShortcutEnabled === false) return true;
    return registerActiveShortcut(
      "translate",
      normalizeTranslateShortcut(candidateSettings.translateShortcut)
    );
  }

  function registerDocumentSummaryShortcut(
    candidateSettings = getSettings(),
    assistantKeyConfigured = isAssistantKeyConfigured()
  ) {
    unregisterShortcut("documentSummary");
    if (candidateSettings.documentSummaryShortcutEnabled === false ||
        !candidateSettings.assistantEnabled || !assistantKeyConfigured) return true;
    return registerActiveShortcut(
      "documentSummary",
      normalizeDocumentSummaryShortcut(candidateSettings.documentSummaryShortcut)
    );
  }

  function unregisterAssistantShortcut() {
    unregisterShortcut("assistant");
  }

  function unregisterFavoritesShortcut() {
    unregisterShortcut("favorites");
  }

  function unregisterImageResizeShortcut() {
    unregisterShortcut("imageResize");
  }

  function unregisterChecklistShortcut() {
    unregisterShortcut("checklist");
  }

  function unregisterTranslateShortcut() {
    unregisterShortcut("translate");
  }

  function unregisterDocumentSummaryShortcut() {
    unregisterShortcut("documentSummary");
  }

  function unregisterManagedShortcuts() {
    unregisterAssistantShortcut();
    unregisterFavoritesShortcut();
    unregisterImageResizeShortcut();
    unregisterChecklistShortcut();
    unregisterTranslateShortcut();
    unregisterDocumentSummaryShortcut();
  }

  /**
   * 후보 설정의 단축키를 한 묶음으로 적용한다. 일부 등록 뒤 실패할 수 있으므로 호출자는
   * 실패 결과를 받으면 반드시 restoreGlobalShortcuts()로 이전 묶음을 복원해야 한다.
   */
  function applyGlobalShortcuts(
    targetSettings: Settings,
    assistantKeyConfigured = isAssistantKeyConfigured()
  ): { ok: true } | { ok: false; failedShortcut: ManagedShortcutId } {
    unregisterManagedShortcuts();
    const registrations: [ManagedShortcutId, () => boolean][] = [
      ["assistant", () => registerAssistantShortcut(targetSettings, assistantKeyConfigured)],
      ["favorites", () => registerFavoritesShortcut(targetSettings)],
      ["imageResize", () => registerImageResizeShortcut(targetSettings)],
      ["checklist", () => registerChecklistShortcut(targetSettings)],
      ["translate", () => registerTranslateShortcut(targetSettings)],
      ["documentSummary", () => registerDocumentSummaryShortcut(targetSettings, assistantKeyConfigured)]
    ];
    for (const [id, register] of registrations) {
      if (!register()) return { ok: false, failedShortcut: id };
    }
    return { ok: true };
  }

  function restoreGlobalShortcuts(
    targetSettings: Settings,
    assistantKeyConfigured = isAssistantKeyConfigured()
  ) {
    unregisterManagedShortcuts();
    const restored = [
      registerAssistantShortcut(targetSettings, assistantKeyConfigured),
      registerFavoritesShortcut(targetSettings),
      registerImageResizeShortcut(targetSettings),
      registerChecklistShortcut(targetSettings),
      registerTranslateShortcut(targetSettings),
      registerDocumentSummaryShortcut(targetSettings, assistantKeyConfigured)
    ];
    return restored.every(Boolean);
  }

  function dispatchMouseShortcut(event: MouseShortcutEvent) {
    for (const binding of mouseShortcutBindings.values()) {
      if (binding.button !== Number(event.button)) continue;
      if (binding.ctrl !== Boolean(event.ctrlKey || event.metaKey)) continue;
      if (binding.alt !== Boolean(event.altKey)) continue;
      if (binding.shift !== Boolean(event.shiftKey)) continue;
      binding.handler();
      return true;
    }
    return false;
  }

  return {
    registerAssistantShortcut,
    registerFavoritesShortcut,
    registerImageResizeShortcut,
    registerChecklistShortcut,
    registerTranslateShortcut,
    registerDocumentSummaryShortcut,
    unregisterAssistantShortcut,
    unregisterFavoritesShortcut,
    unregisterImageResizeShortcut,
    unregisterChecklistShortcut,
    unregisterTranslateShortcut,
    unregisterDocumentSummaryShortcut,
    unregisterManagedShortcuts,
    applyGlobalShortcuts,
    restoreGlobalShortcuts,
    dispatchMouseShortcut
  };
}

function canonicalModifierToken(token: string, platform: NodeJS.Platform) {
  switch (token.toLowerCase()) {
    case "commandorcontrol":
    case "cmdorctrl":
      return platform === "darwin" ? "command" : "control";
    case "control":
    case "ctrl":
      return "control";
    case "command":
    case "cmd":
      if (platform === "darwin") return "command";
      if (platform === "win32") return "control";
      // Electron에서 Command는 Linux 계열에 대응 키가 없으므로 실제 Control과 합치지 않는다.
      return "unsupported-command";
    case "alt":
      return "alt";
    case "option":
      return platform === "darwin" ? "alt" : "unsupported-option";
    case "altgr":
      return "altgr";
    case "shift":
      return "shift";
    case "super":
    case "meta":
      return platform === "darwin" ? "command" : "super";
    default:
      return `unknown-${token.toLowerCase()}`;
  }
}

function canonicalKeyToken(token: string) {
  const normalized = token.toLowerCase();
  if (normalized === "enter") return "return";
  if (normalized === "esc") return "escape";
  return normalized;
}

/**
 * Electron accelerator는 대소문자와 보조키 순서를 구분하지 않는다. 플랫폼에서 같은 실제
 * 키로 해석되는 별칭까지 하나의 비교 키로 접어야 저장 전에 내부 충돌을 정확히 찾을 수 있다.
 */
function canonicalShortcutConflictKey(
  accelerator: unknown,
  platform: NodeJS.Platform = process.platform
) {
  const parts = String(accelerator || "").split("+").map(part => part.trim());
  if (parts.length === 0 || !parts[parts.length - 1]) return "";
  const key = canonicalKeyToken(parts[parts.length - 1]);
  const modifiers = [...new Set(
    parts.slice(0, -1).map(token => canonicalModifierToken(token, platform))
  )].sort();
  return `${modifiers.join("+")}::${key}`;
}

// 설정 저장 시 관리 단축키 6개가 앱 안에서 서로 겹치는지 검사한다. Electron의
// globalShortcut.register()는 같은 프로세스 안에서 이미 등록된 조합을 다시 등록해도
// 에러 없이 그냥 덮어써버려서(등록 실패로 안 잡힘), 여기서 서로 직접 비교해야 한다.
// 실제로 등록되지 않는 기능과 개별 단축키 비활성화 항목은 비교 대상에서 제외한다.
function shortcutConflictError(
  settings: Settings,
  assistantKeyConfigured: boolean,
  platform: NodeJS.Platform = process.platform
) {
  const assistantShortcutActive = settings.assistantEnabled &&
    assistantKeyConfigured &&
    settings.assistantShortcutEnabled;
  const candidates: Array<ActiveShortcut | false> = [
    assistantShortcutActive && {
      name: t(settings.language, "settings.shortcuts.assistantLabel"),
      value: settings.assistantShortcut
    },
    settings.favoritesEnabled && settings.favoritesShortcutEnabled && {
      name: t(settings.language, "settings.shortcuts.favoritesLabel"),
      value: settings.favoritesShortcut
    },
    settings.checklistShortcutEnabled && {
      name: t(settings.language, "settings.shortcuts.checklistLabel"),
      value: settings.checklistShortcut
    },
    settings.imageResizeShortcutEnabled && {
      name: t(settings.language, "settings.shortcuts.imageResizeHeading"),
      value: settings.imageResizeShortcut
    },
    settings.translateShortcutEnabled && {
      name: t(settings.language, "settings.shortcuts.translateHeading"),
      value: settings.translateShortcut
    },
    settings.documentSummaryShortcutEnabled && settings.assistantEnabled && {
      name: t(settings.language, "settings.shortcuts.documentSummaryHeading"),
      value: settings.documentSummaryShortcut
    }
  ];
  const activeShortcuts = candidates.filter(
    (entry): entry is ActiveShortcut => entry !== false
  );
  for (let i = 0; i < activeShortcuts.length; i += 1) {
    const left = activeShortcuts[i];
    const leftKey = canonicalShortcutConflictKey(left.value, platform);
    for (let j = i + 1; j < activeShortcuts.length; j += 1) {
      const right = activeShortcuts[j];
      if (leftKey && leftKey === canonicalShortcutConflictKey(right.value, platform)) {
        return t(settings.language, "shortcuts.conflictError", {
          a: left.name,
          b: right.name,
          shortcut: formatShortcutLabel(left.value)
        });
      }
    }
  }
  return null;
}

export {
  createGlobalShortcutManager,
  canonicalShortcutConflictKey,
  shortcutConflictError
};

export type {
  GlobalShortcutManagerDependencies,
  ManagedShortcutId,
  MouseShortcutBinding
};

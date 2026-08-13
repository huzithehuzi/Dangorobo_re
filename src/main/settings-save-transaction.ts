type SettingsSavePayload = {
  assistantApiKey?: unknown;
  assistantClearApiKey?: unknown;
};

type AssistantKeyPlan = {
  value: string;
  shouldPersist: boolean;
};

type ShortcutApplyResult =
  | { ok: true }
  | { ok: false; failedShortcut: string };

type RollbackFailure = {
  stage: "assistantKey" | "settings" | "shortcuts" | "journal";
  error: unknown;
};

type SettingsSaveTransactionOptions<TSettings extends { language: string }> = {
  previousSettings: TSettings;
  previousAssistantKey: string;
  nextSettings: unknown;
  normalizeSettings: (
    source: unknown,
    options: { fallback: TSettings; assistantKeyConfigured: boolean }
  ) => TSettings;
  shortcutConflictError: (settings: TSettings, assistantKeyConfigured: boolean) => string | null;
  applyShortcuts: (settings: TSettings, assistantKeyConfigured: boolean) => ShortcutApplyResult;
  restoreShortcuts: (settings: TSettings, assistantKeyConfigured: boolean) => void;
  persistAssistantKey: (assistantKey: string, language: string) => void;
  persistSettings: (settings: TSettings) => void;
  preparePersistence?: (
    settings: TSettings,
    assistantKey: string,
    assistantKeyWillPersist: boolean
  ) => void;
  markPersistenceRollback?: () => void;
  completePersistence?: () => void;
  cancelPersistence?: () => void;
};

type SettingsSaveTransactionResult<TSettings> =
  | {
      ok: true;
      settings: TSettings;
      assistantKey: string;
      cleanupFailures: RollbackFailure[];
    }
  | {
      ok: false;
      reason: "normalize" | "shortcutApply" | "persistence";
      error: unknown;
      rollbackFailures: RollbackFailure[];
    }
  | {
      ok: false;
      reason: "shortcutConflict";
      error: string;
      rollbackFailures: [];
    }
  | {
      ok: false;
      reason: "shortcutOccupied";
      settings: TSettings;
      failedShortcut: string;
      rollbackFailures: RollbackFailure[];
    };

function assistantKeyPlan(nextSettings: unknown, previousAssistantKey: string): AssistantKeyPlan {
  const payload = nextSettings && typeof nextSettings === "object"
    ? nextSettings as SettingsSavePayload
    : {};
  const enteredKey = String(payload.assistantApiKey || "").trim();
  const clearRequested = payload.assistantClearApiKey === true;
  if (clearRequested) {
    return { value: "", shouldPersist: true };
  }
  if (enteredKey) {
    return { value: enteredKey.slice(0, 300), shouldPersist: true };
  }
  return { value: previousAssistantKey, shouldPersist: false };
}

function sanitizeSettingsImportPayload(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([key]) => key !== "assistantApiKey" && key !== "assistantClearApiKey");
  if (entries.length === 0) return null;
  return Object.fromEntries(entries);
}

function rollback<TSettings extends { language: string }>(
  options: SettingsSaveTransactionOptions<TSettings>,
  keyPlan: AssistantKeyPlan,
  assistantKeyPersistenceAttempted: boolean,
  settingsPersistenceAttempted: boolean
): RollbackFailure[] {
  const failures: RollbackFailure[] = [];
  if (keyPlan.shouldPersist && assistantKeyPersistenceAttempted) {
    try {
      options.persistAssistantKey(
        options.previousAssistantKey,
        options.previousSettings.language
      );
    } catch (error) {
      failures.push({ stage: "assistantKey", error });
    }
  }
  if (settingsPersistenceAttempted) {
    try {
      options.persistSettings(options.previousSettings);
    } catch (error) {
      failures.push({ stage: "settings", error });
    }
  }
  try {
    options.restoreShortcuts(
      options.previousSettings,
      Boolean(options.previousAssistantKey)
    );
  } catch (error) {
    failures.push({ stage: "shortcuts", error });
  }
  return failures;
}

function executeSettingsSaveTransaction<TSettings extends { language: string }>(
  options: SettingsSaveTransactionOptions<TSettings>
): SettingsSaveTransactionResult<TSettings> {
  const keyPlan = assistantKeyPlan(options.nextSettings, options.previousAssistantKey);
  const assistantKeyConfigured = Boolean(keyPlan.value);
  let updatedSettings: TSettings;
  try {
    updatedSettings = options.normalizeSettings(options.nextSettings, {
      fallback: options.previousSettings,
      assistantKeyConfigured
    });
  } catch (error) {
    return { ok: false, reason: "normalize", error, rollbackFailures: [] };
  }

  const conflictError = options.shortcutConflictError(
    updatedSettings,
    assistantKeyConfigured
  );
  if (conflictError) {
    return {
      ok: false,
      reason: "shortcutConflict",
      error: conflictError,
      rollbackFailures: []
    };
  }

  let shortcutResult: ShortcutApplyResult;
  try {
    shortcutResult = options.applyShortcuts(updatedSettings, assistantKeyConfigured);
  } catch (error) {
    const rollbackFailures = rollback(options, keyPlan, false, false);
    return { ok: false, reason: "shortcutApply", error, rollbackFailures };
  }
  if (!shortcutResult.ok) {
    const rollbackFailures = rollback(options, keyPlan, false, false);
    return {
      ok: false,
      reason: "shortcutOccupied",
      settings: updatedSettings,
      failedShortcut: shortcutResult.failedShortcut,
      rollbackFailures
    };
  }

  const persistenceLifecycleActive = Boolean(options.preparePersistence);
  let assistantKeyPersistenceAttempted = false;
  let settingsPersistenceAttempted = false;
  try {
    options.preparePersistence?.(
      updatedSettings,
      keyPlan.value,
      keyPlan.shouldPersist
    );
    if (keyPlan.shouldPersist) {
      assistantKeyPersistenceAttempted = true;
      options.persistAssistantKey(keyPlan.value, updatedSettings.language);
    }
    settingsPersistenceAttempted = true;
    options.persistSettings(updatedSettings);
  } catch (error) {
    const rollbackFailures: RollbackFailure[] = [];
    if (persistenceLifecycleActive) {
      try {
        options.markPersistenceRollback?.();
      } catch (rollbackError) {
        rollbackFailures.push({ stage: "journal", error: rollbackError });
      }
    }
    rollbackFailures.push(...rollback(
      options,
      keyPlan,
      assistantKeyPersistenceAttempted,
      settingsPersistenceAttempted
    ));
    const diskRollbackIncomplete = rollbackFailures.some(
      failure => failure.stage === "assistantKey" || failure.stage === "settings"
    );
    if (persistenceLifecycleActive && !diskRollbackIncomplete) {
      try {
        options.cancelPersistence?.();
      } catch (rollbackError) {
        rollbackFailures.push({ stage: "journal", error: rollbackError });
      }
    }
    return { ok: false, reason: "persistence", error, rollbackFailures };
  }

  const cleanupFailures: RollbackFailure[] = [];
  if (persistenceLifecycleActive) {
    try {
      options.completePersistence?.();
    } catch (error) {
      cleanupFailures.push({ stage: "journal", error });
    }
  }
  return {
    ok: true,
    settings: updatedSettings,
    assistantKey: keyPlan.value,
    cleanupFailures
  };
}

export {
  assistantKeyPlan,
  executeSettingsSaveTransaction,
  sanitizeSettingsImportPayload
};
export type {
  AssistantKeyPlan,
  RollbackFailure,
  SettingsSaveTransactionOptions,
  SettingsSaveTransactionResult,
  ShortcutApplyResult
};

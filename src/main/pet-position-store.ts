import { readJsonWithRecovery, writeFileAtomicSync } from "./atomic-file.js";

type PetPosition = {
  x: number;
  y: number;
};

type PetPositionLoadResult = {
  position?: PetPosition;
  status: "ok" | "missing" | "corrupt";
  recoveredFromBackup: boolean;
};

function normalizePetPosition(value: unknown): PetPosition | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as { x?: unknown; y?: unknown };
  if (typeof candidate.x !== "number" || !Number.isFinite(candidate.x)
      || typeof candidate.y !== "number" || !Number.isFinite(candidate.y)) return undefined;
  return {
    x: Math.round(candidate.x),
    y: Math.round(candidate.y)
  };
}

function loadPetPosition(filePath: string): PetPositionLoadResult {
  const result = readJsonWithRecovery(filePath, {
    validate: (value: unknown) => normalizePetPosition(value) !== undefined
  });
  if (result.status !== "ok") {
    return {
      status: result.status,
      recoveredFromBackup: false
    };
  }
  return {
    position: normalizePetPosition(result.data),
    status: "ok",
    recoveredFromBackup: result.recoveredFromBackup === true
  };
}

function savePetPosition(filePath: string, position: PetPosition): void {
  writeFileAtomicSync(filePath, JSON.stringify(position, null, 2), { backup: true });
}

export {
  loadPetPosition,
  normalizePetPosition,
  savePetPosition
};
export type {
  PetPosition,
  PetPositionLoadResult
};

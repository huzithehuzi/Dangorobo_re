type ExecFileOptions = {
  encoding: "utf8";
  timeout: number;
  windowsHide: boolean;
};

type CapsLockStateReaderDependencies = {
  platform: string;
  powershellPath: () => string;
  execFile: (
    file: string,
    args: string[],
    options: ExecFileOptions,
    callback: (error: Error | null, stdout: string) => void
  ) => void;
};

function parseCapsLockState(stdout: unknown): boolean {
  return String(stdout).trim().toLowerCase() === "true";
}

function createCapsLockStateReader(deps: CapsLockStateReaderDependencies): () => Promise<boolean | undefined> {
  return () => {
    if (deps.platform !== "win32") return Promise.resolve(undefined);
    return new Promise((resolve, reject) => {
      deps.execFile(
        deps.powershellPath(),
        ["-NoProfile", "-NonInteractive", "-Command", "[Console]::CapsLock"],
        { encoding: "utf8", timeout: 8000, windowsHide: true },
        (error, stdout) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(parseCapsLockState(stdout));
        }
      );
    });
  };
}

export { createCapsLockStateReader, parseCapsLockState };
export type { CapsLockStateReaderDependencies };

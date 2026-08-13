// 설정 폼의 로드·수정·저장 수명주기.
//
// 셋을 한 훅에 두는 이유는 `dirty`를 공유하기 때문이다 — 로드가 끝나면 지우고, 사용자가
// 고치면 세우고, 저장이 끝나면 다시 지운다. 세 곳에 흩어 두면 "저장했는데 아직 더럽다"
// 같은 어긋남이 생긴다.
//
// `dirty`를 상태가 아니라 ref로 두는 것은 main이 창을 닫기 전에 `onQueryUnsaved`로 동기
// 조회하기 때문이다. 리렌더를 기다릴 수 없다.

import { useCallback, useRef, useState } from "react";

/** 저장 성공 표시가 남아 있는 시간. */
const SAVE_SUCCESS_DURATION_MS = 2500;

type LoadStatus = "loading" | "ready" | "failed";

function useSettingsLifecycle() {
  const [loadStatus, setLoadStatus] = useState<LoadStatus>("loading");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const dirtyRef = useRef(false);
  const saveSuccessTimerRef = useRef<number | undefined>(undefined);

  /** 폼을 고쳤다. 저장 성공 표시는 즉시 거둔다. */
  const markDirty = useCallback(() => {
    dirtyRef.current = true;
    setSaveSuccess(false);
  }, []);

  /** 초기 로드가 끝났다. 값을 채우는 것 자체는 수정이 아니므로 dirty를 지운다. */
  const markLoaded = useCallback(() => {
    setLoadStatus("ready");
    dirtyRef.current = false;
  }, []);

  const markLoadFailed = useCallback(() => setLoadStatus("failed"), []);

  /** 저장이 끝났다. 성공 표시는 잠깐 뒤 저절로 사라진다. */
  const markSaved = useCallback(() => {
    dirtyRef.current = false;
    setSaveSuccess(true);
    window.clearTimeout(saveSuccessTimerRef.current);
    saveSuccessTimerRef.current = window.setTimeout(() => setSaveSuccess(false), SAVE_SUCCESS_DURATION_MS);
  }, []);

  const showError = useCallback((message: string) => setSaveError(message), []);
  const clearError = useCallback(() => setSaveError(null), []);

  /** main이 창을 닫기 전에 동기로 묻는다 — 리렌더를 기다릴 수 없어 ref를 그대로 읽는다. */
  const isDirty = useCallback(() => dirtyRef.current, []);

  return {
    loadStatus, saveError, saveSuccess,
    markDirty, markLoaded, markLoadFailed, markSaved,
    showError, clearError, isDirty
  };
}

export { useSettingsLifecycle, SAVE_SUCCESS_DURATION_MS };
export type { LoadStatus };

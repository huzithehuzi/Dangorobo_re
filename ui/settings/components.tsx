// 설정창 공용 소형 컴포넌트 (2026-08-10, 바닐라 settings.js 포팅).
import { useEffect, useRef } from "react";

/* ── 공용 HSV 색 선택기 래퍼 ────────────────────────────────────────────
   색 선택은 앱 전체가 src/shared/color-picker.js(window.PetColorPicker) 하나를 쓴다
   (AGENTS.md — <input type="color"> 금지). 피커는 명령형 위젯이라 ref 컨테이너에
   한 번 만들어 붙이고, props 변경만 setValue/disabled로 동기화한다. */
interface ColorFieldProps {
  value: string;
  placeholder?: string;
  title?: string;
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
  onPreview?: (hex: string) => void;
  onCommit: (hex: string) => void;
}

export function ColorField({ value, placeholder, title, ariaLabel, disabled, className, onPreview, onCommit }: ColorFieldProps) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const fieldRef = useRef<PetColorPickerField | null>(null);
  // 콜백은 ref로 우회해 피커를 재생성하지 않는다(재생성하면 열려 있던 패널이 닫힌다).
  const onPreviewRef = useRef(onPreview);
  const onCommitRef = useRef(onCommit);
  onPreviewRef.current = onPreview;
  onCommitRef.current = onCommit;

  useEffect(() => {
    const field = window.PetColorPicker.createField({
      value,
      placeholder,
      title,
      ariaLabel,
      onPreview: (hex) => onPreviewRef.current?.(hex),
      onCommit: (hex) => onCommitRef.current(hex)
    });
    fieldRef.current = field;
    hostRef.current?.append(field.element);
    return () => {
      field.element.remove();
      fieldRef.current = null;
    };
    // 마운트 시 1회 생성 — value/disabled는 아래 effect가 동기화한다.
    // eslint 없는 환경이지만 의도를 명시해둔다.
  }, []);

  useEffect(() => {
    const field = fieldRef.current;
    if (field && field.getValue() !== value) field.setValue(value);
  }, [value]);

  useEffect(() => {
    if (fieldRef.current) fieldRef.current.disabled = disabled === true;
  }, [disabled]);

  return <span ref={hostRef} className={className} />;
}

/* ── 단축키 레코더 ──────────────────────────────────────────────────────
   버튼을 누르면 녹화 모드로 들어가 키/마우스 측면 버튼 조합을 받는다.
   main.js의 isValidGlobalAccelerator()와 같은 규칙(보조키 1개 이상 + 실제 키 1개,
   마우스 측면 버튼은 단독 허용)을 따르며, 녹화 중에는 shortcutRecordingStart/End로
   앱의 전역 단축키를 잠깐 꺼둔다(바닐라와 동일).
   전역 리스너·활성 레코더 관리는 모듈 수준 하나로 둔다 — 한 번에 하나만 녹화된다. */

const MODIFIER_KEY_NAMES = new Set(["Control", "Alt", "Shift", "Meta"]);
const CODE_TO_ACCELERATOR_KEY: Record<string, string> = {
  Space: "Space", Tab: "Tab", Enter: "Return", Backspace: "Backspace", Delete: "Delete",
  ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right",
  Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown",
  Comma: ",", Period: ".", Slash: "/", Semicolon: ";", Quote: "'",
  BracketLeft: "[", BracketRight: "]", Backslash: "\\", Minus: "-", Equal: "="
};
const MOUSE_BUTTON_TO_ACCELERATOR_KEY: Record<number, string> = { 3: "Mouse4", 4: "Mouse5" };
export const MOUSE_BUTTON_LABEL_KEYS: Record<string, string> = {
  Mouse4: "settings.shortcuts.mouseBack",
  Mouse5: "settings.shortcuts.mouseForward"
};

function acceleratorKeyFromCode(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  return CODE_TO_ACCELERATOR_KEY[code] || null;
}

function acceleratorFromKeyEvent(event: KeyboardEvent): string | null {
  if (event.code === "Escape") return "__cancel__";
  if (MODIFIER_KEY_NAMES.has(event.key)) return null;
  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push("CommandOrControl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  if (parts.length === 0) return null;
  const keyName = acceleratorKeyFromCode(event.code);
  if (!keyName) return null;
  parts.push(keyName);
  return parts.join("+");
}

function acceleratorFromMouseEvent(event: MouseEvent): string | null {
  const keyName = MOUSE_BUTTON_TO_ACCELERATOR_KEY[event.button];
  if (!keyName) return null;
  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push("CommandOrControl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  parts.push(keyName);
  return parts.join("+");
}

export function formatShortcutLabel(value: string, tt: (key: string) => string): string {
  const str = String(value);
  const parts = str.split("+");
  const lastPart = parts[parts.length - 1];
  if (MOUSE_BUTTON_LABEL_KEYS[lastPart]) {
    parts[parts.length - 1] = tt(MOUSE_BUTTON_LABEL_KEYS[lastPart]);
    return parts.join(" + ").replace("CommandOrControl", "Ctrl");
  }
  return str.replace("CommandOrControl", "Ctrl").replaceAll("+", " + ");
}

let activeRecorderStop: (() => void) | null = null;

interface ShortcutRecorderProps {
  value: string;
  enabled: boolean;
  recordingLabel: string;
  tt: (key: string) => string;
  onChange: (accelerator: string) => void;
}

export function ShortcutRecorder({ value, enabled, recordingLabel, tt, onChange }: ShortcutRecorderProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const recordingRef = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // 언마운트 시 진행 중인 녹화를 정리한다.
  useEffect(() => () => {
    if (recordingRef.current) activeRecorderStop?.();
  }, []);

  const stopRecording = () => {
    recordingRef.current = false;
    activeRecorderStop = null;
    buttonRef.current?.classList.remove("recording");
    if (buttonRef.current) buttonRef.current.textContent = formatShortcutLabel(value, tt);
    window.desktopPet.shortcutRecordingEnd();
  };

  const startRecording = () => {
    activeRecorderStop?.();
    recordingRef.current = true;
    buttonRef.current?.classList.add("recording");
    if (buttonRef.current) buttonRef.current.textContent = recordingLabel;
    window.desktopPet.shortcutRecordingStart();

    const finish = (accelerator: string | null) => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("mousedown", onMouseDown, true);
      document.removeEventListener("click", onOutsideClick, true);
      stopRecording();
      if (accelerator) onChangeRef.current(accelerator);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const accelerator = acceleratorFromKeyEvent(event);
      if (accelerator === null) return;
      finish(accelerator === "__cancel__" ? null : accelerator);
    };
    const onMouseDown = (event: MouseEvent) => {
      const accelerator = acceleratorFromMouseEvent(event);
      // 좌/우/휠클릭은 무시 — 좌클릭은 바깥 클릭(취소)으로, 우클릭은 평소처럼 동작해야 한다.
      if (accelerator === null) return;
      event.preventDefault();
      event.stopPropagation();
      finish(accelerator);
    };
    const onOutsideClick = (event: MouseEvent) => {
      if (event.target !== buttonRef.current) finish(null);
    };
    activeRecorderStop = () => finish(null);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("mousedown", onMouseDown, true);
    // 지금 누른 클릭 자체가 "바깥 클릭"으로 잡혀 즉시 취소되지 않게 한 틱 미룬다.
    setTimeout(() => document.addEventListener("click", onOutsideClick, true), 0);
  };

  return (
    <button
      ref={buttonRef}
      type="button"
      className={`shortcut-recorder${enabled ? "" : " disabled"}`}
      onClick={() => {
        if (!enabled) return;
        if (recordingRef.current) activeRecorderStop?.();
        else startRecording();
      }}
    >
      {formatShortcutLabel(value, tt)}
    </button>
  );
}

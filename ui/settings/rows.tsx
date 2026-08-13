// 설정창 공용 행 컴포넌트 — 바닐라 settings.html의 .setting-row / .toggle-row / .text-field
// 마크업을 그대로 재현한다(스타일은 settings.css가 담당).
import type { ReactNode } from "react";

export function SettingRow({ label, children, asDiv }: { label: ReactNode; children: ReactNode; asDiv?: boolean }) {
  // 색 선택기 행은 label이 아니라 div여야 한다 — 펼쳐진 피커 패널 안을 클릭하면 label의
  // 활성화 동작이 첫 labelable 자손(스와치 버튼)으로 전달돼 패널이 곧바로 닫힌다.
  const Tag = asDiv ? "div" : "label";
  return (
    <Tag className="setting-row">
      <span>{label}</span>
      <span className="input-wrap">{children}</span>
    </Tag>
  );
}

export function ToggleRow({ checked, onChange, label, disabled, compact, title }: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  disabled?: boolean;
  compact?: boolean;
  title?: string;
}) {
  return (
    <label className={`toggle-row${compact ? " compact-toggle" : ""}`} title={title}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function NumberRow({ label, value, onChange, min, max, step, unit, disabled }: {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  min: number;
  max: number;
  step?: number;
  unit?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <SettingRow label={label}>
      <input
        type="number"
        required
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
      {unit !== undefined && <span>{unit}</span>}
    </SettingRow>
  );
}

export function SelectRow({ label, value, onChange, options, disabled }: {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
}) {
  return (
    <SettingRow label={label}>
      <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </SettingRow>
  );
}

export function TextField({ label, value, onChange, maxLength, placeholder, type }: {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="text-field">
      <span>{label}</span>
      <input
        type={type || "text"}
        maxLength={maxLength}
        autoComplete="off"
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

export function Note({ children, html, className }: { children?: ReactNode; html?: string; className?: string }) {
  // html은 우리 i18n 카탈로그(src/shared/i18n.js)의 문자열만 받는다 — 외부 입력이 아니다.
  if (html !== undefined) {
    return <p className={`setting-note${className ? ` ${className}` : ""}`} dangerouslySetInnerHTML={{ __html: html }} />;
  }
  return <p className={`setting-note${className ? ` ${className}` : ""}`}>{children}</p>;
}

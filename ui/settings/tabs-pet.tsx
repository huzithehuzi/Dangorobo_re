// 펫 그룹 탭: 외형 / 커스터마이징 (2026-08-10, 바닐라 settings.js 포팅).
import { useRef, useState } from "react";
import { useSettings } from "./App";
import { ColorField } from "./components";
import { NumberRow, Note, SelectRow, SettingRow, ToggleRow } from "./rows";
import {
  BODY_COLOR_DEFS, BODY_CUSTOMIZATION_DEFS, FACE_CUSTOMIZATION_DEFS, LIGHTING_DEFS,
  PART_VARIATION_DEFS, VARIATION_LABEL_KEYS, GradientStop, Draft, FaceCustomizationKey,
  normalizeGradientStops, normalizeLightingState, faceCustomizationPayload
} from "./store";

const PALETTE_STOP_MIN = 2;
const PALETTE_STOP_MAX = 8;
// 카드 폭(약 108px)보다 작은 썸네일은 확대되는 것이므로 보간을 끊는다.
const PRESET_THUMBNAIL_PIXELATED_BELOW = 160;

/* ── 사용자 지정 팔레트: 그라디언트 맵 편집기 ─────────────────────────────
   정지점을 막대 위에서 끌어 옮기고, 선택한 정지점의 색을 공용 피커로 바꾼다.
   위치가 넘나들면 정렬 순서가 바뀌므로 드래그가 끝날 때 한 번만 정렬하고
   선택 인덱스도 따라간다(바닐라와 동일). */
function GradientEditor() {
  const s = useSettings();
  const { tt } = s;
  const barRef = useRef<HTMLDivElement>(null);
  const dragIndexRef = useRef(-1);

  const gradientCss = `linear-gradient(to right, ${s.paletteStops
    .map((stop) => `${stop.color} ${(stop.position * 100).toFixed(2)}%`)
    .join(", ")})`;

  const onPointerDown = (event: React.PointerEvent) => {
    const handle = (event.target as Element).closest?.(".gradient-stop") as HTMLElement | null;
    if (!handle) return;
    event.preventDefault();
    dragIndexRef.current = Number(handle.dataset.stopIndex);
    s.setSelectedStop(dragIndexRef.current);
    try { barRef.current?.setPointerCapture(event.pointerId); } catch { /* 캡처 없이도 동작한다 */ }
  };

  const onPointerMove = (event: React.PointerEvent) => {
    if (dragIndexRef.current < 0 || !barRef.current) return;
    const rect = barRef.current.getBoundingClientRect();
    const position = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const next = s.paletteStops.slice();
    next[dragIndexRef.current] = { ...next[dragIndexRef.current], position: Math.round(position * 1000) / 1000 };
    s.setPaletteStops(next);
  };

  const endDrag = (event: React.PointerEvent) => {
    if (dragIndexRef.current < 0) return;
    try { barRef.current?.releasePointerCapture(event.pointerId); } catch { /* 이미 풀렸을 수 있다 */ }
    const dragged = s.paletteStops[dragIndexRef.current];
    dragIndexRef.current = -1;
    const sorted = s.paletteStops.slice().sort((a, b) => a.position - b.position);
    s.setPaletteStops(sorted);
    s.setSelectedStop(sorted.indexOf(dragged));
    s.markDirty();
  };

  const addStop = () => {
    if (s.paletteStops.length >= PALETTE_STOP_MAX) return;
    // 새 정지점은 가장 넓은 빈 구간의 한가운데에, 그 자리의 그라디언트 색으로 넣는다
    // — 추가만으로 그림이 변하지 않는다.
    let gapIndex = 0;
    let widest = -1;
    for (let i = 0; i < s.paletteStops.length - 1; i += 1) {
      const gap = s.paletteStops[i + 1].position - s.paletteStops[i].position;
      if (gap > widest) { widest = gap; gapIndex = i; }
    }
    const left = s.paletteStops[gapIndex];
    const right = s.paletteStops[gapIndex + 1];
    const mix = (channel: number) => {
      const a = window.PetColorPicker.hexToRgb(left.color)[channel];
      const b = window.PetColorPicker.hexToRgb(right.color)[channel];
      return (a + b) / 2;
    };
    const next = s.paletteStops.slice();
    next.splice(gapIndex + 1, 0, {
      position: Math.round(((left.position + right.position) / 2) * 1000) / 1000,
      color: window.PetColorPicker.rgbToHex(mix(0), mix(1), mix(2))
    });
    s.setPaletteStops(next);
    s.setSelectedStop(gapIndex + 1);
    s.markDirty();
  };

  const removeStop = () => {
    if (s.paletteStops.length <= PALETTE_STOP_MIN) return;
    const next = s.paletteStops.slice();
    next.splice(s.selectedStop, 1);
    s.setPaletteStops(next);
    s.setSelectedStop(Math.min(s.selectedStop, next.length - 1));
    s.markDirty();
  };

  const selected: GradientStop | undefined = s.paletteStops[s.selectedStop];

  return (
    <div>
      <div className="setting-row"><span>{tt("settings.appearance.paletteGradientLabel")}</span></div>
      <div
        ref={barRef}
        className="gradient-bar"
        style={{ background: gradientCss }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {s.paletteStops.map((stop, index) => (
          <button
            key={index}
            type="button"
            className={`gradient-stop${index === s.selectedStop ? " selected" : ""}`}
            style={{ left: `${stop.position * 100}%`, background: stop.color }}
            data-stop-index={index}
          />
        ))}
      </div>
      <div className="gradient-actions">
        <button className="secondary-action" type="button" disabled={s.paletteStops.length >= PALETTE_STOP_MAX} onClick={addStop}>
          {tt("settings.appearance.paletteGradientAdd")}
        </button>
        <button className="secondary-action" type="button" disabled={s.paletteStops.length <= PALETTE_STOP_MIN} onClick={removeStop}>
          {tt("settings.appearance.paletteGradientRemove")}
        </button>
      </div>
      <SettingRow asDiv label={tt("settings.appearance.paletteGradientStopColor")}>
        {selected && (
          <ColorField
            value={selected.color}
            onPreview={(hex) => {
              const next = s.paletteStops.slice();
              next[s.selectedStop] = { ...next[s.selectedStop], color: hex };
              s.setPaletteStops(next);
            }}
            onCommit={(hex) => {
              const next = s.paletteStops.slice();
              next[s.selectedStop] = { ...next[s.selectedStop], color: hex };
              s.setPaletteStops(next);
              s.markDirty();
            }}
          />
        )}
      </SettingRow>
      <Note>{tt("settings.appearance.paletteGradientNote")}</Note>
    </div>
  );
}

function LightingGroup({ defId, labelKey }: { defId: string; labelKey: string }) {
  const s = useSettings();
  const { tt } = s;
  const entry = s.lighting[defId] || { color: "#ffffff", intensity: 1 };

  const update = (patch: Partial<typeof entry>) => {
    const next = { ...s.lighting, [defId]: { ...entry, ...patch } };
    s.previewLightingNow(next);
  };

  return (
    <div className="lighting-group">
      <h3>{tt(labelKey)}</h3>
      <SettingRow asDiv label={tt("lighting.colorLabel")}>
        <ColorField
          value={entry.color}
          placeholder="#ffffff"
          ariaLabel={tt("lighting.colorLabel")}
          onPreview={(hex) => update({ color: hex })}
          onCommit={(hex) => {
            update({ color: hex });
            s.markDirty();
          }}
        />
      </SettingRow>
      {defId === "ambient" && (
        <SettingRow asDiv label={tt("lighting.groundColorLabel")}>
          <ColorField
            value={entry.groundColor || "#30384e"}
            placeholder="#000000"
            ariaLabel={tt("lighting.groundColorLabel")}
            onPreview={(hex) => update({ groundColor: hex })}
            onCommit={(hex) => {
              update({ groundColor: hex });
              s.markDirty();
            }}
          />
        </SettingRow>
      )}
      <SettingRow label={tt("lighting.intensityLabel")}>
        <input
          type="range"
          min={0}
          max={10}
          step={0.1}
          className="lighting-intensity"
          value={entry.intensity}
          onChange={(event) => {
            update({ intensity: parseFloat(event.target.value) });
            s.markDirty();
          }}
        />
      </SettingRow>
      {defId !== "ambient" &&
        (["posX", "posY", "posZ"] as const).map((axis) => (
          <SettingRow key={axis} label={tt("lighting.positionLabel", { axis: axis.slice(3) })}>
            <input
              type="range"
              min={-10}
              max={10}
              step={0.1}
              className="lighting-position"
              value={entry[axis] ?? 0}
              onChange={(event) => {
                update({ [axis]: parseFloat(event.target.value) } as Partial<typeof entry>);
                s.markDirty();
              }}
            />
          </SettingRow>
        ))}
    </div>
  );
}

export function AppearanceTab() {
  const s = useSettings();
  const { d, set, tt } = s;
  const paletteOn = d.paletteEnabled;

  return (
    <>
      <div className="settings-group no-top-divider">
        <button
          className="secondary-action"
          type="button"
          onClick={async () => {
            if (!window.confirm(tt("settings.appearance.confirmResetDefaults"))) return;
            const defaults = await window.desktopPet.getAppearanceDefaults();
            if (!defaults) return;
            // 외형 탭만 기본값으로 채운다(커스터마이징 탭은 별개). 저장해야 실제 반영된다.
            const dd = defaults as Record<string, unknown>;
            set("petScalePercent", String(dd.petScalePercent ?? ""));
            set("tailSpeedPercent", String(dd.tailSpeedPercent ?? ""));
            set("shadingEnabled", Boolean(dd.shadingEnabled));
            set("pixelArtPercent", String(dd.pixelArtPercent ?? ""));
            set("paletteEnabled", dd.paletteEnabled === true);
            set("palettePreset", String(dd.palettePreset || "auto"));
            set("paletteSteps", String(dd.paletteSteps ?? ""));
            s.setPaletteStops(normalizeGradientStops(dd.paletteCustomStops));
            set("ditherPattern", String(dd.ditherPattern || "none"));
            set("ditherAmount", String(dd.ditherAmount ?? ""));
            set("outlineEnabled", dd.outlineEnabled === true);
            set("outlineColor", String(dd.outlineColor || "#000000"));
            set("outlineThickness", String(dd.outlineThickness ?? ""));
            set("lineWobbleEnabled", dd.lineWobbleEnabled === true);
            set("lineWobbleFrequency", String(dd.lineWobbleFrequency ?? ""));
            set("lineWobbleSpeed", String(dd.lineWobbleSpeed ?? ""));
            set("lineWobbleAmount", String(dd.lineWobbleAmount ?? ""));
            set("mouseSquishEnabled", Boolean(dd.mouseSquishEnabled));
            set("keyboardSquishEnabled", Boolean(dd.keyboardSquishEnabled));
            set("squishStrengthPercent", String(dd.squishStrengthPercent ?? ""));
            set("headPettingEnabled", Boolean(dd.headPettingEnabled));
            set("capsLockAlertEnabled", Boolean(dd.capsLockAlertEnabled));
            set("dragReactionEnabled", Boolean(dd.dragReactionEnabled));
            set("sleepEnabled", Boolean(dd.sleepEnabled));
            set("sleepAfterMinutes", String(dd.sleepAfterMinutes ?? ""));
            set("idleRoutineEnabled", Boolean(dd.idleRoutineEnabled));
            set("idleRoutineMinSeconds", String(dd.idleRoutineMinSeconds ?? ""));
            set("idleRoutineMaxSeconds", String(dd.idleRoutineMaxSeconds ?? ""));
            s.previewLightingNow(normalizeLightingState(dd.lighting));
          }}
        >
          {tt("settings.appearance.resetDefaultsButton")}
        </button>
        <Note>{tt("settings.appearance.resetDefaultsNote")}</Note>
      </div>
      <hr className="settings-divider" />
      <h2>{tt("settings.appearance.modelHeading")}</h2>
      <NumberRow label={tt("settings.appearance.scaleLabel")} value={d.petScalePercent} onChange={(value) => set("petScalePercent", value)} min={30} max={130} step={5} unit="%" />
      <NumberRow label={tt("settings.appearance.tailSpeedLabel")} value={d.tailSpeedPercent} onChange={(value) => set("tailSpeedPercent", value)} min={25} max={350} step={5} unit="%" />
      <ToggleRow checked={d.shadingEnabled} onChange={(checked) => set("shadingEnabled", checked)} label={tt("settings.appearance.shadingToggle")} />
      <NumberRow label={tt("settings.appearance.pixelArtLabel")} value={d.pixelArtPercent} onChange={(value) => set("pixelArtPercent", value)} min={0} max={100} step={5} unit="%" />
      <div className="settings-group">
        <h2>{tt("settings.appearance.colorHeading")}</h2>
        <ToggleRow checked={d.paletteEnabled} onChange={(checked) => set("paletteEnabled", checked)} label={tt("settings.appearance.paletteToggle")} />
        <SelectRow
          label={tt("settings.appearance.paletteLabel")}
          value={d.palettePreset}
          disabled={!paletteOn}
          onChange={(value) => set("palettePreset", value)}
          options={[
            { value: "auto", label: tt("settings.appearance.paletteAuto") },
            { value: "warm", label: tt("settings.appearance.paletteWarm") },
            { value: "cool", label: tt("settings.appearance.paletteCool") },
            { value: "monochrome", label: tt("settings.appearance.paletteMono") },
            { value: "gameboy", label: tt("settings.appearance.paletteGameboy") },
            { value: "custom", label: tt("settings.appearance.paletteCustom") }
          ]}
        />
        <NumberRow
          label={tt("settings.appearance.paletteStepsLabel")}
          value={d.paletteSteps}
          onChange={(value) => set("paletteSteps", value)}
          min={2}
          max={32}
          step={1}
          unit={tt("settings.appearance.paletteStepsUnit")}
          disabled={!paletteOn || d.palettePreset === "gameboy"}
        />
        {paletteOn && d.palettePreset === "custom" && <GradientEditor />}
        {/* 디더링 option 순서는 renderer.js의 DITHER_PATTERNS / 셰이더 분기 순서와 같아야 한다 */}
        <SelectRow
          label={tt("settings.appearance.ditherLabel")}
          value={d.ditherPattern}
          disabled={!paletteOn}
          onChange={(value) => set("ditherPattern", value)}
          options={[
            { value: "none", label: tt("settings.appearance.ditherNone") },
            { value: "bayer2", label: tt("settings.appearance.ditherBayer2") },
            { value: "bayer4", label: tt("settings.appearance.ditherBayer4") },
            { value: "bayer8", label: tt("settings.appearance.ditherBayer8") },
            { value: "checker", label: tt("settings.appearance.ditherChecker") },
            { value: "lines", label: tt("settings.appearance.ditherLines") },
            { value: "verticalLines", label: tt("settings.appearance.ditherVerticalLines") },
            { value: "noise", label: tt("settings.appearance.ditherNoise") }
          ]}
        />
        <NumberRow label={tt("settings.appearance.ditherAmountLabel")} value={d.ditherAmount} onChange={(value) => set("ditherAmount", value)} min={0} max={100} step={5} unit="%" disabled={!paletteOn || d.ditherPattern === "none"} />
        <Note>{tt("settings.appearance.ditherNote")}</Note>
        <ToggleRow checked={d.outlineEnabled} onChange={(checked) => set("outlineEnabled", checked)} label={tt("settings.appearance.outlineToggle")} />
        <SettingRow asDiv label={tt("settings.appearance.outlineColorLabel")}>
          {/* 외곽선 색은 예전에도 실시간 미리보기가 없었다(저장해야 반영) — 동작 유지 */}
          <ColorField
            value={d.outlineColor}
            disabled={!d.outlineEnabled}
            onCommit={(hex) => set("outlineColor", hex)}
          />
        </SettingRow>
        <NumberRow label={tt("settings.appearance.outlineThicknessLabel")} value={d.outlineThickness} onChange={(value) => set("outlineThickness", value)} min={1} max={8} step={1} unit="px" disabled={!d.outlineEnabled} />
        <ToggleRow checked={d.lineWobbleEnabled} onChange={(checked) => set("lineWobbleEnabled", checked)} label={tt("settings.appearance.lineWobbleToggle")} />
        <NumberRow label={tt("settings.appearance.lineWobbleFrequencyLabel")} value={d.lineWobbleFrequency} onChange={(value) => set("lineWobbleFrequency", value)} min={1} max={30} step={1} disabled={!d.lineWobbleEnabled} />
        <NumberRow label={tt("settings.appearance.lineWobbleSpeedLabel")} value={d.lineWobbleSpeed} onChange={(value) => set("lineWobbleSpeed", value)} min={0.1} max={10} step={0.1} disabled={!d.lineWobbleEnabled} />
        <NumberRow label={tt("settings.appearance.lineWobbleAmountLabel")} value={d.lineWobbleAmount} onChange={(value) => set("lineWobbleAmount", value)} min={0} max={6} step={0.5} unit="px" disabled={!d.lineWobbleEnabled} />
        <Note>{tt("settings.appearance.lineWobbleNote")}</Note>
      </div>
      <div className="settings-group">
        <h2>{tt("settings.appearance.inputHeading")}</h2>
        <ToggleRow checked={d.mouseSquishEnabled} onChange={(checked) => set("mouseSquishEnabled", checked)} label={tt("settings.appearance.mouseSquishToggle")} />
        <ToggleRow checked={d.keyboardSquishEnabled} onChange={(checked) => set("keyboardSquishEnabled", checked)} label={tt("settings.appearance.keyboardSquishToggle")} />
        <NumberRow label={tt("settings.appearance.squishStrengthLabel")} value={d.squishStrengthPercent} onChange={(value) => set("squishStrengthPercent", value)} min={5} max={35} step={1} unit="%" />
        <ToggleRow checked={d.headPettingEnabled} onChange={(checked) => set("headPettingEnabled", checked)} label={tt("settings.appearance.headPettingToggle")} />
        <Note>{tt("settings.appearance.headPettingNote")}</Note>
        <ToggleRow checked={d.capsLockAlertEnabled} onChange={(checked) => set("capsLockAlertEnabled", checked)} label={tt("settings.appearance.capsLockToggle")} />
        <Note>{tt("settings.appearance.capsLockNote")}</Note>
        <ToggleRow checked={d.dragReactionEnabled} onChange={(checked) => set("dragReactionEnabled", checked)} label={tt("settings.appearance.dragReactionToggle")} />
        <Note>{tt("settings.appearance.dragReactionNote")}</Note>
        <ToggleRow checked={d.sleepEnabled} onChange={(checked) => set("sleepEnabled", checked)} label={tt("settings.appearance.sleepToggle")} />
        <NumberRow label={tt("settings.appearance.sleepAfterLabel")} value={d.sleepAfterMinutes} onChange={(value) => set("sleepAfterMinutes", value)} min={1} max={120} step={1} unit={tt("settings.appearance.minutesUnit")} disabled={!d.sleepEnabled} />
        <Note>{tt("settings.appearance.sleepNote")}</Note>
        <hr className="settings-divider" />
        <h2>{tt("settings.appearance.idleRoutineHeading")}</h2>
        <ToggleRow checked={d.idleRoutineEnabled} onChange={(checked) => set("idleRoutineEnabled", checked)} label={tt("settings.appearance.idleRoutineToggle")} />
        <NumberRow label={tt("settings.appearance.idleRoutineMinLabel")} value={d.idleRoutineMinSeconds} onChange={(value) => set("idleRoutineMinSeconds", value)} min={5} max={300} step={1} unit={tt("settings.appearance.secondsUnit")} disabled={!d.idleRoutineEnabled} />
        <NumberRow label={tt("settings.appearance.idleRoutineMaxLabel")} value={d.idleRoutineMaxSeconds} onChange={(value) => set("idleRoutineMaxSeconds", value)} min={5} max={300} step={1} unit={tt("settings.appearance.secondsUnit")} disabled={!d.idleRoutineEnabled} />
        <Note>{tt("settings.appearance.idleRoutineNote")}</Note>
      </div>
      <hr className="settings-divider" />
      <div className="settings-group">
        <h2>{tt("settings.appearance.lightingHeading")}</h2>
        <Note>{tt("settings.appearance.lightingNote")}</Note>
        {LIGHTING_DEFS.map((def) => (
          <LightingGroup key={def.id} defId={def.id} labelKey={def.labelKey} />
        ))}
      </div>
    </>
  );
}

function CustomizationSelect({ def }: { def: { key: string; labelKey: string; count: number; allowNone: boolean } }) {
  const s = useSettings();
  const { d, set, tt } = s;
  const key = def.key as FaceCustomizationKey;
  const defLabel = tt(def.labelKey);
  return (
    <SettingRow label={defLabel}>
      <select
        value={d[key]}
        onChange={(event) => {
          const merged = { ...d, [key]: event.target.value } as Draft;
          set(key, event.target.value);
          window.desktopPet.previewFaceCustomization(faceCustomizationPayload(merged));
        }}
      >
        {def.allowNone && <option value="0">{tt("common.none")}</option>}
        {Array.from({ length: def.count }, (_unused, i) => i + 1).map((n) => (
          <option key={n} value={String(n)}>{tt("faceCustom.optionNumbered", { label: defLabel, n })}</option>
        ))}
      </select>
    </SettingRow>
  );
}

export function CustomizationTab() {
  const s = useSettings();
  const { d, set, tt } = s;
  const [presetName, setPresetName] = useState("");

  const snapshot = () => ({
    bodyColors: s.bodyColors.map((entry) => ({ ...entry })),
    partVariations: s.partVariations.map((entry) => ({ ...entry })),
    ...faceCustomizationPayload(d)
  });

  return (
    <>
      <Note>{tt("settings.customization.liveNote")}</Note>
      <div className="settings-group">
        <h2>{tt("customizeOnPet.heading")}</h2>
        <button className="secondary-action" type="button" onClick={() => window.desktopPet.openPetCustomize()}>
          {tt("customizeOnPet.openButton")}
        </button>
        <Note>{tt("customizeOnPet.note")}</Note>
      </div>
      <div className="settings-group">
        <h2>{tt("settings.customization.presetsHeading")}</h2>
        <div className="preset-items" aria-live="polite">
          {s.presets.length === 0 && <div className="favorite-empty">{tt("customization.emptyPresetList")}</div>}
          {s.presets.map((preset) => {
            const thumbnail = s.presetThumbnails[preset.id];
            return (
              <div key={preset.id} className="preset-card">
                <button
                  className="preset-thumb"
                  type="button"
                  title={`${preset.name} — ${tt("common.apply")}`}
                  onClick={() => s.applyCustomizationSnapshot(preset)}
                >
                  {thumbnail ? (
                    <img
                      alt={preset.name}
                      src={thumbnail}
                      onLoad={(event) => {
                        // 픽셀 아트 설정이 켜져 있으면 표시 크기보다 작은 그림이 온다 —
                        // 그때만 확대 보간을 끊어 도트를 또렷하게 보여준다.
                        const image = event.currentTarget;
                        if (image.naturalWidth && image.naturalWidth < PRESET_THUMBNAIL_PIXELATED_BELOW) {
                          image.classList.add("pixelated");
                        }
                      }}
                    />
                  ) : (
                    <span className="preset-thumb-placeholder">{tt("customization.presetThumbnailPending")}</span>
                  )}
                  <span className="preset-thumb-overlay">{tt("common.apply")}</span>
                </button>
                <div className="preset-card-name" title={preset.name}>{preset.name}</div>
                <div className="preset-item-actions">
                  <button
                    className="secondary-action"
                    type="button"
                    onClick={async () => {
                      const result = await window.desktopPet.exportCustomizationPreset(preset);
                      if (result?.ok === false && !result.canceled) {
                        s.showError(result.error || tt("customization.exportFailedError"));
                      }
                    }}
                  >
                    {tt("customization.exportButton")}
                  </button>
                  <button
                    className="favorite-remove"
                    type="button"
                    title={tt("common.delete")}
                    onClick={async () => {
                      s.setPresets(await window.desktopPet.deleteCustomizationPreset(preset.id));
                    }}
                  >
                    ×
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <div className="alarm-add-form">
          <label className="text-field">
            <span>{tt("settings.customization.presetNameLabel")}</span>
            <input type="text" maxLength={40} placeholder={tt("settings.customization.presetNamePlaceholder")} value={presetName} onChange={(event) => setPresetName(event.target.value)} />
          </label>
          <button
            className="secondary-action"
            type="button"
            onClick={async () => {
              const name = presetName.trim().slice(0, 40) || tt("customization.defaultPresetName");
              s.setPresets(await window.desktopPet.saveCustomizationPreset({ name, ...snapshot() }));
              setPresetName("");
              s.refreshPresetThumbnails();
            }}
          >
            {tt("settings.customization.presetSaveButton")}
          </button>
        </div>
        <button
          className="secondary-action"
          type="button"
          onClick={async () => {
            const result = await window.desktopPet.importCustomizationPreset();
            if (result?.ok === false) {
              if (!result.canceled) s.showError(result.error || tt("customization.importFailedError"));
              return;
            }
            if (result?.preset) s.applyCustomizationSnapshot(result.preset);
          }}
        >
          {tt("settings.customization.presetImportButton")}
        </button>
        <Note>{tt("settings.customization.presetsNote")}</Note>
      </div>
      <div className="settings-group">
        <h2>{tt("settings.customization.faceHeading")}</h2>
        {FACE_CUSTOMIZATION_DEFS.map((def) => <CustomizationSelect key={def.key} def={def} />)}
      </div>
      <div className="settings-group">
        <h2>{tt("customFace.heading")}</h2>
        <ToggleRow
          checked={d.customFaceEnabled}
          onChange={(checked) => {
            const merged = { ...d, customFaceEnabled: checked } as Draft;
            set("customFaceEnabled", checked);
            window.desktopPet.previewFaceCustomization(faceCustomizationPayload(merged));
          }}
          label={tt("customFace.enableToggle")}
        />
        <button
          className="secondary-action"
          type="button"
          onClick={async () => {
            s.clearError();
            const result = await window.desktopPet.importCustomFaceZip();
            if (result?.ok === false) {
              if (!result.canceled) s.showError(result.error || tt("customFace.invalidZipError"));
              return;
            }
            s.setCustomFaceKeys(result?.keys || []);
          }}
        >
          {tt("customFace.importButton")}
        </button>
        <div className="setting-note">
          {s.customFaceKeys.length > 0
            ? tt("customFace.statusLoaded", { count: s.customFaceKeys.length, keys: s.customFaceKeys.join(", ") })
            : tt("customFace.statusNone")}
        </div>
        <Note>{tt("customFace.note")}</Note>
      </div>
      <div className="settings-group">
        <h2>{tt("settings.customization.bodyHeading")}</h2>
        {BODY_CUSTOMIZATION_DEFS.map((def) => <CustomizationSelect key={def.key} def={def} />)}
      </div>
      <div className="settings-group">
        <h2>{tt("customBody.heading")}</h2>
        <ToggleRow
          checked={d.customBodyEnabled}
          onChange={(checked) => {
            const merged = { ...d, customBodyEnabled: checked } as Draft;
            set("customBodyEnabled", checked);
            window.desktopPet.previewFaceCustomization(faceCustomizationPayload(merged));
          }}
          label={tt("customBody.enableToggle")}
        />
        <button
          className="secondary-action"
          type="button"
          onClick={async () => {
            s.clearError();
            const result = await window.desktopPet.importCustomBodyImage();
            if (result?.ok === false) {
              if (!result.canceled) s.showError(result.error || tt("customBody.invalidImageError"));
              return;
            }
            s.setCustomBodyHas(true);
          }}
        >
          {tt("customBody.importButton")}
        </button>
        <div className="setting-note">
          {s.customBodyHas ? tt("customBody.statusLoaded") : tt("customBody.statusNone")}
        </div>
        <Note>{tt("customBody.note")}</Note>
      </div>
      <div className="settings-group">
        <h2>{tt("settings.customization.bodyColorHeading")}</h2>
        {BODY_COLOR_DEFS.map((def) => {
          const entry = s.bodyColors.find((candidate) => candidate.id === def.id);
          return (
            <SettingRow asDiv key={def.id} label={tt("bodyColor.colorSuffix", { part: tt(def.labelKey) })}>
              <ColorField
                value={entry?.color || def.defaultColor}
                placeholder={def.defaultColor}
                ariaLabel={tt("bodyColor.colorSuffix", { part: tt(def.labelKey) })}
                onPreview={(hex) => {
                  s.previewBodyColorsNow(s.bodyColors.map((candidate) => (candidate.id === def.id ? { ...candidate, color: hex } : candidate)));
                }}
                onCommit={(hex) => {
                  s.previewBodyColorsNow(s.bodyColors.map((candidate) => (candidate.id === def.id ? { ...candidate, color: hex } : candidate)));
                  s.markDirty();
                }}
              />
            </SettingRow>
          );
        })}
      </div>
      <div className="settings-group">
        <h2>{tt("settings.customization.partVariationHeading")}</h2>
        <Note>{tt("settings.customization.partVariationNote")}</Note>
        {PART_VARIATION_DEFS.map((def) => {
          const entry = s.partVariations.find((candidate) => candidate.id === def.id);
          return (
            <SettingRow key={def.id} label={tt(def.labelKey)}>
              <select
                className="part-variation-select"
                value={entry?.variation || def.defaultVariation}
                onChange={(event) => {
                  s.previewPartVariationsNow(
                    s.partVariations.map((candidate) => (candidate.id === def.id ? { ...candidate, variation: event.target.value } : candidate))
                  );
                  s.markDirty();
                }}
              >
                {def.variations.map((variation) => (
                  <option key={variation} value={variation}>
                    {VARIATION_LABEL_KEYS[variation] ? tt(VARIATION_LABEL_KEYS[variation]) : variation}
                  </option>
                ))}
              </select>
            </SettingRow>
          );
        })}
      </div>
    </>
  );
}

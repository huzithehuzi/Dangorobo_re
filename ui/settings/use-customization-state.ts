// 외형·커스터마이징 탭이 쓰는 폼 밖 상태.
//
// 설정창 셸(App.tsx)이 `useState` 열여덟 개를 혼자 들고 있던 것을 성격별로 가르는 첫 단계다.
// 여기 모은 아홉 개는 전부 "펫의 외형을 지금 어떻게 보여줄 것인가"에 속하고, 폼 초안(Draft)과
// 달리 저장 payload에서도 `ComplexState`로 따로 묶여 나간다.
//
// 미리보기 세 개(조명·바디 색·파츠)를 여기 두는 이유는 전부 자기 상태를 읽어 그대로 펫 창에
// 보내는 일이기 때문이다. 반면 얼굴 미리보기와 프리셋 적용은 Draft를 함께 고쳐야 해서
// 셸에 남겨 두었다 — 소유자가 갈리는 자리다.

import { useCallback, useRef, useState } from "react";
import {
  GradientStop, LightingState,
  normalizeBodyColors, normalizeGradientStops, normalizeLightingState, normalizePartVariations
} from "./store";

type BodyColorEntry = { id: string; color: string };
type PartVariationEntry = { id: string; variation: string };

function useCustomizationState() {
  const [paletteStops, setPaletteStops] = useState<GradientStop[]>([]);
  const [selectedStop, setSelectedStop] = useState(0);
  const [lighting, setLighting] = useState<LightingState>({});
  const [bodyColors, setBodyColors] = useState<BodyColorEntry[]>([]);
  const [partVariations, setPartVariations] = useState<PartVariationEntry[]>([]);
  const [presets, setPresets] = useState<CustomizationPreset[]>([]);
  const [presetThumbnails, setPresetThumbnails] = useState<Record<string, string>>({});
  const [customFaceKeys, setCustomFaceKeys] = useState<string[]>([]);
  const [customBodyHas, setCustomBodyHas] = useState(false);

  // 썸네일은 펫 창에 오프스크린 렌더를 시켜 받아오므로 한 번에 하나만 돈다. 요청이 겹치면
  // 큐에 표시만 해 두고 끝난 뒤 한 번 더 돌린다(모든 요청을 쌓으면 렌더가 밀린다).
  const presetsRef = useRef<CustomizationPreset[]>([]);
  const thumbnailPendingRef = useRef(false);
  const thumbnailQueuedRef = useRef(false);
  presetsRef.current = presets;

  const refreshPresetThumbnails = useCallback(() => {
    if (!presetsRef.current.length) return;
    if (thumbnailPendingRef.current) {
      thumbnailQueuedRef.current = true;
      return;
    }
    thumbnailPendingRef.current = true;
    window.desktopPet.renderPresetThumbnails(presetsRef.current)
      .then((rendered) => {
        if (rendered && Object.keys(rendered).length) {
          setPresetThumbnails((prev) => ({ ...prev, ...rendered }));
        }
      })
      .catch((error) => {
        console.error("[Settings] Render preset thumbnails failed:", error);
      })
      .finally(() => {
        thumbnailPendingRef.current = false;
        if (thumbnailQueuedRef.current) {
          thumbnailQueuedRef.current = false;
          refreshPresetThumbnails();
        }
      });
  }, []);

  // 미리보기는 값을 주면 그 값으로, 안 주면 지금 상태로 보낸다. setState 콜백 안에서 보내는
  // 이유는 방금 setX(...)를 부른 직후에도 최신 값을 읽기 위해서다.
  const previewLightingNow = useCallback((value?: LightingState) => {
    setLighting((prev) => {
      const target = value ?? prev;
      window.desktopPet.previewLighting(JSON.parse(JSON.stringify(target)));
      return target;
    });
  }, []);
  const previewBodyColorsNow = useCallback((value?: BodyColorEntry[]) => {
    setBodyColors((prev) => {
      const target = value ?? prev;
      window.desktopPet.previewBodyColors(target.map((entry) => ({ ...entry })));
      return target;
    });
  }, []);
  const previewPartVariationsNow = useCallback((value?: PartVariationEntry[]) => {
    setPartVariations((prev) => {
      const target = value ?? prev;
      window.desktopPet.previewPartVariations(target.map((entry) => ({ ...entry })));
      return target;
    });
  }, []);

  /** 설정을 불러왔을 때 이 군집의 상태를 한꺼번에 채운다. */
  const applyFromSettings = useCallback((settings: Record<string, unknown>) => {
    setPaletteStops(normalizeGradientStops(settings.paletteCustomStops));
    setSelectedStop(0);
    setLighting(normalizeLightingState(settings.lighting));
    setBodyColors(normalizeBodyColors(settings.bodyColors));
    setPartVariations(normalizePartVariations(settings.partVariations));
    setPresets(Array.isArray(settings.customizationPresets) ? (settings.customizationPresets as CustomizationPreset[]) : []);
    // 커스텀 텍스처는 선택 자원이라 실패해도 설정 화면을 막지 않는다.
    window.desktopPet.getCustomFaceTextures()
      .then((textures) => setCustomFaceKeys(Object.keys(textures || {})))
      .catch((error) => console.error("[Settings] Load custom face textures failed:", error));
    window.desktopPet.getCustomBodyTexture()
      .then((dataUrl) => setCustomBodyHas(Boolean(dataUrl)))
      .catch((error) => console.error("[Settings] Load custom body texture failed:", error));
  }, []);

  return {
    paletteStops, setPaletteStops,
    selectedStop, setSelectedStop,
    lighting, setLighting,
    bodyColors, setBodyColors,
    partVariations, setPartVariations,
    presets, setPresets,
    presetThumbnails, refreshPresetThumbnails,
    customFaceKeys, setCustomFaceKeys,
    customBodyHas, setCustomBodyHas,
    previewLightingNow, previewBodyColorsNow, previewPartVariationsNow,
    applyFromSettings
  };
}

export { useCustomizationState };
export type { BodyColorEntry, PartVariationEntry };

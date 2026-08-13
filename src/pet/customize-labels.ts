// 커스터마이징 모드의 3D 라벨 카드와 색 팔레트 오버레이.
//
// 라벨 카드·연결선·좌우 배정·팔레트 열림 상태를 이 모듈이 소유하고, 렌더러는 isActive()로
// 읽고 매 프레임 updateLayout()을 부른다. 세터를 주입받지 않는다.
//
// 파츠의 3D 앵커와 드래그 중 로컬 색 적용만 콜백으로 받는다. 앵커는 loadedMeshes·ears·
// headgear·tailPivot·facePlates·bodyPlates 여섯 그릇을 봐야 하고 로컬 색은 latestSettings
// 소유권이 렌더러에 있어서다 — 둘을 콜백으로 접으면 주입 표면이 그만큼 줄어든다.
//
// 팔레트 본체(색 변환·핸들·드래그·hex 칸)는 `src/shared/color-picker.js`에 있고 설정창과
// 공유한다. 여기 있는 건 이 창에만 있는 것뿐이다 — 어느 파츠를 편집 중인지, 그리고 팔레트를
// 파츠 카드 옆 어디에 띄울지.
//
// 드래그 중에는 화면에만 반영하고(preview), 손을 떼면 한 번만 저장한다(commit).
// 매 프레임 commit하면 main이 pet-settings.json을 초당 수십 번 쓴다.

import * as THREE from "three";
import { assignCustomizeSides } from "./customize-layout.js";
import {
  CUSTOMIZE_TOOLBAR_SPACE,
  CUSTOMIZE_TOP_LIMIT,
  labelRowLeft,
  leaderGeometry,
  stackLabelColumn
} from "./customize-label-layout.js";

type CustomizeSide = "left" | "right";
type CustomizeAssignmentSlot = { side: CustomizeSide; order: number };

type CustomizeRow = {
  row: HTMLDivElement;
  card: HTMLDivElement;
  leader: HTMLSpanElement;
  name: HTMLSpanElement;
  hex: HTMLInputElement;
  swatch: HTMLButtonElement;
  preview: (value: string) => string | null;
  commit: (value: string) => boolean;
};

type CustomizeLayoutItem = {
  def: PetBodyColorDefinition;
  parts: CustomizeRow;
  order: number;
  anchorX: number;
  anchorY: number;
  height: number;
  width: number;
  top: number;
};

type CustomizeLabelElements = {
  layer: HTMLElement;
  labelsHost: HTMLElement;
  palette: HTMLElement;
  doneButton: HTMLElement;
  cancelButton: HTMLElement;
};

type CustomizeLabelDependencies = {
  elements: CustomizeLabelElements;
  camera: THREE.Camera;
  canvas: HTMLCanvasElement;
  translate: (key: string, vars?: Record<string, unknown>) => string;
  /** 파츠 id의 3D 앵커. 실제 오브젝트라 애니메이션에도 라벨이 따라간다. */
  anchorObject: (id: string) => THREE.Object3D | null;
  /** 드래그 중 미리보기 — 디스크에 쓰지 않고 이 창의 머티리얼만 갱신한다. */
  applyLocalColor: (id: string, color: string) => void;
};

function createCustomizeLabels(deps: CustomizeLabelDependencies) {
  const el = deps.elements;
  const tt = deps.translate;
  const { BODY_COLOR_DEFS } = window.PetCustomizationCatalog;

  const rows: Map<string, CustomizeRow> = new Map();
  const anchorVec = new THREE.Vector3();
  let paletteTarget: CustomizeRow | null = null;
  let modeActive = false;

  // 좌우 열 배정과 열 안의 순서는 **모드에 들어갈 때 한 번만** 정하고 그 뒤로는 고정한다.
  // 처음엔 매 프레임 "지금 항목이 적은 쪽"으로 배정했는데, 펫이 숨쉬기·꼬리 흔들기로 계속
  // 움직이면 anchorY 정렬 순서가 흔들려 카드가 좌우로 튀고 순서가 수시로 바뀌었다
  // ("파츠 순서가 수시로 막 바뀜" 피드백, 2026-08-06). 배정 자체는 그대로 두고(파츠 구성에
  // 따라 저절로 균형이 잡히는 장점은 유지) 계산 시점만 진입 1회로 옮긴 것.
  let assignment: Map<string, CustomizeAssignmentSlot> | null = null;
  let assignmentSignature = "";

  const picker = window.PetColorPicker.createPanel({
    onPreview: (hex: string) => paletteTarget?.preview(hex),
    onCommit: (hex: string) => paletteTarget?.commit(hex)
  });
  el.palette.append(picker.element);

  function closePalette() {
    paletteTarget = null;
    el.palette.hidden = true;
  }

  // 팔레트를 카드 옆에 띄운다. 좌측 열 카드는 카드 오른쪽(펫 쪽), 우측 열 카드는 왼쪽에
  // 붙여 화면 밖으로 나가지 않게 한다.
  function openPalette(entry: CustomizeRow) {
    if (paletteTarget === entry) {
      closePalette();
      return;
    }
    paletteTarget = entry;
    el.palette.hidden = false;
    picker.setColor(String(entry.swatch.dataset.color || "#ffffff").toLowerCase());
    const rowRect = entry.row.getBoundingClientRect();
    const paletteWidth = el.palette.offsetWidth;
    const paletteHeight = el.palette.offsetHeight;
    const side = entry.row.dataset.side === "right" ? "right" : "left";
    const left = side === "left"
      ? Math.min(window.innerWidth - paletteWidth - 4, rowRect.right + 6)
      : Math.max(4, rowRect.left - paletteWidth - 6);
    const top = Math.max(4, Math.min(window.innerHeight - paletteHeight - 4, rowRect.top));
    el.palette.style.left = `${Math.round(left)}px`;
    el.palette.style.top = `${Math.round(top)}px`;
  }

  function buildLabels() {
    if (rows.size) return;
    for (const def of BODY_COLOR_DEFS) {
      const row = document.createElement("div");
      row.className = "customize-row";
      row.dataset.part = def.id;

      const card = document.createElement("div");
      card.className = "customize-card";

      const name = document.createElement("span");
      name.className = "customize-name";

      // 이름은 위, 값(hex + 스와치)은 아래 — 한 줄로 늘어놓으면 "머리 장식 색상"처럼 긴
      // 이름이 카드 폭(펫 좌우 여백 ~190px)을 넘겨 잘린다.
      const valueRow = document.createElement("span");
      valueRow.className = "customize-value-row";

      const hex = document.createElement("input");
      hex.className = "customize-hex";
      hex.type = "text";
      hex.maxLength = 7;
      hex.spellcheck = false;

      const swatch = document.createElement("button");
      swatch.className = "customize-swatch";
      swatch.type = "button";

      valueRow.append(hex, swatch);
      card.append(name, valueRow);
      // 연결선은 카드와 파츠를 잇는다. 위치/길이/각도는 매 프레임 갱신한다.
      const leader = document.createElement("span");
      leader.className = "customize-leader";
      row.append(leader, card);
      el.labelsHost.appendChild(row);

      // preview: 카드 표시 + 펫 머티리얼만 즉시 갱신(디스크 쓰기 없음). 드래그 중에 쓴다.
      // commit: 여기에 영속화까지 더한 것. 드래그를 끝냈을 때/hex를 확정했을 때만 쓴다.
      const preview = (value: string) => {
        const normalized = String(value || "").trim().toLowerCase();
        if (!/^#[0-9a-f]{6}$/.test(normalized)) return null;
        hex.value = normalized.toUpperCase();
        swatch.dataset.color = normalized;
        swatch.style.background = normalized;
        deps.applyLocalColor(def.id, normalized);
        return normalized;
      };
      const commit = (value: string) => {
        const normalized = preview(value);
        if (!normalized) return false;
        window.desktopPet.setCustomizeColor(def.id, normalized);
        return true;
      };
      const entry = { row, card, leader, name, hex, swatch, preview, commit };
      swatch.addEventListener("click", () => openPalette(entry));
      hex.addEventListener("change", () => {
        // 잘못된 값을 넣으면 지금 적용된 색으로 되돌린다.
        if (!commit(hex.value)) hex.value = String(swatch.dataset.color || "").toUpperCase();
      });
      hex.addEventListener("keydown", (event) => {
        if (event.key === "Enter") { event.preventDefault(); hex.blur(); }
      });

      rows.set(def.id, entry);
    }
  }

  // 지금 설정값을 각 라벨의 입력칸에 채운다. 파츠 이름도 여기서 다시 찍는다 — 카드는 한 번만
  // 만들어두고 재사용하므로, 언어를 바꿨을 때 이 경로가 없으면 이름이 옛 언어로 남는다.
  function syncInputs(entries: PetBodyColor[] | null | undefined) {
    const list = Array.isArray(entries) ? entries : [];
    for (const def of BODY_COLOR_DEFS) {
      const parts = rows.get(def.id);
      if (!parts) continue;
      const label = tt("bodyColor.colorSuffix", { part: tt(def.labelKey) });
      parts.name.textContent = label;
      parts.swatch.setAttribute("aria-label", label);
      const raw = list.find((entry) => entry?.id === def.id)?.color;
      const color = /^#[0-9a-fA-F]{6}$/.test(String(raw || "")) ? String(raw).toLowerCase() : def.defaultColor;
      parts.swatch.dataset.color = color;
      parts.swatch.style.background = color;
      // 입력 중인 칸은 건드리지 않는다(타이핑이 되돌려지는 걸 막는다).
      if (document.activeElement !== parts.hex) parts.hex.value = color.toUpperCase();
    }
  }

  // "지금 라벨을 붙일 수 있는 파츠 목록"의 지문. 이게 그대로면 배정을 다시 계산하지 않는다.
  // 예전에는 pet:settings-updated를 받을 때마다 배정을 무효화했는데, 색을 저장하면 main이
  // 바로 그 이벤트를 되돌려 보내기 때문에 **색을 고를 때마다 순서가 재계산**됐다
  // ("파츠 순서가 움직이는 버그 아직 있음", 2026-08-06). 파츠 구성이 실제로 달라졌을
  // 때만(머리 장식 제거, 커스텀 얼굴 전환, 프리셋 적용 등) 다시 잡는다.
  function visibleSignature() {
    return BODY_COLOR_DEFS.filter((def) => deps.anchorObject(def.id)).map((def) => def.id).join(",");
  }

  function computeAssignment() {
    const renderHeight = deps.canvas.clientHeight;
    const renderTop = window.innerHeight - renderHeight;
    const measured: { id: string, anchorY: number }[] = [];
    for (const def of BODY_COLOR_DEFS) {
      if (!rows.has(def.id)) continue;
      const anchor = deps.anchorObject(def.id);
      if (!anchor) continue;
      anchor.getWorldPosition(anchorVec).project(deps.camera);
      measured.push({ id: def.id, anchorY: renderTop + (1 - anchorVec.y) * renderHeight / 2 });
    }
    return assignCustomizeSides(measured);
  }

  function updateLayout() {
    if (!modeActive || el.layer.hidden) return;
    const renderHeight = deps.canvas.clientHeight;
    const renderTop = window.innerHeight - renderHeight;
    // 지문이 바뀌었을 때만 재계산한다(매 프레임 검사지만 10개 조회라 값이 싸다).
    const signature = visibleSignature();
    if (!assignment || signature !== assignmentSignature) {
      assignment = computeAssignment();
      assignmentSignature = signature;
    }

    const columns: Record<CustomizeSide, CustomizeLayoutItem[]> = { left: [], right: [] };
    for (const def of BODY_COLOR_DEFS) {
      const parts = rows.get(def.id);
      if (!parts) continue;
      const anchor = deps.anchorObject(def.id);
      const slot = assignment.get(def.id);
      // 지금 안 보이는 파츠(머리 장식 없음, 커스텀 얼굴이 켜져 눈·입이 숨은 경우 등)는
      // 라벨도 숨긴다 — 안 보이는 걸 가리키는 연결선이 남으면 더 헷갈린다.
      if (!anchor || !slot) {
        parts.row.hidden = true;
        continue;
      }
      parts.row.hidden = false;
      anchor.getWorldPosition(anchorVec).project(deps.camera);
      columns[slot.side].push({
        def,
        parts,
        order: slot.order,
        anchorX: (anchorVec.x + 1) / 2 * window.innerWidth,
        anchorY: renderTop + (1 - anchorVec.y) * renderHeight / 2,
        height: 0,
        width: 0,
        top: 0
      });
    }
    // 세로 순서도 진입 때 정한 order로 고정한다(anchorY로 매 프레임 다시 정렬하지 않는다).
    columns.left.sort((a, b) => a.order - b.order);
    columns.right.sort((a, b) => a.order - b.order);

    const bounds = {
      topLimit: CUSTOMIZE_TOP_LIMIT,
      bottomLimit: window.innerHeight - CUSTOMIZE_TOOLBAR_SPACE
    };
    const sides: CustomizeSide[] = ["left", "right"];
    for (const side of sides) {
      const column = columns[side];
      // 카드 크기는 DOM에서 재고, 어디에 놓을지는 customize-label-layout.ts가 정한다.
      for (const item of column) {
        item.height = item.parts.card.offsetHeight || 44;
        item.width = item.parts.card.offsetWidth || 132;
      }
      const tops = stackLabelColumn(column, bounds);
      for (const [index, item] of column.entries()) {
        item.top = tops[index];
        const { parts, top, width, height } = item;
        parts.row.dataset.side = side;
        parts.row.style.top = `${top}px`;
        parts.row.style.left = `${labelRowLeft(side, width, window.innerWidth)}px`;

        const leader = leaderGeometry(
          side,
          { width, height, top },
          { x: item.anchorX, y: item.anchorY },
          window.innerWidth
        );
        parts.leader.style.width = `${leader.length}px`;
        parts.leader.style.top = `${leader.top}px`;
        parts.leader.style.left = `${leader.left}px`;
        parts.leader.style.transform = `rotate(${leader.rotationRad}rad)`;
        parts.leader.style.transformOrigin = leader.transformOrigin;
      }
    }
  }

  function setActive(active: boolean, entries: PetBodyColor[] | null | undefined) {
    modeActive = Boolean(active);
    if (modeActive) {
      buildLabels();
      syncInputs(entries);
      // 배정은 진입할 때마다 새로 계산한다(그 사이 파츠 구성이 바뀌었을 수 있다).
      assignment = null;
      assignmentSignature = "";
      el.layer.hidden = false;
      requestAnimationFrame(updateLayout);
    } else {
      el.layer.hidden = true;
      closePalette();
    }
  }

  // 팔레트 바깥을 누르면 닫는다.
  window.addEventListener("mousedown", (event) => {
    if (el.palette.hidden) return;
    const clicked = event.target;
    if (clicked instanceof Element && el.palette.contains(clicked)) return;
    if (clicked instanceof Element && clicked.classList.contains("customize-swatch")) return;
    closePalette();
  });

  el.doneButton?.addEventListener("click", () => window.desktopPet.exitCustomizeMode());
  el.cancelButton?.addEventListener("click", () => window.desktopPet.cancelCustomizeMode());
  // Esc는 일반적인 대화상자 관례대로 "취소"(진입 시점 색으로 되돌리고 닫기)로 동작한다.
  // 팔레트가 열려 있으면 먼저 팔레트만 닫는다.
  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !modeActive) return;
    if (!el.palette.hidden) {
      closePalette();
      return;
    }
    window.desktopPet.cancelCustomizeMode();
  });

  return {
    /** 커스터마이징 모드가 켜져 있는지. 렌더러는 읽기만 한다. */
    isActive: () => modeActive,
    setActive,
    syncInputs,
    updateLayout
  };
}

export { createCustomizeLabels };
export type { CustomizeLabelDependencies, CustomizeLabelElements };

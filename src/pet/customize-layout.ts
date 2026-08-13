// 커스터마이징 모드에서 파츠 라벨을 펫 좌우 어느 열에 몇 번째로 놓을지 정한다.
// renderer.ts에서 떼어냈다 — 3D 앵커를 화면 좌표로 투영하는 일은 렌더러가 하고, 여기에는
// 측정된 y만 보고 배정하는 규칙을 둔다.
//
// 좌우 배치는 진입 시점의 머리 포즈에 따라 실행마다 달라져 캡처 회귀로는 고정할 수 없다.
// "위에서부터 번갈아, 같으면 왼쪽 먼저"라는 규칙 자체는 여기서 테스트로 고정한다.

type CustomizeSide = "left" | "right";
type CustomizeAssignmentSlot = { side: CustomizeSide; order: number };
/** 파츠 앵커를 화면에 투영한 y(위쪽이 작다). */
type CustomizeMeasuredAnchor = { id: string; anchorY: number };

function assignCustomizeSides(
  measured: readonly CustomizeMeasuredAnchor[]
): Map<string, CustomizeAssignmentSlot> {
  const ordered = [...measured].sort((a, b) => a.anchorY - b.anchorY);
  const assignment: Map<string, CustomizeAssignmentSlot> = new Map();
  const counts = { left: 0, right: 0 };
  for (const entry of ordered) {
    const side: CustomizeSide = counts.left <= counts.right ? "left" : "right";
    assignment.set(entry.id, { side, order: counts[side] });
    counts[side] += 1;
  }
  return assignment;
}

export { assignCustomizeSides };
export type { CustomizeSide, CustomizeAssignmentSlot, CustomizeMeasuredAnchor };

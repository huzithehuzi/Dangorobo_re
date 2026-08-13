// 커스터마이징 라벨 카드의 세로 쌓기와 연결선 기하. renderer.ts에서 떼어냈다.
// DOM 생성·측정과 스타일 대입은 렌더러가 하고, 여기에는 측정값만 보는 계산을 둔다.
//
// 좌우 열 배정은 customize-layout.ts가 따로 맡는다(진입 시 1회). 이 모듈은 그렇게 정해진
// 열 안에서 카드가 서로 겹치지도, 창 밖으로 넘치지도 않게 y를 정하는 일만 한다.

const CUSTOMIZE_ROW_GAP = 6;
const CUSTOMIZE_SIDE_MARGIN = 8;
// 창 아래쪽 툴바(안내 문구 + 완료 버튼)가 차지하는 높이. 카드가 여기까지 내려오지 않게 한다.
const CUSTOMIZE_TOOLBAR_SPACE = 48;
// 카드가 창 위쪽에 딱 붙지 않도록 두는 최소 여백.
const CUSTOMIZE_TOP_LIMIT = 4;

type CustomizeSide = "left" | "right";
type StackItem = { anchorY: number; height: number };
type StackBounds = { topLimit: number; bottomLimit: number; gap?: number };
type LeaderGeometry = {
  length: number;
  left: number;
  top: number;
  rotationRad: number;
  transformOrigin: string;
};

/**
 * 한 열의 카드 y를 정한다. 파츠는 전부 창 아래쪽(캔버스 420px 영역)에 몰려 있어서 앵커에서
 * 아래로만 밀면 카드가 창 밖으로 넘치고 툴바와도 겹친다. 위에서 아래로 한 번 밀어 겹침을
 * 없앤 뒤, 아래쪽이 넘치면 뒤에서부터 다시 끌어올린다(전형적인 라벨 배치 2패스).
 *
 * 항목은 이미 표시 순서대로 정렬돼 있다고 본다. 돌려주는 배열은 그 순서와 같다.
 */
function stackLabelColumn(items: readonly StackItem[], bounds: StackBounds): number[] {
  const { topLimit, bottomLimit } = bounds;
  const gap = bounds.gap ?? CUSTOMIZE_ROW_GAP;
  const tops: number[] = [];

  let nextTop = topLimit;
  for (const item of items) {
    const top = Math.max(nextTop, Math.round(item.anchorY - item.height / 2));
    tops.push(top);
    nextTop = top + item.height + gap;
  }

  let pushUpLimit = bottomLimit;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    tops[index] = Math.max(topLimit, Math.min(tops[index], pushUpLimit - items[index].height));
    pushUpLimit = tops[index] - gap;
  }
  return tops;
}

/** 카드가 붙는 창 가로 위치. 오른쪽 열은 카드 폭만큼 안으로 들어와야 한다. */
function labelRowLeft(side: CustomizeSide, cardWidth: number, viewportWidth: number): number {
  return side === "left"
    ? CUSTOMIZE_SIDE_MARGIN
    : Math.round(viewportWidth - CUSTOMIZE_SIDE_MARGIN - cardWidth);
}

/**
 * 카드의 안쪽 끝에서 파츠까지 잇는 연결선. 카드가 파츠보다 위아래로 밀렸을 수 있으니
 * 세로 차이까지 반영해 실제 각도로 그린다.
 */
function leaderGeometry(
  side: CustomizeSide,
  card: { width: number; height: number; top: number },
  anchor: { x: number; y: number },
  viewportWidth: number
): LeaderGeometry {
  const cardInnerX = side === "left"
    ? CUSTOMIZE_SIDE_MARGIN + card.width
    : viewportWidth - CUSTOMIZE_SIDE_MARGIN - card.width;
  const dx = anchor.x - cardInnerX;
  const dy = anchor.y - (card.top + card.height / 2);
  const length = Math.max(0, Math.hypot(dx, dy));
  const angle = Math.atan2(dy, dx);
  return {
    length: Math.round(length),
    // 오른쪽 열은 카드 왼쪽으로 뻗으므로 선을 통째로 왼쪽에 놓고 반대 방향으로 돌린다.
    left: side === "left" ? card.width : -Math.round(length),
    top: Math.round(card.height / 2),
    rotationRad: side === "left" ? angle : angle - Math.PI,
    transformOrigin: side === "left" ? "left center" : "right center"
  };
}

export {
  CUSTOMIZE_ROW_GAP,
  CUSTOMIZE_SIDE_MARGIN,
  CUSTOMIZE_TOOLBAR_SPACE,
  CUSTOMIZE_TOP_LIMIT,
  stackLabelColumn,
  labelRowLeft,
  leaderGeometry
};
export type { StackItem, StackBounds, LeaderGeometry };

// preload IPC 이벤트의 조기 도착 대비 버퍼 (2026-08-10).
// main은 창의 did-finish-load 직후 초기 데이터를 send하는데, React의 useEffect 리스너
// 등록은 그보다 늦을 수 있어 이벤트가 유실된다(즐겨찾기 창에서 실제로 발생).
// 그래서 리스너는 모듈 평가 시점(= 스크립트 실행 중, load 이벤트 전)에 등록하고,
// 구독자가 붙기 전 도착한 이벤트는 쌓아뒀다가 구독 시 순서대로 전달한다.
// 바닐라 창들이 스크립트 최상위에서 리스너를 걸던 것과 같은 타이밍 보장이다.

export function createIpcFeed<T>(register: (callback: (value: T) => void) => void) {
  const buffer: T[] = [];
  const subscribers = new Set<(value: T) => void>();
  register((value) => {
    if (subscribers.size === 0) {
      buffer.push(value);
    } else {
      subscribers.forEach((subscriber) => subscriber(value));
    }
  });
  return {
    subscribe(callback: (value: T) => void): () => void {
      while (buffer.length > 0) {
        callback(buffer.shift()!);
      }
      subscribers.add(callback);
      return () => {
        subscribers.delete(callback);
      };
    }
  };
}

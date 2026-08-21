// 개발·QA 전용 명령줄 하네스. `--capture-*`는 창을 띄워 PNG로 찍고, `--qa-*`는 캡처로는
// 보이지 않는 값(프롬프트 문자열, 아이콘 출처, 히트 판정 좌표 등)을 파일로 덤프한다.
// 둘 다 마지막에 app.quit()을 부르므로 일반 실행 경로와 섞이지 않는다.
//
// main.ts의 whenReady에서 창 생성 직후 한 번 호출한다. 이 모듈은 자기 상태를 갖지 않고
// 필요한 창 핸들·설정·전환 함수를 전부 컨텍스트로 받는다 — 창 핸들은 여기서 create*Window()를
// 부른 뒤에 읽어야 하므로 값이 아니라 getter로 받는다.

import * as fs from "node:fs";
import { app, screen } from "electron";
import type { BrowserWindow } from "electron";
import { normalizeCustomizationPreset } from "./settings-schema.js";
import type { Settings } from "./settings-schema.js";
import { insertMemory, insertOpenLoop } from "./memory/memory-sqlite.js";
import { REST_WINDOW_EXTRA_TOP } from "./windows/pet-window-layout.js";
import type { RestAlert } from "./alarm-queue.js";
import type { FavoriteLaunchItem, FavoriteMenuItem } from "./windows/favorite-icon-service.js";

type Point = { x: number; y: number };
type WindowRef = () => BrowserWindow | null | undefined;

type QaCaptureContext = {
  argv: string[];
  // main.ts의 settings는 재대입되는 바인딩이라 값이 아니라 getter로 받는다. 캡처 분기는
  // 설정 파일에 저장하지 않고 이 객체만 고쳐서 "기능이 꺼진 기본 프로필에서도 찍을 수
  // 있게" 만든다.
  getSettings: () => Settings;
  translate: (language: string, key: string) => string;
  publicSettings: () => Settings & { assistantKeyConfigured: boolean };
  requireWindow: (win: BrowserWindow | null | undefined) => BrowserWindow;

  petWindow: WindowRef;
  settingsWindow: WindowRef;
  assistantLogWindow: WindowRef;
  checklistWindow: WindowRef;
  favoritesWindow: WindowRef;
  favoritesDockWindow: WindowRef;
  createSettingsWindow: () => void;
  createAssistantLogWindow: () => void;
  createChecklistWindow: () => void;
  createFavoritesWindow: () => void;
  createFavoritesDockWindow: (options?: { show?: boolean }) => void;

  openPetContextMenu: (cursorPoint: Point) => void;
  openFavoritesCursorPie: () => void;
  setFavoritesDockExpanded: (expanded: boolean) => void;
  setFavoritesPanelActive: (enabled: boolean) => void;
  setAssistantPanelActive: (enabled: boolean) => void;
  setCustomizeMode: (enabled: boolean) => void;
  setClickThrough: (enabled: boolean) => void;
  startRestAlert: (alarm: RestAlert) => void;
  isPointOverPet: (x: number, y: number) => boolean;

  assistantInstructions: () => string;
  relatedMemoryBlock: (question: string) => string;
  buildFavoriteLaunchItems: () => Promise<FavoriteLaunchItem[]>;
  hydrateFavoriteMenuItems: (items: FavoriteMenuItem[]) => Promise<FavoriteMenuItem[]>;
};

type QaCaptureResult = {
  // --qa-* 중 즉시 종료하는 분기가 걸렸다. 호출부는 나머지 초기화를 건너뛴다.
  stopInitialization: boolean;
  // 캡처 실행이다. 호출부는 전역 입력 훅과 단축키 등록을 건너뛴다.
  captureActive: boolean;
};

function argValue(argv: string[], prefix: string): string | null {
  const found = argv.find((arg) => arg.startsWith(prefix));
  return found === undefined ? null : found.slice(prefix.length);
}

function writeJson(filePath: string, value: unknown): void {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

/** did-finish-load 뒤 지정 시간만큼 기다렸다가 그 창을 찍고 종료한다. */
function captureWindowAfter(
  window: BrowserWindow,
  capturePath: string,
  delayMs: number,
  prepare?: () => void
): void {
  window.webContents.once("did-finish-load", () => {
    prepare?.();
    setTimeout(async () => {
      const image = await window.webContents.capturePage();
      fs.writeFileSync(capturePath, image.toPNG());
      app.quit();
    }, delayMs);
  });
}

/** 캡처로는 관측되지 않는 값을 파일로 덤프하는 --qa-* 분기들. */
function runQaProbes(ctx: QaCaptureContext): boolean {
  const { argv } = ctx;

  if (argv.some((arg) => arg.startsWith("--capture-context-menu="))) {
    // 즐겨찾기 그리드가 꺼진 프로필에서도 찍을 수 있게 켜준다(독 캡처와 같은 방식).
    // 메모리 안에서만 바꾸고 저장하지 않는다.
    ctx.getSettings().favoritesEnabled = true;
    ctx.getSettings().favoritesTrayItemsEnabled = true;
    setTimeout(() => ctx.openPetContextMenu({ x: 400, y: 200 }), 700);
  }

  // 즐겨찾기 아이콘이 실제로 어디서 왔는지(추출/템플릿/커스텀/없음) 항목별로 덤프한다.
  // 자동 아이콘 추출은 조용히 실패하면 렌더러에서 기본 별로 떨어져 티가 잘 안 나서,
  // 눈으로 스크린샷을 보는 대신 이걸로 확인한다(2026-08-07 추가).
  const favoriteIconPath = argValue(argv, "--qa-favorite-icons=");
  if (favoriteIconPath !== null) {
    setTimeout(async () => {
      const settings = ctx.getSettings();
      const launchItems = await ctx.buildFavoriteLaunchItems();
      const menuItems = await ctx.hydrateFavoriteMenuItems(settings.favoriteItems.map((favorite) => ({
        id: `favorite:${favorite.id}`,
        target: favorite.target,
        customIcon: favorite.customIcon || null,
        iconTemplate: favorite.customIcon ? null : favorite.iconTemplate || null,
        iconDataUrl: null
      })));
      const describe = (dataUrl: string | null | undefined) => (
        dataUrl ? `${dataUrl.slice(0, 22)}… (${dataUrl.length}b)` : null
      );
      writeJson(favoriteIconPath, settings.favoriteItems.map((favorite, index) => ({
        name: favorite.name,
        target: favorite.target,
        mode: favorite.customIcon ? "custom" : favorite.iconTemplate ? `template:${favorite.iconTemplate}` : "auto",
        launchIcon: describe(launchItems[index].icon),
        menuIcon: describe(menuItems[index].iconDataUrl)
      })));
      app.quit();
    }, 400);
  }

  const animalesePath = argValue(argv, "--qa-animalese-audio=");
  if (animalesePath !== null) {
    const animaleseWindow = ctx.requireWindow(ctx.petWindow());
    animaleseWindow.webContents.once("did-finish-load", async () => {
      try {
        const result = await animaleseWindow.webContents.executeJavaScript(`(async () => {
          const response = await fetch(new URL("../assets/sounds/animalese.wav", location.href));
          const data = await response.arrayBuffer();
          const context = new AudioContext();
          const buffer = await context.decodeAudioData(data);
          await context.close();
          return {
            ok: true,
            duration: buffer.duration,
            sampleRate: buffer.sampleRate,
            channels: buffer.numberOfChannels
          };
        })()`);
        writeJson(animalesePath, result);
      } catch (error) {
        writeJson(animalesePath, { ok: false, error: String(error) });
      }
      app.quit();
    });
    return true;
  }

  const assistantInstructionsPath = argValue(argv, "--qa-assistant-instructions=");
  if (assistantInstructionsPath !== null) {
    fs.writeFileSync(assistantInstructionsPath, ctx.assistantInstructions(), "utf8");
    app.quit();
    return true;
  }

  // --qa-memory-block=<파일>: 장기 기억이 실제로 대화 프롬프트에 붙는지 확인한다.
  // 임시 프로필에는 기억이 하나도 없으므로 샘플을 직접 넣고 만든다(즐겨찾기 캡처와 같은 방식).
  // --qa-memory-question=<질문>으로 검색어를 바꿔 관련도 순위도 확인할 수 있다.
  const memoryBlockPath = argValue(argv, "--qa-memory-block=");
  if (memoryBlockPath !== null) {
    const question = argValue(argv, "--qa-memory-question=") ?? "오늘 라떼를 마셨어";
    ctx.getSettings().assistantMemoryEnabled = true;
    insertMemory({
      category: "preference", memory_key: "coffee_taste",
      memory_label: "커피 취향", memory_value: "라떼를 좋아함", importance: 0.9
    });
    insertMemory({
      category: "habit", memory_key: "morning_run",
      memory_label: "아침 운동", memory_value: "매일 아침 달리기를 함", importance: 0.7
    });
    // open_loops.episode_id는 NOT NULL이다(외래 키 제약은 없다). 이 플래그는 블록 문구만
    // 확인하는 용도라 에피소드를 실제로 만들지 않고 자리값 1을 쓴다.
    insertOpenLoop({ episode_id: 1, topic: "자격증 시험 결과" });
    fs.writeFileSync(memoryBlockPath, ctx.relatedMemoryBlock(question), "utf8");
    app.quit();
    return true;
  }

  const hitTestPath = argValue(argv, "--qa-hit-test=");
  if (hitTestPath !== null) {
    const bounds = ctx.requireWindow(ctx.petWindow()).getBounds();
    const dipPoint = {
      x: bounds.x + bounds.width / 2,
      y: bounds.y + REST_WINDOW_EXTRA_TOP + 250
    };
    const screenPoint = screen.dipToScreenPoint(dipPoint);
    writeJson(hitTestPath, {
      dipPoint,
      screenPoint,
      roundTrip: screen.screenToDipPoint(screenPoint),
      hit: ctx.isPointOverPet(screenPoint.x, screenPoint.y)
    });
    app.quit();
    return true;
  }

  return false;
}

function captureFavoritesPanels(ctx: QaCaptureContext, dockCapture: boolean, capturePath: string): void {
  const { argv } = ctx;
  const settings = ctx.getSettings();
  // 가장 빽빽한 경우(최대 12개, 2026-08-07 이전엔 8개)로 찍어야 간격을 제대로 볼 수 있다.
  const sampleItems = ["메모장", "작업 폴더", "브라우저", "디스코드", "그림판", "터미널", "음악", "일정", "메일", "즐겨찾기", "시계", "설정"]
    .map((name, index) => ({
      id: `sample-${index}`,
      name,
      icon: null,
      iconTemplate: ["document", "folder", "globe", "chat", "image", "terminal", "music", "clock", "mail", "bookmark", "clock", "gear"][index],
      iconColor: "#ffffff"
    }));
  // --capture-favorites-dock-cursor를 같이 주면 "마우스 위치에 파이 메뉴" 방식으로 찍는다.
  const cursorCapture = dockCapture && argv.includes("--capture-favorites-dock-cursor");
  // 즐겨찾기 기능이 꺼진 프로필(기본값)에서도 찍을 수 있어야 한다 — 안 켜주면
  // openFavoritesCursorPie()가 맨 앞에서 그냥 돌아가 접힌 버튼만 찍힌다.
  settings.favoritesEnabled = true;
  if (cursorCapture) settings.favoritesDisplayMode = "cursor";
  if (dockCapture) ctx.createFavoritesDockWindow({ show: !cursorCapture });
  else ctx.createFavoritesWindow();
  const target = ctx.requireWindow(dockCapture ? ctx.favoritesDockWindow() : ctx.favoritesWindow());
  captureWindowAfter(target, capturePath, 900, () => {
    target.webContents.send("favorites:items", {
      items: sampleItems,
      layout: ctx.getSettings().favoritesLayout,
      hideLabels: ctx.getSettings().favoriteGridLabelsHidden === true
    });
    // 독은 펼친 모습이 핵심이라 기본으로 펼쳐서 찍는다(--capture-favorites-dock-collapsed로 접힌 모습).
    if (cursorCapture) setTimeout(() => ctx.openFavoritesCursorPie(), 300);
    else if (dockCapture && !argv.includes("--capture-favorites-dock-collapsed")) {
      setTimeout(() => ctx.setFavoritesDockExpanded(true), 300);
    }
  });
}

function captureSettingsWindow(
  ctx: QaCaptureContext,
  capturePath: string,
  defaultTab: string
): void {
  const { argv } = ctx;
  const settings = ctx.getSettings();
  // 커스터마이징 프리셋 썸네일(2026-08-06)은 저장된 프리셋이 하나도 없으면 찍을 게
  // 없다. --capture-preset-samples를 같이 주면 즐겨찾기 캡처와 같은 방식으로
  // 샘플 프리셋을 메모리에만 밀어 넣는다(설정 파일에는 저장하지 않는다).
  const presetSamples = argv.includes("--capture-preset-samples");
  if (presetSamples) {
    settings.customizationPresets = [
      { name: "여우", bodyColors: [{ id: "head", color: "#f2b06a" }, { id: "body", color: "#f2b06a" }, { id: "ears", color: "#e08a4a" }], partVariations: [{ id: "ears", variation: "fox" }], facePattern: 2 },
      { name: "토끼", bodyColors: [{ id: "head", color: "#ffffff" }, { id: "body", color: "#f4eef2" }, { id: "ears", color: "#f0c6d2" }], partVariations: [{ id: "ears", variation: "bunny" }, { id: "headgear", variation: "ribbon" }], faceEyeStyle: 2 },
      { name: "곰", bodyColors: [{ id: "head", color: "#8a6a52" }, { id: "body", color: "#8a6a52" }, { id: "ears", color: "#6f5340" }], partVariations: [{ id: "ears", variation: "bear" }, { id: "headgear", variation: "buckethat" }], faceCosmetic: 1 }
    ].map((preset) => normalizeCustomizationPreset(preset, settings.language));
  }
  ctx.createSettingsWindow();
  const settingsCaptureWindow = ctx.requireWindow(ctx.settingsWindow());
  settingsCaptureWindow.webContents.once("did-finish-load", () => {
    setTimeout(async () => {
      // --capture-settings-tab=<탭 이름>[:bottom]을 같이 주면 그 탭을 열고 찍는다.
      // (탭이 11개로 늘어나 ai/favorites 전용 플래그만으로는 부족해서 2026-08-06 추가)
      // :bottom을 붙이면 패널 아래쪽까지 스크롤한 상태로 찍는다.
      const tabRequest = argValue(argv, "--capture-settings-tab=") ?? "";
      const requestedTab = tabRequest.split(":")[0].replace(/[^a-z]/gi, "");
      const scrollToBottom = tabRequest.endsWith(":bottom");
      const targetTab = requestedTab || defaultTab;
      if (targetTab) {
        await settingsCaptureWindow.webContents.executeJavaScript(`document.querySelector('[data-tab="${targetTab}"]')?.click()`);
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
      if (scrollToBottom) {
        await settingsCaptureWindow.webContents.executeJavaScript("window.scrollTo(0, document.body.scrollHeight)");
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
      /* --capture-settings-press=<CSS 선택자>: 실제 누름 효과(파문·젤리 출렁임)를 찍는다.
         `--capture-settings-click`의 `el.click()`은 pointerdown을 만들지 않아서 ui-motion.js의
         누름 효과가 아예 돌지 않는다 — 그래서 그 경로로는 확인할 수 없다(2026-08-21 추가).
         **pointerdown과 pointerup을 모두 보낸다** — 파문은 누를 때, 출렁임은 놓을 때 돈다.
         애니메이션 중간(≈120ms)에 찍으려고 클릭 경로보다 짧게 기다린다. */
      const pressSelector = argValue(argv, "--capture-settings-press=");
      if (pressSelector !== null) {
        const pressed = await settingsCaptureWindow.webContents.executeJavaScript(
          `(() => { const el = document.querySelector(${JSON.stringify(pressSelector)});`
          + ` if (!el) return { found: false };`
          + ` el.scrollIntoView({ block: "center" });`
          + ` const rect = el.getBoundingClientRect();`
          + ` const options = { bubbles: true, button: 0,`
          + ` clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };`
          + ` el.dispatchEvent(new PointerEvent("pointerdown", options));`
          + ` el.dispatchEvent(new PointerEvent("pointerup", options));`
          + ` return { found: true, size: [Math.round(rect.width), Math.round(rect.height)],`
          + ` className: el.className, ripples: document.querySelectorAll(".ui-ripple").length }; })()`
        );
        /* 스크린샷만으로는 "효과가 안 돌았다"와 "이미 끝났다"를 구별할 수 없어 상태도 남긴다.
           size가 [0, 0]이면 활성 탭이 아닌 패널의 요소를 잡은 것이다 — 그런 요소에도 클래스는
           붙지만 화면에는 아무것도 안 보인다. 선택자를 `.tab-panel.active ...`로 좁힐 것. */
        console.log("[QA] 누름 효과:", JSON.stringify(pressed));
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
      /* --capture-settings-type=<선택자>::<문자열>: 입력칸에 값을 넣고 input 이벤트를 보낸다.
         설정 검색처럼 "입력해야만 나타나는 UI"를 확인하는 용도(2026-08-21 추가). */
      const typeRequest = argValue(argv, "--capture-settings-type=");
      if (typeRequest !== null) {
        const [typeSelector, ...textParts] = typeRequest.split("::");
        const typedText = textParts.join("::");
        await settingsCaptureWindow.webContents.executeJavaScript(
          `(() => { const el = document.querySelector(${JSON.stringify(typeSelector)});`
          + ` if (!el) return false; el.focus();`
          /* React 제어 입력은 value를 직접 대입해도 onChange가 돌지 않는다(React가 값을
             따로 추적한다). 프로토타입의 네이티브 setter로 넣어야 상태가 갱신된다. */
          + ` const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;`
          + ` setValue.call(el, ${JSON.stringify(typedText)});`
          + ` el.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`
        );
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      // --capture-settings-click=<CSS 선택자>로 찍기 직전에 아무 요소나 한 번 클릭할 수 있다.
      // 팝오버·아코디언처럼 펼쳐야만 보이는 UI를 확인하려고 2026-08-07에 추가.
      // "|"로 여러 선택자를 이으면 순서대로 짧은 간격을 두고 클릭한다(같은 선택자를 여러 번
      // 반복해도 된다) — 설정창 제목 5연타 같은 숨김 제스처를 확인하려고 2026-08-15 추가.
      const selector = argValue(argv, "--capture-settings-click=");
      if (selector !== null) {
        for (const step of selector.split("|")) {
          // 화면 밖 요소를 클릭하면 스크린샷에는 안 찍혀 확인이 안 되므로 먼저 보이는 곳까지
          // 스크롤한다(패널 중간에 있는 그룹을 찍는 용도로도 쓴다).
          await settingsCaptureWindow.webContents.executeJavaScript(
            `(() => { const el = document.querySelector(${JSON.stringify(step)});`
            + ` el?.scrollIntoView({ block: "center" }); el?.click(); })()`
          );
          await new Promise((resolve) => setTimeout(resolve, 160));
        }
      }
      // 프리셋 썸네일은 펫 창이 GLB를 다 로드한 뒤에야 그려지므로 좀 더 기다린다.
      if (presetSamples) await new Promise((resolve) => setTimeout(resolve, 2500));
      const image = await settingsCaptureWindow.webContents.capturePage();
      fs.writeFileSync(capturePath, image.toPNG());
      app.quit();
    }, 500);
  });
}

function capturePetWindow(
  ctx: QaCaptureContext,
  capturePath: string,
  flags: {
    rest: boolean;
    squish: boolean;
    petting: boolean;
    favorites: boolean;
    move: boolean;
    customize: boolean;
    assistantQuestion: boolean;
    assistantAnswer: boolean;
  }
): void {
  const { argv } = ctx;
  const petCaptureWindow = ctx.requireWindow(ctx.petWindow());
  petCaptureWindow.webContents.once("did-finish-load", () => {
    if (flags.rest) {
      const language = ctx.getSettings().language;
      // --capture-rest-weather를 같이 주면 날씨 배지 레이아웃(weatherLines)을 찍는다 —
      // 실제 API 호출 없이 고정 샘플로, 시계 아이콘이 빠지고 오늘/내일 오전·오후 4줄이
      // 나와야 한다.
      if (argv.includes("--capture-rest-weather")) {
        const lines = [
          { icon: "☀️", category: "clear", text: "오늘 오전 ▲27° ▼20° (강수 10%)" },
          { icon: "🌦️", category: "drizzle", text: "오늘 오후 ▲28° ▼22° (강수 60%)" },
          { icon: "⛅", category: "partlyCloudy", text: "내일 오전 ▲25° ▼19° (강수 30%)" },
          { icon: "🌧️", category: "rain", text: "내일 오후 ▲24° ▼21° (강수 80%)" }
        ];
        ctx.startRestAlert({
          title: ctx.translate(language, "weather.alertTitle"),
          message: lines.map((line) => `${line.icon} ${line.text}`).join("\n"),
          weatherLines: lines
        });
      } else {
        ctx.startRestAlert({
          title: ctx.translate(language, "alarm.defaultTitle"),
          message: ctx.translate(language, "alarm.defaultMessage")
        });
      }
    }
    if (flags.favorites) {
      ctx.setFavoritesPanelActive(true);
      petCaptureWindow.webContents.send("favorites:open", {
        items: [
          { id: "qa-one", name: "메모장" },
          { id: "qa-two", name: "작업 폴더" }
        ]
      });
    }
    if (flags.move) {
      petCaptureWindow.webContents.send("pet:settings-updated", { ...ctx.publicSettings(), bubbleTheme: "rose" });
      ctx.setClickThrough(false);
    }
    if (flags.assistantQuestion) {
      ctx.setAssistantPanelActive(true);
      petCaptureWindow.webContents.send("assistant:question-open");
    }
    if (flags.assistantAnswer) {
      ctx.setAssistantPanelActive(true);
      petCaptureWindow.webContents.send("assistant:question-open");
      setTimeout(() => ctx.petWindow()?.webContents.executeJavaScript(`
            document.querySelector("#assistant-question-bubble").hidden = true;
            const answer = document.querySelector("#assistant-answer-bubble");
            document.querySelector("#assistant-answer-text").textContent = "좋아요! 짧게 답하면, 지금처럼 Gemma 4를 연결하면 펫에게 질문하고 말풍선으로 답변을 받을 수 있어요.";
            answer.hidden = false;
          `), 250);
    }
    if (flags.squish) {
      setTimeout(() => ctx.petWindow()?.webContents.send("pet:squish-pulse", "keyboard"), 700);
    }
    if (flags.petting) {
      // 하트가 몇 개 떠 있는 모습을 보려면 캡처 시점까지 active:false를 보내지 않고 계속 켜둔다.
      setTimeout(() => ctx.petWindow()?.webContents.send("pet:petting", { active: true }), 500);
    }
    if (flags.customize) {
      // 모델 로드가 끝나야 파츠 월드 좌표가 잡히므로 살짝 기다린 뒤 모드를 켠다.
      setTimeout(() => ctx.setCustomizeMode(true), 600);
      // 색 팔레트를 펼친 상태로 찍고 싶으면 --capture-customize와 함께
      // --capture-customize-palette를 준다.
      if (argv.includes("--capture-customize-palette")) {
        setTimeout(() => ctx.petWindow()?.webContents.executeJavaScript(
          `document.querySelector('.customize-row[data-part="head"] .customize-swatch')?.click()`
        ), 1050);
      }
    }
    setTimeout(async () => {
      const image = await petCaptureWindow.webContents.capturePage();
      fs.writeFileSync(capturePath, image.toPNG());
      app.quit();
    }, flags.squish ? 748 : flags.petting ? 2500 : flags.assistantAnswer ? 1100 : flags.customize ? 1500 : 900);
  });
}

/**
 * `--capture-*`, `--qa-*` 인자를 처리한다. 해당 인자가 없으면 아무 일도 하지 않는다.
 *
 * 지원 인자의 최종 목록은 이 파일이 원본이다(개발 문서가 여기를 가리킨다).
 */
function runQaCaptureHarness(ctx: QaCaptureContext): QaCaptureResult {
  const { argv } = ctx;

  if (runQaProbes(ctx)) {
    return { stopInitialization: true, captureActive: false };
  }

  const logs = argValue(argv, "--capture-logs=");
  const checklist = argValue(argv, "--capture-checklist=");
  const settingsMain = argValue(argv, "--capture-settings=");
  const settingsAi = argValue(argv, "--capture-settings-ai=");
  const settingsFavorites = argValue(argv, "--capture-settings-favorites=");
  // 즐겨찾기 독립 창 / 플로팅 독(2026-08-06). 등록된 항목이 없어도 배치를 볼 수 있도록
  // 실제 설정 대신 샘플 항목을 직접 밀어 넣는다.
  const favoritesWindow = argValue(argv, "--capture-favorites-window=");
  const favoritesDock = argValue(argv, "--capture-favorites-dock=");
  const favorites = argValue(argv, "--capture-favorites=");
  const move = argValue(argv, "--capture-move=");
  const customize = argValue(argv, "--capture-customize=");
  const assistantQuestion = argValue(argv, "--capture-assistant-question=");
  const assistantAnswer = argValue(argv, "--capture-assistant-answer=");
  const rest = argValue(argv, "--capture-rest=");
  const squish = argValue(argv, "--capture-squish=");
  const petting = argValue(argv, "--capture-petting=");
  const normal = argValue(argv, "--capture=");

  // 경로를 받는 캡처 플래그는 한 번에 하나만 준다. 분리 전에도 두 개를 같이 주면 분기와
  // 경로를 서로 다른 우선순위로 고르는 조합이 있었으므로, 각 분기가 쓰는 우선순위를
  // 분리 전 그대로 유지한다.
  const capturePaths = [
    logs, checklist, settingsMain, settingsAi, settingsFavorites,
    favoritesWindow, favoritesDock, favorites, move, customize,
    assistantQuestion, assistantAnswer, rest, squish, petting, normal
  ];
  if (capturePaths.every((value) => value === null)) {
    return { stopInitialization: false, captureActive: false };
  }

  if (favoritesWindow !== null || favoritesDock !== null) {
    const dockCapture = favoritesDock !== null;
    captureFavoritesPanels(ctx, dockCapture, dockCapture ? favoritesDock : favoritesWindow as string);
  } else if (logs !== null) {
    ctx.createAssistantLogWindow();
    captureWindowAfter(ctx.requireWindow(ctx.assistantLogWindow()), logs, 550);
  } else if (checklist !== null) {
    // 체크리스트 캡처(2026-08-10 추가) — 항목까지 찍으려면 임시 프로필의 checklist.json에
    // 미리 items를 넣어두면 된다(시작 시 loadChecklistFromDisk()가 읽는다).
    ctx.createChecklistWindow();
    captureWindowAfter(ctx.requireWindow(ctx.checklistWindow()), checklist, 550);
  } else if (settingsMain !== null || settingsAi !== null || settingsFavorites !== null) {
    const defaultTab = settingsAi !== null ? "conversation" : settingsFavorites !== null ? "favorites" : "";
    captureSettingsWindow(ctx, settingsAi ?? settingsFavorites ?? settingsMain as string, defaultTab);
  } else {
    const petCapturePath = rest ?? squish ?? petting ?? favorites ?? move ?? customize
      ?? assistantQuestion ?? assistantAnswer ?? normal as string;
    capturePetWindow(ctx, petCapturePath, {
      rest: rest !== null,
      squish: squish !== null,
      petting: petting !== null,
      favorites: favorites !== null,
      move: move !== null,
      customize: customize !== null,
      assistantQuestion: assistantQuestion !== null,
      assistantAnswer: assistantAnswer !== null
    });
  }

  return { stopInitialization: false, captureActive: true };
}

export { runQaCaptureHarness };
export type { QaCaptureContext, QaCaptureResult };

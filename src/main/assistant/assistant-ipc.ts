import type { IpcMain } from "electron";
import * as path from "node:path";
import { extractAssistantExpression } from "./assistant-core.js";
import { TRANSLATE_LANGUAGES, normalizeTranslateLanguage } from "../settings-schema.js";
import type { Settings } from "../settings-schema.js";
import type { ImageResizeResult } from "../image-resize.js";

type AssistantIpcEvent = { sender: unknown };
type TranslateLanguage = Settings["translateTargetLanguage"];
type ConversationTurn = { question: string; answer: string };

const QUESTION_MAX_CHARS = 1000;
const REPLY_MAX_CHARS = 1000;
const ANSWER_MAX_CHARS = 4000;
const TRANSLATE_MAX_CHARS = 5000;
const DOCUMENT_MAX_CHARS = 1500;

type AssistantIpcDependencies = {
  getSettings: () => Settings;
  translate: (language: string, key: string, vars?: Record<string, string | number>) => string;
  /** Gemini 호출 실패를 사용자 문구로 바꾼다(경로별 정책이 달라 main.js가 들고 있다). */
  describeAssistantError: (error: unknown) => string;
  describeError: (error: unknown) => string;
  hasApiKey: () => boolean;
  isPetSender: (sender: unknown) => boolean;
  isAssistantPanelActive: () => boolean;
  isTranslatePanelActive: () => boolean;
  isDocumentSummaryPanelActive: () => boolean;
  isRestActive: () => boolean;
  isDndActive: () => boolean;
  askGemini: (question: string, extraTurns?: ConversationTurn[]) => Promise<string>;
  petChat: {
    isSessionActive: () => boolean;
    callNow: () => Promise<void>;
    getOpeningMessage: () => string | null;
    recordReply: (reply: string, answer: string) => void;
  };
  /**
   * 기록과 대화 이력 저장. 질문 경로만 화면 로그를 남기고 장기 기억 추출 카운터를 올린다 —
   * 펫이 먼저 건 대화의 답장은 petChatService가 따로 기록한다.
   */
  recordAssistantTurn: (
    question: string,
    answer: string,
    options: { appendLog: boolean; countTowardExtraction: boolean }
  ) => void;
  rebuildTrayMenu: () => void;
  closeAssistantPanel: () => void;
  closeImageResizePanel: () => void;
  closeTranslatePanel: () => void;
  closeDocumentSummaryPanel: () => void;
  resizeClipboardImage: (scale: number, filter: string) => Promise<ImageResizeResult>;
  translateWithGemini: (text: string, target: TranslateLanguage) => Promise<string>;
  /** 다음에 열 때 같은 언어가 기본으로 선택되도록 저장한다. */
  setTranslateTargetLanguage: (target: TranslateLanguage) => void;
  summarizeDocument: (text: string, extraRequest: string) => Promise<string>;
  writeSummaryDocument: (markdown: string) => string;
  summaryDirectory: () => string;
  ensureDirectory: (directory: string) => void;
  fileExists: (filePath: string) => boolean;
  openPath: (target: string) => Promise<string>;
  writeClipboardText: (text: string) => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * 펫 말풍선 위에서 도는 AI 도구의 IPC — 질문, 펫이 먼저 거는 대화, 번역, 문서 요약,
 * 이미지 리사이즈. 실행 중 교체되는 창·설정을 캡처하지 않고 getter와 동작 콜백을 쓴다.
 *
 * 질문·번역·요약은 토큰·안전 설정·block reason 정책이 서로 달라 각자의 Gemini 호출
 * 함수를 주입받는다. 한 경로의 정책을 다른 경로로 넓히지 않는다.
 */
function registerAssistantIpcHandlers(
  ipcMain: Pick<IpcMain, "handle" | "on">,
  deps: AssistantIpcDependencies
) {
  const assistantReady = () => {
    const settings = deps.getSettings();
    return settings.assistantEnabled && deps.hasApiKey();
  };

  ipcMain.handle("image:resize", async (_event: AssistantIpcEvent, scale: unknown, filter: unknown) => {
    const { language } = deps.getSettings();
    const result = await deps.resizeClipboardImage(Number(scale), String(filter ?? ""));
    if (!result.ok) {
      if (result.errorCode === "notDetected") {
        return { ok: false, error: deps.translate(language, "imageResize.notDetectedError") };
      }
      return { ok: false, error: String(result.detail || deps.translate(language, "imageResize.failedError")) };
    }
    return { ok: true, message: deps.translate(language, "imageResize.doneMessage", { percent: result.percent }) };
  });

  ipcMain.handle("assistant:ask", async (_event: AssistantIpcEvent, rawQuestion: unknown) => {
    const { language } = deps.getSettings();
    const question = String(rawQuestion || "").trim().slice(0, QUESTION_MAX_CHARS);
    if (!deps.isAssistantPanelActive() || !assistantReady()) {
      return { ok: false, error: deps.translate(language, "assistant.disabledError") };
    }
    if (!question) return { ok: false, error: deps.translate(language, "assistant.emptyQuestionError") };
    try {
      const answer = await deps.askGemini(question);
      if (!answer) throw new Error(deps.translate(language, "assistant.emptyAnswerError"));
      const { text, expression } = extractAssistantExpression(answer);
      const displayedAnswer = text.slice(0, ANSWER_MAX_CHARS);
      deps.recordAssistantTurn(question, displayedAnswer, { appendLog: true, countTowardExtraction: true });
      deps.rebuildTrayMenu();
      return { ok: true, answer: displayedAnswer, expression };
    } catch (error) {
      return { ok: false, error: deps.describeAssistantError(error) };
    }
  });

  ipcMain.on("assistant:close", () => deps.closeAssistantPanel());

  // "펫과의 대화" 질문창의 "부르기" 버튼(2026-08-02 추가) — 랜덤 주기를 기다리지 않고
  // "펫이 먼저 말 걸기"를 바로 실행한다. petChatEnabled(자동 주기 스위치)와는 무관하게
  // 작동한다 — 자동으로는 안 걸어도 사용자가 원할 때 직접 부를 수 있어야 하므로.
  ipcMain.handle("pet-chat:call-now", async (event: AssistantIpcEvent) => {
    const { language } = deps.getSettings();
    const disabled = { ok: false, error: deps.translate(language, "assistant.disabledError") };
    if (!deps.isPetSender(event.sender)) return disabled;
    if (!assistantReady()) return disabled;
    if (deps.petChat.isSessionActive()) {
      return { ok: false, error: deps.translate(language, "petChat.alreadyActiveError") };
    }
    if (deps.isRestActive() || deps.isDndActive()) return disabled;
    try {
      await deps.petChat.callNow();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: deps.describeAssistantError(error) };
    }
  });

  ipcMain.handle("pet-chat:reply", async (_event: AssistantIpcEvent, rawReply: unknown) => {
    const { language } = deps.getSettings();
    const reply = String(rawReply || "").trim().slice(0, REPLY_MAX_CHARS);
    if (!deps.petChat.isSessionActive() || !deps.isAssistantPanelActive() || !assistantReady()) {
      return { ok: false, error: deps.translate(language, "assistant.disabledError") };
    }
    if (!reply) return { ok: false, error: deps.translate(language, "assistant.emptyReplyError") };
    try {
      const openingMessage = deps.petChat.getOpeningMessage();
      const extraTurns = openingMessage
        ? [{ question: deps.translate(language, "assistant.petChatOpenerQuestionLabel"), answer: openingMessage }]
        : [];
      const answer = await deps.askGemini(reply, extraTurns);
      if (!answer) throw new Error(deps.translate(language, "assistant.emptyAnswerError"));
      const { text, expression } = extractAssistantExpression(answer);
      const displayedAnswer = text.slice(0, ANSWER_MAX_CHARS);
      deps.petChat.recordReply(reply, displayedAnswer);
      deps.recordAssistantTurn(reply, displayedAnswer, { appendLog: false, countTowardExtraction: false });
      deps.rebuildTrayMenu();
      return { ok: true, answer: displayedAnswer, expression };
    } catch (error) {
      return { ok: false, error: deps.describeAssistantError(error) };
    }
  });

  ipcMain.on("pet-chat:close", () => deps.closeAssistantPanel());
  ipcMain.on("image-resize:close", () => deps.closeImageResizePanel());
  ipcMain.on("translate:close", () => deps.closeTranslatePanel());
  ipcMain.on("document-summary:close", () => deps.closeDocumentSummaryPanel());

  ipcMain.handle("document-summary:run", async (event: AssistantIpcEvent, payload: unknown) => {
    const { language } = deps.getSettings();
    if (!deps.isDocumentSummaryPanelActive() || !deps.isPetSender(event.sender)) {
      return { ok: false, error: deps.translate(language, "documentSummary.closedError") };
    }
    if (!assistantReady()) return { ok: false, error: deps.translate(language, "assistant.enableFirstError") };
    const documentRequest = isRecord(payload) ? payload : {};
    const rawText = typeof payload === "string" ? payload : documentRequest.text;
    const rawExtraRequest = typeof payload === "string" ? "" : documentRequest.extraRequest;
    const text = String(rawText || "").trim();
    const extraRequest = String(rawExtraRequest || "").trim();
    if (!text) return { ok: false, error: deps.translate(language, "documentSummary.emptyTextError") };
    if (text.length > DOCUMENT_MAX_CHARS) {
      return { ok: false, error: deps.translate(language, "documentSummary.textTooLongError") };
    }
    try {
      const markdown = await deps.summarizeDocument(text, extraRequest);
      if (!markdown) return { ok: false, error: deps.translate(language, "documentSummary.emptyResultError") };
      const filePath = deps.writeSummaryDocument(markdown);
      return { ok: true, filePath, fileName: path.basename(filePath) };
    } catch (error) {
      return { ok: false, error: String(deps.describeError(error) || deps.translate(language, "documentSummary.failedError")) };
    }
  });

  // 요약 폴더 안의 .html만 연다. 렌더러가 보낸 경로를 그대로 shell.openPath에 넘기면
  // 상대 경로나 심볼릭 경로로 폴더 밖 파일을 열 수 있다.
  ipcMain.handle("document-summary:open", async (event: AssistantIpcEvent, filePath: unknown) => {
    if (!deps.isDocumentSummaryPanelActive() || !deps.isPetSender(event.sender)) return { ok: false };
    const resolved = path.resolve(String(filePath || ""));
    const base = path.resolve(deps.summaryDirectory());
    const insideSummaryDirectory = resolved.startsWith(`${base}${path.sep}`);
    if (!insideSummaryDirectory || path.extname(resolved).toLowerCase() !== ".html" || !deps.fileExists(resolved)) {
      return { ok: false };
    }
    const error = await deps.openPath(resolved);
    return error ? { ok: false, error } : { ok: true };
  });

  ipcMain.handle("summary:open-folder", async () => {
    const directory = deps.summaryDirectory();
    deps.ensureDirectory(directory);
    const error = await deps.openPath(directory);
    return error ? { ok: false, error } : { ok: true };
  });

  ipcMain.handle("translate:run", async (_event: AssistantIpcEvent, targetLanguage: unknown, rawText: unknown) => {
    const settings = deps.getSettings();
    const { language } = settings;
    if (!assistantReady()) {
      return { ok: false, error: deps.translate(language, "assistant.enableFirstError") };
    }
    // 클립보드를 다시 읽지 않고, 사용자가 번역 패널의 입력칸에서 직접 편집한 텍스트를
    // 그대로 쓴다(2026-08-02 변경) — 그래야 열어둔 뒤 클립보드가 바뀌거나 사용자가
    // 내용을 고쳐도 실제로 보이는 텍스트와 번역 대상이 항상 일치한다.
    const text = String(rawText || "").trim();
    if (!text) return { ok: false, error: deps.translate(language, "translate.emptyTextError") };
    if (text.length > TRANSLATE_MAX_CHARS) {
      return { ok: false, error: deps.translate(language, "translate.textTooLongError") };
    }
    const target = normalizeTranslateLanguage(targetLanguage);
    try {
      const translated = await deps.translateWithGemini(text, target);
      if (!translated) return { ok: false, error: deps.translate(language, "translate.emptyResultError") };
      // 클립보드에는 사용자가 결과를 확인하고 "복사" 버튼을 눌러야 실제로 들어간다
      // (무조건 자동 복사 안 함).
      if (settings.translateTargetLanguage !== target) deps.setTranslateTargetLanguage(target);
      return { ok: true, translated, languageLabel: TRANSLATE_LANGUAGES[target] };
    } catch (error) {
      return { ok: false, error: String(deps.describeError(error) || deps.translate(language, "translate.failedError")) };
    }
  });

  ipcMain.on("translate:copy", (event: AssistantIpcEvent, text: unknown) => {
    if (!deps.isTranslatePanelActive() || !deps.isPetSender(event.sender)) return;
    deps.writeClipboardText(String(text || ""));
  });
}

export { registerAssistantIpcHandlers };
export type { AssistantIpcDependencies, AssistantIpcEvent };

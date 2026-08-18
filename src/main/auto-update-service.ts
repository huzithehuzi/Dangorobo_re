// 새 버전 자동 감지·다운로드 후 재시작 확인. electron-updater는 NSIS 설치본에서만 동작한다 —
// portable 실행은 업데이트 채널이 없어 checkForUpdates가 조용히 실패하고(catch에서 로그만
// 남긴다), 사용자에게는 아무 것도 뜨지 않는다.
import { autoUpdater } from "electron-updater";
import { dialog } from "electron";
const { t } = require("../shared/i18n.js");

type AutoUpdateServiceDeps = {
  /** 다이얼로그 문구 언어. 매번 최신 설정을 읽도록 값이 아니라 함수로 받는다. */
  getLanguage: () => string;
  /** 개발 실행(app.isPackaged === false)에서는 호출부가 checkForUpdates 자체를 부르지 않는다. */
  logger?: Pick<Console, "log" | "error">;
};

function createAutoUpdateService(deps: AutoUpdateServiceDeps) {
  const logger = deps.logger ?? console;

  // 다운로드까지는 자동으로 하고, 설치(앱 재시작)는 반드시 사용자 확인을 거친다 — 작업 중인
  // 펫 창을 예고 없이 닫아버리면 안 되기 때문이다.
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on("error", (error) => {
    logger.error("[auto-update] 오류:", error);
  });

  autoUpdater.on("update-downloaded", (info) => {
    const lang = deps.getLanguage();
    dialog
      .showMessageBox({
        type: "info",
        buttons: [t(lang, "update.restartNow"), t(lang, "update.restartLater")],
        defaultId: 0,
        cancelId: 1,
        title: t(lang, "update.downloadedTitle"),
        message: t(lang, "update.downloadedMessage", { version: info.version })
      })
      .then(({ response }) => {
        if (response === 0) autoUpdater.quitAndInstall();
      });
  });

  function checkForUpdates() {
    autoUpdater.checkForUpdates().catch((error) => {
      // 네트워크 오류·portable 실행(업데이트 채널 없음) 모두 여기로 온다 — 앱 실행을
      // 막으면 안 되므로 로그만 남기고 넘어간다.
      logger.error("[auto-update] 확인 실패:", error);
    });
  }

  return { checkForUpdates };
}

export { createAutoUpdateService };

// 앱 전체 다국어(한국어/영어/일본어) 사전. main.js(Node/CommonJS)와 렌더러(브라우저 <script>)
// 양쪽에서 모두 쓸 수 있도록 UMD 스타일로 내보낸다. 새 화면/문구를 추가할 때는 여기 STRINGS에
// 키를 추가하고, 각 문서(main.js/렌더러 JS/HTML data-i18n)에서 그 키를 참조한다.

// 지원 언어 코드. 다른 파일에서 `import("../shared/i18n.js").Lang`으로 참조할 수 있도록
// UMD 래퍼 밖(파일 스코프)에 둔다 — 안에 두면 이 파일에서만 보인다.
/** @typedef {"ko" | "en" | "ja"} Lang */

(function (root, factory) {
  const mod = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = mod;
  }
  if (typeof root !== "undefined") {
    // 전역에 이름을 심는 UMD 관용구라 root의 정적 타입(window/globalThis)에는 이 속성이 없다.
    /** @type {any} */ (root).PetI18n = mod;
  }
})(typeof window !== "undefined" ? window : typeof globalThis !== "undefined" ? globalThis : this, function () {
  /** @type {Lang[]} */
  const SUPPORTED_LANGUAGES = ["ko", "en", "ja"];
  /** @type {Lang} */
  const DEFAULT_LANGUAGE = "en";

  // 목록에 있는지 런타임에 확인한 뒤 좁힌다 — 언어를 추가할 때 고칠 곳이
  // SUPPORTED_LANGUAGES 하나로 유지되도록 비교문을 늘어놓지 않는다.
  /**
   * @param {unknown} value
   * @returns {Lang}
   */
  function normalizeLanguage(value) {
    return SUPPORTED_LANGUAGES.includes(/** @type {Lang} */ (value)) ? /** @type {Lang} */ (value) : DEFAULT_LANGUAGE;
  }

  // OS 로케일(예: "ko-KR", "ja-JP", "en-US")에서 지원 언어를 고른다. 지원하지 않는
  // 언어면 영어(공용어)를 기본값으로 쓴다.
  /**
   * @param {unknown} osLocale
   * @returns {Lang}
   */
  function detectDefaultLanguage(osLocale) {
    const primary = String(osLocale || "").toLowerCase().split(/[-_]/)[0];
    if (primary === "ko") return "ko";
    if (primary === "ja") return "ja";
    return "en";
  }

  // Record로 적어 두면 t()가 임의의 키로 찾아 쓸 수 있고, 동시에 **세 언어가 다 있는지**를
  // tsc가 항목마다 확인해 준다(하나라도 빠뜨리면 그 자리에서 오류가 난다).
  /** @type {Record<string, Record<Lang, string>>} */
  const STRINGS = {
    // ---- 공통 ----
    "common.save": { ko: "저장", en: "Save", ja: "保存" },
    "common.cancel": { ko: "취소", en: "Cancel", ja: "キャンセル" },
    "common.close": { ko: "닫기", en: "Close", ja: "閉じる" },
    "common.delete": { ko: "삭제", en: "Delete", ja: "削除" },
    "common.add": { ko: "추가", en: "Add", ja: "追加" },
    "common.none": { ko: "없음", en: "None", ja: "なし" },
    "common.apply": { ko: "적용", en: "Apply", ja: "適用" },
    "common.confirm": { ko: "확인", en: "OK", ja: "確認" },
    "common.retry": { ko: "다시 시도", en: "Retry", ja: "再試行" },

    // ---- 메인 펫 화면(index.html) 정적 텍스트 ----
    "index.docTitle": { ko: "당고로보", en: "Dangorobo", ja: "ダンゴロボ" },
    "index.petStageAriaLabel": { ko: "마우스를 바라보는 로우폴리 고양이", en: "A low-poly cat that watches the mouse cursor", ja: "マウスを見つめるローポリの猫" },
    "assistant.askTitle": { ko: "펫에게 질문", en: "Ask the Pet", ja: "ペットに質問" },
    "assistant.questionPlaceholder": { ko: "궁금한 내용을 입력하세요", en: "Type what you'd like to ask", ja: "気になることを入力してください" },
    "assistant.askButton": { ko: "질문하기", en: "Ask", ja: "質問する" },
    "petChat.replyPlaceholder": { ko: "답장을 입력하세요 (선택)", en: "Type a reply (optional)", ja: "返信を入力(任意)" },
    "petChat.replyButton": { ko: "답장하기", en: "Reply", ja: "返信する" },
    "petChat.callNowButton": { ko: "부르기", en: "Call", ja: "呼ぶ" },
    "petChat.callingNowStatus": { ko: "펫을 부르는 중…", en: "Calling the pet…", ja: "ペットを呼んでいます…" },
    "favorites.title": { ko: "즐겨찾기", en: "Favorites", ja: "お気に入り" },
    "moveMode.title": { ko: "펫 이동 모드", en: "Pet Move Mode", ja: "ペット移動モード" },
    "moveMode.hint": { ko: "펫을 드래그해 이동 · Ctrl + Shift + P로 완료", en: "Drag the pet to move it · Ctrl + Shift + P when done", ja: "ペットをドラッグして移動 · 完了は Ctrl + Shift + P" },
    "media.previousLabel": { ko: "이전 곡", en: "Previous track", ja: "前のトラック" },
    "media.playLabel": { ko: "재생", en: "Play", ja: "再生" },
    "media.pauseLabel": { ko: "일시정지", en: "Pause", ja: "一時停止" },
    "media.nextLabel": { ko: "다음 곡", en: "Next track", ja: "次のトラック" },

    // ---- 트레이/펫 우클릭 메뉴 ----
    "menu.showHidePet": { ko: "펫 보이기/숨기기", en: "Show/Hide Pet", ja: "ペットの表示/非表示" },
    "menu.moveModeOn": { ko: "펫 이동 모드 켜기", en: "Turn On Move Mode", ja: "移動モードをオン" },
    "menu.moveModeOff": { ko: "이동 완료 · 클릭 통과 켜기", en: "Done Moving · Click-Through On", ja: "移動完了・クリック透過オン" },
    "menu.alarmCountdown": { ko: "다음 알람까지: {{countdown}}", en: "Next alarm in: {{countdown}}", ja: "次のアラームまで: {{countdown}}" },
    "menu.openSettings": { ko: "펫 및 알람 설정…", en: "Pet & Alarm Settings…", ja: "ペット・アラーム設定…" },
    "menu.qaLogs": { ko: "질문·답변 기록… ({{count}})", en: "Q&A History… ({{count}})", ja: "質問・回答履歴… ({{count}})" },
    "menu.checklistOpen": { ko: "체크리스트 열기", en: "Open Checklist", ja: "チェックリストを開く" },
    "menu.checklistClose": { ko: "체크리스트 닫기", en: "Close Checklist", ja: "チェックリストを閉じる" },
    "menu.openAssistant": { ko: "펫과의 대화 열기 · {{shortcut}}", en: "Chat with Pet · {{shortcut}}", ja: "ペットと会話 · {{shortcut}}" },
    "menu.openFavorites": { ko: "즐겨찾기 열기 · {{shortcut}}", en: "Open Favorites · {{shortcut}}", ja: "お気に入りを開く · {{shortcut}}" },
    "menu.autoStart": { ko: "Windows 시작 시 자동 실행", en: "Start automatically with Windows", ja: "Windows起動時に自動実行" },
    "menu.checkWeather": { ko: "현재 날씨", en: "Check Weather", ja: "現在の天気" },
    "menu.quit": { ko: "종료", en: "Quit", ja: "終了" },
    "tray.tooltip": { ko: "Dangorobo · 다음 휴식 {{countdown}}", en: "Dangorobo · Next break {{countdown}}", ja: "Dangorobo · 次の休憩 {{countdown}}" },
    "tray.tooltipIdle": { ko: "Dangorobo", en: "Dangorobo", ja: "Dangorobo" },
    "restAlert.waitingConfirm": { ko: "확인 대기 중", en: "Waiting for confirm", ja: "確認待ち" },
    "menu.remainingMinutes": { ko: "{{minutes}}분 남음", en: "{{minutes}} min left", ja: "残り{{minutes}}分" },

    // ---- 날씨(Open-Meteo, API 키 불필요 — 대한민국은 기상청 기반 kma_seamless 모델을 쓴다) ----
    "weather.alertTitle": { ko: "오늘의 날씨", en: "Today's Weather", ja: "今日の天気" },
    "weather.todayLabel": { ko: "오늘", en: "Today", ja: "今日" },
    "weather.tomorrowLabel": { ko: "내일", en: "Tomorrow", ja: "明日" },
    "weather.dayLine": { ko: "{{label}} {{icon}} 최고 {{max}}°/최저 {{min}}°", en: "{{label}} {{icon}} High {{max}}°/Low {{min}}°", ja: "{{label}} {{icon}} 最高{{max}}°/最低{{min}}°" },
    "weather.precipSuffix": { ko: " (강수 {{percent}}%)", en: " (precip {{percent}}%)", ja: " (降水 {{percent}}%)" },
    "weather.locationMissing": { ko: "날씨 지역이 설정되지 않았어요. '일반' 탭에서 지역을 입력해주세요.", en: "No weather location is set. Enter one in the General tab.", ja: "天気の地域が設定されていません。「一般」タブで地域を入力してください。" },
    "weather.fetchFailed": { ko: "날씨 정보를 불러오지 못했어요.", en: "Couldn't fetch the weather.", ja: "天気情報を取得できませんでした。" },

    // ---- 알람 기본값 ----
    "alarm.defaultTitle": { ko: "잠깐 쉬어갈 시간이에요!", en: "Time for a short break!", ja: "ちょっと休憩の時間です!" },
    "alarm.defaultMessage": { ko: "눈과 어깨를 가볍게 풀어주세요.", en: "Give your eyes and shoulders a quick stretch.", ja: "目と肩を軽くほぐしましょう。" },
    "alarm.testTitle": { ko: "테스트 알람", en: "Test Alarm", ja: "テストアラーム" },
    "alarm.testMessage": { ko: "이건 테스트 알람입니다.", en: "This is a test alarm.", ja: "これはテストアラームです。" },
    "alarm.defaultName": { ko: "알람", en: "Alarm", ja: "アラーム" },
    "alarm.soundPickerTitle": { ko: "알람 소리 선택", en: "Choose alarm sound", ja: "アラーム音を選択" },
    "alarm.soundPickerFilterName": { ko: "사운드 파일", en: "Sound files", ja: "サウンドファイル" },

    // ---- 창 제목 ----
    "window.settingsTitle": { ko: "펫 설정", en: "Pet Settings", ja: "ペット設定" },
    "window.logsTitle": { ko: "질문·답변 기록", en: "Q&A History", ja: "質問・回答履歴" },
    "window.checklistTitle": { ko: "오늘 할일", en: "Today's To-Do", ja: "今日のやること" },
    "window.favoritesTitle": { ko: "즐겨찾기", en: "Favorites", ja: "お気に入り" },
    "window.favoritesDockTitle": { ko: "즐겨찾기 독", en: "Favorites Dock", ja: "お気に入りドック" },
    "checklist.clearButtonTitle": { ko: "목록 전체 삭제", en: "Clear the whole list", ja: "リストを全消去" },
    "checklist.clearButton": { ko: "비우기", en: "Clear", ja: "空にする" },
    "checklist.clearConfirm": { ko: "정말?", en: "Sure?", ja: "本当に?" },
    "checklist.closeButtonTitle": { ko: "닫기", en: "Close", ja: "閉じる" },
    "checklist.emptyState": { ko: "할일을 추가해보세요.", en: "Add something to do.", ja: "やることを追加してみましょう。" },
    "checklist.addPlaceholder": { ko: "할일 추가", en: "Add a task", ja: "やることを追加" },
    "checklist.addButtonTitle": { ko: "추가", en: "Add", ja: "追加" },
    "checklist.itemDone": { ko: "완료", en: "Done", ja: "完了" },
    "checklist.itemUndo": { ko: "완료 해제", en: "Mark as not done", ja: "完了を解除" },
    "checklist.itemDelete": { ko: "삭제", en: "Delete", ja: "削除" },
    "checklist.dragHandle": { ko: "드래그해서 순서 바꾸기", en: "Drag to reorder", ja: "ドラッグして並べ替え" },

    // ---- 질문·답변 기록 창(logs.html) ----
    "logs.subtitle": { ko: "최근 300개 기록을 이 PC에만 저장합니다.", en: "The most recent 300 entries are stored only on this PC.", ja: "直近300件の記録をこのPCにのみ保存します。" },
    "logs.countBadge": { ko: "{{count}}개", en: "{{count}}", ja: "{{count}}件" },
    "logs.emptyState": { ko: "아직 저장된 대화가 없습니다.", en: "No conversations saved yet.", ja: "まだ保存された会話がありません。" },
    "logs.petChatTag": { ko: "펫이 먼저 걺", en: "Pet spoke first", ja: "ペットから話しかけ" },
    "logs.defaultPersonality": { ko: "기본 성격", en: "Default personality", ja: "デフォルトの性格" },
    "logs.noModelInfo": { ko: "모델 정보 없음", en: "No model info", ja: "モデル情報なし" },
    "logs.petFirstLabel": { ko: "펫이 먼저", en: "Pet started", ja: "ペットから" },
    "logs.userReplyLabel": { ko: "사용자 답장", en: "Your reply", ja: "ユーザーの返信" },
    "logs.petReplyLabel": { ko: "펫 답장", en: "Pet's reply", ja: "ペットの返信" },
    "logs.questionLabel": { ko: "질문", en: "Question", ja: "質問" },
    "logs.answerLabel": { ko: "답변", en: "Answer", ja: "回答" },
    "logs.noTimeInfo": { ko: "시간 정보 없음", en: "No time info", ja: "時刻情報なし" },
    "logs.searchPlaceholder": { ko: "질문·답변 검색…", en: "Search questions and answers…", ja: "質問・回答を検索…" },
    "logs.searchEmptyState": { ko: "검색 결과가 없습니다.", en: "No matching entries.", ja: "検索結果がありません。" },
    "logs.deleteButton": { ko: "삭제", en: "Delete", ja: "削除" },
    "logs.clearAllButton": { ko: "전체 삭제", en: "Clear all", ja: "すべて削除" },
    "logs.clearAllConfirm": { ko: "저장된 대화 기록을 모두 삭제할까요? 되돌릴 수 없습니다.", en: "Delete all saved conversation logs? This cannot be undone.", ja: "保存された会話記録をすべて削除しますか？元に戻せません。" },

    // ---- 성격 짧은 이름(성격 드롭다운 + 기록 창 태그 공용) ----
    "assistant.personalityShort.friend": { ko: "편한 친구", en: "Casual Friend", ja: "気楽な友達" },
    "assistant.personalityShort.polite": { ko: "친근한 존댓말", en: "Friendly & Polite", ja: "親しみやすい丁寧語" },
    "assistant.personalityShort.concise": { ko: "담백한 조언자", en: "Plain Advisor", ja: "淡々としたアドバイザー" },
    "assistant.personalityShort.playful": { ko: "가벼운 장난꾸러기", en: "Playful Jokester", ja: "気軽ないたずらっ子" },
    "assistant.personalityShort.custom": { ko: "사용자 지정", en: "Custom", ja: "カスタム" },

    // ---- 설정 창(settings.html) ----
    "settings.subtitle": { ko: "종류별 탭에서 원하는 기능을 조절하세요.", en: "Adjust features in the tabs below.", ja: "各タブで機能を調整してください。" },
    "settings.tabsAriaLabel": { ko: "설정 종류", en: "Settings categories", ja: "設定カテゴリー" },
    "settings.tab.general": { ko: "일반", en: "General", ja: "一般" },
    "settings.tab.appearance": { ko: "외형", en: "Appearance", ja: "外見" },
    "settings.tab.alerts": { ko: "알람", en: "Alarms", ja: "アラーム" },
    "settings.tab.ui": { ko: "UI", en: "UI", ja: "UI" },
    "settings.tab.conversation": { ko: "대화", en: "Chat", ja: "会話" },
    "settings.tab.shortcuts": { ko: "단축키", en: "Shortcuts", ja: "ショートカット" },
    "settings.tab.tray": { ko: "트레이", en: "Tray", ja: "トレイ" },
    "settings.tab.favorites": { ko: "바로가기", en: "Favorites", ja: "ショートカット集" },
    "settings.tab.player": { ko: "플레이어", en: "Player", ja: "プレーヤー" },
    "settings.tab.customization": { ko: "커스터마이징", en: "Customization", ja: "カスタマイズ" },

    "settings.general.languageLabel": { ko: "Language", en: "Language", ja: "Language" },
    "settings.general.languageNote": { ko: "펫 화면·설정창·알림 등 앱 전체에서 사용할 언어입니다.", en: "The language used throughout the app — pet screen, settings, notifications, and more.", ja: "ペット画面・設定画面・通知など、アプリ全体で使う言語です。" },
    "settings.general.apiKeyHeading": { ko: "AI API 키", en: "AI API Key", ja: "AI APIキー" },
    "settings.general.apiKeyLabel": { ko: "Gemini API 키", en: "Gemini API Key", ja: "Gemini APIキー" },
    "settings.general.apiKeyPlaceholder": { ko: "새 키를 입력하거나 저장된 키 유지", en: "Enter a new key, or keep the saved one", ja: "新しいキーを入力するか、保存済みのキーを維持" },
    "settings.general.clearKeyLabel": { ko: "저장된 API 키 삭제", en: "Delete saved API key", ja: "保存済みAPIキーを削除" },
    "settings.general.apiKeyNote": { ko: "이 키는 AI 질문·펫이 먼저 말 걸기·클립보드 번역 기능이 공통으로 사용합니다.", en: "This key is shared by the AI Q&A, pet-initiated chat, and clipboard translation features.", ja: "このキーはAI質問・ペットからの話しかけ・クリップボード翻訳機能で共通して使われます。" },
    "settings.general.apiKeyGetLink": {
      ko: '<a href="https://aistudio.google.com/api-keys" target="_blank" rel="noopener">https://aistudio.google.com/api-keys</a> 에서 무료 API 키를 생성할 수 있습니다.',
      en: 'You can generate a free API key at <a href="https://aistudio.google.com/api-keys" target="_blank" rel="noopener">https://aistudio.google.com/api-keys</a>.',
      ja: '<a href="https://aistudio.google.com/api-keys" target="_blank" rel="noopener">https://aistudio.google.com/api-keys</a> で無料のAPIキーを発行できます。'
    },
    "settings.general.dndHeading": { ko: "방해 금지", en: "Do Not Disturb", ja: "邪魔しない設定" },
    "settings.general.dndToggle": { ko: "전체화면 중 알람 미루기", en: "Postpone alarms while fullscreen", ja: "全画面表示中はアラームを延期" },
    "settings.general.dndNote": { ko: "게임이나 프레젠테이션처럼 전체화면 앱이 실행 중이면 알람을 띄우지 않고 펫도 함께 숨깁니다. 미뤄둔 알람은 전체화면이 끝나면 순서대로 표시되며 사라지지 않습니다.", en: "While a fullscreen app (like a game or presentation) is running, alarms are held back and the pet is hidden too. Postponed alarms are shown in order once fullscreen ends — none are lost.", ja: "ゲームやプレゼンのような全画面アプリの実行中は、アラームを表示せずペットも一緒に隠します。延期されたアラームは全画面が終わると順番に表示され、消えることはありません。" },
    "settings.general.dragModeHeading": { ko: "펫 이동 방식", en: "Pet Move Mode", ja: "ペットの移動方式" },
    "settings.general.dragModeLabel": { ko: "이동 방식", en: "Move mode", ja: "移動方式" },
    "settings.general.dragModeAlways": { ko: "상시 드래그", en: "Always draggable", ja: "常時ドラッグ" },
    "settings.general.dragModeToggle": { ko: "이동 모드 전환", en: "Toggle move mode", ja: "移動モード切替" },
    "settings.general.dragModeNote": { ko: "상시 드래그: 펫을 아무 때나 좌클릭으로 끌어 옮길 수 있습니다. 이동 모드 전환: 트레이 메뉴나 <code>Ctrl + Shift + P</code>로 이동 모드를 켠 동안만 옮길 수 있습니다(예전 방식).", en: "Always draggable: drag the pet with the left mouse button anytime. Toggle move mode: you can only move it while move mode is on via the tray menu or <code>Ctrl + Shift + P</code> (the old behavior).", ja: "常時ドラッグ: いつでも左クリックでペットをドラッグして動かせます。移動モード切替: トレイメニューまたは<code>Ctrl + Shift + P</code>で移動モードをオンにしている間だけ動かせます(以前の方式)。" },
    "settings.general.weatherHeading": { ko: "날씨", en: "Weather", ja: "天気" },
    "settings.general.weatherCityLabel": { ko: "날씨 지역(도시)", en: "Weather location (city)", ja: "天気の地域(都市)" },
    "settings.general.weatherCityPlaceholder": { ko: "예: 서울, Tokyo, New York", en: "e.g. Seoul, Tokyo, New York", ja: "例: ソウル、東京、New York" },
    "settings.general.weatherCityNote": { ko: "알람의 날씨 브리핑과 트레이의 '현재 날씨'에 쓰입니다. 회원가입이 필요 없는 Open-Meteo로 조회하며, 대한민국 지역은 기상청(KMA) 기반 데이터를 우선 사용합니다.", en: "Used by alarm weather briefings and the tray's 'Check Weather'. Fetched via Open-Meteo, which needs no sign-up — locations in South Korea prefer Korea Meteorological Administration (KMA) data.", ja: "アラームの天気ブリーフィングとトレイの「現在の天気」に使われます。登録不要のOpen-Meteoで取得し、韓国国内の地域は気象庁(KMA)ベースのデータを優先的に使用します。" },
    "settings.general.backupHeading": { ko: "설정 백업", en: "Settings Backup", ja: "設定バックアップ" },
    "settings.general.backupExportButton": { ko: "설정 전체 내보내기", en: "Export All Settings", ja: "設定全体をエクスポート" },
    "settings.general.backupImportButton": { ko: "설정 전체 가져오기", en: "Import All Settings", ja: "設定全体をインポート" },
    "settings.general.backupNote": { ko: "알람·단축키·외형·커스터마이징 등 이 설정창의 모든 항목을 파일 하나로 내보내거나 가져옵니다. AI API 키는 포함되지 않으므로(안전한 저장 방식상 다른 PC로 옮길 수 없음) 복원 후 필요하면 위에서 다시 입력해주세요. 가져오기는 즉시 적용·저장되며 저장 버튼과 무관합니다.", en: "Exports or imports every setting in this window — alarms, shortcuts, appearance, customization, and more — as a single file. The AI API key is not included (its secure storage can't be moved to another PC), so re-enter it above after restoring if needed. Importing applies and saves immediately, independent of the Save button.", ja: "アラーム・ショートカット・外見・カスタマイズなど、この設定画面のすべての項目を1つのファイルとしてエクスポート・インポートします。AI APIキーは含まれません(安全な保存方式上、他のPCに移せないため)。復元後に必要であれば上で再入力してください。インポートは即座に適用・保存され、保存ボタンとは無関係です。" },
    "settings.general.documentSummaryHeading": { ko: "문서 요약", en: "Document Summary", ja: "ドキュメント要約" },
    "settings.general.openSummaryFolderButton": { ko: "요약 문서 폴더 열기", en: "Open Summary Folder", ja: "要約ドキュメントフォルダを開く" },
    "settings.general.documentSummaryNote": { ko: "AI로 요약한 문서들이 저장되는 폴더를 탐색기로 엽니다.", en: "Open the folder where AI-summarized documents are saved in File Explorer.", ja: "AI が要約したドキュメントが保存されているフォルダをエクスプローラーで開きます。" },
    "settings.general.clickSoundHeading": { ko: "클릭 사운드", en: "Click Sound", ja: "クリック音" },
    "settings.general.clickSoundNote": { ko: "키보드나 마우스를 누를 때마다 골라둔 클릭 사운드를 재생합니다(높낮이는 매번 범위 안에서 무작위). 기본은 꺼져 있습니다.", en: "Plays the click sound you picked every time you press a key or mouse button (pitch is randomized within your range each time). Off by default.", ja: "キーボードやマウスを押すたびに、選んだクリック音を再生します(高さは毎回範囲内でランダム)。デフォルトはオフです。" },
    "settings.general.clickSoundLabel": { ko: "사운드", en: "Sound", ja: "サウンド" },
    "settings.general.keyboardClickToggle": { ko: "키보드 클릭 사운드 사용", en: "Use keyboard click sound", ja: "キーボードのクリック音を使用" },
    "settings.general.mouseClickToggle": { ko: "마우스 클릭 사운드 사용", en: "Use mouse click sound", ja: "マウスのクリック音を使用" },
    "settings.general.clickVolumeLabel": { ko: "볼륨", en: "Volume", ja: "音量" },
    "settings.general.clickMinPitchLabel": { ko: "최소 높낮이", en: "Minimum pitch", ja: "最小の高さ" },
    "settings.general.clickMaxPitchLabel": { ko: "최대 높낮이", en: "Maximum pitch", ja: "最大の高さ" },

    "settings.tray.heading": { ko: "트레이 메뉴", en: "Tray Menu", ja: "トレイメニュー" },
    "settings.tray.note": { ko: "트레이 아이콘 또는 펫 우클릭 메뉴에 표시할 항목을 고릅니다. 설정과 종료는 안전을 위해 항상 표시됩니다.", en: "Choose which items appear in the tray icon or pet right-click menu. Settings and Quit are always shown for safety.", ja: "トレイアイコンまたはペット右クリックメニューに表示する項目を選びます。安全のため、設定と終了は常に表示されます。" },
    "settings.tray.visibleItemsHeading": { ko: "표시 항목", en: "Visible Items", ja: "表示項目" },
    "settings.tray.favoritesHeading": { ko: "즐겨찾기", en: "Favorites", ja: "お気に入り" },
    "settings.tray.item.showHidePet": { ko: "펫 보이기/숨기기", en: "Show/Hide Pet", ja: "ペットの表示/非表示" },
    "settings.tray.item.moveMode": { ko: "펫 이동 모드", en: "Pet move mode", ja: "ペット移動モード" },
    "settings.tray.item.alarmCountdown": { ko: "다음 알람까지", en: "Next alarm countdown", ja: "次のアラームまで" },
    "settings.tray.item.qaLogs": { ko: "질문·답변 기록", en: "Q&A history", ja: "質問・回答履歴" },
    "settings.tray.item.checklist": { ko: "체크리스트 열기/닫기", en: "Open/close checklist", ja: "チェックリストを開く/閉じる" },
    "settings.tray.item.assistant": { ko: "펫과의 대화 열기", en: "Open pet chat", ja: "ペットとの会話を開く" },
    "settings.tray.item.favorites": { ko: "즐겨찾기 열기", en: "Open favorites", ja: "お気に入りを開く" },
    "settings.tray.item.autoStart": { ko: "Windows 시작 시 자동 실행", en: "Start automatically with Windows", ja: "Windows起動時に自動実行" },
    "settings.tray.item.weather": { ko: "'현재 날씨' 메뉴 표시", en: "Show 'Check Weather' menu item", ja: "「現在の天気」メニューを表示" },

    "settings.appearance.resetDefaultsButton": { ko: "외형 기본값으로 초기화", en: "Reset appearance to defaults", ja: "外見を初期値にリセット" },
    "settings.appearance.resetDefaultsNote": { ko: "모델 크기·조명·팔레트·외곽선·입력 반응 등 이 탭의 모든 항목이 기본값으로 채워집니다. 저장 버튼을 눌러야 실제로 적용됩니다.", en: "All fields in this tab (model size, lighting, palette, outline, input reactions, etc.) will be filled with their default values. You still need to click Save to apply them.", ja: "モデルサイズ・ライティング・パレット・輪郭線・入力反応など、このタブのすべての項目が初期値になります。実際に適用するには保存ボタンを押す必要があります。" },
    "settings.appearance.confirmResetDefaults": { ko: "외형 탭의 모든 항목을 기본값으로 되돌릴까요? 저장 전까지는 적용되지 않습니다.", en: "Reset all fields in the appearance tab to their defaults? This won't take effect until you save.", ja: "外見タブのすべての項目を初期値に戻しますか？保存するまでは反映されません。" },
    "settings.appearance.modelHeading": { ko: "모델과 움직임", en: "Model & Movement", ja: "モデルと動き" },
    "settings.appearance.scaleLabel": { ko: "모델 크기", en: "Model size", ja: "モデルサイズ" },
    "settings.appearance.tailSpeedLabel": { ko: "꼬리 속도", en: "Tail speed", ja: "しっぽの速さ" },
    "settings.appearance.shadingToggle": { ko: "명암 효과 사용", en: "Use shading effect", ja: "陰影効果を使用" },
    "settings.appearance.pixelArtLabel": { ko: "픽셀 효과 강도", en: "Pixel effect intensity", ja: "ピクセル効果の強さ" },
    "settings.appearance.colorHeading": { ko: "색상과 외곽선", en: "Color & Outline", ja: "色と輪郭線" },
    "settings.appearance.paletteToggle": { ko: "팔레트 제한 사용", en: "Use limited palette", ja: "パレット制限を使用" },
    "settings.appearance.paletteLabel": { ko: "팔레트 종류", en: "Palette style", ja: "パレットの種類" },
    "settings.appearance.paletteAuto": { ko: "자동", en: "Auto", ja: "自動" },
    "settings.appearance.paletteWarm": { ko: "따뜻함", en: "Warm", ja: "暖色" },
    "settings.appearance.paletteCool": { ko: "차가움", en: "Cool", ja: "寒色" },
    "settings.appearance.paletteMono": { ko: "흑백", en: "Monochrome", ja: "モノクロ" },
    "settings.appearance.paletteGameboy": { ko: "게임보이풍", en: "Game Boy style", ja: "ゲームボーイ風" },
    "settings.appearance.paletteCustom": { ko: "사용자 지정", en: "Custom", ja: "ユーザー設定" },
    "settings.appearance.paletteGradientLabel": { ko: "그라디언트", en: "Gradient", ja: "グラデーション" },
    "settings.appearance.paletteGradientAdd": { ko: "정지점 추가", en: "Add stop", ja: "ストップを追加" },
    "settings.appearance.paletteGradientRemove": { ko: "선택한 정지점 삭제", en: "Remove selected stop", ja: "選択したストップを削除" },
    "settings.appearance.paletteGradientStopColor": { ko: "정지점 색상", en: "Stop color", ja: "ストップの色" },
    "settings.appearance.paletteGradientNote": {
      ko: "픽셀의 밝기를 이 그라디언트 위의 위치로 보고 그 자리의 색으로 바꿉니다(그라디언트 맵). 원래 색은 남지 않으므로 통일감이 강해집니다. 정지점을 끌어 옮기고, 눌러서 색을 바꿉니다. 실제로 쓰이는 색 개수는 위의 ‘색상 단계’로 제한됩니다.",
      en: "Maps each pixel's brightness to a position on this gradient and replaces its color (gradient map). Original hues are discarded, so the look becomes strongly unified. Drag stops to move them, click to change color. The number of colors actually used is limited by “Color steps” above.",
      ja: "ピクセルの明るさをこのグラデーション上の位置とみなし、その位置の色に置き換えます（グラデーションマップ）。元の色相は残らないため統一感が強くなります。ストップはドラッグで移動、クリックで色を変更します。実際に使われる色数は上の「色の段階」で制限されます。"
    },
    "settings.appearance.ditherLabel": { ko: "디더링 패턴", en: "Dither pattern", ja: "ディザリングパターン" },
    "settings.appearance.ditherNone": { ko: "없음", en: "None", ja: "なし" },
    "settings.appearance.ditherBayer2": { ko: "베이어 2×2 (거친 격자)", en: "Bayer 2×2 (coarse)", ja: "ベイヤー 2×2（粗い）" },
    "settings.appearance.ditherBayer4": { ko: "베이어 4×4 (기본 레트로)", en: "Bayer 4×4 (classic retro)", ja: "ベイヤー 4×4（定番レトロ）" },
    "settings.appearance.ditherBayer8": { ko: "베이어 8×8 (고운 격자)", en: "Bayer 8×8 (fine)", ja: "ベイヤー 8×8（細かい）" },
    "settings.appearance.ditherChecker": { ko: "체커 (바둑판)", en: "Checker", ja: "チェッカー" },
    "settings.appearance.ditherLines": { ko: "가로 줄무늬", en: "Horizontal lines", ja: "横縞" },
    "settings.appearance.ditherVerticalLines": { ko: "세로 줄무늬", en: "Vertical lines", ja: "縦縞" },
    "settings.appearance.ditherNoise": { ko: "노이즈 (거친 입자)", en: "Noise (grain)", ja: "ノイズ（粒状）" },
    "settings.appearance.ditherAmountLabel": { ko: "디더링 강도", en: "Dither strength", ja: "ディザリング強度" },
    "settings.appearance.ditherNote": {
      ko: "색 단계 사이 경계를 패턴으로 흩뿌려 중간 톤이 섞여 보이게 합니다(레트로 게임 느낌). 팔레트 제한이 켜져 있을 때만 적용되며, 외곽선에는 걸리지 않습니다. 강도를 낮추면 경계 부근에만 은은하게 나타납니다.",
      en: "Scatters the boundary between color steps with a pattern so in-between tones appear mixed (retro game look). Only applies when the limited palette is on, and never to the outline. Lower strength keeps it subtle, near the boundaries only.",
      ja: "色の段階の境界をパターンで散らして中間トーンが混ざって見えるようにします（レトロゲーム風）。パレット制限がオンのときだけ適用され、輪郭線にはかかりません。強度を下げると境界付近だけ控えめに現れます。"
    },
    "settings.appearance.paletteStepsLabel": { ko: "색상 단계", en: "Color steps", ja: "色の段階" },
    "settings.appearance.paletteStepsUnit": { ko: "단계", en: "steps", ja: "段階" },
    "settings.appearance.outlineToggle": { ko: "외곽선 사용", en: "Use outline", ja: "輪郭線を使用" },
    "settings.appearance.outlineColorLabel": { ko: "외곽선 색상", en: "Outline color", ja: "輪郭線の色" },
    "settings.appearance.outlineThicknessLabel": { ko: "외곽선 굵기", en: "Outline thickness", ja: "輪郭線の太さ" },
    "settings.appearance.lineWobbleToggle": { ko: "선 떨림 효과 사용", en: "Enable line wobble", ja: "線の揺れ効果を使用" },
    "settings.appearance.lineWobbleFrequencyLabel": { ko: "떨림 주기", en: "Wobble frequency", ja: "揺れの周期" },
    "settings.appearance.lineWobbleSpeedLabel": { ko: "떨림 속도", en: "Wobble speed", ja: "揺れの速さ" },
    "settings.appearance.lineWobbleAmountLabel": { ko: "떨림 크기", en: "Wobble amount", ja: "揺れの大きさ" },
    "settings.appearance.lineWobbleNote": { ko: "손그림 애니메이션처럼 윤곽선과 색 경계가 살짝 흔들리는 효과입니다. 떨림 주기는 화면에 생기는 굴곡의 개수, 속도는 그 굴곡이 흘러가는 빠르기, 크기는 흔들리는 폭(px)입니다.", en: "A hand-drawn animation style effect where outlines and color edges wobble slightly. Frequency is the number of ripples across the screen, speed is how fast they flow, and amount is the wobble width in pixels.", ja: "手描きアニメーションのように輪郭線や色の境界が少し揺れる効果です。周期は画面上の揺らぎの数、速さはその揺らぎが流れる速さ、大きさは揺れの幅(px)です。" },
    "settings.appearance.inputHeading": { ko: "입력 반응", en: "Input Reactions", ja: "入力への反応" },
    "settings.appearance.mouseSquishToggle": { ko: "마우스 클릭 스퀴시 효과", en: "Squish on mouse click", ja: "マウスクリックでスクイーズ" },
    "settings.appearance.keyboardSquishToggle": { ko: "키보드 스퀴시 효과", en: "Squish on keyboard input", ja: "キーボード入力でスクイーズ" },
    "settings.appearance.squishStrengthLabel": { ko: "스퀴시 강도", en: "Squish strength", ja: "スクイーズの強さ" },
    "settings.appearance.headPettingToggle": { ko: "머리 쓰다듬기 반응", en: "Head-petting reaction", ja: "頭なでへの反応" },
    "settings.appearance.headPettingNote": { ko: "펫의 머리 위에서 커서를 좌우로 왕복시키면 기뻐하며 고개를 살짝 숙입니다.", en: "Moving the cursor back and forth over the pet's head makes it happy and bow slightly.", ja: "ペットの頭の上でカーソルを左右に往復させると、喜んで少し頭を下げます。" },
    "settings.appearance.capsLockToggle": { ko: "캡스락 켜짐 알림", en: "Caps Lock alert", ja: "Caps Lock通知" },
    "settings.appearance.capsLockNote": { ko: "Caps Lock이 켜져 있는 동안 눈과 입을 떨며 놀란 표정을 짓습니다.", en: "While Caps Lock is on, the pet's eyes and mouth tremble in a startled expression.", ja: "Caps Lockがオンの間、目と口を震わせて驚いた表情をします。" },
    "settings.appearance.dragReactionToggle": { ko: "들어올릴 때 반응", en: "Reaction when lifted", ja: "持ち上げた時の反応" },
    "settings.appearance.dragReactionNote": { ko: "펫을 드래그로 옮기는 동안 놀란 표정으로 팔을 허우적거립니다.", en: "While dragging the pet, it flails its arms with a startled expression.", ja: "ペットをドラッグしている間、驚いた表情で腕をバタつかせます。" },
    "settings.appearance.sleepToggle": { ko: "유휴 시 잠자기", en: "Sleep when idle", ja: "アイドル時に眠る" },
    "settings.appearance.sleepAfterLabel": { ko: "잠들기까지", en: "Time until asleep", ja: "眠るまでの時間" },
    "settings.appearance.minutesUnit": { ko: "분", en: "min", ja: "分" },
    "settings.appearance.secondsUnit": { ko: "초", en: "sec", ja: "秒" },
    "settings.appearance.sleepNote": { ko: "키보드·마우스 입력이 이 시간만큼 없으면 눈을 감고 숨을 쉬며 잠듭니다. 입력이 들어오면 깨어납니다. 미디어 재생 중에는 잠들지 않습니다.", en: "If there's no keyboard/mouse input for this long, the pet closes its eyes and sleeps, breathing gently. It wakes on any input, and never sleeps while media is playing.", ja: "この時間だけキーボード・マウス入力がないと、目を閉じて呼吸しながら眠ります。入力があると起きます。メディア再生中は眠りません。" },
    "settings.appearance.idleRoutineHeading": { ko: "랜덤 행동", en: "Random Actions", ja: "ランダム行動" },
    "settings.appearance.idleRoutineToggle": { ko: "랜덤 행동 사용", en: "Enable random actions", ja: "ランダム行動を使用" },
    "settings.appearance.idleRoutineMinLabel": { ko: "최소 주기", en: "Minimum interval", ja: "最小間隔" },
    "settings.appearance.idleRoutineMaxLabel": { ko: "최대 주기", en: "Maximum interval", ja: "最大間隔" },
    "settings.appearance.idleRoutineNote": { ko: "펫이 조용할 때 이 범위 안에서 랜덤하게 둘러보기, 기지개, 반짝 반응을 합니다. 마우스를 움직여도 작동할 수 있지만 말풍선·이동·잠자기·미디어 재생 중에는 쉬어갑니다.", en: "When the pet is quiet, it randomly looks around, stretches, or perks up within this interval. It can still run while the mouse moves, but pauses during bubbles, move mode, sleep, and media playback.", ja: "ペットが静かな時、この間隔内でランダムに見回す、伸びをする、反応する動きをします。マウス移動中でも動作しますが、吹き出し・移動モード・睡眠・メディア再生中は休みます。" },
    "settings.appearance.lightingHeading": { ko: "조명 설정", en: "Lighting", ja: "ライティング設定" },
    "settings.appearance.lightingNote": { ko: "조명을 조정하면 실시간으로 반영됩니다.", en: "Lighting changes apply in real time.", ja: "ライティングの調整はリアルタイムで反映されます。" },

    "settings.player.heading": { ko: "미디어 플레이어", en: "Media Player", ja: "メディアプレーヤー" },
    "settings.player.note": { ko: "유튜브 등에서 음악·영상이 재생 중이면 펫 옆에 재생 컨트롤을 표시합니다. (Windows 전용)", en: "Shows playback controls next to the pet when music/video is playing (e.g. YouTube). Windows only.", ja: "YouTubeなどで音楽・動画が再生中のとき、ペットの横に再生コントロールを表示します(Windows専用)。" },
    "settings.player.enableToggle": { ko: "미디어 플레이어 사용", en: "Use media player", ja: "メディアプレーヤーを使用" },
    "settings.player.scaleLabel": { ko: "플레이어 크기", en: "Player size", ja: "プレーヤーのサイズ" },
    "settings.player.offsetLabel": { ko: "높낮이", en: "Vertical offset", ja: "高さ位置" },
    "settings.player.opacityLabel": { ko: "투명도", en: "Opacity", ja: "不透明度" },
    "settings.player.nodToggle": { ko: "재생 중 고개 끄덕이기", en: "Nod head while playing", ja: "再生中に頭を揺らす" },

    "settings.customization.liveNote": { ko: "이 탭의 항목은 저장 버튼을 누르지 않아도 즉시 펫에 반영됩니다. 설정창을 저장 없이 닫으면 원래 상태로 되돌아갑니다.", en: "Items in this tab apply to the pet instantly, without pressing Save. Closing the settings window without saving reverts them.", ja: "このタブの項目は保存ボタンを押さなくてもすぐにペットに反映されます。保存せずに設定画面を閉じると元に戻ります。" },
    "settings.customization.presetsHeading": { ko: "커스터마이징 프리셋", en: "Customization Presets", ja: "カスタマイズプリセット" },
    "settings.customization.presetNameLabel": { ko: "이름", en: "Name", ja: "名前" },
    "settings.customization.presetNamePlaceholder": { ko: "내 프리셋", en: "My preset", ja: "マイプリセット" },
    "settings.customization.presetSaveButton": { ko: "현재 설정 저장", en: "Save Current Settings", ja: "現在の設定を保存" },
    "settings.customization.presetImportButton": { ko: "파일에서 가져오기", en: "Import from File", ja: "ファイルからインポート" },
    "settings.customization.presetsNote": { ko: "프리셋은 바디 색상·파츠 스타일·얼굴 무늬/장식/눈/입 설정을 저장합니다. 썸네일을 누르면 적용되지만 폼에만 반영되므로, 유지하려면 저장 버튼을 눌러주세요. 저장·삭제·가져오기는 즉시 반영되며 설정 저장 버튼과 무관합니다. 썸네일은 지금 사용 중인 조명·외곽선 설정으로 그려지며, 설정을 저장하거나 이 창을 다시 열면 새로 그려집니다.", en: "Presets store body colors, part styles, and face pattern/cosmetic/eye/mouth settings. Clicking a thumbnail applies it to the form only, so press Save to keep it. Save, delete, and import apply instantly and are independent of the Save button. Thumbnails are rendered with your current lighting and outline settings, and are redrawn when you save or reopen this window.", ja: "プリセットにはボディカラー・パーツスタイル・顔の模様/装飾/目/口の設定が保存されます。サムネイルを押すと適用されますがフォームにのみ反映されるので、維持するには保存ボタンを押してください。保存・削除・インポートは即座に反映され、設定の保存ボタンとは無関係です。サムネイルは現在の照明・輪郭線の設定で描画され、設定を保存するかこのウィンドウを再度開くと再描画されます。" },
    "settings.customization.faceHeading": { ko: "얼굴 커스터마이징", en: "Face Customization", ja: "顔のカスタマイズ" },
    "settings.customization.bodyHeading": { ko: "몸 커스터마이징", en: "Body Customization", ja: "体のカスタマイズ" },
    "settings.customization.bodyColorHeading": { ko: "바디 색상", en: "Body Colors", ja: "ボディカラー" },
    "settings.customization.partVariationHeading": { ko: "파츠 스타일", en: "Part Styles", ja: "パーツスタイル" },
    "settings.customization.partVariationNote": { ko: "펫의 직접적인 모델링 외형을 바꿉니다.", en: "Changes the pet's actual modeled appearance.", ja: "ペットの実際のモデリング外見を変更します。" },

    "settings.memory.heading": { ko: "기억 관리", en: "Memory Management", ja: "メモリー管理" },
    "settings.memory.description": { ko: "펫이 기억한 장기 기억과 미완료 주제를 관리합니다.", en: "Manage the pet's long-term memories and unresolved topics.", ja: "ペットの長期記憶と未解決のトピックを管理します。" },
    "settings.memory.statsHeading": { ko: "통계", en: "Statistics", ja: "統計" },
    "settings.memory.totalMemories": { ko: "장기 기억", en: "Long-term memories", ja: "長期記憶" },
    "settings.memory.openLoops": { ko: "미완료 주제", en: "Open loops", ja: "未解決のトピック" },
    "settings.memory.episodes": { ko: "대화 기록", en: "Conversation sessions", ja: "会話記録" },
    "settings.memory.longTermHeading": { ko: "장기 기억", en: "Long-term Memory", ja: "長期記憶" },
    "settings.memory.filterLabel": { ko: "분류", en: "Category", ja: "カテゴリー" },
    "settings.memory.noMemories": { ko: "저장된 기억이 없습니다.", en: "No memories saved yet.", ja: "保存された記憶はまだありません。" },
    "settings.memory.exportButton": { ko: "내보내기 (JSON)", en: "Export (JSON)", ja: "エクスポート (JSON)" },
    "settings.memory.importButton": { ko: "불러오기 (JSON)", en: "Import (JSON)", ja: "読み込み (JSON)" },
    "settings.memory.clearButton": { ko: "장기 기억 모두 삭제", en: "Delete All Long-term Memories", ja: "長期記憶をすべて削除" },
    "settings.memory.openLoopsHeading": { ko: "미완료 주제", en: "Open Loops", ja: "未解決のトピック" },
    "settings.memory.noOpenLoops": { ko: "미완료 주제가 없습니다.", en: "No open loops.", ja: "未解決のトピックはありません。" },
    "settings.memory.note": { ko: "기억은 자동으로 저장되며, 앱을 다시 시작해도 유지됩니다. 장기 기억은 확인 후 검증 표시를 할 수 있습니다.", en: "Memories are saved automatically and persist after app restart. You can verify long-term memories after review.", ja: "メモリーは自動的に保存され、アプリを再起動しても保持されます。長期記憶はレビュー後に検証できます。" },
    "settings.memory.category.all": { ko: "모두", en: "All", ja: "すべて" },
    "settings.memory.category.preference": { ko: "선호도", en: "Preference", ja: "好み" },
    "settings.memory.category.habit": { ko: "습관", en: "Habit", ja: "習慣" },
    "settings.memory.category.fact": { ko: "사실", en: "Fact", ja: "事実" },
    "settings.memory.category.relationship": { ko: "관계", en: "Relationship", ja: "関係" },
    "settings.memory.category.goal": { ko: "목표", en: "Goal", ja: "目標" },
    "settings.memory.verifyButton": { ko: "검증", en: "Verify", ja: "検証" },
    "settings.memory.verifiedBadge": { ko: "✓ 검증됨", en: "✓ Verified", ja: "✓ 検証済み" },
    "settings.memory.deleteButton": { ko: "삭제", en: "Delete", ja: "削除" },
    "settings.memory.importanceLabel": { ko: "중요도", en: "Importance", ja: "重要度" },
    "settings.memory.mentionCount": { ko: "{{n}}회 언급", en: "Mentioned {{n}}×", ja: "{{n}}回言及" },
    "settings.memory.loopToday": { ko: "오늘", en: "Today", ja: "今日" },
    "settings.memory.loopDaysAgo": { ko: "{{n}}일 전", en: "{{n}}d ago", ja: "{{n}}日前" },
    "settings.memory.loopCloseButton": { ko: "완료", en: "Resolve", ja: "完了" },
    "settings.memory.loopCloseReason": { ko: "사용자가 설정에서 완료 처리", en: "Resolved by the user in settings", ja: "ユーザーが設定で完了処理" },
    "settings.memory.confirmDelete": { ko: "이 기억을 삭제하시겠습니까?", en: "Delete this memory?", ja: "この記憶を削除しますか?" },
    "settings.memory.confirmCloseLoop": { ko: "이 주제를 완료 처리하시겠습니까?", en: "Mark this topic as resolved?", ja: "このトピックを完了として処理しますか?" },
    "settings.memory.confirmClear": { ko: "저장된 장기 기억을 모두 삭제하시겠습니까? 미완료 주제와 대화 기록은 유지됩니다. 이 작업은 되돌릴 수 없습니다.", en: "Delete all saved long-term memories? Open loops and conversation sessions will be kept. This cannot be undone.", ja: "保存された長期記憶をすべて削除しますか？未解決のトピックと会話記録は保持されます。この操作は取り消せません。" },
    "settings.memory.clearedAlert": { ko: "장기 기억이 모두 삭제되었습니다. 미완료 주제와 대화 기록은 유지됩니다.", en: "All long-term memories have been deleted. Open loops and conversation sessions were kept.", ja: "長期記憶をすべて削除しました。未解決のトピックと会話記録は保持されています。" },
    "settings.memory.loadFailed": { ko: "기억을 불러오지 못했습니다: {{message}}", en: "Failed to load memories: {{message}}", ja: "記憶を読み込めませんでした: {{message}}" },
    "settings.memory.loadLoopsFailed": { ko: "미완료 주제를 불러오지 못했습니다: {{message}}", en: "Failed to load open loops: {{message}}", ja: "未解決のトピックを読み込めませんでした: {{message}}" },
    "settings.memory.exportFailed": { ko: "내보내기 실패: {{message}}", en: "Export failed: {{message}}", ja: "エクスポートに失敗しました: {{message}}" },
    "settings.memory.clearRejected": { ko: "장기 기억을 삭제하지 못했습니다. 잠시 후 다시 시도해주세요.", en: "Could not delete long-term memories. Please try again.", ja: "長期記憶を削除できませんでした。しばらくしてからもう一度お試しください。" },
    "settings.memory.clearFailed": { ko: "장기 기억 삭제 실패: {{message}}", en: "Failed to delete long-term memories: {{message}}", ja: "長期記憶の削除に失敗しました: {{message}}" },
    "settings.memory.importFailed": { ko: "불러오기 실패: {{message}}", en: "Import failed: {{message}}", ja: "読み込みに失敗しました: {{message}}" },
    "settings.memory.importedAlert": { ko: "기억 {{n}}개를 불러왔습니다.", en: "Imported {{n}} memories.", ja: "記憶を{{n}}件読み込みました。" },

    "settings.tab.memory": { ko: "기억 관리", en: "Memory", ja: "メモリー" },
    "settings.tabGroup.pet": { ko: "펫", en: "Pet", ja: "ペット" },
    "settings.tabGroup.talk": { ko: "대화", en: "Talk", ja: "会話" },
    "settings.tabGroup.interaction": { ko: "알람과 조작", en: "Alarms & Input", ja: "アラームと操作" },
    "settings.tabGroup.app": { ko: "앱", en: "App", ja: "アプリ" },

    "settings.alerts.heading": { ko: "알람", en: "Alarms", ja: "アラーム" },
    "settings.alerts.soundToggle": { ko: "알람 사운드 사용", en: "Use alarm sound", ja: "アラーム音を使用" },
    "settings.alerts.soundLabel": { ko: "알람 사운드", en: "Alarm sound", ja: "アラーム音" },
    "settings.alerts.soundOption": { ko: "사운드 {{n}}", en: "Sound {{n}}", ja: "サウンド{{n}}" },
    "settings.alerts.titleLabel": { ko: "제목", en: "Title", ja: "タイトル" },
    "settings.alerts.messageLabel": { ko: "내용", en: "Message", ja: "内容" },
    "settings.alerts.repeatLabel": { ko: "반복 방식", en: "Repeat mode", ja: "繰り返し方式" },
    "settings.alerts.repeatInterval": { ko: "N분마다 반복", en: "Repeat every N minutes", ja: "N分ごとに繰り返し" },
    "settings.alerts.repeatHourly": { ko: "정시마다 (매 정각)", en: "On the hour", ja: "毎正時" },
    "settings.alerts.repeatDaily": { ko: "매일 특정 시각", en: "Daily at a set time", ja: "毎日決まった時刻" },
    "settings.alerts.repeatOnce": { ko: "한 번만 (몇 분 뒤)", en: "Once (in N minutes)", ja: "一度だけ(数分後)" },
    "settings.alerts.intervalLabel": { ko: "간격", en: "Interval", ja: "間隔" },
    "settings.alerts.hourlyLabel": { ko: "몇 시간마다", en: "Every", ja: "何時間ごと" },
    "settings.alerts.hoursUnit": { ko: "시간", en: "hour(s)", ja: "時間" },
    "settings.alerts.hourlyNote": {
      ko: "등록한 시각과 상관없이 시계의 정각(분·초 0)에 맞춰 울립니다.",
      en: "Rings on the hour (at :00), no matter when you added it.",
      ja: "登録した時刻に関係なく、時計の正時(分・秒が0)に鳴ります。"
    },
    "settings.alerts.dailyLabel": { ko: "매일 시각", en: "Daily time", ja: "毎日の時刻" },
    "settings.alerts.weatherBriefingToggle": { ko: "날씨 브리핑 포함", en: "Include weather briefing", ja: "天気ブリーフィングを含める" },
    "settings.alerts.weatherBriefingNote": { ko: "이 알람이 울릴 때 내용을 오늘·내일 날씨로 자동 채웁니다. 지역은 '일반' 탭에서 설정합니다.", en: "When this alarm rings, its message is auto-filled with today's and tomorrow's weather. Set the location in the General tab.", ja: "このアラームが鳴るとき、内容を今日・明日の天気で自動的に埋めます。地域は「一般」タブで設定します。" },
    "settings.alerts.weatherBriefingBadge": { ko: "날씨 브리핑", en: "Weather briefing", ja: "天気ブリーフィング" },
    "settings.alerts.onceLabel": { ko: "몇 분 뒤", en: "Minutes from now", ja: "何分後" },
    "settings.alerts.soundFileLabel": { ko: "알람 소리(선택)", en: "Alarm sound (optional)", ja: "アラーム音(任意)" },
    "settings.alerts.soundFilePickButton": { ko: "파일 선택", en: "Choose file", ja: "ファイルを選択" },
    "settings.alerts.soundFileClearButton": { ko: "기본값으로", en: "Use default", ja: "デフォルトに戻す" },
    "settings.alerts.soundFileNone": { ko: "기본 알람 소리 사용", en: "Using default alarm sound", ja: "デフォルトのアラーム音を使用" },
    "settings.alerts.soundFileChosen": { ko: "선택한 파일: {{name}}", en: "Selected file: {{name}}", ja: "選択したファイル: {{name}}" },
    "settings.alerts.customSoundBadge": { ko: "커스텀 소리", en: "Custom sound", ja: "カスタム音" },
    "settings.alerts.daysLabel": { ko: "반복 요일", en: "Repeat on", ja: "繰り返す曜日" },
    "settings.alerts.updateButton": { ko: "알람 수정", en: "Update Alarm", ja: "アラームを更新" },
    "settings.alerts.scheduleDailyDays": { ko: "{{days}} {{time}}", en: "{{days}} at {{time}}", ja: "{{days}} {{time}}" },
    "settings.alerts.disabledBadge": { ko: "꺼짐", en: "Off", ja: "オフ" },
    "settings.alerts.editButtonTitle": { ko: "알람 수정", en: "Edit alarm", ja: "アラームを編集" },
    "settings.alerts.enabledToggleTitle": { ko: "이 알람 켜기/끄기", en: "Turn this alarm on or off", ja: "このアラームのオン/オフ" },
    "weekday.sun": { ko: "일", en: "Sun", ja: "日" },
    "weekday.mon": { ko: "월", en: "Mon", ja: "月" },
    "weekday.tue": { ko: "화", en: "Tue", ja: "火" },
    "weekday.wed": { ko: "수", en: "Wed", ja: "水" },
    "weekday.thu": { ko: "목", en: "Thu", ja: "木" },
    "weekday.fri": { ko: "금", en: "Fri", ja: "金" },
    "weekday.sat": { ko: "토", en: "Sat", ja: "土" },
    "settings.alerts.addButton": { ko: "알람 추가", en: "Add Alarm", ja: "アラームを追加" },
    "settings.alerts.note": { ko: "알람이 울리면 확인 버튼을 누를 때까지 화면에 유지됩니다. N분마다/정시마다/매일 알람은 계속 반복되고, 한 번만 알람은 울린 뒤 자동으로 목록에서 사라집니다.", en: "When an alarm fires, it stays on screen until you press Confirm. Every-N-minutes, on-the-hour and daily alarms keep repeating; once alarms disappear from the list automatically after firing.", ja: "アラームが鳴ると、確認ボタンを押すまで画面に表示され続けます。N分ごと/正時/毎日のアラームは繰り返され、一度だけのアラームは鳴った後自動的にリストから消えます。" },
    "settings.alerts.testButton": { ko: "지금 알람 테스트", en: "Test Alarm Now", ja: "今すぐアラームをテスト" },

    "settings.ui.bubbleHeading": { ko: "말풍선", en: "Speech Bubble", ja: "吹き出し" },
    "settings.ui.bubbleThemeLabel": { ko: "말풍선 색상", en: "Bubble color", ja: "吹き出しの色" },
    "settings.ui.themeCharcoal": { ko: "차콜", en: "Charcoal", ja: "チャコール" },
    "settings.ui.themeRose": { ko: "로즈", en: "Rose", ja: "ローズ" },
    "settings.ui.themeOcean": { ko: "오션", en: "Ocean", ja: "オーシャン" },
    "settings.ui.themeForest": { ko: "포레스트", en: "Forest", ja: "フォレスト" },
    "settings.ui.themeAmber": { ko: "앰버", en: "Amber", ja: "アンバー" },
    "settings.ui.themeCustom": { ko: "커스텀", en: "Custom", ja: "カスタム" },
    "settings.ui.bubbleThemeNote": { ko: "테마는 선택 즉시 펫의 모든 말풍선과 이동 모드 안내에 미리 적용됩니다.", en: "The theme previews instantly on all of the pet's speech bubbles and the move-mode banner as soon as you pick it.", ja: "テーマを選ぶとすぐに、ペットのすべての吹き出しと移動モード案内にプレビューが適用されます。" },
    "settings.ui.customBgLabel": { ko: "배경색", en: "Background color", ja: "背景色" },
    "settings.ui.customAccentLabel": { ko: "포인트색", en: "Accent color", ja: "アクセントカラー" },
    "settings.ui.customTextLabel": { ko: "글씨색", en: "Text color", ja: "文字色" },
    "settings.ui.customContrastWarning": { ko: "글씨색과 배경색의 대비가 낮아 글자가 잘 안 보일 수 있습니다.", en: "Low contrast between text and background — text may be hard to read.", ja: "文字色と背景色のコントラストが低く、読みにくい可能性があります。" },
    "settings.ui.fontHeading": { ko: "글꼴", en: "Font", ja: "フォント" },
    "settings.ui.fontToggle": { ko: "UI 폰트 변경", en: "Change UI font", ja: "UIフォントを変更" },
    "settings.ui.fontPresetLabel": { ko: "폰트 종류", en: "Font", ja: "フォントの種類" },
    "settings.ui.fontRecommendedGroup": { ko: "추천 글꼴", en: "Recommended Fonts", ja: "おすすめフォント" },
    "settings.ui.fontInstalledGroup": { ko: "이 PC에 설치된 글꼴", en: "Fonts Installed on This PC", ja: "このPCにインストールされたフォント" },
    "settings.ui.fontSizeLabel": { ko: "글자 크기", en: "Font size", ja: "文字サイズ" },
    "settings.ui.scaleLabel": { ko: "UI 크기", en: "UI size", ja: "UIサイズ" },
    "settings.ui.scaleNote": { ko: "설정창·기록창의 전체 크기를 확대·축소합니다(펫 화면에는 적용되지 않습니다).", en: "Scales the overall size of the settings and history windows (doesn't affect the pet screen).", ja: "設定画面・履歴画面の全体サイズを拡大・縮小します(ペット画面には適用されません)。" },

    "settings.conversation.heading": { ko: "AI 질문 · Gemini API", en: "AI Q&A · Gemini API", ja: "AI質問 · Gemini API" },
    "settings.conversation.enableToggle": { ko: "펫 질문 기능 사용 (트레이 메뉴·단축키)", en: "Enable pet Q&A (tray menu · shortcut)", ja: "ペット質問機能を使用(トレイメニュー・ショートカット)" },
    "settings.conversation.apiKeyNote": { ko: "API 키는 \"일반\" 탭에서 입력합니다.", en: "Enter the API key in the \"General\" tab.", ja: "APIキーは「一般」タブで入力します。" },
    "settings.conversation.personalityLabel": { ko: "답변 성격", en: "Reply personality", ja: "返答の性格" },
    "settings.conversation.customPersonalityLabel": { ko: "사용자 지정 성격 한 줄", en: "Custom personality (one line)", ja: "カスタム性格(1行)" },
    "settings.conversation.customPersonalityPlaceholder": { ko: "예: 무뚝뚝하지만 은근히 챙겨주는 오래된 친구처럼 반말로 답해.", en: "e.g. Reply casually like a blunt but secretly caring old friend.", ja: "例: ぶっきらぼうだけどさりげなく気にかけてくれる旧友のようにタメ口で答えて。" },
    "settings.conversation.customPersonalityNote": { ko: "사용자 지정이 비어 있으면 편한 친구로 답합니다. 이모지·이모티콘 제외 규칙은 모든 성격에 공통 적용됩니다.", en: "If left empty, the pet answers as a Casual Friend. The no-emoji/emoticon rule applies to every personality.", ja: "カスタムが空の場合は「気楽な友達」として答えます。絵文字・顔文字を使わないルールはすべての性格に共通で適用されます。" },
    "settings.conversation.modelLabel": { ko: "AI 모델", en: "AI model", ja: "AIモデル" },
    "settings.conversation.userNicknameLabel": { ko: "나를 부르는 호칭", en: "What to call you", ja: "自分を呼ぶ呼称" },
    "settings.conversation.userNicknamePlaceholder": { ko: "비워두면 특별히 안 부름 (예: 사장님, OO아, 주인님)", en: "Leave blank for no special address (e.g. boss, buddy)", ja: "空欄なら特別な呼び方はしません(例: ご主人様、〜くん)" },
    "settings.conversation.petNicknameLabel": { ko: "펫이 자기 자신을 부르는 이름", en: "Name the pet calls itself", ja: "ペットが自分を呼ぶ名前" },
    "settings.conversation.petNicknamePlaceholder": { ko: "비워두면 '나'로 지칭 (예: 모모, 콩이)", en: "Leave blank to use \"I\" (e.g. Momo, Bean)", ja: "空欄なら「私」と呼びます(例: モモ、コンイ)" },
    "settings.conversation.memoryToggle": { ko: "최근 대화 기억하기", en: "Remember recent conversation", ja: "最近の会話を記憶" },
    "settings.conversation.memoryTurnsLabel": { ko: "기억할 최근 대화", en: "Recent turns to remember", ja: "記憶する最近の会話" },
    "settings.conversation.turnsUnit": { ko: "턴", en: "turns", ja: "ターン" },
    "settings.conversation.memoryNote": { ko: "켜두면 설정한 수의 최근 질문·답변을 참고해 답합니다. 다른 주제를 물으면 이전 대화에 얽매이지 않고 자연스럽게 새 주제로 넘어갑니다.", en: "When on, the pet references the chosen number of recent Q&As. If you ask something unrelated, it naturally moves to the new topic without being bound by the old one.", ja: "オンにすると、設定した数の直近の質問・回答を参考に答えます。別の話題を聞くと、前の会話にとらわれず自然に新しい話題に移ります。" },
    "settings.conversation.memoryTabToggle": { ko: "'기억 관리' 탭 표시 (고급 사용자 전용)", en: "Show 'Memory Management' tab (advanced users only)", ja: "「メモリー管理」タブを表示(上級ユーザー向け)" },
    "settings.conversation.memoryTabToggleNote": { ko: "펫이 저장한 장기 기억을 직접 조회·삭제하는 탭입니다. 대부분의 경우 펫에게 맡겨두는 편이 자연스러워 기본적으로 숨겨져 있습니다.", en: "This tab lets you directly view and delete the pet's long-term memories. It's hidden by default since most people find it more natural to just let the pet manage its own memory.", ja: "ペットが保存した長期記憶を直接確認・削除できるタブです。多くの場合ペットに任せておく方が自然なため、初期状態では非表示です。" },
    "settings.conversation.petChatHeading": { ko: "펫이 먼저 말 걸기", en: "Pet Speaks First", ja: "ペットから話しかける" },
    "settings.conversation.petChatToggle": { ko: "랜덤 주기로 먼저 말 걸기 사용", en: "Enable random-interval opener", ja: "ランダム間隔で話しかけを使用" },
    "settings.conversation.petChatMinLabel": { ko: "최소 주기", en: "Minimum interval", ja: "最短間隔" },
    "settings.conversation.petChatMaxLabel": { ko: "최대 주기", en: "Maximum interval", ja: "最長間隔" },
    "settings.conversation.petChatNote": { ko: "이 범위 안에서 매번 랜덤한 간격으로 펫이 먼저 말을 겁니다. 답장하거나 닫기 전까지는 다음 주기를 세지 않습니다.", en: "Within this range, the pet speaks first at a random interval each time. The next cycle doesn't start counting until you reply or close.", ja: "この範囲内で毎回ランダムな間隔でペットから話しかけます。返信するか閉じるまで次の周期はカウントされません。" },
    "settings.conversation.pettingChatToggle": { ko: "머리 쓰다듬으면 반응해서 말 걸기", en: "React and speak when the head is petted", ja: "頭を撫でたら反応して話しかける" },
    "settings.conversation.pettingChatNote": { ko: "머리를 한동안 계속 쓰다듬으면 펫이 반응해 말을 겁니다. 다른 말풍선이 떠 있지 않을 때만 동작합니다.", en: "If you keep petting the pet's head for a while, it reacts and speaks first. This only works when no other speech bubble is open.", ja: "頭を一定時間撫で続けると、ペットが反応して話しかけます。他の吹き出しが表示されていないときのみ動作します。" },
    "settings.conversation.animaleseHeading": { ko: "대화 효과음 모드", en: "Conversation Sound Mode", ja: "会話効果音モード" },
    "settings.conversation.animaleseToggle": { ko: "글자별 말하기 사용", en: "Enable per-character speech sound", ja: "文字ごとの発話音を使用" },
    "settings.conversation.animaleseIntervalLabel": { ko: "글자 재생 간격", en: "Character playback interval", ja: "文字再生間隔" },
    "settings.conversation.animalesePitchLabel": { ko: "음높이 변화폭", en: "Pitch variation range", ja: "音の高さの変化幅" },
    "settings.conversation.animaleseSoundLabel": { ko: "말하기 사운드", en: "Speech sound", ja: "しゃべり音" },
    "settings.conversation.animalesePetChatToggle": { ko: "펫이 먼저 말 걸 때도 적용", en: "Also apply when the pet speaks first", ja: "ペットから話しかける時にも適用" },

    "settings.shortcuts.heading": { ko: "단축키 설정", en: "Shortcut Settings", ja: "ショートカット設定" },
    "settings.shortcuts.assistantLabel": { ko: "질문창", en: "Question panel", ja: "質問ウィンドウ" },
    "settings.shortcuts.favoritesLabel": { ko: "즐겨찾기", en: "Favorites", ja: "お気に入り" },
    "settings.shortcuts.checklistLabel": { ko: "체크리스트", en: "Checklist", ja: "チェックリスト" },
    "settings.shortcuts.note": { ko: "단축키를 누르면 펫 설정, 질문 기록과 즐겨찾기 항목을 말풍선에서 실행할 수 있습니다. 체크리스트 단축키는 창을 열고 닫는 토글입니다.", en: "These shortcuts open the pet settings, Q&A history, and favorites from the speech bubble. The checklist shortcut toggles the window open/closed.", ja: "ショートカットを押すと、ペット設定・質問履歴・お気に入り項目を吹き出しから実行できます。チェックリストのショートカットはウィンドウの開閉トグルです。" },
    "settings.shortcuts.recorderNote": { ko: "단축키 칸을 클릭한 뒤 원하는 키 조합을 누르세요(예: Ctrl + Shift + A). 보조키(Ctrl/Alt/Shift) 하나 이상 + 다른 키 하나가 필요합니다. 마우스 측면 버튼(뒤로가기/앞으로가기)은 단독으로도 등록할 수 있습니다. Esc를 누르면 취소됩니다.", en: "Click a shortcut box, then press the key combination you want (e.g. Ctrl + Shift + A). You need at least one modifier (Ctrl/Alt/Shift) plus one other key. Mouse side buttons (back/forward) can be registered on their own. Press Esc to cancel.", ja: "ショートカット欄をクリックしてから、使いたいキーの組み合わせを押してください(例: Ctrl + Shift + A)。修飾キー(Ctrl/Alt/Shift)を1つ以上と、別のキーを1つ組み合わせる必要があります。マウスのサイドボタン(戻る/進む)は単独でも登録できます。Escでキャンセルできます。" },
    "settings.shortcuts.recordingPrompt": { ko: "키 또는 마우스 측면 버튼을 눌러주세요… (Esc: 취소)", en: "Press a key or mouse side button… (Esc to cancel)", ja: "キーまたはマウスのサイドボタンを押してください…(Escでキャンセル)" },
    "settings.shortcuts.mouseBack": { ko: "마우스 뒤로가기 버튼", en: "Mouse Back button", ja: "マウスの戻るボタン" },
    "settings.shortcuts.mouseForward": { ko: "마우스 앞으로가기 버튼", en: "Mouse Forward button", ja: "マウスの進むボタン" },
    "settings.shortcuts.enabledToggle": { ko: "사용", en: "Enabled", ja: "使用" },
    "settings.shortcuts.enabledNote": { ko: "\"사용\" 체크를 끄면 그 단축키는 전역으로 등록되지 않습니다(다른 프로그램과의 충돌을 피하거나, 잘 안 쓰는 기능의 단축키를 비워두고 싶을 때 사용하세요). 기능 자체는 트레이 메뉴 등 다른 방법으로 계속 쓸 수 있습니다.", en: "Turning off \"Enabled\" keeps that shortcut from being registered globally (useful to avoid conflicts with other programs, or to free up the key combo for a feature you rarely use). The feature itself is still available another way, such as from the tray menu.", ja: "「使用」のチェックを外すと、そのショートカットはグローバルに登録されません(他のプログラムとの競合を避けたい場合や、あまり使わない機能のショートカットを空けておきたい場合に使えます)。機能自体はトレイメニューなど別の方法で引き続き使えます。" },
    "settings.shortcuts.imageResizeHeading": { ko: "이미지 리사이징", en: "Image Resizing", ja: "画像のリサイズ" },
    "settings.shortcuts.shortcutLabel": { ko: "단축키", en: "Shortcut", ja: "ショートカット" },
    "settings.shortcuts.defaultScaleLabel": { ko: "기본 배율", en: "Default scale", ja: "デフォルト倍率" },
    "settings.shortcuts.imageResizeNote": { ko: "클립보드의 이미지를 선택된 옵션으로 리사이징하여 다시 복사합니다.", en: "Resizes the image on your clipboard with the selected options and copies it back.", ja: "クリップボードの画像を選択したオプションでリサイズし、再度コピーします。" },
    "settings.shortcuts.translateHeading": { ko: "클립보드 번역", en: "Clipboard Translation", ja: "クリップボード翻訳" },
    "settings.shortcuts.translateNote": { ko: "단축키를 누르면 번역창이 뜹니다. 번역 결과를 확인한 뒤 복사할지 선택할 수 있습니다. AI 질문 기능이 켜져 있어야 동작하며, 마지막에 고른 언어가 다음에 기본으로 선택됩니다.", en: "Pressing the shortcut opens the translate panel. You can review the result before choosing to copy it. Requires the AI Q&A feature to be on; the last language you picked becomes the default next time.", ja: "ショートカットを押すと翻訳パネルが開きます。翻訳結果を確認してからコピーするか選べます。AI質問機能がオンである必要があり、最後に選んだ言語が次回のデフォルトになります。" },
    "settings.shortcuts.translatePreferClipboardToggle": { ko: "번역창에 클립보드 내용 자동 입력", en: "Auto-fill translate panel from clipboard", ja: "翻訳パネルにクリップボードの内容を自動入力" },
    "settings.shortcuts.translatePreferClipboardNote": { ko: "켜두면 단축키를 눌렀을 때 클립보드 내용을 번역창에 미리 채워줍니다. 꺼두면 빈 칸으로 열리며 번역할 내용을 직접 입력할 수 있습니다. 어느 쪽이든 입력칸 내용은 실행 전에 자유롭게 고칠 수 있습니다.", en: "When on, pressing the shortcut pre-fills the translate panel with your clipboard content. When off, it opens empty so you can type the text yourself. Either way, you can freely edit the text before translating.", ja: "オンにすると、ショートカットを押したときにクリップボードの内容が翻訳パネルにあらかじめ入力されます。オフにすると空欄で開き、翻訳したい内容を直接入力できます。どちらの場合も、実行前に入力内容を自由に編集できます。" },

    "settings.favorites.heading": { ko: "즐겨찾기 실행기", en: "Favorites Launcher", ja: "お気に入りランチャー" },
    "settings.favorites.enableToggle": { ko: "즐겨찾기 실행기 사용", en: "Enable favorites launcher", ja: "お気に入りランチャーを使用" },
    "settings.favorites.gridToggle": { ko: "\ud578\ub4dc\ud3f0 \uc571 \uba54\ub274\ucc98\ub7fc \uadf8\ub9ac\ub4dc\ub85c \ubcf4\uae30", en: "Show favorites as a phone-style app grid", ja: "\u30b9\u30de\u30db\u30a2\u30d7\u30ea\u30e1\u30cb\u30e5\u30fc\u98a8\u306e\u30b0\u30ea\u30c3\u30c9\u3067\u8868\u793a" },
    "settings.favorites.trayItemsToggle": { ko: "트레이 메뉴에 즐겨찾기 개별 항목도 표시", en: "Also show individual favorites in the tray menu", ja: "トレイメニューにお気に入り項目も個別表示" },
    "settings.favorites.trayItemsNote": { ko: "기본값은 꺼짐입니다. 꺼져 있어도 트레이 메뉴의 ‘즐겨찾기 열기’로 불러올 수 있습니다.", en: "Off by default. Even when off, the tray menu can still open your favorites.", ja: "初期値はオフです。オフでもトレイメニューの「お気に入りを開く」から開けます。" },
    "settings.favorites.displayModeLabel": { ko: "표시 방식", en: "Display style", ja: "表示スタイル" },
    "settings.favorites.displayModeBubble": { ko: "펫 말풍선", en: "Pet speech bubble", ja: "ペットの吹き出し" },
    "settings.favorites.displayModeWindow": { ko: "이동 가능한 창", en: "Movable window", ja: "移動できるウィンドウ" },
    "settings.favorites.displayModeDock": { ko: "플로팅 버튼", en: "Floating button", ja: "フローティングボタン" },
    "settings.favorites.displayModeCursor": { ko: "마우스 위치에 열기", en: "Open at cursor", ja: "カーソル位置に開く" },
    "settings.favorites.displayModeNote": { ko: "‘이동 가능한 창’과 ‘플로팅 버튼’은 체크리스트처럼 자유롭게 옮길 수 있는 별도 창이며, 단축키로 켜고 끕니다. ‘마우스 위치에 열기’는 평소엔 아무것도 띄우지 않고, 단축키를 누른 순간의 커서 자리에 파이 메뉴만 띄웁니다.", en: "The movable window and the floating button are separate windows you can drag anywhere, like the checklist, and the shortcut toggles them on and off. \"Open at cursor\" shows nothing until you press the shortcut, then opens the pie menu right where your cursor is.", ja: "「移動できるウィンドウ」と「フローティングボタン」はチェックリストと同じように自由に動かせる別ウィンドウで、ショートカットでオン/オフします。「カーソル位置に開く」は普段は何も表示せず、ショートカットを押した瞬間のカーソル位置にパイメニューだけを開きます。" },
    "settings.favorites.addButton": { ko: "프로그램 또는 바로가기 추가", en: "Add Program or Shortcut", ja: "プログラムまたはショートカットを追加" },
    "settings.favorites.note": { ko: "EXE, Windows 바로가기(.lnk), 인터넷 바로가기(.url)를 최대 12개까지 등록할 수 있습니다.", en: "You can register up to 12 items: EXE files, Windows shortcuts (.lnk), or internet shortcuts (.url).", ja: "EXE、Windowsショートカット(.lnk)、インターネットショートカット(.url)を最大12個まで登録できます。" },

    "settings.footer.saveSuccess": { ko: "저장됐습니다", en: "Saved", ja: "保存しました" },
    "settings.footer.saveError": { ko: "설정을 저장하지 못했습니다.", en: "Couldn't save the settings.", ja: "設定を保存できませんでした。" },
    "settings.loadError": { ko: "설정을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.", en: "Couldn't load the settings. Please try again.", ja: "設定を読み込めませんでした。しばらくしてからもう一度お試しください。" },
    "settings.footer.recoveryIncomplete": {
      ko: "이전 설정을 완전히 복구하지 못했습니다. 앱을 재시작한 뒤 설정과 단축키를 확인해 주세요.",
      en: "The previous settings could not be fully restored. Restart the app, then check your settings and shortcuts.",
      ja: "以前の設定を完全には復元できませんでした。アプリを再起動して、設定とショートカットを確認してください。"
    },
    "settings.general.apiKeyReady": { ko: "API 키가 준비되었습니다.", en: "The API key is ready.", ja: "APIキーの準備ができています。" },
    "settings.general.apiKeyMissing": { ko: "API 키가 없어 질문 기능은 비활성화됩니다.", en: "The Q&A feature is disabled because there's no API key.", ja: "APIキーがないため質問機能は無効になります。" },
    "settings.favorites.emptyList": { ko: "등록된 바로가기가 없습니다.", en: "No shortcuts registered.", ja: "登録されたショートカットがありません。" },
    "settings.favorites.nameAriaLabel": { ko: "바로가기 이름", en: "Shortcut name", ja: "ショートカット名" },
    "settings.favorites.moveUp": { ko: "위로 이동", en: "Move up", ja: "上へ移動" },
    "settings.favorites.moveDown": { ko: "아래로 이동", en: "Move down", ja: "下へ移動" },
    "settings.favorites.iconAuto": { ko: "자동", en: "Auto", ja: "自動" },
    "settings.favorites.iconAutoHint": { ko: "프로그램 아이콘을 자동으로 가져옵니다.", en: "Automatically fetches the program's own icon.", ja: "プログラム自体のアイコンを自動で取得します。" },
    "settings.favorites.iconColorLabel": { ko: "아이콘 색상", en: "Icon color", ja: "アイコンの色" },
    "settings.favorites.hideGridLabelsToggle": { ko: "\uadf8\ub9ac\ub4dc\uc5d0\uc11c \uc774\ub984 \uc228\uae30\uace0 \ub9c8\uc6b0\uc2a4\ub97c \uc62c\ub9ac\uba74 \ud45c\uc2dc", en: "Hide names in the grid and show them on hover", ja: "\u30b0\u30ea\u30c3\u30c9\u3067\u540d\u524d\u3092\u96a0\u3057\u3001\u30db\u30d0\u30fc\u6642\u306b\u8868\u793a" },
    "settings.favorites.iconCustom": { ko: "\ucee4\uc2a4\ud140", en: "Custom", ja: "\u30ab\u30b9\u30bf\u30e0" },
    "settings.favorites.iconCustomButton": { ko: "\uc774\ubbf8\uc9c0", en: "Image", ja: "\u753b\u50cf" },
    "settings.favorites.iconCustomHint": { ko: "PNG, JPG, ICO \uc774\ubbf8\uc9c0\ub97c \uc544\uc774\ucf58\uc73c\ub85c \ubd88\ub7ec\uc635\ub2c8\ub2e4.", en: "Use a PNG, JPG, or ICO image as this icon.", ja: "PNG\u3001JPG\u3001ICO\u753b\u50cf\u3092\u30a2\u30a4\u30b3\u30f3\u3068\u3057\u3066\u4f7f\u7528\u3057\u307e\u3059\u3002" },
    "settings.favorites.iconPickerLabel": { ko: "\uc544\uc774\ucf58 \uc120\ud0dd", en: "Choose icon", ja: "\u30a2\u30a4\u30b3\u30f3\u3092\u9078\u629e" },
    "favoriteIcon.star": { ko: "별", en: "Star", ja: "スター" },
    "favoriteIcon.heart": { ko: "하트", en: "Heart", ja: "ハート" },
    "favoriteIcon.game": { ko: "게임", en: "Game", ja: "ゲーム" },
    "favoriteIcon.chat": { ko: "채팅", en: "Chat", ja: "チャット" },
    "favoriteIcon.music": { ko: "음악", en: "Music", ja: "音楽" },
    "favoriteIcon.folder": { ko: "폴더", en: "Folder", ja: "フォルダ" },
    "favoriteIcon.document": { ko: "문서", en: "Document", ja: "ドキュメント" },
    "favoriteIcon.image": { ko: "이미지", en: "Image", ja: "画像" },
    "favoriteIcon.video": { ko: "영상", en: "Video", ja: "動画" },
    "favoriteIcon.code": { ko: "코드", en: "Code", ja: "コード" },
    "favoriteIcon.globe": { ko: "브라우저", en: "Browser", ja: "ブラウザ" },
    "favoriteIcon.gear": { ko: "설정", en: "Settings", ja: "設定" },
    "favoriteIcon.mail": { ko: "메일", en: "Mail", ja: "メール" },
    "favoriteIcon.camera": { ko: "카메라", en: "Camera", ja: "カメラ" },
    "favoriteIcon.bookmark": { ko: "책갈피", en: "Bookmark", ja: "ブックマーク" },
    "favoriteIcon.clock": { ko: "시계", en: "Clock", ja: "時計" },
    "favoriteIcon.cloud": { ko: "구름", en: "Cloud", ja: "クラウド" },
    "favoriteIcon.terminal": { ko: "터미널", en: "Terminal", ja: "ターミナル" },
    "settings.alerts.emptyList": { ko: "등록된 알람이 없습니다.", en: "No alarms registered.", ja: "登録されたアラームがありません。" },
    "settings.alerts.scheduleInterval": { ko: "{{minutes}}분마다 반복", en: "Every {{minutes}} min", ja: "{{minutes}}分ごと" },
    "settings.alerts.scheduleHourly": { ko: "매 정각", en: "Every hour on the hour", ja: "毎正時" },
    "settings.alerts.scheduleHourlyEvery": { ko: "{{hours}}시간마다 정각", en: "Every {{hours}} h on the hour", ja: "{{hours}}時間ごとの正時" },
    "settings.alerts.scheduleDaily": { ko: "매일 {{time}}", en: "Daily at {{time}}", ja: "毎日{{time}}" },
    "settings.alerts.scheduleOnce": { ko: "1회성 · 약 {{minutes}}분 후", en: "One-time · in about {{minutes}} min", ja: "一度きり・約{{minutes}}分後" },

    // ---- 바디 색상/파츠 스타일/조명(설정 창에서 JS로 동적으로 그리는 라벨) ----
    "bodyColor.head": { ko: "머리", en: "Head", ja: "頭" },
    "bodyColor.body": { ko: "몸통", en: "Body", ja: "胴体" },
    "bodyColor.ears": { ko: "귀", en: "Ears", ja: "耳" },
    "bodyColor.tail": { ko: "꼬리", en: "Tail", ja: "しっぽ" },
    "bodyColor.headgear": { ko: "머리 장식", en: "Headgear", ja: "頭の装飾" },
    "bodyColor.hand": { ko: "손", en: "Hands", ja: "手" },
    "bodyColor.eye": { ko: "눈", en: "Eyes", ja: "目" },
    "bodyColor.mouth": { ko: "입", en: "Mouth", ja: "口" },
    "bodyColor.colorSuffix": { ko: "{{part}} 색상", en: "{{part}} color", ja: "{{part}}の色" },
    "customizeOnPet.heading": { ko: "펫에서 직접 편집", en: "Edit On the Pet", ja: "ペットで直接編集" },
    "customizeOnPet.openButton": { ko: "펫 주변에서 색 고르기", en: "Pick colors around the pet", ja: "ペットの周りで色を選ぶ" },
    "customizeOnPet.note": { ko: "펫 좌우에 파츠별 색상 카드를 띄워 어느 색이 어디에 쓰이는지 보면서 고를 수 있습니다. 여기서 고른 색은 곧바로 저장됩니다.", en: "Shows a color card for each part beside the pet, so you can see which color goes where while picking. Colors chosen here are saved immediately.", ja: "ペットの左右にパーツごとの色カードを表示し、どの色がどこに使われるか見ながら選べます。ここで選んだ色はすぐに保存されます。" },
    "customizeOnPet.hint": { ko: "파츠 색을 눌러 바꿔보세요", en: "Click a part's color to change it", ja: "パーツの色を押して変えてみてください" },
    "customizeOnPet.doneButton": { ko: "완료", en: "Done", ja: "完了" },
    "customizeOnPet.cancelButton": { ko: "취소", en: "Cancel", ja: "キャンセル" },

    "faceCustom.facePattern": { ko: "얼굴 무늬", en: "Face Pattern", ja: "顔の模様" },
    "faceCustom.faceCosmetic": { ko: "얼굴 장식", en: "Face Cosmetic", ja: "顔の装飾" },
    "faceCustom.eye": { ko: "눈", en: "Eyes", ja: "目" },
    "faceCustom.mouth": { ko: "입", en: "Mouth", ja: "口" },
    "faceCustom.optionNumbered": { ko: "{{label}} {{n}}", en: "{{label}} {{n}}", ja: "{{label}} {{n}}" },
    "bodyCustom.bodyCostume": { ko: "몸 무늬", en: "Body Pattern", ja: "体の模様" },
    "lighting.ambient": { ko: "앰비언트", en: "Ambient", ja: "アンビエント" },
    "lighting.keyLight": { ko: "주광", en: "Key Light", ja: "キーライト" },
    "lighting.rimLight": { ko: "림라이트", en: "Rim Light", ja: "リムライト" },
    "lighting.colorLabel": { ko: "색상", en: "Color", ja: "色" },
    "lighting.groundColorLabel": { ko: "하단 색상", en: "Ground color", ja: "下部の色" },
    "lighting.intensityLabel": { ko: "세기", en: "Intensity", ja: "強さ" },
    "lighting.positionLabel": { ko: "위치 {{axis}}", en: "Position {{axis}}", ja: "位置 {{axis}}" },
    "partVariation.antenna": { ko: "안테나", en: "Antenna", ja: "アンテナ" },
    "partVariation.bear": { ko: "곰", en: "Bear", ja: "クマ" },
    "partVariation.bunny": { ko: "토끼", en: "Bunny", ja: "うさぎ" },
    "partVariation.cat": { ko: "고양이", en: "Cat", ja: "猫" },
    "partVariation.fox": { ko: "여우", en: "Fox", ja: "キツネ" },
    "partVariation.round": { ko: "둥근꼬리", en: "Round Tail", ja: "丸いしっぽ" },
    "partVariation.choker": { ko: "초커", en: "Choker", ja: "チョーカー" },
    "partVariation.glassesround": { ko: "동그란 안경", en: "Round Glasses", ja: "丸メガネ" },
    "partVariation.glassessquare": { ko: "각진 안경", en: "Square Glasses", ja: "角メガネ" },
    "partVariation.ribbon": { ko: "리본", en: "Ribbon", ja: "リボン" },
    "partVariation.droopy": { ko: "처진 귀", en: "Droopy Ears", ja: "垂れ耳" },
    "partVariation.halo": { ko: "헤일로", en: "Halo", ja: "ハロー" },
    "partVariation.buckethat": { ko: "버킷햇", en: "Bucket Hat", ja: "バケットハット" },
    "partVariation.ballcap": { ko: "볼캡", en: "Ball Cap", ja: "野球帽" },
    "font.unavailableSuffix": { ko: "{{name}} (현재 PC에서 찾을 수 없음)", en: "{{name}} (not found on this PC)", ja: "{{name}} (このPCには見つかりません)" },
    "window.contextMenuTitle": { ko: "메뉴", en: "Menu", ja: "メニュー" },

    // ---- 저장 안 한 변경사항 확인 대화상자 ----
    "dialog.unsavedTitle": { ko: "저장하지 않은 변경사항", en: "Unsaved Changes", ja: "未保存の変更" },
    "dialog.unsavedMessage": { ko: "저장하지 않은 변경사항이 있습니다. 저장하지 않고 닫으시겠습니까?", en: "You have unsaved changes. Close without saving?", ja: "保存されていない変更があります。保存せずに閉じますか?" },

    // ---- 즐겨찾기(바로가기) ----
    "favorites.pickerTitle": { ko: "프로그램 또는 바로가기 선택", en: "Select a Program or Shortcut", ja: "プログラムまたはショートカットを選択" },
    "favorites.pickerFilterName": { ko: "프로그램 및 바로가기", en: "Programs and Shortcuts", ja: "プログラムとショートカット" },
    "favorites.iconPickerTitle": { ko: "\uc544\uc774\ucf58 \uc774\ubbf8\uc9c0 \uc120\ud0dd", en: "Select an Icon Image", ja: "\u30a2\u30a4\u30b3\u30f3\u753b\u50cf\u3092\u9078\u629e" },
    "favorites.iconPickerFilterName": { ko: "\uc544\uc774\ucf58 \uc774\ubbf8\uc9c0", en: "Icon Images", ja: "\u30a2\u30a4\u30b3\u30f3\u753b\u50cf" },
    "favorites.unsupportedIconError": { ko: "\uc9c0\uc6d0\ud558\uc9c0 \uc54a\ub294 \uc544\uc774\ucf58 \uc774\ubbf8\uc9c0\uc785\ub2c8\ub2e4.", en: "This icon image is not supported.", ja: "\u30b5\u30dd\u30fc\u30c8\u3055\u308c\u3066\u3044\u306a\u3044\u30a2\u30a4\u30b3\u30f3\u753b\u50cf\u3067\u3059\u3002" },
    "favorites.settingsOnlyError": { ko: "설정창에서만 바로가기를 추가할 수 있습니다.", en: "Shortcuts can only be added from the settings window.", ja: "ショートカットは設定画面からのみ追加できます。" },
    "favorites.unsupportedError": { ko: "지원하지 않는 바로가기 형식입니다.", en: "This shortcut format isn't supported.", ja: "サポートされていないショートカット形式です。" },
    "favorites.closedError": { ko: "즐겨찾기가 닫혀 있습니다.", en: "Favorites are closed.", ja: "お気に入りが閉じています。" },
    "favorites.unknownError": { ko: "알 수 없는 바로가기입니다.", en: "Unknown shortcut.", ja: "不明なショートカットです。" },
    "favorites.notFoundError": { ko: "저장된 바로가기를 찾을 수 없습니다.", en: "Couldn't find the saved shortcut.", ja: "保存されたショートカットが見つかりません。" },
    "favorites.movedError": { ko: "파일이 이동되었거나 삭제되었습니다.", en: "The file has been moved or deleted.", ja: "ファイルが移動または削除されました。" },
    "favorites.defaultName": { ko: "바로가기", en: "Shortcut", ja: "ショートカット" },
    "favorites.openingLabel": { ko: "{{label}} 여는 중…", en: "Opening {{label}}…", ja: "{{label}} を開いています…" },
    "favorites.runFailedError": { ko: "항목을 실행하지 못했습니다.", en: "Couldn't run this item.", ja: "項目を実行できませんでした。" },
    "favorites.selectPrompt": { ko: "실행할 항목을 선택하세요.", en: "Select an item to run.", ja: "実行する項目を選んでください。" },
    // 독립 창 / 플로팅 독 (2026-08-06)
    "favorites.closeButtonTitle": { ko: "닫기", en: "Close", ja: "閉じる" },
    "favorites.emptyState": { ko: "설정창 ‘바로가기’ 탭에서 항목을 추가해보세요.", en: "Add items in the Shortcuts tab of settings.", ja: "設定の「ショートカット」タブから項目を追加してください。" },
    "favorites.dockOpenTitle": { ko: "즐겨찾기 열기 (드래그해서 이동)", en: "Open favorites (drag to move)", ja: "お気に入りを開く（ドラッグで移動）" },
    "favorites.dockCloseTitle": { ko: "닫기 (드래그해서 이동)", en: "Close (drag to move)", ja: "閉じる（ドラッグで移動）" },
    "favorites.dockHideTitle": { ko: "독 숨기기", en: "Hide dock", ja: "ドックを隠す" },
    "favorites.cursorCloseTitle": { ko: "닫기", en: "Close", ja: "閉じる" },

    // ---- 커스터마이징 프리셋 내보내기/가져오기 ----
    "customization.exportTitle": { ko: "커스터마이징 내보내기", en: "Export Customization", ja: "カスタマイズをエクスポート" },
    "customization.importTitle": { ko: "커스터마이징 가져오기", en: "Import Customization", ja: "カスタマイズをインポート" },
    "customization.saveFailedError": { ko: "파일을 저장하지 못했습니다.", en: "Couldn't save the file.", ja: "ファイルを保存できませんでした。" },
    "customization.settingsWindowNotFoundError": { ko: "설정 창을 찾을 수 없습니다.", en: "Couldn't find the settings window.", ja: "設定ウィンドウが見つかりません。" },
    "customization.invalidFileError": { ko: "올바른 커스터마이징 파일이 아닙니다.", en: "This isn't a valid customization file.", ja: "有効なカスタマイズファイルではありません。" },
    "customization.defaultPresetName": { ko: "이름 없는 프리셋", en: "Untitled Preset", ja: "名前なしプリセット" },
    "customization.builtinPreset.cherry": { ko: "체리", en: "Cherry", ja: "チェリー" },
    "customization.builtinPreset.miro": { ko: "미로", en: "Miro", ja: "ミロ" },
    "customization.builtinPreset.loro": { ko: "로로", en: "Loro", ja: "ロロ" },
    "customization.exportFailedError": { ko: "내보내지 못했습니다.", en: "Couldn't export.", ja: "エクスポートできませんでした。" },
    "customization.importFailedError": { ko: "가져오지 못했습니다.", en: "Couldn't import.", ja: "インポートできませんでした。" },
    "customization.emptyPresetList": { ko: "저장된 프리셋이 없습니다.", en: "No presets saved yet.", ja: "保存されたプリセットがありません。" },
    "customization.presetThumbnailPending": { ko: "미리보기 준비 중", en: "Preview loading", ja: "プレビュー準備中" },

    // ---- 커스텀 얼굴 ----
    "customFace.heading": { ko: "커스텀 얼굴", en: "Custom Face", ja: "カスタムフェイス" },
    "customFace.enableToggle": { ko: "커스텀 얼굴 사용", en: "Use custom face", ja: "カスタムフェイスを使用" },
    "customFace.importButton": { ko: "얼굴 zip 파일 불러오기", en: "Import Face ZIP", ja: "顔のZIPファイルを読み込む" },
    "customFace.note": {
      ko: "켜두면 기본 눈·입 대신, 불러온 zip 안의 이미지를 표정별로 보여줍니다. zip 안에 customface_normal.png, customface_happy.png, customface_angry.png, customface_sad.png, customface_alarm.png, customface_shocked.png, customface_normal_blink.png 파일을 넣어주세요(모두 있을 필요는 없음 — 없는 표정은 normal 이미지로 대체되고, 그마저 없으면 표시하지 않습니다). 이미지에는 색을 입히지 않고 그대로 보여줍니다.",
      en: "When on, images from your imported ZIP replace the default eyes/mouth for each expression. Put files named customface_normal.png, customface_happy.png, customface_angry.png, customface_sad.png, customface_alarm.png, customface_shocked.png, and customface_normal_blink.png inside the ZIP (not all are required — missing expressions fall back to the normal image, or show nothing if that's missing too). These images are shown as-is, with no color tint applied.",
      ja: "オンにすると、デフォルトの目・口の代わりに、読み込んだZIP内の画像を表情ごとに表示します。ZIP内にcustomface_normal.png、customface_happy.png、customface_angry.png、customface_sad.png、customface_alarm.png、customface_shocked.png、customface_normal_blink.pngというファイルを入れてください(すべて揃っている必要はありません — ない表情はnormal画像で代替され、それもなければ表示しません)。画像は色を付けずそのまま表示されます。"
    },
    "customFace.statusLoaded": { ko: "{{count}}개 표정 이미지 불러옴: {{keys}}", en: "Loaded {{count}} expression images: {{keys}}", ja: "{{count}}個の表情画像を読み込みました: {{keys}}" },
    "customFace.statusNone": { ko: "아직 불러온 커스텀 얼굴 이미지가 없습니다.", en: "No custom face images imported yet.", ja: "まだカスタムフェイス画像を読み込んでいません。" },
    "customFace.importTitle": { ko: "커스텀 얼굴 zip 선택", en: "Select Custom Face ZIP", ja: "カスタムフェイスZIPを選択" },
    "customFace.invalidZipError": { ko: "올바른 zip 파일이 아닙니다.", en: "This isn't a valid ZIP file.", ja: "有効なZIPファイルではありません。" },
    "customBody.heading": { ko: "커스텀 바디", en: "Custom Body", ja: "カスタムボディ" },
    "customBody.enableToggle": { ko: "커스텀 바디 사용", en: "Use custom body", ja: "カスタムボディを使用" },
    "customBody.importButton": { ko: "몸 이미지(PNG) 불러오기", en: "Import Body Image (PNG)", ja: "体の画像(PNG)を読み込む" },
    "customBody.note": {
      ko: "켜두면 기본 몸 무늬 대신 불러온 이미지 한 장을 몸에 입힙니다. 얼굴과 달리 표정이 없어서 zip이 아니라 PNG 한 장만 고르면 됩니다. 몸 UV에 맞춰 그린 투명 배경 PNG를 준비해주세요. 이미지에는 색을 입히지 않고 그대로 보여줍니다.",
      en: "When enabled, the imported image replaces the built-in body pattern. Unlike the face there are no expressions, so you pick a single PNG instead of a ZIP. Prepare a transparent-background PNG drawn to match the body UV. The image is shown as-is without any tint.",
      ja: "オンにすると、読み込んだ画像1枚が既定の体の模様の代わりに体に貼られます。顔と違って表情がないので、ZIPではなくPNGを1枚選ぶだけです。体のUVに合わせた背景透過PNGを用意してください。画像には色を付けずそのまま表示します。"
    },
    "customBody.statusLoaded": { ko: "커스텀 바디 이미지를 불러왔습니다.", en: "Custom body image imported.", ja: "カスタムボディ画像を読み込みました。" },
    "customBody.statusNone": { ko: "아직 불러온 커스텀 바디 이미지가 없습니다.", en: "No custom body image imported yet.", ja: "まだカスタムボディ画像を読み込んでいません。" },
    "customBody.importTitle": { ko: "커스텀 바디 PNG 선택", en: "Select Custom Body PNG", ja: "カスタムボディPNGを選択" },
    "customBody.invalidImageError": { ko: "PNG 이미지를 읽지 못했습니다. 16MB 이하의 PNG 파일인지 확인해주세요.", en: "Couldn't read the PNG image. Make sure it's a PNG file of 16MB or less.", ja: "PNG画像を読み込めませんでした。16MB以下のPNGファイルか確認してください。" },
    "customFace.noMatchingFilesError": { ko: "zip 안에서 customface_(표정이름).png 형식의 파일을 찾지 못했습니다.", en: "Couldn't find any files named customface_(expression).png inside the ZIP.", ja: "ZIP内にcustomface_(表情名).png形式のファイルが見つかりませんでした。" },
    "customization.exportButton": { ko: "내보내기", en: "Export", ja: "エクスポート" },

    // ---- 단축키 충돌 ----
    "shortcuts.conflictError": { ko: "{{a}}와(과) {{b}}가 같은 단축키({{shortcut}})를 쓰고 있습니다. 서로 다르게 지정해주세요.", en: "{{a}} and {{b}} use the same shortcut ({{shortcut}}). Please set them differently.", ja: "{{a}}と{{b}}が同じショートカット({{shortcut}})を使っています。別々に設定してください。" },
    "shortcuts.occupiedError": { ko: "{{shortcut}} 단축키를 다른 프로그램이 사용 중입니다. 다른 조합을 선택해주세요.", en: "The {{shortcut}} shortcut is already used by another program. Please choose a different combination.", ja: "{{shortcut}} ショートカットは他のプログラムが使用中です。別の組み合わせを選んでください。" },
    "settingsBackup.exportTitle": { ko: "설정 전체 내보내기", en: "Export All Settings", ja: "設定全体をエクスポート" },
    "settingsBackup.importTitle": { ko: "설정 전체 가져오기", en: "Import All Settings", ja: "設定全体をインポート" },
    "settingsBackup.invalidFileError": { ko: "올바른 설정 백업 파일이 아닙니다.", en: "This isn't a valid settings backup file.", ja: "有効な設定バックアップファイルではありません。" },

    // ---- 이미지 리사이징/번역 오류 ----
    "imageResize.notDetectedError": { ko: "이미지 감지 안됐습니다", en: "No image detected", ja: "画像が検出されませんでした" },
    "imageResize.failedError": { ko: "리사이징 실패", en: "Resize failed", ja: "リサイズに失敗しました" },
    "imageResize.doneMessage": { ko: "{{percent}}% 리사이징 완료", en: "Resized to {{percent}}%", ja: "{{percent}}%にリサイズ完了" },
    "translate.emptyTextError": { ko: "번역할 텍스트를 입력해주세요.", en: "Please enter text to translate.", ja: "翻訳するテキストを入力してください。" },
    "translate.textTooLongError": { ko: "텍스트가 너무 깁니다 (5000자 이하)", en: "Text is too long (5000 characters max)", ja: "テキストが長すぎます(5000文字以内)" },
    "translate.emptyResultError": { ko: "번역 결과가 비었습니다", en: "The translation result was empty", ja: "翻訳結果が空でした" },
    "translate.failedError": { ko: "번역 실패", en: "Translation failed", ja: "翻訳に失敗しました" },
    "translate.blockedError": { ko: "번역이 안전 필터에 의해 차단됐습니다 ({{reason}})", en: "Translation was blocked by the safety filter ({{reason}})", ja: "翻訳が安全フィルターによってブロックされました ({{reason}})" },

    // ---- AI 질문 관련 오류 ----
    "assistant.disabledError": { ko: "펫 질문 기능이 꺼져 있거나 API 키가 없습니다.", en: "The pet Q&A feature is off, or no API key is set.", ja: "ペット質問機能がオフか、APIキーが未設定です。" },
    "assistant.emptyQuestionError": { ko: "질문을 입력해주세요.", en: "Please enter a question.", ja: "質問を入力してください。" },
    "assistant.emptyAnswerError": { ko: "AI 모델이 빈 답변을 보냈습니다.", en: "The AI model returned an empty answer.", ja: "AIモデルが空の回答を返しました。" },
    "assistant.emptyReplyError": { ko: "답장을 입력해주세요.", en: "Please enter a reply.", ja: "返信を入力してください。" },
    "assistant.petChatOpenerQuestionLabel": { ko: "(펫이 먼저 말을 걸었음)", en: "(The pet spoke first)", ja: "(ペットが先に話しかけました)" },
    "assistant.enableFirstError": { ko: "AI 질문 기능을 먼저 켜주세요", en: "Please turn on the AI Q&A feature first", ja: "先にAI質問機能をオンにしてください" },
    "assistant.apiKeyError": { ko: "API 키를 확인해주세요. 키가 유효하고 Gemini API 사용 권한이 있어야 합니다.", en: "Please check your API key. It must be valid and have Gemini API access.", ja: "APIキーを確認してください。有効でGemini APIの利用権限が必要です。" },
    "assistant.quotaError": { ko: "Gemini 무료 사용 한도에 도달했습니다. 잠시 후 다시 시도해주세요.", en: "You've hit the Gemini free-tier limit. Please try again shortly.", ja: "Geminiの無料利用上限に達しました。しばらくしてから再試行してください。" },
    "assistant.networkError": { ko: "인터넷 연결을 확인한 뒤 다시 시도해주세요.", en: "Please check your internet connection and try again.", ja: "インターネット接続を確認してから再試行してください。" },
    "assistant.unknownError": { ko: "알 수 없는 오류가 발생했습니다.", en: "An unknown error occurred.", ja: "不明なエラーが発生しました。" },
    "assistant.requestFailedError": { ko: "요청 실패 ({{status}})", en: "Request failed ({{status}})", ja: "リクエスト失敗 ({{status}})" },
    "assistant.requestTimedOutError": { ko: "답변을 기다리는 시간이 너무 길어 요청을 취소했습니다.", en: "The request was canceled because the answer took too long.", ja: "回答待ちの時間が長すぎたためリクエストをキャンセルしました。" },
    "assistant.emptyAnswerShortError": { ko: "빈 응답", en: "Empty response", ja: "空の応答" },
    "assistant.thinkingStatus": { ko: "펫이 답변을 생각하고 있어요…", en: "The pet is thinking of an answer…", ja: "ペットが答えを考えています…" },
    "assistant.noAnswerError": { ko: "답변을 받지 못했습니다.", en: "Didn't receive an answer.", ja: "回答を受け取れませんでした。" },
    "assistant.enterQuestionPrompt": { ko: "질문을 입력해주세요.", en: "Please enter a question.", ja: "質問を入力してください。" },
    "assistant.ctrlEnterHint": { ko: "Ctrl + Enter로 질문할 수 있어요.", en: "Press Ctrl + Enter to ask.", ja: "Ctrl + Enterで質問できます。" },
    "petChat.replyOrCloseHint": { ko: "답장하거나 닫기를 눌러주세요.", en: "Reply, or press Close.", ja: "返信するか閉じるを押してください。" },
    "petChat.alreadyActiveError": { ko: "이미 펫과 대화 중입니다.", en: "You're already chatting with the pet.", ja: "すでにペットと会話中です。" },
    "secureStorage.unavailableError": { ko: "이 PC에서 API 키 보안 저장소를 사용할 수 없습니다.", en: "Secure API key storage isn't available on this PC.", ja: "このPCではAPIキーの安全な保存を利用できません。" },

    // ---- AI 프롬프트(모델에게 보내는 지시문) ----
    "assistant.personality.friend": {
      ko: "편한 친구처럼 자연스러운 반말로 답하세요. 친근하지만 담백하게 말하고, 호칭을 반복하거나 사용자를 과하게 추켜세우지 마세요.",
      en: "Reply casually, like a close friend talking informally. Be warm but plain-spoken, and don't repeat the user's name/title or over-praise them.",
      ja: "親しい友達のように、自然なタメ口で答えてください。親しみやすくも淡々と話し、呼び方を繰り返したり相手を過度に持ち上げたりしないでください。"
    },
    "assistant.personality.polite": {
      ko: "친근한 존댓말로 부드럽게 답하세요.",
      en: "Reply gently in a friendly, polite tone.",
      ja: "親しみやすい丁寧語で、柔らかく答えてください。"
    },
    "assistant.personality.concise": {
      ko: "감정 표현을 줄인 담백한 조언자처럼 핵심과 근거를 짧고 명확하게 답하세요.",
      en: "Reply like a plain, low-emotion advisor: short, clear, with the key point and reasoning.",
      ja: "感情表現を抑えた淡々としたアドバイザーのように、要点と根拠を短く明確に答えてください。"
    },
    "assistant.personality.playful": {
      ko: "편한 친구처럼 자연스러운 반말로 답하고 가벼운 농담을 가끔 섞으세요.",
      en: "Reply casually and informally like a close friend, occasionally mixing in light jokes.",
      ja: "親しい友達のように自然なタメ口で答え、たまに軽い冗談を混ぜてください。"
    },
    "assistant.commonStyle": {
      ko: "성격 설정과 관계없이 이모지와 이모티콘을 사용하지 마세요. 동물 말투를 피하세요. 사용자가 역할극을 명시적으로 요청하지 않는 한 고양이나 반려동물처럼 연기하지 마세요. 사용자에게 친근하게 대하고, 사용자에 대한 과한 비난은 피하세요. 감정표현 시 !,~,? 같은 문장부호를 사용하여 자연스럽게 감정을 표현하세요. 이 공통 규칙은 사용자 지정 성격 지시보다 우선합니다.",
      en: "Regardless of personality setting, don't use emoji or emoticons. Avoid animal-like speech patterns. Don't act like a cat or pet unless the user explicitly asks for role-play. Be friendly toward the user and avoid harsh criticism of them. When expressing your emotions, use sentence particles such as !, ~, and ? to convey your feelings naturally. This common rule takes priority over the custom personality instruction.",
      ja: "性格設定に関わらず、絵文字や顔文字は使わないでください。動物っぽい話し方は避けてください。ユーザーが明示的にロールプレイを求めない限り、猫やペットのように振る舞わないでください。ユーザーには親しみを持って接し、過度な非難は避けてください。感情表現の際は、!,~,? のような句読点を使って自然に感情を表現してください。この共通ルールはカスタム性格指示より優先されます。"
    },
    "assistant.customPersonalityPrefix": {
      ko: "사용자가 지정한 성격 지시: {{text}}",
      en: "User-specified personality instruction: {{text}}",
      ja: "ユーザー指定の性格指示: {{text}}"
    },
    // 강제로 한 언어를 지정하지 않고, 사용자가 실제로 쓴 언어(또는 최근 대화 기록의 언어)를
    // 감지해서 그 언어로 답하도록 한다. 감지할 사용자 언어가 전혀 없을 때(펫이 먼저 말을
    // 걸었고 이전 대화 기록도 없는 경우)만 앱에 설정된 언어로 폴백한다(2026-08-02, 사용자
    // 피드백 — "대화 기능이 사용자 언어를 헷갈려하는거같은데, AI가 감지해서 대답하게").
    "assistant.languageDirective": {
      ko: "무엇보다 먼저, 지금 사용자가 입력한 질문 자체의 언어로 답하세요(예: 일본어로 물으면 일본어로, 영어로 물으면 영어로) — 이전 대화가 다른 언어였더라도 이번 질문의 언어를 최우선으로 따르세요. 이번 질문만으로는 언어를 판단하기 어려울 만큼 짧거나 언어색이 없을 때만(예: 숫자·이모지뿐) 최근 대화 기록의 언어를 참고하세요. 참고할 사용자 언어가 정말 전혀 없는 경우에만(예: 펫이 먼저 말을 거는 상황이고 참고할 이전 대화 기록도 없을 때) 한국어로 답하세요.",
      en: "Above all, respond in the language of the CURRENT question itself (e.g. if asked in Japanese, answer in Japanese; if in English, answer in English) — the language of this question takes priority even if earlier turns were in a different language. Only fall back to the recent conversation's language when this question alone is too short or language-neutral to judge (e.g. only numbers or emoji). Only fall back to English when there is truly no user language available at all (e.g. the pet is speaking first with no prior conversation to reference).",
      ja: "何よりもまず、今ユーザーが入力した質問自体の言語で答えてください(例: 日本語で聞かれたら日本語で、英語で聞かれたら英語で)— 以前の会話が別の言語であっても、今回の質問の言語を最優先してください。今回の質問だけでは言語を判断しにくいほど短い、または言語色がない場合(例: 数字や絵文字のみ)にのみ、直近の会話履歴の言語を参考にしてください。参考にできるユーザーの言語が本当に何もない場合(例: ペットが先に話しかけていて過去の会話履歴もない場合)にのみ、日本語で答えてください。"
    },
    // 프롬프트 맨 앞의 languageDirective만으로는(특히 이전 대화 기록이 길게 끼어 있을 때)
    // 모델이 지시를 놓치는 경우가 있어서(2026-08-02, 일본어 앱에서 "こんにちは"라고 물었는데
    // 한국어로 답한 실제 재현 사례), 실제 질문 바로 앞에 짧게 한 번 더 상기시킨다 — LLM은
    // 프롬프트 끝(생성 지점)에 가까운 지시를 더 잘 따르는 경향이 있다.
    "assistant.languageReminder": {
      ko: "(바로 아래 질문과 같은 언어로 답하세요)",
      en: "(Respond in the same language as the question right below)",
      ja: "(すぐ下の質問と同じ言語で答えてください)"
    },
    "assistant.memoryNote": {
      ko: "\n\n바로 아래에 최근 나눈 대화 기록이 참고용으로 주어질 수 있습니다. 이번 질문이 이전 대화와 이어지는 내용이면 자연스럽게 맥락을 이어가고, 전혀 다른 새로운 주제이면 이전 대화에 얽매이지 말고 새 주제에 자연스럽게 집중해서 답하세요.",
      en: "\n\nBelow, recent conversation history may be given for reference. If this question continues the previous conversation, keep the context naturally; if it's a completely different topic, don't be bound by the previous conversation and focus naturally on the new topic.",
      ja: "\n\nこの下に、最近の会話履歴が参考として与えられることがあります。今回の質問が前の会話の続きなら自然に文脈を引き継ぎ、まったく別の話題なら前の会話にとらわれず新しい話題に自然に集中して答えてください。"
    },
    "assistant.nicknameNote": {
      ko: " 사용자를 \"{{nickname}}\"라고 부르며 답하세요(과하게 자주 반복하지 말고 자연스러운 순간에만 사용).",
      en: " Address the user as \"{{nickname}}\" (don't overuse it — only at natural moments).",
      ja: " ユーザーを「{{nickname}}」と呼んで答えてください(多用せず、自然な場面でだけ使う)。"
    },
    "assistant.petNicknameNote": {
      ko: " 당신(펫) 자신을 지칭할 때는 \"나\" 대신 \"{{nickname}}\"이라는 이름을 사용하세요(예: \"나는\" → \"{{nickname}}는\").",
      en: " When referring to yourself (the pet), use the name \"{{nickname}}\" instead of \"I\" (e.g. \"I am\" → \"{{nickname}} is\").",
      ja: " 自分(ペット)を指すときは「私」の代わりに「{{nickname}}」という名前を使ってください(例:「私は」→「{{nickname}}は」)。"
    },
    "assistant.instructionsMain": {
      ko: "{{personality}}{{nicknameNote}}{{petNicknameNote}} {{commonStyle}} 데스크톱 펫 말풍선에 맞게 핵심부터 답하고, 가능하면 답변은 200자 이하로 작성하세요. 사용자가 자세한 답변을 요구시 더 작성해도 됩니다. 1~2문장 작성 후 줄바꿈을 해주세요.",
      en: "{{personality}}{{nicknameNote}}{{petNicknameNote}} {{commonStyle}} Answer with the key point first, suited to a desktop pet speech bubble, ideally within 200 characters. You may write more if the user explicitly asks for a detailed answer. Add a line break after every 1-2 sentences.",
      ja: "{{personality}}{{nicknameNote}}{{petNicknameNote}} {{commonStyle}} デスクトップペットの吹き出しに合わせて要点から答え、できれば200文字以内にまとめてください。ユーザーが詳しい説明を求めた場合はもっと書いても構いません。1〜2文ごとに改行を入れてください。"
    },
    "assistant.dateTimeInstruction": {
      ko: "위 날짜·시각은 프로그램이 이번 질문을 보내는 순간 PC에서 읽은 값입니다. 오늘·내일·어제·현재 시각 같은 표현은 반드시 이 값을 기준으로 해석하세요. 날짜·시각 정보만으로 최신 뉴스·날씨·주가 같은 외부 실시간 정보를 안다고 가정하지 마세요.",
      en: "The date/time above is what the program read from the PC at the moment it sent this question. Interpret expressions like today/tomorrow/yesterday/current time strictly based on this value. Don't assume you know real-time external information like the latest news, weather, or stock prices just because you have the date/time.",
      ja: "上記の日付・時刻は、プログラムが今回の質問を送信した瞬間にPCから読み取った値です。今日・明日・昨日・現在時刻といった表現は必ずこの値を基準に解釈してください。日付・時刻情報だけで最新のニュース・天気・株価のような外部のリアルタイム情報を知っていると想定しないでください。"
    },
    "assistant.expressionTagInstruction": {
      ko: "답변을 마친 뒤 반드시 마지막 줄에 답변 내용의 감정에 맞는 표정 태그를 한 줄로 추가하세요. 형식은 정확히 \"[expression: 값]\" 이고 값은 normal(평범), happy(기쁨·긍정적), angry(화남·불만), sad(슬픔·안좋은 소식), alarm(신남·들뜸), shocked(놀람·당황) 중 하나만 사용하세요. alarm은 화남·불만이 아니라 신나고 들뜬 감정에만 사용하세요. 이 태그 줄 앞뒤로 다른 텍스트를 붙이지 마세요.",
      en: "After finishing your answer, you must add an expression tag on its own last line matching the emotion of your answer. The format must be exactly \"[expression: value]\", where value is one of: normal, happy (joyful/positive), angry (upset/complaining), sad (bad news), alarm (excited/thrilled), shocked (surprised/flustered). Use alarm only for excited/thrilled feelings, not anger. Don't attach any other text before or after this tag line.",
      ja: "回答を終えたら、必ず最後の行に回答内容の感情に合った表情タグを1行追加してください。形式は正確に「[expression: 値]」とし、値は normal(普通)、happy(喜び・肯定的)、angry(怒り・不満)、sad(悲しい・悪い知らせ)、alarm(興奮・ワクワク)、shocked(驚き・動揺)のいずれか一つだけ使ってください。alarmは怒りではなく、興奮・ワクワクした感情にのみ使ってください。このタグ行の前後に他のテキストを付けないでください。"
    },
    "assistant.historyBlockHeader": {
      ko: "[최근 대화 기록 - 참고용]",
      en: "[Recent conversation history - for reference]",
      ja: "[最近の会話履歴 - 参考用]"
    },
    "assistant.historyTurnLine": {
      ko: "{{index}}. 질문: {{question}}\n   답변: {{answer}}",
      en: "{{index}}. Q: {{question}}\n   A: {{answer}}",
      ja: "{{index}}. 質問: {{question}}\n   回答: {{answer}}"
    },
    "assistant.oneOffHistoryHeader": {
      ko: "[방금 있었던 대화 - 참고용]",
      en: "[Conversation that just happened - for reference]",
      ja: "[たった今あった会話 - 参考用]"
    },
    "assistant.oneOffHistoryLine": {
      ko: "{{index}}. {{question}}\n   {{answer}}",
      en: "{{index}}. {{question}}\n   {{answer}}",
      ja: "{{index}}. {{question}}\n   {{answer}}"
    },
    "assistant.questionLabel": { ko: "질문", en: "Question", ja: "質問" },
    "assistant.episodeMemoryHeader": {
      ko: "[최근 며칠간의 기억 - 참고용]",
      en: "[Recent memory from previous days - for reference]",
      ja: "[ここ数日の思い出 - 参考用]"
    },
    "assistant.episodeMemoryLine": {
      ko: "{{date}}: {{summary}}",
      en: "{{date}}: {{summary}}",
      ja: "{{date}}: {{summary}}"
    },
    "assistant.relatedMemoryHeader": {
      ko: "[사용자에 대해 기억하고 있는 것 - 참고용]",
      en: "[What you remember about the user - for reference]",
      ja: "[ユーザーについて覚えていること - 参考用]"
    },
    "assistant.relatedMemoryLine": {
      ko: "{{mark}} {{label}}: {{value}}",
      en: "{{mark}} {{label}}: {{value}}",
      ja: "{{mark}} {{label}}: {{value}}"
    },
    "assistant.openLoopsHeader": {
      ko: "[아직 결말을 못 들은 이야기 - 자연스러울 때만 물어볼 것]",
      en: "[Unfinished topics - ask only when it fits naturally]",
      ja: "[まだ結末を聞いていない話 - 自然な時だけ尋ねること]"
    },
    "assistant.openLoopsLine": {
      ko: "• {{topic}} ({{when}})",
      en: "• {{topic}} ({{when}})",
      ja: "• {{topic}} ({{when}})"
    },
    "assistant.openLoopsToday": { ko: "오늘", en: "today", ja: "今日" },
    "assistant.openLoopsDaysAgo": { ko: "{{days}}일 전", en: "{{days}} days ago", ja: "{{days}}日前" },

    // ---- 펫이 먼저 말 걸기(petChat) ----
    "petChat.intro": {
      ko: "(지금은 사용자가 질문한 상황이 아니라, 당신이 먼저 사용자에게 말을 거는 상황입니다. 질문에 답하는 것처럼 굴지 말고, 대화를 먼저 여는 자연스러운 말투로 짧게 한마디 건네세요. 지금 몇 시인지, 시간대(아침/밤 등)를 언급하거나 그에 따른 잔소리·조언은 절대 하지 마세요.",
      en: "(This is not a situation where the user asked a question — you are speaking to the user first. Don't act like you're answering a question; say something short and natural to start a conversation. Never mention the current time or time of day (morning/night, etc.) or give related nagging/advice.",
      ja: "(今はユーザーが質問した状況ではなく、あなたが先にユーザーに話しかける状況です。質問に答えているように振る舞わず、会話を切り出す自然な口調で短く一言だけ伝えてください。今何時か、時間帯(朝・夜など)への言及や、それに基づく小言・アドバイスは絶対にしないでください。"
    },
    "petChat.hint.joke": {
      ko: "가벼운 농담이나 드립을 하나 던지며 말을 거세요.",
      en: "Start the conversation with a light joke or pun.",
      ja: "軽い冗談やダジャレを一つ言いながら話しかけてください。"
    },
    "petChat.hint.hobby": {
      ko: "당신(펫)이 좋아하거나 궁금해하는 취미·놀이거리 이야기를 하며 말을 거세요(예: 좋아하는 것, 하고 싶은 것).",
      en: "Start the conversation by talking about a hobby or activity you (the pet) like or are curious about (e.g. things you like, things you want to do).",
      ja: "あなた(ペット)が好きな、または気になる趣味・遊びの話をしながら話しかけてください(例: 好きなもの、やりたいこと)。"
    },
    "petChat.hint.checkIn": {
      ko: "사용자에게 오늘 하루가 어땠는지, 컨디션은 어떤지 가볍게 물어보며 말을 거세요.",
      en: "Start the conversation by lightly asking the user how their day was or how they're feeling.",
      ja: "ユーザーに今日一日どうだったか、体調はどうか、軽く尋ねながら話しかけてください。"
    },
    "petChat.hint.randomThought": {
      ko: "혼잣말처럼 문득 떠오른 엉뚱하거나 사소한 생각거리를 던지며 말을 거세요.",
      en: "Start the conversation with a random, minor thought that just occurred to you, like talking to yourself.",
      ja: "独り言のように、ふと思い浮かんだ突飛でささいな考えを口にしながら話しかけてください。"
    },
    "petChat.hint.smallStory": {
      ko: "가상의 소소한 사건(예: 방금 낮잠 잤다, 무언가 상상을 했다 등)을 지어내 이야기하며 말을 거세요.",
      en: "Start the conversation by making up a small imaginary event (e.g. you just took a nap, I imagined something, etc.).",
      ja: "架空のささいな出来事(例: さっき昼寝した、何かを想像した、など)を作って話しながら話しかけてください。"
    },
    "petChat.hint.encourage": {
      ko: "사용자를 칭찬하거나 응원하는 말을 자연스럽게 건네세요.",
      en: "Naturally offer the user a compliment or some encouragement.",
      ja: "ユーザーを褒めたり応援したりする言葉を自然にかけてください。"
    },
    "petChat.hint.thisOrThat": {
      ko: "가볍고 엉뚱한 둘 중 하나 고르기 질문을 던져 대화를 시작하세요.",
      en: "Start with a light, quirky this-or-that question.",
      ja: "軽くて少し変わった二択の質問から会話を始めてください。"
    },
    "petChat.hint.imagination": {
      ko: "짧은 상상 놀이를 제안하거나 가상의 장면을 함께 떠올리며 말을 거세요.",
      en: "Suggest a tiny imagination game or a fictional scene to picture together.",
      ja: "短い想像遊びを提案したり、架空の場面を一緒に思い浮かべたりして話しかけてください。"
    },
    "petChat.hint.discovery": {
      ko: "흥미로운 사소한 사실이나 관찰을 하나 꺼내고, 사용자의 생각을 물어보세요.",
      en: "Bring up one interesting small fact or observation and ask what the user thinks.",
      ja: "面白い小さな豆知識や観察を一つ出して、ユーザーの考えを聞いてください。"
    },
    "petChat.hint.miniGame": {
      ko: "말로 바로 할 수 있는 아주 짧은 미니 게임이나 장난스러운 도전을 제안하세요.",
      en: "Suggest a very short verbal mini-game or a playful challenge.",
      ja: "言葉だけですぐできる短いミニゲームや、遊び心のある挑戦を提案してください。"
    },
    "petChat.hint.recommendation": {
      ko: "기분 전환에 어울릴 만한 작은 선택지 하나를 제안하며 사용자의 취향을 물어보세요.",
      en: "Offer one small mood-lifting option and ask about the user's taste.",
      ja: "気分転換になりそうな小さな選択肢を一つ提案して、ユーザーの好みを聞いてください。"
    },
    "petChat.hint.curiosity": {
      ko: "펫이 문득 궁금해진 사소하고 구체적인 질문 하나를 솔직하게 물어보세요.",
      en: "Ask one small, specific question the pet has honestly become curious about.",
      ja: "ペットがふと気になった、ささやかで具体的な質問を素直に聞いてください。"
    },
    "petChat.varietyInstruction": {
      ko: "매번 대화의 소재뿐 아니라 시작 방식, 질문의 형태, 문장 리듬도 바꾸세요. 최근 문장과 같은 소재·예시·핵심 단어를 되풀이하지 말고, 정해진 힌트를 새롭고 구체적인 한마디로 풀어내세요.",
      en: "Vary not only the subject but also how you open, the kind of question you ask, and the rhythm of the sentence. Do not reuse the topic, examples, or key words from recent messages; turn the chosen hint into a fresh, specific opening.",
      ja: "話題だけでなく、切り出し方、質問の形、文のリズムも毎回変えてください。最近の文と同じ話題・例・重要語を繰り返さず、指定されたヒントを新鮮で具体的な一言にしてください。"
    },
    "petChat.recentOpenersNote": {
      ko: "(참고: 아래는 최근에 먼저 건넸던 말들입니다. 단순히 표현만 바꾸지 말고 소재·질문의 방향·가상의 상황까지 겹치지 않게 하세요.\n{{list}})",
      en: "(Note: below are recent conversation openers. Do not merely rephrase them; avoid overlapping subjects, question directions, and imagined situations too.\n{{list}})",
      ja: "(参考: 以下は最近先に話しかけた内容です。表現を変えるだけでなく、話題・質問の方向・想像上の状況まで重ならないようにしてください。\n{{list}})"
    },
    "petChat.pettedIntro": {
      ko: "(지금은 사용자가 질문한 상황이 아니라, 사용자가 방금 당신의 머리를 쓰다듬어줘서 당신이 그에 반응해 먼저 말을 거는 상황입니다. 질문에 답하는 것처럼 굴지 말고, 쓰다듬어줘서 기쁘거나 간지럽거나 하는 감정을 자연스럽고 짧은 한마디로 표현하세요. 지금 몇 시인지, 시간대(아침/밤 등)를 언급하거나 그에 따른 잔소리·조언은 절대 하지 마세요.",
      en: "(This is not a situation where the user asked a question — the user just petted your head, and you are reacting to that by speaking first. Don't act like you're answering a question; express in one short, natural line how it feels to be petted (happy, ticklish, etc.). Never mention the current time or time of day (morning/night, etc.) or give related nagging/advice.",
      ja: "(今はユーザーが質問した状況ではなく、ユーザーが今あなたの頭を撫でてくれたので、それに反応して先に話しかける状況です。質問に答えているように振る舞わず、撫でられて嬉しい・くすぐったいなどの気持ちを自然で短い一言で表現してください。今何時か、時間帯(朝・夜など)への言及や、それに基づく小言・アドバイスは絶対にしないでください。"
    },
    "petChat.hint.continueTopic": {
      ko: "위에 주어진 지난 대화 중 하나를 골라, 그 이야기의 구체적인 내용을 언급하며 그 뒤로 어떻게 됐는지 물어보세요. \"요즘 어때?\" 같은 두루뭉실한 말이 아니라, 실제로 나눈 내용을 짚어야 합니다.",
      en: "Pick one of the past conversations given above, mention something specific from it, and ask how it turned out since. Not a vague \"how have you been?\" — point to something actually discussed.",
      ja: "上に与えられた過去の会話から一つ選び、その具体的な内容に触れて、その後どうなったか尋ねてください。「最近どう?」のような曖昧な言い方ではなく、実際に話した内容を挙げてください。"
    },
    "petChat.hint.pastEpisode": {
      ko: "지난 대화에서 있었던 일을 문득 떠올린 것처럼 언급하며 말을 거세요. 그때 사용자가 했던 말이나 그때의 분위기를 구체적으로 짚으세요.",
      en: "Bring up something from an earlier conversation as if you just remembered it. Point specifically to what the user said then or how it felt.",
      ja: "以前の会話での出来事をふと思い出したように話しかけてください。そのときユーザーが言ったことや雰囲気を具体的に挙げてください。"
    },
    "petChat.hint.rememberedDetail": {
      ko: "위에 주어진 기억 중 하나(사용자의 취향·습관 등)를 구체적으로 언급하며, 그와 관련해 궁금한 것을 물어보세요.",
      en: "Mention one specific item from the memories given above (the user's tastes, habits, etc.) and ask something you're curious about around it.",
      ja: "上に与えられた記憶の一つ(ユーザーの好み・習慣など)を具体的に挙げて、それに関して気になることを尋ねてください。"
    },
    "petChat.hint.openLoopFollowUp": {
      ko: "위에 주어진 미완료 주제 중 하나를 골라, 그 뒤로 어떻게 됐는지 자연스럽게 물어보세요. 재촉하거나 잔소리하지 말고 궁금해하는 말투로 하세요.",
      en: "Pick one of the unfinished topics given above and naturally ask how it went. Sound curious, not nagging or pushy.",
      ja: "上に与えられた未完了の話題から一つ選び、その後どうなったか自然に尋ねてください。急かしたり小言を言ったりせず、気になっている口調で。"
    },
    "petChat.continuityInstruction": {
      ko: "시작 방식, 질문의 형태, 문장 리듬은 매번 바꾸세요. 이번에는 위에 주어진 기억과 지난 대화에서 소재를 가져오되, 최근에 이미 꺼낸 소재는 피하고 아직 다시 이야기하지 않은 것을 고르세요. 위에 없는 대화나 기억을 절대 지어내지 말고, 주어진 내용이 부족하면 그 범위 안에서만 짧게 말하세요.",
      en: "Vary how you open, the kind of question you ask, and the rhythm of the sentence every time. This time take your subject from the memories and past conversations given above, but avoid subjects you already brought up recently and pick one you haven't revisited. Never invent a conversation or memory that is not given above; if the given material is thin, keep it short and stay within it.",
      ja: "切り出し方、質問の形、文のリズムは毎回変えてください。今回は上に与えられた記憶と過去の会話から話題を取り、最近すでに持ち出した話題は避けて、まだ再び話していないものを選んでください。上にない会話や記憶を絶対に作らず、与えられた内容が乏しい場合はその範囲内で短く話してください。"
    },

    "documentSummary.textLabel": { ko: "요약할 문서", en: "Document to summarize", ja: "要約する文書" },
    "documentSummary.characterCount": { ko: "{{count}} / 1500자", en: "{{count}} / 1500 characters", ja: "{{count}} / 1500文字" },
    "documentSummary.extraRequestLabel": { ko: "추가 요청사항", en: "Extra request", ja: "追加の要望" },
    "documentSummary.extraRequestPlaceholder": { ko: "예: 핵심만 더 짧게, 할 일 위주로, 초보자용 설명 추가", en: "Example: make it shorter, focus on action items, explain for beginners", ja: "例: もっと短く、やること中心、初心者向けの説明を追加" },
    "documentSummary.runButton": { ko: "요약 문서 만들기", en: "Create Summary", ja: "要約文書を作成" },
    "documentSummary.runningStatus": { ko: "요약 중…", en: "Summarizing…", ja: "要約中…" },
    "documentSummary.completeTitle": { ko: "요약 문서를 만들었어요", en: "Summary document created", ja: "要約文書を作成しました" },
    "documentSummary.completeNote": { ko: "{{fileName}} 파일로 저장했습니다.", en: "Saved as {{fileName}}.", ja: "{{fileName}}として保存しました。" },
    "documentSummary.openButton": { ko: "문서 보기", en: "View Document", ja: "文書を見る" },
    "documentSummary.openedButton": { ko: "문서 열림", en: "Document Opened", ja: "文書を開きました" },
    "documentSummary.emptyTextError": { ko: "요약할 내용을 입력하세요.", en: "Enter content to summarize.", ja: "要約する内容を入力してください。" },
    "documentSummary.textTooLongError": { ko: "문서는 최대 1500자까지 요약할 수 있습니다.", en: "Documents can be summarized up to 1500 characters.", ja: "文書は最大1500文字まで要約できます。" },
    "documentSummary.emptyResultError": { ko: "요약 결과가 비어 있습니다.", en: "The summary result is empty.", ja: "要約結果が空です。" },
    "documentSummary.failedError": { ko: "문서 요약에 실패했습니다.", en: "Couldn't summarize the document.", ja: "文書の要約に失敗しました。" },
    "documentSummary.closedError": { ko: "문서 요약창이 닫혀 있습니다.", en: "The document summary panel is closed.", ja: "文書要約画面が閉じています。" },
    "documentSummary.prompt": { ko: "아래 문서를 간결하고 보기 좋은 한국어 마크다운 문서로 요약하세요. 문서 성격을 판단하세요: 공지/안내문, 회의록/대화 기록, 공부 노트/설명문, 작업 목록/체크리스트, 코드/기술 문서, 시계열/타임라인, 비교/대조, 프로세스/흐름, 일반 글. 출력 구성: ① '# 제목' ② 1~2문장 짧은 요약 ③ 문서 유형별 최적 2~4개 섹션 + 불릿 + 선택적 시각 표현. 시각 표현 가이드: 타임라인이면 연도/날짜별 사건을 마크다운 표로 정리하세요. 비교 주제면 비교 마크다운 표를 사용하세요. 3단계 이상의 순차적 프로세스나 흐름(예: 신청→입장→체험)이 있으면 절대 불릿이나 짧은 문단으로 나열하지 말고, 반드시 ```mermaid 코드 블록 안에 flowchart TD 문법으로 그리세요. 예시(실제로는 필요한 단계 수만큼 노드와 화살표를 늘리세요): ```mermaid\\nflowchart TD\\n    A[신청] --> B[입장]\\n    B --> C[체험]\\n```. mermaid 코드 블록은 반드시 ```mermaid로 시작해서 ```로 닫고, 그 안에는 mermaid 문법만 쓰세요(다른 마크다운 서식을 섞지 마세요). `<svg>`나 그 밖의 HTML 태그는 절대 출력하지 마세요 — 렌더링 전에 제거되어 화면에 나타나지 않습니다. 핵심/주의사항은 `> **주의:** 내용` 형식 인용으로 강조하세요. 원문에 없는 사실은 만들지 마세요. 장식 이모지는 소제목에만, HTML/CSS 태그나 코드블록(위 mermaid 블록 제외)이나 인사말은 출력 금지.", en: "Summarize the document below as concise, readable Korean Markdown. Detect document type: notice/instructions, meeting notes, study notes/explainer, task list/checklist, technical document, timeline/chronology, comparison, process/workflow, or general. Output structure: ① '# Title' ② 1-2 sentence overview ③ Type-optimal 2-4 sections with bullets + optional visuals. Visual guidance: For timelines, organize events in a markdown table by date. For comparisons, use a markdown comparison table. If there's a sequential process or flow with 3+ steps (e.g. apply→enter→experience), never list it as bullets or short paragraphs — draw it inside a ```mermaid code block using flowchart TD syntax. Example (add as many nodes/arrows as the actual steps need): ```mermaid\\nflowchart TD\\n    A[Apply] --> B[Enter]\\n    B --> C[Experience]\\n```. A mermaid block must start with ```mermaid and close with ```, and contain only mermaid syntax inside (don't mix in other markdown). Never output raw `<svg>` or any other HTML tags — they're stripped before rendering and won't appear. Highlight important/caution points as `> **Caution:** content` quotes. Don't invent facts not in the source. Decorative emoji only in subtitles; no HTML/CSS tags, code blocks (other than the mermaid block above), or greetings.", ja: "以下の文書を簡潔で読みやすい韓国語Markdown文書として要約してください。文書タイプを判定してください: お知らせ/案内文、議事録、学習ノート/解説、作業リスト/チェックリスト、技術文書、年表/時系列、比較、プロセス/ワークフロー、一般文。出力構成: ① 「# タイトル」② 1~2文の要約段落 ③ タイプ別最適な2~4セクション+箇条書き+選択的ビジュアル。ビジュアルガイド: 年表なら日付別イベントをMarkdown表で整理してください。比較主題なら比較Markdown表を使ってください。3段階以上の順序立ったプロセスや流れ(例: 申込→入場→体験)がある場合、箇条書きや短い段落で羅列せず、必ず```mermaidコードブロック内にflowchart TD構文で描いてください。例(実際に必要な段階数だけノードと矢印を増やしてください): ```mermaid\\nflowchart TD\\n    A[申込] --> B[入場]\\n    B --> C[体験]\\n```。mermaidブロックは必ず```mermaidで始めて```で閉じ、中にはmermaid構文だけを書いてください(他のMarkdown書式を混ぜないでください)。`<svg>`やその他のHTMLタグは絶対に出力しないでください — レンダリング前に除去され画面に表示されません。重要/注意点は`> **注意:** 内容`引用で強調してください。原文にない事実は作らないでください。装飾絵文字は小見出しのみ、HTML/CSSタグやコードブロック(上記mermaidブロックを除く)、挨拶は出力禁止。" },
    "settings.shortcuts.documentSummaryHeading": { ko: "AI 문서 요약", en: "AI Document Summary", ja: "AI文書要約" },
    "settings.shortcuts.documentSummaryThemeLabel": { ko: "문서 색상", en: "Document colors", ja: "文書の色" },
    "settings.shortcuts.documentSummaryThemeApp": { ko: "프로그램 테마 색", en: "App theme colors", ja: "アプリテーマ色" },
    "settings.shortcuts.documentSummaryThemeLight": { ko: "라이트 모드", en: "Light mode", ja: "ライトモード" },
    "settings.shortcuts.documentSummaryThemeDark": { ko: "다크 모드", en: "Dark mode", ja: "ダークモード" },
    "settings.shortcuts.documentSummaryNote": { ko: "클립보드 내용을 최대 1500자까지 가져와 편집한 뒤 AI로 요약합니다. 문서 성격에 맞춰 구성을 고르고, 결과는 프로그램 폴더 옆 ‘문서 요약’ 폴더에 HTML로 저장됩니다.", en: "Takes up to 1500 clipboard characters for editing, then summarizes them with AI. It adapts the structure to the document type and saves the result as HTML in a Document Summary folder beside the app.", ja: "クリップボードから最大1500文字を取り込み、編集してからAIで要約します。文書の種類に合わせて構成を選び、結果はアプリのそばの「文書要約」フォルダにHTMLとして保存されます。" },

    // ---- 클립보드 번역 프롬프트 ----
    "translate.promptInstruction": {
      ko: "다음 텍스트를 {{languageName}}로 번역하세요.",
      en: "Translate the following text into {{languageName}}.",
      ja: "次のテキストを{{languageName}}に翻訳してください。"
    },
    "translate.promptNoExtra": {
      ko: "번역문만 출력하세요. 설명, 원문 재기재, 따옴표, 코드블록, 머리말을 붙이지 마세요.",
      en: "Output only the translation. Don't add explanations, re-quote the original, add quotation marks, code blocks, or headers.",
      ja: "翻訳文のみを出力してください。説明、原文の再掲、引用符、コードブロック、見出しは付けないでください。"
    },
    "translate.promptKeepStructure": {
      ko: "줄바꿈과 문단 구분은 원문 구조를 그대로 유지하세요.",
      en: "Keep the original line breaks and paragraph structure.",
      ja: "改行と段落分けは原文の構造をそのまま維持してください。"
    },
    "translate.textLabel": { ko: "번역할 텍스트", en: "Text to translate", ja: "翻訳するテキスト" },
    "translate.targetLanguageLabel": { ko: "번역할 언어", en: "Translate to", ja: "翻訳する言語" },
    "translate.runButton": { ko: "번역 실행", en: "Translate", ja: "翻訳実行" },
    "translate.translatingStatus": { ko: "번역 중…", en: "Translating…", ja: "翻訳中…" },
    "translate.resultLabel": { ko: "{{languageLabel}} 번역 결과", en: "{{languageLabel}} translation result", ja: "{{languageLabel}} 翻訳結果" },
    "common.copy": { ko: "복사", en: "Copy", ja: "コピー" },
    "common.copied": { ko: "복사됨 ✓", en: "Copied ✓", ja: "コピー済み ✓" },
    "imageResize.scaleLabel": { ko: "배율", en: "Scale", ja: "倍率" },
    "imageResize.filterLabel": { ko: "필터", en: "Filter", ja: "フィルター" },
    "imageResize.filterNearest": { ko: "최단입점", en: "Nearest neighbor", ja: "最近傍補間" },
    "imageResize.filterBilinear": { ko: "쌍선형", en: "Bilinear", ja: "バイリニア" },
    "imageResize.runButton": { ko: "리사이징 실행", en: "Resize", ja: "リサイズ実行" },
    "imageResize.scaleOption": { ko: "{{value}}배", en: "{{value}}x", ja: "{{value}}倍" },
    "translate.toKorean": { ko: "한국어로 번역", en: "Translate to Korean", ja: "韓国語に翻訳" },
    "translate.toEnglish": { ko: "영어로 번역", en: "Translate to English", ja: "英語に翻訳" },
    "translate.toJapanese": { ko: "일본어로 번역", en: "Translate to Japanese", ja: "日本語に翻訳" },
    "translate.toChineseSimplified": { ko: "중국어(간체)로 번역", en: "Translate to Chinese (Simplified)", ja: "中国語(簡体字)に翻訳" },
    "translate.toSpanish": { ko: "스페인어로 번역", en: "Translate to Spanish", ja: "スペイン語に翻訳" },
    "translate.toFrench": { ko: "프랑스어로 번역", en: "Translate to French", ja: "フランス語に翻訳" },
    "translate.toGerman": { ko: "독일어로 번역", en: "Translate to German", ja: "ドイツ語に翻訳" },
    "common.processingStatus": { ko: "처리 중...", en: "Processing...", ja: "処理中..." },
    "translate.promptKeepAlreadyTranslated": {
      ko: "이미 대상 언어로 쓰인 부분은 자연스럽게 다듬어 그대로 두세요.",
      en: "If parts are already in the target language, just polish them naturally and keep them as-is.",
      ja: "すでに対象言語で書かれている部分は自然に整えてそのまま残してください。"
    }
  };

  /**
   * @param {string} lang
   * @param {string} key
   * @param {Record<string, unknown>} [vars]
   */
  function t(lang, key, vars) {
    const entry = STRINGS[key];
    if (!entry) return key;
    const normalized = normalizeLanguage(lang);
    let text = entry[normalized] || entry.en || entry.ko || key;
    if (vars) {
      for (const varKey of Object.keys(vars)) {
        text = text.split(`{{${varKey}}}`).join(String(vars[varKey]));
      }
    }
    return text;
  }

  // HTML의 [data-i18n]/[data-i18n-placeholder]/[data-i18n-title]/[data-i18n-aria-label] 속성을
  // 읽어 텍스트를 채워 넣는다(체크리스트/기록/설정 창 등 정적 HTML 화면 공용).
  // getAttribute()는 타입상 null이 될 수 있지만 셀렉터가 그 속성으로 고른 요소들이라
  // 실제로는 항상 값이 있다. 그래도 t()에 null이 흘러가지 않게 빈 문자열로 받는다.
  /**
   * @param {ParentNode | null | undefined} root
   * @param {string} lang
   */
  function applyDomTranslations(root, lang) {
    const scope = root || document;
    scope.querySelectorAll("[data-i18n]").forEach((element) => {
      element.textContent = t(lang, element.getAttribute("data-i18n") ?? "");
    });
    scope.querySelectorAll("[data-i18n-html]").forEach((element) => {
      element.innerHTML = t(lang, element.getAttribute("data-i18n-html") ?? "");
    });
    scope.querySelectorAll("[data-i18n-placeholder]").forEach((element) => {
      /** @type {HTMLInputElement | HTMLTextAreaElement} */ (element).placeholder =
        t(lang, element.getAttribute("data-i18n-placeholder") ?? "");
    });
    scope.querySelectorAll("[data-i18n-title]").forEach((element) => {
      /** @type {HTMLElement} */ (element).title = t(lang, element.getAttribute("data-i18n-title") ?? "");
    });
    scope.querySelectorAll("[data-i18n-aria-label]").forEach((element) => {
      element.setAttribute("aria-label", t(lang, element.getAttribute("data-i18n-aria-label") ?? ""));
    });
    scope.querySelectorAll("[data-i18n-label]").forEach((element) => {
      /** @type {HTMLOptionElement} */ (element).label = t(lang, element.getAttribute("data-i18n-label") ?? "");
    });
    // 번호가 붙은 <option>(사운드 1/2/3, 0.5배/2배 등)처럼 value를 그대로 치환값으로 쓰는 경우.
    // 템플릿의 변수 이름이 {{n}}이든 {{value}}이든 다 맞도록 둘 다 넣어준다.
    scope.querySelectorAll("[data-i18n-numbered]").forEach((element) => {
      const option = /** @type {HTMLOptionElement} */ (element);
      const value = option.getAttribute("value") ?? option.value;
      option.textContent = t(lang, option.getAttribute("data-i18n-numbered") ?? "", { n: value, value });
    });
    if (scope === document) {
      const titleKey = document.documentElement.getAttribute("data-i18n-doc-title");
      if (titleKey) document.title = t(lang, titleKey);
    }
  }

  return { SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE, normalizeLanguage, detectDefaultLanguage, t, STRINGS, applyDomTranslations };
});

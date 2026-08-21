// 설정창 "패치 노트" 탭의 내용(2026-08-20 신설).
//
// 버전별 항목을 최신이 맨 위인 순서로 적는다. 사용자에게 보이는 문구라 세 언어를 모두 채우고,
// 개발 이력(docs/CHANGELOG.md)과는 역할이 다르다 — 여기에는 "사용자가 체감하는 변화"만 짧게
// 쓰고, 원인·구현·검증은 CHANGELOG에 남긴다.
type PatchNoteLanguage = "ko" | "en" | "ja";
type PatchNote = { version: string; lines: Record<PatchNoteLanguage, string[]> };

const PATCH_NOTES: PatchNote[] = [
  {
    version: "1.3",
    lines: {
      ko: [
        "이제 \"그건 잊어줘\"라고 말하면 펫이 그 기억을 실제로 지웁니다. 잘못 지웠으면 기억 관리 탭에서 되살릴 수 있습니다.",
        "펫이 오래전 이야기를 계속 되묻지 않습니다. 3일이 지난 이야기는 먼저 꺼내지 않고, 사용자가 그 이야기를 다시 하면 기억해 냅니다.",
        "날씨 지역에 \"부산\", \"대구\" 같은 광역시 이름을 넣으면 엉뚱한 동명 지역의 날씨가 나오던 문제를 수정했습니다.",
        "설정창에 검색 상자가 생겼습니다. 항목 이름을 넣으면 어느 탭에 있는지 찾아 줍니다.",
        "버튼을 누르면 젤리처럼 출렁입니다."
      ],
      en: [
        "Saying something like \"forget that\" now actually removes the memory. If it removes the wrong one, you can restore it from the Memory tab.",
        "The pet no longer keeps asking about old topics. It won't bring up anything older than three days on its own, but it still remembers if you mention it again.",
        "Fixed weather for Korean metro city names (Busan, Daegu, and others) resolving to unrelated places with the same name.",
        "The settings window now has a search box that tells you which tab a setting lives in.",
        "Buttons wobble like jelly when clicked."
      ],
      ja: [
        "「それは忘れて」と伝えると、ペットがその記憶を実際に削除します。誤って消された場合は記憶管理タブから復元できます。",
        "ペットが昔の話を何度も聞き返さなくなりました。3日を過ぎた話題は自分から持ち出しませんが、もう一度話せばちゃんと覚えています。",
        "天気の地域に「釜山」「大邱」などの広域市名を入れると、同名の別地域の天気が出る問題を修正しました。",
        "設定ウィンドウに検索ボックスを追加しました。項目名を入れると、どのタブにあるか教えてくれます。",
        "ボタンを押すとゼリーのように揺れます。"
      ]
    }
  },
  {
    version: "1.2",
    lines: {
      ko: [
        "이제 커스텀 얼굴, 커스텀 몸 패턴은 각각 독립된 파일을 사용합니다. (프리셋 내보내기 기능에도 작동합니다.)",
        "영어, 일본어 환경에서 펫과의 대화에서 한국어로 말을 하는 현상을 수정했습니다.",
        "외곽선 색상 옵션은 이제 커스터마이징에서 조절 가능",
        "UI 개선",
        "즐겨찾기 아이콘 및 색상 선택 UI가 잘리던 현상 수정"
      ],
      en: [
        "Custom face and custom body patterns now use their own separate files for each preset (this also applies when you export a preset).",
        "Fixed the pet replying in Korean on English and Japanese systems.",
        "The outline color option can now be adjusted in Customization.",
        "UI improvements",
        "Fixed the favorites icon and color picker being cut off"
      ],
      ja: [
        "カスタム顔・カスタムボディの模様が、プリセットごとに独立したファイルを使うようになりました。(プリセットの書き出しにも反映されます。)",
        "英語・日本語環境で、ペットとの会話が韓国語になる問題を修正しました。",
        "輪郭線の色オプションは、カスタマイズで調整できるようになりました。",
        "UIの改善",
        "お気に入りのアイコン・色選択UIが切れて選べない問題を修正"
      ]
    }
  }
];

export { PATCH_NOTES };
export type { PatchNote, PatchNoteLanguage };

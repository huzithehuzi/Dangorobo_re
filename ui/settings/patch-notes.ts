// 설정창 "패치 노트" 탭의 내용(2026-08-20 신설).
//
// 버전별 항목을 최신이 맨 위인 순서로 적는다. 사용자에게 보이는 문구라 세 언어를 모두 채우고,
// 개발 이력(docs/CHANGELOG.md)과는 역할이 다르다 — 여기에는 "사용자가 체감하는 변화"만 짧게
// 쓰고, 원인·구현·검증은 CHANGELOG에 남긴다.
type PatchNoteLanguage = "ko" | "en" | "ja";
type PatchNote = { version: string; lines: Record<PatchNoteLanguage, string[]> };

const PATCH_NOTES: PatchNote[] = [
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

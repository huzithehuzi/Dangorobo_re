// 대화 그룹 탭: 대화 / 기억 관리 (2026-08-10, 바닐라 settings.js 포팅).
import { useCallback, useEffect, useState } from "react";
import { useSettings } from "./App";
import { NumberRow, Note, SelectRow, TextField, ToggleRow } from "./rows";
import { TALK_SOUND_OPTIONS } from "./store";

export function ConversationTab() {
  const s = useSettings();
  const { d, set, tt } = s;
  // API 키가 없으면(또는 삭제 예약이면) 질문 기능을 켤 수 없다 — 일반 탭과 같은 판정.
  const keyWillExist = !d.assistantClearApiKey && (s.storedAssistantKey || d.assistantApiKey.trim().length > 0);

  return (
    <>
      <div className="settings-group">
        <h2>{tt("settings.conversation.heading")}</h2>
        <ToggleRow
          checked={d.assistantEnabled && keyWillExist}
          disabled={!keyWillExist}
          onChange={(checked) => set("assistantEnabled", checked)}
          label={tt("settings.conversation.enableToggle")}
        />
        <Note>{tt("settings.conversation.apiKeyNote")}</Note>
        <SelectRow
          label={tt("settings.conversation.personalityLabel")}
          value={d.assistantPersonality}
          onChange={(value) => set("assistantPersonality", value)}
          options={["friend", "polite", "concise", "playful", "custom"].map((value) => ({
            value,
            label: tt(`assistant.personalityShort.${value}`)
          }))}
        />
        <label className="text-field">
          <span>{tt("settings.conversation.customPersonalityLabel")}</span>
          <input
            type="text"
            maxLength={300}
            autoComplete="off"
            placeholder={tt("settings.conversation.customPersonalityPlaceholder")}
            value={d.assistantCustomPersonality}
            disabled={d.assistantPersonality !== "custom"}
            onChange={(event) => set("assistantCustomPersonality", event.target.value)}
          />
        </label>
        <Note>{tt("settings.conversation.customPersonalityNote")}</Note>
        {/* AI 모델 필드는 일반 탭 API 키 그룹에 있다(바닐라의 relocateAssistantModelField와 동일 배치) */}
        <TextField
          label={tt("settings.conversation.userNicknameLabel")}
          value={d.assistantUserNickname}
          maxLength={40}
          placeholder={tt("settings.conversation.userNicknamePlaceholder")}
          onChange={(value) => set("assistantUserNickname", value)}
        />
        <TextField
          label={tt("settings.conversation.petNicknameLabel")}
          value={d.assistantPetNickname}
          maxLength={40}
          placeholder={tt("settings.conversation.petNicknamePlaceholder")}
          onChange={(value) => set("assistantPetNickname", value)}
        />
        <ToggleRow checked={d.assistantMemoryEnabled} onChange={(checked) => set("assistantMemoryEnabled", checked)} label={tt("settings.conversation.memoryToggle")} />
        <NumberRow
          label={tt("settings.conversation.memoryTurnsLabel")}
          value={d.assistantMemoryTurns}
          onChange={(value) => set("assistantMemoryTurns", value)}
          min={1}
          max={20}
          step={1}
          unit={tt("settings.conversation.turnsUnit")}
          disabled={!d.assistantMemoryEnabled}
        />
        <Note>{tt("settings.conversation.memoryNote")}</Note>
        <ToggleRow checked={d.memoryTabVisible} onChange={(checked) => set("memoryTabVisible", checked)} label={tt("settings.conversation.memoryTabToggle")} />
        <Note>{tt("settings.conversation.memoryTabToggleNote")}</Note>
      </div>
      <div className="settings-group">
        <h2>{tt("settings.conversation.petChatHeading")}</h2>
        <ToggleRow checked={d.petChatEnabled} onChange={(checked) => set("petChatEnabled", checked)} label={tt("settings.conversation.petChatToggle")} />
        <NumberRow label={tt("settings.conversation.petChatMinLabel")} value={d.petChatMinMinutes} onChange={(value) => set("petChatMinMinutes", value)} min={1} max={720} unit={tt("settings.appearance.minutesUnit")} />
        <NumberRow label={tt("settings.conversation.petChatMaxLabel")} value={d.petChatMaxMinutes} onChange={(value) => set("petChatMaxMinutes", value)} min={1} max={720} unit={tt("settings.appearance.minutesUnit")} />
        <Note>{tt("settings.conversation.petChatNote")}</Note>
        <ToggleRow checked={d.pettingChatEnabled} onChange={(checked) => set("pettingChatEnabled", checked)} label={tt("settings.conversation.pettingChatToggle")} />
        <Note>{tt("settings.conversation.pettingChatNote")}</Note>
      </div>
      <div className="settings-group">
        <h2>{tt("settings.conversation.animaleseHeading")}</h2>
        <ToggleRow checked={d.animaleseEnabled} onChange={(checked) => set("animaleseEnabled", checked)} label={tt("settings.conversation.animaleseToggle")} />
        <NumberRow label={tt("settings.conversation.animaleseIntervalLabel")} value={d.animaleseIntervalMs} onChange={(value) => set("animaleseIntervalMs", value)} min={20} max={150} step={5} unit="ms" disabled={!d.animaleseEnabled} />
        <label className="setting-row">
          <span>{tt("settings.conversation.animalesePitchLabel")}</span>
          <span className="input-wrap">
            <span>±</span>
            <input type="number" required min={0} max={30} step={1} value={d.animalesePitchPercent} disabled={!d.animaleseEnabled} onChange={(event) => set("animalesePitchPercent", event.target.value)} />
            <span>%</span>
          </span>
        </label>
        <SelectRow
          label={tt("settings.conversation.animaleseSoundLabel")}
          value={d.animaleseSoundStyle}
          disabled={!d.animaleseEnabled}
          onChange={(value) => set("animaleseSoundStyle", value)}
          options={TALK_SOUND_OPTIONS.map((n) => ({ value: String(n), label: tt("settings.alerts.soundOption", { n, value: n }) }))}
        />
        <ToggleRow checked={d.animalesePetChatEnabled} disabled={!d.animaleseEnabled} onChange={(checked) => set("animalesePetChatEnabled", checked)} label={tt("settings.conversation.animalesePetChatToggle")} />
      </div>
    </>
  );
}

const MEMORY_CATEGORIES = ["preference", "habit", "fact", "relationship", "goal"];

export function MemoryTab({ active }: { active: boolean }) {
  const s = useSettings();
  const { tt } = s;
  const [stats, setStats] = useState({ memoryCount: 0, loopsCount: 0, episodesCount: 0 });
  const [category, setCategory] = useState("");
  const [memories, setMemories] = useState<MemoryRow[]>([]);
  const [loops, setLoops] = useState<OpenLoopRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const categoryLabel = (value: string | undefined) => {
    const key = String(value || "");
    return MEMORY_CATEGORIES.includes(key) ? tt(`settings.memory.category.${key}`) : key;
  };

  const loadStats = useCallback(async () => {
    try {
      const next = await window.desktopPet.getMemoryStats();
      setStats({
        memoryCount: next.memoryCount || 0,
        loopsCount: next.loopsCount || 0,
        episodesCount: next.episodesCount || 0
      });
    } catch (error) {
      console.error("[Settings] Load memory stats failed:", error);
    }
  }, []);

  const loadMemories = useCallback(async (filterCategory: string) => {
    try {
      setLoadError(null);
      setMemories((await window.desktopPet.getMemories(filterCategory)) || []);
    } catch (error) {
      console.error("[Settings] Load memories failed:", error);
      setLoadError(tt("settings.memory.loadFailed", { message: (error as Error).message }));
    }
  }, [tt]);

  const loadLoops = useCallback(async () => {
    try {
      setLoops((await window.desktopPet.getOpenLoops()) || []);
    } catch (error) {
      console.error("[Settings] Load open loops failed:", error);
    }
  }, []);

  // 최초 로드·설정 재로드(가져오기)·탭 진입 시 새로 읽는다.
  useEffect(() => {
    loadStats();
    loadMemories(category);
    loadLoops();
    // category는 자체 change 핸들러가 다시 읽으므로 여기 의존성에 넣지 않는다.
  }, [s.refreshMemoryTick, active, loadStats, loadLoops]);

  return (
    <>
      <div className="settings-group">
        <h2>{tt("settings.memory.heading")}</h2>
        <Note>{tt("settings.memory.description")}</Note>
        <div className="memory-stats">
          <div className="stat-item"><span className="stat-value">{stats.memoryCount}</span><span className="stat-label">{tt("settings.memory.totalMemories")}</span></div>
          <div className="stat-item"><span className="stat-value">{stats.loopsCount}</span><span className="stat-label">{tt("settings.memory.openLoops")}</span></div>
          <div className="stat-item"><span className="stat-value">{stats.episodesCount}</span><span className="stat-label">{tt("settings.memory.episodes")}</span></div>
        </div>
      </div>
      <div className="settings-group">
        <h3>{tt("settings.memory.longTermHeading")}</h3>
        <label className="setting-row">
          <span>{tt("settings.memory.filterLabel")}</span>
          <span className="input-wrap">
            <select
              value={category}
              onChange={(event) => {
                setCategory(event.target.value);
                loadMemories(event.target.value);
              }}
            >
              <option value="">{tt("settings.memory.category.all")}</option>
              {MEMORY_CATEGORIES.map((value) => (
                <option key={value} value={value}>{tt(`settings.memory.category.${value}`)}</option>
              ))}
            </select>
          </span>
        </label>
        <div className="memory-list" aria-live="polite">
          {loadError && <p className="memory-error">{loadError}</p>}
          {!loadError && memories.length === 0 && <p className="memory-empty">{tt("settings.memory.noMemories")}</p>}
          {memories.map((memory) => {
            const importancePercent = Math.max(0, Math.min(100, Math.round((memory.importance || 0) * 100)));
            return (
              <div key={memory.id} className="memory-item" data-category={String(memory.category || "")}>
                <div className="memory-header">
                  <span className="memory-label">{memory.memory_label}</span>
                  <span className="memory-category">{categoryLabel(memory.category)}</span>
                  {memory.is_verified ? (
                    <button
                      className="memory-chip-button memory-verified"
                      type="button"
                      onClick={async () => {
                        await window.desktopPet.unverifyMemory(memory.id);
                        loadMemories(category);
                      }}
                    >
                      {tt("settings.memory.verifiedBadge")}
                    </button>
                  ) : (
                    <button
                      className="memory-chip-button"
                      type="button"
                      onClick={async () => {
                        await window.desktopPet.verifyMemory(memory.id);
                        loadMemories(category);
                      }}
                    >
                      {tt("settings.memory.verifyButton")}
                    </button>
                  )}
                </div>
                <div className="memory-value">{memory.memory_value}</div>
                <div className="memory-meta">
                  <span className="memory-importance" title={`${tt("settings.memory.importanceLabel")} ${importancePercent}%`}>
                    <span className="memory-importance-track"><span className="memory-importance-fill" style={{ width: `${importancePercent}%` }} /></span>
                    <span>{importancePercent}%</span>
                  </span>
                  <span className="memory-mention">{tt("settings.memory.mentionCount", { n: memory.mention_count ?? 0 })}</span>
                  <button
                    className="memory-chip-button danger"
                    type="button"
                    onClick={async () => {
                      if (!window.confirm(tt("settings.memory.confirmDelete"))) return;
                      await window.desktopPet.deleteMemory(memory.id);
                      loadMemories(category);
                      loadStats();
                    }}
                  >
                    {tt("settings.memory.deleteButton")}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <div className="button-row">
          <button
            className="secondary-action"
            type="button"
            onClick={async () => {
              try {
                const all = await window.desktopPet.getMemories("");
                const blob = new Blob([JSON.stringify(all, null, 2)], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const anchor = document.createElement("a");
                anchor.href = url;
                anchor.download = `memories-${new Date().toISOString().split("T")[0]}.json`;
                anchor.click();
                URL.revokeObjectURL(url);
              } catch (error) {
                alert(tt("settings.memory.exportFailed", { message: (error as Error).message }));
              }
            }}
          >
            {tt("settings.memory.exportButton")}
          </button>
          <button
            className="secondary-action"
            type="button"
            onClick={() => {
              const input = document.createElement("input");
              input.type = "file";
              input.accept = "application/json";
              input.onchange = async () => {
                const file = input.files?.[0];
                if (!file) return;
                try {
                  const parsed = JSON.parse(await file.text());
                  const imported = await window.desktopPet.importMemories(Array.isArray(parsed) ? parsed : []);
                  loadMemories(category);
                  loadStats();
                  alert(tt("settings.memory.importedAlert", { n: imported }));
                } catch (error) {
                  alert(tt("settings.memory.importFailed", { message: (error as Error).message }));
                }
              };
              input.click();
            }}
          >
            {tt("settings.memory.importButton")}
          </button>
          <button
            className="secondary-action danger"
            type="button"
            onClick={async () => {
              if (!window.confirm(tt("settings.memory.confirmClear"))) return;
              try {
                const archived = await window.desktopPet.clearAllMemories();
                if (archived !== true) {
                  alert(tt("settings.memory.clearRejected"));
                  return;
                }
                await Promise.all([loadMemories(category), loadStats()]);
                alert(tt("settings.memory.clearedAlert"));
              } catch (error) {
                alert(tt("settings.memory.clearFailed", { message: (error as Error).message }));
              }
            }}
          >
            {tt("settings.memory.clearButton")}
          </button>
        </div>
      </div>
      <div className="settings-group">
        <h3>{tt("settings.memory.openLoopsHeading")}</h3>
        <div className="loops-list" aria-live="polite">
          {loops.length === 0 && <p className="memory-empty">{tt("settings.memory.noOpenLoops")}</p>}
          {loops.map((loop) => {
            const daysSinceMention = Math.floor((Date.now() - new Date(loop.last_mentioned_at || 0).getTime()) / (24 * 60 * 60 * 1000));
            const daysText = daysSinceMention > 0
              ? tt("settings.memory.loopDaysAgo", { n: daysSinceMention })
              : tt("settings.memory.loopToday");
            return (
              <div key={loop.id} className="loop-item">
                <div className="loop-topic">{loop.topic}</div>
                <div className="loop-meta">
                  <span className="loop-mention">{daysText}</span>
                  <button
                    className="memory-chip-button"
                    type="button"
                    onClick={async () => {
                      if (!window.confirm(tt("settings.memory.confirmCloseLoop"))) return;
                      await window.desktopPet.closeOpenLoop(loop.id, tt("settings.memory.loopCloseReason"));
                      loadLoops();
                      loadStats();
                    }}
                  >
                    {tt("settings.memory.loopCloseButton")}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <Note>{tt("settings.memory.note")}</Note>
    </>
  );
}

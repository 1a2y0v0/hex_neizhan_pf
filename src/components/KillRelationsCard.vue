<script setup lang="ts">
import { computed, ref } from "vue"
import { ChevronDown, ChevronRight } from "lucide-vue-next"
import type { ChampionSummaryItem, KillRelationEntry } from "../types"
import ChampionAvatar from "./ChampionAvatar.vue"

/**
 * 击杀关系卡（谁杀了谁）：每名玩家一行，行内列出本局击杀/助攻过的受害者。
 * 深色弹层 / 浅色详情页 / 展开对局等多处复用，通过 theme 切换配色；
 * collapsible 时标题可点击折叠/展开。
 */
interface KillRowPlayer {
  puuid: string
  gameName: string
  championId: number
  killRelations?: KillRelationEntry[]
}

const props = withDefaults(
  defineProps<{
    players: KillRowPlayer[]
    champions: Record<number, ChampionSummaryItem>
    theme?: "dark" | "light"
    title?: string
    /** 标题可点击折叠/展开 */
    collapsible?: boolean
    /** 初始是否折叠（仅 collapsible 生效；默认展开） */
    collapsedByDefault?: boolean
  }>(),
  {
    theme: "dark",
    title: "击杀关系（谁杀了谁）",
    collapsible: false,
    collapsedByDefault: false,
  },
)

const open = ref(!props.collapsedByDefault)
function toggle() {
  if (props.collapsible) open.value = !open.value
}

const victimNames = computed(() => {
  const map = new Map<string, string>()
  for (const p of props.players) map.set(p.puuid, p.gameName)
  return map
})
function victimName(puuid: string) {
  return victimNames.value.get(puuid) || puuid
}
</script>

<template>
  <section class="krc" :class="theme === 'light' ? 'krc-light' : 'krc-dark'">
    <div class="krc-head" :class="{ clickable: collapsible }" @click="toggle">
      <component :is="open ? ChevronDown : ChevronRight" v-if="collapsible" :size="14" class="krc-chev" />
      <span class="krc-title">{{ title }}</span>
      <span v-if="collapsible" class="krc-count">{{ open ? "收起" : "展开" }}</span>
    </div>
    <div v-show="open" class="krc-list">
      <div v-for="p in players" :key="p.puuid" class="krc-row">
        <ChampionAvatar :champion-id="p.championId" :champions="champions" :size="20" />
        <span class="krc-name">{{ p.gameName }}</span>
        <div class="krc-chips">
          <span
            v-for="kr in p.killRelations || []"
            :key="kr.victimPuuid"
            class="krc-chip"
            :title="`${victimName(kr.victimPuuid)} · 击杀 ${kr.kills} 次${kr.assists ? ` · 助攻 ${kr.assists} 次` : ''}`"
          >
            {{ victimName(kr.victimPuuid) }} ×{{ kr.kills }}<em v-if="kr.assists">+{{ kr.assists }}助</em>
          </span>
          <span v-if="!(p.killRelations || []).length" class="krc-none">本局无击杀</span>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.krc {
  border: 1px solid var(--krc-border, #444);
  border-radius: 10px;
  background: var(--krc-bg, #12121a);
  padding: 12px;
}
.krc-title {
  font-size: 13px;
  font-weight: 800;
  color: var(--krc-title, #dbe7e4);
}
.krc-head {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 10px;
}
.krc-head.clickable {
  cursor: pointer;
  user-select: none;
}
.krc-head.clickable:hover .krc-title {
  color: var(--krc-accent, #a5b4fc);
}
.krc-chev {
  flex-shrink: 0;
  color: var(--krc-title, #dbe7e4);
}
.krc-count {
  margin-left: auto;
  font-size: 10px;
  font-weight: 700;
  color: var(--krc-none, #666);
}
.krc-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.krc-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-radius: 6px;
  background: var(--krc-row-bg, rgba(255, 255, 255, 0.04));
}
.krc-name {
  width: 110px;
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 700;
  color: var(--krc-name, #d8d8e0);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.krc-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  min-width: 0;
}
.krc-chip {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 1px 7px;
  border-radius: 4px;
  background: var(--krc-chip-bg, rgba(248, 113, 113, 0.12));
  border: 1px solid var(--krc-chip-border, rgba(248, 113, 113, 0.35));
  color: var(--krc-chip-fg, #fca5a5);
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
}
.krc-chip em {
  font-style: normal;
  font-weight: 600;
  color: var(--krc-chip-em, #9ca3af);
}
.krc-none {
  font-size: 11px;
  color: var(--krc-none, #666);
}

/* 深色主题（默认）：用于 GameDetailPopup 等暗色弹层 */
.krc-dark {
  --krc-border: #444;
  --krc-bg: #12121a;
  --krc-title: #dbe7e4;
  --krc-accent: #a5b4fc;
  --krc-row-bg: rgba(255, 255, 255, 0.04);
  --krc-name: #d8d8e0;
  --krc-chip-bg: rgba(248, 113, 113, 0.12);
  --krc-chip-border: rgba(248, 113, 113, 0.35);
  --krc-chip-fg: #fca5a5;
  --krc-chip-em: #9ca3af;
  --krc-none: #666;
}

/* 浅色主题：用于 MatchOverviewPanel 等浅色详情页 */
.krc-light {
  --krc-border: #dce7e4;
  --krc-bg: #ffffff;
  --krc-title: #1f2a2e;
  --krc-accent: #1f5f56;
  --krc-row-bg: #f2f7f5;
  --krc-name: #263238;
  --krc-chip-bg: #fdecec;
  --krc-chip-border: #f2bcbc;
  --krc-chip-fg: #b42318;
  --krc-chip-em: #8a5a52;
  --krc-none: #7a8a8f;
}
</style>

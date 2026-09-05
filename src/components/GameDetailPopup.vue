<script setup lang="ts">
import { computed } from "vue"
import { Crown, Swords, X } from "lucide-vue-next"
import type { ChampionSummaryItem, GameAssetEntry, MatchDetailPlayer, MatchDetailResponse } from "../types"
import { calculateOutputRating } from "../scoring"
import GameDetailTeams from "./GameDetailTeams.vue"
import KillRelationsCard from "./KillRelationsCard.vue"

const props = defineProps<{
  game: MatchDetailResponse
  champions: Record<number, ChampionSummaryItem>
  itemMap: Record<number, GameAssetEntry>
  spellMap: Record<number, GameAssetEntry>
  augmentMap: Record<number, GameAssetEntry>
  perkMap: Record<number, GameAssetEntry>
  highlightChampionId?: number
  /** 额外按玩家高亮（选手对比 A/B 等）：{puuid, label} */
  highlightPlayers?: { puuid: string; label: string }[]
}>()

const emit = defineEmits<{
  (e: "close"): void
}>()

const ratingContext = computed(() => ({ items: props.itemMap, champions: props.champions }))

const allPlayers = computed<MatchDetailPlayer[]>(() => props.game.teams.flatMap((team) => team.players))

const mvp = computed(() => {
  let best: { player: MatchDetailPlayer; score: number } | null = null
  for (const p of allPlayers.value) {
    const score = calculateOutputRating(p, ratingContext.value).score
    if (!best || score > best.score) best = { player: p, score }
  }
  return best
})

function formatDateTime(ts: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ts))
}
</script>

<template>
  <Teleport to="body">
    <div class="gdp" @click.stop>
      <div class="gdp-header">
        <div class="gdp-title">
          <Swords :size="16" />
          <strong>对局详情</strong>
          <span class="gdp-date">{{ formatDateTime(game.gameCreation) }}</span>
          <span class="gdp-dur">{{ (game.gameDuration / 60).toFixed(0) }} 分钟</span>
        </div>
        <div v-if="mvp" class="gdp-mvp">
          <Crown :size="12" />
          MVP {{ mvp.player.gameName }} · {{ mvp.score.toFixed(0) }} 分
        </div>
        <button class="gdp-close" @click="emit('close')" title="关闭对局详情"><X :size="16" /></button>
      </div>

      <div class="gdp-hint">在右侧侧边栏点击其它对局可切换详情 · 再点一次当前对局或点 × 关闭</div>

      <div class="gdp-scroll">
        <!-- 队伍明细行：与内战评分展开详情 / 详细战绩页共用同一组件 -->
        <GameDetailTeams
          :teams="game.teams"
          :champions="champions"
          :item-map="itemMap"
          :spell-map="spellMap"
          :perk-map="perkMap"
          :augment-map="augmentMap"
          :highlight-champion-id="highlightChampionId"
          :highlight-players="highlightPlayers"
          theme="dark"
        />

        <!-- 击杀关系（复用组件，展示逻辑与详细战绩一致） -->
        <KillRelationsCard :players="allPlayers" :champions="champions" theme="dark" />
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.gdp {
  position: fixed;
  top: 0;
  bottom: 0;
  left: 0;
  right: 460px;
  z-index: 220;
  display: flex;
  flex-direction: column;
  background: #16161d;
  border-right: 1px solid var(--border, #444);
  box-shadow: 12px 0 32px rgba(0, 0, 0, 0.4);
}

.gdp-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border, #333);
  background: #1e1e26;
  flex-wrap: wrap;
}
.gdp-title { display: flex; align-items: center; gap: 8px; }
.gdp-title strong { font-size: 16px; color: #f2f5f4; }
.gdp-date { font-size: 12px; color: #9fb3ae; }
.gdp-dur { font-size: 12px; color: var(--text-muted, #888); }
.gdp-mvp { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 800; color: #fbbf24; }
.gdp-close {
  margin-left: auto;
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 8px;
  background: var(--bg-tertiary, #2a2a2a);
  color: var(--text-muted, #aaa);
  cursor: pointer;
}
.gdp-close:hover { color: var(--accent, #a5b4fc); }

.gdp-hint { padding: 8px 18px 0; font-size: 11px; color: var(--text-muted, #666); }

.gdp-scroll { flex: 1; overflow: auto; padding: 12px 18px 18px; display: flex; flex-direction: column; gap: 14px; }
.gdp-scroll::-webkit-scrollbar { width: 8px; }
.gdp-scroll::-webkit-scrollbar-thumb { background: #2e3742; border-radius: 4px; }
</style>

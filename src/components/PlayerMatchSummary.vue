<script setup lang="ts">
import { computed } from "vue"
import type {
  ChampionSummaryItem,
  GameAssetBundle,
  GameAssetEntry,
  PlayerStatsResponse,
} from "../types"
import { buildPlayerProfile, profileScoreLevel, profileTierLabel } from "../playerProfile"
import { rankIconLarge } from "../rankIcons"
import { percent } from "../utils"
import ChampionAvatar from "./ChampionAvatar.vue"


const emit = defineEmits<{
  selectChampion: [championId: number | null]
}>()
interface RankCard {
  label: string
  value: string
  tier: string
}

const props = defineProps<{
  recentStats: PlayerStatsResponse | null
  champions: Record<number, ChampionSummaryItem>
  gameAssets: GameAssetBundle
  rankCards: RankCard[]
  rankedLoading?: boolean
  selectedHeroId?: number | null
}>()

const items = computed<Record<number, GameAssetEntry>>(() => indexAssets(props.gameAssets.items))
const augments = computed<Record<number, GameAssetEntry>>(() => indexAssets(props.gameAssets.augments))
const perks = computed<Record<number, GameAssetEntry>>(() => indexAssets(props.gameAssets.perks))
const ratingContext = computed(() => ({
  items: items.value,
  champions: props.champions,
  augments: { ...perks.value, ...augments.value },
}))
const profile = computed(() =>
  buildPlayerProfile(props.recentStats?.recentGames || [], ratingContext.value),
)
const summary = computed(() => props.recentStats?.summary || null)
const poolChampions = computed(() => props.recentStats?.championStats || [])
const abilityCards = computed(() => [
  profile.value.abilities.carry,
  profile.value.abilities.frontline,
  profile.value.abilities.support,
])

function indexAssets(entries: GameAssetEntry[]) {
  return entries.reduce<Record<number, GameAssetEntry>>((acc, entry) => {
    acc[entry.id] = entry
    return acc
  }, {})
}
function scoreText(score: number, games: number) {
  return games > 0 ? `${Math.round(score)}分` : "样本不足"
}
function profileClass(score: number, games: number) {
  return games > 0 ? `psm-lv-${profileScoreLevel(score)}` : "psm-empty"
}
function evaluationText(score: number, games: number) {
  return games > 0 ? profileTierLabel(score) : "样本不足"
}
</script>

<template>
  <div class="psm">
    <section class="psm-panel" v-if="rankedLoading || rankCards.length">
      <header class="psm-heading"><strong>段位</strong></header>
      <div v-if="rankedLoading && !rankCards.length" class="psm-muted">读取中</div>
      <article
        v-for="card in rankCards"
        :key="card.label"
        :class="['psm-rank', `psm-tier-${card.tier.toLowerCase()}`]"
      >
        <img class="psm-rank-icon" :src="rankIconLarge(card.tier)" :alt="card.value" />
        <div class="psm-rank-text">
          <span>{{ card.label }}</span>
          <strong>{{ card.value }}</strong>
        </div>
      </article>
    </section>

    <section class="psm-panel" v-if="summary">
      <header class="psm-heading"><strong>近期概览</strong></header>
      <div class="psm-metrics">
        <div class="psm-metric"><span>近 {{ summary.games }} 局</span><strong>{{ summary.wins }}胜 {{ summary.losses }}负</strong></div>
        <div class="psm-metric"><span>胜率</span><strong>{{ percent(summary.winRate) }}</strong></div>
        <div class="psm-metric"><span>KDA</span><strong>{{ summary.averageKda.toFixed(2) }}</strong></div>
        <div class="psm-metric"><span>场均 K/D/A</span><strong>{{ summary.averageKills.toFixed(1) }} / {{ summary.averageDeaths.toFixed(1) }} / {{ summary.averageAssists.toFixed(1) }}</strong></div>
      </div>
    </section>

    <section class="psm-panel" v-if="profile.games">
      <header class="psm-heading"><strong>玩家画像</strong></header>
      <div class="psm-score-line">
        <span>综合分</span>
        <strong :class="profileClass(profile.overallScore, profile.games)">{{ scoreText(profile.overallScore, profile.games) }}</strong>
        <em>{{ evaluationText(profile.overallScore, profile.games) }}</em>
      </div>
      <div class="psm-tags">
        <span v-for="tag in profile.tags" :key="tag">{{ tag }}</span>
      </div>
      <div class="psm-abilities">
        <div v-for="ability in abilityCards" :key="ability.key" class="psm-ability">
          <span>{{ ability.label }}</span>
          <strong :class="profileClass(ability.averageScore, ability.games)">{{ scoreText(ability.averageScore, ability.games) }}</strong>
          <small>{{ ability.games }} 场</small>
        </div>
      </div>
    </section>
    <section class="psm-panel" v-if="poolChampions.length">
      <header class="psm-heading"><strong>英雄池</strong><span class="psm-pool-count">{{ poolChampions.length }} 个</span></header>
      <div class="psm-pool">
        <button
          v-for="champ in poolChampions"
          :key="champ.championId"
          type="button"
          class="psm-pool-btn"
          :class="{ active: champ.championId === selectedHeroId }"
          :title="champ.championId === selectedHeroId ? '再次点击取消过滤' : `点击只看 ${props.champions[champ.championId]?.name || ''} 战绩`"
          @click="emit('selectChampion', champ.championId === selectedHeroId ? null : champ.championId)"
        >
          <ChampionAvatar :champion-id="champ.championId" :champions="champions" :size="42" />
          <em>{{ champ.games }}</em>
        </button>
      </div>
    </section>
  </div>

</template>

<style scoped>
.psm { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.psm-panel { border: 1px solid #dce7e4; border-radius: 10px; background: #fff; padding: 12px; box-shadow: 0 8px 22px rgba(32,67,73,.05); }
.psm-heading { margin-bottom: 8px; color:#263238; font-size:13px; font-weight:800; }
.psm-muted { color:#788397; font-size:12px; }
.psm-rank { display:flex; align-items:center; gap:8px; padding:6px 0; }
.psm-rank-icon { width:36px; height:36px; }
.psm-rank-text { display:flex; flex-direction:column; min-width:0; }
.psm-rank-text span { color:#718087; font-size:11px; }
.psm-rank-text strong { color:#20333a; font-size:14px; }
.psm-metrics { display:grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap:8px; }
.psm-metric { display:flex; flex-direction:column; gap:2px; }
.psm-metric span { color:#718087; font-size:11px; }
.psm-metric strong { color:#20333a; font-size:14px; }
.psm-heroes { margin-top:8px; }
.psm-sub { color:#718087; font-size:11px; }
.psm-hero-btn {
  padding: 2px;
  border: 2px solid transparent;
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
  line-height: 0;
}
.psm-hero-btn:hover {
  border-color: #b7d2cc;
}
.psm-hero-btn.active {
  border-color: #1f5f56;
  background: #e7f2f0;
}
.psm-hero-list { display:flex; gap:4px; margin-top:4px; flex-wrap:wrap; }
.psm-score-line { display:flex; align-items:baseline; gap:6px; }
.psm-score-line span { color:#718087; font-size:11px; }
.psm-score-line strong { font-size:18px; font-weight:900; }
.psm-score-line em { color:#788397; font-size:11px; font-style:normal; }
.psm-tags { display:flex; flex-wrap:wrap; gap:4px; margin:8px 0; }
.psm-tags span { border-radius:5px; background:#eef4f2; color:#315f58; font-size:11px; font-weight:800; padding:2px 6px; }
.psm-pool-count { color: #8a989c; font-size: 11px; margin-left: auto; }
.psm-pool {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-height: 210px;
  overflow-y: auto;
  padding: 2px;
}
.psm-pool-btn {
  position: relative;
  width: 48px;
  height: 48px;
  padding: 2px;
  border: 2px solid transparent;
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
  line-height: 0;
}
.psm-pool-btn:hover { border-color: #b7d2cc; }
.psm-pool-btn.active { border-color: #1f5f56; background: #e7f2f0; }
.psm-pool-btn em {
  position: absolute;
  right: -3px;
  bottom: -3px;
  min-width: 18px;
  height: 18px;
  padding: 0 3px;
  border-radius: 9px;
  background: #1f5f56;
  color: #fff;
  font-size: 10px;
  font-weight: 800;
  font-style: normal;
  line-height: 18px;
  text-align: center;
}
.psm-abilities { display:flex; flex-direction:column; gap:4px; }
.psm-ability { display:flex; align-items:center; gap:8px; font-size:12px; }
.psm-ability span { color:#53656b; flex:1; }
.psm-ability strong { min-width:46px; text-align:right; }
.psm-ability small { color:#8a989c; }
.psm-lv-excellent { color:#1d9a62; }
.psm-lv-good { color:#2f78d6; }
.psm-lv-average { color:#c99726; }
.psm-lv-low { color:#c9614a; }
.psm-lv-disaster { color:#c94040; }
.psm-empty { color:#8a989c; }
</style>
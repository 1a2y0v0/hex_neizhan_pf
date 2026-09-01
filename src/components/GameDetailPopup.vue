<script setup lang="ts">
import { computed } from "vue"
import { Crown, Swords, X } from "lucide-vue-next"
import type { ChampionSummaryItem, GameAssetEntry, MatchDetailPlayer, MatchDetailResponse, RecentGame } from "../types"
import { matchTeamSummary } from "../matchTeamSummary"
import { calculateOutputRating, outputRatingTitle } from "../scoring"
import { mitigationValue, teamMitigationValue } from "../utils"
import AssetIcon from "./AssetIcon.vue"
import ChampionAvatar from "./ChampionAvatar.vue"

const props = defineProps<{
  game: MatchDetailResponse
  champions: Record<number, ChampionSummaryItem>
  itemMap: Record<number, GameAssetEntry>
  spellMap: Record<number, GameAssetEntry>
  augmentMap: Record<number, GameAssetEntry>
  perkMap: Record<number, GameAssetEntry>
  highlightChampionId?: number
}>()

const emit = defineEmits<{
  (e: "close"): void
}>()

const ratingContext = computed(() => ({ items: props.itemMap, champions: props.champions }))

interface EnrichedPlayer {
  p: MatchDetailPlayer
  score: number
  ratingLabel: string
  roleLabel: string
  hint: string
}

interface EnrichedTeam {
  teamId: number
  name: string
  win: boolean
  towerKills: number
  avgScore: number
  summary: ReturnType<typeof matchTeamSummary>
  players: EnrichedPlayer[]
}

const teams = computed<EnrichedTeam[]>(() => {
  return props.game.teams.map((team) => {
    const players: EnrichedPlayer[] = team.players.map((p) => {
      const rating = calculateOutputRating(p, ratingContext.value)
      return {
        p,
        score: rating.score,
        ratingLabel: rating.label,
        roleLabel: rating.role.label,
        hint: outputRatingTitle(p, ratingContext.value),
      }
    })
    const avgScore = players.length ? players.reduce((s, x) => s + x.score, 0) / players.length : 0
    return {
      teamId: team.teamId,
      name: team.name || (team.teamId === 100 ? "蓝方" : "红方"),
      win: team.win,
      towerKills: team.towerKills,
      avgScore,
      summary: matchTeamSummary(team),
      players,
    }
  })
})

const allPlayers = computed(() => teams.value.flatMap((t) => t.players))
const mvp = computed(() => allPlayers.value.reduce((best, x) => (x.score > best.score ? x : best), allPlayers.value[0]))

const playerNames = computed(() => {
  const map = new Map<string, string>()
  for (const team of props.game.teams) {
    for (const p of team.players) map.set(p.puuid, p.gameName)
  }
  return map
})
function victimName(puuid: string) {
  return playerNames.value.get(puuid) || puuid
}

/* ── 格式化 ── */
function kNumber(value: number) {
  return `${(value / 1000).toFixed(1)}k`
}
function shareSuffix(part: number, total: number) {
  return `(${total > 0 ? Math.round((part / total) * 100) : 0}%)`
}
function protectionValue(game: RecentGame) {
  return (game.totalHeal || 0) + (game.totalDamageShieldedOnTeammates || 0)
}
function teamProtectionValue(game: RecentGame) {
  return (game.teamTotalHeal || 0) + (game.teamTotalDamageShieldedOnTeammates || 0)
}
function damageConversion(game: RecentGame) {
  const goldShare = game.teamGoldEarned > 0 ? game.goldEarned / game.teamGoldEarned : 0
  if (goldShare === 0) return "0.00"
  return ((game.damageToChampions / Math.max(game.teamDamageToChampions, 1)) / goldShare).toFixed(2)
}
function augmentName(augmentId: number) {
  return props.augmentMap[augmentId]?.name || props.perkMap[augmentId]?.name || `强化 ${augmentId}`
}
function shortAugmentName(augmentId: number) {
  return Array.from(augmentName(augmentId)).slice(0, 5).join("")
}
function augmentRarityClass(augmentId: number) {
  switch (props.augmentMap[augmentId]?.rarity || props.perkMap[augmentId]?.rarity) {
    case "kPrismatic": return "augment-prismatic"
    case "kGold": return "augment-gold"
    case "kSilver": return "augment-silver"
    case "kBronze": return "augment-bronze"
    default: return ""
  }
}
function scoreClass(s: number) {
  return s >= 80 ? "sc-high" : s >= 60 ? "sc-mid" : "sc-low"
}
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
          MVP {{ mvp.p.gameName }} · {{ mvp.score.toFixed(0) }} 分
        </div>
        <button class="gdp-close" @click="emit('close')" title="关闭对局详情"><X :size="16" /></button>
      </div>

      <div class="gdp-hint">在右侧侧边栏点击其它对局可切换详情 · 再点一次当前对局或点 × 关闭</div>

      <div class="gdp-scroll">
        <section v-for="team in teams" :key="team.teamId" class="gdp-team">
          <div class="gdp-team-header" :class="team.win ? 'win' : 'lose'">
            <div class="gdp-team-result">
              <strong>{{ team.name }}</strong>
              <span>{{ team.win ? "胜利" : "失败" }}</span>
              <span class="gdp-team-avg">均分 {{ team.avgScore.toFixed(0) }}</span>
            </div>
            <div class="gdp-team-summary">
              <span>KDA <b>{{ team.summary.kills }}/{{ team.summary.deaths }}/{{ team.summary.assists }}</b></span>
              <span>总经济 <b>{{ kNumber(team.summary.goldEarned) }}</b></span>
              <span>总伤害 <b>{{ kNumber(team.summary.damageToChampions) }}</b></span>
              <span>推塔 <b>{{ team.summary.towerKills }}</b></span>
            </div>
          </div>

          <div class="gdp-rows">
            <div
              v-for="x in team.players"
              :key="x.p.puuid"
              class="gdp-row"
              :class="[{ 'gdp-highlight': x.p.championId === highlightChampionId }, x.p.win ? 'win' : 'lose']"
            >
              <div class="gdp-champ">
                <ChampionAvatar :champion-id="x.p.championId" :champions="champions" :size="30" />
                <span class="gdp-pname">{{ x.p.gameName }}</span>
                <span v-if="x.p.championId === highlightChampionId" class="gdp-pick-badge">本场英雄</span>
              </div>

              <div class="gdp-spells">
                <AssetIcon v-if="x.p.spell1Id" :path="spellMap[x.p.spell1Id]?.iconPath" :label="spellMap[x.p.spell1Id]?.name" :fallback="String(x.p.spell1Id)" :size="16" />
                <AssetIcon v-if="x.p.spell2Id" :path="spellMap[x.p.spell2Id]?.iconPath" :label="spellMap[x.p.spell2Id]?.name" :fallback="String(x.p.spell2Id)" :size="16" />
              </div>

              <div class="gdp-items">
                <AssetIcon
                  v-for="itemId in x.p.itemIds"
                  :key="itemId"
                  :path="itemMap[itemId]?.iconPath"
                  :label="itemMap[itemId]?.name"
                  :fallback="String(itemId)"
                  :size="24"
                />
              </div>

              <div class="gdp-runes">
                <template v-if="x.p.augmentIds.length">
                  <span v-for="augmentId in x.p.augmentIds.slice(0, 4)" :key="augmentId" :class="['gdp-aug', augmentRarityClass(augmentId)]" :title="augmentName(augmentId)">
                    {{ shortAugmentName(augmentId) }}
                  </span>
                </template>
                <template v-else>
                  <AssetIcon
                    v-for="perkId in x.p.perkIds.slice(0, 4)"
                    :key="perkId"
                    :path="perkMap[perkId]?.iconPath"
                    :label="perkMap[perkId]?.name"
                    :fallback="String(perkId)"
                    :size="18"
                  />
                </template>
              </div>

              <div class="gdp-kda">
                <strong>{{ x.p.kills }}/{{ x.p.deaths }}/{{ x.p.assists }}</strong>
                <span v-if="x.p.carryKills > 0 || x.p.carryAssists > 0" class="gdp-carry" :title="`切C：击杀敌方C位 ${x.p.carryKills} 次，参与 ${x.p.carryAssists} 次助攻（本队对C位总击杀 ${x.p.teamCarryKills}）`">
                  切C {{ x.p.carryKills }}/{{ x.p.carryAssists }}
                </span>
              </div>

              <div class="gdp-stat" :title="x.hint">
                <strong>{{ kNumber(x.p.damageToChampions) }}</strong>
                <em>{{ shareSuffix(x.p.damageToChampions, x.p.teamDamageToChampions) }}</em>
              </div>
              <div class="gdp-stat" :title="x.hint">
                <strong>{{ kNumber(x.p.goldEarned) }}</strong>
                <em>{{ shareSuffix(x.p.goldEarned, x.p.teamGoldEarned) }}</em>
              </div>
              <div class="gdp-stat" :title="x.hint">
                <strong>{{ kNumber(mitigationValue(x.p)) }}</strong>
                <em>{{ shareSuffix(mitigationValue(x.p), teamMitigationValue(x.p)) }}</em>
              </div>
              <div class="gdp-stat" :title="x.hint">
                <strong>{{ kNumber(protectionValue(x.p)) }}</strong>
                <em>{{ shareSuffix(protectionValue(x.p), teamProtectionValue(x.p)) }}</em>
              </div>
              <div class="gdp-stat" :title="x.hint">
                <strong>{{ damageConversion(x.p) }}</strong>
              </div>

              <div class="gdp-score" :class="scoreClass(x.score)" :title="x.hint">
                <strong>{{ x.score.toFixed(0) }}分</strong>
                <span>{{ x.roleLabel }} · {{ x.ratingLabel }}</span>
              </div>
            </div>
          </div>
        </section>

        <!-- 击杀关系 -->
        <section class="gdp-kills-card">
          <div class="gdp-sec-title">击杀关系（谁杀了谁）</div>
          <div class="gdp-kill-list">
            <div v-for="x in allPlayers" :key="x.p.puuid" class="gdp-kill-row">
              <ChampionAvatar :champion-id="x.p.championId" :champions="champions" :size="20" />
              <span class="gdp-kill-name">{{ x.p.gameName }}</span>
              <div class="gdp-kill-chips">
                <span
                  v-for="kr in x.p.killRelations || []"
                  :key="kr.victimPuuid"
                  class="gdp-kill-chip"
                  :title="`${victimName(kr.victimPuuid)} · 击杀 ${kr.kills} 次${kr.assists ? ` · 助攻 ${kr.assists} 次` : ''}`"
                >
                  {{ victimName(kr.victimPuuid) }} ×{{ kr.kills }}<em v-if="kr.assists">+{{ kr.assists }}助</em>
                </span>
                <span v-if="!(x.p.killRelations || []).length" class="gdp-kill-none">本局无击杀</span>
              </div>
            </div>
          </div>
        </section>
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

.gdp-team { overflow-x: auto; border: 1px solid var(--border, #444); border-radius: 10px; background: #12121a; padding: 10px; }
.gdp-team-header {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  border-radius: 8px;
  margin-bottom: 8px;
  padding: 8px 10px;
}
.gdp-team-header.win { color: #7db8f0; background: rgba(31, 95, 159, 0.22); }
.gdp-team-header.lose { color: #f0a0a0; background: rgba(162, 61, 61, 0.22); }
.gdp-team-result { display: flex; align-items: center; gap: 8px; }
.gdp-team-result strong { font-size: 15px; }
.gdp-team-result span { font-size: 12px; font-weight: 800; }
.gdp-team-avg { font-weight: 700; opacity: 0.85; }
.gdp-team-summary { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; font-size: 11px; }
.gdp-team-summary b { font-size: 12px; font-weight: 900; }

.gdp-rows { display: flex; flex-direction: column; gap: 5px; min-width: 1010px; }

.gdp-row {
  display: grid;
  grid-template-columns: 150px 22px 176px 140px 92px 64px 64px 64px 64px 44px 86px;
  gap: 4px;
  align-items: center;
  height: 48px;
  min-height: 48px;
  max-height: 48px;
  overflow: hidden;
  border: 1px solid var(--border, #444);
  border-left-width: 4px;
  border-radius: 8px;
  padding: 3px 8px;
}
.gdp-row.win { border-color: rgba(47, 120, 214, 0.35); border-left-color: #2f78d6; background: rgba(47, 120, 214, 0.13); }
.gdp-row.lose { border-color: rgba(202, 75, 75, 0.35); border-left-color: #ca4b4b; background: rgba(202, 75, 75, 0.13); }
.gdp-row.gdp-highlight { border-color: rgba(167, 139, 250, 0.55); border-left-color: #a78bfa; box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.28); }

.gdp-champ { display: flex; align-items: center; gap: 6px; min-width: 0; }
.gdp-pname { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #d8d8e0; font-size: 13px; font-weight: 700; }
.gdp-pick-badge { flex-shrink: 0; padding: 1px 5px; border-radius: 4px; background: rgba(167, 139, 250, 0.18); border: 1px solid rgba(167, 139, 250, 0.45); color: #c4b5fd; font-size: 9px; font-weight: 800; }

.gdp-spells { display: flex; flex-direction: column; gap: 2px; }
.gdp-items { display: flex; flex-wrap: nowrap; gap: 2px; min-width: 0; }
.gdp-runes {
  display: grid;
  grid-template-columns: repeat(2, max-content);
  grid-auto-rows: 19px;
  align-content: center;
  justify-content: center;
  gap: 2px 4px;
  overflow: hidden;
  height: 40px;
}
.gdp-aug {
  display: inline-flex;
  box-sizing: border-box;
  width: calc(5em + 8px);
  height: 19px;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 4px;
  color: #d8d8e0;
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
}
.gdp-aug.augment-prismatic { border-color: rgba(170, 72, 215, 0.42); color: #e2b8ff; background: rgba(109, 44, 145, 0.5); }
.gdp-aug.augment-gold { border-color: rgba(199, 144, 36, 0.48); color: #ffd36a; background: rgba(123, 77, 2, 0.45); }
.gdp-aug.augment-silver { border-color: rgba(134, 151, 166, 0.48); color: #c6d4de; background: rgba(73, 96, 111, 0.45); }
.gdp-aug.augment-bronze { border-color: rgba(167, 105, 60, 0.46); color: #e8b48a; background: rgba(122, 67, 35, 0.45); }

.gdp-kda, .gdp-stat, .gdp-score { display: flex; min-width: 0; align-items: center; justify-content: center; }
.gdp-kda { flex-direction: column; gap: 1px; }
.gdp-kda strong { color: #e8e8f0; font-size: 13px; line-height: 1; white-space: nowrap; }
.gdp-carry {
  padding: 1px 5px;
  border: 1px solid rgba(251, 146, 60, 0.45);
  border-radius: 6px;
  background: rgba(251, 146, 60, 0.12);
  color: #fdba74;
  font-size: 9px;
  font-weight: 800;
  line-height: 1.2;
  white-space: nowrap;
}
.gdp-stat { flex-direction: column; gap: 1px; }
.gdp-stat strong { color: #e8e8f0; font-size: 14px; line-height: 1; white-space: nowrap; }
.gdp-stat em { color: #8a989c; font-size: 11px; font-style: normal; font-weight: 700; }

.gdp-score { height: 40px; flex-direction: column; gap: 2px; border-radius: 7px; background: rgba(255, 255, 255, 0.06); padding: 3px; text-align: center; }
.gdp-score strong { position: relative; z-index: 1; color: inherit; font-size: 16px; font-weight: 950; line-height: 1; white-space: nowrap; }
.gdp-score span { position: relative; z-index: 1; max-width: 100%; color: inherit; font-size: 9.5px; font-weight: 900; line-height: 1; white-space: nowrap; }

/* 击杀关系 */
.gdp-kills-card { border: 1px solid var(--border, #444); border-radius: 10px; background: #12121a; padding: 12px; }
.gdp-sec-title { font-size: 13px; font-weight: 800; color: #dbe7e4; margin-bottom: 10px; }
.gdp-kill-list { display: flex; flex-direction: column; gap: 6px; }
.gdp-kill-row { display: flex; align-items: center; gap: 8px; padding: 4px 8px; border-radius: 6px; background: rgba(255, 255, 255, 0.04); }
.gdp-kill-name { width: 110px; flex-shrink: 0; font-size: 12px; font-weight: 700; color: #d8d8e0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gdp-kill-chips { display: flex; flex-wrap: wrap; gap: 4px; min-width: 0; }
.gdp-kill-chip { display: inline-flex; align-items: center; gap: 2px; padding: 1px 7px; border-radius: 4px; background: rgba(248, 113, 113, 0.12); border: 1px solid rgba(248, 113, 113, 0.35); color: #fca5a5; font-size: 11px; font-weight: 700; white-space: nowrap; }
.gdp-kill-chip em { font-style: normal; font-weight: 600; color: #9ca3af; }
.gdp-kill-none { font-size: 11px; color: var(--text-muted, #666); }

.sc-high { color: #4ade80; }
.sc-mid { color: #60a5fa; }
.sc-low { color: #f87171; }
</style>

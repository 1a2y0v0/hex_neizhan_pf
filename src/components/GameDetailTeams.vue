<script setup lang="ts">
import { computed } from "vue"
import type { ChampionSummaryItem, GameAssetEntry, MatchDetailPlayer, MatchDetailTeam, RecentGame } from "../types"
import { matchTeamSummary } from "../matchTeamSummary"
import { calculateOutputRating, outputRatingTitle, type OutputRating } from "../scoring"
import { fixed, mitigationValue, teamMitigationValue } from "../utils"
import AssetIcon from "./AssetIcon.vue"
import ChampionAvatar from "./ChampionAvatar.vue"

/**
 * 对局详细战绩表格（蓝/红两队 header + 每玩家一行明细）。
 * 内战评分展开详情与详细战绩页共用同一实现；通过 theme 切换深浅配色。
 */
const props = withDefaults(
  defineProps<{
    teams: MatchDetailTeam[]
    champions: Record<number, ChampionSummaryItem>
    itemMap: Record<number, GameAssetEntry>
    spellMap: Record<number, GameAssetEntry>
    perkMap: Record<number, GameAssetEntry>
    augmentMap: Record<number, GameAssetEntry>
    theme?: "dark" | "light"
    /** 行是否可点击（键盘可达）；点击会 emit open-player */
    interactive?: boolean
    /** 高亮的英雄（行加高亮样式，可选显示“本场英雄”徽标） */
    highlightChampionId?: number
    /** 额外按玩家高亮（如选手对比 A/B）：{puuid, label}，行内显示 label 徽标 */
    highlightPlayers?: { puuid: string; label: string }[]
    /** 行悬停提示；默认显示本场评分说明 */
    titleFor?: (player: MatchDetailPlayer) => string
    /** 玩家名字区默认文本；覆盖后可用 slot #name 完全自定义 */
    nameOf?: (player: MatchDetailPlayer) => string
    /** 预计算评分，供复用调用方缓存（WeakMap 等），缺省内部计算 */
    rate?: (player: RecentGame) => OutputRating
  }>(),
  {
    theme: "dark",
    interactive: false,
    highlightChampionId: undefined,
    highlightPlayers: undefined,
    titleFor: undefined,
    nameOf: undefined,
    rate: undefined,
  },
)

const emit = defineEmits<{
  (e: "open-player", player: MatchDetailPlayer): void
}>()

const ratingContext = computed(() => ({ items: props.itemMap, champions: props.champions }))
function outputRating(player: RecentGame) {
  return props.rate ? props.rate(player) : calculateOutputRating(player, ratingContext.value)
}
function outputRatingHint(player: RecentGame) {
  return outputRatingTitle(player, ratingContext.value)
}
function teamSummary(team: MatchDetailTeam) {
  return matchTeamSummary(team)
}

function kNumber(value: number) {
  return `${(value / 1000).toFixed(1)}k`
}
function shareSuffix(part: number, total: number) {
  return `(${total > 0 ? Math.round((part / total) * 100) : 0}%)`
}

/* ── 伤害 / 承伤 胶囊条：参考 Akari DamageBar，按物/魔/真分段，宽度相对全场最高值，降序排列 ── */
interface CapsuleSegment {
  key: "physical" | "magic" | "true"
  label: string
  value: number
  /** 占全场最高值百分比（与胶囊 track 全宽 = 全场最高值对应） */
  pct: number
}
const allDetailPlayers = computed(() => props.teams.flatMap((t) => t.players))
const maxDamageDealt = computed(() => Math.max(...allDetailPlayers.value.map((p) => p.damageToChampions || 0), 1))
const maxDamageTaken = computed(() => Math.max(...allDetailPlayers.value.map((p) => (p.physicalDamageTaken || 0) + (p.magicDamageTaken || 0) + (p.trueDamageTaken || 0)), 1))
function damageCapsule(player: MatchDetailPlayer): CapsuleSegment[] {
  const max = maxDamageDealt.value
  const segments: CapsuleSegment[] = [
    { key: "physical", label: "物理伤害", value: player.physicalDamageDealtToChampions || 0, pct: ((player.physicalDamageDealtToChampions || 0) / max) * 100 },
    { key: "magic", label: "魔法伤害", value: player.magicDamageDealtToChampions || 0, pct: ((player.magicDamageDealtToChampions || 0) / max) * 100 },
    { key: "true", label: "真实伤害", value: player.trueDamageDealtToChampions || 0, pct: ((player.trueDamageDealtToChampions || 0) / max) * 100 },
  ]
  return segments.sort((a, b) => b.value - a.value)
}
function takenCapsule(player: MatchDetailPlayer): CapsuleSegment[] {
  const max = maxDamageTaken.value
  const segments: CapsuleSegment[] = [
    { key: "physical", label: "物理承伤", value: player.physicalDamageTaken || 0, pct: ((player.physicalDamageTaken || 0) / max) * 100 },
    { key: "magic", label: "魔法承伤", value: player.magicDamageTaken || 0, pct: ((player.magicDamageTaken || 0) / max) * 100 },
    { key: "true", label: "真实承伤", value: player.trueDamageTaken || 0, pct: ((player.trueDamageTaken || 0) / max) * 100 },
  ]
  return segments.sort((a, b) => b.value - a.value)
}
function hasCapsuleData(segments: CapsuleSegment[]) {
  return segments.some((s) => s.value > 0)
}
function formatExact(value: number) {
  return new Intl.NumberFormat("zh-CN").format(Math.round(value))
}
function capsuleTitle(segments: CapsuleSegment[]) {
  const total = segments.reduce((sum, s) => sum + s.value, 0)
  return segments
    .filter((s) => s.value > 0)
    .map((s) => `${s.label} ${formatExact(s.value)}${total > 0 ? `（${Math.round((s.value / total) * 100)}%）` : ""}`)
    .join(" · ")
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
  return fixed((game.damageToChampions / Math.max(game.teamDamageToChampions, 1)) / goldShare)
}
function detailStatLeader(
  game: RecentGame,
  kind: "damage" | "gold" | "mitigation" | "healing" | "conversion",
) {
  switch (kind) {
    case "damage":
      return game.gameDamageLeader || game.teamDamageLeader
    case "gold":
      return game.teamGoldLeader
    case "mitigation":
      return game.teamMitigationLeader
    case "healing":
      return game.teamHealingLeader
    case "conversion":
      return game.teamDamageConversionLeader
  }
}
function augmentName(augmentId: number) {
  return props.augmentMap[augmentId]?.name || props.perkMap[augmentId]?.name || `强化 ${augmentId}`
}
function shortAugmentName(augmentId: number) {
  return Array.from(augmentName(augmentId)).slice(0, 5).join("")
}
function augmentRarityClass(augmentId: number) {
  switch (props.augmentMap[augmentId]?.rarity || props.perkMap[augmentId]?.rarity) {
    case "kPrismatic":
      return "augment-prismatic"
    case "kGold":
      return "augment-gold"
    case "kSilver":
      return "augment-silver"
    case "kBronze":
      return "augment-bronze"
    default:
      return ""
  }
}

function defaultName(player: MatchDetailPlayer) {
  if (props.nameOf) return props.nameOf(player)
  return player.gameName || player.summonerName || player.puuid || "未知玩家"
}
function rowTitle(player: MatchDetailPlayer) {
  if (props.titleFor) return props.titleFor(player)
  return outputRatingHint(player)
}
/** 命中的对比玩家标签（A/B），用于名字旁徽标 */
function compareLabelOf(player: MatchDetailPlayer): string | undefined {
  return props.highlightPlayers?.find((h) => h.puuid === player.puuid)?.label
}
function compareBadgeClassOf(player: MatchDetailPlayer): string {
  const label = compareLabelOf(player)
  return label ? `gdt-compare-badge-${label.toLowerCase()}` : ""
}
function isCompareHighlighted(player: MatchDetailPlayer): boolean {
  return !!compareLabelOf(player)
}
</script>

<template>
  <section
    v-for="team in teams"
    :key="team.teamId"
    class="gdt-team"
    :class="theme === 'light' ? 'gdt-light' : 'gdt-dark'"
  >
    <div class="gdt-team-header" :class="team.win ? 'win' : 'lose'">
      <div class="gdt-team-result">
        <strong>{{ team.name || (team.teamId === 100 ? "蓝方" : "红方") }}</strong>
        <span>{{ team.win ? "胜利" : "失败" }}</span>
      </div>
      <div class="gdt-team-summary">
        <span>队伍总经济 <b>{{ kNumber(teamSummary(team).goldEarned) }}</b></span>
        <span>队伍总伤害 <b>{{ kNumber(teamSummary(team).damageToChampions) }}</b></span>
        <span>队伍总推塔数 <b>{{ teamSummary(team).towerKills }}</b></span>
      </div>
      <strong class="gdt-team-kda">
        {{ teamSummary(team).kills }}/{{ teamSummary(team).deaths }}/{{ teamSummary(team).assists }}
      </strong>
      <span>伤害</span>
      <span>经济</span>
      <span>承伤</span>
      <span>治疗/护盾</span>
      <span>伤转</span>
      <span>评分</span>
    </div>

    <div class="gdt-list">
      <article
        v-for="player in team.players"
        :key="`${team.teamId}:${player.puuid || player.participantId}`"
        class="gdt-row"
        :class="[
          player.win ? 'win' : 'lose',
          { clickable: interactive, highlighted: player.championId === highlightChampionId || isCompareHighlighted(player) },
        ]"
        :title="rowTitle(player)"
        :tabindex="interactive ? 0 : undefined"
        @click="interactive && emit('open-player', player)"
        @keydown.enter="interactive && emit('open-player', player)"
        @keydown.space.prevent="interactive && emit('open-player', player)"
      >
        <div class="champion-cell">
          <ChampionAvatar :champion-id="player.championId" :champions="champions" :size="40" />
          <slot name="name" :player="player">
            <span class="gdt-pname">
              {{ defaultName(player) }}
              <em v-if="player.championId === highlightChampionId" class="gdt-pick-badge">本场英雄</em>
              <em v-else-if="isCompareHighlighted(player)" class="gdt-pick-badge gdt-compare-badge" :class="compareBadgeClassOf(player)">{{ compareLabelOf(player) }}</em>
            </span>
          </slot>
        </div>

        <div class="spell-column">
          <AssetIcon
            v-if="player.spell1Id"
            :path="spellMap[player.spell1Id]?.iconPath"
            :label="spellMap[player.spell1Id]?.name"
            :fallback="String(player.spell1Id)"
            :size="16"
          />
          <AssetIcon
            v-if="player.spell2Id"
            :path="spellMap[player.spell2Id]?.iconPath"
            :label="spellMap[player.spell2Id]?.name"
            :fallback="String(player.spell2Id)"
            :size="16"
          />
        </div>

        <div class="item-grid">
          <AssetIcon
            v-for="itemId in player.itemIds"
            :key="itemId"
            :path="itemMap[itemId]?.iconPath"
            :label="itemMap[itemId]?.name"
            :fallback="String(itemId)"
            :size="30"
          />
        </div>

        <div class="rune-grid text-grid" v-if="player.augmentIds.length">
          <span
            v-for="augmentId in player.augmentIds.slice(0, 4)"
            :key="augmentId"
            :class="['augment-tag', augmentRarityClass(augmentId)]"
            :title="augmentName(augmentId)"
          >
            {{ shortAugmentName(augmentId) }}
          </span>
        </div>
        <div class="rune-grid" v-else>
          <AssetIcon
            v-for="perkId in player.perkIds.slice(0, 4)"
            :key="perkId"
            :path="perkMap[perkId]?.iconPath"
            :label="perkMap[perkId]?.name"
            :fallback="String(perkId)"
            :size="18"
          />
        </div>

        <div class="kda-cell">
          <strong>{{ player.kills }}/{{ player.deaths }}/{{ player.assists }}</strong>
          <span
            v-if="player.carryKills > 0 || player.carryAssists > 0"
            class="carry-chip"
            :title="`切C：击杀敌方C位 ${player.carryKills} 次，参与 ${player.carryAssists} 次助攻（本队对C位总击杀 ${player.teamCarryKills}）`"
          >
            切C {{ player.carryKills }}/{{ player.carryAssists }}
          </span>
        </div>

        <div
          class="stat-cell gdt-cap-stack"
          :title="hasCapsuleData(damageCapsule(player)) ? capsuleTitle(damageCapsule(player)) : undefined"
        >
          <strong :class="{ leader: detailStatLeader(player, 'damage') }">
            {{ kNumber(player.damageToChampions) }}<em>{{ shareSuffix(player.damageToChampions, player.teamDamageToChampions) }}</em>
          </strong>
          <span v-if="hasCapsuleData(damageCapsule(player))" class="gdt-cap">
            <i
              v-for="seg in damageCapsule(player)"
              :key="seg.key"
              v-show="seg.value > 0"
              class="gdt-cap-seg"
              :class="`gdt-cap-${seg.key}`"
              :style="{ width: seg.pct + '%' }"
            ></i>
          </span>
        </div>

        <div class="stat-cell">
          <strong :class="{ leader: detailStatLeader(player, 'gold') }">
            {{ kNumber(player.goldEarned) }}<em>{{ shareSuffix(player.goldEarned, player.teamGoldEarned) }}</em>
          </strong>
        </div>

        <div
          class="stat-cell gdt-cap-stack"
          :title="hasCapsuleData(takenCapsule(player)) ? capsuleTitle(takenCapsule(player)) : undefined"
        >
          <strong :class="{ leader: detailStatLeader(player, 'mitigation') }">
            {{ kNumber(mitigationValue(player)) }}<em>{{ shareSuffix(mitigationValue(player), teamMitigationValue(player)) }}</em>
          </strong>
          <span v-if="hasCapsuleData(takenCapsule(player))" class="gdt-cap">
            <i
              v-for="seg in takenCapsule(player)"
              :key="seg.key"
              v-show="seg.value > 0"
              class="gdt-cap-seg"
              :class="`gdt-cap-${seg.key}`"
              :style="{ width: seg.pct + '%' }"
            ></i>
          </span>
        </div>

        <div class="stat-cell">
          <strong :class="{ leader: detailStatLeader(player, 'healing') }">
            {{ kNumber(protectionValue(player)) }}<em>{{ shareSuffix(protectionValue(player), teamProtectionValue(player)) }}</em>
          </strong>
        </div>

        <div class="stat-cell">
          <strong :class="{ leader: detailStatLeader(player, 'conversion') }">
            {{ damageConversion(player) }}
          </strong>
        </div>

        <div :class="['score-cell', `score-${outputRating(player).level}`]" :title="outputRatingHint(player)">
          <strong>{{ outputRating(player).score }}分</strong>
          <span>{{ outputRating(player).role.label }} · {{ outputRating(player).label }}</span>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
/* ── 主题变量（默认深色 = 内战评分展开详情原配色） ── */
.gdt-dark {
  --gdt-team-bg: #16161d;
  --gdt-team-border: var(--border, #444);
  --gdt-header-win: #7db8f0;
  --gdt-header-win-bg: rgba(31, 95, 159, 0.22);
  --gdt-header-lose: #f0a0a0;
  --gdt-header-lose-bg: rgba(162, 61, 61, 0.22);
  --gdt-text: #d8d8e0;
  --gdt-text-strong: #e8e8f0;
  --gdt-row-border: var(--border, #444);
  --gdt-row-win-border: rgba(47, 120, 214, 0.35);
  --gdt-row-win-bg: rgba(47, 120, 214, 0.13);
  --gdt-row-lose-border: rgba(202, 75, 75, 0.35);
  --gdt-row-lose-bg: rgba(202, 75, 75, 0.13);
  --gdt-leader: #ff6b6b;
  --gdt-muted: #8a989c;
  --gdt-score-bg: rgba(255, 255, 255, 0.06);
  --gdt-aug-border: rgba(255, 255, 255, 0.14);
  --gdt-aug-fg: #d8d8e0;
  --gdt-aug-bg: transparent;
  --gdt-aug-pri-border: rgba(170, 72, 215, 0.42);
  --gdt-aug-pri-fg: #e2b8ff;
  --gdt-aug-pri-bg: linear-gradient(135deg, rgba(109, 44, 145, 0.5), rgba(141, 70, 170, 0.5));
  --gdt-aug-gold-border: rgba(199, 144, 36, 0.48);
  --gdt-aug-gold-fg: #ffd36a;
  --gdt-aug-gold-bg: rgba(123, 77, 2, 0.45);
  --gdt-aug-silver-border: rgba(134, 151, 166, 0.48);
  --gdt-aug-silver-fg: #c6d4de;
  --gdt-aug-silver-bg: rgba(73, 96, 111, 0.45);
  --gdt-aug-bronze-border: rgba(167, 105, 60, 0.46);
  --gdt-aug-bronze-fg: #e8b48a;
  --gdt-aug-bronze-bg: rgba(122, 67, 35, 0.45);
  --gdt-carry-fg: #fdba74;
  --gdt-carry-bg: rgba(251, 146, 60, 0.12);
  --gdt-carry-border: rgba(251, 146, 60, 0.45);
  --gdt-cap-track: rgba(255, 255, 255, 0.08);
}

/* ── 浅色主题 = 详细战绩页原配色 ── */
.gdt-light {
  --gdt-team-bg: #ffffff;
  --gdt-team-border: #dce7e4;
  --gdt-header-win: #1f5f9f;
  --gdt-header-win-bg: #e7f2ff;
  --gdt-header-lose: #a23d3d;
  --gdt-header-lose-bg: #ffe9e9;
  --gdt-text: #53666c;
  --gdt-text-strong: #20333a;
  --gdt-row-border: #dce7e4;
  --gdt-row-win-border: #c9ddf8;
  --gdt-row-win-bg: #eef6ff;
  --gdt-row-lose-border: #f1cdcd;
  --gdt-row-lose-bg: #fff1f1;
  --gdt-leader: #d22f2f;
  --gdt-muted: #8a989c;
  --gdt-score-bg: rgba(255, 255, 255, 0.58);
  --gdt-aug-border: rgba(31, 55, 59, 0.08);
  --gdt-aug-fg: #34534d;
  --gdt-aug-bg: rgba(255, 255, 255, 0.62);
  --gdt-aug-pri-border: rgba(170, 72, 215, 0.42);
  --gdt-aug-pri-fg: #6d2c91;
  --gdt-aug-pri-bg: linear-gradient(135deg, rgba(249, 226, 255, 0.9), rgba(218, 183, 255, 0.9));
  --gdt-aug-gold-border: rgba(199, 144, 36, 0.48);
  --gdt-aug-gold-fg: #7b4d02;
  --gdt-aug-gold-bg: rgba(255, 230, 161, 0.92);
  --gdt-aug-silver-border: rgba(134, 151, 166, 0.48);
  --gdt-aug-silver-fg: #49606f;
  --gdt-aug-silver-bg: rgba(229, 237, 243, 0.92);
  --gdt-aug-bronze-border: rgba(167, 105, 60, 0.46);
  --gdt-aug-bronze-fg: #7a4323;
  --gdt-aug-bronze-bg: rgba(236, 201, 174, 0.92);
  --gdt-carry-fg: #b45309;
  --gdt-carry-bg: rgba(251, 191, 36, 0.12);
  --gdt-carry-border: rgba(217, 119, 6, 0.4);
  --gdt-cap-track: rgba(31, 55, 59, 0.07);
}

/* ── 队伍卡 / header / row 网格（两主题共用同一布局） ── */
.gdt-team {
  overflow-x: auto;
  border: 1px solid var(--gdt-team-border);
  border-radius: 8px;
  background: var(--gdt-team-bg);
  padding: 8px;
}
.gdt-team-header,
.gdt-row {
  display: grid;
  grid-template-columns: 160px 22px 252px 160px 59px repeat(5, 62px) 128px;
  min-width: 1131px;
  align-items: center;
  gap: 4px;
}
.gdt-team-header {
  border-radius: 6px;
  margin-bottom: 6px;
  padding: 6px 7px;
}
.gdt-team-header.win {
  color: var(--gdt-header-win);
  background: var(--gdt-header-win-bg);
}
.gdt-team-header.lose {
  color: var(--gdt-header-lose);
  background: var(--gdt-header-lose-bg);
}
.gdt-team-result {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
}
.gdt-team-result strong {
  font-size: 15.6px;
  line-height: 1;
}
.gdt-team-result span,
.gdt-team-header > span {
  font-size: 12px;
  font-weight: 900;
  line-height: 1;
  white-space: nowrap;
}
.gdt-team-summary {
  display: grid;
  min-width: 0;
  grid-column: span 3;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  align-items: center;
  gap: 4px;
}
.gdt-team-summary span {
  overflow: hidden;
  font-size: 11px;
  font-weight: 800;
  line-height: 1;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gdt-team-summary b,
.gdt-team-kda {
  font-size: 12px;
  font-weight: 950;
  white-space: nowrap;
}
.gdt-team-kda {
  text-align: center;
}
.gdt-team-header > span {
  text-align: center;
}
.gdt-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.gdt-row {
  height: 48px;
  min-height: 48px;
  max-height: 48px;
  overflow: hidden;
  border: 1px solid var(--gdt-row-border);
  border-left-width: 5px;
  border-radius: 8px;
  padding: 2px 7px;
}
.gdt-row.clickable {
  cursor: pointer;
}
.gdt-row:hover {
  filter: brightness(1.1);
}
.gdt-row.win {
  border-color: var(--gdt-row-win-border);
  border-left-color: #2f78d6;
  background: var(--gdt-row-win-bg);
}
.gdt-row.lose {
  border-color: var(--gdt-row-lose-border);
  border-left-color: #ca4b4b;
  background: var(--gdt-row-lose-bg);
}
.gdt-row.highlighted {
  border-color: rgba(167, 139, 250, 0.55);
  border-left-color: #a78bfa;
  box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.28);
}
.champion-cell {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
}
.champion-cell .gdt-pname {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 4px;
  overflow: hidden;
  color: var(--gdt-text);
  font-size: 13.5px;
  white-space: nowrap;
}
.champion-cell .gdt-pick-badge {
  flex-shrink: 0;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(167, 139, 250, 0.18);
  border: 1px solid rgba(167, 139, 250, 0.45);
  color: #c4b5fd;
  font-size: 9px;
  font-weight: 800;
  line-height: 1.4;
}
.gdt-pick-badge.gdt-compare-badge-a {
  background: rgba(59, 130, 246, 0.18);
  border-color: rgba(59, 130, 246, 0.5);
  color: #93c5fd;
}
.gdt-pick-badge.gdt-compare-badge-b {
  background: rgba(249, 115, 22, 0.18);
  border-color: rgba(249, 115, 22, 0.5);
  color: #fdba74;
}
.spell-column {
  display: flex;
  height: 42px;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
}
.item-grid {
  display: flex;
  min-width: 0;
  flex-wrap: nowrap;
  gap: 3px;
}
.rune-grid {
  display: grid;
  grid-template-columns: repeat(2, max-content);
  grid-auto-rows: 20px;
  align-content: center;
  justify-content: center;
  gap: 2px 4px;
  overflow: hidden;
}
.text-grid .augment-tag {
  display: inline-flex;
  box-sizing: border-box;
  width: calc(5em + 8px);
  height: 19px;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border: 1px solid var(--gdt-aug-border);
  border-radius: 5px;
  color: var(--gdt-aug-fg);
  background: var(--gdt-aug-bg);
  font-size: 13.5px;
  font-weight: 700;
  line-height: 1;
  padding: 0 3px;
  text-align: center;
  white-space: nowrap;
}
.text-grid .augment-prismatic {
  border-color: var(--gdt-aug-pri-border);
  color: var(--gdt-aug-pri-fg);
  background: var(--gdt-aug-pri-bg);
}
.text-grid .augment-gold {
  border-color: var(--gdt-aug-gold-border);
  color: var(--gdt-aug-gold-fg);
  background: var(--gdt-aug-gold-bg);
}
.text-grid .augment-silver {
  border-color: var(--gdt-aug-silver-border);
  color: var(--gdt-aug-silver-fg);
  background: var(--gdt-aug-silver-bg);
}
.text-grid .augment-bronze {
  border-color: var(--gdt-aug-bronze-border);
  color: var(--gdt-aug-bronze-fg);
  background: var(--gdt-aug-bronze-bg);
}
.kda-cell,
.stat-cell,
.score-cell {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: center;
}
.kda-cell {
  flex-direction: column;
  row-gap: 1px;
  line-height: 1.1;
}
.kda-cell strong {
  color: var(--gdt-text-strong);
  font-size: 13px;
  line-height: 1.15;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.kda-cell .carry-chip {
  padding: 0 5px;
  border: 1px solid var(--gdt-carry-border);
  border-radius: 6px;
  background: var(--gdt-carry-bg);
  color: var(--gdt-carry-fg);
  font-size: 10px;
  font-weight: 800;
  line-height: 1.5;
  white-space: nowrap;
}
.stat-cell strong {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  color: var(--gdt-text-strong);
  font-size: 16.5px;
  line-height: 1;
  white-space: nowrap;
}
.stat-cell strong.leader,
.stat-cell strong.leader em {
  color: var(--gdt-leader);
  font-weight: 900;
}
.stat-cell em {
  color: var(--gdt-muted);
  font-size: 13.5px;
  font-style: normal;
  font-weight: 700;
}

/* 伤害 / 承伤 胶囊条：物红 魔蓝 真白，宽度按各自占队伍总值的比例 */
.gdt-cap-stack {
  flex-direction: column;
  gap: 2px;
}
.gdt-cap {
  display: flex;
  width: 56px;
  height: 6px;
  border-radius: 3px;
  overflow: hidden;
  background: var(--gdt-cap-track);
}
.gdt-cap-seg {
  display: block;
  flex: 0 0 auto;
  height: 100%;
  min-width: 0;
}
.gdt-cap-physical { background: #e07856; }
.gdt-cap-magic { background: #5b9fd7; }
.gdt-cap-true {
  background: #c7c9cc;
  box-shadow: inset 0 0 0 1px rgba(31, 55, 59, 0.22);
}
.score-cell {
  height: 42px;
  flex-direction: column;
  gap: 2px;
  border-radius: 7px;
  background: var(--gdt-score-bg);
  padding: 3px;
  text-align: center;
}
.score-cell strong {
  position: relative;
  z-index: 1;
  color: inherit;
  font-size: 18px;
  font-weight: 950;
  line-height: 1;
  white-space: nowrap;
}
.score-cell span {
  position: relative;
  z-index: 1;
  max-width: 100%;
  color: inherit;
  font-size: 10.5px;
  font-weight: 900;
  line-height: 1;
  white-space: nowrap;
}
.score-excellent {
  position: relative;
  overflow: hidden;
  color: #5d3300;
  border: 1px solid rgba(245, 185, 52, 0.72);
  background: linear-gradient(135deg, rgba(255, 244, 184, 0.96), rgba(255, 195, 64, 0.9) 45%, rgba(255, 236, 150, 0.96)), #ffd36a;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.36), 0 0 16px rgba(255, 191, 58, 0.34);
}
.score-good {
  color: #145b3e;
  background: rgba(204, 239, 218, 0.88);
}
.score-average {
  color: #174d83;
  background: rgba(205, 229, 255, 0.92);
}
.score-poor {
  color: #8f3434;
  background: rgba(248, 214, 213, 0.92);
}
</style>

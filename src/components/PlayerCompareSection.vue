<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { ChevronDown, ChevronRight } from "lucide-vue-next"
import type { ChampionSummaryItem, GameAssetEntry, MatchDetailResponse } from "../types"
import ChampionAvatar from "./ChampionAvatar.vue"
import GameDetailPopup from "./GameDetailPopup.vue"

interface CompareChampProfile { games: number; averageDamageShare: number; averageMitigationShare: number }
interface ComparePlayer {
  puuid: string
  gameName: string
  tagLine: string
  gamesPlayed: number
  wins: number
  avgKills: number
  avgDeaths: number
  avgAssists: number
  overallKdaScore: number
  avgGpm: number
  avgDpm: number
  avgKp: number
  profile: {
    overallScore: number
    medianScore: number
    volatility: number
    highlightRate: number
    disasterRate: number
    abilities: {
      carry: { averageScore: number }
      frontline: { averageScore: number }
      support: { averageScore: number }
    }
    tags: string[]
  }
  championProfiles: CompareChampProfile[]
}

interface CompareGamePlayer {
  puuid: string
  gameName: string
  championId: number
  kills: number
  deaths: number
  assists: number
  gameScore: number
  win: boolean
  killRelations?: { victimPuuid: string; kills: number; assists: number }[]
}
interface CompareGame {
  gameId: number
  gameCreation: number
  gameDuration: number
  teams: { win: boolean; players: CompareGamePlayer[] }[]
}

const props = defineProps<{
  players: ComparePlayer[]
  champions: Record<number, ChampionSummaryItem>
  games: CompareGame[]
  /** 完整对局按 gameId 查询（用于点击战绩弹出详细战绩弹层） */
  matchById?: Map<number, MatchDetailResponse>
  itemMap: Record<number, GameAssetEntry>
  spellMap: Record<number, GameAssetEntry>
  augmentMap: Record<number, GameAssetEntry>
  perkMap: Record<number, GameAssetEntry>
}>()

const visible = ref(false)
/* 首次展开才挂载内容，避免大数据量加载时立即渲染 */
const openedOnce = ref(false)
function toggleVisible() {
  visible.value = !visible.value
  if (visible.value) openedOnce.value = true
}

/* ── 选择状态 ── */
const selA = ref("")
const selB = ref("")
watch(
  () => props.players,
  (list) => {
    if (!list.some((p) => p.puuid === selA.value)) selA.value = list[0]?.puuid || ""
    if (!list.some((p) => p.puuid === selB.value)) selB.value = list.find((p) => p.puuid !== selA.value)?.puuid || ""
  },
  { immediate: true },
)

const playerA = computed(() => props.players.find((p) => p.puuid === selA.value) || props.players[0] || null)
const playerB = computed(() => {
  const a = playerA.value
  if (!a) return null
  return props.players.find((p) => p.puuid === selB.value && p.puuid !== a.puuid)
    || props.players.find((p) => p.puuid !== a.puuid)
    || null
})

/** 两个下拉框不允许选同一人：keep 表示保留哪一侧，另一侧自动换成其他人。 */
function ensureDistinct(keep: "a" | "b") {
  if (selA.value && selA.value === selB.value) {
    const other = props.players.find((p) => p.puuid !== selA.value)?.puuid || ""
    if (keep === "a") selB.value = other
    else selA.value = other
  }
}

/* ── 基础指标 ── */
function winRate(p: ComparePlayer) {
  return p.gamesPlayed > 0 ? (p.wins / p.gamesPlayed) * 100 : 0
}
function weighted(p: ComparePlayer, fn: (cp: CompareChampProfile) => number) {
  const total = p.championProfiles.reduce((s, cp) => s + cp.games, 0)
  return total ? p.championProfiles.reduce((s, cp) => s + fn(cp) * cp.games, 0) / total : 0
}

/* ── 能力雷达叠加 ── */
const RADAR_DIMS = ["输出能力", "前排能力", "辅助能力", "KDA", "伤害占比", "分均伤害"] as const
const W = 340, H = 300
const CX = 170, CY = 150, RADIUS = 106

function clamp100(v: number) {
  return Math.max(0, Math.min(100, v))
}
function radarScores(p: ComparePlayer): number[] {
  const dmg = weighted(p, (cp) => cp.averageDamageShare)
  return [
    clamp100(p.profile.abilities.carry.averageScore),
    clamp100(p.profile.abilities.frontline.averageScore),
    clamp100(p.profile.abilities.support.averageScore),
    clamp100((p.overallKdaScore / 6) * 100),
    clamp100((dmg / 0.35) * 100),
    clamp100((p.avgDpm / 1000) * 100),
  ]
}
function radarRaw(p: ComparePlayer, i: number): string {
  switch (i) {
    case 0: return p.profile.abilities.carry.averageScore.toFixed(1)
    case 1: return p.profile.abilities.frontline.averageScore.toFixed(1)
    case 2: return p.profile.abilities.support.averageScore.toFixed(1)
    case 3: return p.overallKdaScore.toFixed(2)
    case 4: return (weighted(p, (cp) => cp.averageDamageShare) * 100).toFixed(1) + "%"
    default: return p.avgDpm.toFixed(0)
  }
}

function angle(i: number) {
  return -90 + i * 60
}
function vertex(i: number, v: number) {
  const rad = (angle(i) * Math.PI) / 180
  return {
    x: CX + RADIUS * Math.cos(rad) * (v / 100),
    y: CY + RADIUS * Math.sin(rad) * (v / 100),
  }
}
function ringPoints(f: number) {
  return RADAR_DIMS.map((_, i) => {
    const p = vertex(i, 100 * f)
    return `${p.x.toFixed(1)},${p.y.toFixed(1)}`
  }).join(" ")
}
function polyPoints(scores: number[]) {
  return RADAR_DIMS.map((_, i) => {
    const p = vertex(i, scores[i])
    return `${p.x.toFixed(1)},${p.y.toFixed(1)}`
  }).join(" ")
}
function labelPos(i: number) {
  const rad = (angle(i) * Math.PI) / 180
  const x = CX + (RADIUS + 20) * Math.cos(rad)
  const y = CY + (RADIUS + 20) * Math.sin(rad)
  let anchor = "middle"
  if (Math.cos(rad) > 0.25) anchor = "start"
  else if (Math.cos(rad) < -0.25) anchor = "end"
  return { x, y, anchor }
}

const radarA = computed(() => (playerA.value ? radarScores(playerA.value) : []))
const radarB = computed(() => (playerB.value ? radarScores(playerB.value) : []))
const radarPolyA = computed(() => polyPoints(radarA.value))
const radarPolyB = computed(() => polyPoints(radarB.value))
const radarRawA = computed(() => (playerA.value ? RADAR_DIMS.map((_, i) => radarRaw(playerA.value!, i)) : []))
const radarRawB = computed(() => (playerB.value ? RADAR_DIMS.map((_, i) => radarRaw(playerB.value!, i)) : []))
const hoveredDim = ref<number | null>(null)

/* ── 逐项指标对比 ── */
interface MetricDef {
  label: string
  get: (p: ComparePlayer) => number
  fmt: (v: number) => string
  reverse?: boolean
}
const METRICS: MetricDef[] = [
  { label: "综合分", get: (p) => p.profile.overallScore, fmt: (v) => v.toFixed(1) },
  { label: "中位分", get: (p) => p.profile.medianScore, fmt: (v) => v.toFixed(1) },
  { label: "胜率", get: winRate, fmt: (v) => v.toFixed(0) + "%" },
  { label: "KDA", get: (p) => p.overallKdaScore, fmt: (v) => v.toFixed(2) },
  { label: "场均击杀", get: (p) => p.avgKills, fmt: (v) => v.toFixed(1) },
  { label: "场均死亡", get: (p) => p.avgDeaths, fmt: (v) => v.toFixed(1), reverse: true },
  { label: "分均经济", get: (p) => p.avgGpm, fmt: (v) => v.toFixed(0) },
  { label: "分均伤害", get: (p) => p.avgDpm, fmt: (v) => v.toFixed(0) },
  { label: "参团率", get: (p) => p.avgKp * 100, fmt: (v) => v.toFixed(0) + "%" },
  { label: "伤害占比", get: (p) => weighted(p, (cp) => cp.averageDamageShare) * 100, fmt: (v) => v.toFixed(1) + "%" },
  { label: "承伤占比", get: (p) => weighted(p, (cp) => cp.averageMitigationShare) * 100, fmt: (v) => v.toFixed(1) + "%" },
  { label: "高光率", get: (p) => p.profile.highlightRate * 100, fmt: (v) => v.toFixed(0) + "%" },
]
interface MetricRow {
  label: string
  fa: string
  fb: string
  who: "a" | "b" | "tie"
  wa: string
  wb: string
}
const metricRows = computed<MetricRow[]>(() => {
  const a = playerA.value
  const b = playerB.value
  if (!a || !b) return []
  return METRICS.map((m) => {
    const va = m.get(a)
    const vb = m.get(b)
    const max = Math.max(va, vb, 0.0001)
    const who: "a" | "b" | "tie" = Math.abs(va - vb) < 1e-9 ? "tie" : (m.reverse ? va < vb : va > vb) ? "a" : "b"
    const width = (v: number) => (v > 0 ? Math.max((v / max) * 100, 2) : 0) + "%"
    return { label: m.label, fa: m.fmt(va), fb: m.fmt(vb), who, wa: width(va), wb: width(vb) }
  })
})

/* ── 交手记录 ── */
interface H2HRow {
  gameId: number
  gameCreation: number
  gameDuration: number
  sameTeam: boolean
  a: CompareGamePlayer
  b: CompareGamePlayer
  aWin: boolean
  aKillsB: number
  bKillsA: number
}
const headToHead = computed(() => {
  const a = playerA.value
  const b = playerB.value
  if (!a || !b) return null
  const rows: H2HRow[] = []
  for (const g of props.games) {
    const flat = g.teams.flatMap((t) => t.players)
    const pa = flat.find((p) => p.puuid === a.puuid)
    const pb = flat.find((p) => p.puuid === b.puuid)
    if (!pa || !pb) continue
    const teamA = g.teams.find((t) => t.players.some((p) => p.puuid === a.puuid))
    const sameTeam = !!teamA && teamA.players.some((p) => p.puuid === b.puuid)
    const aKillsB = pa.killRelations?.find((kr) => kr.victimPuuid === b.puuid)?.kills || 0
    const bKillsA = pb.killRelations?.find((kr) => kr.victimPuuid === a.puuid)?.kills || 0
    rows.push({ gameId: g.gameId, gameCreation: g.gameCreation, gameDuration: g.gameDuration, sameTeam, a: pa, b: pb, aWin: pa.win, aKillsB, bKillsA })
  }
  rows.sort((x, y) => y.gameCreation - x.gameCreation)
  const mate = rows.filter((r) => r.sameTeam)
  const opp = rows.filter((r) => !r.sameTeam)
  const pct = (games: number, wins: number) => (games > 0 ? ((wins / games) * 100).toFixed(0) + "%" : "-")
  return {
    total: rows.length,
    mateGames: mate.length,
    mateRate: pct(mate.length, mate.filter((r) => r.aWin).length),
    oppGames: opp.length,
    oppRate: pct(opp.length, opp.filter((r) => r.aWin).length),
    aKillsBTotal: rows.reduce((s, r) => s + r.aKillsB, 0),
    bKillsATotal: rows.reduce((s, r) => s + r.bKillsA, 0),
    recent: rows,
  }
})

/* ── 交手记录筛选：全部 / 对位 / 同队 ── */
const h2hFilter = ref<"all" | "mate" | "opp">("all")
const h2hFiltered = computed(() => {
  const h = headToHead.value
  if (!h) return []
  if (h2hFilter.value === "mate") return h.recent.filter((r) => r.sameTeam)
  if (h2hFilter.value === "opp") return h.recent.filter((r) => !r.sameTeam)
  return h.recent
})

/* ── 点击交手记录某局 → 弹出本局详细战绩（复用 GameDetailPopup，A/B 高亮） ── */
const detailGameId = ref<number | null>(null)
const detailRow = ref<H2HRow | null>(null)
function openH2hDetail(r: H2HRow) {
  detailRow.value = r
  detailGameId.value = r.gameId
}
const detailGame = computed(() =>
  detailGameId.value != null && props.matchById ? props.matchById.get(detailGameId.value) || null : null,
)
const detailHighlightPlayers = computed(() => {
  const row = detailRow.value
  if (!row) return []
  const a = playerA.value
  const b = playerB.value
  const out: { puuid: string; label: string }[] = []
  if (a) out.push({ puuid: a.puuid, label: "A" })
  if (b) out.push({ puuid: b.puuid, label: "B" })
  return out
})

function formatTime(ts: number) {
  return new Date(ts).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
}
</script>

<template>
  <div class="compare-section">
    <div class="compare-title-line" @click="toggleVisible">
      <component :is="visible ? ChevronDown : ChevronRight" :size="14" />
      <span class="section-title">选手对比</span>
      <span class="stat-subtitle">A vs B</span>
    </div>

    <div v-if="openedOnce" v-show="visible" class="compare-body">
      <div class="stat-header">
        <select v-model="selA" class="stat-search" style="width: 180px" @change="ensureDistinct('a')">
          <option v-for="r in players" :key="r.puuid" :value="r.puuid">{{ r.gameName }}（{{ r.gamesPlayed }}场）</option>
        </select>
        <span class="stat-subtitle">vs</span>
        <select v-model="selB" class="stat-search" style="width: 180px" @change="ensureDistinct('b')">
          <option v-for="r in players" :key="r.puuid" :value="r.puuid">{{ r.gameName }}（{{ r.gamesPlayed }}场）</option>
        </select>
      </div>

      <template v-if="playerA && playerB">
        <!-- 摘要卡 -->
        <div class="compare-grid">
          <div v-for="r in [playerA, playerB]" :key="r.puuid" class="compare-card">
            <div class="compare-name">{{ r.gameName }}#{{ r.tagLine }}</div>
            <div class="compare-row">场次 <b>{{ r.gamesPlayed }}</b></div>
            <div class="compare-row">胜场 <b>{{ r.wins }}</b></div>
            <div class="compare-row">胜率 <b :class="winRate(r) >= 50 ? 'good' : 'bad'">{{ winRate(r).toFixed(0) }}%</b></div>
            <div class="compare-row">均分 <b>{{ r.profile.overallScore.toFixed(1) }}</b></div>
            <div class="compare-row">中位分 <b>{{ r.profile.medianScore.toFixed(1) }}</b></div>
            <div class="compare-row">KDA <b>{{ r.overallKdaScore.toFixed(1) }}</b></div>
            <div class="compare-row">波动率 <b>{{ r.profile.volatility.toFixed(1) }}</b></div>
            <div class="compare-row">高光率 <b>{{ (r.profile.highlightRate * 100).toFixed(0) }}%</b></div>
            <div class="compare-row">战犯率 <b>{{ (r.profile.disasterRate * 100).toFixed(0) }}%</b></div>
            <div class="compare-row">输出/前排/辅助 <b>{{ r.profile.abilities.carry.averageScore.toFixed(0) }} / {{ r.profile.abilities.frontline.averageScore.toFixed(0) }} / {{ r.profile.abilities.support.averageScore.toFixed(0) }}</b></div>
            <div class="compare-row">伤害占比 <b>{{ (weighted(r, (cp) => cp.averageDamageShare) * 100).toFixed(0) }}%</b></div>
            <div class="compare-tags"><span v-for="tag in r.profile.tags.slice(0, 3)" :key="tag" class="mini-tag">{{ tag }}</span></div>
          </div>
        </div>

        <!-- 雷达 + 逐项指标 -->
        <div class="compare-visuals">
          <div class="compare-panel">
            <div class="panel-title">能力雷达</div>
            <svg :viewBox="`0 0 ${W} ${H}`" class="radar-svg">
              <polygon v-for="f in [0.25, 0.5, 0.75, 1]" :key="f" :points="ringPoints(f)" fill="none"
                :stroke="f === 1 ? '#4a4a4a' : 'rgba(255,255,255,0.07)'" stroke-width="1" />
              <line v-for="i in 6" :key="'axis' + i" :x1="CX" :y1="CY" :x2="vertex(i - 1, 100).x" :y2="vertex(i - 1, 100).y"
                stroke="rgba(255,255,255,0.07)" stroke-width="1" />
              <text v-for="(d, i) in RADAR_DIMS" :key="d" :x="labelPos(i).x" :y="labelPos(i).y"
                :text-anchor="labelPos(i).anchor" font-size="11" fill="#9ca3af">{{ d }}</text>
              <polygon v-if="radarA.length" :points="radarPolyA" fill="#6366f1" fill-opacity="0.15" stroke="#6366f1" stroke-width="2" stroke-linejoin="round" />
              <polygon v-if="radarB.length" :points="radarPolyB" fill="#f59e0b" fill-opacity="0.15" stroke="#f59e0b" stroke-width="2" stroke-linejoin="round" />
              <circle
                v-for="i in 6"
                :key="'hover' + i"
                :cx="vertex(i - 1, 100).x"
                :cy="vertex(i - 1, 100).y"
                r="14"
                fill="transparent"
                @mouseenter="hoveredDim = i - 1"
                @mouseleave="hoveredDim = null"
              />
            </svg>
            <div class="radar-dim-info">
              <template v-if="hoveredDim != null">
                <span class="dim-label">{{ RADAR_DIMS[hoveredDim] }}</span>
                <span class="dim-a">{{ playerA.gameName }}：<b>{{ radarRawA[hoveredDim] }}</b></span>
                <span class="dim-b">{{ playerB.gameName }}：<b>{{ radarRawB[hoveredDim] }}</b></span>
              </template>
              <span v-else class="dim-hint">悬停雷达顶点查看原始数值</span>
            </div>
            <div class="radar-legend">
              <span class="legend-item"><i class="dot a"></i>{{ playerA.gameName }}</span>
              <span class="legend-item"><i class="dot b"></i>{{ playerB.gameName }}</span>
            </div>
            <div class="panel-note">KDA 满分按 6、伤害占比满分按 35%、分均伤害满分按 1000 归一化</div>
          </div>

          <div class="compare-panel">
            <div class="panel-title">逐项指标对比</div>
            <div class="metric-list">
              <div v-for="row in metricRows" :key="row.label" class="metric-row">
                <span class="metric-label">{{ row.label }}</span>
                <div class="metric-track">
                  <div class="metric-bar a" :class="{ dim: row.who === 'b' }" :style="{ width: row.wa }"></div>
                  <div class="metric-bar b" :class="{ dim: row.who === 'a' }" :style="{ width: row.wb }"></div>
                </div>
                <span class="metric-val a" :class="{ dim: row.who === 'b' }">{{ row.fa }}</span>
                <span class="metric-val b" :class="{ dim: row.who === 'a' }">{{ row.fb }}</span>
              </div>
            </div>
            <div class="panel-note">条形按两人较大值归一化；较暗一侧为该项劣势方（场均死亡为反向指标）</div>
          </div>
        </div>

        <!-- 交手记录 -->
        <div class="compare-panel h2h-panel">
          <div class="panel-title">交手记录</div>
          <div v-if="headToHead && headToHead.total > 0" class="h2h-summary">
            <span>同队 <b>{{ headToHead.mateGames }}</b> 场 · 胜率 <b>{{ headToHead.mateRate }}</b>（共同胜负）</span>
            <span>对位 <b>{{ headToHead.oppGames }}</b> 场 · {{ playerA.gameName }} 胜率 <b>{{ headToHead.oppRate }}</b></span>
            <span class="h2h-kill-sum">对位击杀：{{ playerA.gameName }} → {{ playerB.gameName }} <b>{{ headToHead.aKillsBTotal }}</b> 次 · 反向 <b>{{ headToHead.bKillsATotal }}</b> 次</span>
            <span class="h2h-total">共同场 {{ headToHead.total }} 局</span>
          </div>
          <div v-else class="dim h2h-empty">两人未在同一局中出现</div>

          <div v-if="headToHead && headToHead.total > 0" class="h2h-filters">
            <button class="toggle-sub" :class="{ active: h2hFilter === 'all' }" @click="h2hFilter = 'all'">
              <span>全部（{{ headToHead.total }}）</span>
            </button>
            <button class="toggle-sub" :class="{ active: h2hFilter === 'opp' }" @click="h2hFilter = 'opp'">
              <span>对位（{{ headToHead.oppGames }}）</span>
            </button>
            <button class="toggle-sub" :class="{ active: h2hFilter === 'mate' }" @click="h2hFilter = 'mate'">
              <span>同队（{{ headToHead.mateGames }}）</span>
            </button>
          </div>

          <div v-if="h2hFiltered.length" class="h2h-list">
            <div
              v-for="r in h2hFiltered"
              :key="r.gameId"
              class="h2h-row"
              :class="{ clickable: !!matchById?.get(r.gameId) }"
              :title="matchById?.get(r.gameId) ? '点击查看本局详细战绩' : undefined"
              @click="matchById?.get(r.gameId) && openH2hDetail(r)"
            >
              <span class="h2h-date">{{ formatTime(r.gameCreation) }}</span>
              <span class="h2h-rel" :class="r.sameTeam ? 'mate' : 'opp'">{{ r.sameTeam ? '同队' : '对位' }}</span>
              <ChampionAvatar :champion-id="r.a.championId" :champions="champions" :size="20" />
              <span class="h2h-kda">{{ r.a.kills }}/{{ r.a.deaths }}/{{ r.a.assists }}</span>
              <span class="h2h-score">{{ r.a.gameScore }}</span>
              <span class="h2h-mid">{{ r.sameTeam ? '+' : 'vs' }}</span>
              <span class="h2h-score">{{ r.b.gameScore }}</span>
              <span class="h2h-kda">{{ r.b.kills }}/{{ r.b.deaths }}/{{ r.b.assists }}</span>
              <ChampionAvatar :champion-id="r.b.championId" :champions="champions" :size="20" />
              <span class="h2h-result" :class="r.aWin ? 'win' : 'loss'">{{ r.aWin ? '胜' : '负' }}</span>
              <span v-if="!r.sameTeam" class="h2h-kills" :title="`${playerA.gameName} 击杀 ${playerB.gameName} ${r.aKillsB} 次 / ${playerB.gameName} 击杀 ${playerA.gameName} ${r.bKillsA} 次`">杀 {{ r.aKillsB }}/{{ r.bKillsA }}</span>
              <span class="h2h-dur">{{ Math.round(r.gameDuration / 60) }}min</span>
              <ChevronRight v-if="matchById?.get(r.gameId)" :size="12" class="h2h-chev" />
            </div>
          </div>
          <div v-else-if="headToHead && headToHead.total > 0" class="dim h2h-empty">该筛选下无对局</div>
          <div v-if="headToHead && headToHead.total > 0" class="panel-note">共 {{ headToHead.total }} 局 · 结果为 {{ playerA.gameName }} 视角{{ matchById ? ' · 点击单局可查看本局详细战绩与击杀关系' : '' }}</div>
        </div>
      </template>

      <div v-else class="dim compare-empty">玩家不足，无法对比</div>
    </div>
  </div>

  <GameDetailPopup
    v-if="detailGame"
    :game="detailGame"
    :champions="champions"
    :item-map="itemMap"
    :spell-map="spellMap"
    :augment-map="augmentMap"
    :perk-map="perkMap"
    :highlight-players="detailHighlightPlayers"
    @close="detailGameId = null"
  />
</template>

<style scoped>
.compare-section { border-top: 1px solid var(--border, #333); padding-top: 6px; }
.compare-title-line { display: flex; align-items: center; gap: 6px; cursor: pointer; padding: 6px 0; user-select: none; }
.compare-title-line:hover { color: var(--accent, #6366f1); }
.compare-title-line .section-title { font-size: 14px; font-weight: 700; color: inherit; white-space: nowrap; }
.stat-subtitle { font-size: 12px; color: var(--text-muted, #888); }
.compare-body { margin-top: 8px; }
.stat-header { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.stat-search { padding: 5px 8px; background: var(--bg-tertiary, #2a2a2a); border: 1px solid var(--border, #444); border-radius: 4px; color: var(--text, #eee); font-size: 12px; outline: none; }
.compare-empty { padding: 16px 0; }

/* 摘要卡 */
.compare-grid { display: grid; grid-template-columns: repeat(2, minmax(240px, 1fr)); gap: 10px; margin-top: 10px; }
.compare-card { background: var(--bg-tertiary, #1e1e1e); border: 1px solid var(--border, #333); border-radius: 8px; padding: 10px 12px; }
.compare-name { font-size: 14px; font-weight: 700; color: #e5e7eb; margin-bottom: 8px; }
.compare-row { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; color: var(--text-muted, #aaa); padding: 2px 0; }
.compare-row b { color: var(--text, #ddd); font-variant-numeric: tabular-nums; }
.compare-row b.good { color: #4ade80; }
.compare-row b.bad { color: #f87171; }
.compare-tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
.mini-tag { display: inline-block; padding: 1px 5px; border-radius: 3px; font-size: 10px; font-weight: 600; background: rgba(255, 255, 255, 0.06); color: var(--text-muted, #aaa); white-space: nowrap; }

/* 雷达 + 逐项 */
.compare-visuals { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 12px; margin-top: 10px; }
.compare-panel { background: var(--bg-tertiary, #1e1e1e); border: 1px solid var(--border, #333); border-radius: 10px; padding: 12px 14px; }
.panel-title { font-size: 12px; font-weight: 700; color: #a5b4fc; margin-bottom: 10px; }
.panel-note { margin-top: 8px; font-size: 10px; color: var(--text-muted, #666); line-height: 1.5; }
.radar-svg { display: block; margin: 0 auto; }
.radar-dim-info { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; min-height: 22px; margin-top: 6px; font-size: 12px; }
.dim-label { font-weight: 700; color: #e5e7eb; }
.dim-a { color: #a5b4fc; }
.dim-b { color: #fcd34d; }
.dim-a b, .dim-b b { font-weight: 700; }
.dim-hint { color: var(--text-muted, #666); font-size: 11px; }
.radar-legend { display: flex; gap: 16px; margin-top: 6px; font-size: 12px; }
.legend-item { display: inline-flex; align-items: center; gap: 6px; color: var(--text, #ddd); }
.legend-item .dot { width: 10px; height: 10px; border-radius: 50%; }
.legend-item .dot.a { background: #6366f1; }
.legend-item .dot.b { background: #f59e0b; }

/* 逐项指标 */
.metric-list { display: flex; flex-direction: column; gap: 7px; }
.metric-row { display: flex; align-items: center; gap: 8px; }
.metric-label { width: 64px; text-align: right; font-size: 11px; color: var(--text-muted, #aaa); flex-shrink: 0; white-space: nowrap; }
.metric-track { flex: 1; height: 12px; background: var(--bg-secondary, #2a2a2a); border-radius: 3px; overflow: hidden; display: flex; }
.metric-bar { height: 100%; transition: width 0.3s; }
.metric-bar.a { background: #6366f1; }
.metric-bar.b { background: #f59e0b; }
.metric-bar.dim { opacity: 0.28; }
.metric-val { width: 46px; font-size: 11px; font-weight: 700; font-variant-numeric: tabular-nums; flex-shrink: 0; }
.metric-val.a { color: #a5b4fc; text-align: right; }
.metric-val.b { color: #fcd34d; }
.metric-val.dim { opacity: 0.45; font-weight: 400; }

/* 交手记录 */
.h2h-panel { margin-top: 12px; }
.h2h-summary { display: flex; gap: 18px; flex-wrap: wrap; font-size: 12px; color: var(--text-muted, #aaa); }
.h2h-summary b { color: #e5e7eb; }
.h2h-total { margin-left: auto; }
.h2h-empty { padding: 10px 0; font-size: 12px; }
.h2h-filters { display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap; }
.toggle-sub { display: inline-flex; align-items: center; justify-content: center; gap: 4px; padding: 5px 10px; background: #fff; border: 1px solid #d0d0d0; border-radius: 4px; color: #333; font-size: 11px; cursor: pointer; }
.toggle-sub:hover { border-color: var(--accent, #6366f1); color: var(--accent, #6366f1); }
.toggle-sub.active { background: var(--accent, #6366f1); border-color: var(--accent, #6366f1); color: #fff; }
.h2h-list { display: flex; flex-direction: column; gap: 4px; margin-top: 10px; max-height: 420px; overflow-y: auto; padding-right: 4px; }
.h2h-list::-webkit-scrollbar { width: 8px; }
.h2h-list::-webkit-scrollbar-thumb { background: #2e3742; border-radius: 4px; }
.h2h-row { display: flex; align-items: center; gap: 8px; padding: 4px 8px; background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.05); border-radius: 6px; font-size: 12px; flex-wrap: wrap; }
.h2h-row.clickable { cursor: pointer; transition: border-color 0.15s, background 0.15s; }
.h2h-row.clickable:hover { border-color: var(--accent, #6366f1); background: rgba(99, 102, 241, 0.08); }
.h2h-chev { margin-left: auto; color: var(--text-muted, #777); flex-shrink: 0; }
.h2h-date { color: var(--text-muted, #888); font-size: 11px; min-width: 86px; }
.h2h-rel { padding: 0 6px; border-radius: 3px; font-size: 10px; font-weight: 700; }
.h2h-rel.mate { background: rgba(99, 102, 241, 0.15); color: #a5b4fc; }
.h2h-rel.opp { background: rgba(251, 146, 60, 0.15); color: #fb923c; }
.h2h-kda { color: var(--text-muted, #ccc); font-variant-numeric: tabular-nums; }
.h2h-score { font-weight: 700; font-variant-numeric: tabular-nums; color: #e5e7eb; }
.h2h-mid { color: var(--text-muted, #666); font-weight: 700; }
.h2h-result { font-weight: 800; }
.h2h-result.win { color: #4ade80; }
.h2h-result.loss { color: #f87171; }
.h2h-kills { font-size: 11px; font-weight: 700; color: #fca5a5; font-variant-numeric: tabular-nums; }
.h2h-kill-sum b { color: #fca5a5; }
.h2h-dur { color: var(--text-muted, #777); font-size: 11px; margin-left: auto; }
.dim { color: var(--text-muted, #666); }
</style>

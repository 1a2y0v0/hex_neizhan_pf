<script setup lang="ts">
import { computed, ref } from "vue"
import { ChevronDown, ChevronRight } from "lucide-vue-next"
import type { ChampionSummaryItem } from "../types"
import { championName } from "../utils"

interface ChartGameRecord { championId: number; win: boolean }
interface ChartPlayer {
  puuid: string
  gameName: string
  tagLine: string
  gamesPlayed: number
  wins: number
  profile: { overallScore: number }
  gameRecords: ChartGameRecord[]
}

const props = defineProps<{
  players: ChartPlayer[]
  champions: Record<number, ChampionSummaryItem>
  blueWins: number
  redWins: number
}>()

const emit = defineEmits<{ (e: "focus-player", puuid: string): void }>()

const visible = ref(false)

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v))
}
function shortName(name: string) {
  return name.length > 8 ? name.slice(0, 8) + ".." : name
}
function winRate(p: ChartPlayer) {
  return p.gamesPlayed > 0 ? (p.wins / p.gamesPlayed) * 100 : 0
}
function scoreColor(s: number) {
  return s >= 80 ? "#4ade80" : s >= 60 ? "#60a5fa" : "#f87171"
}

/* ── 玩家综合分 ── */
const scoreRanking = computed(() =>
  [...props.players].sort((a, b) => b.profile.overallScore - a.profile.overallScore),
)

/* ── 玩家胜率榜 ── */
const winRateRanking = computed(() =>
  [...props.players].sort((a, b) => winRate(b) - winRate(a) || b.gamesPlayed - a.gamesPlayed),
)

/* ── 英雄出场 TOP ── */
interface ChampRow { championId: number; name: string; picks: number; wins: number }
const championTop = computed<ChampRow[]>(() => {
  const map = new Map<number, { picks: number; wins: number }>()
  for (const p of props.players) {
    for (const g of p.gameRecords) {
      const e = map.get(g.championId) || { picks: 0, wins: 0 }
      e.picks++
      if (g.win) e.wins++
      map.set(g.championId, e)
    }
  }
  return [...map.entries()]
    .map(([championId, v]) => ({
      championId,
      name: championName(props.champions, championId),
      picks: v.picks,
      wins: v.wins,
    }))
    .sort((a, b) => b.picks - a.picks)
    .slice(0, 10)
})
const champMaxPicks = computed(() => championTop.value[0]?.picks || 1)

/* ── 评分 × 胜率 散点图 ── */
const W = 340, H = 220
const PAD_L = 42, PAD_R = 12, PAD_T = 12, PAD_B = 28
const PLOT_W = W - PAD_L - PAD_R
const PLOT_H = H - PAD_T - PAD_B
const X_MIN = 40, X_MAX = 100, Y_MAX = 100
const X_TICKS = [40, 50, 60, 70, 80, 90, 100]
const Y_TICKS = [0, 20, 40, 60, 80, 100]

function px(score: number) {
  return PAD_L + ((clamp(score, X_MIN, X_MAX) - X_MIN) / (X_MAX - X_MIN)) * PLOT_W
}
function py(wr: number) {
  return PAD_T + PLOT_H - (clamp(wr, 0, Y_MAX) / Y_MAX) * PLOT_H
}

interface ScatterPoint { p: ChartPlayer; x: number; y: number; r: number; wr: number }
const scatterPoints = computed<ScatterPoint[]>(() =>
  props.players.map((p) => {
    const s = clamp(p.profile.overallScore, X_MIN, X_MAX)
    const wr = clamp(winRate(p), 0, Y_MAX)
    return {
      p,
      x: PAD_L + ((s - X_MIN) / (X_MAX - X_MIN)) * PLOT_W,
      y: PAD_T + PLOT_H - (wr / Y_MAX) * PLOT_H,
      r: Math.min(8, 3 + Math.sqrt(Math.max(p.gamesPlayed, 1)) * 0.55),
      wr,
    }
  }),
)

const scatterWrap = ref<HTMLDivElement | null>(null)
const scatterSvg = ref<SVGSVGElement | null>(null)
const scatterHover = ref<number | null>(null)
const scatterTooltip = ref<{ x: number; y: number } | null>(null)

function onScatterMove(e: MouseEvent) {
  const svg = scatterSvg.value
  const wrap = scatterWrap.value
  if (!svg || !wrap) return
  const srect = svg.getBoundingClientRect()
  const mx = ((e.clientX - srect.left) / srect.width) * W
  const my = ((e.clientY - srect.top) / srect.height) * H
  let best = -1
  let bestD = Infinity
  scatterPoints.value.forEach((pt, i) => {
    const d = Math.hypot(pt.x - mx, pt.y - my)
    if (d < bestD) { bestD = d; best = i }
  })
  scatterHover.value = bestD <= 12 ? best : null
  if (scatterHover.value != null) {
    const wrect = wrap.getBoundingClientRect()
    const left = Math.max(0, Math.min(e.clientX - wrect.left + 14, wrect.width - 220))
    const top = Math.max(0, Math.min(e.clientY - wrect.top + 12, wrect.height - 96))
    scatterTooltip.value = { x: left, y: top }
  }
}
function onScatterLeave() {
  scatterHover.value = null
  scatterTooltip.value = null
}
function onScatterClick() {
  if (scatterHover.value == null) return
  emit("focus-player", scatterPoints.value[scatterHover.value].p.puuid)
}

/* ── 蓝红方胜场 ── */
const sideTotal = computed(() => Math.max(props.blueWins + props.redWins, 1))
const bluePct = computed(() => Math.round((props.blueWins / sideTotal.value) * 100))
const redPct = computed(() => Math.round((props.redWins / sideTotal.value) * 100))
</script>

<template>
  <div class="charts-section">
    <div class="charts-header" @click="visible = !visible">
      <component :is="visible ? ChevronDown : ChevronRight" :size="14" />
      <span class="section-title">数据可视化</span>
    </div>

    <div v-show="visible" class="charts-body">
      <!-- 玩家综合分 -->
      <div class="chart-card">
        <div class="chart-title">玩家综合分</div>
        <div class="bar-chart-h">
          <div
            v-for="item in scoreRanking"
            :key="item.puuid"
            class="bar-row clickable"
            @click="emit('focus-player', item.puuid)"
          >
            <span class="bar-label" :title="item.gameName + '#' + item.tagLine">{{ shortName(item.gameName) }}</span>
            <div class="bar-track">
              <div class="bar-fill" :style="{ width: clamp(item.profile.overallScore, 0, 100) + '%', background: scoreColor(item.profile.overallScore) }"></div>
            </div>
            <span class="bar-value" :style="{ color: scoreColor(item.profile.overallScore) }">{{ item.profile.overallScore.toFixed(1) }}</span>
            <div class="chart-tip">
              <div class="ct-name">{{ item.gameName }}#{{ item.tagLine }}</div>
              <div class="ct-row">场次 <b>{{ item.gamesPlayed }}</b> · 胜率 <b>{{ winRate(item).toFixed(0) }}%</b></div>
              <div class="ct-row">综合分 <b>{{ item.profile.overallScore.toFixed(1) }}</b></div>
            </div>
          </div>
          <div v-if="!scoreRanking.length" class="chart-empty">暂无玩家数据</div>
        </div>
        <div class="chart-caption">点击条可查看该玩家详情</div>
      </div>

      <!-- 玩家胜率榜 -->
      <div class="chart-card">
        <div class="chart-title">玩家胜率榜</div>
        <div class="bar-chart-h">
          <div
            v-for="item in winRateRanking"
            :key="item.puuid"
            class="bar-row clickable"
            @click="emit('focus-player', item.puuid)"
          >
            <span class="bar-label" :title="item.gameName + '#' + item.tagLine">{{ shortName(item.gameName) }}</span>
            <div class="bar-track">
              <div class="bar-fill" :style="{ width: clamp(winRate(item), 0, 100) + '%', background: winRate(item) >= 50 ? '#4ade80' : '#f87171' }"></div>
            </div>
            <span class="bar-value" :style="{ color: winRate(item) >= 50 ? '#4ade80' : '#f87171' }">{{ winRate(item).toFixed(0) }}%</span>
            <div class="chart-tip">
              <div class="ct-name">{{ item.gameName }}#{{ item.tagLine }}</div>
              <div class="ct-row">胜场 <b>{{ item.wins }}</b> / 场次 <b>{{ item.gamesPlayed }}</b></div>
              <div class="ct-row">胜率 <b>{{ winRate(item).toFixed(0) }}%</b> · 均分 <b>{{ item.profile.overallScore.toFixed(1) }}</b></div>
            </div>
          </div>
          <div v-if="!winRateRanking.length" class="chart-empty">暂无玩家数据</div>
        </div>
        <div class="chart-caption">点击条可查看该玩家详情</div>
      </div>

      <!-- 英雄出场 TOP -->
      <div class="chart-card">
        <div class="chart-title">英雄出场 TOP</div>
        <div class="bar-chart-h">
          <div v-for="item in championTop" :key="item.championId" class="bar-row">
            <span class="bar-label" :title="item.name">{{ shortName(item.name) }}</span>
            <div class="bar-track">
              <div class="bar-fill" :style="{ width: (item.picks / champMaxPicks) * 100 + '%', background: '#818cf8' }"></div>
            </div>
            <span class="bar-value" style="color:#a5b4fc">{{ item.picks }}</span>
            <div class="chart-tip">
              <div class="ct-name">{{ item.name }}</div>
              <div class="ct-row">出场 <b>{{ item.picks }}</b> · 胜率 <b>{{ item.picks ? ((item.wins / item.picks) * 100).toFixed(0) + '%' : '-' }}</b></div>
            </div>
          </div>
          <div v-if="!championTop.length" class="chart-empty">暂无英雄数据</div>
        </div>
      </div>

      <!-- 评分 × 胜率 散点图 -->
      <div class="chart-card">
        <div class="chart-title">评分 × 胜率</div>
        <div
          ref="scatterWrap"
          class="scatter-wrap"
          @mousemove="onScatterMove"
          @mouseleave="onScatterLeave"
          @click="onScatterClick"
        >
          <svg ref="scatterSvg" :viewBox="`0 0 ${W} ${H}`" class="scatter-svg">
            <line v-for="ty in Y_TICKS" :key="'y' + ty" :x1="PAD_L" :y1="py(ty)" :x2="W - PAD_R" :y2="py(ty)" class="grid-line" />
            <line v-for="tx in X_TICKS" :key="'x' + tx" :x1="px(tx)" :y1="PAD_T" :x2="px(tx)" :y2="H - PAD_B" class="grid-line" />
            <text v-for="ty in Y_TICKS" :key="'yl' + ty" :x="PAD_L - 6" :y="py(ty) + 3" text-anchor="end" class="tick-label">{{ ty }}</text>
            <text v-for="tx in X_TICKS" :key="'xl' + tx" :x="px(tx)" :y="H - PAD_B + 14" text-anchor="middle" class="tick-label">{{ tx }}</text>
            <text :x="PAD_L - 32" :y="PAD_T + 4" class="axis-name">胜率%</text>
            <text :x="W - PAD_R" :y="H - PAD_B - 6" text-anchor="end" class="axis-name">综合分</text>
            <circle
              v-for="(pt, i) in scatterPoints"
              :key="pt.p.puuid"
              :cx="pt.x"
              :cy="pt.y"
              :r="scatterHover === i ? pt.r + 2 : pt.r"
              :fill="scoreColor(pt.p.profile.overallScore)"
              fill-opacity="0.72"
              :stroke="scatterHover === i ? '#ffffff' : 'rgba(255,255,255,0.35)'"
              :stroke-width="scatterHover === i ? 1.5 : 0.5"
              style="cursor: pointer"
            />
          </svg>
          <div v-if="scatterHover != null && scatterTooltip" class="scatter-tooltip" :style="{ left: scatterTooltip.x + 'px', top: scatterTooltip.y + 'px' }">
            <div class="ct-name">{{ scatterPoints[scatterHover].p.gameName }}#{{ scatterPoints[scatterHover].p.tagLine }}</div>
            <div class="ct-row">场次 <b>{{ scatterPoints[scatterHover].p.gamesPlayed }}</b>（气泡大小）</div>
            <div class="ct-row">综合分 <b>{{ scatterPoints[scatterHover].p.profile.overallScore.toFixed(1) }}</b> · 胜率 <b>{{ scatterPoints[scatterHover].wr.toFixed(0) }}%</b></div>
          </div>
          <div v-if="!scatterPoints.length" class="scatter-empty">暂无玩家数据</div>
        </div>
        <div class="chart-caption">横轴综合分 · 纵轴胜率 · 气泡大小=场次 · 点击可查看玩家详情</div>
      </div>

      <!-- 蓝红方胜场 -->
      <div class="chart-card">
        <div class="chart-title">蓝红方胜场</div>
        <div class="side-bars">
          <div class="side-row">
            <span class="side-label" style="color: #60a5fa">蓝方</span>
            <div class="side-track">
              <div class="side-fill blue" :style="{ width: bluePct + '%' }"></div>
            </div>
            <span class="side-val">{{ blueWins }} 胜 · {{ bluePct }}%</span>
          </div>
          <div class="side-row">
            <span class="side-label" style="color: #f87171">红方</span>
            <div class="side-track">
              <div class="side-fill red" :style="{ width: redPct + '%' }"></div>
            </div>
            <span class="side-val">{{ redWins }} 胜 · {{ redPct }}%</span>
          </div>
        </div>
        <div class="side-note">共 {{ blueWins + redWins }} 局（按对局列表首队为蓝、次队为红）</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.charts-section { border-top: 1px solid var(--border, #333); padding-top: 8px; }
.charts-header { display: flex; align-items: center; gap: 6px; cursor: pointer; padding: 6px 0; }
.charts-header:hover { color: var(--accent, #6366f1); }
.charts-header .section-title { font-size: 14px; font-weight: 700; color: inherit; white-space: nowrap; }
.charts-body { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 14px; padding: 12px 0; }

.chart-card { background: var(--bg-tertiary, #1e1e1e); border: 1px solid var(--border, #333); border-radius: 10px; padding: 12px 14px; }
.chart-title { font-size: 12px; font-weight: 600; color: var(--text-muted, #aaa); margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.3px; }
.chart-caption { margin-top: 8px; font-size: 10px; color: var(--text-muted, #666); }
.chart-empty { color: var(--text-muted, #666); font-size: 12px; padding: 12px 0; text-align: center; }

.bar-chart-h { display: flex; flex-direction: column; gap: 6px; }
.bar-row { position: relative; display: flex; align-items: center; gap: 8px; }
.bar-row.clickable { cursor: pointer; }
.bar-label { width: 64px; text-align: right; font-size: 11px; color: var(--text-muted, #aaa); flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bar-track { flex: 1; height: 14px; background: var(--bg-secondary, #2a2a2a); border-radius: 4px; overflow: hidden; }
.bar-fill { height: 100%; border-radius: 4px; transition: width 0.4s; min-width: 2px; }
.bar-value { width: 42px; text-align: left; font-size: 11px; font-weight: 700; font-variant-numeric: tabular-nums; flex-shrink: 0; }

.chart-tip { display: none; position: absolute; left: 50%; transform: translateX(-50%); top: calc(100% - 2px); z-index: 30; background: #1c1c24; border: 1px solid var(--border, #444); border-radius: 8px; padding: 8px 10px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45); white-space: nowrap; font-size: 11px; }
.bar-row:hover .chart-tip { display: block; }
.ct-name { font-size: 12px; font-weight: 700; color: #e5e7eb; margin-bottom: 4px; }
.ct-row { color: var(--text-muted, #aaa); line-height: 1.5; }
.ct-row b { color: #e5e7eb; font-weight: 700; }

.scatter-wrap { position: relative; }
.scatter-svg { display: block; width: 100%; }
.grid-line { stroke: rgba(255, 255, 255, 0.06); }
.tick-label { font-size: 9px; fill: #6b7280; }
.axis-name { font-size: 10px; fill: #9ca3af; }
.scatter-tooltip { position: absolute; z-index: 30; background: #1c1c24; border: 1px solid var(--border, #444); border-radius: 8px; padding: 8px 10px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45); pointer-events: none; font-size: 11px; white-space: nowrap; }
.scatter-empty { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: var(--text-muted, #666); font-size: 12px; pointer-events: none; }

.side-bars { display: flex; flex-direction: column; gap: 10px; }
.side-row { display: flex; align-items: center; gap: 8px; }
.side-label { width: 36px; font-size: 12px; font-weight: 700; flex-shrink: 0; }
.side-track { flex: 1; height: 18px; background: var(--bg-secondary, #2a2a2a); border-radius: 4px; overflow: hidden; }
.side-fill { height: 100%; border-radius: 4px; transition: width 0.4s; min-width: 2px; }
.side-fill.blue { background: linear-gradient(90deg, #3b82f6, #60a5fa); }
.side-fill.red { background: linear-gradient(90deg, #ef4444, #f87171); }
.side-val { font-size: 12px; font-weight: 700; font-variant-numeric: tabular-nums; width: 96px; color: var(--text, #ddd); flex-shrink: 0; }
.side-note { margin-top: 8px; font-size: 11px; color: var(--text-muted, #888); }
</style>

<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { ChevronDown, ChevronRight } from "lucide-vue-next"
import type { ChampionSummaryItem } from "../types"
import { championName } from "../utils"

interface TrendPoint {
  gameId: number
  championId: number
  kills: number
  deaths: number
  assists: number
  win: boolean
  gameDuration: number
  gameCreation: number
  score: number
  kda: number
  damageShare: number
  dpm: number
}
interface TrendPlayer {
  puuid: string
  gameName: string
  gamesPlayed: number
  trend: TrendPoint[]
}

const props = defineProps<{
  players: TrendPlayer[]
  champions: Record<number, ChampionSummaryItem>
}>()

const emit = defineEmits<{ (e: "focus-game", gameId: number): void }>()

const visible = ref(false)

/* ── 选择状态 ── */
const selPuuid = ref("")
watch(
  () => props.players,
  (list) => {
    if (!list.some((p) => p.puuid === selPuuid.value)) selPuuid.value = list[0]?.puuid || ""
  },
  { immediate: true },
)
const player = computed(() => props.players.find((p) => p.puuid === selPuuid.value) || props.players[0] || null)
const points = computed(() => player.value?.trend || [])

/* ── 指标 ── */
const METRICS = [
  { key: "score", label: "评分", minMax: 100, fmt: (v: number) => v.toFixed(0), tick: (v: number) => v.toFixed(0) },
  { key: "kda", label: "KDA", minMax: 10, fmt: (v: number) => v.toFixed(1), tick: (v: number) => v.toFixed(1) },
  { key: "damageShare", label: "伤害占比", minMax: 50, fmt: (v: number) => v.toFixed(1) + "%", tick: (v: number) => v.toFixed(0) + "%" },
  { key: "dpm", label: "分均伤害", minMax: 1000, fmt: (v: number) => v.toFixed(0), tick: (v: number) => v.toFixed(0) },
] as const
type MetricKey = (typeof METRICS)[number]["key"]
const metricKey = ref<MetricKey>("score")
const metric = computed(() => METRICS.find((m) => m.key === metricKey.value)!)

function valueOf(p: TrendPoint, key: MetricKey) {
  return key === "score" ? p.score : key === "kda" ? p.kda : key === "damageShare" ? p.damageShare * 100 : p.dpm
}

/** 纵轴上限：取当前玩家该指标最大值，按 1/2/5×10ⁿ 向上取整，保证刻度整洁且不被数据顶格。 */
const metricMax = computed(() => {
  const m = metric.value
  const maxVal = points.value.reduce((acc: number, p) => Math.max(acc, valueOf(p, metricKey.value)), m.minMax as number)
  const mag = Math.pow(10, Math.floor(Math.log10(maxVal)))
  const norm = maxVal / mag
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10
  return nice * mag
})

/* ── 图表几何 ── */
const W = 780, H = 250
const PAD_L = 48, PAD_R = 14, PAD_T = 16, PAD_B = 32
const PLOT_W = W - PAD_L - PAD_R
const PLOT_H = H - PAD_T - PAD_B

function xAt(i: number, n: number) {
  return n > 1 ? PAD_L + (i / (n - 1)) * PLOT_W : PAD_L + PLOT_W / 2
}
function yAt(v: number) {
  return PAD_T + PLOT_H - Math.min(Math.max(v / metricMax.value, 0), 1) * PLOT_H
}
const TICKS = computed(() => [0, 1, 2, 3, 4, 5].map((t) => (metricMax.value / 5) * t))
const xLabels = computed(() => {
  const n = points.value.length
  const step = Math.max(1, Math.ceil(n / 10))
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    if (i % step === 0 || i === n - 1) out.push(i)
  }
  return out
})

const linePoints = computed(() =>
  points.value.map((p, i) => `${xAt(i, points.value.length).toFixed(1)},${yAt(valueOf(p, metricKey.value)).toFixed(1)}`).join(" "),
)
const maPoints = computed(() => {
  const n = points.value.length
  return points.value
    .map((_, i) => {
      const slice = points.value.slice(Math.max(0, i - 4), i + 1)
      const avg = slice.reduce((s, p) => s + valueOf(p, metricKey.value), 0) / slice.length
      return `${xAt(i, n).toFixed(1)},${yAt(avg).toFixed(1)}`
    })
    .join(" ")
})

/* ── 悬停 / 点击交互 ── */
const chartWrap = ref<HTMLDivElement | null>(null)
const chartSvg = ref<SVGSVGElement | null>(null)
const hoverIdx = ref<number | null>(null)
const tooltipPos = ref<{ x: number; y: number } | null>(null)

function onMove(e: MouseEvent) {
  const svg = chartSvg.value
  const wrap = chartWrap.value
  const n = points.value.length
  if (!svg || !wrap || n === 0) return
  const rect = svg.getBoundingClientRect()
  const mx = ((e.clientX - rect.left) / rect.width) * W
  const idx = Math.round(((mx - PAD_L) / PLOT_W) * (n - 1))
  hoverIdx.value = Math.max(0, Math.min(n - 1, idx))
  const wrect = wrap.getBoundingClientRect()
  const left = Math.max(0, Math.min(e.clientX - wrect.left + 14, wrect.width - 240))
  const top = Math.max(0, Math.min(e.clientY - wrect.top + 12, wrect.height - 130))
  tooltipPos.value = { x: left, y: top }
}
function onLeave() {
  hoverIdx.value = null
  tooltipPos.value = null
}
function onClickChart() {
  if (hoverIdx.value == null) return
  const p = points.value[hoverIdx.value]
  if (p) emit("focus-game", p.gameId)
}

const hoveredPoint = computed(() => (hoverIdx.value != null ? points.value[hoverIdx.value] || null : null))
const guideX = computed(() => (hoverIdx.value != null ? xAt(hoverIdx.value, points.value.length) : 0))

/* ── 副标题数据 ── */
const recentAvg = computed(() => {
  const last = points.value.slice(-5)
  return last.length ? last.reduce((s, p) => s + p.score, 0) / last.length : 0
})
const streak = computed(() => {
  const pts = points.value
  if (!pts.length) return 0
  let s = 0
  const lastWin = pts[pts.length - 1].win
  for (let i = pts.length - 1; i >= 0; i--) {
    if (pts[i].win === lastWin) s++
    else break
  }
  return lastWin ? s : -s
})
const streakText = computed(() =>
  streak.value > 0 ? `${streak.value} 连胜` : streak.value < 0 ? `${-streak.value} 连败` : "无连态",
)

function formatTime(ts: number) {
  return new Date(ts).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
}
</script>

<template>
  <div class="trend-section">
    <div class="trend-title-line" @click="visible = !visible">
      <component :is="visible ? ChevronDown : ChevronRight" :size="14" />
      <span class="section-title">玩家状态趋势</span>
      <span class="stat-subtitle">最近 5 局均分 {{ recentAvg.toFixed(1) }} · 当前 {{ streakText }}</span>
    </div>

    <div v-show="visible" class="trend-body">
      <div class="stat-header">
        <select v-model="selPuuid" class="stat-search" style="width: 180px; cursor: pointer">
          <option v-for="r in players" :key="r.puuid" :value="r.puuid">{{ r.gameName }}（{{ r.gamesPlayed }}场）</option>
        </select>
        <select v-model="metricKey" class="stat-search" style="width: 120px; cursor: pointer" title="切换纵轴指标">
          <option v-for="m in METRICS" :key="m.key" :value="m.key">{{ m.label }}</option>
        </select>
      </div>

      <div
        v-if="points.length > 1"
        ref="chartWrap"
        class="trend-chart"
        @mousemove="onMove"
        @mouseleave="onLeave"
        @click="onClickChart"
      >
        <svg ref="chartSvg" :viewBox="`0 0 ${W} ${H}`" class="trend-svg">
          <line v-for="t in TICKS" :key="'g' + t" :x1="PAD_L" :y1="yAt(t)" :x2="W - PAD_R" :y2="yAt(t)" class="grid-line" />
          <text v-for="t in TICKS" :key="'t' + t" :x="PAD_L - 6" :y="yAt(t) + 3" text-anchor="end" class="tick-label">{{ metric.tick(t) }}</text>
          <text :x="2" :y="PAD_T - 5" class="axis-name">纵轴 · {{ metric.label }}</text>
          <text :x="W - PAD_R" :y="H - 4" text-anchor="end" class="axis-name">横轴 · 对局序号</text>
          <text v-for="i in xLabels" :key="'x' + i" :x="xAt(i, points.length)" :y="H - PAD_B + 16" text-anchor="middle" class="tick-label">{{ i + 1 }}</text>

          <polyline :points="maPoints" fill="none" stroke="#f59e0b" stroke-width="1.5" stroke-dasharray="5 4" />
          <polyline :points="linePoints" fill="none" stroke="#a5b4fc" stroke-width="2" />

          <circle
            v-for="(p, i) in points"
            :key="p.gameId"
            :cx="xAt(i, points.length)"
            :cy="yAt(valueOf(p, metricKey))"
            :r="hoverIdx === i ? 6 : 3.5"
            :fill="p.win ? '#4ade80' : '#f87171'"
            :stroke="hoverIdx === i ? '#ffffff' : 'none'"
            :stroke-width="hoverIdx === i ? 1.5 : 0"
          />
          <line v-if="hoverIdx != null" :x1="guideX" :y1="PAD_T" :x2="guideX" :y2="H - PAD_B" stroke="rgba(255,255,255,0.28)" stroke-dasharray="3 3" />
        </svg>

        <div v-if="hoveredPoint && tooltipPos" class="trend-tooltip" :style="{ left: tooltipPos.x + 'px', top: tooltipPos.y + 'px' }">
          <div class="tt-name">{{ championName(champions, hoveredPoint.championId) }}</div>
          <div class="tt-row">{{ formatTime(hoveredPoint.gameCreation) }} · {{ Math.round(hoveredPoint.gameDuration / 60) }}min</div>
          <div class="tt-row">KDA {{ hoveredPoint.kills }}/{{ hoveredPoint.deaths }}/{{ hoveredPoint.assists }} · <b :class="hoveredPoint.win ? 'win' : 'loss'">{{ hoveredPoint.win ? '胜' : '负' }}</b></div>
          <div class="tt-row">{{ metric.label }} <b>{{ metric.fmt(valueOf(hoveredPoint, metricKey)) }}</b> · 评分 <b>{{ hoveredPoint.score.toFixed(0) }}</b></div>
          <div class="tt-hint">点击跳转到该对局</div>
        </div>
      </div>
      <div v-else class="dim trend-empty">对局不足，暂无趋势</div>

      <div class="trend-legend">
        <span><i class="dot win"></i>胜</span>
        <span><i class="dot loss"></i>负</span>
        <span class="ma">虚线 = 近 5 局均线</span>
        <span class="hint">横轴为按时间排序的对局序号 · 悬停查看详情 · 点击跳转对局</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.trend-section { border-top: 1px solid var(--border, #333); padding-top: 6px; }
.trend-title-line { display: flex; align-items: center; gap: 6px; cursor: pointer; padding: 6px 0; user-select: none; }
.trend-title-line:hover { color: var(--accent, #6366f1); }
.trend-title-line .section-title { font-size: 14px; font-weight: 700; color: inherit; white-space: nowrap; }
.stat-subtitle { font-size: 12px; color: var(--text-muted, #888); }
.trend-body { margin-top: 8px; }
.stat-header { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.stat-search { padding: 5px 8px; background: var(--bg-tertiary, #2a2a2a); border: 1px solid var(--border, #444); border-radius: 4px; color: var(--text, #eee); font-size: 12px; outline: none; }

.trend-chart { position: relative; margin-top: 10px; background: var(--bg-tertiary, #1e1e1e); border: 1px solid var(--border, #333); border-radius: 8px; padding: 10px; cursor: crosshair; }
.trend-svg { display: block; width: 100%; }
.grid-line { stroke: rgba(255, 255, 255, 0.06); }
.tick-label { font-size: 9px; fill: #6b7280; }
.axis-name { font-size: 10px; fill: #9ca3af; }

.trend-tooltip { position: absolute; z-index: 30; background: #1c1c24; border: 1px solid var(--border, #444); border-radius: 8px; padding: 8px 10px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45); pointer-events: none; font-size: 11px; min-width: 180px; }
.tt-name { font-size: 12px; font-weight: 700; color: #e5e7eb; margin-bottom: 3px; }
.tt-row { color: var(--text-muted, #aaa); line-height: 1.6; }
.tt-row b { color: #e5e7eb; font-weight: 700; }
.tt-row b.win { color: #4ade80; }
.tt-row b.loss { color: #f87171; }
.tt-hint { margin-top: 3px; color: #818cf8; font-size: 10px; }

.trend-empty { padding: 16px 0; text-align: center; }
.trend-legend { display: flex; align-items: center; gap: 14px; margin-top: 8px; font-size: 11px; color: var(--text-muted, #888); flex-wrap: wrap; }
.trend-legend .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 4px; vertical-align: middle; }
.trend-legend .dot.win { background: #4ade80; }
.trend-legend .dot.loss { background: #f87171; }
.trend-legend .ma { color: #f59e0b; }
.trend-legend .hint { margin-left: auto; }
.dim { color: var(--text-muted, #666); }
</style>

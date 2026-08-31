<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue"
import { Check, ChevronDown, ChevronRight, ChevronUp, ImageDown, Minus, Plus, UserRound, X } from "lucide-vue-next"
import { copyElementAsPng } from "../imageShare"

interface RadarAbility { averageScore: number }
interface RadarChampProfile { games: number; averageDamageShare: number; averageMitigationShare: number }
interface RadarPlayerProfile {
  overallScore: number
  volatility: number
  highlightRate: number
  abilities: { carry: RadarAbility; frontline: RadarAbility; support: RadarAbility }
}
interface RadarPlayer {
  puuid: string
  gameName: string
  tagLine: string
  gamesPlayed: number
  wins: number
  avgKills: number
  avgDeaths: number
  avgAssists: number
  overallKdaScore: number
  profile: RadarPlayerProfile
  championProfiles: RadarChampProfile[]
  assistLeaderCount: number
  damageLeaderCount: number
  mitigationLeaderCount: number
}

const props = defineProps<{ players: RadarPlayer[] }>()

const DIMS = [
  { key: "output", label: "输出能力" },
  { key: "tank", label: "承伤坦度" },
  { key: "team", label: "团队功能" },
  { key: "stable", label: "团战稳定" },
  { key: "kill", label: "击杀收割" },
  { key: "win", label: "胜负贡献" },
] as const
type DimKey = (typeof DIMS)[number]["key"]

const PALETTE = ["#f87171", "#60a5fa", "#4ade80", "#facc15", "#c084fc", "#2dd4bf", "#fb923c", "#818cf8", "#34d399", "#e879f9", "#38bdf8", "#a3e635"]
const DASH_PATTERNS: (string | null)[] = [null, "4 3", "10 5", "8 4 2 4"]

type SizeKey = "small" | "medium" | "large"
const SIZE_OPTIONS: { key: SizeKey; label: string }[] = [
  { key: "small", label: "小" },
  { key: "medium", label: "中" },
  { key: "large", label: "大" },
]
const SIZE_CONFIG: Record<SizeKey, { w: number; h: number; radius: number; font: number; labelOffset: number; statusFont: number }> = {
  small: { w: 360, h: 320, radius: 104, font: 11, labelOffset: 16, statusFont: 11 },
  medium: { w: 480, h: 430, radius: 150, font: 12, labelOffset: 24, statusFont: 12 },
  large: { w: 660, h: 540, radius: 195, font: 13, labelOffset: 28, statusFont: 13 },
}

function loadSavedSize(): SizeKey {
  try {
    const saved = localStorage.getItem("radarCanvasSize")
    if (saved === "small" || saved === "medium" || saved === "large") return saved
  } catch { /* ignore */ }
  return "medium"
}

const radarVisible = ref(false)
const showAvgRadar = ref(true)
const size = ref<SizeKey>(loadSavedSize())
const singleMode = ref(false)
const outlineOnly = ref(false)
const thresholdInput = ref("1")
const threshold = ref(1)
const thresholdError = ref("")
const selectedPuuids = ref<Set<string>>(new Set())
const dropdownOpen = ref(false)
const dropdownRoot = ref<HTMLDivElement | null>(null)
const hovered = ref<{ puuid: string; x: number; y: number } | null>(null)
const legendHover = ref<string | null>(null)
const canvasWrap = ref<HTMLDivElement | null>(null)
const exportRef = ref<HTMLDivElement | null>(null)
const exporting = ref(false)
const exportMsg = ref("")

watch(size, (v) => {
  try { localStorage.setItem("radarCanvasSize", v) } catch { /* ignore */ }
})

const cfg = computed(() => SIZE_CONFIG[size.value])
const W = computed(() => cfg.value.w)
const H = computed(() => cfg.value.h)
const RADIUS = computed(() => cfg.value.radius)
const CX = computed(() => cfg.value.w / 2)
const CY = computed(() => cfg.value.h / 2)

function clamp(v: number, min = 0, max = 100) { return Math.max(min, Math.min(max, v)) }
function weightedProp(p: RadarPlayer, fn: (cp: RadarChampProfile) => number): number {
  const total = p.championProfiles.reduce((s, cp) => s + cp.games, 0)
  return total ? p.championProfiles.reduce((s, cp) => s + fn(cp) * cp.games, 0) / total : 0
}

function radarScores(p: RadarPlayer): Record<DimKey, number> {
  const dmgShare = weightedProp(p, (cp) => cp.averageDamageShare)
  const mitShare = weightedProp(p, (cp) => cp.averageMitigationShare)
  const winRate = p.gamesPlayed ? p.wins / p.gamesPlayed : 0
  return {
    output: clamp(p.profile.abilities.carry.averageScore * 0.7 + Math.min(dmgShare / 0.3, 1) * 30),
    tank: clamp(p.profile.abilities.frontline.averageScore * 0.7 + Math.min(mitShare / 0.3, 1) * 30),
    team: clamp(p.profile.abilities.support.averageScore * 0.55 + Math.min(p.avgAssists / 10, 1) * 30 + Math.min(p.assistLeaderCount / Math.max(p.gamesPlayed, 1), 1) * 15),
    stable: clamp((100 - p.profile.volatility * 2) * 0.7 + Math.min(p.profile.highlightRate * 100, 100) * 0.3),
    kill: clamp(Math.min(p.avgKills / 8, 1) * 60 + Math.min(p.overallKdaScore * 4, 40)),
    win: clamp(winRate * 100 * 0.6 + p.profile.overallScore * 0.4),
  }
}

const qualifiedPlayers = computed(() => {
  return [...props.players]
    .filter((p) => p.gamesPlayed >= threshold.value)
    .sort((a, b) => b.gamesPlayed - a.gamesPlayed || b.profile.overallScore - a.profile.overallScore)
})

const playerColors = computed(() => {
  const map = new Map<string, string>()
  qualifiedPlayers.value.forEach((p, i) => map.set(p.puuid, PALETTE[i % PALETTE.length]))
  return map
})

function playerColor(p: RadarPlayer): string {
  return playerColors.value.get(p.puuid) || "#94a3b8"
}

function dashFor(index: number): string | undefined {
  return DASH_PATTERNS[index % DASH_PATTERNS.length] || undefined
}

const avgScores = computed<Record<DimKey, number> | null>(() => {
  const q = qualifiedPlayers.value
  if (!q.length) return null
  const sums: Record<DimKey, number> = { output: 0, tank: 0, team: 0, stable: 0, kill: 0, win: 0 }
  for (const p of q) {
    const s = radarScores(p)
    for (const dim of DIMS) sums[dim.key] += s[dim.key]
  }
  const avg = {} as Record<DimKey, number>
  for (const dim of DIMS) avg[dim.key] = sums[dim.key] / q.length
  return avg
})

const selectedPlayers = computed(() => qualifiedPlayers.value.filter((p) => selectedPuuids.value.has(p.puuid)))

function pruneSelections() {
  const q = new Set(qualifiedPlayers.value.map((p) => p.puuid))
  selectedPuuids.value = new Set([...selectedPuuids.value].filter((id) => q.has(id)))
}

function applyThreshold() {
  const raw = thresholdInput.value.trim()
  if (!/^\d+$/.test(raw) || parseInt(raw, 10) < 1) {
    thresholdError.value = "请输入不小于 1 的整数"
    setTimeout(() => { thresholdError.value = "" }, 3000)
    return
  }
  const v = parseInt(raw, 10)
  threshold.value = v
  thresholdInput.value = String(v)
  pruneSelections()
}

function clearThreshold() {
  threshold.value = 1
  thresholdInput.value = "1"
}

function stepThreshold(delta: number) {
  const current = parseInt(thresholdInput.value, 10)
  const next = (Number.isFinite(current) ? current : threshold.value) + delta
  if (next < 1) return
  thresholdInput.value = String(next)
}

function togglePlayer(puuid: string) {
  const s = new Set(selectedPuuids.value)
  if (singleMode.value) {
    if (s.has(puuid)) s.delete(puuid)
    else { s.clear(); s.add(puuid) }
  } else {
    if (s.has(puuid)) s.delete(puuid); else s.add(puuid)
  }
  selectedPuuids.value = s
}

function selectAll() {
  if (singleMode.value) {
    const first = qualifiedPlayers.value[0]
    selectedPuuids.value = new Set(first ? [first.puuid] : [])
    return
  }
  selectedPuuids.value = new Set(qualifiedPlayers.value.map((p) => p.puuid))
}

function clearAll() {
  selectedPuuids.value = new Set()
}

function toggleSingleMode() {
  singleMode.value = !singleMode.value
  if (singleMode.value && selectedPuuids.value.size > 1) {
    const first = qualifiedPlayers.value.find((p) => selectedPuuids.value.has(p.puuid))
    selectedPuuids.value = new Set(first ? [first.puuid] : [])
  }
}

function axisAngle(i: number) { return -90 + i * 60 }

function pt(angleDeg: number, value: number, radius: number): string {
  const rad = (angleDeg * Math.PI) / 180
  const x = CX.value + radius * Math.cos(rad) * (value / 100)
  const y = CY.value + radius * Math.sin(rad) * (value / 100)
  return `${x.toFixed(1)},${y.toFixed(1)}`
}

function ringPoints(factor: number): string {
  return DIMS.map((_, i) => pt(axisAngle(i), 100 * factor, RADIUS.value)).join(" ")
}

function layerPoints(scores: Record<DimKey, number>): string {
  return DIMS.map((dim, i) => pt(axisAngle(i), scores[dim.key], RADIUS.value)).join(" ")
}

function labelPos(i: number) {
  const rad = (axisAngle(i) * Math.PI) / 180
  const x = CX.value + (RADIUS.value + cfg.value.labelOffset) * Math.cos(rad)
  const y = CY.value + (RADIUS.value + cfg.value.labelOffset) * Math.sin(rad)
  let anchor = "middle"
  if (Math.cos(rad) > 0.25) anchor = "start"
  else if (Math.cos(rad) < -0.25) anchor = "end"
  return { x, y, anchor }
}

function axisLine(i: number) {
  const p = pt(axisAngle(i), 100, RADIUS.value).split(",")
  return { x1: CX.value, y1: CY.value, x2: parseFloat(p[0]), y2: parseFloat(p[1]) }
}

function onRadarMove(e: MouseEvent, puuid: string) {
  const rect = canvasWrap.value?.getBoundingClientRect()
  if (!rect) return
  hovered.value = { puuid, x: e.clientX - rect.left, y: e.clientY - rect.top }
}

function onRadarLeave() { hovered.value = null }

function onDocClick(e: MouseEvent) {
  const root = dropdownRoot.value
  if (!root) return
  if (!root.contains(e.target as Node)) dropdownOpen.value = false
}

onMounted(() => document.addEventListener("click", onDocClick))
onUnmounted(() => document.removeEventListener("click", onDocClick))

function hoveredPlayer() {
  return selectedPlayers.value.find((p) => p.puuid === hovered.value?.puuid) || null
}

function isDimmed(p: RadarPlayer) {
  return !!legendHover.value && legendHover.value !== p.puuid
}

async function exportRadar() {
  if (exporting.value) return
  exporting.value = true
  exportMsg.value = ""
  const prevSize = size.value
  const prevOutline = outlineOnly.value
  size.value = "large"
  outlineOnly.value = true
  await nextTick()
  await document.fonts?.ready
  await new Promise((r) => setTimeout(r, 120))
  try {
    await copyElementAsPng(exportRef.value!, { backgroundColor: "#14141a", pixelRatio: 2 })
    exportMsg.value = "已导出并复制到剪贴板"
  } catch (e) {
    exportMsg.value = e instanceof Error ? e.message : String(e)
  } finally {
    size.value = prevSize
    outlineOnly.value = prevOutline
    exporting.value = false
    setTimeout(() => { exportMsg.value = "" }, 3000)
  }
}

const statusText = computed(() => {
  const q = qualifiedPlayers.value
  const avgState = showAvgRadar.value
    ? `平均基准由${q.length}名达标玩家计算生成`
    : "平均基准已隐藏"
  return `当前筛选：仅展示对局≥${threshold.value}场玩家，${avgState}`
})
</script>

<template>
  <div class="radar-section">
    <div class="radar-header" @click="radarVisible = !radarVisible">
      <component :is="radarVisible ? ChevronDown : ChevronRight" :size="14" />
      <span class="section-title">玩家能力雷达</span>
      <span class="radar-header-count" v-if="selectedPlayers.length">已选 {{ selectedPlayers.length }} 人</span>
    </div>

    <div v-show="radarVisible && !exporting" class="radar-body">
      <div ref="canvasWrap" class="radar-canvas-wrap">
        <svg :width="W" :height="H" class="radar-svg">
          <g v-for="factor in [0.25, 0.5, 0.75, 1]" :key="factor">
            <polygon :points="ringPoints(factor)" fill="none"
              :stroke="factor === 1 ? '#4a4a4a' : 'rgba(255,255,255,0.07)'" stroke-width="1" />
          </g>
          <line v-for="i in 6" :key="'axis' + i" v-bind="axisLine(i - 1)" stroke="rgba(255,255,255,0.07)" stroke-width="1" />
          <text v-for="(dim, i) in DIMS" :key="dim.key" :x="labelPos(i).x" :y="labelPos(i).y"
            :text-anchor="labelPos(i).anchor" :font-size="cfg.font" fill="#9ca3af" class="radar-axis-label">{{ dim.label }}</text>

          <polygon v-if="showAvgRadar && avgScores" :points="layerPoints(avgScores)"
            fill="none" stroke="#9ca3af" stroke-width="1.5" stroke-dasharray="6 4" />

          <g v-for="(p, pi) in selectedPlayers" :key="p.puuid"
            :opacity="isDimmed(p) ? 0.1 : 1"
            @mouseenter="onRadarMove($event, p.puuid)" @mousemove="onRadarMove($event, p.puuid)" @mouseleave="onRadarLeave">
            <polygon :points="layerPoints(radarScores(p))"
              :fill="outlineOnly ? 'none' : playerColor(p)"
              :fill-opacity="legendHover === p.puuid ? 0.3 : 0.15"
              :stroke="playerColor(p)"
              :stroke-width="legendHover === p.puuid ? 4 : 2"
              :stroke-dasharray="legendHover === p.puuid ? undefined : dashFor(pi)"
              stroke-linejoin="round" class="radar-player-poly" />
          </g>
        </svg>

        <div v-if="qualifiedPlayers.length === 0" class="radar-empty">当前场次阈值过高，无符合条件玩家</div>

        <div v-if="hoveredPlayer() && hovered" class="radar-tooltip" :style="{ left: hovered.x + 14 + 'px', top: hovered.y + 10 + 'px' }">
          <div class="rt-name" :style="{ color: playerColor(hoveredPlayer()!) }">{{ hoveredPlayer()!.gameName }}<em>#{{ hoveredPlayer()!.tagLine }}</em></div>
          <div v-for="dim in DIMS" :key="dim.key" class="rt-row">
            <span class="rt-label">{{ dim.label }}</span>
            <span class="rt-val">{{ radarScores(hoveredPlayer()!)[dim.key].toFixed(1) }}</span>
            <span class="rt-avg" v-if="avgScores">均值 {{ avgScores[dim.key].toFixed(1) }}</span>
          </div>
        </div>
      </div>

      <div class="radar-controls">
        <button class="toggle-sub" :class="{ active: showAvgRadar }" @click="showAvgRadar = !showAvgRadar">
          <component :is="showAvgRadar ? Check : X" :size="14" />
          <span>显示全员平均雷达</span>
        </button>

        <div class="size-group">
          <span class="size-label">雷达画布尺寸</span>
          <div class="size-options">
            <label v-for="opt in SIZE_OPTIONS" :key="opt.key" class="size-opt" :class="{ active: size === opt.key }">
              <input type="radio" name="radar-size" :value="opt.key" v-model="size" />
              {{ opt.label }}
            </label>
          </div>
        </div>

        <div class="threshold-group">
          <span class="threshold-label">最低参赛场次阈值</span>
          <div class="threshold-input-row">
            <button class="step-btn" @click="stepThreshold(-1)" :disabled="parseInt(thresholdInput, 10) <= 1"><Minus :size="12" /></button>
            <input v-model="thresholdInput" type="number" min="1" step="1" class="num-input" @keydown.enter="applyThreshold" />
            <button class="step-btn" @click="stepThreshold(1)"><Plus :size="12" /></button>
          </div>
          <div class="threshold-actions">
            <button class="btn-mini primary" @click="applyThreshold">应用场次筛选</button>
            <button class="btn-mini" @click="clearThreshold">清除场次限制</button>
          </div>
          <div v-if="thresholdError" class="threshold-error">{{ thresholdError }}</div>
        </div>

        <div class="player-dropdown" ref="dropdownRoot">
          <button class="dropdown-trigger" @click="dropdownOpen = !dropdownOpen">
            <span>{{ singleMode ? '单人对比' : '选择玩家' }} ({{ selectedPlayers.length }})</span>
            <component :is="dropdownOpen ? ChevronUp : ChevronDown" :size="14" />
          </button>
          <div v-if="dropdownOpen" class="dropdown-menu">
            <div v-if="selectedPlayers.length" class="dropdown-tags">
              <span v-for="p in selectedPlayers" :key="p.puuid" class="sel-tag">
                <span class="sel-dot" :style="{ background: playerColor(p) }"></span>{{ p.gameName }}
                <X :size="10" class="sel-x" @click.stop="togglePlayer(p.puuid)" />
              </span>
            </div>
            <div v-if="!qualifiedPlayers.length" class="dd-empty">无符合条件玩家</div>
            <label v-for="p in qualifiedPlayers" :key="p.puuid" class="dd-item">
              <input type="checkbox" :checked="selectedPuuids.has(p.puuid)" @change="togglePlayer(p.puuid)" />
              <span class="dd-dot" :style="{ background: playerColor(p) }"></span>
              <span class="dd-name">{{ p.gameName }}<em>#{{ p.tagLine }}</em></span>
              <span class="dd-games">{{ p.gamesPlayed }}场</span>
            </label>
          </div>
        </div>

        <div class="batch-btns">
          <button class="btn-mini primary" @click="selectAll">全选所有符合条件玩家</button>
          <button class="btn-mini" @click="clearAll">清空所有选中</button>
        </div>

        <div class="batch-btns">
          <button class="toggle-sub" :class="{ active: outlineOnly }" @click="outlineOnly = !outlineOnly">
            <component :is="outlineOnly ? Check : X" :size="14" />
            <span>仅显示轮廓模式</span>
          </button>
          <button class="toggle-sub" :class="{ active: singleMode }" @click="toggleSingleMode">
            <UserRound :size="14" />
            <span>单人对比模式</span>
          </button>
        </div>

        <div class="batch-btns">
          <button class="btn-mini" @click="exportRadar" :disabled="exporting">
            <ImageDown :size="12" />
            {{ exporting ? "导出中..." : "导出图片" }}
          </button>
        </div>
        <div v-if="exportMsg" class="export-msg">{{ exportMsg }}</div>

        <div class="radar-legend">
          <div v-if="!selectedPlayers.length" class="legend-empty">请选择至少一名玩家查看雷达</div>
          <div v-for="p in selectedPlayers" :key="p.puuid" class="legend-item"
            :class="{ dimmed: isDimmed(p) }" @mouseenter="legendHover = p.puuid" @mouseleave="legendHover = null"
            @click="togglePlayer(p.puuid)">
            <span class="legend-dot" :style="{ background: playerColor(p) }"></span>
            <span class="legend-name">{{ p.gameName }}</span>
            <span class="legend-score">{{ radarScores(p).win.toFixed(0) }}</span>
          </div>
        </div>
      </div>

      <div class="radar-status" :style="{ fontSize: cfg.statusFont + 'px' }">{{ statusText }}</div>
    </div>

    <div v-show="exporting" ref="exportRef" class="radar-export-area">
      <div class="radar-canvas-wrap">
        <svg :width="W" :height="H" class="radar-svg">
          <g v-for="factor in [0.25, 0.5, 0.75, 1]" :key="factor">
            <polygon :points="ringPoints(factor)" fill="none"
              :stroke="factor === 1 ? '#4a4a4a' : 'rgba(255,255,255,0.07)'" stroke-width="1" />
          </g>
          <line v-for="i in 6" :key="'axis' + i" v-bind="axisLine(i - 1)" stroke="rgba(255,255,255,0.07)" stroke-width="1" />
          <text v-for="(dim, i) in DIMS" :key="dim.key" :x="labelPos(i).x" :y="labelPos(i).y"
            :text-anchor="labelPos(i).anchor" :font-size="cfg.font" fill="#9ca3af" class="radar-axis-label">{{ dim.label }}</text>

          <polygon v-if="showAvgRadar && avgScores" :points="layerPoints(avgScores)"
            fill="none" stroke="#9ca3af" stroke-width="1.5" stroke-dasharray="6 4" />

          <g v-for="(p, pi) in selectedPlayers" :key="p.puuid">
            <polygon :points="layerPoints(radarScores(p))"
              fill="none"
              :stroke="playerColor(p)"
              :stroke-width="2"
              :stroke-dasharray="dashFor(pi)"
              stroke-linejoin="round" />
          </g>
        </svg>

        <div v-if="qualifiedPlayers.length === 0" class="radar-empty">当前场次阈值过高，无符合条件玩家</div>
      </div>
      <div class="export-legend">
        <div v-if="!selectedPlayers.length" class="legend-empty">请选择至少一名玩家查看雷达</div>
        <div v-for="p in selectedPlayers" :key="p.puuid" class="export-legend-item">
          <span class="legend-dot" :style="{ background: playerColor(p) }"></span>
          <span class="legend-name">{{ p.gameName }}#{{ p.tagLine }}</span>
          <span class="legend-score">{{ radarScores(p).win.toFixed(0) }}</span>
        </div>
      </div>
      <div class="export-status-bar">{{ statusText }}</div>
    </div>

  </div>
</template>

<style scoped>
.radar-section { border-top: 1px solid var(--border, #333); padding-top: 8px; }
.radar-header { display: flex; align-items: center; gap: 6px; cursor: pointer; padding: 6px 0; }
.radar-header .section-title { font-size: 14px; font-weight: 700; color: inherit; white-space: nowrap; }
.radar-header:hover { color: var(--accent, #6366f1); }
.radar-header-count { margin-left: auto; font-size: 12px; font-weight: 400; color: var(--text-muted, #666); }
.radar-body { display: flex; gap: 16px; padding: 12px 0; align-items: flex-start; }

.radar-canvas-wrap { position: relative; background: var(--bg-tertiary, #1e1e1e); border: 1px solid var(--border, #333); border-radius: 10px; padding: 8px; flex-shrink: 0; }
.radar-svg { display: block; }
.radar-axis-label { user-select: none; }
.radar-player-poly { cursor: pointer; }

.radar-empty { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: rgba(255, 255, 255, 0.45); font-size: 13px; pointer-events: none; }

.radar-tooltip { position: absolute; z-index: 30; background: #1c1c24; border: 1px solid var(--border, #444); border-radius: 8px; padding: 10px 12px; min-width: 210px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45); pointer-events: none; }
.rt-name { font-size: 13px; font-weight: 700; margin-bottom: 6px; }
.rt-name em { font-style: normal; font-weight: 400; font-size: 11px; color: var(--text-muted, #888); }
.rt-row { display: flex; align-items: center; gap: 8px; font-size: 12px; padding: 2px 0; }
.rt-label { color: var(--text-muted, #aaa); width: 60px; }
.rt-val { font-weight: 700; min-width: 34px; text-align: right; }
.rt-avg { margin-left: auto; font-size: 11px; color: var(--text-muted, #666); }

.radar-controls { display: flex; flex-direction: column; gap: 16px; width: 300px; flex-shrink: 0; }

.toggle-sub, .btn-mini, .step-btn, .size-opt { border-radius: 5px; }
.toggle-sub { display: inline-flex; align-items: center; justify-content: center; gap: 5px; padding: 6px 10px; background: #fff; border: 1px solid #d0d0d0; color: #333; font-size: 12px; cursor: pointer; height: 30px; box-sizing: border-box; }
.toggle-sub:hover { border-color: var(--accent, #6366f1); color: var(--accent, #6366f1); }
.toggle-sub.active { background: var(--accent, #6366f1); border-color: var(--accent, #6366f1); color: #fff; }

.size-group { display: flex; flex-direction: column; gap: 6px; background: var(--bg-tertiary, #1e1e1e); border: 1px solid var(--border, #333); border-radius: 8px; padding: 10px; }
.size-label { font-size: 11px; color: var(--text-muted, #888); }
.size-options { display: flex; gap: 6px; }
.size-opt { display: inline-flex; align-items: center; justify-content: center; gap: 5px; padding: 5px 14px; background: #fff; border: 1px solid #d0d0d0; color: #333; font-size: 12px; cursor: pointer; user-select: none; height: 30px; box-sizing: border-box; }
.size-opt input { display: none; }
.size-opt:hover { border-color: var(--accent, #6366f1); color: var(--accent, #6366f1); }
.size-opt.active { background: var(--accent, #6366f1); border-color: var(--accent, #6366f1); color: #fff; }

.threshold-group { display: flex; flex-direction: column; gap: 8px; background: var(--bg-tertiary, #1e1e1e); border: 1px solid var(--border, #333); border-radius: 8px; padding: 10px; }
.threshold-label { font-size: 11px; color: var(--text-muted, #888); }
.threshold-input-row { display: flex; align-items: center; gap: 6px; }
.step-btn { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; background: #fff; border: 1px solid #d0d0d0; color: #333; cursor: pointer; box-sizing: border-box; }
.step-btn:hover { border-color: var(--accent, #6366f1); color: var(--accent, #6366f1); }
.step-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.num-input { width: 70px; padding: 5px 8px; background: #14141a; border: 1px solid var(--border, #444); border-radius: 4px; color: #fff; font-size: 13px; text-align: center; outline: none; height: 30px; box-sizing: border-box; }
.num-input:focus { border-color: var(--accent, #6366f1); }
.threshold-actions { display: flex; gap: 6px; }
.threshold-actions .btn-mini { flex: 1; }
.threshold-error { font-size: 11px; color: #f87171; }

.btn-mini { display: inline-flex; align-items: center; justify-content: center; gap: 4px; padding: 5px 8px; background: #0f0f13; border: 1px solid var(--border, #444); color: #cfcfcf; font-size: 11px; cursor: pointer; height: 30px; box-sizing: border-box; }
.btn-mini:hover { border-color: var(--accent, #6366f1); color: var(--accent, #6366f1); }
.btn-mini.primary { background: var(--accent, #6366f1); border-color: var(--accent, #6366f1); color: #fff; }
.btn-mini.primary:hover { opacity: 0.85; }

.player-dropdown { position: relative; }
.dropdown-trigger { width: 100%; display: flex; align-items: center; justify-content: space-between; padding: 7px 10px; background: var(--bg-tertiary, #1e1e1e); border: 1px solid var(--border, #333); border-radius: 6px; color: #ddd; font-size: 12px; cursor: pointer; height: 32px; box-sizing: border-box; }
.dropdown-trigger:hover { border-color: var(--accent, #6366f1); }
.dropdown-menu { position: absolute; z-index: 40; top: calc(100% + 4px); left: 0; right: 0; max-height: 300px; overflow-y: auto; background: #1c1c24; border: 1px solid var(--border, #444); border-radius: 8px; padding: 6px; box-shadow: 0 10px 28px rgba(0, 0, 0, 0.5); }
.dropdown-tags { display: flex; flex-wrap: wrap; gap: 4px; padding: 4px 2px 8px; border-bottom: 1px solid var(--border, #333); margin-bottom: 6px; }
.sel-tag { display: inline-flex; align-items: center; gap: 4px; background: rgba(99, 102, 241, 0.15); border: 1px solid rgba(99, 102, 241, 0.4); color: #a5b4fc; font-size: 11px; border-radius: 10px; padding: 2px 7px; }
.sel-dot { width: 7px; height: 7px; border-radius: 50%; }
.sel-x { cursor: pointer; opacity: 0.7; }
.sel-x:hover { opacity: 1; color: #f87171; }
.dd-empty { padding: 10px; text-align: center; color: var(--text-muted, #666); font-size: 12px; }
.dd-item { display: flex; align-items: center; gap: 7px; padding: 6px 8px; border-radius: 6px; cursor: pointer; font-size: 12px; }
.dd-item:hover { background: rgba(99, 102, 241, 0.12); }
.dd-item input { accent-color: #6366f1; }
.dd-dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
.dd-name { color: #ddd; }
.dd-name em { font-style: normal; color: var(--text-muted, #777); font-size: 11px; }
.dd-games { margin-left: auto; color: var(--text-muted, #888); font-size: 11px; }

.batch-btns { display: flex; gap: 6px; }
.batch-btns .btn-mini, .batch-btns .toggle-sub { flex: 1; }

.export-msg { font-size: 11px; color: #4ade80; }

.radar-legend { display: flex; flex-direction: column; gap: 4px; background: var(--bg-tertiary, #1e1e1e); border: 1px solid var(--border, #333); border-radius: 8px; padding: 8px; max-height: 200px; overflow-y: auto; }
.legend-empty { padding: 8px 4px; text-align: center; color: var(--text-muted, #666); font-size: 12px; }
.legend-item { display: flex; align-items: center; gap: 7px; padding: 4px 6px; border-radius: 6px; cursor: pointer; font-size: 12px; }
.legend-item:hover { background: rgba(255, 255, 255, 0.08); }
.legend-item.dimmed { opacity: 0.4; }
.legend-dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
.legend-name { color: #ddd; }
.legend-score { margin-left: auto; color: var(--text-muted, #666); font-size: 10px; }

.radar-export-area { display: flex; flex-direction: column; gap: 10px; align-items: flex-start; padding: 12px 0; }
.export-legend { display: flex; flex-wrap: wrap; gap: 8px 16px; background: #0f0f13; border: 1px solid var(--border, #333); border-radius: 8px; padding: 10px 12px; max-width: 700px; }
.export-legend-item { display: flex; align-items: center; gap: 6px; font-size: 12px; }
.export-status-bar { background: #0f0f13; border: 1px solid var(--border, #333); border-radius: 8px; padding: 8px 12px; color: #d4d4d4; font-size: 12px; }

.radar-status { background: #0f0f13; border: 1px solid var(--border, #333); border-radius: 6px; padding: 8px 12px; color: #d4d4d4; margin-top: 4px; }
</style>

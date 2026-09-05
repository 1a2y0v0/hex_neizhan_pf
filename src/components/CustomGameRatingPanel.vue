<script setup lang="ts">
import { computed, createApp, nextTick, onMounted, reactive, ref, watch, type Ref } from "vue"
import { Calendar, Check, ChevronDown, ChevronRight, ChevronUp, Crown, Download, LoaderCircle, RefreshCw, Search, Swords, UserRound, X } from "lucide-vue-next"
import { loadTodayCustomGames, saveExportFile } from "../api"
import { save } from "@tauri-apps/plugin-dialog"
import { toBlob } from "html-to-image"
import { buildChampionProfiles, buildPlayerProfile, profileScoreLevel, type ChampionProfile, type PlayerProfile } from "../playerProfile"
import { calculateOutputRating, scoreEvaluationLabel, type OutputRating } from "../scoring"
import { buildStoreZip, type ZipFileEntry } from "../zipStore"
import { buildWhiteExportRoot, ensureExportExtension, EXPORT_PRESETS, sanitizeFilename, waitForImages, type ExportPreset } from "../exportUtil"
import type { ChampionSummaryItem, GameAssetBundle, GameAssetEntry, KillRelationEntry, MatchDetailPlayer, MatchDetailResponse, RecentGame, TodayCustomGamesResponse } from "../types"
import { championName } from "../utils"
import AssetIcon from "./AssetIcon.vue"
import ChampionAvatar from "./ChampionAvatar.vue"
import ChampionDetailDrawer from "./ChampionDetailDrawer.vue"
import GameDetailTeams from "./GameDetailTeams.vue"
import KillRelationsCard from "./KillRelationsCard.vue"
import PlayerCompareSection from "./PlayerCompareSection.vue"
import PlayerDetailCards from "./PlayerDetailCards.vue"
import PlayerDetailDrawer from "./PlayerDetailDrawer.vue"
import PlayerRadarPanel from "./PlayerRadarPanel.vue"
import PlayerTrendSection from "./PlayerTrendSection.vue"
import RatingChartsSection from "./RatingChartsSection.vue"

const props = defineProps<{
  champions: Record<number, ChampionSummaryItem>
  items?: GameAssetEntry[]
  gameAssets?: GameAssetBundle
}>()

function indexAssets(entries?: GameAssetEntry[]) {
  const map: Record<number, GameAssetEntry> = {}
  if (!entries) return map
  for (const entry of entries) map[entry.id] = entry
  return map
}

const itemMap = computed(() => indexAssets(props.items))
const spellMap = computed(() => indexAssets(props.gameAssets?.summonerSpells))
const perkMap = computed(() => indexAssets(props.gameAssets?.perks))
const augmentMap = computed(() => indexAssets(props.gameAssets?.augments))
const ratingContext = computed(() => ({ items: itemMap.value, champions: props.champions }))

/* ── 单局评分缓存：同一对局对象全程只计算一次（大区间显著降低 CPU） ── */
const ratingCache = new WeakMap<RecentGame, OutputRating>()
function rateGame(game: RecentGame): OutputRating {
  const cached = ratingCache.get(game)
  if (cached) return cached
  const rating = calculateOutputRating(game, ratingContext.value)
  ratingCache.set(game, rating)
  return rating
}

/* ── helpers ── */
const loading = ref(false)
const error = ref("")
const data = ref<TodayCustomGamesResponse | null>(null)

function toLocalDateStr(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}
function todayDateStr() { return toLocalDateStr(Date.now()) }
function dateToDayStart(dateStr: string) { const [y, m, d] = dateStr.split("-").map(Number); return new Date(y, m - 1, d).getTime() }
function dateToDayEnd(dateStr: string) { const [y, m, d] = dateStr.split("-").map(Number); return new Date(y, m - 1, d + 1).getTime() }

const startDate = ref(todayDateStr())
const endDate = ref(todayDateStr())
const rangeStartMs = computed(() => dateToDayStart(startDate.value))
const rangeEndMs = computed(() => dateToDayEnd(endDate.value))

/* ── 快速时间范围 ── */
const QUICK_RANGES = [
  { key: "today", label: "今日" },
  { key: "week", label: "本周" },
  { key: "month", label: "本月" },
  { key: "threeMonths", label: "三个月内" },
  { key: "all", label: "全部对局（近5个月）" },
] as const
type QuickRangeKey = (typeof QUICK_RANGES)[number]["key"]

function presetRange(key: QuickRangeKey): { start: string; end: string } {
  const now = new Date()
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const end = toLocalDateStr(dayStart.getTime())
  let start: Date
  switch (key) {
    case "today":
      start = dayStart
      break
    case "week": {
      // 周一作为一周起点
      const offset = (dayStart.getDay() + 6) % 7
      start = new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate() - offset)
      break
    }
    case "month":
      start = new Date(now.getFullYear(), now.getMonth(), 1)
      break
    case "threeMonths":
      start = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate())
      break
    case "all":
      // 全部对局默认取最近 5 个月的数据
      start = new Date(now.getFullYear(), now.getMonth() - 5, now.getDate())
      break
  }
  return { start: toLocalDateStr(start.getTime()), end }
}

/** 用户最近一次在下拉框里选中的快捷项；手动改日期时置为 "custom"。 */
const quickRangePreference = ref<QuickRangeKey | "custom">("today")

/** 当前日期区间命中的快捷项；优先匹配用户最近选择，其次按预设顺序匹配。 */
const activeQuickRange = computed<QuickRangeKey | "custom">(() => {
  if (quickRangePreference.value !== "custom") {
    const p = presetRange(quickRangePreference.value)
    if (startDate.value === p.start && endDate.value === p.end) return quickRangePreference.value
  }
  for (const r of QUICK_RANGES) {
    const p = presetRange(r.key)
    if (startDate.value === p.start && endDate.value === p.end) return r.key
  }
  return "custom"
})

function onQuickRangeChange(e: Event) {
  const key = (e.target as HTMLSelectElement).value
  if (key === "custom") return
  const p = presetRange(key as QuickRangeKey)
  quickRangePreference.value = key as QuickRangeKey
  startDate.value = p.start
  endDate.value = p.end
  load()
}

function onManualDateChange() {
  quickRangePreference.value = "custom"
  load()
}

const queueNames: Record<number, string> = {
  0: "自定义", 3270: "自定义", 400: "匹配", 420: "单双排", 430: "匹配", 440: "灵活排", 450: "大乱斗",
  700: "Clash", 800: "AI", 820: "AI", 830: "AI", 840: "AI", 850: "AI", 900: "乌迪尔",
  920: "魄罗", 1020: "无限火力", 1300: "涅槃", 1400: "终极魔典", 1700: "斗魂竞技场", 1900: "斗魂",
}
function queueLabel(qid: number) { return queueNames[qid] ?? `队列${qid}` }

function abilityClass(s: number) { return s >= 80 ? "ab-high" : s >= 60 ? "ab-mid" : "ab-low" }
function scoreClass(s: number) { return s >= 80 ? "sc-high" : s >= 60 ? "sc-mid" : "sc-low" }
function kdaClass(s: number) { return s >= 4 ? "sc-high" : s >= 2.5 ? "sc-mid" : "sc-low" }
function kdaScore(k: number, d: number, a: number) { return Math.round((k + a) / Math.max(d, 0.5) * 10) / 10 }
function winRate(r: { wins: number; gamesPlayed: number }) { return r.wins / r.gamesPlayed * 100 }
function avgValues(values: number[]) { const v = values.filter((x) => Number.isFinite(x)); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : 0 }

/* ── 单局明细行已抽成 GameDetailTeams 复用组件，此处的字段 helpers 随之下沉 ── */
function augmentName(augmentId: number) {
  return augmentMap.value[augmentId]?.name || perkMap.value[augmentId]?.name || `强化 ${augmentId}`
}
function augmentRarityClass(augmentId: number) {
  switch (augmentMap.value[augmentId]?.rarity || perkMap.value[augmentId]?.rarity) {
    case "kPrismatic": return "augment-prismatic"
    case "kGold": return "augment-gold"
    case "kSilver": return "augment-silver"
    case "kBronze": return "augment-bronze"
    default: return ""
  }
}

/* ── types ── */
interface TrendPoint {
  gameId: number; championId: number
  kills: number; deaths: number; assists: number
  win: boolean; gameDuration: number; gameCreation: number
  score: number; kda: number; damageShare: number; dpm: number
}

interface PlayerKillMapEntry {
  puuid: string; name: string; kills: number; assists: number; games: number; avgKills: number
}

interface PlayerRating {
  puuid: string; gameName: string; tagLine: string; summonerName: string
  gamesPlayed: number; wins: number; profile: PlayerProfile
  recentChampionIds: number[]; championProfiles: ChampionProfile[]
  avgKills: number; avgDeaths: number; avgAssists: number
  overallKdaScore: number; highlightGames: number; disasterGames: number
  avgGpm: number; avgDpm: number; avgCspm: number; avgKp: number; avgKillShare: number; avgMitigationPerDeath: number
  honors: Record<string, number>
  trend: TrendPoint[]
  killMap: PlayerKillMapEntry[]
  damageLeaderCount: number; mitigationLeaderCount: number; assistLeaderCount: number
  leaderGameIds: { damage: number[]; mitigation: number[]; assist: number[] }
  gameRecords: PlayerGameRecord[]
}

interface PlayerGameRecord {
  gameId: number; championId: number
  kills: number; deaths: number; assists: number; win: boolean
  gameDuration: number; damageShare: number; mitigationShare: number; score: number
  gpm: number; dpm: number; cspm: number; kp: number; killShare: number; goldShare: number; mitigationPerDeath: number
}

interface GamePlayerEnriched {
  puuid: string; gameName: string; championId: number
  kills: number; deaths: number; assists: number
  gameScore: number; win: boolean
  damageDealtToChampions: number; totalDamageTaken: number; totalHeal: number
  teamDamageToChampions: number; teamTotalDamageTaken: number; teamDamageSelfMitigated: number
  killRelations: KillRelationEntry[]
}

interface GameEnriched {
  gameId: number; queueId: number; gameDuration: number; gameMode: string
  teams: { teamId: number; win: boolean; players: GamePlayerEnriched[]; avgScore: number }[]
  mvp: GamePlayerEnriched; mvpName: string
  tags: string[]
  gameCreation: number
}

/* ── state ── */
const DELETED_GAME_IDS_KEY = "lol-stats:crp:deleted-game-ids:v1"
function readDeletedGameIds(): Set<number> {
  try {
    const raw = localStorage.getItem(DELETED_GAME_IDS_KEY)
    if (!raw) return new Set()
    const arr = JSON.parse(raw)
    return new Set(Array.isArray(arr) ? arr.filter((id: unknown) => typeof id === "number") : [])
  } catch {
    return new Set()
  }
}
function persistDeletedGameIds() {
  try {
    localStorage.setItem(DELETED_GAME_IDS_KEY, JSON.stringify([...deletedGameIds.value]))
  } catch {
    // 忽略持久化失败
  }
}
const deletedGameIds = ref<Set<number>>(readDeletedGameIds())

function deleteGame(gameId: number) {
  const s = new Set(deletedGameIds.value)
  s.add(gameId)
  deletedGameIds.value = s
  persistDeletedGameIds()
}

function restoreDeletedGames() {
  deletedGameIds.value = new Set()
  persistDeletedGameIds()
}

const customOnly = ref(true)
const fiveV5Only = ref(true)
const minDuration8 = ref(true)

const minGameCount = ref(0)
const minGameCountText = ref("")
function applyMinGameCount() {
  const v = parseInt(minGameCountText.value, 10)
  minGameCount.value = Number.isFinite(v) && v > 0 ? v : 0
}

const visibleGames = computed(() => {
  if (!data.value) return []
  const del = deletedGameIds.value
  return data.value.games.filter((g) => {
    if (del.has(g.gameId)) return false
    if (customOnly.value && g.queueId !== 3270) return false
    if (fiveV5Only.value && !(g.teams.length === 2 && g.teams[0].players.length === 5 && g.teams[1].players.length === 5)) return false
    if (minDuration8.value && g.gameDuration < 480) return false
    return true
  })
})

const rawGameById = computed(() => {
  const map = new Map<number, MatchDetailResponse>()
  for (const g of visibleGames.value) map.set(g.gameId, g)
  return map
})
function rawGame(gameId: number): MatchDetailResponse | undefined {
  return rawGameById.value.get(gameId)
}

// game list
const gameListVisible = ref(false)
const expandedGames = ref<Set<number>>(new Set())
const hoveredGameId = ref<number | null>(null)

/* ── 对局列表分批增量渲染：大区间只渲染前若干张卡片，避免 DOM 过大卡顿 ── */
const GAME_LIST_INITIAL = 60
const GAME_LIST_STEP = 200
const gameListLimit = ref(GAME_LIST_INITIAL)
/** 当前实际渲染的对局（前 N 张，基于搜索过滤结果） */
const shownGames = computed(() => filteredGameList.value.slice(0, gameListLimit.value))
function showMoreGames() {
  gameListLimit.value = Math.min(filteredGameList.value.length, gameListLimit.value + GAME_LIST_STEP)
}
function showAllGames() {
  gameListLimit.value = filteredGameList.value.length
}
// 数据重新加载后回到初始批次，避免一次性渲染巨量卡片
watch(data, () => {
  gameListLimit.value = GAME_LIST_INITIAL
  resetGameListGrouping()
})

// collapsible sections
const ratingSectionVisible = ref(true)
const championSectionVisible = ref(false)
const augmentSectionVisible = ref(false)

// rating table
const sortColumn = ref<string>("overallScore")
const sortDirection = ref<"asc" | "desc">("desc")
const filterText = ref("")
const showSubColumns = ref(true)
const showEfficiencyColumns = ref(true)
/* ── 玩家详情侧边栏：点击评分表行打开，点击空白处关闭 ── */
const drawerPlayer = ref<PlayerRating | null>(null)

function openPlayerDrawer(puuid: string) {
  drawerPlayer.value = playerRatings.value.find((r) => r.puuid === puuid) || null
}
function closePlayerDrawer() {
  drawerPlayer.value = null
}

// image export
const ratingExportRef = ref<HTMLElement | null>(null)
const exportMenuOpen = ref(false)
const exporting = ref(false)
const batchExporting = ref(false)
const exportMessage = ref("")

function exportFileName(preset: ExportPreset) {
  const range = startDate.value === endDate.value ? startDate.value : `${startDate.value}_${endDate.value}`
  return `内战玩家评分_${range}_${preset.ratio}x.${preset.ext}`
}

function buildExportRoot(): HTMLElement | null {
  const sourceTable = ratingExportRef.value?.querySelector("table")
  if (!sourceTable) return null

  const root = document.createElement("div")
  root.style.cssText = "position:absolute;left:0;top:0;z-index:-1;background:#ffffff;color:#111827;padding:16px;width:max-content;"
  root.style.fontFamily = getComputedStyle(sourceTable).fontFamily || "system-ui, -apple-system, Microsoft YaHei, sans-serif"

  const title = document.createElement("div")
  const range = startDate.value === endDate.value ? startDate.value : `${startDate.value} 至 ${endDate.value}`
  title.textContent = `玩家评分 · ${range}`
  title.style.cssText = "margin:0 0 12px;font-size:16px;font-weight:700;color:#111827;"
  root.appendChild(title)

  const table = sourceTable.cloneNode(true) as HTMLElement
  table.style.width = "auto"
  table.style.overflow = "visible"
  table.style.background = "#ffffff"
  root.appendChild(table)

  const all = root.querySelectorAll<HTMLElement>("*")
  all.forEach((el) => {
    el.style.overflow = "visible"
    el.style.background = "transparent"
    el.style.color = "#111827"
    el.style.borderColor = "#d1d5db"
    el.style.boxShadow = "none"
    el.style.textShadow = "none"
  })

  const headers = root.querySelectorAll<HTMLElement>("th")
  headers.forEach((el) => {
    el.style.background = "#f3f4f6"
    el.style.color = "#111827"
    el.style.borderBottom = "1px solid #9ca3af"
  })

  const cells = root.querySelectorAll<HTMLElement>("td")
  cells.forEach((el) => {
    el.style.background = "#ffffff"
    el.style.color = "#111827"
    el.style.borderBottom = "1px solid #e5e7eb"
  })

  const icons = root.querySelectorAll<HTMLElement>("svg")
  icons.forEach((el) => {
    el.style.color = "#111827"
    el.setAttribute("stroke", "#111827")
  })

  return root
}

async function exportRatingImage(preset: ExportPreset) {
  exportMenuOpen.value = false
  if (exporting.value) return
  const exportRoot = buildExportRoot()
  if (!exportRoot) return
  exporting.value = true
  exportMessage.value = "正在生成..."
  let attached = false
  try {
    document.body.appendChild(exportRoot)
    attached = true
    await document.fonts?.ready
    const blob = await toBlob(exportRoot, {
      type: preset.type,
      quality: preset.quality,
      pixelRatio: preset.ratio,
      backgroundColor: "#ffffff",
      cacheBust: true,
    })
    if (!blob) throw new Error("图片生成失败")
    const path = await save({
      title: "导出玩家评分图片",
      defaultPath: exportFileName(preset),
      filters: [{ name: preset.label, extensions: [preset.ext] }],
    })
    if (!path) {
      exportMessage.value = ""
      return
    }
    const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()))
    await saveExportFile(ensureExportExtension(path, preset.ext), bytes)
    exportMessage.value = "已导出"
    window.setTimeout(() => { if (exportMessage.value === "已导出") exportMessage.value = "" }, 3000)
  } catch (err) {
    exportMessage.value = `导出失败：${err instanceof Error ? err.message : String(err)}`
  } finally {
    if (attached) exportRoot.remove()
    exporting.value = false
  }
}

/** 批量导出：把当前列表里每个玩家的详情页渲染成 PNG，再打包成一个 ZIP。 */
async function exportAllPlayerDetails(ratio: number) {
  exportMenuOpen.value = false
  if (exporting.value || batchExporting.value) return
  const list = filteredAndSortedRatings.value
  if (!list.length) return
  batchExporting.value = true
  const range = startDate.value === endDate.value ? startDate.value : `${startDate.value} 至 ${endDate.value}`
  try {
    const files: ZipFileEntry[] = []
    for (let i = 0; i < list.length; i++) {
      const rating = list[i]
      exportMessage.value = `正在生成玩家详情 ${i + 1}/${list.length}...`
      const container = document.createElement("div")
      container.style.cssText = "position:absolute;left:-99999px;top:0;width:460px;"
      document.body.appendChild(container)
      const app = createApp(PlayerDetailCards, { player: rating, champions: props.champions })
      app.mount(container)
      try {
        await nextTick()
        await document.fonts?.ready
        await waitForImages(container)
        const root = buildWhiteExportRoot(
          container.firstElementChild as HTMLElement,
          `玩家详情 · ${rating.gameName}#${rating.tagLine} · ${range}`,
        )
        document.body.appendChild(root)
        try {
          const blob = await toBlob(root, {
            type: "image/png",
            pixelRatio: ratio,
            backgroundColor: "#ffffff",
            cacheBust: true,
          })
          if (!blob) throw new Error("图片生成失败")
          const data = new Uint8Array(await blob.arrayBuffer())
          files.push({
            name: `${String(i + 1).padStart(2, "0")}_${sanitizeFilename(rating.gameName)}_${sanitizeFilename(rating.tagLine)}.png`,
            data,
          })
        } finally {
          root.remove()
        }
      } finally {
        app.unmount()
        container.remove()
      }
    }
    exportMessage.value = "正在打包..."
    const zipBytes = buildStoreZip(files)
    const path = await save({
      title: "导出全部玩家详情压缩包",
      defaultPath: `玩家详情_${sanitizeFilename(range)}_${list.length}人.zip`,
      filters: [{ name: "ZIP 压缩包", extensions: ["zip"] }],
    })
    if (!path) {
      exportMessage.value = ""
      return
    }
    await saveExportFile(ensureExportExtension(path, "zip"), Array.from(zipBytes))
    exportMessage.value = "已导出"
    window.setTimeout(() => { if (exportMessage.value === "已导出") exportMessage.value = "" }, 3000)
  } catch (err) {
    exportMessage.value = `导出失败：${err instanceof Error ? err.message : String(err)}`
  } finally {
    batchExporting.value = false
  }
}
/* ── enriched games ── */
const enrichedGames = computed<GameEnriched[]>(() => {
  return visibleGames.value.map((game) => {
    const teams = game.teams.map((team) => {
      const players = team.players.map((p) => ({
        puuid: p.puuid, gameName: p.gameName, championId: p.championId,
        kills: p.kills, deaths: p.deaths, assists: p.assists,
        gameScore: rateGame(p).score,
        win: p.win,
        damageDealtToChampions: p.damageToChampions || 0,
        totalDamageTaken: p.totalDamageTaken || 0,
        totalHeal: (p.totalHeal || 0) + (p.totalDamageShieldedOnTeammates || 0),
        teamDamageToChampions: p.teamDamageToChampions || 0,
        teamTotalDamageTaken: p.teamTotalDamageTaken || 0,
        teamDamageSelfMitigated: p.damageSelfMitigated || 0,
        killRelations: p.killRelations || [],
      }))
      const avgScore = players.reduce((s, p) => s + p.gameScore, 0) / players.length
      return { teamId: team.teamId, win: team.win, players, avgScore }
    })
    const allPlayers = teams.flatMap((t) => t.players)
    const mvp = allPlayers.reduce((best, p) => (p.gameScore > best.gameScore ? p : best), allPlayers[0])
    const tags: string[] = []
    if (game.gameDuration < 900) tags.push("速推局")
    if (game.gameDuration > 1440) tags.push("拉锯局")
    if (teams.length === 2 && Math.abs(teams[0].avgScore - teams[1].avgScore) >= 12) tags.push("碾压局")
    return {
      gameId: game.gameId, queueId: game.queueId, gameDuration: game.gameDuration,
      gameMode: game.gameMode, teams, mvp, mvpName: mvp?.gameName || "",
      tags, gameCreation: game.gameCreation,
    }
  })
})

/* ── 对局列表 关键字搜索：只过滤对局列表本身（玩家/海克斯/日期/装备/英雄等），不影响评分等统计 ── */
const gameSearchQuery = ref("")
/** 该局的可搜索文本：日期/玩家/英雄/海克斯/装备/胜负/时长/击杀对象等 */
function buildGameSearchText(g: GameEnriched): string {
  const parts: string[] = []
  const ts = g.gameCreation
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = d.getMonth() + 1
  const day = d.getDate()
  const pad = (n: number) => String(n).padStart(2, "0")
  // 日期多种写法：2026-09-03 / 2026/9/3 / 2026年9月3日 / 9月3日 / 09-03 / 2026-09 / 2026年9月 / 周X
  parts.push(
    `${y}-${pad(m)}-${pad(day)}`, `${y}/${m}/${day}`, `${y}年${m}月${day}日`,
    `${m}月${day}日`, `${pad(m)}-${pad(day)}`, `${y}-${pad(m)}`, `${y}年${m}月`,
    `周${"日一二三四五六"[d.getDay()]}`,
  )
  // 时长（秒 → 分钟）：搜 “28min / 28分钟” 找特定时长对局
  const mins = Math.round(g.gameDuration / 60)
  parts.push(`${mins}min`, `${mins}分钟`)

  const raw = rawGame(g.gameId)
  if (raw) {
    // 本局 puuid → 游戏名（击杀关系只存受害者 puuid，反查名字生成“X杀Y”词对）
    const nameByPuuid = new Map<string, string>()
    for (const team of raw.teams) {
      for (const p of team.players) nameByPuuid.set(p.puuid, p.gameName)
    }
    for (const team of raw.teams) {
      // 胜负：蓝方胜利 / 蓝方失败 / 红方胜利 / 红方失败（也可只搜“蓝方”“红方”）
      const side = team.teamId === 100 ? "蓝方" : team.teamId === 200 ? "红方" : team.name || ""
      parts.push(`${side}${team.win ? "胜利" : "失败"}`)
      for (const p of team.players) {
        parts.push(p.gameName, p.tagLine || "", p.summonerName || "")
        parts.push(championName(props.champions, p.championId))
        // 海克斯按槽位存于 augmentIds；补上其级别词，便于搜“彩/金/银”
        for (const id of p.augmentIds || []) {
          parts.push(augmentName(id))
          const rarity = augmentMap.value[id]?.rarity || perkMap.value[id]?.rarity
          if (rarity === "kPrismatic") parts.push("彩")
          else if (rarity === "kGold") parts.push("金")
          else if (rarity === "kSilver") parts.push("银")
        }
        for (const id of p.perkIds || []) parts.push(augmentName(id))
        for (const id of p.itemIds || []) parts.push(itemMap.value[id]?.name || `装备${id}`)
        // 击杀关系成对词：搜“李四杀张三”或“张三被李四杀”可精确到杀过谁
        for (const kr of p.killRelations || []) {
          const victim = nameByPuuid.get(kr.victimPuuid)
          if (victim && victim !== p.gameName) {
            parts.push(`${p.gameName}杀${victim}`, `${victim}被${p.gameName}杀`)
          }
        }
      }
    }
  }
  parts.push(g.mvpName)
  parts.push(...g.tags)
  return parts.join(" ").toLowerCase()
}
/** 每局搜索文本索引（仅随数据/资产变化重建） */
const gameSearchIndex = computed(() => {
  const map = new Map<number, string>()
  for (const g of enrichedGames.value) map.set(g.gameId, buildGameSearchText(g))
  return map
})
/** 空格分词，全部命中才算符合（如“亚索 8月”） */
const filteredGameList = computed<GameEnriched[]>(() => {
  const terms = gameSearchQuery.value.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return enrichedGames.value
  const idx = gameSearchIndex.value
  return enrichedGames.value.filter((g) => {
    const text = idx.get(g.gameId)
    if (!text) return false
    return terms.every((t) => text.includes(t))
  })
})

function toggleGameExpand(gameId: number) {
  const s = new Set(expandedGames.value)
  if (s.has(gameId)) s.delete(gameId); else s.add(gameId)
  expandedGames.value = s
}

/* ── 跨模块联动：图表 → 评分表 / 对局列表 ── */
function focusPlayer(puuid: string) {
  // 只弹出玩家详情侧边栏，保持当前视图与滚动位置不变
  openPlayerDrawer(puuid)
}

function focusGame(gameId: number) {
  gameListVisible.value = true
  if (!openedOnce.gameList) openedOnce.gameList = true
  // 若当前搜索过滤掉了目标局，先清空搜索词，确保能定位到
  if (gameSearchQuery.value.trim() && !filteredGameList.value.some((g) => g.gameId === gameId)) {
    gameSearchQuery.value = ""
  }
  if (gameListViewMode.value === "flat") {
    // 目标对局若尚未渲染（超出当前批次），先扩展渲染范围再滚动定位
    const idx = filteredGameList.value.findIndex((g) => g.gameId === gameId)
    if (idx >= gameListLimit.value) gameListLimit.value = idx + 1
  } else {
    // 分组视图：自动展开目标对局所在月份，并确保该局在月内渲染范围内
    const mk = monthKeyOfGame(gameId)
    if (mk) {
      const s = new Set(openMonths.value)
      s.add(mk)
      openMonths.value = s
      const pos = monthPosOfGame(mk, gameId)
      if (pos >= 0) monthLimits[mk] = Math.max(monthLimits[mk] ?? 0, pos + 1)
    }
  }
  if (!expandedGames.value.has(gameId)) {
    const s = new Set(expandedGames.value)
    s.add(gameId)
    expandedGames.value = s
  }
  nextTick(() => {
    document.querySelector(`[data-game-id="${gameId}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" })
  })
}

/* ── 对局列表 · 时间分栏视图（年/月 → 日期 分组，旧月份展开时才渲染该月对局） ── */
type GameListViewMode = "grouped" | "flat"
const gameListViewMode = ref<GameListViewMode>("grouped")
const MONTH_GAME_INITIAL = 80
const MONTH_GAME_STEP = 200

interface GameMonthGroup {
  key: string
  label: string
  count: number
  dates: { key: string; label: string; games: GameEnriched[] }[]
}
type GameListRow =
  | { kind: "month"; key: string; monthKey: string; label: string; count: number; open: boolean }
  | { kind: "date"; key: string; label: string; total: number; shown: number }
  | { kind: "game"; key: string; game: GameEnriched }
  | { kind: "more"; key: string; monthKey?: string; shown: number; total: number; moreStep: number }

function monthLabelOf(monthKey: string) {
  const [y, m] = monthKey.split("-").map(Number)
  return `${y}年${m}月`
}
function dateLabelOf(dayKey: string) {
  const [y, m, d] = dayKey.split("-").map(Number)
  return `${m}月${d}日 周${"日一二三四五六"[new Date(y, m - 1, d).getDay()]}`
}

/* 对局按 年月→日期 降序聚合（基于搜索过滤结果） */
const gameMonthGroups = computed<GameMonthGroup[]>(() => {
  const map = new Map<string, GameMonthGroup>()
  for (const g of filteredGameList.value) {
    const dayKey = toLocalDateStr(g.gameCreation)
    const mKey = dayKey.slice(0, 7)
    let month = map.get(mKey)
    if (!month) {
      month = { key: mKey, label: monthLabelOf(mKey), count: 0, dates: [] }
      map.set(mKey, month)
    }
    month.count++
    let date = month.dates.find((d) => d.key === dayKey)
    if (!date) {
      date = { key: dayKey, label: dateLabelOf(dayKey), games: [] }
      month.dates.push(date)
    }
    date.games.push(g)
  }
  const months = [...map.values()]
  months.sort((a, b) => b.key.localeCompare(a.key))
  for (const m of months) {
    m.dates.sort((a, b) => b.key.localeCompare(a.key))
    for (const d of m.dates) d.games.sort((a, b) => b.gameCreation - a.gameCreation)
  }
  return months
})

/* 已展开的月份（默认只展开最近一个月） */
const openMonths = ref<Set<string>>(new Set())
/* 每个已展开月份当前渲染的对局数上限（默认 80，超出时月内出现“加载更多”） */
const monthLimits = reactive<Record<string, number>>({})

function resetGameListGrouping() {
  openMonths.value = new Set<string>()
  for (const k of Object.keys(monthLimits)) delete monthLimits[k]
  const newest = gameMonthGroups.value[0]
  if (newest) openMonths.value.add(newest.key)
}
function toggleMonthOpen(monthKey: string) {
  const s = new Set(openMonths.value)
  if (s.has(monthKey)) s.delete(monthKey)
  else {
    s.add(monthKey)
    // 每次展开都回到初始 80 场，保证懒加载语义；已加载进度保留在 monthLimits 中由“显示全部”清除
    if (monthLimits[monthKey] === undefined || monthLimits[monthKey] > MONTH_GAME_INITIAL) monthLimits[monthKey] = MONTH_GAME_INITIAL
  }
  openMonths.value = s
}
function loadMoreMonth(monthKey: string) {
  const month = gameMonthGroups.value.find((m) => m.key === monthKey)
  if (!month) return
  monthLimits[monthKey] = Math.min(month.count, (monthLimits[monthKey] ?? MONTH_GAME_INITIAL) + MONTH_GAME_STEP)
}
function showAllMonth(monthKey: string) {
  const month = gameMonthGroups.value.find((m) => m.key === monthKey)
  if (month) monthLimits[monthKey] = month.count
}
function monthKeyOfGame(gameId: number): string | null {
  const g = enrichedGames.value.find((x) => x.gameId === gameId)
  return g ? toLocalDateStr(g.gameCreation).slice(0, 7) : null
}
function monthPosOfGame(monthKey: string, gameId: number): number {
  const month = gameMonthGroups.value.find((m) => m.key === monthKey)
  if (!month) return -1
  let pos = 0
  for (const date of month.dates) {
    for (const g of date.games) {
      if (g.gameId === gameId) return pos
      pos++
    }
  }
  return -1
}

function isMonthRow(row: GameListRow): row is GameListRow & { kind: "month" } { return row.kind === "month" }
function isDateRow(row: GameListRow): row is GameListRow & { kind: "date" } { return row.kind === "date" }
function isGameRow(row: GameListRow): row is GameListRow & { kind: "game" } { return row.kind === "game" }
function isMoreRow(row: GameListRow): row is GameListRow & { kind: "more" } { return row.kind === "more" }

/* 当前展示行序列：平铺 = 直接切片；分组 = 展开月份的 月份头/日期头/对局卡 + 月内“加载更多” */
const gameListDisplay = computed<GameListRow[]>(() => {
  if (gameListViewMode.value === "flat") {
    const rows: GameListRow[] = []
    for (const g of shownGames.value) rows.push({ kind: "game", key: `g${g.gameId}`, game: g })
    const total = filteredGameList.value.length
    if (total > gameListLimit.value) {
      rows.push({
        kind: "more", key: "moreFlat", shown: gameListLimit.value, total,
        moreStep: Math.min(GAME_LIST_STEP, total - gameListLimit.value),
      })
    }
    return rows
  }
  const rows: GameListRow[] = []
  for (const month of gameMonthGroups.value) {
    const open = openMonths.value.has(month.key)
    rows.push({ kind: "month", key: `m${month.key}`, monthKey: month.key, label: month.label, count: month.count, open })
    if (!open) continue
    const limit = monthLimits[month.key] ?? MONTH_GAME_INITIAL
    let remaining = limit
    let shownCount = 0
    for (const date of month.dates) {
      if (remaining <= 0) break
      const take = Math.min(date.games.length, remaining)
      remaining -= take
      shownCount += take
      rows.push({ kind: "date", key: `d${date.key}`, label: date.label, total: date.games.length, shown: take })
      for (let i = 0; i < take; i++) {
        const g = date.games[i]
        rows.push({ kind: "game", key: `g${g.gameId}`, game: g })
      }
      if (take < date.games.length) break
    }
    if (shownCount < month.count) {
      rows.push({
        kind: "more", key: `more${month.key}`, monthKey: month.key,
        shown: shownCount, total: month.count,
        moreStep: Math.min(MONTH_GAME_STEP, month.count - shownCount),
      })
    }
  }
  return rows
})

/* ── summary ── */
const summaryStats = computed(() => {
  const ratings = playerRatings.value
  if (!ratings.length) return null
  const totalGames = enrichedGames.value.length
  const totalPlayers = ratings.length
  const totalWins = ratings.reduce((s, r) => s + r.wins, 0)
  const totalGamesPlayed = ratings.reduce((s, r) => s + r.gamesPlayed, 0)
  const avgWinRate = totalGamesPlayed > 0 ? (totalWins / totalGamesPlayed) * 100 : 0
  const avgOverallScore = ratings.reduce((s, r) => s + r.profile.overallScore, 0) / totalPlayers
  const avgKdaScore = ratings.reduce((s, r) => s + r.overallKdaScore, 0) / totalPlayers

  const posCount = new Map<string, number>()
  for (const r of ratings) posCount.set(r.profile.mainRoleLabel || "未知", (posCount.get(r.profile.mainRoleLabel || "未知") || 0) + 1)
  const topPositions = Array.from(posCount.entries()).sort((a, b) => b[1] - a[1])

  const tagCount = new Map<string, number>()
  for (const r of ratings) for (const tag of r.profile.tags) tagCount.set(tag, (tagCount.get(tag) || 0) + 1)
  const topTags = Array.from(tagCount.entries()).sort((a, b) => b[1] - a[1])

  // blue / red wins
  let blueWins = 0, redWins = 0
  for (const game of enrichedGames.value) {
    if (game.teams.length >= 1 && game.teams[0].win) blueWins++
    if (game.teams.length >= 2 && game.teams[1].win) redWins++
  }

  // rating tier distribution
  const tiers: Record<string, number> = { "通天代": 0, "小代": 0, "小有实力": 0, "普通人": 0, "小坑比": 0, "大坑比": 0 }
  for (const r of ratings) {
    const label = scoreEvaluationLabel(r.profile.overallScore)
    tiers[label] = (tiers[label] || 0) + 1
  }

  const tierColors: Record<string, string> = {
    "通天代": "#a78bfa", "小代": "#818cf8", "小有实力": "#4ade80",
    "普通人": "#facc15", "小坑比": "#fb923c", "大坑比": "#f87171",
  }

  return { totalGames, totalPlayers, avgWinRate, avgOverallScore, avgKdaScore, topPositions, topTags, blueWins, redWins, tiers, tierColors }
})

/* ── table sort / filter ── */
function sortBy(col: string) {
  if (sortColumn.value === col) sortDirection.value = sortDirection.value === "asc" ? "desc" : "asc"
  else { sortColumn.value = col; sortDirection.value = "desc" }
}

function sortIcon(col: string) {
  if (sortColumn.value !== col) return ""
  return sortDirection.value === "asc" ? " ▲" : " ▼"
}

function cmp<T>(a: T, b: T, d: "asc" | "desc") {
  const dir = d === "asc" ? 1 : -1
  return a < b ? -dir : a > b ? dir : 0
}

const filteredAndSortedRatings = computed(() => {
  let list = playerRatings.value
  if (filterText.value) {
    const q = filterText.value.toLowerCase()
    list = list.filter((r) => r.gameName.toLowerCase().includes(q) || r.tagLine.toLowerCase().includes(q))
  }

  const col = sortColumn.value; const dir = sortDirection.value; const ratings = [...list]
  ratings.sort((a, b) => {
    switch (col) {
      case "gameName": return cmp(a.gameName.toLowerCase(), b.gameName.toLowerCase(), dir)
      case "gamesPlayed": return cmp(a.gamesPlayed, b.gamesPlayed, dir)
      case "wins": return cmp(a.wins, b.wins, dir)
      case "winRate": return cmp(winRate(a), winRate(b), dir)
      case "avgKills": return cmp(a.avgKills, b.avgKills, dir)
      case "avgDeaths": return cmp(a.avgDeaths, b.avgDeaths, dir)
      case "kdaScore": return cmp(a.overallKdaScore, b.overallKdaScore, dir)
      case "carry": return cmp(a.profile.abilities.carry.averageScore, b.profile.abilities.carry.averageScore, dir)
      case "frontline": return cmp(a.profile.abilities.frontline.averageScore, b.profile.abilities.frontline.averageScore, dir)
      case "support": return cmp(a.profile.abilities.support.averageScore, b.profile.abilities.support.averageScore, dir)
      case "overallScore": return cmp(a.profile.overallScore, b.profile.overallScore, dir)
      case "highlightGames": return cmp(a.highlightGames, b.highlightGames, dir)
      case "disasterGames": return cmp(a.disasterGames, b.disasterGames, dir)
      case "damageLeader": return cmp(a.damageLeaderCount, b.damageLeaderCount, dir)
      case "mitigationLeader": return cmp(a.mitigationLeaderCount, b.mitigationLeaderCount, dir)
      case "assistLeader": return cmp(a.assistLeaderCount, b.assistLeaderCount, dir)
      case "damageShare": return cmp(avgChampProp(a.championProfiles, (cp) => cp.averageDamageShare), avgChampProp(b.championProfiles, (cp) => cp.averageDamageShare), dir)
      case "mitigationShare": return cmp(avgChampProp(a.championProfiles, (cp) => cp.averageMitigationShare), avgChampProp(b.championProfiles, (cp) => cp.averageMitigationShare), dir)
      case "healingShare": return cmp(avgChampProp(a.championProfiles, (cp) => cp.averageHealingShare), avgChampProp(b.championProfiles, (cp) => cp.averageHealingShare), dir)
      case "damageConversion": return cmp(avgChampProp(a.championProfiles, (cp) => cp.averageDamageConversion), avgChampProp(b.championProfiles, (cp) => cp.averageDamageConversion), dir)
      case "gpm": return cmp(a.avgGpm, b.avgGpm, dir)
      case "dpm": return cmp(a.avgDpm, b.avgDpm, dir)
      case "cspm": return cmp(a.avgCspm, b.avgCspm, dir)
      case "kp": return cmp(a.avgKp, b.avgKp, dir)
      case "killShare": return cmp(a.avgKillShare, b.avgKillShare, dir)
      case "mitigationPerDeath": return cmp(a.avgMitigationPerDeath, b.avgMitigationPerDeath, dir)
      default: return 0
    }
  })
  return ratings
})

function avgChampProp(profiles: ChampionProfile[], fn: (cp: ChampionProfile) => number): number {
  const total = profiles.reduce((s, cp) => s + cp.games, 0)
  return total ? profiles.reduce((s, cp) => s + fn(cp) * cp.games, 0) / total : 0
}

function tierPercent(tier: string): number {
  const s = summaryStats.value
  return s && s.totalPlayers ? (s.tiers[tier] || 0) / s.totalPlayers * 100 : 0
}

const showExtremes = ref(true)

/* ── column max/min markers ── */
const REVERSE_COLS = new Set(["avgDeaths", "disasterGames"])

const columnExtremes = computed(() => {
  const list = filteredAndSortedRatings.value
  if (!list.length) return null
  const ext = new Map<string, { max: number; min: number; maxPuuids: string[]; minPuuids: string[] }>()
  const init = () => ({ max: -Infinity, min: Infinity, maxPuuids: [] as string[], minPuuids: [] as string[] })
  const feed = (col: string, puuid: string, v: number) => {
    if (!ext.has(col)) ext.set(col, init())
    const e = ext.get(col)!
    if (v > e.max) { e.max = v; e.maxPuuids = [puuid] } else if (v === e.max) e.maxPuuids.push(puuid)
    if (v < e.min) { e.min = v; e.minPuuids = [puuid] } else if (v === e.min) e.minPuuids.push(puuid)
  }
  for (const r of list) {
    feed("avgKills", r.puuid, r.avgKills)
    feed("avgDeaths", r.puuid, r.avgDeaths)
    feed("overallKdaScore", r.puuid, r.overallKdaScore)
    feed("carry", r.puuid, r.profile.abilities.carry.averageScore)
    feed("frontline", r.puuid, r.profile.abilities.frontline.averageScore)
    feed("support", r.puuid, r.profile.abilities.support.averageScore)
    feed("damageShare", r.puuid, avgChampProp(r.championProfiles, (cp) => cp.averageDamageShare))
    feed("mitigationShare", r.puuid, avgChampProp(r.championProfiles, (cp) => cp.averageMitigationShare))
    feed("healingShare", r.puuid, avgChampProp(r.championProfiles, (cp) => cp.averageHealingShare))
    feed("damageConversion", r.puuid, avgChampProp(r.championProfiles, (cp) => cp.averageDamageConversion))
    feed("gpm", r.puuid, r.avgGpm)
    feed("dpm", r.puuid, r.avgDpm)
    feed("cspm", r.puuid, r.avgCspm)
    feed("kp", r.puuid, r.avgKp)
    feed("killShare", r.puuid, r.avgKillShare)
    feed("mitigationPerDeath", r.puuid, r.avgMitigationPerDeath)
    feed("highlightGames", r.puuid, r.highlightGames)
    feed("disasterGames", r.puuid, r.disasterGames)
    feed("damageLeaderCount", r.puuid, r.damageLeaderCount)
    feed("mitigationLeaderCount", r.puuid, r.mitigationLeaderCount)
    feed("assistLeaderCount", r.puuid, r.assistLeaderCount)
    feed("overallScore", r.puuid, r.profile.overallScore)
  }
  return ext
})

function cellExtreme(puuid: string, col: string): string {
  if (!showExtremes.value) return ""
  const e = columnExtremes.value?.get(col)
  if (!e) return ""
  const isMaxBest = !REVERSE_COLS.has(col)
  if (e.maxPuuids.includes(puuid)) return isMaxBest ? "cell-best" : "cell-worst"
  if (e.minPuuids.includes(puuid)) return isMaxBest ? "cell-worst" : "cell-best"
  return ""
}

/* ── player ratings (computed from visible games) ── */
function leaderInit() { return { damage: 0, mitigation: 0, assist: 0, damageGames: [] as number[], mitigationGames: [] as number[], assistGames: [] as number[] } }
const honorOrder = ["MVP", "伤害王", "承伤王", "助攻王", "经济王", "KDA王", "控场王"]
function honorInit() { return { "MVP": 0, "伤害王": 0, "承伤王": 0, "助攻王": 0, "经济王": 0, "KDA王": 0, "控场王": 0 } }

const playerRatings = computed<PlayerRating[]>(() => {
  const raw = data.value
  if (!raw) return []
  const games = visibleGames.value
  if (!games.length) return []

  const nameOf = new Map<string, string>()
  const coOpponentGames = new Map<string, number>()
  for (const game of games) {
    const teamOf = new Map<string, number>()
    for (const team of game.teams) {
      for (const p of team.players) {
        nameOf.set(p.puuid, p.gameName)
        teamOf.set(p.puuid, team.teamId)
      }
    }
    const players = [...teamOf.keys()]
    for (let i = 0; i < players.length; i++) {
      for (let j = i + 1; j < players.length; j++) {
        const a = players[i]
        const b = players[j]
        if (teamOf.get(a) === teamOf.get(b)) continue
        const key = a < b ? `${a}|${b}` : `${b}|${a}`
        coOpponentGames.set(key, (coOpponentGames.get(key) || 0) + 1)
      }
    }
  }

  const leaderCounts = new Map<string, ReturnType<typeof leaderInit>>()
  const honorCounts = new Map<string, Record<string, number>>()
  for (const game of games) {
    const allPlayers = game.teams.flatMap((t) => t.players)
    let topDamage = -Infinity, topMitigation = -Infinity, topAssist = -Infinity, topGold = -Infinity, topKda = -Infinity, topControl = -Infinity, topMvp = -Infinity
    let topDamagePuuid = "", topMitigationPuuid = "", topAssistPuuid = "", topGoldPuuid = "", topKdaPuuid = "", topControlPuuid = "", topMvpPuuid = ""
    for (const p of allPlayers) {
      const damageShare = (p.damageToChampions || 0) / Math.max(p.teamDamageToChampions || 0, 1)
      const mitVal = (p.totalDamageTaken || 0) + (p.damageSelfMitigated || 0)
      const mitShare = mitVal / Math.max((p.teamTotalDamageTaken || 0) + (p.teamDamageSelfMitigated || 0), 1)
      const goldShare = (p.goldEarned || 0) / Math.max(p.teamGoldEarned || 0, 1)
      const kda = kdaScore(p.kills, p.deaths, p.assists)
      const control = p.enemyChampionImmobilizations || 0
      const mvpScore = rateGame(p).score
      if (damageShare > topDamage) { topDamage = damageShare; topDamagePuuid = p.puuid }
      if (mitShare > topMitigation) { topMitigation = mitShare; topMitigationPuuid = p.puuid }
      if ((p.assists || 0) > topAssist) { topAssist = p.assists || 0; topAssistPuuid = p.puuid }
      if (goldShare > topGold) { topGold = goldShare; topGoldPuuid = p.puuid }
      if (kda > topKda) { topKda = kda; topKdaPuuid = p.puuid }
      if (control > topControl) { topControl = control; topControlPuuid = p.puuid }
      if (mvpScore > topMvp) { topMvp = mvpScore; topMvpPuuid = p.puuid }
    }
    const recordLeader = (puuid: string, key: "damage" | "mitigation" | "assist") => {
      if (!puuid) return
      if (!leaderCounts.has(puuid)) leaderCounts.set(puuid, leaderInit())
      const l = leaderCounts.get(puuid)!
      if (key === "damage") { l.damage++; l.damageGames.push(game.gameId) }
      else if (key === "mitigation") { l.mitigation++; l.mitigationGames.push(game.gameId) }
      else { l.assist++; l.assistGames.push(game.gameId) }
    }
    recordLeader(topDamagePuuid, "damage")
    recordLeader(topMitigationPuuid, "mitigation")
    recordLeader(topAssistPuuid, "assist")
    const recordHonor = (puuid: string, honor: string) => {
      if (!puuid) return
      if (!honorCounts.has(puuid)) honorCounts.set(puuid, honorInit())
      const h = honorCounts.get(puuid)!
      if (honor in h) h[honor]++
    }
    recordHonor(topMvpPuuid, "MVP")
    recordHonor(topDamagePuuid, "伤害王")
    recordHonor(topMitigationPuuid, "承伤王")
    recordHonor(topAssistPuuid, "助攻王")
    recordHonor(topGoldPuuid, "经济王")
    recordHonor(topKdaPuuid, "KDA王")
    recordHonor(topControlPuuid, "控场王")
  }

  const playerGames = new Map<string, { records: MatchDetailPlayer[]; wins: number }>()
  for (const game of games) {
    for (const team of game.teams) {
      for (const player of team.players) {
        let e = playerGames.get(player.puuid)
        if (!e) { e = { records: [], wins: 0 }; playerGames.set(player.puuid, e) }
        e.records.push(player)
        if (player.win) e.wins++
      }
    }
  }
  const ratings: PlayerRating[] = []
  for (const [, entry] of playerGames) {
    const ctx = { items: itemMap.value, champions: props.champions }
    const profile = buildPlayerProfile(entry.records, ctx, ratingCache)
    const championProfiles = buildChampionProfiles(entry.records, ctx, ratingCache)
    const player = entry.records[0]
    const n = entry.records.length
    if (n < minGameCount.value) continue
    const totalK = entry.records.reduce((s, r) => s + r.kills, 0)
    const totalD = entry.records.reduce((s, r) => s + r.deaths, 0)
    const totalA = entry.records.reduce((s, r) => s + r.assists, 0)
    const avgK = totalK / n; const avgD = totalD / n; const avgA = totalA / n
    const lead = leaderCounts.get(player.puuid) || leaderInit()
    const gameRecords: PlayerGameRecord[] = entry.records.map((r) => {
      const dmgShare = (r.damageToChampions || 0) / Math.max(r.teamDamageToChampions || 0, 1)
      const mitVal = (r.totalDamageTaken || 0) + (r.damageSelfMitigated || 0)
      const mitShare = mitVal / Math.max((r.teamTotalDamageTaken || 0) + (r.teamDamageSelfMitigated || 0), 1)
      const minutes = Math.max((r.gameDuration || 0) / 60, 1)
      const score = rateGame(r).score
      const goldShare = (r.goldEarned || 0) / Math.max(r.teamGoldEarned || 0, 1)
      return { gameId: r.gameId, championId: r.championId, kills: r.kills, deaths: r.deaths, assists: r.assists, win: r.win, gameDuration: r.gameDuration, damageShare: dmgShare, mitigationShare: mitShare, score, gpm: (r.goldEarned || 0) / minutes, dpm: (r.damageToChampions || 0) / minutes, cspm: (r.cs || 0) / minutes, kp: ((r.kills || 0) + (r.assists || 0)) / Math.max(r.teamKills || 0, 1), killShare: (r.kills || 0) / Math.max(r.teamKills || 0, 1), goldShare, mitigationPerDeath: mitVal / Math.max(r.deaths || 0, 1) }
    })
    const avgGpm = avgValues(gameRecords.map((r) => r.gpm))
    const avgDpm = avgValues(gameRecords.map((r) => r.dpm))
    const avgCspm = avgValues(gameRecords.map((r) => r.cspm))
    const avgKp = avgValues(gameRecords.map((r) => r.kp))
    const avgKillShare = avgValues(gameRecords.map((r) => r.killShare))
    const avgMitigationPerDeath = avgValues(gameRecords.map((r) => r.mitigationPerDeath))
    const trend: TrendPoint[] = [...entry.records].sort((a, b) => a.gameCreation - b.gameCreation).map((r) => {
      const minutes = Math.max((r.gameDuration || 0) / 60, 1)
      return {
        gameId: r.gameId, championId: r.championId,
        kills: r.kills, deaths: r.deaths, assists: r.assists,
        win: r.win, gameDuration: r.gameDuration, gameCreation: r.gameCreation,
        score: rateGame(r).score,
        kda: kdaScore(r.kills, r.deaths, r.assists),
        damageShare: (r.damageToChampions || 0) / Math.max(r.teamDamageToChampions || 0, 1),
        dpm: (r.damageToChampions || 0) / minutes,
      }
    })
    const victimAgg = new Map<string, { kills: number; assists: number }>()
    for (const r of entry.records) {
      for (const kr of r.killRelations || []) {
        const e = victimAgg.get(kr.victimPuuid) || { kills: 0, assists: 0 }
        e.kills += kr.kills
        e.assists += kr.assists
        victimAgg.set(kr.victimPuuid, e)
      }
    }
    const killMap: PlayerKillMapEntry[] = [...victimAgg.entries()]
      .map(([puuid, v]) => {
        const pair = player.puuid < puuid ? `${player.puuid}|${puuid}` : `${puuid}|${player.puuid}`
        const games = coOpponentGames.get(pair) || 0
        return {
          puuid,
          name: nameOf.get(puuid) || puuid,
          kills: v.kills,
          assists: v.assists,
          games,
          avgKills: games > 0 ? v.kills / games : 0,
        }
      })
      .sort((a, b) => b.kills - a.kills || b.avgKills - a.avgKills || b.assists - a.assists)
    ratings.push({
      puuid: player.puuid, gameName: player.gameName, tagLine: player.tagLine,
      summonerName: player.summonerName, gamesPlayed: n, wins: entry.wins,
      profile, recentChampionIds: entry.records.map((r) => r.championId), championProfiles, gameRecords,
      avgKills: avgK, avgDeaths: avgD, avgAssists: avgA,
      overallKdaScore: kdaScore(avgK, avgD, avgA),
      avgGpm, avgDpm, avgCspm, avgKp, avgKillShare, avgMitigationPerDeath,
      honors: honorCounts.get(player.puuid) || honorInit(),
      trend,
      killMap,
      highlightGames: gameRecords.filter((r) => r.score >= 80).length,
      disasterGames: gameRecords.filter((r) => r.score < 60).length,
      damageLeaderCount: lead.damage, mitigationLeaderCount: lead.mitigation, assistLeaderCount: lead.assist,
      leaderGameIds: { damage: lead.damageGames, mitigation: lead.mitigationGames, assist: lead.assistGames },
    })
  }
  return ratings.sort((a, b) => b.profile.overallScore - a.profile.overallScore)
})

// 数据刷新后同步玩家详情抽屉内容，避免展示旧数据
watch(playerRatings, (list) => {
  if (!drawerPlayer.value) return
  const fresh = list.find((r) => r.puuid === drawerPlayer.value!.puuid)
  if (fresh) drawerPlayer.value = fresh
  else drawerPlayer.value = null
})

/* ── load ── */
async function load() {
  loading.value = true; error.value = ""
  // 保留 localStorage 中已删除的对局，不清空
  data.value = null
  try {
    data.value = await loadTodayCustomGames(rangeStartMs.value, rangeEndMs.value, customOnly.value)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally { loading.value = false }
}

onMounted(load)

/* ── 英雄/海克斯统计模块 ── */
interface StatPlayerRow { puuid: string; gameName: string; picks: number; wins: number; winRate: number }
interface ChampionStatEntry {
  championId: number
  name: string
  picks: number
  wins: number
  winRate: number
  players: StatPlayerRow[]
  favorite: { gameName: string; picks: number } | null
  best: { gameName: string; picks: number; winRate: number } | null
  worst: { gameName: string; picks: number; winRate: number } | null
}
interface AugmentStatEntry {
  id: number
  name: string
  picks: number
  wins: number
  winRate: number
  topPlayer: { gameName: string; picks: number } | null
  players: StatPlayerRow[]
}

interface ItemStatEntry {
  id: number
  name: string
  picks: number
  wins: number
  winRate: number
  topPlayer: { gameName: string; picks: number } | null
  players: StatPlayerRow[]
}

function addPlayerStat(list: StatPlayerRow[], puuid: string, gameName: string, win: boolean): number {
  let pl = list.find((x) => x.puuid === puuid)
  if (!pl) { pl = { puuid, gameName, picks: 0, wins: 0, winRate: 0 }; list.push(pl) }
  pl.picks++
  if (win) pl.wins++
  return list.length
}

const championStat = computed<ChampionStatEntry[]>(() => {
  const map = new Map<number, ChampionStatEntry>()
  for (const game of visibleGames.value) {
    for (const team of game.teams) {
      for (const p of team.players) {
        let e = map.get(p.championId)
        if (!e) {
          e = { championId: p.championId, name: championName(props.champions, p.championId), picks: 0, wins: 0, winRate: 0, players: [], favorite: null, best: null, worst: null }
          map.set(p.championId, e)
        }
        e.picks++
        if (p.win) e.wins++
        addPlayerStat(e.players, p.puuid, p.gameName, p.win)
      }
    }
  }
  for (const e of map.values()) {
    e.winRate = e.picks ? (e.wins / e.picks) * 100 : 0
    for (const pl of e.players) pl.winRate = pl.picks ? (pl.wins / pl.picks) * 100 : 0
    e.players.sort((a, b) => b.picks - a.picks)
    e.favorite = e.players.length ? { gameName: e.players[0].gameName, picks: e.players[0].picks } : null
    if (e.players.length) {
      const bestPool =
        championBestMinPicks.value > 0
          ? e.players.filter((pl) => pl.picks >= championBestMinPicks.value)
          : e.players
      const worstPool =
        championWorstMinPicks.value > 0
          ? e.players.filter((pl) => pl.picks >= championWorstMinPicks.value)
          : e.players
      const best = [...bestPool].sort((a, b) => b.winRate - a.winRate || b.picks - a.picks)[0]
      if (best) e.best = { gameName: best.gameName, picks: best.picks, winRate: best.winRate }
      else e.best = null
      const worstCandidates = worstPool.filter((pl) => !best || pl.puuid !== best.puuid)
      const worst = [...(worstCandidates.length ? worstCandidates : worstPool)].sort(
        (a, b) => a.winRate - b.winRate || b.picks - a.picks
      )[0]
      if (worst) e.worst = { gameName: worst.gameName, picks: worst.picks, winRate: worst.winRate }
      else e.worst = null
    }
  }
  return [...map.values()].sort((a, b) => b.picks - a.picks)
})

const augmentStat = computed<AugmentStatEntry[]>(() => {
  const map = new Map<number, AugmentStatEntry>()
  for (const game of visibleGames.value) {
    for (const team of game.teams) {
      for (const p of team.players) {
        for (const aid of p.augmentIds || []) {
          if (aid <= 0) continue
          let e = map.get(aid)
          if (!e) {
            e = { id: aid, name: augmentName(aid), picks: 0, wins: 0, winRate: 0, topPlayer: null, players: [] }
            map.set(aid, e)
          }
          e.picks++
          if (p.win) e.wins++
          addPlayerStat(e.players, p.puuid, p.gameName, p.win)
        }
      }
    }
  }
  for (const e of map.values()) {
    e.winRate = e.picks ? (e.wins / e.picks) * 100 : 0
    for (const pl of e.players) pl.winRate = pl.picks ? (pl.wins / pl.picks) * 100 : 0
    e.players.sort((a, b) => b.picks - a.picks)
    e.topPlayer = e.players.length ? { gameName: e.players[0].gameName, picks: e.players[0].picks } : null
  }
  return [...map.values()].sort((a, b) => b.picks - a.picks)
})

const EXCLUDED_ITEM_IDS = new Set([2050])
const EXCLUDED_ITEM_NAMES = ["魄罗佳肴"]

const itemStat = computed<ItemStatEntry[]>(() => {
  const map = new Map<number, ItemStatEntry>()
  for (const game of visibleGames.value) {
    for (const team of game.teams) {
      for (const p of team.players) {
        for (const iid of p.itemIds || []) {
          if (iid <= 0) continue
          const itemName = itemMap.value[iid]?.name || ""
          if (EXCLUDED_ITEM_IDS.has(iid) || EXCLUDED_ITEM_NAMES.some((n) => itemName.includes(n))) continue
          let e = map.get(iid)
          if (!e) {
            e = { id: iid, name: itemName || `装备 ${iid}`, picks: 0, wins: 0, winRate: 0, topPlayer: null, players: [] }
            map.set(iid, e)
          }
          e.picks++
          if (p.win) e.wins++
          addPlayerStat(e.players, p.puuid, p.gameName, p.win)
        }
      }
    }
  }
  for (const e of map.values()) {
    e.winRate = e.picks ? (e.wins / e.picks) * 100 : 0
    for (const pl of e.players) pl.winRate = pl.picks ? (pl.wins / pl.picks) * 100 : 0
    e.players.sort((a, b) => b.picks - a.picks)
    e.topPlayer = e.players.length ? { gameName: e.players[0].gameName, picks: e.players[0].picks } : null
  }
  return [...map.values()].sort((a, b) => b.picks - a.picks)
})

/* ── 玩家组队搭档统计模块 ── */
interface TeammatePairRow {
  puuid: string
  gameName: string
  games: number
  wins: number
  winRate: number
  recent: boolean[]
}

const teamSectionVisible = ref(false)
const teamMode = ref<"teammate" | "opponent">("teammate")
const targetPuuid = ref("")
const teamMinGames = ref(0)
const teamMinGamesText = ref("")
const teamMinWinRate = ref(0)
const teamMinWinRateText = ref("")
function applyTeamMinGames() {
  const v = parseInt(teamMinGamesText.value, 10)
  teamMinGames.value = Number.isFinite(v) && v > 0 ? v : 0
}
function applyTeamMinWinRate() {
  const v = parseFloat(teamMinWinRateText.value)
  teamMinWinRate.value = Number.isFinite(v) && v > 0 ? Math.min(100, v) : 0
}

const teamPlayers = computed(() => {
  const map = new Map<string, { puuid: string; gameName: string; games: number; wins: number }>()
  for (const game of visibleGames.value) {
    for (const team of game.teams) {
      for (const p of team.players) {
        const e = map.get(p.puuid)
        if (e) { e.games++; if (p.win) e.wins++ }
        else map.set(p.puuid, { puuid: p.puuid, gameName: p.gameName, games: 1, wins: p.win ? 1 : 0 })
      }
    }
  }
  return [...map.values()].sort((a, b) => b.games - a.games || a.gameName.localeCompare(b.gameName))
})

const teamTarget = computed(() => teamPlayers.value.find((p) => p.puuid === targetPuuid.value) || teamPlayers.value[0] || null)

const targetStat = computed(() => {
  const target = teamTarget.value
  if (!target) return null
  return { ...target, winRate: target.games ? (target.wins / target.games) * 100 : 0 }
})

const teamPairRows = computed<TeammatePairRow[]>(() => {
  const target = teamTarget.value
  if (!target) return []
  const map = new Map<string, TeammatePairRow>()
  const history = new Map<string, { win: boolean; gameCreation: number }[]>()
  for (const game of visibleGames.value) {
    const myTeam = game.teams.find((t) => t.players.some((p) => p.puuid === target.puuid))
    if (!myTeam) continue
    const myWin = myTeam.win
    for (const team of game.teams) {
      const isMate = team.teamId === myTeam.teamId
      if (teamMode.value === "teammate" && !isMate) continue
      if (teamMode.value === "opponent" && isMate) continue
      for (const p of team.players) {
        if (p.puuid === target.puuid) continue
        if (!map.has(p.puuid)) {
          map.set(p.puuid, { puuid: p.puuid, gameName: p.gameName, games: 0, wins: 0, winRate: 0, recent: [] })
          history.set(p.puuid, [])
        }
        const e = map.get(p.puuid)!
        e.games++
        if (myWin) e.wins++
        history.get(p.puuid)!.push({ win: myWin, gameCreation: game.gameCreation })
      }
    }
  }
  for (const [puuid, e] of map) {
    e.winRate = e.games ? (e.wins / e.games) * 100 : 0
    e.recent = (history.get(puuid) || []).sort((a, b) => a.gameCreation - b.gameCreation).slice(-5).map((h) => h.win)
  }
  return [...map.values()]
})

const teamQualifiedRows = computed(() => {
  const mp = teamMinGames.value
  const wr = teamMinWinRate.value
  return teamPairRows.value.filter((r) => (mp <= 0 || r.games >= mp) && (wr <= 0 || r.winRate >= wr))
})

watch(targetStat, (target) => {
  if (!targetPuuid.value || !teamPlayers.value.some((p) => p.puuid === targetPuuid.value)) {
    targetPuuid.value = target?.puuid || ""
  }
})

const teamSortColumn = ref<"games" | "wins" | "winRate">("winRate")
const teamSortDir = ref<"asc" | "desc">("desc")
function toggleTeamSort(col: "games" | "wins" | "winRate") {
  if (teamSortColumn.value === col) teamSortDir.value = teamSortDir.value === "asc" ? "desc" : "asc"
  else { teamSortColumn.value = col; teamSortDir.value = "desc" }
}
function teamSortIcon(col: "games" | "wins" | "winRate") {
  if (teamSortColumn.value !== col) return ""
  return teamSortDir.value === "asc" ? " ▲" : " ▼"
}
const teamSortedRows = computed(() => {
  const col = teamSortColumn.value
  const m = teamSortDir.value === "asc" ? 1 : -1
  return [...teamQualifiedRows.value].sort((a, b) => {
    const av = col === "games" ? a.games : col === "wins" ? a.wins : a.winRate
    const bv = col === "games" ? b.games : col === "wins" ? b.wins : b.winRate
    return (av - bv) * m || b.games - a.games || a.gameName.localeCompare(b.gameName)
  })
})
const teamSampleInsufficient = computed(() => {
  const mp = teamMinGames.value
  const wr = teamMinWinRate.value
  if (mp <= 0 && wr <= 0) return 0
  return teamPairRows.value.filter((r) => (mp > 0 && r.games < mp) || (wr > 0 && r.winRate < wr)).length
})

function switchTeamTarget(puuid: string) { targetPuuid.value = puuid }

const statHasData = computed(() => championStat.value.length > 0 || augmentStat.value.length > 0 || itemStat.value.length > 0)

const drawerChampionId = ref<number | null>(null)
const drawerGames = computed(() => visibleGames.value)
const drawerChampionMeta = computed(() => {
  const id = drawerChampionId.value
  const entry = id != null ? championStat.value.find((c) => c.championId === id) : null
  return entry ? entry : null
})

function openChampionDrawer(championId: number) {
  drawerChampionId.value = championId
}
function closeChampionDrawer() {
  drawerChampionId.value = null
}

const championSort = ref<"picks" | "winRate" | "name">("picks")
const championSortDir = ref<"asc" | "desc">("desc")
const augmentSort = ref<"picks" | "winRate">("picks")
const augmentSortDir = ref<"asc" | "desc">("desc")
const championSearch = ref("")
const augmentSearch = ref("")
const championMinPicks = ref(0)
const championMinPicksText = ref("")
const championBestMinPicks = ref(2)
const championBestMinPicksText = ref("2")
const championWorstMinPicks = ref(2)
const championWorstMinPicksText = ref("2")
const augmentMinPicks = ref(0)
const augmentMinPicksText = ref("")
const itemSort = ref<"picks" | "winRate">("picks")
const itemSortDir = ref<"asc" | "desc">("desc")
const itemSearch = ref("")
const itemMinPicks = ref(0)
const itemMinPicksText = ref("")
const itemSectionVisible = ref(false)
const onlyCompletedItems = ref(false)

function applyChampionMinPicks() {
  const v = parseInt(championMinPicksText.value, 10)
  championMinPicks.value = Number.isFinite(v) && v > 0 ? v : 0
}
function applyChampionBestMinPicks() {
  const v = parseInt(championBestMinPicksText.value, 10)
  championBestMinPicks.value = Number.isFinite(v) && v > 0 ? v : 0
}
function applyChampionWorstMinPicks() {
  const v = parseInt(championWorstMinPicksText.value, 10)
  championWorstMinPicks.value = Number.isFinite(v) && v > 0 ? v : 0
}
function applyAugmentMinPicks() {
  const v = parseInt(augmentMinPicksText.value, 10)
  augmentMinPicks.value = Number.isFinite(v) && v > 0 ? v : 0
}
function applyItemMinPicks() {
  const v = parseInt(itemMinPicksText.value, 10)
  itemMinPicks.value = Number.isFinite(v) && v > 0 ? v : 0
}

function toggleChampionSort(col: "picks" | "winRate") {
  if (championSort.value === col) championSortDir.value = championSortDir.value === "asc" ? "desc" : "asc"
  else { championSort.value = col; championSortDir.value = "desc" }
}
function championSortIcon(col: "picks" | "winRate") {
  if (championSort.value !== col) return ""
  return championSortDir.value === "asc" ? " ▲" : " ▼"
}
function toggleAugmentSort(col: "picks" | "winRate") {
  if (augmentSort.value === col) augmentSortDir.value = augmentSortDir.value === "asc" ? "desc" : "asc"
  else { augmentSort.value = col; augmentSortDir.value = "desc" }
}
function augmentSortIcon(col: "picks" | "winRate") {
  if (augmentSort.value !== col) return ""
  return augmentSortDir.value === "asc" ? " ▲" : " ▼"
}
function toggleItemSort(col: "picks" | "winRate") {
  if (itemSort.value === col) itemSortDir.value = itemSortDir.value === "asc" ? "desc" : "asc"
  else { itemSort.value = col; itemSortDir.value = "desc" }
}
function itemSortIcon(col: "picks" | "winRate") {
  if (itemSort.value !== col) return ""
  return itemSortDir.value === "asc" ? " ▲" : " ▼"
}

const sortedChampionStat = computed(() => {
  let arr = championStat.value
  const q = championSearch.value.trim().toLowerCase()
  if (q) arr = arr.filter((e) => e.name.toLowerCase().includes(q))
  const mp = championMinPicks.value
  if (mp > 0) arr = arr.filter((e) => e.picks >= mp)
  const list = [...arr]
  const m = championSortDir.value === "asc" ? 1 : -1
  if (championSort.value === "winRate") list.sort((a, b) => (a.winRate - b.winRate) * m || b.picks - a.picks)
  else if (championSort.value === "name") list.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))
  else list.sort((a, b) => (a.picks - b.picks) * m)
  return list
})

const sortedAugmentStat = computed(() => {
  let arr = augmentStat.value
  const q = augmentSearch.value.trim().toLowerCase()
  if (q) arr = arr.filter((e) => e.name.toLowerCase().includes(q))
  const mp = augmentMinPicks.value
  if (mp > 0) arr = arr.filter((e) => e.picks >= mp)
  const list = [...arr]
  const m = augmentSortDir.value === "asc" ? 1 : -1
  if (augmentSort.value === "winRate") list.sort((a, b) => (a.winRate - b.winRate) * m || b.picks - a.picks)
  else list.sort((a, b) => (a.picks - b.picks) * m)
  return list
})

const sortedItemStat = computed(() => {
  let arr = itemStat.value
  const q = itemSearch.value.trim().toLowerCase()
  if (q) arr = arr.filter((e) => e.name.toLowerCase().includes(q))
  const mp = itemMinPicks.value
  if (mp > 0) arr = arr.filter((e) => e.picks >= mp)
  if (onlyCompletedItems.value) {
    arr = arr.filter((e) => {
      const asset = itemMap.value[e.id]
      return asset && asset.from.length > 0 && asset.to.length === 0 && !asset.categories.includes("Consumable") && !asset.categories.includes("Trinket")
    })
  }
  const list = [...arr]
  const m = itemSortDir.value === "asc" ? 1 : -1
  if (itemSort.value === "winRate") list.sort((a, b) => (a.winRate - b.winRate) * m || b.picks - a.picks)
  else list.sort((a, b) => (a.picks - b.picks) * m)
  return list
})

function winRateClass(v: number) { return v >= 60 ? "sc-high" : v >= 50 ? "sc-mid" : "sc-low" }

/* ── 荣誉墙 / 阵容搭档 ── */
const honorWall = computed(() => {
  const rows: { honor: string; players: { gameName: string; puuid: string; count: number }[] }[] = []
  for (const honor of honorOrder) {
    const list = playerRatings.value
      .map((r) => ({ gameName: r.gameName, puuid: r.puuid, count: r.honors[honor] || 0 }))
      .filter((x) => x.count > 0)
      .sort((a, b) => b.count - a.count || a.gameName.localeCompare(b.gameName))
    rows.push({ honor, players: list.slice(0, 3) })
  }
  return rows
})

/* ── 击杀与被击杀榜：按选定玩家展示双向击杀关系 ── */
interface VendettaSideRow {
  puuid: string
  name: string
  kills: number
  assists: number
  /** 双方同场且互为对手的对局数 */
  games: number
  /** 对位场次内的场均击杀数 */
  avgKills: number
}
const vendettaSectionVisible = ref(false)
const vendettaPuuid = ref("")

/** 出现过击杀关系（作为杀手或受害者）的玩家列表，按下拉菜单展示。 */
const vendettaPlayers = computed(() => {
  const gamesMap = new Map<string, { puuid: string; name: string; games: number }>()
  const killerSet = new Set<string>()
  const victimSet = new Set<string>()
  for (const game of visibleGames.value) {
    for (const team of game.teams) {
      for (const p of team.players) {
        let e = gamesMap.get(p.puuid)
        if (!e) {
          e = { puuid: p.puuid, name: p.gameName, games: 0 }
          gamesMap.set(p.puuid, e)
        }
        e.games++
        for (const kr of p.killRelations || []) {
          killerSet.add(p.puuid)
          victimSet.add(kr.victimPuuid)
        }
      }
    }
  }
  return [...gamesMap.values()]
    .filter((e) => killerSet.has(e.puuid) || victimSet.has(e.puuid))
    .sort((a, b) => b.games - a.games || a.name.localeCompare(b.name))
})

watch(vendettaPlayers, (list) => {
  if (!list.some((p) => p.puuid === vendettaPuuid.value)) vendettaPuuid.value = list[0]?.puuid || ""
})

/** 选定玩家的击杀榜（我杀谁）与被击杀榜（谁杀我）。 */
const vendettaTarget = computed(() => {
  const target = vendettaPuuid.value
  const nameOf = new Map<string, string>()
  for (const game of visibleGames.value) {
    for (const team of game.teams) {
      for (const p of team.players) nameOf.set(p.puuid, p.gameName)
    }
  }
  const killsMap = new Map<string, { kills: number; assists: number }>()
  const deathsMap = new Map<string, { kills: number; assists: number }>()
  // 双方同场且互为对手的对局数（对位场次，作为场均击杀的分母）
  const coOpponentGames = new Map<string, number>()
  for (const game of visibleGames.value) {
    const teamOf = new Map<string, number>()
    for (const team of game.teams) {
      for (const p of team.players) teamOf.set(p.puuid, team.teamId)
    }
    const players = [...teamOf.keys()]
    for (let i = 0; i < players.length; i++) {
      for (let j = i + 1; j < players.length; j++) {
        const a = players[i]
        const b = players[j]
        if (teamOf.get(a) === teamOf.get(b)) continue
        const key = a < b ? `${a}|${b}` : `${b}|${a}`
        coOpponentGames.set(key, (coOpponentGames.get(key) || 0) + 1)
      }
    }
    for (const team of game.teams) {
      for (const p of team.players) {
        for (const kr of p.killRelations || []) {
          if (p.puuid === target) {
            const e = killsMap.get(kr.victimPuuid) || { kills: 0, assists: 0 }
            e.kills += kr.kills
            e.assists += kr.assists
            killsMap.set(kr.victimPuuid, e)
          }
          if (kr.victimPuuid === target) {
            const e = deathsMap.get(p.puuid) || { kills: 0, assists: 0 }
            e.kills += kr.kills
            e.assists += kr.assists
            deathsMap.set(p.puuid, e)
          }
        }
      }
    }
  }
  const pairKey = (other: string) => (target < other ? `${target}|${other}` : `${other}|${target}`)
  const toRows = (map: Map<string, { kills: number; assists: number }>): VendettaSideRow[] =>
    [...map.entries()].map(([puuid, v]) => {
      const games = coOpponentGames.get(pairKey(puuid)) || 0
      return {
        puuid,
        name: nameOf.get(puuid) || puuid,
        kills: v.kills,
        assists: v.assists,
        games,
        avgKills: games > 0 ? v.kills / games : 0,
      }
    })
  const kills = sortVendettaRows(toRows(killsMap).filter((r) => r.games >= vendettaMinGames.value))
  const deaths = sortVendettaRows(toRows(deathsMap).filter((r) => r.games >= vendettaMinGames.value))
  return {
    kills,
    deaths,
    totalKills: kills.reduce((s, r) => s + r.kills, 0),
    totalDeaths: deaths.reduce((s, r) => s + r.kills, 0),
  }
})

/** 击杀/被击杀榜排序：默认按击杀数（并列按助攻），可切换为按场均击杀。 */
const vendettaSort = ref<"kills" | "avg">("kills")
const vendettaSortDir = ref<"asc" | "desc">("desc")
const vendettaMinGames = ref(0)
const vendettaMinGamesText = ref("")
function applyVendettaMinGames() {
  const v = parseInt(vendettaMinGamesText.value, 10)
  vendettaMinGames.value = Number.isFinite(v) && v > 0 ? v : 0
}
function toggleVendettaSort(col: "kills" | "avg") {
  if (vendettaSort.value === col) vendettaSortDir.value = vendettaSortDir.value === "asc" ? "desc" : "asc"
  else { vendettaSort.value = col; vendettaSortDir.value = "desc" }
}
function vendettaSortIcon(col: "kills" | "avg") {
  if (vendettaSort.value !== col) return ""
  return vendettaSortDir.value === "asc" ? " ▲" : " ▼"
}
function sortVendettaRows(rows: VendettaSideRow[]): VendettaSideRow[] {
  const m = vendettaSortDir.value === "asc" ? 1 : -1
  return [...rows].sort((a, b) => {
    const av = vendettaSort.value === "avg" ? a.avgKills : a.kills
    const bv = vendettaSort.value === "avg" ? b.avgKills : b.kills
    return (av - bv) * m || b.kills - a.kills || b.assists - a.assists
  })
}

/* ── 海克斯级别与刷新统计 ── */
interface AugTierComboRow {
  key: string
  parts: string[]
  count: number
}
const augmentTierSectionVisible = ref(false)
const augComboSortDir = ref<"asc" | "desc">("desc")

function toggleAugComboSort() {
  augComboSortDir.value = augComboSortDir.value === "asc" ? "desc" : "asc"
}
function augComboSortIcon() {
  return augComboSortDir.value === "asc" ? " ▲" : " ▼"
}

function augmentTierOf(id: number): string {
  const rarity = augmentMap.value[id]?.rarity || ""
  if (rarity === "kPrismatic") return "彩"
  if (rarity === "kGold") return "金"
  if (rarity === "kSilver") return "银"
  // 海克斯大乱斗仅存在 银/金/彩 三档；其余按未知处理（不参与三档概率）
  return "未知"
}

interface AugTierPosStat {
  total: number
  prismatic: number
  gold: number
  silver: number
}
function emptyPosStat(): AugTierPosStat {
  return { total: 0, prismatic: 0, gold: 0, silver: 0 }
}

const augmentTierStats = computed(() => {
  const games = visibleGames.value
  const posAgg = [emptyPosStat(), emptyPosStat(), emptyPosStat(), emptyPosStat()]
  const comboMap = new Map<string, AugTierComboRow>()
  const tierTotals: Record<string, number> = { 彩: 0, 金: 0, 银: 0, 未知: 0 }
  let totalPicks = 0
  let goldSlotPicks = 0
  let refreshCount = 0
  const refreshGames = new Set<number>()
  let silverSlotPicks = 0
  let goldRefreshCount = 0
  const goldRefreshGames = new Set<number>()

  for (const game of games) {
    const gamePos = [emptyPosStat(), emptyPosStat(), emptyPosStat(), emptyPosStat()]
    const seqs: string[][] = []
    for (const team of game.teams) {
      for (const p of team.players) {
        // augmentIds 按选择顺序排列；对局提前结束则第 2/3/4 个缺失
        const tiers = (p.augmentIds || []).slice(0, 4).map(augmentTierOf)
        if (!tiers.length) continue
        seqs.push(tiers)
        tiers.forEach((t, i) => {
          gamePos[i].total++
          if (t === "彩") gamePos[i].prismatic++
          else if (t === "金") gamePos[i].gold++
          else if (t === "银") gamePos[i].silver++
        })
        const key = tiers.join("")
        let c = comboMap.get(key)
        if (!c) {
          c = { key, parts: [...tiers], count: 0 }
          comboMap.set(key, c)
        }
        c.count++
      }
    }
    // 该局每个位置多数为金时，即"金槽"（存在棱彩刷新机会）；多数为银时即"银槽"（存在金色刷新机会）
    const majorityGold = gamePos.map((pos) => {
      if (!pos.total) return false
      return pos.gold >= pos.prismatic && pos.gold >= pos.silver
    })
    const majoritySilver = gamePos.map((pos) => {
      if (!pos.total) return false
      return pos.silver > pos.gold && pos.silver >= pos.prismatic
    })
    let gameRefresh = false
    let gameGoldRefresh = false
    for (const tiers of seqs) {
      tiers.forEach((t, i) => {
        posAgg[i].total++
        if (t === "彩") posAgg[i].prismatic++
        else if (t === "金") posAgg[i].gold++
        else if (t === "银") posAgg[i].silver++
        totalPicks++
        tierTotals[t] = (tierTotals[t] || 0) + 1
        if (majorityGold[i]) {
          goldSlotPicks++
          if (t === "彩") {
            refreshCount++
            gameRefresh = true
          }
        }
        if (majoritySilver[i]) {
          silverSlotPicks++
          if (t === "金") {
            goldRefreshCount++
            gameGoldRefresh = true
          }
        }
      })
    }
    if (gameRefresh) refreshGames.add(game.gameId)
    if (gameGoldRefresh) goldRefreshGames.add(game.gameId)
  }

  const combos = [...comboMap.values()].sort((a, b) => b.count - a.count)
  return {
    posAgg,
    combos,
    tierTotals,
    totalPicks,
    totalCombos: combos.reduce((s, c) => s + c.count, 0),
    goldSlotPicks,
    refreshCount,
    refreshGames: refreshGames.size,
    totalGames: games.length,
    refreshRate: goldSlotPicks > 0 ? refreshCount / goldSlotPicks : 0,
    silverSlotPicks,
    goldRefreshCount,
    goldRefreshGames: goldRefreshGames.size,
    goldRefreshRate: silverSlotPicks > 0 ? goldRefreshCount / silverSlotPicks : 0,
  }
})

const sortedAugCombos = computed(() => {
  const m = augComboSortDir.value === "asc" ? 1 : -1
  return [...augmentTierStats.value.combos].sort((a, b) => (a.count - b.count) * m)
})

function tierPctStr(part: number, total: number) {
  return total > 0 ? `${((part / total) * 100).toFixed(1)}%` : "-"
}

function parseMinGamesText(text: string) {
  const v = parseInt(text, 10)
  return Number.isFinite(v) && v > 0 ? v : 0
}
function parseMinWinRateText(text: string) {
  const v = parseFloat(text)
  return Number.isFinite(v) && v > 0 ? Math.min(100, v) : 0
}

const comboTeamMinGames = ref(2)
const comboTeamMinGamesText = ref("2")
const comboTeamMinWinRate = ref(0)
const comboTeamMinWinRateText = ref("")
const comboDuoMinGames = ref(0)
const comboDuoMinGamesText = ref("")
const comboDuoMinWinRate = ref(0)
const comboDuoMinWinRateText = ref("")
const comboTrioMinGames = ref(0)
const comboTrioMinGamesText = ref("")
const comboTrioMinWinRate = ref(0)
const comboTrioMinWinRateText = ref("")

function applyComboTeamMinGames() { comboTeamMinGames.value = parseMinGamesText(comboTeamMinGamesText.value) }
function applyComboTeamMinWinRate() { comboTeamMinWinRate.value = parseMinWinRateText(comboTeamMinWinRateText.value) }
function applyComboDuoMinGames() { comboDuoMinGames.value = parseMinGamesText(comboDuoMinGamesText.value) }
function applyComboDuoMinWinRate() { comboDuoMinWinRate.value = parseMinWinRateText(comboDuoMinWinRateText.value) }
function applyComboTrioMinGames() { comboTrioMinGames.value = parseMinGamesText(comboTrioMinGamesText.value) }
function applyComboTrioMinWinRate() { comboTrioMinWinRate.value = parseMinWinRateText(comboTrioMinWinRateText.value) }

const comboTeamSort = ref<"games" | "winRate">("games")
const comboTeamSortDir = ref<"asc" | "desc">("desc")
const comboDuoSort = ref<"games" | "winRate">("games")
const comboDuoSortDir = ref<"asc" | "desc">("desc")
const comboTrioSort = ref<"games" | "winRate">("games")
const comboTrioSortDir = ref<"asc" | "desc">("desc")
function toggleComboTeamSort(col: "games" | "winRate") {
  if (comboTeamSort.value === col) comboTeamSortDir.value = comboTeamSortDir.value === "asc" ? "desc" : "asc"
  else { comboTeamSort.value = col; comboTeamSortDir.value = "desc" }
}
function comboTeamSortIcon(col: "games" | "winRate") {
  if (comboTeamSort.value !== col) return ""
  return comboTeamSortDir.value === "asc" ? " ▲" : " ▼"
}
function toggleComboDuoSort(col: "games" | "winRate") {
  if (comboDuoSort.value === col) comboDuoSortDir.value = comboDuoSortDir.value === "asc" ? "desc" : "asc"
  else { comboDuoSort.value = col; comboDuoSortDir.value = "desc" }
}
function comboDuoSortIcon(col: "games" | "winRate") {
  if (comboDuoSort.value !== col) return ""
  return comboDuoSortDir.value === "asc" ? " ▲" : " ▼"
}
function toggleComboTrioSort(col: "games" | "winRate") {
  if (comboTrioSort.value === col) comboTrioSortDir.value = comboTrioSortDir.value === "asc" ? "desc" : "asc"
  else { comboTrioSort.value = col; comboTrioSortDir.value = "desc" }
}
function comboTrioSortIcon(col: "games" | "winRate") {
  if (comboTrioSort.value !== col) return ""
  return comboTrioSortDir.value === "asc" ? " ▲" : " ▼"
}
function comboKey(puuids: string[]) { return [...puuids].sort().join("|") }
function addCombo(map: Map<string, { members: string[]; games: number; wins: number }>, puuids: string[], win: boolean) {
  if (puuids.length < 2) return
  const key = comboKey(puuids)
  const e = map.get(key) || { members: puuids.slice().sort(), games: 0, wins: 0 }
  e.games++
  if (win) e.wins++
  map.set(key, e)
}
const comboRows = computed(() => {
  const teamsMap = new Map<string, { members: string[]; games: number; wins: number }>()
  const duoMap = new Map<string, { members: string[]; games: number; wins: number }>()
  const trioMap = new Map<string, { members: string[]; games: number; wins: number }>()
  for (const game of visibleGames.value) {
    for (const team of game.teams) {
      const puuids = team.players.map((p) => p.puuid)
      if (puuids.length === 5) addCombo(teamsMap, puuids, team.win)
      for (let i = 0; i < puuids.length; i++) {
        for (let j = i + 1; j < puuids.length; j++) addCombo(duoMap, [puuids[i], puuids[j]], team.win)
      }
      for (let i = 0; i < puuids.length; i++) {
        for (let j = i + 1; j < puuids.length; j++) {
          for (let k = j + 1; k < puuids.length; k++) addCombo(trioMap, [puuids[i], puuids[j], puuids[k]], team.win)
        }
      }
    }
  }
  const toRows = (map: Map<string, { members: string[]; games: number; wins: number }>, minGames: number, minWinRate: number, sortCol: "games" | "winRate", sortDir: "asc" | "desc") =>
    [...map.values()]
      .filter((e) => {
        const winRate = e.games ? (e.wins / e.games) * 100 : 0
        return (minGames <= 0 || e.games >= minGames) && (minWinRate <= 0 || winRate >= minWinRate)
      })
      .map((e) => ({ ...e, winRate: e.games ? (e.wins / e.games) * 100 : 0 }))
      .sort((a, b) => {
        const av = sortCol === "games" ? a.games : a.winRate
        const bv = sortCol === "games" ? b.games : b.winRate
        return sortDir === "asc" ? av - bv : bv - av
      })
  return {
    teams: toRows(teamsMap, comboTeamMinGames.value, comboTeamMinWinRate.value, comboTeamSort.value, comboTeamSortDir.value),
    duos: toRows(duoMap, comboDuoMinGames.value, comboDuoMinWinRate.value, comboDuoSort.value, comboDuoSortDir.value),
    trios: toRows(trioMap, comboTrioMinGames.value, comboTrioMinWinRate.value, comboTrioSort.value, comboTrioSortDir.value),
  }
})
function memberName(puuid: string) { return teamPlayers.value.find((p) => p.puuid === puuid)?.gameName || puuid }

const honorSectionVisible = ref(false)
const comboSectionVisible = ref(false)

/* ── 模块懒渲染：未展开的模块先不渲染，首次展开才真正挂载/计算（大数据量加载更流畅） ── */
const openedOnce = reactive<Record<string, boolean>>({
  gameList: false,
  honor: false,
  vendetta: false,
  combo: false,
  team: false,
  champion: false,
  augment: false,
  item: false,
  augTier: false,
})
const lazySectionRefs: Record<string, Ref<boolean>> = {
  gameList: gameListVisible,
  honor: honorSectionVisible,
  vendetta: vendettaSectionVisible,
  combo: comboSectionVisible,
  team: teamSectionVisible,
  champion: championSectionVisible,
  augment: augmentSectionVisible,
  item: itemSectionVisible,
  augTier: augmentTierSectionVisible,
}
function toggleSection(key: keyof typeof lazySectionRefs) {
  const vis = lazySectionRefs[key]
  vis.value = !vis.value
  if (vis.value) openedOnce[key] = true
}

/* ── 大表格分批渲染（组队搭档 / 阵容与搭档），效果同对局列表 ── */
const TABLE_INITIAL = 100
const TABLE_STEP = 200
const teamShown = ref(TABLE_INITIAL)
const comboTeamShown = ref(TABLE_INITIAL)
const comboDuoShown = ref(TABLE_INITIAL)
const comboTrioShown = ref(TABLE_INITIAL)
function loadMoreTeam() {
  teamShown.value = Math.min(teamSortedRows.value.length, teamShown.value + TABLE_STEP)
}
function loadMoreComboTeam() {
  comboTeamShown.value = Math.min(comboRows.value.teams.length, comboTeamShown.value + TABLE_STEP)
}
function loadMoreComboDuo() {
  comboDuoShown.value = Math.min(comboRows.value.duos.length, comboDuoShown.value + TABLE_STEP)
}
function loadMoreComboTrio() {
  comboTrioShown.value = Math.min(comboRows.value.trios.length, comboTrioShown.value + TABLE_STEP)
}
</script>

<template>
  <div class="crp">
    <header class="panel-header">
      <div>
        <div class="eyebrow">对局评分</div>
        <h2>内战评分</h2>
      </div>
      <div class="header-actions">
        <div class="date-picker-wrap">
          <Calendar :size="14" />
          <input type="date" v-model="startDate" @change="onManualDateChange" class="date-input" />
          <span class="date-sep">—</span>
          <input type="date" v-model="endDate" @change="onManualDateChange" class="date-input" />
          <select :value="activeQuickRange" @change="onQuickRangeChange" class="quick-range-select" title="快速切换时间范围">
            <option v-for="r in QUICK_RANGES" :key="r.key" :value="r.key">{{ r.label }}</option>
            <option v-if="activeQuickRange === 'custom'" value="custom">自定义</option>
          </select>
        </div>
        <button class="toggle-sub" :class="{ active: customOnly }" @click="customOnly = !customOnly; load()" style="min-width:72px" title="开启时仅统计自定义模式（队列 3270）的内战对局；关闭后包含当天全部对局">
          <component :is="customOnly ? Check : X" :size="16" />
          <span style="font-size:13px">{{ customOnly ? '仅显示内战' : '全部对局' }}</span>
        </button>
        <button class="toggle-sub" :class="{ active: fiveV5Only }" @click="fiveV5Only = !fiveV5Only" style="min-width:72px" title="开启时仅统计双方各 5 名玩家的完整 5V5 对局；关闭后包含其它人数的对局">
          <component :is="fiveV5Only ? Check : X" :size="16" />
          <span style="font-size:13px">5V5</span>
        </button>
        <button class="toggle-sub" :class="{ active: minDuration8 }" @click="minDuration8 = !minDuration8" style="min-width:72px" title="开启时过滤游戏时长不足 8 分钟的对局（避免速投/重开污染统计）；关闭后包含所有时长的对局">
          <component :is="minDuration8 ? Check : X" :size="16" />
          <span style="font-size:13px">>8min</span>
        </button>
        <div class="toggle-sub min-games-input" :class="{ active: minGameCount > 0 }" title="全局玩家样本门槛：仅统计场数≥该值的玩家，影响汇总、图表、雷达、荣誉墙、趋势与对比；对局列表、阵容/搭档、英雄/装备榜仍按全部对局统计。留空为不限">
          <span style="font-size:13px">场数≥</span>
          <input
            v-model="minGameCountText"
            type="number"
            min="1"
            step="1"
            placeholder="不限"
            class="min-games-input-box"
            @change="applyMinGameCount"
            @keydown.enter="(e) => (e.target as HTMLInputElement).blur()"
          />
        </div>
        <button v-if="deletedGameIds.size > 0" class="toggle-sub" @click="restoreDeletedGames" title="恢复已删除的对局" style="min-width:72px">
          <X :size="14" />
          <span style="font-size:13px">已删除 {{ deletedGameIds.size }} 局 · 恢复</span>
        </button>
        <button class="primary-action" @click="load" :disabled="loading">
          <RefreshCw v-if="loading" class="spin" :size="16" />
          <RefreshCw v-else :size="16" />
          {{ loading ? "加载中" : "刷新" }}
        </button>
      </div>
    </header>

    <div v-if="loading" class="loading-state"><LoaderCircle class="spin" :size="32" /><span>正在拉取对局数据...</span></div>
    <div v-else-if="error" class="error-state"><X :size="24" /><span>{{ error }}</span><button class="primary-action" @click="load">重试</button></div>

    <template v-else-if="data">
      <!-- ═══════════════ SUMMARY CARD ═══════════════ -->
      <div v-if="summaryStats" class="summary-card">
        <div class="summary-grid">
          <div class="summary-item"><span class="sl">总对局</span><span class="sv">{{ summaryStats.totalGames }}</span></div>
          <div class="summary-item"><span class="sl">总人数</span><span class="sv">{{ summaryStats.totalPlayers }}</span></div>
          <div class="summary-item"><span class="sl">平均胜率</span><span class="sv" :class="summaryStats.avgWinRate >= 50 ? 'ab-high' : 'ab-low'">{{ summaryStats.avgWinRate.toFixed(0) }}%</span></div>
          <div class="summary-item"><span class="sl">均分</span><span class="sv" :class="scoreClass(summaryStats.avgOverallScore)">{{ summaryStats.avgOverallScore.toFixed(1) }}</span></div>
          <div class="summary-item"><span class="sl">平均KDA</span><span class="sv" :class="kdaClass(summaryStats.avgKdaScore)">{{ summaryStats.avgKdaScore.toFixed(1) }}</span></div>
          <div class="summary-item"><span class="sl">🔵 蓝方胜</span><span class="sv" style="color:#60a5fa">{{ summaryStats.blueWins }}</span></div>
          <div class="summary-item"><span class="sl">🔴 红方胜</span><span class="sv" style="color:#f87171">{{ summaryStats.redWins }}</span></div>
        </div>
        <div class="summary-details">
          <div class="summary-positions" v-if="summaryStats.topPositions.length">
            <span class="sdl">位置分布</span>
            <div class="position-bars">
              <div v-for="[role, count] in summaryStats.topPositions" :key="role" class="pbr">
                <span class="pbl">{{ role }}</span>
                <div class="pbt"><div class="pbf" :style="{ width: (count / summaryStats.totalPlayers * 100) + '%' }"></div></div>
                <span class="pbc">{{ count }}</span>
              </div>
            </div>
          </div>
          <div class="summary-tags" v-if="summaryStats.topTags.length">
            <span class="sdl">标签统计</span>
            <div class="tag-badges">
              <span v-for="[tag, count] in summaryStats.topTags.slice(0, 8)" :key="tag" class="tag-badge">{{ tag }}<em>×{{ count }}</em></span>
            </div>
          </div>
          <div class="summary-tiers">
            <span class="sdl">评级分布</span>
            <div class="tier-bars">
              <div v-for="[tier, _count] in Object.entries(summaryStats.tiers).filter(([,c]) => c > 0)" :key="tier" class="tier-bar-row">
                <span class="tier-label" :style="{ color: summaryStats.tierColors[tier] }">{{ tier }}</span>
                <div class="tier-track"><div class="tier-fill" :style="{ width: tierPercent(tier) + '%', background: summaryStats.tierColors[tier] }"></div></div>
                <span class="tier-count">{{ summaryStats.tiers[tier] }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ═══════════════ GAME LIST ═══════════════ -->
      <div class="game-section" v-if="enrichedGames.length > 0">
        <div class="game-section-header" @click="toggleSection('gameList')">
          <div class="gsh-left">
            <span class="section-title">
              <component :is="gameListVisible ? ChevronDown : ChevronRight" :size="14" />
              对局列表 ({{ filteredGameList.length }})<template v-if="gameSearchQuery.trim()"> / {{ enrichedGames.length }} 匹配</template>
            </span>
          </div>
          <div class="gsh-right" @click.stop>
            <div class="game-search-box">
              <Search :size="13" class="game-search-icon" />
              <input
                v-model="gameSearchQuery"
                type="text"
                class="game-search-input"
                placeholder="搜玩家 / 英雄 / 海克斯(彩金银) / 装备 / 日期 / 胜负 / 分钟 / 杀过谁…"
                title="关键字过滤对局列表：可搜玩家名、英雄、海克斯(或彩/金/银)、装备、日期（2026-09-03、9月3日）、蓝方胜利/红方失败、28min/28分钟、杀过/被杀的玩家名；多个词用空格分隔（全部命中才显示）"
              />
              <X v-if="gameSearchQuery" :size="13" class="game-search-clear" @click="gameSearchQuery = ''" />
            </div>
          </div>
        </div>

        <div v-if="openedOnce.gameList" v-show="gameListVisible" class="game-list">
          <div class="game-list-toolbar">
            <span class="stat-subtitle">时间分栏</span>
            <select v-model="gameListViewMode" class="game-view-select" title="切换对局列表展示方式">
              <option value="grouped">按时间分组（年/月 → 日期）</option>
              <option value="flat">平铺列表</option>
            </select>
            <span v-if="gameListViewMode === 'grouped'" class="stat-subtitle">默认展开最近一个月；更早月份点击标题后才加载该月对局</span>
            <span v-else class="stat-subtitle">按时间倒序平铺，超出分批加载</span>
          </div>
          <div v-if="filteredGameList.length === 0" class="game-search-empty">
            <span>没有符合「{{ gameSearchQuery.trim() }}」的对局，试试其他关键字</span>
          </div>
          <template v-else>
            <template v-for="row in gameListDisplay">
              <div v-if="isMonthRow(row)" :key="row.key" class="game-month-header" @click="toggleMonthOpen(row.monthKey)">
              <component :is="row.open ? ChevronDown : ChevronRight" :size="14" />
              <span class="gm-label">{{ row.label }}</span>
              <span class="gm-count">{{ row.count }} 场</span>
              <span v-if="!row.open && row.count > 0" class="gm-hint">展开查看</span>
            </div>
            <div v-else-if="isDateRow(row)" :key="row.key" class="game-date-header">
              <span class="gd-label">{{ row.label }}</span>
              <span v-if="row.shown < row.total" class="gd-count">已显示 {{ row.shown }}/{{ row.total }} 场</span>
              <span v-else class="gd-count">{{ row.total }} 场</span>
            </div>
            <template v-else-if="isGameRow(row)">
              <div v-for="game in [row.game]" :key="game.gameId" :data-game-id="game.gameId" class="game-card-outer">
            <div
              class="game-card"
              :class="{ 'game-has-expanded': expandedGames.has(game.gameId) }"
              @click="toggleGameExpand(game.gameId)"
              @mouseenter="hoveredGameId = game.gameId"
              @mouseleave="hoveredGameId = null"
            >
              <!-- left: blue team -->
              <div class="team-col bc-blue" :class="game.teams[0]?.win ? 'team-win-border' : 'team-lose-dim'">
                <div class="team-players-row">
                  <div v-for="p in game.teams[0]?.players || []" :key="p.puuid" class="tp-avatar-wrap">
                    <div class="tp-avatar-frame">
                      <ChampionAvatar :champion-id="p.championId" :champions="props.champions" :size="32" />
                      <Crown v-if="p.puuid === game.mvp.puuid" :size="10" class="mvp-crown" />
                    </div>
                    <span class="tp-name">{{ p.gameName.length > 6 ? p.gameName.slice(0, 6) + '..' : p.gameName }}</span>
                    <span class="tp-score" :class="scoreClass(p.gameScore)">{{ p.gameScore }}</span>
                  </div>
                </div>
              </div>

              <!-- center: game info -->
              <div class="game-center-col">
                <div class="gc-badges">
                  <span class="queue-badge-sm">{{ queueLabel(game.queueId) }}</span>
                  <span class="dur-badge">{{ (game.gameDuration / 60).toFixed(0) }}min</span>
                </div>
                <div class="gc-mvp">
                  <Crown :size="12" class="mvp-icon" />
                  <span class="mvp-name">{{ game.mvpName }}</span>
                </div>
                <div class="gc-scores">
                  <span class="team-score blue-score">{{ game.teams[0]?.avgScore.toFixed(0) || '-' }}</span>
                  <span class="score-vs">:</span>
                  <span class="team-score red-score">{{ game.teams[1]?.avgScore.toFixed(0) || '-' }}</span>
                </div>
                <div class="gc-tags-row">
                  <span v-for="tag in game.tags" :key="tag" class="game-tag" :class="tag === '速推局' ? 'tag-quick' : tag === '拉锯局' ? 'tag-long' : 'tag-stomp'">{{ tag }}</span>
                </div>
              </div>

              <!-- right: red team -->
              <div class="team-col bc-red" :class="game.teams[1]?.win ? 'team-win-border' : 'team-lose-dim'">
                <div class="team-players-row">
                  <div v-for="p in game.teams[1]?.players || []" :key="p.puuid" class="tp-avatar-wrap">
                    <div class="tp-avatar-frame">
                      <ChampionAvatar :champion-id="p.championId" :champions="props.champions" :size="32" />
                      <Crown v-if="p.puuid === game.mvp.puuid" :size="10" class="mvp-crown" />
                    </div>
                    <span class="tp-name">{{ p.gameName.length > 6 ? p.gameName.slice(0, 6) + '..' : p.gameName }}</span>
                    <span class="tp-score" :class="scoreClass(p.gameScore)">{{ p.gameScore }}</span>
                  </div>
                </div>
              </div>

              <!-- expand btn -->
              <button class="game-expand-btn" @click.stop="toggleGameExpand(game.gameId)">
                <ChevronDown v-if="!expandedGames.has(game.gameId)" :size="14" />
                <ChevronUp v-else :size="14" />
              </button>
              <button class="game-delete-btn" @click.stop="deleteGame(game.gameId)" title="删除此局">
                <X :size="12" />
              </button>
            </div>

            <!-- expanded per-game detail -->
            <div v-if="expandedGames.has(game.gameId) && rawGame(game.gameId)" class="game-expanded-table">
              <GameDetailTeams
                :teams="rawGame(game.gameId)!.teams"
                :champions="props.champions"
                :item-map="itemMap"
                :spell-map="spellMap"
                :perk-map="perkMap"
                :augment-map="augmentMap"
                theme="dark"
                :rate="rateGame"
              />
              <KillRelationsCard
                :players="rawGame(game.gameId)!.teams.flatMap((t) => t.players)"
                :champions="props.champions"
                theme="dark"
                :collapsible="true"
                :collapsed-by-default="true"
              />
            </div>

            <!-- hover tooltip -->
            <div v-if="hoveredGameId === game.gameId" class="game-hover-tooltip">
              <div v-for="team in game.teams" :key="team.teamId" class="ght-team">
                <div class="ght-header" :class="team.win ? 'ght-win' : 'ght-lose'">{{ team.win ? '胜利' : '失败' }} (均分 {{ team.avgScore.toFixed(0) }})</div>
                <div v-for="p in team.players" :key="p.puuid" class="ght-player">
                  <ChampionAvatar :champion-id="p.championId" :champions="props.champions" :size="16" />
                  <span class="ght-name">{{ p.gameName }}</span>
                  <span class="ght-kda">{{ p.kills }}/{{ p.deaths }}/{{ p.assists }}</span>
                  <span class="ght-score" :class="scoreClass(p.gameScore)">{{ p.gameScore }}</span>
                  <Crown v-if="p.puuid === game.mvp.puuid" :size="10" class="mvp-crown" />
                </div>
              </div>
            </div>
              </div>
            </template>
            <div v-else-if="isMoreRow(row)" :key="row.key" class="game-more-bar">
              <span class="stat-subtitle">已显示 {{ row.shown }} / {{ row.total }} 局</span>
              <button v-if="row.monthKey" class="toggle-sub" @click="loadMoreMonth(row.monthKey)">加载更多（{{ row.moreStep }} 局）</button>
              <button v-else class="toggle-sub" @click="showMoreGames">加载更多（{{ row.moreStep }} 局）</button>
              <button v-if="row.monthKey" class="toggle-sub" @click="showAllMonth(row.monthKey)">显示全部 {{ row.total }} 局</button>
              <button v-else class="toggle-sub" @click="showAllGames">显示全部 {{ row.total }} 局</button>
            </div>
            </template>
          </template>
        </div>
      </div>

      <!-- ═══════════════ EMPTY ═══════════════ -->
      <div v-if="enrichedGames.length === 0" class="empty-state"><Swords :size="32" /><span>该日期没有对局记录</span></div>

      <!-- ═══════════════ RATING TABLE ═══════════════ -->
      <div v-else class="rating-table-wrap" ref="ratingExportRef">
        <div class="section-title rating-title-line" @click="ratingSectionVisible = !ratingSectionVisible">
          <component :is="ratingSectionVisible ? ChevronDown : ChevronRight" :size="14" />
          玩家评分
        </div>

        <div v-show="ratingSectionVisible">
        <div class="filter-bar">
          <input v-model="filterText" placeholder="搜索玩家..." class="filter-input" />
          <button class="toggle-sub" :class="{ active: showExtremes }" @click="showExtremes = !showExtremes" style="min-width:52px">
            <component :is="showExtremes ? ChevronUp : ChevronDown" :size="14" />
            极值
          </button>
          <button class="toggle-sub" :class="{ active: showSubColumns }" @click="showSubColumns = !showSubColumns">
            <component :is="showSubColumns ? ChevronUp : ChevronDown" :size="14" />
            {{ showSubColumns ? '收起' : '展开' }}详细
          </button>
          <button class="toggle-sub" :class="{ active: showEfficiencyColumns }" @click="showEfficiencyColumns = !showEfficiencyColumns">
            <component :is="showEfficiencyColumns ? ChevronUp : ChevronDown" :size="14" />
            {{ showEfficiencyColumns ? '收起' : '展开' }}效率
          </button>
          <span class="filter-count">{{ filteredAndSortedRatings.length }} / {{ playerRatings.length }}</span>
          <div class="export-menu-wrap">
            <button class="toggle-sub" :class="{ active: exportMenuOpen }" @click="exportMenuOpen = !exportMenuOpen" :disabled="exporting || batchExporting || filteredAndSortedRatings.length === 0" style="min-width:86px">
              <Download :size="14" />
              <span style="font-size:13px">{{ exporting || batchExporting ? "导出中..." : "导出图片" }}</span>
            </button>
            <div v-if="exportMenuOpen" class="export-menu">
              <div class="export-menu-group">评分面板（全部玩家）</div>
              <button v-for="p in EXPORT_PRESETS" :key="p.key" class="export-menu-item" @click="exportRatingImage(p)">
                <span>{{ p.label }}</span>
                <span class="export-menu-desc">{{ p.type === "image/png" ? "无损" : p.type === "image/jpeg" ? "体积小" : "平衡" }}</span>
              </button>
              <div class="export-menu-divider"></div>
              <div class="export-menu-group">玩家详情页（每人一张，打包 ZIP）</div>
              <button class="export-menu-item" :disabled="batchExporting" @click="exportAllPlayerDetails(2)">
                <span>ZIP · PNG 2x（推荐）</span>
                <span class="export-menu-desc">{{ filteredAndSortedRatings.length }} 人</span>
              </button>
              <button class="export-menu-item" :disabled="batchExporting" @click="exportAllPlayerDetails(3)">
                <span>ZIP · PNG 3x（超清）</span>
                <span class="export-menu-desc">{{ filteredAndSortedRatings.length }} 人</span>
              </button>
            </div>
          </div>
          <span v-if="exportMessage" class="export-message">{{ exportMessage }}</span>
        </div>

        <div class="table-scroll" ref="tableScrollRef">
          <table class="rating-table">
            <thead>
              <tr>
                <th class="col-rank">#</th>
                <th class="col-player sortable" @click="sortBy('gameName')">玩家{{ sortIcon('gameName') }}</th>
                <th class="col-num sortable" @click="sortBy('gamesPlayed')">场{{ sortIcon('gamesPlayed') }}</th>
                <th class="col-num sortable" @click="sortBy('wins')">胜{{ sortIcon('wins') }}</th>
                <th class="col-num-sortable sortable" @click="sortBy('winRate')">胜率{{ sortIcon('winRate') }}</th>
                <th class="col-num sortable" @click="sortBy('avgKills')">击杀{{ sortIcon('avgKills') }}</th>
                <th class="col-num sortable" @click="sortBy('avgDeaths')">死亡{{ sortIcon('avgDeaths') }}</th>
                <th class="col-kda sortable" @click="sortBy('kdaScore')">KDA{{ sortIcon('kdaScore') }}</th>
                <th class="col-ability sortable" @click="sortBy('carry')">输出{{ sortIcon('carry') }}</th>
                <th class="col-ability sortable" @click="sortBy('frontline')">前排{{ sortIcon('frontline') }}</th>
                <th class="col-ability sortable" @click="sortBy('support')">辅助{{ sortIcon('support') }}</th>
                <th v-if="showSubColumns" class="col-detail sortable" @click="sortBy('damageShare')">伤害%{{ sortIcon('damageShare') }}</th>
                <th v-if="showSubColumns" class="col-detail sortable" @click="sortBy('mitigationShare')">承伤%{{ sortIcon('mitigationShare') }}</th>
                <th v-if="showSubColumns" class="col-detail sortable" @click="sortBy('healingShare')">治疗/护盾%{{ sortIcon('healingShare') }}</th>
                <th v-if="showSubColumns" class="col-detail sortable" @click="sortBy('damageConversion')">转化{{ sortIcon('damageConversion') }}</th>
                <th v-if="showEfficiencyColumns" class="col-num sortable" @click="sortBy('gpm')">分均经济{{ sortIcon('gpm') }}</th>
                <th v-if="showEfficiencyColumns" class="col-num sortable" @click="sortBy('dpm')">分均伤害{{ sortIcon('dpm') }}</th>
                <th v-if="showEfficiencyColumns" class="col-num sortable" @click="sortBy('cspm')">分均补刀{{ sortIcon('cspm') }}</th>
                <th v-if="showEfficiencyColumns" class="col-detail sortable" @click="sortBy('kp')">参团率{{ sortIcon('kp') }}</th>
                <th v-if="showEfficiencyColumns" class="col-detail sortable" @click="sortBy('killShare')">击杀占比{{ sortIcon('killShare') }}</th>
                <th v-if="showEfficiencyColumns" class="col-detail sortable" @click="sortBy('mitigationPerDeath')">承伤每死{{ sortIcon('mitigationPerDeath') }}</th>
                <th class="col-num sortable" @click="sortBy('highlightGames')">高光{{ sortIcon('highlightGames') }}</th>
                <th class="col-num sortable" @click="sortBy('disasterGames')">战犯{{ sortIcon('disasterGames') }}</th>
                <th v-if="showSubColumns" class="col-num-leader sortable" @click="sortBy('damageLeader')" style="color:#fb923c">伤害榜首{{ sortIcon('damageLeader') }}</th>
                <th v-if="showSubColumns" class="col-num-leader sortable" @click="sortBy('mitigationLeader')" style="color:#60a5fa">承伤榜首{{ sortIcon('mitigationLeader') }}</th>
                <th v-if="showSubColumns" class="col-num-leader sortable" @click="sortBy('assistLeader')" style="color:#4ade80">助攻榜首{{ sortIcon('assistLeader') }}</th>
                <th class="col-score sortable" @click="sortBy('overallScore')">综合{{ sortIcon('overallScore') }}</th>
                <th class="col-label">评级</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="filteredAndSortedRatings.length === 0">
                <td colspan="19" class="empty-table-row">
                  {{ minGameCount > 0 ? `场数≥${minGameCount} 过滤后暂无玩家，请调低顶部场数限制` : '该日期没有对局记录' }}
                </td>
              </tr>
              <tr
                v-for="(rating, index) in filteredAndSortedRatings"
                :key="rating.puuid"
                :data-puuid="rating.puuid"
                :class="['tr-body', index % 2 === 1 ? 'row-zebra' : '']"
                @click="openPlayerDrawer(rating.puuid)"
              >
                <td class="col-rank">{{ index + 1 }}</td>
                <td class="col-player"><UserRound :size="14" /> {{ rating.gameName }}#{{ rating.tagLine }}</td>
                <td class="col-num">{{ rating.gamesPlayed }}</td>
                <td class="col-num">{{ rating.wins }}</td>
                <td class="col-num wr-cell" :class="winRate(rating) >= 50 ? 'wr-high' : 'wr-low'">{{ winRate(rating).toFixed(0) }}%</td>
                <td class="col-num" :class="cellExtreme(rating.puuid, 'avgKills')">{{ rating.avgKills.toFixed(1) }}</td>
                <td class="col-num" :class="cellExtreme(rating.puuid, 'avgDeaths')">{{ rating.avgDeaths.toFixed(1) }}</td>
                <td class="col-num" :class="cellExtreme(rating.puuid, 'overallKdaScore')"><span :class="kdaClass(rating.overallKdaScore)">{{ rating.overallKdaScore }}</span></td>
                <td class="col-ability" :class="cellExtreme(rating.puuid, 'carry')"><span :class="abilityClass(rating.profile.abilities.carry.averageScore)">{{ rating.profile.abilities.carry.averageScore.toFixed(0) }}</span></td>
                <td class="col-ability" :class="cellExtreme(rating.puuid, 'frontline')"><span :class="abilityClass(rating.profile.abilities.frontline.averageScore)">{{ rating.profile.abilities.frontline.averageScore.toFixed(0) }}</span></td>
                <td class="col-ability" :class="cellExtreme(rating.puuid, 'support')"><span :class="abilityClass(rating.profile.abilities.support.averageScore)">{{ rating.profile.abilities.support.averageScore.toFixed(0) }}</span></td>
                <td v-if="showSubColumns" class="col-detail" :class="cellExtreme(rating.puuid, 'damageShare')">{{ (avgChampProp(rating.championProfiles, (cp) => cp.averageDamageShare) * 100).toFixed(1) }}%</td>
                <td v-if="showSubColumns" class="col-detail" :class="cellExtreme(rating.puuid, 'mitigationShare')">{{ (avgChampProp(rating.championProfiles, (cp) => cp.averageMitigationShare) * 100).toFixed(1) }}%</td>
                <td v-if="showSubColumns" class="col-detail" :class="cellExtreme(rating.puuid, 'healingShare')">{{ (avgChampProp(rating.championProfiles, (cp) => cp.averageHealingShare) * 100).toFixed(1) }}%</td>
                <td v-if="showSubColumns" class="col-detail" :class="cellExtreme(rating.puuid, 'damageConversion')">{{ (avgChampProp(rating.championProfiles, (cp) => cp.averageDamageConversion) * 100).toFixed(1) }}%</td>
                <td v-if="showEfficiencyColumns" class="col-num" :class="cellExtreme(rating.puuid, 'gpm')">{{ rating.avgGpm.toFixed(0) }}</td>
                <td v-if="showEfficiencyColumns" class="col-num" :class="cellExtreme(rating.puuid, 'dpm')">{{ rating.avgDpm.toFixed(0) }}</td>
                <td v-if="showEfficiencyColumns" class="col-num" :class="cellExtreme(rating.puuid, 'cspm')">{{ rating.avgCspm.toFixed(1) }}</td>
                <td v-if="showEfficiencyColumns" class="col-detail" :class="cellExtreme(rating.puuid, 'kp')">{{ (rating.avgKp * 100).toFixed(0) }}%</td>
                <td v-if="showEfficiencyColumns" class="col-detail" :class="cellExtreme(rating.puuid, 'killShare')">{{ (rating.avgKillShare * 100).toFixed(0) }}%</td>
                <td v-if="showEfficiencyColumns" class="col-detail" :class="cellExtreme(rating.puuid, 'mitigationPerDeath')">{{ rating.avgMitigationPerDeath.toFixed(1) }}</td>
                <td class="col-num" :class="cellExtreme(rating.puuid, 'highlightGames')"><span :class="rating.highlightGames > 0 ? 'sc-high' : 'dim'">{{ rating.highlightGames }}</span></td>
                <td class="col-num" :class="cellExtreme(rating.puuid, 'disasterGames')"><span :class="rating.disasterGames > 0 ? 'sc-low' : 'dim'">{{ rating.disasterGames }}</span></td>
                <td v-if="showSubColumns" class="col-num-leader" :class="cellExtreme(rating.puuid, 'damageLeaderCount')" :title="rating.leaderGameIds.damage.length ? `对局: ${rating.leaderGameIds.damage.slice(0, 5).join(', ')}${rating.leaderGameIds.damage.length > 5 ? '...' : ''}` : ''"><span :class="rating.damageLeaderCount > 0 ? 'ld-damage' : 'dim'">{{ rating.damageLeaderCount }}</span></td>
                <td v-if="showSubColumns" class="col-num-leader" :class="cellExtreme(rating.puuid, 'mitigationLeaderCount')" :title="rating.leaderGameIds.mitigation.length ? `对局: ${rating.leaderGameIds.mitigation.slice(0, 5).join(', ')}${rating.leaderGameIds.mitigation.length > 5 ? '...' : ''}` : ''"><span :class="rating.mitigationLeaderCount > 0 ? 'ld-mitigation' : 'dim'">{{ rating.mitigationLeaderCount }}</span></td>
                <td v-if="showSubColumns" class="col-num-leader" :class="cellExtreme(rating.puuid, 'assistLeaderCount')" :title="rating.leaderGameIds.assist.length ? `对局: ${rating.leaderGameIds.assist.slice(0, 5).join(', ')}${rating.leaderGameIds.assist.length > 5 ? '...' : ''}` : ''"><span :class="rating.assistLeaderCount > 0 ? 'ld-assist' : 'dim'">{{ rating.assistLeaderCount }}</span></td>
                <td class="col-score" :class="[scoreClass(rating.profile.overallScore), cellExtreme(rating.puuid, 'overallScore')]">{{ rating.profile.overallScore.toFixed(1) }}</td>
                <td class="col-label">
                  <span class="score-badge" :class="`score-${profileScoreLevel(rating.profile.overallScore) === 'excellent' ? 'high' : profileScoreLevel(rating.profile.overallScore) === 'good' ? 'mid' : 'low'}`">
                    {{ scoreEvaluationLabel(rating.profile.overallScore) }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        </div>
      </div>

      <!-- ═══════════════ CHARTS ═══════════════ -->
      <RatingChartsSection
        v-if="playerRatings.length > 0"
        :players="playerRatings"
        :champions="props.champions"
        :blue-wins="summaryStats?.blueWins ?? 0"
        :red-wins="summaryStats?.redWins ?? 0"
        @focus-player="focusPlayer"
      />

      <!-- ═══════════════ PLAYER RADAR ═══════════════ -->
      <PlayerRadarPanel v-if="playerRatings.length > 0" :players="playerRatings" />

      <!-- 荣誉墙 -->
      <div v-if="playerRatings.length > 0" class="stat-module">
        <div class="stat-section">
          <div class="stat-title-line" @click="toggleSection('honor')">
            <component :is="honorSectionVisible ? ChevronDown : ChevronRight" :size="14" />
            <span class="section-title">荣誉墙</span>
            <span class="stat-subtitle">每局全场 10 人评选</span>
          </div>
          <div v-if="openedOnce.honor" v-show="honorSectionVisible" class="stat-section-body">
            <div class="honor-grid">
              <div v-for="row in honorWall" :key="row.honor" class="honor-card">
                <div class="honor-name">{{ row.honor }}</div>
                <div class="honor-players">
                  <span v-for="(p, i) in row.players" :key="p.puuid" class="honor-player" :class="{ 'sc-high': i === 0 }">{{ p.gameName }}<em>×{{ p.count }}</em></span>
                  <span v-if="!row.players.length" class="dim">暂无</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 玩家状态趋势 -->
      <PlayerTrendSection
        v-if="playerRatings.length > 0"
        :players="playerRatings"
        :champions="props.champions"
        @focus-game="focusGame"
      />

      <!-- 击杀与被击杀榜 -->
      <div v-if="vendettaPlayers.length" class="stat-module">
        <div class="stat-section">
          <div class="stat-title-line" @click="toggleSection('vendetta')">
            <component :is="vendettaSectionVisible ? ChevronDown : ChevronRight" :size="14" />
            <span class="section-title">击杀与被击杀榜</span>
            <span class="stat-subtitle">选择玩家，看 TA 杀谁最多 / 被谁杀最多</span>
          </div>
          <div v-if="openedOnce.vendetta" v-show="vendettaSectionVisible" class="stat-section-body">
            <div class="stat-header">
              <select v-model="vendettaPuuid" class="stat-search" style="width: 180px; cursor: pointer" title="选择要分析的玩家">
                <option v-for="p in vendettaPlayers" :key="p.puuid" :value="p.puuid">{{ p.name }}（{{ p.games }}场）</option>
              </select>
              <div class="toggle-sub min-games-input" :class="{ active: vendettaMinGames > 0 }" title="只显示对位场次≥该值的对手，留空为不限；样本太少时场均击杀不准确">
                <span style="font-size:13px">对位场≥</span>
                <input
                  v-model="vendettaMinGamesText"
                  type="number"
                  min="1"
                  step="1"
                  placeholder="不限"
                  class="min-games-input-box"
                  @change="applyVendettaMinGames"
                  @keydown.enter="(e) => (e.target as HTMLInputElement).blur()"
                />
              </div>
              <span class="stat-subtitle">
                总击杀 <b style="color:#f87171">{{ vendettaTarget.totalKills }}</b> · 总被击杀 <b style="color:#fb923c">{{ vendettaTarget.totalDeaths }}</b>
              </span>
            </div>
            <div class="vendetta-grid">
              <div class="vendetta-block">
                <div class="vendetta-block-title">击杀榜 · 我杀谁最多</div>
                <div class="stat-table-scroll vendetta-scroll">
                  <table class="stat-table champion-table">
                    <thead>
                      <tr>
                        <th class="st-champ">受害者</th>
                        <th class="st-num sortable" style="text-align:center" @click="toggleVendettaSort('kills')">击杀{{ vendettaSortIcon('kills') }}</th>
                        <th class="st-num sortable" style="text-align:center" title="对位场次内的场均击杀数（击杀数 ÷ 对位场次），点击按此排序" @click="toggleVendettaSort('avg')">场均击杀{{ vendettaSortIcon('avg') }}</th>
                        <th class="st-num" style="text-align:center" title="双方同场且互为对手的对局数">对位场</th>
                        <th class="st-num" style="text-align:center" title="队友助攻次数">助攻</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="r in vendettaTarget.kills" :key="r.puuid" @click="openPlayerDrawer(r.puuid)">
                        <td class="st-champ"><span class="st-champ-name">{{ r.name }}</span></td>
                        <td class="st-num" style="text-align:center"><b style="color:#f87171">{{ r.kills }}</b></td>
                        <td class="st-num" style="text-align:center"><b style="color:#fca5a5">{{ r.avgKills.toFixed(2) }}</b></td>
                        <td class="st-num" style="text-align:center">{{ r.games }}</td>
                        <td class="st-num" style="text-align:center">{{ r.assists }}</td>
                      </tr>
                      <tr v-if="!vendettaTarget.kills.length"><td colspan="5" class="empty-table-row">暂无击杀记录</td></tr>
                    </tbody>
                  </table>
                </div>
              </div>
              <div class="vendetta-block">
                <div class="vendetta-block-title">被击杀榜 · 谁杀我最多</div>
                <div class="stat-table-scroll vendetta-scroll">
                  <table class="stat-table champion-table">
                    <thead>
                      <tr>
                        <th class="st-champ">杀手</th>
                        <th class="st-num sortable" style="text-align:center" @click="toggleVendettaSort('kills')">击杀{{ vendettaSortIcon('kills') }}</th>
                        <th class="st-num sortable" style="text-align:center" title="对位场次内的场均击杀数（击杀数 ÷ 对位场次），点击按此排序" @click="toggleVendettaSort('avg')">场均击杀{{ vendettaSortIcon('avg') }}</th>
                        <th class="st-num" style="text-align:center" title="双方同场且互为对手的对局数">对位场</th>
                        <th class="st-num" style="text-align:center" title="对方队友助攻次数">助攻</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="r in vendettaTarget.deaths" :key="r.puuid" @click="openPlayerDrawer(r.puuid)">
                        <td class="st-champ"><span class="st-champ-name">{{ r.name }}</span></td>
                        <td class="st-num" style="text-align:center"><b style="color:#fb923c">{{ r.kills }}</b></td>
                        <td class="st-num" style="text-align:center"><b style="color:#fdba74">{{ r.avgKills.toFixed(2) }}</b></td>
                        <td class="st-num" style="text-align:center">{{ r.games }}</td>
                        <td class="st-num" style="text-align:center">{{ r.assists }}</td>
                      </tr>
                      <tr v-if="!vendettaTarget.deaths.length"><td colspan="5" class="empty-table-row">暂无被击杀记录</td></tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
            <div class="stat-header" style="margin-top:6px">
              <span class="stat-subtitle">点击行可查看对应玩家详情</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 选手对比 -->
      <PlayerCompareSection
        v-if="playerRatings.length > 1"
        :players="playerRatings"
        :champions="props.champions"
        :games="enrichedGames"
        :match-by-id="rawGameById"
        :item-map="itemMap"
        :spell-map="spellMap"
        :augment-map="augmentMap"
        :perk-map="perkMap"
      />

      <!-- 阵容与搭档 -->
      <div v-if="playerRatings.length > 1" class="stat-module">
        <div class="stat-section">
          <div class="stat-title-line" @click="toggleSection('combo')">
            <component :is="comboSectionVisible ? ChevronDown : ChevronRight" :size="14" />
            <span class="section-title">阵容与搭档</span>
            <span class="stat-subtitle">固定五人 / 双人 / 三人</span>
          </div>
          <div v-if="openedOnce.combo" v-show="comboSectionVisible" class="stat-section-body">
            <div class="combo-tables">
              <div class="combo-block">
                <div class="stat-header" style="margin-bottom:8px">
                  <div class="toggle-sub min-games-input" :class="{ active: comboTeamMinGames > 0 }" title="只统计场次≥该值的组合">
                    <span style="font-size:13px">场次≥</span>
                    <input v-model="comboTeamMinGamesText" type="number" min="1" step="1" placeholder="不限" class="min-games-input-box" @change="applyComboTeamMinGames" @keydown.enter="(e) => (e.target as HTMLInputElement).blur()" />
                  </div>
                  <div class="toggle-sub min-games-input" :class="{ active: comboTeamMinWinRate > 0 }" title="只统计胜率≥该值的组合">
                    <span style="font-size:13px">胜率≥</span>
                    <input v-model="comboTeamMinWinRateText" type="number" min="0" max="100" step="1" placeholder="不限" class="min-games-input-box" @change="applyComboTeamMinWinRate" @keydown.enter="(e) => (e.target as HTMLInputElement).blur()" />
                    <span style="font-size:11px;color:var(--text-muted,#888)">%</span>
                  </div>
                </div>
                <div class="combo-title">五人固定阵容</div>
                <table class="stat-table combo-table">
                  <thead>
                    <tr>
                      <th class="st-champ">组合</th>
                      <th class="st-num sortable" @click="toggleComboTeamSort('games')">场次{{ comboTeamSortIcon('games') }}</th>
                      <th class="st-num sortable" @click="toggleComboTeamSort('winRate')">胜率{{ comboTeamSortIcon('winRate') }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="c in comboRows.teams.slice(0, comboTeamShown)" :key="c.members.join('|')">
                      <td class="combo-members">{{ c.members.map(memberName).join(' / ') }}</td>
                      <td class="st-num">{{ c.games }}</td>
                      <td class="st-num"><span :class="winRateClass(c.winRate)">{{ c.winRate.toFixed(0) }}%</span></td>
                    </tr>
                    <tr v-if="!comboRows.teams.length"><td colspan="3" class="empty-table-row">暂无满足条件的五人组合</td></tr>
                  </tbody>
                </table>
                <div v-if="comboRows.teams.length > comboTeamShown" class="table-more-bar">
                  <button class="toggle-sub" @click="loadMoreComboTeam">加载更多（{{ Math.min(TABLE_STEP, comboRows.teams.length - comboTeamShown) }} 组）</button>
                  <button class="toggle-sub" @click="comboTeamShown = comboRows.teams.length">显示全部 {{ comboRows.teams.length }} 组</button>
                </div>
              </div>
              <div class="combo-block">
                <div class="stat-header" style="margin-bottom:8px">
                  <div class="toggle-sub min-games-input" :class="{ active: comboDuoMinGames > 0 }" title="只统计场次≥该值的组合">
                    <span style="font-size:13px">场次≥</span>
                    <input v-model="comboDuoMinGamesText" type="number" min="1" step="1" placeholder="不限" class="min-games-input-box" @change="applyComboDuoMinGames" @keydown.enter="(e) => (e.target as HTMLInputElement).blur()" />
                  </div>
                  <div class="toggle-sub min-games-input" :class="{ active: comboDuoMinWinRate > 0 }" title="只统计胜率≥该值的组合">
                    <span style="font-size:13px">胜率≥</span>
                    <input v-model="comboDuoMinWinRateText" type="number" min="0" max="100" step="1" placeholder="不限" class="min-games-input-box" @change="applyComboDuoMinWinRate" @keydown.enter="(e) => (e.target as HTMLInputElement).blur()" />
                    <span style="font-size:11px;color:var(--text-muted,#888)">%</span>
                  </div>
                </div>
                <div class="combo-title">双人搭档</div>
                <table class="stat-table combo-table">
                  <thead>
                    <tr>
                      <th class="st-champ">组合</th>
                      <th class="st-num sortable" @click="toggleComboDuoSort('games')">场次{{ comboDuoSortIcon('games') }}</th>
                      <th class="st-num sortable" @click="toggleComboDuoSort('winRate')">胜率{{ comboDuoSortIcon('winRate') }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="c in comboRows.duos.slice(0, comboDuoShown)" :key="c.members.join('|')">
                      <td class="combo-members">{{ c.members.map(memberName).join(' / ') }}</td>
                      <td class="st-num">{{ c.games }}</td>
                      <td class="st-num"><span :class="winRateClass(c.winRate)">{{ c.winRate.toFixed(0) }}%</span></td>
                    </tr>
                    <tr v-if="!comboRows.duos.length"><td colspan="3" class="empty-table-row">暂无满足条件的双人组合</td></tr>
                  </tbody>
                </table>
                <div v-if="comboRows.duos.length > comboDuoShown" class="table-more-bar">
                  <button class="toggle-sub" @click="loadMoreComboDuo">加载更多（{{ Math.min(TABLE_STEP, comboRows.duos.length - comboDuoShown) }} 组）</button>
                  <button class="toggle-sub" @click="comboDuoShown = comboRows.duos.length">显示全部 {{ comboRows.duos.length }} 组</button>
                </div>
              </div>
              <div class="combo-block">
                <div class="stat-header" style="margin-bottom:8px">
                  <div class="toggle-sub min-games-input" :class="{ active: comboTrioMinGames > 0 }" title="只统计场次≥该值的组合">
                    <span style="font-size:13px">场次≥</span>
                    <input v-model="comboTrioMinGamesText" type="number" min="1" step="1" placeholder="不限" class="min-games-input-box" @change="applyComboTrioMinGames" @keydown.enter="(e) => (e.target as HTMLInputElement).blur()" />
                  </div>
                  <div class="toggle-sub min-games-input" :class="{ active: comboTrioMinWinRate > 0 }" title="只统计胜率≥该值的组合">
                    <span style="font-size:13px">胜率≥</span>
                    <input v-model="comboTrioMinWinRateText" type="number" min="0" max="100" step="1" placeholder="不限" class="min-games-input-box" @change="applyComboTrioMinWinRate" @keydown.enter="(e) => (e.target as HTMLInputElement).blur()" />
                    <span style="font-size:11px;color:var(--text-muted,#888)">%</span>
                  </div>
                </div>
                <div class="combo-title">三人搭档</div>
                <table class="stat-table combo-table">
                  <thead>
                    <tr>
                      <th class="st-champ">组合</th>
                      <th class="st-num sortable" @click="toggleComboTrioSort('games')">场次{{ comboTrioSortIcon('games') }}</th>
                      <th class="st-num sortable" @click="toggleComboTrioSort('winRate')">胜率{{ comboTrioSortIcon('winRate') }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="c in comboRows.trios.slice(0, comboTrioShown)" :key="c.members.join('|')">
                      <td class="combo-members">{{ c.members.map(memberName).join(' / ') }}</td>
                      <td class="st-num">{{ c.games }}</td>
                      <td class="st-num"><span :class="winRateClass(c.winRate)">{{ c.winRate.toFixed(0) }}%</span></td>
                    </tr>
                    <tr v-if="!comboRows.trios.length"><td colspan="3" class="empty-table-row">暂无满足条件的三人组合</td></tr>
                  </tbody>
                </table>
                <div v-if="comboRows.trios.length > comboTrioShown" class="table-more-bar">
                  <button class="toggle-sub" @click="loadMoreComboTrio">加载更多（{{ Math.min(TABLE_STEP, comboRows.trios.length - comboTrioShown) }} 组）</button>
                  <button class="toggle-sub" @click="comboTrioShown = comboRows.trios.length">显示全部 {{ comboRows.trios.length }} 组</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ═══════════════ 玩家组队搭档统计 ═══════════════ -->
      <div v-if="teamPlayers.length" class="stat-module">
        <div class="stat-section">
          <div class="stat-title-line" @click="toggleSection('team')">
            <component :is="teamSectionVisible ? ChevronDown : ChevronRight" :size="14" />
            <span class="section-title">玩家组队搭档统计</span>
            <span class="stat-subtitle">{{ targetStat?.gameName || '' }} · {{ teamMode === 'teammate' ? '搭档胜率' : '对位胜率' }}</span>
          </div>
          <div v-if="openedOnce.team" v-show="teamSectionVisible" class="stat-section-body">
            <div class="stat-header">
              <select v-model="targetPuuid" class="stat-search" style="width: 180px; cursor: pointer; padding: 5px 8px;" title="选择要分析的玩家">
                <option v-for="p in teamPlayers" :key="p.puuid" :value="p.puuid">{{ p.gameName }}（{{ p.games }}场）</option>
              </select>
              <button class="toggle-sub" :class="{ active: teamMode === 'teammate' }" @click="teamMode = 'teammate'">
                <component :is="teamMode === 'teammate' ? Check : X" :size="14" />
                <span>搭档</span>
              </button>
              <button class="toggle-sub" :class="{ active: teamMode === 'opponent' }" @click="teamMode = 'opponent'">
                <component :is="teamMode === 'opponent' ? Check : X" :size="14" />
                <span>对位</span>
              </button>
              <div class="toggle-sub min-games-input" :class="{ active: teamMinGames > 0 }" title="只统计共同出场场次≥该值的玩家，留空为不限">
                <span style="font-size:13px">共同场次≥</span>
                <input
                  v-model="teamMinGamesText"
                  type="number"
                  min="1"
                  step="1"
                  placeholder="不限"
                  class="min-games-input-box"
                  @change="applyTeamMinGames"
                  @keydown.enter="(e) => (e.target as HTMLInputElement).blur()"
                />
              </div>
              <div class="toggle-sub min-games-input" :class="{ active: teamMinWinRate > 0 }" title="只统计胜率≥该值的玩家，留空为不限">
                <span style="font-size:13px">胜率≥</span>
                <input
                  v-model="teamMinWinRateText"
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  placeholder="不限"
                  class="min-games-input-box"
                  @change="applyTeamMinWinRate"
                  @keydown.enter="(e) => (e.target as HTMLInputElement).blur()"
                />
                <span style="font-size:11px;color:var(--text-muted,#888)">%</span>
              </div>
              <span v-if="teamSampleInsufficient > 0" class="stat-subtitle" style="color:#f87171">样本/胜率不足{{ teamSampleInsufficient }}人，不计入排名</span>
            </div>
            <div v-if="targetStat" class="stat-header" style="margin-top:8px">
              <span class="stat-subtitle">
                <b style="color:#a5b4fc">{{ targetStat.gameName }}</b> 全局 {{ targetStat.wins }} 胜 / {{ targetStat.games }} 场 · 总胜率
                <b :class="winRateClass(targetStat.winRate)">{{ targetStat.winRate.toFixed(0) }}%</b>
              </span>
            </div>
            <div class="stat-table-scroll">
              <table class="stat-table champion-table">
                <thead>
                  <tr>
                    <th class="st-champ">{{ teamMode === 'teammate' ? '搭档' : '对手' }}</th>
                    <th class="st-num sortable" style="text-align:center" @click="toggleTeamSort('games')">{{ teamMode === 'teammate' ? '共同场次' : '交手场次' }}{{ teamSortIcon('games') }}</th>
                    <th class="st-num sortable" style="text-align:center" @click="toggleTeamSort('wins')">胜场{{ teamSortIcon('wins') }}</th>
                    <th class="st-num sortable" style="text-align:center" @click="toggleTeamSort('winRate')">胜率{{ teamSortIcon('winRate') }}</th>
                    <th class="st-num" style="text-align:center">近5场</th>
                    <th class="st-player">排名</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-if="teamQualifiedRows.length === 0">
                    <td colspan="6" class="empty-table-row">没有满足条件的{{ teamMode === 'teammate' ? '搭档' : '对手' }}记录{{ teamSampleInsufficient > 0 ? '（样本场次不足，不计入排名）' : '' }}</td>
                  </tr>
                  <template v-if="teamQualifiedRows.length">
                    <tr v-for="(r, i) in teamSortedRows.slice(0, teamShown)" :key="r.puuid" @click="switchTeamTarget(r.puuid)">
                      <td class="st-champ"><span class="st-champ-name">{{ r.gameName }}</span></td>
                      <td class="st-num" style="text-align:center">{{ r.games }}</td>
                      <td class="st-num" style="text-align:center">{{ r.wins }}</td>
                      <td class="st-num" style="text-align:center"><span :class="winRateClass(r.winRate)">{{ r.winRate.toFixed(0) }}%</span></td>
                      <td class="st-num" style="text-align:center"><span class="recent-dots"><span v-for="(w, idx) in r.recent" :key="idx" class="recent-dot" :class="w ? 'win' : 'loss'"></span><span v-if="!r.recent.length" class="dim">-</span></span></td>
                      <td class="st-player">
                        <span class="st-pick" :class="{ 'sc-high': i === 0 }">全榜第 {{ i + 1 }}</span>
                      </td>
                    </tr>
                  </template>
                </tbody>
              </table>
            </div>
            <div v-if="teamSortedRows.length > teamShown" class="table-more-bar">
              <span class="stat-subtitle">已显示 {{ teamShown }} / {{ teamSortedRows.length }}</span>
              <button class="toggle-sub" @click="loadMoreTeam">加载更多（{{ Math.min(TABLE_STEP, teamSortedRows.length - teamShown) }} 人）</button>
              <button class="toggle-sub" @click="teamShown = teamSortedRows.length">显示全部 {{ teamSortedRows.length }} 人</button>
            </div>
            <div class="stat-header" style="margin-top:6px">
              <span class="stat-subtitle">点击玩家名切换目标玩家 · {{ teamMinGames > 0 ? '仅统计共同出场≥' + teamMinGames + '场' : '不限场次' }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- ═══════════════ 英雄 / 海克斯统计 ═══════════════ -->
      <div v-if="statHasData" class="stat-module">
        <div class="stat-section">
          <div class="stat-title-line" @click="toggleSection('champion')">
            <component :is="championSectionVisible ? ChevronDown : ChevronRight" :size="14" />
            <span class="section-title">英雄榜</span>
            <span class="stat-subtitle">{{ championStat.length }} 位英雄 · {{ championStat.reduce((s, e) => s + e.picks, 0) }} 次出场</span>
          </div>
          <div v-if="openedOnce.champion" v-show="championSectionVisible" class="stat-section-body">
          <div class="stat-header">
            <input v-model="championSearch" placeholder="搜英雄" class="stat-search" />
            <div class="toggle-sub min-games-input" :class="{ active: championMinPicks > 0 }" title="只显示出现次数≥该值的英雄，留空为不限">
              <span style="font-size:13px">次数≥</span>
              <input
                v-model="championMinPicksText"
                type="number"
                min="1"
                step="1"
                placeholder="不限"
                class="min-games-input-box"
                @change="applyChampionMinPicks"
                @keydown.enter="(e) => (e.target as HTMLInputElement).blur()"
              />
            </div>
            <div class="toggle-sub min-games-input" :class="{ active: championBestMinPicks > 0 }" title="胜率最高只统计使用次数≥该值的玩家，留空为不限">
              <span style="font-size:13px">胜率最高局数≥</span>
              <input
                v-model="championBestMinPicksText"
                type="number"
                min="1"
                step="1"
                placeholder="不限"
                class="min-games-input-box"
                @change="applyChampionBestMinPicks"
                @keydown.enter="(e) => (e.target as HTMLInputElement).blur()"
              />
            </div>
            <div class="toggle-sub min-games-input" :class="{ active: championWorstMinPicks > 0 }" title="胜率最低只统计使用次数≥该值的玩家，留空为不限">
              <span style="font-size:13px">胜率最低局数≥</span>
              <input
                v-model="championWorstMinPicksText"
                type="number"
                min="1"
                step="1"
                placeholder="不限"
                class="min-games-input-box"
                @change="applyChampionWorstMinPicks"
                @keydown.enter="(e) => (e.target as HTMLInputElement).blur()"
              />
            </div>
            <span class="stat-subtitle" style="margin-left:auto">点击英雄行可查看该英雄的详细战绩与使用玩家</span>
          </div>
          <div class="stat-table-scroll">
            <table class="stat-table champion-table">
              <thead>
                <tr>
                  <th class="st-champ">英雄</th>
                  <th class="st-num sortable" @click="toggleChampionSort('picks')">次数{{ championSortIcon('picks') }}</th>
                  <th class="st-num sortable" @click="toggleChampionSort('winRate')">胜率{{ championSortIcon('winRate') }}</th>
                  <th class="st-player">最喜欢</th>
                  <th class="st-player">胜率最高</th>
                  <th class="st-player">胜率最低</th>
                  <th class="st-players">使用玩家</th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="sortedChampionStat.length === 0">
                  <td colspan="7" class="empty-table-row">
                    {{ championMinPicks > 0 ? `次数≥${championMinPicks} 过滤后暂无英雄，请调低次数限制` : championSearch ? '搜索无匹配英雄' : '该日期没有英雄记录' }}
                  </td>
                </tr>
                <tr v-for="ch in sortedChampionStat" :key="ch.championId" class="champion-row" @click="openChampionDrawer(ch.championId)">
                  <td class="st-champ">
                    <ChampionAvatar :champion-id="ch.championId" :champions="props.champions" :size="24" />
                    <span class="st-champ-name">{{ ch.name }}</span>
                  </td>
                  <td class="st-num">{{ ch.picks }}</td>
                  <td class="st-num"><span :class="winRateClass(ch.winRate)">{{ ch.winRate.toFixed(0) }}%</span></td>
                  <td class="st-player">{{ ch.favorite ? `${ch.favorite.gameName}·${ch.favorite.picks}局` : '-' }}</td>
                  <td class="st-player" v-if="ch.best">{{ ch.best.gameName }}·{{ ch.best.picks }}局·<span :class="winRateClass(ch.best.winRate)">{{ ch.best.winRate.toFixed(0) }}%</span></td>
                  <td class="st-player" v-else>-</td>
                  <td class="st-player" v-if="ch.worst">{{ ch.worst.gameName }}·{{ ch.worst.picks }}局·<span :class="winRateClass(ch.worst.winRate)">{{ ch.worst.winRate.toFixed(0) }}%</span></td>
                  <td class="st-player" v-else>-</td>
                  <td class="st-players">
                    <template v-for="pl in ch.players.slice(0, 5)" :key="pl.puuid">
                      <span class="st-pick" :class="winRateClass(pl.winRate)" :title="`${pl.gameName} · ${pl.picks}局 · 胜率${pl.winRate.toFixed(0)}%`">{{ pl.gameName.slice(0, 6) }}<em>{{ pl.picks }}</em></span>
                    </template>
                    <span v-if="ch.players.length > 5" class="st-more">+{{ ch.players.length - 5 }}</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          </div>
        </div>

        <div v-if="augmentStat.length > 0" class="stat-section">
          <div class="stat-title-line" @click="toggleSection('augment')">
            <component :is="augmentSectionVisible ? ChevronDown : ChevronRight" :size="14" />
            <span class="section-title">海克斯榜</span>
            <span class="stat-subtitle">{{ augmentStat.length }} 个海克斯强化</span>
          </div>
          <div v-if="openedOnce.augment" v-show="augmentSectionVisible" class="stat-section-body">
          <div class="stat-header">
            <input v-model="augmentSearch" placeholder="搜海克斯" class="stat-search" />
            <div class="toggle-sub min-games-input" :class="{ active: augmentMinPicks > 0 }" title="只显示次数≥该值的海克斯，留空为不限">
              <span style="font-size:13px">次数≥</span>
              <input
                v-model="augmentMinPicksText"
                type="number"
                min="1"
                step="1"
                placeholder="不限"
                class="min-games-input-box"
                @change="applyAugmentMinPicks"
                @keydown.enter="(e) => (e.target as HTMLInputElement).blur()"
              />
            </div>
          </div>
          <div class="stat-table-scroll">
            <table class="stat-table augment-table">
              <thead>
                <tr>
                  <th class="st-name">海克斯强化</th>
                  <th class="st-num sortable" @click="toggleAugmentSort('picks')">次数{{ augmentSortIcon('picks') }}</th>
                  <th class="st-num sortable" @click="toggleAugmentSort('winRate')">胜率{{ augmentSortIcon('winRate') }}</th>
                  <th class="st-player">最喜欢拿</th>
                  <th class="st-players">拿起玩家</th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="sortedAugmentStat.length === 0">
                  <td colspan="5" class="empty-table-row">
                    {{ augmentMinPicks > 0 ? `次数≥${augmentMinPicks} 过滤后暂无海克斯，请调低次数限制` : augmentSearch ? '搜索无匹配海克斯' : '该日期没有海克斯记录' }}
                  </td>
                </tr>
                <tr v-for="a in sortedAugmentStat" :key="a.id">
                  <td class="st-name">
                    <span class="augment-dot" :class="augmentRarityClass(a.id)"></span>
                    <span class="st-aug-name" :title="a.name">{{ a.name }}</span>
                  </td>
                  <td class="st-num">{{ a.picks }}</td>
                  <td class="st-num"><span :class="winRateClass(a.winRate)">{{ a.winRate.toFixed(0) }}%</span></td>
                  <td class="st-player">{{ a.topPlayer ? `${a.topPlayer.gameName}·${a.topPlayer.picks}次` : '-' }}</td>
                  <td class="st-players">
                    <template v-for="pl in a.players.slice(0, 5)" :key="pl.puuid">
                      <span class="st-pick" :class="winRateClass(pl.winRate)" :title="`${pl.gameName} · ${pl.picks}次 · 胜率${pl.winRate.toFixed(0)}%`">{{ pl.gameName.slice(0, 6) }}<em>{{ pl.picks }}</em></span>
                    </template>
                    <span v-if="a.players.length > 5" class="st-more">+{{ a.players.length - 5 }}</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          </div>
        </div>

        <div v-if="itemStat.length > 0" class="stat-section">
          <div class="stat-title-line" @click="toggleSection('item')">
            <component :is="itemSectionVisible ? ChevronDown : ChevronRight" :size="14" />
            <span class="section-title">装备榜</span>
            <span class="stat-subtitle">{{ itemStat.length }} 件装备 · {{ itemStat.reduce((s, e) => s + e.picks, 0) }} 次出现</span>
          </div>
          <div v-if="openedOnce.item" v-show="itemSectionVisible" class="stat-section-body">
          <div class="stat-header">
            <input v-model="itemSearch" placeholder="搜装备" class="stat-search" />
            <div class="toggle-sub min-games-input" :class="{ active: itemMinPicks > 0 }" title="只显示次数≥该值的装备，留空为不限">
              <span style="font-size:13px">次数≥</span>
              <input
                v-model="itemMinPicksText"
                type="number"
                min="1"
                step="1"
                placeholder="不限"
                class="min-games-input-box"
                @change="applyItemMinPicks"
                @keydown.enter="(e) => (e.target as HTMLInputElement).blur()"
              />
            </div>
            <button class="toggle-sub" :class="{ active: onlyCompletedItems }" @click="onlyCompletedItems = !onlyCompletedItems">
              <component :is="onlyCompletedItems ? Check : X" :size="14" />
              <span style="font-size:13px">仅成装</span>
            </button>
          </div>
          <div class="stat-table-scroll">
            <table class="stat-table item-table">
              <thead>
                <tr>
                  <th class="st-name">装备</th>
                  <th class="st-num sortable" @click="toggleItemSort('picks')">次数{{ itemSortIcon('picks') }}</th>
                  <th class="st-num sortable" @click="toggleItemSort('winRate')">胜率{{ itemSortIcon('winRate') }}</th>
                  <th class="st-player">最喜欢出</th>
                  <th class="st-players">出装玩家</th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="sortedItemStat.length === 0">
                  <td colspan="5" class="empty-table-row">
                    {{ itemMinPicks > 0 ? `次数≥${itemMinPicks} 过滤后暂无装备，请调低次数限制` : itemSearch ? '搜索无匹配装备' : '该日期没有装备记录' }}
                  </td>
                </tr>
                <tr v-for="a in sortedItemStat" :key="a.id">
                  <td class="st-name">
                    <AssetIcon :path="itemMap[a.id]?.iconPath" :label="itemMap[a.id]?.name" :fallback="String(a.id)" :size="20" />
                    <span class="st-aug-name" :title="a.name">{{ a.name }}</span>
                  </td>
                  <td class="st-num">{{ a.picks }}</td>
                  <td class="st-num"><span :class="winRateClass(a.winRate)">{{ a.winRate.toFixed(0) }}%</span></td>
                  <td class="st-player">{{ a.topPlayer ? `${a.topPlayer.gameName}·${a.topPlayer.picks}次` : '-' }}</td>
                  <td class="st-players">
                    <template v-for="pl in a.players.slice(0, 5)" :key="pl.puuid">
                      <span class="st-pick" :class="winRateClass(pl.winRate)" :title="`${pl.gameName} · ${pl.picks}次 · 胜率${pl.winRate.toFixed(0)}%`">{{ pl.gameName.slice(0, 6) }}<em>{{ pl.picks }}</em></span>
                    </template>
                    <span v-if="a.players.length > 5" class="st-more">+{{ a.players.length - 5 }}</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          </div>
        </div>
      </div>

      <!-- 海克斯级别与刷新统计 -->
      <div v-if="augmentTierStats.totalPicks > 0" class="stat-module">
        <div class="stat-section">
          <div class="stat-title-line" @click="toggleSection('augTier')">
            <component :is="augmentTierSectionVisible ? ChevronDown : ChevronRight" :size="14" />
            <span class="section-title">海克斯级别与刷新</span>
            <span class="stat-subtitle">彩/金/银出现概率 · 组合分布 · 金色/棱彩刷新概率</span>
          </div>
          <div v-if="openedOnce.augTier" v-show="augmentTierSectionVisible" class="stat-section-body">
            <div class="aug-tier-cards">
              <div v-for="t in [['彩', '#c77dff'], ['金', '#f0b429'], ['银', '#a9b7c6']]" :key="t[0]" class="aug-tier-card">
                <span class="aug-tier-dot" :style="{ background: t[1] }"></span>
                <span class="aug-tier-name">{{ t[0] }}</span>
                <b>{{ tierPctStr(augmentTierStats.tierTotals[t[0]] || 0, augmentTierStats.totalPicks) }}</b>
                <span class="aug-tier-num">{{ augmentTierStats.tierTotals[t[0]] || 0 }} 次</span>
              </div>
            </div>

            <div class="aug-refresh-cards">
              <div class="aug-refresh-card aug-gold">
                <span class="aug-refresh-label">金色刷新概率</span>
                <b class="aug-refresh-rate" style="color:#f0b429">{{ (augmentTierStats.goldRefreshRate * 100).toFixed(1) }}%</b>
                <span class="stat-subtitle">{{ augmentTierStats.goldRefreshCount }} / {{ augmentTierStats.silverSlotPicks }} 个银槽 · 涉及 {{ augmentTierStats.goldRefreshGames }} / {{ augmentTierStats.totalGames }} 局</span>
              </div>
              <div class="aug-refresh-card">
                <span class="aug-refresh-label">棱彩刷新概率</span>
                <b class="aug-refresh-rate">{{ (augmentTierStats.refreshRate * 100).toFixed(1) }}%</b>
                <span class="stat-subtitle">{{ augmentTierStats.refreshCount }} / {{ augmentTierStats.goldSlotPicks }} 个金槽 · 涉及 {{ augmentTierStats.refreshGames }} / {{ augmentTierStats.totalGames }} 局</span>
              </div>
            </div>
            <div class="aug-refresh-hint">口径：某位置全队多数为银时视作银槽，银槽上单人为金即计为一次金色刷新（银→金）；多数为金时视作金槽，金槽上单人为彩即计为一次棱彩刷新（金→彩）（对局提前结束时缺失的海克斯不计）</div>

            <div class="stat-table-scroll" style="max-height: 260px">
              <table class="stat-table">
                <thead>
                  <tr>
                    <th class="st-champ">选择位置</th>
                    <th class="st-num" style="text-align:center">人次</th>
                    <th class="st-num" style="text-align:center"><span class="aug-dot-text" style="color:#c77dff">彩</span></th>
                    <th class="st-num" style="text-align:center"><span style="color:#f0b429">金</span></th>
                    <th class="st-num" style="text-align:center"><span style="color:#c6d4de">银</span></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(pos, i) in augmentTierStats.posAgg" :key="i">
                    <td class="st-champ"><span class="st-champ-name">第 {{ i + 1 }} 个海克斯</span></td>
                    <td class="st-num" style="text-align:center">{{ pos.total }}</td>
                    <td class="st-num" style="text-align:center"><b style="color:#c77dff">{{ tierPctStr(pos.prismatic, pos.total) }}</b></td>
                    <td class="st-num" style="text-align:center"><b style="color:#f0b429">{{ tierPctStr(pos.gold, pos.total) }}</b></td>
                    <td class="st-num" style="text-align:center">{{ tierPctStr(pos.silver, pos.total) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div class="stat-header" style="margin-top: 10px">
              <span class="stat-subtitle">组合分布（按选择顺序，如"彩彩金金"）· 共 {{ augmentTierStats.combos.length }} 种</span>
            </div>
            <div class="stat-table-scroll">
              <table class="stat-table">
                <thead>
                  <tr>
                    <th class="st-champ">组合</th>
                    <th class="st-num sortable" style="text-align:center" @click="toggleAugComboSort">次数{{ augComboSortIcon() }}</th>
                    <th class="st-num" style="text-align:center">概率</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="c in sortedAugCombos" :key="c.key">
                    <td class="st-champ">
                      <span class="aug-combo-chip" v-for="(t, ti) in c.parts" :key="ti" :class="`ac-${t}`">{{ t }}</span>
                    </td>
                    <td class="st-num" style="text-align:center"><b>{{ c.count }}</b></td>
                    <td class="st-num" style="text-align:center">{{ tierPctStr(c.count, augmentTierStats.totalCombos) }}</td>
                  </tr>
                  <tr v-if="!augmentTierStats.combos.length">
                    <td colspan="3" class="empty-table-row">暂无海克斯数据</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <ChampionDetailDrawer
        v-if="drawerChampionId != null && drawerChampionMeta"
        :champion-id="drawerChampionId"
        :champion-name="drawerChampionMeta.name"
        :games="drawerGames"
        :champions="props.champions"
        :item-map="itemMap"
        :spell-map="spellMap"
        :augment-map="augmentMap"
        :perk-map="perkMap"
        :champion-total-picks="drawerChampionMeta.picks"
        :champion-total-win-rate="drawerChampionMeta.winRate"
        @close="closeChampionDrawer"
      />

      <PlayerDetailDrawer
        v-if="drawerPlayer"
        :player="drawerPlayer"
        :champions="props.champions"
        :range-text="startDate === endDate ? startDate : `${startDate} 至 ${endDate}`"
        @close="closePlayerDrawer"
      />
    </template>
  </div>
</template>

<style scoped>
.crp { display: flex; flex-direction: column; gap: 16px; }

/* ── header ── */
.panel-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 8px; }
.panel-header h2 { margin: 0; }
.section-title { font-size: 14px; font-weight: 700; color: inherit; white-space: nowrap; }
.rating-title-line { display: flex; align-items: center; gap: 6px; padding: 6px 0; margin-bottom: 0; cursor: pointer; }
.rating-title-line:hover { color: var(--accent, #6366f1); }
.eyebrow { font-size: 11px; color: var(--text-muted, #888); text-transform: uppercase; letter-spacing: 0.5px; }
.header-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.date-picker-wrap { display: flex; align-items: center; gap: 4px; background: var(--bg-tertiary, #2a2a2a); border: 1px solid var(--border, #444); border-radius: 6px; padding: 6px 10px; color: var(--text-muted, #888); }
.date-input { background: transparent; border: none; color: inherit; font-size: 13px; outline: none; font-family: inherit; width: 110px; }
.date-input::-webkit-calendar-picker-indicator { filter: invert(0.7); cursor: pointer; }
.date-sep { color: var(--text-muted, #555); font-size: 13px; user-select: none; }
.quick-range-select { background: transparent; border: none; border-left: 1px solid var(--border, #444); margin-left: 4px; padding-left: 8px; color: inherit; font-size: 12px; outline: none; cursor: pointer; font-family: inherit; max-width: 150px; }
.quick-range-select option { color: #333; background: #fff; }

/* ── summary ── */
.summary-card { background: var(--bg-tertiary, #1e1e1e); border: 1px solid var(--border, #333); border-radius: 10px; padding: 14px 18px; display: flex; flex-direction: column; gap: 12px; }
.summary-grid { display: flex; gap: 20px; flex-wrap: wrap; }
.summary-item { display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 60px; }
.sl { font-size: 11px; color: var(--text-muted, #888); text-transform: uppercase; letter-spacing: 0.5px; white-space: nowrap; }
.sv { font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums; color: var(--text, #eee); }
.summary-details { display: flex; gap: 20px; flex-wrap: wrap; border-top: 1px solid var(--border, #333); padding-top: 10px; }
.summary-positions, .summary-tags, .summary-tiers { display: flex; flex-direction: column; gap: 6px; flex: 1; min-width: 160px; }
.sdl { font-size: 11px; font-weight: 600; color: var(--text-muted, #888); text-transform: uppercase; letter-spacing: 0.5px; }
.position-bars { display: flex; flex-direction: column; gap: 4px; }
.pbr { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.pbl { width: 64px; text-align: right; color: var(--text-muted, #aaa); flex-shrink: 0; white-space: nowrap; }
.pbt { flex: 1; height: 8px; background: var(--bg-secondary, #2a2a2a); border-radius: 4px; overflow: hidden; }
.pbf { height: 100%; background: linear-gradient(90deg, #6366f1, #8b5cf6); border-radius: 4px; transition: width 0.3s; }
.pbc { width: 20px; text-align: left; font-weight: 600; color: var(--text, #ddd); font-variant-numeric: tabular-nums; }
.tag-badges { display: flex; flex-wrap: wrap; gap: 4px; }
.tag-badge { display: inline-flex; align-items: center; gap: 3px; padding: 2px 7px; background: rgba(99, 102, 241, 0.12); border: 1px solid rgba(99, 102, 241, 0.2); border-radius: 4px; font-size: 11px; color: #a5b4fc; }
.tag-badge em { font-style: normal; color: #818cf8; font-weight: 600; }
.tier-bars { display: flex; flex-direction: column; gap: 4px; }
.tier-bar-row { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.tier-label { width: 56px; text-align: right; flex-shrink: 0; font-weight: 600; }
.tier-track { flex: 1; height: 8px; background: var(--bg-secondary, #2a2a2a); border-radius: 4px; overflow: hidden; }
.tier-fill { height: 100%; border-radius: 4px; transition: width 0.3s; }
.tier-count { width: 20px; text-align: left; font-weight: 600; color: var(--text, #ddd); font-variant-numeric: tabular-nums; }

/* ── game section ── */
.game-section { display: flex; flex-direction: column; gap: 8px; }
.game-more-bar { display: flex; align-items: center; justify-content: center; gap: 10px; padding: 10px 0 4px; flex-wrap: wrap; }
.table-more-bar { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 8px 0 2px; flex-wrap: wrap; }
.game-section-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; padding: 6px 0; cursor: pointer; user-select: none; }
.game-section-header:hover { color: var(--accent, #6366f1); }
.gsh-left { display: flex; align-items: center; gap: 8px; }
.gsh-left .section-title { display: inline-flex; align-items: center; gap: 6px; }
.gsh-right { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

.game-list { display: flex; flex-direction: column; gap: 6px; }

/* ── game list toolbar（时间分栏视图切换） ── */
.game-list-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 2px 0 4px; }
.game-view-select { background: var(--bg-tertiary, #2a2a2a); border: 1px solid var(--border, #444); border-radius: 6px; padding: 4px 8px; color: #ffffff; font-size: 12px; font-family: inherit; outline: none; cursor: pointer; }
.game-view-select option { color: #333; background: #fff; }
.game-search-box { display: inline-flex; align-items: center; gap: 6px; background: #ffffff; border: 1px solid #cbd8dc; border-radius: 8px; padding: 5px 10px; min-width: 260px; }
.game-search-box:focus-within { border-color: #1f5f56; box-shadow: 0 0 0 2px rgba(31, 95, 86, 0.15); }
.game-search-icon { color: #6f8a90; flex-shrink: 0; }
.game-search-input { border: none; outline: none; background: transparent; color: #1f2a2e; font-size: 13px; font-family: inherit; width: 100%; min-width: 0; }
.game-search-input::placeholder { color: #93a4a9; }
.game-search-clear { color: #6f8a90; cursor: pointer; flex-shrink: 0; }
.game-search-clear:hover { color: #c53030; }
.game-search-empty { display: flex; justify-content: center; align-items: center; padding: 28px 0; color: #7a8a8f; font-size: 13px; border: 1px dashed var(--border, #cbd8dc); border-radius: 8px; }

/* ── 时间分组：月份头 / 日期头 ── */
.game-month-header { display: flex; align-items: center; gap: 10px; padding: 9px 12px; margin-top: 6px; background: var(--bg-tertiary, #232323); border: 1px solid var(--border, #3a3a3a); border-radius: 8px; cursor: pointer; user-select: none; font-size: 15px; color: var(--text, #eee); }
.game-month-header:hover { border-color: var(--accent, #6366f1); color: #c7d2fe; }
.game-month-header .gm-label { font-weight: 700; font-size: 15px; }
.game-month-header .gm-count { color: var(--text-strong, #d6d6d6); font-weight: 700; font-size: 13px; }
.game-month-header .gm-hint { color: #aab6e6; font-size: 12px; margin-left: auto; }
.game-date-header { display: flex; align-items: center; gap: 8px; padding: 8px 4px 2px; font-size: 13px; color: #111827; border-bottom: 1px dashed var(--border, #c8d2d8); }
.game-date-header .gd-label { font-weight: 700; font-size: 14px; color: #000000; }
.game-date-header .gd-count { margin-left: auto; color: #374151; font-size: 12px; font-weight: 600; }

/* ── game card ── */
.game-card-outer { position: relative; }
.game-card { display: flex; align-items: stretch; gap: 0; background: var(--bg-tertiary, #1e1e1e); border: 1px solid var(--border, #333); border-radius: 8px; overflow: hidden; position: relative; cursor: pointer; }
.game-has-expanded { border-radius: 8px 8px 0 0; }

.team-col { display: flex; flex: 1; padding: 8px 10px; min-width: 0; position: relative; }
.bc-blue { background: rgba(59, 130, 246, 0.05); }
.bc-red { background: rgba(239, 68, 68, 0.05); }
.team-win-border { border: 2px solid; }
.bc-blue.team-win-border { border-color: rgba(59, 130, 246, 0.5); }
.bc-red.team-win-border { border-color: rgba(239, 68, 68, 0.5); }
.team-lose-dim { opacity: 0.7; filter: saturate(0.6); }

.team-players-row { display: flex; gap: 6px; align-items: center; width: 100%; justify-content: space-around; }
.tp-avatar-wrap { display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 0; flex: 1; }
.tp-avatar-frame { position: relative; }
.mvp-crown { position: absolute; top: -5px; right: -5px; color: #fbbf24; filter: drop-shadow(0 0 2px rgba(251, 191, 36, 0.6)); }
.tp-name { font-size: 10px; color: var(--text-muted, #888); text-align: center; max-width: 50px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 1.2; }
.tp-score { font-size: 10px; font-weight: 700; padding: 0 4px; border-radius: 2px; line-height: 1.3; }

/* center column */
.game-center-col { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; padding: 8px 12px; min-width: 100px; border-left: 1px solid var(--border, #333); border-right: 1px solid var(--border, #333); background: var(--bg-secondary, #252525); flex-shrink: 0; }
.gc-badges { display: flex; gap: 4px; }
.queue-badge-sm { padding: 1px 6px; border-radius: 3px; font-size: 10px; font-weight: 600; background: #3a3a5a; color: #aab; }
.dur-badge { padding: 1px 6px; border-radius: 3px; font-size: 10px; font-weight: 600; background: rgba(255,255,255,0.06); color: var(--text-muted, #888); }
.gc-mvp { display: flex; align-items: center; gap: 3px; }
.mvp-icon { color: #fbbf24; }
.mvp-name { font-size: 11px; font-weight: 700; color: #fbbf24; }
.gc-scores { display: flex; align-items: center; gap: 4px; }
.team-score { font-size: 16px; font-weight: 800; font-variant-numeric: tabular-nums; }
.blue-score { color: #60a5fa; }
.red-score { color: #f87171; }
.score-vs { color: var(--text-muted, #555); font-size: 12px; }
.gc-tags-row { display: flex; gap: 3px; flex-wrap: wrap; justify-content: center; }
.game-tag { padding: 1px 5px; border-radius: 3px; font-size: 9px; font-weight: 700; }
.tag-quick { background: rgba(168, 85, 247, 0.2); color: #c084fc; }
.tag-long { background: rgba(251, 146, 60, 0.2); color: #fb923c; }
.tag-stomp { background: rgba(239, 68, 68, 0.2); color: #f87171; }

.game-expand-btn { position: absolute; bottom: 2px; right: 22px; background: transparent; border: none; color: var(--text-muted, #555); cursor: pointer; padding: 2px; line-height: 1; z-index: 2; }
.game-delete-btn { position: absolute; bottom: 2px; right: 4px; background: transparent; border: none; color: var(--text-muted, #444); cursor: pointer; padding: 2px; line-height: 1; z-index: 2; opacity: 0; transition: opacity 0.15s, color 0.15s; }
.game-card:hover .game-delete-btn { opacity: 1; }
.game-delete-btn:hover { color: #f87171; }

/* expanded mini table：明细行样式已抽成 GameDetailTeams 复用组件 */
.game-expanded-table { background: var(--bg-secondary, #1a1a2e); border: 1px solid var(--border, #333); border-top: none; border-radius: 0 0 8px 8px; padding: 8px 12px; overflow-x: auto; display: flex; flex-direction: column; gap: 10px; }

/* hover tooltip */
.game-hover-tooltip { position: absolute; top: 100%; left: 0; right: 0; z-index: 100; background: #1a1a2e; border: 1px solid #444; border-radius: 8px; padding: 10px 14px; display: flex; gap: 16px; margin-top: 4px; box-shadow: 0 8px 24px rgba(0,0,0,0.5); }
.ght-team { flex: 1; display: flex; flex-direction: column; gap: 3px; }
.ght-header { font-size: 10px; font-weight: 700; text-transform: uppercase; margin-bottom: 3px; }
.ght-win { color: #4ade80; }
.ght-lose { color: #f87171; }
.ght-player { display: flex; align-items: center; gap: 5px; font-size: 11px; padding: 2px 4px; background: rgba(255,255,255,0.04); border-radius: 3px; }
.ght-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text, #ddd); }
.ght-kda { font-size: 10px; color: var(--text-muted, #888); font-variant-numeric: tabular-nums; white-space: nowrap; }
.ght-score { font-size: 10px; font-weight: 700; padding: 0 3px; border-radius: 2px; }

/* ── filter bar ── */
.filter-bar { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; flex-wrap: wrap; }
.filter-input { padding: 5px 10px; background: var(--bg-tertiary, #2a2a2a); border: 1px solid var(--border, #444); border-radius: 4px; color: var(--text, #eee); font-size: 12px; outline: none; width: 120px; }
.filter-input::placeholder { color: var(--text-muted, #666); }
.min-games-input { padding: 6px 10px; gap: 4px; }
.min-games-input-box { width: 42px; background: none; border: none; outline: none; color: inherit; font-size: 13px; font-variant-numeric: tabular-nums; }
.min-games-input-box::-webkit-inner-spin-button,
.min-games-input-box::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
.min-games-input-box::placeholder { color: var(--text-muted, #888); font-size: 12px; }
.toggle-sub { display: inline-flex; align-items: center; gap: 4px; padding: 5px 10px; background: #fff; border: 1px solid #d0d0d0; border-radius: 4px; color: #333; font-size: 11px; cursor: pointer; }
.toggle-sub:hover { border-color: var(--accent, #6366f1); color: var(--accent, #6366f1); }
.toggle-sub.active { background: var(--accent, #6366f1); border-color: var(--accent, #6366f1); color: #fff; }
.toggle-sub.active:hover { opacity: 0.85; }
.filter-count { font-size: 11px; color: var(--text-muted, #666); margin-left: auto; white-space: nowrap; }
.export-menu-wrap { position: relative; display: inline-flex; align-items: center; gap: 6px; }
.export-menu { position: absolute; top: calc(100% + 4px); right: 0; z-index: 40; min-width: 190px; background: var(--bg-tertiary, #1e1e1e); border: 1px solid var(--border, #333); border-radius: 6px; box-shadow: 0 8px 20px rgba(0, 0, 0, 0.35); padding: 4px; display: flex; flex-direction: column; }
.export-menu-item { display: flex; justify-content: space-between; gap: 12px; padding: 7px 9px; border: none; background: none; color: var(--text, #eee); font-size: 12px; text-align: left; cursor: pointer; border-radius: 4px; }
.export-menu-item:hover { background: var(--accent, #6366f1); color: #fff; }
.export-menu-item:disabled { opacity: 0.5; cursor: not-allowed; }
.export-menu-desc { font-size: 11px; color: var(--text-muted, #888); }
.export-menu-item:hover .export-menu-desc { color: rgba(255, 255, 255, 0.8); }
.export-menu-group { padding: 6px 9px 3px; font-size: 11px; font-weight: 700; color: var(--text-muted, #888); white-space: nowrap; }
.export-menu-divider { height: 1px; margin: 4px 6px; background: var(--border, #333); }
.export-message { font-size: 11px; color: var(--accent, #a5b4fc); white-space: nowrap; }
.toggle-sub:disabled { opacity: 0.6; cursor: not-allowed; }
.empty-table-row { text-align: center; color: var(--text-muted, #888); font-size: 12px; padding: 24px 0 !important; }

/* ── rating table ── */
.rating-table-wrap { overflow-x: auto; position: relative; border-top: 1px solid var(--border, #333); padding-top: 8px; }
.table-scroll { overflow-x: auto; }
.rating-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.rating-table th, .rating-table td { padding: 7px 8px; text-align: center; border-bottom: 1px solid var(--border, #333); vertical-align: middle; }
.rating-table th { font-weight: 600; color: var(--text-muted, #888); white-space: nowrap; font-size: 11px; text-transform: uppercase; letter-spacing: 0.3px; user-select: none; }
.rating-table th.sortable { cursor: pointer; }
.rating-table th.sortable:hover { color: var(--accent, #6366f1); }

/* zebra */
.row-zebra { background: rgba(255,255,255,0.02); }
.rating-table tbody tr { cursor: pointer; }
.rating-table tbody tr:hover { background: rgba(99, 102, 241, 0.14) !important; }

.col-player { text-align: left; min-width: 100px; white-space: nowrap; }
.col-player :deep(svg) { vertical-align: middle; margin-right: 4px; }
.col-rank { width: 28px; }

.col-num { width: 36px; font-variant-numeric: tabular-nums; }
.col-num-sortable { width: 40px; font-variant-numeric: tabular-nums; }
.col-score { width: 46px; font-weight: 700; font-variant-numeric: tabular-nums; }
.col-label { width: 60px; }
.col-kda { font-size: 11px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.col-ability { width: 38px; font-size: 12px; }
.col-detail { width: 48px; font-size: 11px; font-variant-numeric: tabular-nums; }

/* win rate column */
.wr-cell { font-weight: 700; }
.wr-high { color: #4ade80; background: rgba(74, 222, 128, 0.08); border-radius: 3px; }
.wr-low { color: #f87171; background: rgba(248, 113, 113, 0.08); border-radius: 3px; }

/* score column coloring */
.col-score.sc-high { color: #4ade80; }
.col-score.sc-mid { color: #60a5fa; background: rgba(96, 165, 250, 0.18); }
.col-score.sc-low { color: #f87171; }
.sc-high { color: #4ade80; background: rgba(74, 222, 128, 0.15); }
.sc-mid { color: #60a5fa; background: rgba(96, 165, 250, 0.18); }
.sc-low { color: #f87171; background: rgba(248, 113, 113, 0.15); }

.col-ability span { display: inline-block; padding: 1px 6px; border-radius: 3px; }
.ab-high { color: #4ade80; background: rgba(74, 222, 128, 0.1); }
.ab-mid { color: #60a5fa; background: rgba(96, 165, 250, 0.14); }
.ab-low { color: #f87171; background: rgba(248, 113, 113, 0.1); }

/* ── max / min cell markers ── */
.cell-best { outline: 2px solid rgba(74, 222, 128, 0.6); outline-offset: -2px; border-radius: 3px; background: rgba(74, 222, 128, 0.08); }
.cell-worst { outline: 2px solid rgba(248, 113, 113, 0.6); outline-offset: -2px; border-radius: 3px; background: rgba(248, 113, 113, 0.08); }

.pos-badge { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 11px; font-weight: 600; background: rgba(99, 102, 241, 0.1); color: #a5b4fc; }
.dim { color: var(--text-muted, #555); }
.score-badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; white-space: nowrap; }
.score-high { background: #1a6b3c; color: #4ade80; }
.score-mid { background: #6b5b1a; color: #facc15; }
.score-low { background: #6b1a1a; color: #f87171; }

/* ── leader columns ── */
.col-num-leader { width: 50px; font-variant-numeric: tabular-nums; font-size: 13px; font-weight: 700; }
.ld-damage { color: #fb923c; }
.ld-mitigation { color: #60a5fa; }
.ld-assist { color: #4ade80; }

/* ── reviews ── */
.review-section { border-top: 1px solid var(--border, #333); padding-top: 8px; }

.loading-state, .error-state, .empty-state { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 48px 0; color: var(--text-muted, #888); }
.spin { animation: spin 1s linear infinite; }
@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

/* ── 英雄 / 海克斯统计模块 ── */
.stat-module { display: flex; flex-direction: column; gap: 16px; padding-top: 8px; }
.stat-section { border-top: 1px solid var(--border, #333); padding-top: 6px; }
.stat-title-line { display: flex; align-items: center; gap: 6px; cursor: pointer; padding: 6px 0; user-select: none; }
.stat-title-line:hover { color: var(--accent, #6366f1); }
.stat-section-body { margin-top: 8px; }
.stat-header { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.stat-subtitle { font-size: 12px; color: var(--text-muted, #888); }
.stat-sorts { display: flex; gap: 4px; margin-left: 8px; }
.stat-table-scroll { max-height: 480px; overflow-y: auto; margin-top: 8px; border: 1px solid var(--border, #333); border-radius: 8px; background: var(--bg-tertiary, #1e1e1e); }
.stat-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.stat-table th { background: #17171f; padding: 6px 10px; text-align: left; font-size: 11px; font-weight: 600; color: var(--text-muted, #888); border-bottom: 1px solid var(--border, #333); white-space: nowrap; }
.stat-table-scroll .stat-table th { position: sticky; top: 0; z-index: 2; }
.stat-table th.sortable { cursor: pointer; user-select: none; }
.stat-table th.sortable:hover { color: var(--accent, #a5b4fc); }
.champion-table tbody tr { cursor: pointer; }
.champion-table tbody tr:hover { background: rgba(99, 102, 241, 0.08); }
.stat-table td { padding: 5px 10px; border-bottom: 1px solid rgba(255,255,255,0.04); vertical-align: middle; }
.stat-table tr:last-child td { border-bottom: none; }
.stat-table .st-champ { min-width: 110px; }
.st-champ { display: flex; align-items: center; gap: 6px; }
.st-champ-name { font-weight: 600; color: var(--text, #eee); white-space: nowrap; }
.st-num { text-align: right; font-variant-numeric: tabular-nums; color: var(--text, #ddd); }
.st-player { color: var(--text-muted, #aaa); white-space: nowrap; }
.st-players { min-width: 240px; }
.st-pick { display: inline-block; margin: 2px 3px 0 0; padding: 1px 5px; border-radius: 3px; background: rgba(255,255,255,0.06); white-space: nowrap; }
.st-pick em { font-style: normal; font-weight: 700; margin-left: 2px; opacity: 0.75; background: rgba(0,0,0,0.25); border-radius: 2px; padding: 0 3px; }
.vendetta-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; margin-top: 10px; }
.vendetta-block { background: var(--bg-tertiary, #1e1e1e); border: 1px solid var(--border, #333); border-radius: 8px; padding: 10px 12px; }
.vendetta-block-title { font-size: 12px; font-weight: 700; color: #a5b4fc; margin-bottom: 8px; }
.vendetta-scroll { max-height: 320px; }

/* 海克斯级别与刷新 */
.aug-tier-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 10px; margin-bottom: 10px; }
.aug-tier-card { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 10px 6px; border-radius: 8px; background: var(--bg-secondary, #242730); }
.aug-tier-dot { width: 14px; height: 14px; border-radius: 50%; }
.aug-tier-name { font-size: 12px; color: var(--text-muted, #aaa); }
.aug-tier-card b { font-size: 18px; color: #f2f5f4; font-variant-numeric: tabular-nums; }
.aug-tier-num { font-size: 11px; color: var(--text-muted, #888); }
.aug-refresh-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 8px; margin-bottom: 6px; }
.aug-refresh-card { display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-radius: 8px; background: rgba(99, 102, 241, 0.08); border: 1px solid rgba(99, 102, 241, 0.25); flex-wrap: wrap; }
.aug-refresh-card.aug-gold { background: rgba(240, 180, 41, 0.1); border: 1px solid rgba(240, 180, 41, 0.4); }
.aug-refresh-label { font-size: 13px; font-weight: 700; color: #dbe7e4; }
.aug-refresh-rate { font-size: 20px; color: #c77dff; font-variant-numeric: tabular-nums; }
.aug-refresh-hint { font-size: 10px; color: var(--text-muted, #666); margin-bottom: 10px; }
.aug-combo-chip { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; margin-right: 3px; border-radius: 4px; font-size: 11px; font-weight: 800; }
.ac-彩 { background: rgba(199, 125, 255, 0.22); color: #c77dff; border: 1px solid rgba(199, 125, 255, 0.5); }
.ac-金 { background: rgba(240, 180, 41, 0.18); color: #f0b429; border: 1px solid rgba(240, 180, 41, 0.45); }
.ac-银 { background: rgba(169, 183, 198, 0.16); color: #c6d4de; border: 1px solid rgba(169, 183, 198, 0.4); }
.ac-未知 { background: rgba(255, 255, 255, 0.08); color: #888; border: 1px solid #444; }
.st-more { color: var(--text-muted, #666); font-size: 11px; margin-left: 3px; }
.st-name { min-width: 200px; }
.st-aug-name { margin-left: 4px; color: var(--text-muted, #ccc); }
.augment-dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; flex: 0 0 auto; vertical-align: middle; }
.augment-dot.augment-prismatic { background: #c77dff; box-shadow: 0 0 6px rgba(199, 125, 255, 0.6); }
.augment-dot.augment-gold { background: #f0b429; box-shadow: 0 0 5px rgba(240, 180, 41, 0.5); }
.augment-dot.augment-silver { background: #a9b7c6; }
.augment-dot.augment-bronze { background: #c68a4e; }
.stat-search { padding: 5px 8px; background: var(--bg-tertiary, #2a2a2a); border: 1px solid var(--border, #444); border-radius: 4px; color: var(--text, #eee); font-size: 12px; outline: none; width: 150px; }
.stat-search::placeholder { color: var(--text-muted, #888); }
.honor-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 8px; }
.honor-card { background: var(--bg-tertiary, #1e1e1e); border: 1px solid var(--border, #333); border-radius: 8px; padding: 8px 10px; }
.honor-name { font-size: 12px; font-weight: 700; color: #a5b4fc; margin-bottom: 6px; }
.honor-players { display: flex; flex-wrap: wrap; gap: 4px; }
.honor-player { display: inline-flex; align-items: center; gap: 2px; padding: 1px 6px; border-radius: 3px; background: rgba(255,255,255,0.06); font-size: 11px; color: var(--text, #ddd); }
.honor-player em { font-style: normal; font-weight: 700; color: #818cf8; }
.combo-tables { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; margin-top: 10px; }
.combo-block { background: var(--bg-tertiary, #1e1e1e); border: 1px solid var(--border, #333); border-radius: 8px; padding: 10px 12px; }
.combo-title { font-size: 12px; font-weight: 700; color: #a5b4fc; margin-bottom: 6px; }
.combo-row { display: flex; justify-content: space-between; gap: 8px; padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,0.04); font-size: 12px; }
.combo-row:last-child { border-bottom: none; }
.combo-members { color: var(--text-muted, #ccc); line-height: 1.5; }
.combo-stat { color: var(--text, #ddd); font-variant-numeric: tabular-nums; white-space: nowrap; }
.recent-dots { display: inline-flex; gap: 3px; align-items: center; }
.recent-dot { width: 8px; height: 8px; border-radius: 50%; }
.recent-dot.win { background: #4ade80; }
.recent-dot.loss { background: #f87171; }
</style>

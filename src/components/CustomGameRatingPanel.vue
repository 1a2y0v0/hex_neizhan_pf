<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue"
import { Calendar, Check, ChevronDown, ChevronRight, ChevronUp, ChevronsUpDown, Crown, LoaderCircle, RefreshCw, Swords, UserRound, X } from "lucide-vue-next"
import { loadTodayCustomGames } from "../api"
import { matchTeamSummary } from "../matchTeamSummary"
import { buildChampionProfiles, buildPlayerProfile, profileScoreLevel, type ChampionProfile, type PlayerProfile } from "../playerProfile"
import { calculateOutputRating, outputRatingTitle, scoreEvaluationLabel } from "../scoring"
import type { ChampionSummaryItem, GameAssetBundle, GameAssetEntry, MatchDetailPlayer, MatchDetailResponse, RecentGame, TodayCustomGamesResponse } from "../types"
import { championName, fixed, mitigationValue, teamMitigationValue } from "../utils"
import AssetIcon from "./AssetIcon.vue"
import ChampionAvatar from "./ChampionAvatar.vue"
import ChampionDetailDrawer from "./ChampionDetailDrawer.vue"
import PlayerRadarPanel from "./PlayerRadarPanel.vue"

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

/* ── detail view helpers ── */
function kNumber(value: number) { return `${(value / 1000).toFixed(1)}k` }
function shareSuffix(part: number, total: number) { return `(${total > 0 ? Math.round(part / total * 100) : 0}%)` }
function protectionValue(game: RecentGame) {
  return (game.totalHeal || 0) + (game.totalDamageShieldedOnTeammates || 0)
}
function teamProtectionValue(game: RecentGame) {
  return (game.teamTotalHeal || 0) + (game.teamTotalDamageShieldedOnTeammates || 0)
}
function detailTeamSummary(team: { players: MatchDetailPlayer[]; towerKills?: number }) {
  return matchTeamSummary(team as Parameters<typeof matchTeamSummary>[0])
}
function damageConversion(game: RecentGame) {
  const goldShare = game.teamGoldEarned > 0 ? game.goldEarned / game.teamGoldEarned : 0
  if (goldShare === 0) return "0.00"
  return fixed((game.damageToChampions / Math.max(game.teamDamageToChampions, 1)) / goldShare)
}
function detailStatLeader(game: RecentGame, kind: "damage" | "gold" | "mitigation" | "healing" | "conversion") {
  switch (kind) {
    case "damage": return game.gameDamageLeader || game.teamDamageLeader
    case "gold": return game.teamGoldLeader
    case "mitigation": return game.teamMitigationLeader
    case "healing": return game.teamHealingLeader
    case "conversion": return game.teamDamageConversionLeader
  }
}
function outputRating(game: RecentGame) {
  return calculateOutputRating(game, ratingContext.value)
}
function outputRatingHint(game: RecentGame) {
  return outputRatingTitle(game, ratingContext.value)
}
function detailScoreClass(player: MatchDetailPlayer) {
  return `score-${outputRating(player).level}`
}
function augmentName(augmentId: number) {
  return augmentMap.value[augmentId]?.name || perkMap.value[augmentId]?.name || `强化 ${augmentId}`
}
function shortAugmentName(augmentId: number) {
  return Array.from(augmentName(augmentId)).slice(0, 5).join("")
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
interface PlayerRating {
  puuid: string; gameName: string; tagLine: string; summonerName: string
  gamesPlayed: number; wins: number; profile: PlayerProfile
  recentChampionIds: number[]; championProfiles: ChampionProfile[]
  avgKills: number; avgDeaths: number; avgAssists: number
  overallKdaScore: number; highlightGames: number; disasterGames: number
  damageLeaderCount: number; mitigationLeaderCount: number; assistLeaderCount: number
  leaderGameIds: { damage: number[]; mitigation: number[]; assist: number[] }
  gameRecords: PlayerGameRecord[]
}

interface PlayerGameRecord {
  gameId: number; championId: number
  kills: number; deaths: number; assists: number; win: boolean
  gameDuration: number; damageShare: number; mitigationShare: number; score: number
}

interface GamePlayerEnriched {
  puuid: string; gameName: string; championId: number
  kills: number; deaths: number; assists: number
  gameScore: number; win: boolean
  damageDealtToChampions: number; totalDamageTaken: number; totalHeal: number
  teamDamageToChampions: number; teamTotalDamageTaken: number; teamDamageSelfMitigated: number
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
const filteredGames = computed(() => enrichedGames.value)
const expandedGames = ref<Set<number>>(new Set())
const hoveredGameId = ref<number | null>(null)

// collapsible sections
const ratingSectionVisible = ref(true)
const championSectionVisible = ref(false)
const augmentSectionVisible = ref(false)

// rating table
const sortColumn = ref<string>("overallScore")
const sortDirection = ref<"asc" | "desc">("desc")
const filterText = ref("")
const showSubColumns = ref(false)
const hoveredPlayer = ref<PlayerRating | null>(null)

/* ── enriched games ── */
const enrichedGames = computed<GameEnriched[]>(() => {
  return visibleGames.value.map((game) => {
    const teams = game.teams.map((team) => {
      const players = team.players.map((p) => ({
        puuid: p.puuid, gameName: p.gameName, championId: p.championId,
        kills: p.kills, deaths: p.deaths, assists: p.assists,
        gameScore: calculateOutputRating(p, ratingContext.value).score,
        win: p.win,
        damageDealtToChampions: p.damageToChampions || 0,
        totalDamageTaken: p.totalDamageTaken || 0,
        totalHeal: (p.totalHeal || 0) + (p.totalDamageShieldedOnTeammates || 0),
        teamDamageToChampions: p.teamDamageToChampions || 0,
        teamTotalDamageTaken: p.teamTotalDamageTaken || 0,
        teamDamageSelfMitigated: p.damageSelfMitigated || 0,
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

function toggleGameExpand(gameId: number) {
  const s = new Set(expandedGames.value)
  if (s.has(gameId)) s.delete(gameId); else s.add(gameId)
  expandedGames.value = s
}

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

/* ── chart data ── */
const chartScores = computed(() => {
  return [...playerRatings.value].sort((a, b) => b.profile.overallScore - a.profile.overallScore)
    .map((r) => ({ name: r.gameName, score: r.profile.overallScore }))
})

const chartTopChamps = computed(() => {
  const counts = new Map<string, number>()
  for (const r of playerRatings.value) {
    for (const cp of r.championProfiles) {
      const name = championName(props.champions, cp.championId)
      counts.set(name, (counts.get(name) || 0) + cp.games)
    }
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10)
})

const chartsVisible = ref(false)

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

const playerRatings = computed<PlayerRating[]>(() => {
  const raw = data.value
  if (!raw) return []
  const games = visibleGames.value
  if (!games.length) return []

  const leaderCounts = new Map<string, ReturnType<typeof leaderInit>>()
  for (const game of games) {
    const allPlayers = game.teams.flatMap((t) => t.players)
    let topDamage = -Infinity, topMitigation = -Infinity, topAssist = -Infinity
    let topDamagePuuid = "", topMitigationPuuid = "", topAssistPuuid = ""
    for (const p of allPlayers) {
      const damageShare = (p.damageToChampions || 0) / Math.max(p.teamDamageToChampions || 0, 1)
      const mitVal = (p.totalDamageTaken || 0) + (p.damageSelfMitigated || 0)
      const mitShare = mitVal / Math.max((p.teamTotalDamageTaken || 0) + (p.teamDamageSelfMitigated || 0), 1)
      if (damageShare > topDamage) { topDamage = damageShare; topDamagePuuid = p.puuid }
      if (mitShare > topMitigation) { topMitigation = mitShare; topMitigationPuuid = p.puuid }
      if ((p.assists || 0) > topAssist) { topAssist = p.assists || 0; topAssistPuuid = p.puuid }
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
    const profile = buildPlayerProfile(entry.records, ctx)
    const championProfiles = buildChampionProfiles(entry.records, ctx)
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
      return { gameId: r.gameId, championId: r.championId, kills: r.kills, deaths: r.deaths, assists: r.assists, win: r.win, gameDuration: r.gameDuration, damageShare: dmgShare, mitigationShare: mitShare, score: calculateOutputRating(r, ctx).score }
    })
    ratings.push({
      puuid: player.puuid, gameName: player.gameName, tagLine: player.tagLine,
      summonerName: player.summonerName, gamesPlayed: n, wins: entry.wins,
      profile, recentChampionIds: entry.records.map((r) => r.championId), championProfiles, gameRecords,
      avgKills: avgK, avgDeaths: avgD, avgAssists: avgA,
      overallKdaScore: kdaScore(avgK, avgD, avgA),
      highlightGames: gameRecords.filter((r) => r.score >= 80).length,
      disasterGames: gameRecords.filter((r) => r.score < 60).length,
      damageLeaderCount: lead.damage, mitigationLeaderCount: lead.mitigation, assistLeaderCount: lead.assist,
      leaderGameIds: { damage: lead.damageGames, mitigation: lead.mitigationGames, assist: lead.assistGames },
    })
  }
  return ratings.sort((a, b) => b.profile.overallScore - a.profile.overallScore)
})

/* ── load ── */
async function load() {
  loading.value = true; error.value = ""
  // 保留 localStorage 中已删除的对局，不清空
  data.value = null
  try {
    data.value = await loadTodayCustomGames(rangeStartMs.value, rangeEndMs.value)
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

/* ── 玩家组队搭档统计模块 ── */
interface TeammatePairRow {
  puuid: string
  gameName: string
  games: number
  wins: number
  winRate: number
}

const teamSectionVisible = ref(false)
const teamMode = ref<"teammate" | "opponent">("teammate")
const targetPuuid = ref("")
const teamMinGames = ref(0)
const teamMinGamesText = ref("")
function applyTeamMinGames() {
  const v = parseInt(teamMinGamesText.value, 10)
  teamMinGames.value = Number.isFinite(v) && v > 0 ? v : 0
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
        const e = map.get(p.puuid)
        if (e) { e.games++; if (myWin) e.wins++ }
        else map.set(p.puuid, { puuid: p.puuid, gameName: p.gameName, games: 1, wins: myWin ? 1 : 0, winRate: 0 })
      }
    }
  }
  const rows = [...map.values()]
  for (const r of rows) r.winRate = r.games ? (r.wins / r.games) * 100 : 0
  return rows
})

const teamQualifiedRows = computed(() => {
  const mp = teamMinGames.value
  return teamPairRows.value.filter((r) => mp <= 0 || r.games >= mp)
})

watch(targetStat, (target) => {
  if (!targetPuuid.value || !teamPlayers.value.some((p) => p.puuid === targetPuuid.value)) {
    targetPuuid.value = target?.puuid || ""
  }
})

const teamSortedRows = computed(() => [...teamQualifiedRows.value].sort((a, b) => b.winRate - a.winRate || b.games - a.games || a.gameName.localeCompare(b.gameName)))
const teamSampleInsufficient = computed(() => {
  const mp = teamMinGames.value
  if (mp <= 0) return 0
  return teamPairRows.value.filter((r) => r.games < mp).length
})

function switchTeamTarget(puuid: string) { targetPuuid.value = puuid }

const statHasData = computed(() => championStat.value.length > 0 || augmentStat.value.length > 0)

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

function winRateClass(v: number) { return v >= 60 ? "sc-high" : v >= 50 ? "sc-mid" : "sc-low" }
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
          <input type="date" v-model="startDate" @change="load" class="date-input" />
          <span class="date-sep">—</span>
          <input type="date" v-model="endDate" @change="load" class="date-input" />
        </div>
        <button class="toggle-sub" :class="{ active: customOnly }" @click="customOnly = !customOnly; load()" style="min-width:72px">
          <component :is="customOnly ? Check : X" :size="16" />
          <span style="font-size:13px">{{ customOnly ? '仅显示内战' : '全部对局' }}</span>
        </button>
        <button class="toggle-sub" :class="{ active: fiveV5Only }" @click="fiveV5Only = !fiveV5Only" style="min-width:72px">
          <component :is="fiveV5Only ? Check : X" :size="16" />
          <span style="font-size:13px">5V5</span>
        </button>
        <button class="toggle-sub" :class="{ active: minDuration8 }" @click="minDuration8 = !minDuration8" style="min-width:72px">
          <component :is="minDuration8 ? Check : X" :size="16" />
          <span style="font-size:13px">>8min</span>
        </button>
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
        <div class="game-section-header">
          <div class="gsh-left">
            <span class="section-title" @click="gameListVisible = !gameListVisible" style="cursor:pointer">
              <component :is="gameListVisible ? ChevronDown : ChevronRight" :size="14" />
              对局列表 ({{ filteredGames.length }})
            </span>
          </div>
        </div>

        <div v-show="gameListVisible" class="game-list">
          <div v-for="game in filteredGames" :key="game.gameId" class="game-card-outer">
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
              <section v-for="team in rawGame(game.gameId)!.teams" :key="team.teamId" class="detail-team-block">
                <div class="detail-team-header" :class="team.win ? 'win' : 'lose'">
                  <div class="detail-team-result">
                    <strong>{{ team.name || (team.teamId === 100 ? '蓝方' : '红方') }}</strong>
                    <span>{{ team.win ? '胜利' : '失败' }}</span>
                  </div>
                  <div class="detail-team-summary">
                    <span>队伍总经济 <b>{{ kNumber(detailTeamSummary(team).goldEarned) }}</b></span>
                    <span>队伍总伤害 <b>{{ kNumber(detailTeamSummary(team).damageToChampions) }}</b></span>
                    <span>队伍总推塔数 <b>{{ detailTeamSummary(team).towerKills }}</b></span>
                  </div>
                  <strong class="detail-team-kda">
                    {{ detailTeamSummary(team).kills }}/{{ detailTeamSummary(team).deaths }}/{{ detailTeamSummary(team).assists }}
                  </strong>
                  <span>伤害</span>
                  <span>经济</span>
                  <span>承伤</span>
                  <span>治疗/护盾</span>
                  <span>伤转</span>
                  <span>评分</span>
                </div>

                <div class="detail-list">
                  <article
                    v-for="p in team.players"
                    :key="`${team.teamId}:${p.puuid}`"
                    class="detail-row"
                    :class="{ win: p.win, lose: !p.win }"
                    :title="outputRatingHint(p)"
                  >
                    <div class="champion-cell">
                      <ChampionAvatar :champion-id="p.championId" :champions="props.champions" :size="40" />
                      <span>{{ p.gameName }}</span>
                    </div>

                    <div class="spell-column">
                      <AssetIcon
                        v-if="p.spell1Id"
                        :path="spellMap[p.spell1Id]?.iconPath"
                        :label="spellMap[p.spell1Id]?.name"
                        :fallback="String(p.spell1Id)"
                        :size="16"
                      />
                      <AssetIcon
                        v-if="p.spell2Id"
                        :path="spellMap[p.spell2Id]?.iconPath"
                        :label="spellMap[p.spell2Id]?.name"
                        :fallback="String(p.spell2Id)"
                        :size="16"
                      />
                    </div>

                    <div class="item-grid">
                      <AssetIcon
                        v-for="itemId in p.itemIds"
                        :key="itemId"
                        :path="itemMap[itemId]?.iconPath"
                        :label="itemMap[itemId]?.name"
                        :fallback="String(itemId)"
                        :size="30"
                      />
                    </div>

                    <div class="rune-grid text-grid" v-if="p.augmentIds.length">
                      <span v-for="augmentId in p.augmentIds.slice(0, 4)" :key="augmentId" :class="['augment-tag', augmentRarityClass(augmentId)]">
                        {{ shortAugmentName(augmentId) }}
                      </span>
                    </div>
                    <div class="rune-grid" v-else>
                      <AssetIcon
                        v-for="perkId in p.perkIds.slice(0, 4)"
                        :key="perkId"
                        :path="perkMap[perkId]?.iconPath"
                        :label="perkMap[perkId]?.name"
                        :fallback="String(perkId)"
                        :size="18"
                      />
                    </div>

                    <div class="kda-cell">
                      <strong>{{ p.kills }}/{{ p.deaths }}/{{ p.assists }}</strong>
                      <span v-if="p.carryKills > 0 || p.carryAssists > 0" class="carry-chip" :title="`切C：击杀敌方C位 ${p.carryKills} 次，参与 ${p.carryAssists} 次助攻（本队对C位总击杀 ${p.teamCarryKills}）`">
                        切C {{ p.carryKills }}/{{ p.carryAssists }}
                      </span>
                    </div>

                    <div class="stat-cell">
                      <strong :class="{ leader: detailStatLeader(p, 'damage') }">
                        {{ kNumber(p.damageToChampions) }}<em>{{ shareSuffix(p.damageToChampions, p.teamDamageToChampions) }}</em>
                      </strong>
                    </div>

                    <div class="stat-cell">
                      <strong :class="{ leader: detailStatLeader(p, 'gold') }">
                        {{ kNumber(p.goldEarned) }}<em>{{ shareSuffix(p.goldEarned, p.teamGoldEarned) }}</em>
                      </strong>
                    </div>

                    <div class="stat-cell">
                      <strong :class="{ leader: detailStatLeader(p, 'mitigation') }">
                        {{ kNumber(mitigationValue(p)) }}<em>{{ shareSuffix(mitigationValue(p), teamMitigationValue(p)) }}</em>
                      </strong>
                    </div>

                    <div class="stat-cell">
                      <strong :class="{ leader: detailStatLeader(p, 'healing') }">
                        {{ kNumber(protectionValue(p)) }}<em>{{ shareSuffix(protectionValue(p), teamProtectionValue(p)) }}</em>
                      </strong>
                    </div>

                    <div class="stat-cell">
                      <strong :class="{ leader: detailStatLeader(p, 'conversion') }">
                        {{ damageConversion(p) }}
                      </strong>
                    </div>

                    <div :class="['score-cell', detailScoreClass(p)]" :title="outputRatingHint(p)">
                      <strong>{{ outputRating(p).score }}分</strong>
                      <span>{{ outputRating(p).role.label }} · {{ outputRating(p).label }}</span>
                    </div>
                  </article>
                </div>
              </section>
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
        </div>
      </div>

      <!-- ═══════════════ EMPTY ═══════════════ -->
      <div v-if="enrichedGames.length === 0" class="empty-state"><Swords :size="32" /><span>该日期没有对局记录</span></div>

      <!-- ═══════════════ RATING TABLE ═══════════════ -->
      <div v-else class="rating-table-wrap">
        <div class="section-title" style="display:flex;align-items:center;margin-bottom:8px;cursor:pointer" @click="ratingSectionVisible = !ratingSectionVisible">
          <component :is="ratingSectionVisible ? ChevronDown : ChevronRight" :size="14" />
          玩家评分
          <button class="toggle-sub" :class="{ active: gameListVisible }" @click.stop="gameListVisible = !gameListVisible" style="margin-left:8px;font-size:11px">
            <ChevronsUpDown :size="12" /> {{ gameListVisible ? '隐藏对局' : '显示对局' }}
          </button>
        </div>

        <div v-show="ratingSectionVisible">
        <div class="filter-bar">
          <input v-model="filterText" placeholder="搜索玩家..." class="filter-input" />
          <button class="toggle-sub" :class="{ active: showExtremes }" @click="showExtremes = !showExtremes" style="min-width:52px">
            <component :is="showExtremes ? ChevronDown : ChevronUp" :size="14" />
            极值
          </button>
          <button class="toggle-sub" @click="showSubColumns = !showSubColumns">
            <component :is="showSubColumns ? ChevronUp : ChevronDown" :size="14" />
            {{ showSubColumns ? '收起' : '展开' }}详细
          </button>
          <div class="toggle-sub min-games-input" :class="{ active: minGameCount > 0 }" title="仅统计场数≥该值的玩家，留空为不限">
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
          <span class="filter-count">{{ filteredAndSortedRatings.length }} / {{ playerRatings.length }}</span>
        </div>

        <div class="table-scroll" ref="tableScrollRef">
          <table class="rating-table">
            <thead>
              <tr>
                <th class="col-rank">#</th>
                <th class="col-player sortable" @click="sortBy('gameName')">玩家{{ sortIcon('gameName') }}</th>
                <th class="col-champs">英雄</th>
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
                <th class="col-tags">标签</th>
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
                  {{ minGameCount > 0 ? `场数≥${minGameCount} 过滤后暂无玩家，请调低场数限制` : '该日期没有对局记录' }}
                </td>
              </tr>
              <tr
                v-for="(rating, index) in filteredAndSortedRatings"
                :key="rating.puuid"
                :class="['tr-body', hoveredPlayer?.puuid === rating.puuid ? 'row-hovered' : '', index % 2 === 1 ? 'row-zebra' : '']"
                @mouseenter="hoveredPlayer = rating"
                @mouseleave="hoveredPlayer = null"
              >
                <td class="col-rank">{{ index + 1 }}</td>
                <td class="col-player"><UserRound :size="14" /> {{ rating.gameName }}#{{ rating.tagLine }}</td>
                <td class="col-champs">
                  <div class="champ-icons">
                    <div v-for="cp in rating.championProfiles.slice(0, 3)" :key="cp.championId" class="champ-with-score">
                      <ChampionAvatar :champion-id="cp.championId" :champions="props.champions" :size="28" />
                      <span class="champ-score" :class="scoreClass(cp.averageScore)">{{ cp.averageScore.toFixed(0) }}</span>
                    </div>
                  </div>
                </td>
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
                <td class="col-tags"><div class="tag-list"><span v-for="tag in rating.profile.tags.slice(0, 3)" :key="tag" class="mini-tag">{{ tag }}</span></div></td>
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

        <!-- row hover card -->
        <div v-if="hoveredPlayer" class="row-hover-card" @mouseenter="hoveredPlayer = hoveredPlayer" @mouseleave="hoveredPlayer = null">
          <div class="rhc-header">{{ hoveredPlayer.gameName }}#{{ hoveredPlayer.tagLine }}</div>
          <div class="rhc-body">
            <div class="rhc-row"><span class="rhc-l">综合评分</span><span class="rhc-v" :class="scoreClass(hoveredPlayer.profile.overallScore)">{{ hoveredPlayer.profile.overallScore.toFixed(1) }}</span><span class="rhc-l">中位数</span><span class="rhc-v">{{ hoveredPlayer.profile.medianScore.toFixed(1) }}</span></div>
            <div class="rhc-row"><span class="rhc-l">波动率</span><span class="rhc-v">{{ hoveredPlayer.profile.volatility.toFixed(1) }}</span><span class="rhc-l">高光率</span><span class="rhc-v sc-high">{{ (hoveredPlayer.profile.highlightRate * 100).toFixed(0) }}%</span><span class="rhc-l">战犯率</span><span class="rhc-v sc-low">{{ (hoveredPlayer.profile.disasterRate * 100).toFixed(0) }}%</span></div>
            <div class="rhc-divider"></div>
            <div class="rhc-row"><span class="rhc-l">KDA</span><span class="rhc-v">{{ hoveredPlayer.avgKills.toFixed(1) }} / {{ hoveredPlayer.avgDeaths.toFixed(1) }} / {{ hoveredPlayer.avgAssists.toFixed(1) }}</span><span class="rhc-l">KDA</span><span class="rhc-v" :class="kdaClass(hoveredPlayer.overallKdaScore)">{{ hoveredPlayer.overallKdaScore }}</span></div>
            <div class="rhc-row"><span class="rhc-l">场均击杀</span><span class="rhc-v">{{ hoveredPlayer.avgKills.toFixed(1) }}</span><span class="rhc-l">场均死亡</span><span class="rhc-v">{{ hoveredPlayer.avgDeaths.toFixed(1) }}</span></div>
            <div class="rhc-divider"></div>
            <div class="rhc-row"><span class="rhc-l">标签</span><span class="rhc-tags"><span v-for="tag in hoveredPlayer.profile.tags" :key="tag" class="mini-tag">{{ tag }}</span></span></div>
            <div class="rhc-divider"></div>
            <div class="rhc-section-l">英雄详情</div>
            <div v-for="cp in hoveredPlayer.championProfiles" :key="cp.championId" class="rhc-champ">
              <ChampionAvatar :champion-id="cp.championId" :champions="props.champions" :size="24" />
              <div class="rhc-cinfo"><span class="rhc-cn">{{ championName(champions, cp.championId) }}</span><span class="rhc-cs">{{ cp.games }}场 · 均分 <span :class="scoreClass(cp.averageScore)">{{ cp.averageScore.toFixed(0) }}</span> · 伤{{ (cp.averageDamageShare * 100).toFixed(0) }}%</span></div>
            </div>
          </div>
        </div>
        </div>
      </div>

      <!-- ═══════════════ CHARTS ═══════════════ -->
      <div v-if="playerRatings.length > 0" class="charts-section">
        <div class="charts-header" @click="chartsVisible = !chartsVisible">
          <component :is="chartsVisible ? ChevronDown : ChevronRight" :size="14" />
          <span>数据可视化</span>
        </div>
        <div v-show="chartsVisible" class="charts-body">
          <!-- score bar chart -->
          <div class="chart-block">
            <div class="chart-title">玩家综合分</div>
            <div class="bar-chart-h">
              <div v-for="item in chartScores" :key="item.name" class="bar-row">
                <span class="bar-label">{{ item.name.length > 8 ? item.name.slice(0, 8) + '..' : item.name }}</span>
                <div class="bar-track">
                  <div class="bar-fill" :style="{ width: Math.max(item.score / (chartScores[0]?.score || 100) * 100, 3) + '%', background: item.score >= 80 ? '#4ade80' : item.score >= 60 ? '#facc15' : '#f87171' }"></div>
                </div>
                <span class="bar-value" :class="scoreClass(item.score)">{{ item.score.toFixed(1) }}</span>
              </div>
            </div>
          </div>

          <!-- champion TOP -->
          <div class="chart-block">
            <div class="chart-title">英雄出场 TOP</div>
            <div class="bar-chart-h">
              <div v-for="[name, count] in chartTopChamps" :key="name" class="bar-row">
                <span class="bar-label">{{ name.length > 8 ? name.slice(0, 8) + '..' : name }}</span>
                <div class="bar-track">
                  <div class="bar-fill" :style="{ width: (count / (chartTopChamps[0]?.[1] || 1) * 100) + '%', background: '#818cf8' }"></div>
                </div>
                <span class="bar-value" style="color:#a5b4fc">{{ count }}</span>
              </div>
            </div>
          </div>


        </div>
      </div>

      <!-- ═══════════════ PLAYER RADAR ═══════════════ -->
      <PlayerRadarPanel v-if="playerRatings.length > 0" :players="playerRatings" />

      <!-- ═══════════════ 玩家组队搭档统计 ═══════════════ -->
      <div v-if="teamPlayers.length" class="stat-module">
        <div class="stat-section">
          <div class="stat-title-line" @click="teamSectionVisible = !teamSectionVisible">
            <component :is="teamSectionVisible ? ChevronDown : ChevronRight" :size="14" />
            <span class="section-title">玩家组队搭档统计</span>
            <span class="stat-subtitle">{{ targetStat?.gameName || '' }} · {{ teamMode === 'teammate' ? '搭档胜率' : '对位胜率' }}</span>
          </div>
          <div v-show="teamSectionVisible" class="stat-section-body">
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
              <span v-if="teamSampleInsufficient > 0" class="stat-subtitle" style="color:#f87171">样本场次不足{{ teamSampleInsufficient }}人，不计入排名</span>
            </div>
            <div v-if="targetStat" class="stat-header" style="margin-top:8px">
              <span class="stat-subtitle">
                <b style="color:#a5b4fc">{{ targetStat.gameName }}</b> 全局 {{ targetStat.wins }} 胜 / {{ targetStat.games }} 场 · 总胜率
                <b :class="winRateClass(targetStat.winRate)">{{ targetStat.winRate.toFixed(0) }}%</b>
              </span>
            </div>
            <div class="stat-table-scroll" style="max-height: 320px">
              <table class="stat-table champion-table">
                <thead>
                  <tr>
                    <th class="st-champ">{{ teamMode === 'teammate' ? '搭档' : '对手' }}</th>
                    <th class="st-num" style="text-align:center">{{ teamMode === 'teammate' ? '共同场次' : '交手场次' }}</th>
                    <th class="st-num" style="text-align:center">胜场</th>
                    <th class="st-num" style="text-align:center">胜率</th>
                    <th class="st-player">排名</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-if="teamQualifiedRows.length === 0">
                    <td colspan="5" class="empty-table-row">没有满足条件的{{ teamMode === 'teammate' ? '搭档' : '对手' }}记录{{ teamSampleInsufficient > 0 ? '（样本场次不足，不计入排名）' : '' }}</td>
                  </tr>
                  <template v-if="teamQualifiedRows.length">
                    <tr v-for="(r, i) in teamSortedRows" :key="r.puuid" @click="switchTeamTarget(r.puuid)">
                      <td class="st-champ"><span class="st-champ-name">{{ r.gameName }}</span></td>
                      <td class="st-num" style="text-align:center">{{ r.games }}</td>
                      <td class="st-num" style="text-align:center">{{ r.wins }}</td>
                      <td class="st-num" style="text-align:center"><span :class="winRateClass(r.winRate)">{{ r.winRate.toFixed(0) }}%</span></td>
                      <td class="st-player">
                        <span class="st-pick" :class="{ 'sc-high': i === 0 }">全榜第 {{ i + 1 }}</span>
                      </td>
                    </tr>
                  </template>
                </tbody>
              </table>
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
          <div class="stat-title-line" @click="championSectionVisible = !championSectionVisible">
            <component :is="championSectionVisible ? ChevronDown : ChevronRight" :size="14" />
            <span class="section-title">英雄榜</span>
            <span class="stat-subtitle">{{ championStat.length }} 位英雄 · {{ championStat.reduce((s, e) => s + e.picks, 0) }} 次出场</span>
          </div>
          <div v-show="championSectionVisible" class="stat-section-body">
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
          <div class="stat-title-line" @click="augmentSectionVisible = !augmentSectionVisible">
            <component :is="augmentSectionVisible ? ChevronDown : ChevronRight" :size="14" />
            <span class="section-title">海克斯榜</span>
            <span class="stat-subtitle">{{ augmentStat.length }} 个海克斯强化</span>
          </div>
          <div v-show="augmentSectionVisible" class="stat-section-body">
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
      </div>

      <ChampionDetailDrawer
        v-if="drawerChampionId != null && drawerChampionMeta"
        :champion-id="drawerChampionId"
        :champion-name="drawerChampionMeta.name"
        :games="drawerGames"
        :champions="props.champions"
        :item-map="itemMap"
        :spell-map="spellMap"
        :champion-total-picks="drawerChampionMeta.picks"
        :champion-total-win-rate="drawerChampionMeta.winRate"
        @close="closeChampionDrawer"
      />
    </template>
  </div>
</template>

<style scoped>
.crp { display: flex; flex-direction: column; gap: 16px; }

/* ── header ── */
.panel-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 8px; }
.panel-header h2 { margin: 0; }
.eyebrow { font-size: 11px; color: var(--text-muted, #888); text-transform: uppercase; letter-spacing: 0.5px; }
.header-actions { display: flex; align-items: center; gap: 8px; }
.date-picker-wrap { display: flex; align-items: center; gap: 4px; background: var(--bg-tertiary, #2a2a2a); border: 1px solid var(--border, #444); border-radius: 6px; padding: 6px 10px; color: var(--text-muted, #888); }
.date-input { background: transparent; border: none; color: inherit; font-size: 13px; outline: none; font-family: inherit; width: 110px; }
.date-input::-webkit-calendar-picker-indicator { filter: invert(0.7); cursor: pointer; }
.date-sep { color: var(--text-muted, #555); font-size: 13px; user-select: none; }

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
.pbl { width: 44px; text-align: right; color: var(--text-muted, #aaa); flex-shrink: 0; }
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
.game-section-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.gsh-left { display: flex; align-items: center; gap: 8px; }
.gsh-right { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

.game-list { display: flex; flex-direction: column; gap: 6px; }

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

/* expanded mini table */
.game-expanded-table { background: var(--bg-secondary, #1a1a2e); border: 1px solid var(--border, #333); border-top: none; border-radius: 0 0 8px 8px; padding: 8px 12px; overflow-x: auto; display: flex; flex-direction: column; gap: 10px; }

.detail-team-block { overflow-x: auto; border: 1px solid var(--border, #444); border-radius: 8px; background: #16161d; padding: 8px; }
.detail-team-header,
.detail-row { display: grid; grid-template-columns: 160px 22px 252px 160px 59px repeat(5, 62px) 128px; min-width: 1131px; align-items: center; gap: 4px; }
.detail-team-header { border-radius: 6px; margin-bottom: 6px; padding: 6px 7px; }
.detail-team-header.win { color: #7db8f0; background: rgba(31, 95, 159, 0.22); }
.detail-team-header.lose { color: #f0a0a0; background: rgba(162, 61, 61, 0.22); }
.detail-team-result { display: flex; min-width: 0; align-items: center; gap: 6px; }
.detail-team-result strong { font-size: 15.6px; line-height: 1; }
.detail-team-result span, .detail-team-header > span { font-size: 12px; font-weight: 900; line-height: 1; white-space: nowrap; }
.detail-team-summary { display: grid; min-width: 0; grid-column: span 3; grid-template-columns: repeat(3, minmax(0, 1fr)); align-items: center; gap: 4px; }
.detail-team-summary span { overflow: hidden; font-size: 11px; font-weight: 800; line-height: 1; text-align: center; text-overflow: ellipsis; white-space: nowrap; }
.detail-team-summary b, .detail-team-kda { font-size: 12px; font-weight: 950; white-space: nowrap; }
.detail-team-kda { text-align: center; }
.detail-team-header > span { text-align: center; }
.detail-list { display: flex; flex-direction: column; gap: 4px; }
.detail-row { height: 48px; min-height: 48px; max-height: 48px; overflow: hidden; border: 1px solid var(--border, #444); border-left-width: 5px; border-radius: 8px; padding: 2px 7px; }
.detail-row:hover { filter: brightness(1.12); }
.detail-row.win { border-color: rgba(47, 120, 214, 0.35); border-left-color: #2f78d6; background: rgba(47, 120, 214, 0.13); }
.detail-row.lose { border-color: rgba(202, 75, 75, 0.35); border-left-color: #ca4b4b; background: rgba(202, 75, 75, 0.13); }
.champion-cell { display: flex; min-width: 0; align-items: center; gap: 6px; }
.champion-cell span { min-width: 0; overflow: hidden; color: #d8d8e0; font-size: 13.5px; text-overflow: ellipsis; white-space: nowrap; }
.spell-column { display: flex; height: 42px; flex-direction: column; justify-content: center; gap: 2px; }
.item-grid { display: flex; min-width: 0; flex-wrap: nowrap; gap: 3px; }
.rune-grid { display: grid; grid-template-columns: repeat(2, max-content); grid-auto-rows: 20px; align-content: center; justify-content: center; gap: 2px 4px; overflow: hidden; }
.text-grid .augment-tag { display: inline-flex; box-sizing: border-box; width: calc(5em + 8px); height: 19px; align-items: center; justify-content: center; overflow: hidden; border: 1px solid rgba(255, 255, 255, 0.14); border-radius: 5px; color: #d8d8e0; font-size: 13.5px; font-weight: 700; line-height: 1; padding: 0 3px; text-align: center; white-space: nowrap; }
.text-grid .augment-prismatic { border-color: rgba(170, 72, 215, 0.42); color: #e2b8ff; background: linear-gradient(135deg, rgba(109, 44, 145, 0.5), rgba(141, 70, 170, 0.5)); }
.text-grid .augment-gold { border-color: rgba(199, 144, 36, 0.48); color: #ffd36a; background: rgba(123, 77, 2, 0.45); }
.text-grid .augment-silver { border-color: rgba(134, 151, 166, 0.48); color: #c6d4de; background: rgba(73, 96, 111, 0.45); }
.text-grid .augment-bronze { border-color: rgba(167, 105, 60, 0.46); color: #e8b48a; background: rgba(122, 67, 35, 0.45); }
.kda-cell, .stat-cell, .score-cell { display: flex; min-width: 0; align-items: center; justify-content: center; }
.kda-cell strong { color: #e8e8f0; font-size: 13px; line-height: 1; white-space: nowrap; }
.kda-cell .carry-chip { margin-top: 2px; padding: 1px 5px; border: 1px solid rgba(251, 146, 60, 0.45); border-radius: 6px; background: rgba(251, 146, 60, 0.12); color: #fdba74; font-size: 10px; font-weight: 800; line-height: 1.2; white-space: nowrap; }
.stat-cell strong { display: inline-flex; flex-direction: column; align-items: center; gap: 1px; color: #e8e8f0; font-size: 16.5px; line-height: 1; white-space: nowrap; }
.stat-cell strong.leader, .stat-cell strong.leader em { color: #ff6b6b; font-weight: 900; }
.stat-cell em { color: #8a989c; font-size: 13.5px; font-style: normal; font-weight: 700; }
.score-cell { height: 42px; flex-direction: column; gap: 2px; border-radius: 7px; background: rgba(255, 255, 255, 0.06); padding: 3px; text-align: center; }
.score-cell strong { position: relative; z-index: 1; color: inherit; font-size: 18px; font-weight: 950; line-height: 1; white-space: nowrap; }
.score-cell span { position: relative; z-index: 1; max-width: 100%; color: inherit; font-size: 10.5px; font-weight: 900; line-height: 1; white-space: nowrap; }
.score-excellent { position: relative; overflow: hidden; color: #5d3300; border: 1px solid rgba(245, 185, 52, 0.72); background: linear-gradient(135deg, rgba(255, 244, 184, 0.96), rgba(255, 195, 64, 0.9) 45%, rgba(255, 236, 150, 0.96)), #ffd36a; box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.36), 0 0 16px rgba(255, 191, 58, 0.34); }
.score-good { color: #145b3e; background: rgba(204, 239, 218, 0.88); }
.score-average { color: #174d83; background: rgba(205, 229, 255, 0.92); }
.score-poor { color: #8f3434; background: rgba(248, 214, 213, 0.92); }

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
.empty-table-row { text-align: center; color: var(--text-muted, #888); font-size: 12px; padding: 24px 0 !important; }

/* ── rating table ── */
.rating-table-wrap { overflow-x: auto; position: relative; }
.table-scroll { overflow-x: auto; }
.rating-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.rating-table th, .rating-table td { padding: 7px 8px; text-align: center; border-bottom: 1px solid var(--border, #333); vertical-align: middle; }
.rating-table th { font-weight: 600; color: var(--text-muted, #888); white-space: nowrap; font-size: 11px; text-transform: uppercase; letter-spacing: 0.3px; user-select: none; }
.rating-table th.sortable { cursor: pointer; }
.rating-table th.sortable:hover { color: var(--accent, #6366f1); }

/* zebra */
.row-zebra { background: rgba(255,255,255,0.02); }
.rating-table tbody tr:hover { background: rgba(99, 102, 241, 0.06); }
.row-hovered { background: rgba(99, 102, 241, 0.1) !important; }

.col-player { text-align: left; min-width: 100px; white-space: nowrap; }
.col-player :deep(svg) { vertical-align: middle; margin-right: 4px; }
.col-rank { width: 28px; }
.col-champs { min-width: 90px; }

.col-num { width: 36px; font-variant-numeric: tabular-nums; }
.col-num-sortable { width: 40px; font-variant-numeric: tabular-nums; }
.col-score { width: 46px; font-weight: 700; font-variant-numeric: tabular-nums; }
.col-label { width: 60px; }
.col-kda { font-size: 11px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.col-ability { width: 38px; font-size: 12px; }
.col-detail { width: 48px; font-size: 11px; font-variant-numeric: tabular-nums; }
.col-tags { max-width: 110px; }

/* win rate column */
.wr-cell { font-weight: 700; }
.wr-high { color: #4ade80; background: rgba(74, 222, 128, 0.08); border-radius: 3px; }
.wr-low { color: #f87171; background: rgba(248, 113, 113, 0.08); border-radius: 3px; }

/* score column coloring */
.col-score.sc-high { color: #4ade80; }
.col-score.sc-mid { color: #60a5fa; background: rgba(96, 165, 250, 0.18); }
.col-score.sc-low { color: #f87171; }

.champ-icons { display: flex; gap: 4px; justify-content: center; }
.champ-with-score { display: flex; flex-direction: column; align-items: center; gap: 2px; }
.champ-score { font-size: 10px; font-weight: 700; line-height: 1; padding: 1px 3px; border-radius: 3px; font-variant-numeric: tabular-nums; }
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
.tag-list { display: flex; flex-wrap: wrap; gap: 2px; justify-content: center; }
.mini-tag { display: inline-block; padding: 1px 5px; border-radius: 3px; font-size: 10px; font-weight: 600; background: rgba(255,255,255,0.06); color: var(--text-muted, #aaa); white-space: nowrap; }
.dim { color: var(--text-muted, #555); }
.score-badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; white-space: nowrap; }
.score-high { background: #1a6b3c; color: #4ade80; }
.score-mid { background: #6b5b1a; color: #facc15; }
.score-low { background: #6b1a1a; color: #f87171; }

/* ── row hover card ── */
.row-hover-card { position: fixed; right: 20px; top: 50%; transform: translateY(-50%); width: 340px; background: #1a1a2e; border: 1px solid #444; border-radius: 10px; padding: 14px; z-index: 200; box-shadow: 0 8px 32px rgba(0,0,0,0.6); max-height: 80vh; overflow-y: auto; }
.rhc-header { font-size: 15px; font-weight: 700; color: var(--text, #eee); margin-bottom: 8px; padding-bottom: 8px; border-bottom: 1px solid var(--border, #333); }
.rhc-body { display: flex; flex-direction: column; gap: 5px; }
.rhc-row { display: flex; align-items: center; gap: 8px; font-size: 12px; flex-wrap: wrap; }
.rhc-l { color: var(--text-muted, #888); flex-shrink: 0; }
.rhc-v { font-weight: 600; font-variant-numeric: tabular-nums; }
.rhc-tags { display: flex; flex-wrap: wrap; gap: 3px; }
.rhc-divider { height: 1px; background: var(--border, #333); margin: 4px 0; }
.rhc-section-l { font-size: 11px; font-weight: 600; color: var(--text-muted, #888); text-transform: uppercase; letter-spacing: 0.3px; margin-top: 2px; }
.rhc-champ { display: flex; align-items: center; gap: 8px; padding: 3px 6px; background: rgba(255,255,255,0.04); border-radius: 5px; }
.rhc-cinfo { display: flex; flex-direction: column; gap: 1px; }
.rhc-cn { font-size: 12px; font-weight: 600; color: var(--text, #eee); }
.rhc-cs { font-size: 11px; color: var(--text-muted, #888); }

/* ── charts ── */
.charts-section { border-top: 1px solid var(--border, #333); padding-top: 8px; }
.charts-header { display: flex; align-items: center; gap: 6px; cursor: pointer; padding: 6px 0; }
.charts-header:hover { color: var(--accent, #6366f1); }
.charts-body { display: flex; gap: 20px; flex-wrap: wrap; padding: 12px 0; }
.chart-block { flex: 1; min-width: 240px; max-width: 400px; }
.chart-title { font-size: 12px; font-weight: 600; color: var(--text-muted, #aaa); margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.3px; }
.bar-chart-h { display: flex; flex-direction: column; gap: 5px; }
.bar-row { display: flex; align-items: center; gap: 8px; }
.bar-label { width: 64px; text-align: right; font-size: 11px; color: var(--text-muted, #aaa); flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bar-track { flex: 1; height: 14px; background: var(--bg-secondary, #2a2a2a); border-radius: 4px; overflow: hidden; }
.bar-fill { height: 100%; border-radius: 4px; transition: width 0.4s; min-width: 2px; }
.bar-value { width: 36px; text-align: left; font-size: 11px; font-weight: 700; font-variant-numeric: tabular-nums; }

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
.stat-table th { position: sticky; top: 0; z-index: 2; background: #17171f; padding: 6px 10px; text-align: left; font-size: 11px; font-weight: 600; color: var(--text-muted, #888); border-bottom: 1px solid var(--border, #333); white-space: nowrap; }
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
</style>

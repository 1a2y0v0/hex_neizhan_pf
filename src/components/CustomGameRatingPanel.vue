<script setup lang="ts">
import { computed, onMounted, ref } from "vue"
import { Calendar, Check, ChevronDown, ChevronUp, ChevronsUpDown, Crown, LoaderCircle, RefreshCw, Swords, UserRound, X } from "lucide-vue-next"
import { loadTodayCustomGames } from "../api"
import { buildChampionProfiles, buildPlayerProfile, profileScoreLevel, type ChampionProfile, type PlayerProfile } from "../playerProfile"
import { scoreEvaluationLabel } from "../scoring"
import type { ChampionSummaryItem, GameAssetEntry, MatchDetailPlayer, TodayCustomGamesResponse } from "../types"
import { championName } from "../utils"
import PlayerRadarPanel from "./PlayerRadarPanel.vue"

const props = defineProps<{ champions: Record<number, ChampionSummaryItem>; items?: GameAssetEntry[] }>()

const itemMap = computed(() => {
  if (!props.items) return {}
  const map: Record<number, GameAssetEntry> = {}
  for (const item of props.items) map[item.id] = item
  return map
})

/* ── helpers ── */
const loading = ref(false)
const error = ref("")
const data = ref<TodayCustomGamesResponse | null>(null)

function toLocalDateStr(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}
function todayDateStr() { return toLocalDateStr(Date.now()) }
function dateToDayStart(dateStr: string) { return new Date(dateStr + "T00:00:00Z").getTime() }
function dateToDayEnd(dateStr: string) { return new Date(dateStr + "T23:59:59Z").getTime() }

const startDate = ref(todayDateStr())
const endDate = ref(todayDateStr())
const rangeStartMs = computed(() => dateToDayStart(startDate.value))
const rangeEndMs = computed(() => dateToDayEnd(endDate.value))

const queueNames: Record<number, string> = {
  0: "自定义", 400: "匹配", 420: "单双排", 430: "匹配", 440: "灵活排", 450: "大乱斗",
  700: "Clash", 800: "AI", 820: "AI", 830: "AI", 840: "AI", 850: "AI", 900: "乌迪尔",
  920: "魄罗", 1020: "无限火力", 1300: "涅槃", 1400: "终极魔典", 1700: "斗魂竞技场", 1900: "斗魂",
}
function queueLabel(qid: number) { return queueNames[qid] ?? `队列${qid}` }

function abilityClass(s: number) { return s >= 80 ? "ab-high" : s >= 60 ? "ab-mid" : "ab-low" }
function scoreClass(s: number) { return s >= 80 ? "sc-high" : s >= 60 ? "sc-mid" : "sc-low" }
function kdaScore(k: number, d: number, a: number) { return Math.round((k + a) / Math.max(d, 0.5) * 10) / 10 }
function winRate(r: { wins: number; gamesPlayed: number }) { return r.wins / r.gamesPlayed * 100 }

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
  gameDuration: number; damageShare: number; mitigationShare: number
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
const deletedGameIds = ref<Set<number>>(new Set())

function deleteGame(gameId: number) {
  const s = new Set(deletedGameIds.value)
  s.add(gameId)
  deletedGameIds.value = s
}

const customOnly = ref(true)
const fiveV5Only = ref(true)
const minDuration8 = ref(true)

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

// game list
const gameTypeFilter = ref<"all" | "quick" | "long">("all")
const gameListVisible = ref(true)
const expandedGames = ref<Set<number>>(new Set())
const hoveredGameId = ref<number | null>(null)

// rating table
const sortColumn = ref<string>("overallScore")
const sortDirection = ref<"asc" | "desc">("desc")
const filterText = ref("")
const filterTags = ref<string[]>([])
const tagDropdownOpen = ref(false)
const showSubColumns = ref(false)
const hoveredPlayer = ref<PlayerRating | null>(null)

/* ── enriched games ── */
const enrichedGames = computed<GameEnriched[]>(() => {
  return visibleGames.value.map((game) => {
    const teams = game.teams.map((team) => {
      const players = team.players.map((p) => ({
        puuid: p.puuid, gameName: p.gameName, championId: p.championId,
        kills: p.kills, deaths: p.deaths, assists: p.assists,
        gameScore: kdaScore(p.kills, p.deaths, p.assists),
        win: p.win,
        damageDealtToChampions: p.damageToChampions || 0,
        totalDamageTaken: p.totalDamageTaken || 0,
        totalHeal: p.totalHeal || 0,
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
    if (teams.length === 2 && Math.abs(teams[0].avgScore - teams[1].avgScore) > 15) tags.push("碾压局")
    return {
      gameId: game.gameId, queueId: game.queueId, gameDuration: game.gameDuration,
      gameMode: game.gameMode, teams, mvp, mvpName: mvp?.gameName || "",
      tags, gameCreation: game.gameCreation,
    }
  })
})

const filteredGames = computed(() => {
  let gs = enrichedGames.value
  if (gameTypeFilter.value === "quick") gs = gs.filter((g) => g.gameDuration < 900)
  else if (gameTypeFilter.value === "long") gs = gs.filter((g) => g.gameDuration > 1440)
  return gs
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
  const avgWinRate = ratings.reduce((s, r) => s + winRate(r), 0) / totalPlayers
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
const reviewsVisible = ref(false)

/* ── table sort / filter ── */
const availableTags = computed(() => {
  const s = new Set<string>()
  for (const r of playerRatings.value) for (const tag of r.profile.tags) s.add(tag)
  return Array.from(s).sort()
})

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
  if (filterTags.value.length) list = list.filter((r) => filterTags.value.some((t) => r.profile.tags.includes(t)))

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

interface PlayerReview {
  puuid: string; gameName: string; tagLine: string; score: number; lines: string[]
}

/* Simple pseudo-random based on string + index for style variety */
function pick<T>(arr: T[], seed: string, idx: number): T {
  return arr[(Math.abs(hashStr(seed) + idx * 31) % arr.length)]
}
function hashStr(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0 }
  return h
}

/* champion name helper */
function cname(id: number): string {
  return championName(props.champions, id) || `英雄${id}`
}

const playerReviews = computed<PlayerReview[]>(() => {
  return [...playerRatings.value].sort((a, b) => b.profile.overallScore - a.profile.overallScore).map((r) => {
    const lines: string[] = []
    const s = r.profile
    const ds = avgChampProp(r.championProfiles, (cp) => cp.averageDamageShare)
    const ms = avgChampProp(r.championProfiles, (cp) => cp.averageMitigationShare)
    const k = r.avgKills; const d = r.avgDeaths; const a = r.avgAssists
    const seed = r.puuid

    const isExcellent = s.overallScore >= 80
    const isGood = s.overallScore >= 65
    const isMid = s.overallScore >= 40 && s.overallScore < 65

    /* ═══════════════ 1. 单局英雄逐局锐评 ═══════════════ */
    lines.push(`【单局英雄逐局锐评】`)
    for (let gi = 0; gi < r.gameRecords.length; gi++) {
      const g = r.gameRecords[gi]
      const champ = cname(g.championId)
      const dmgs = (g.damageShare * 100).toFixed(0)
      const mits = (g.mitigationShare * 100).toFixed(0)
      const kda = `${g.kills}/${g.deaths}/${g.assists}`
      const winStr = g.win ? "胜" : "败"
      const durMin = (g.gameDuration / 60).toFixed(0)
      const sSeed = seed + "_g" + gi
      const isDmgLeader = r.leaderGameIds.damage.includes(g.gameId)
      const isMitLeader = r.leaderGameIds.mitigation.includes(g.gameId)
      const isAstLeader = r.leaderGameIds.assist.includes(g.gameId)
      const perf = g.kills + g.assists - g.deaths * 2

      /* pick style per game for variety */
      const styleIdx = hashStr(sSeed) % 7

      if (perf >= 8 && isDmgLeader) {
        if (styleIdx === 0) lines.push(`${champ}（${kda}·${winStr}·${durMin}min）—— 伤害占比${dmgs}%带队掀桌，建议对面直接投。`)
        else if (styleIdx === 1) lines.push(`${champ}这局${kda}/${dmgs}%伤害占比，打出了年薪千万的身价，可惜工资没到账。`)
        else if (styleIdx === 2) lines.push(`${champ}这局${kda}，伤害占比${dmgs}%，打得不赖，继续保持。`)
        else if (styleIdx === 3) lines.push(`${champ}！这个选手用${champ}打出了全场最高的伤害占比${dmgs}%，这就是终极核心的统治力！`)
        else if (styleIdx === 4) lines.push(`${champ} ${kda}，伤害占比${dmgs}%——天选之人，一人成军，燃爆全场！`)
        else if (styleIdx === 5) lines.push(`${champ} ${kda}，伤害拉满，对面被你点得头皮发麻。`)
        else lines.push(`${champ}这数据${kda}，${winStr}局伤害占比${dmgs}%，建议对面回家好好反省一下为什么没针对你。`)
      } else if (perf >= 5) {
        if (styleIdx === 0) lines.push(`${champ}（${kda}·${winStr}·${durMin}min）伤害${dmgs}%承伤${mits}%，中规中矩，及格了但不够C。`)
        else if (styleIdx === 1) lines.push(`${champ}这局${kda}，只能说还像个人，离带飞还差一个段位。`)
        else if (styleIdx === 2) lines.push(`${champ} ${kda}，伤害${dmgs}%，发挥稳定，要是能再凶一点就好了。`)
        else if (styleIdx === 3) lines.push(`${champ}！虽然数据${kda}并不华丽，但伤害占比${dmgs}%为团队提供了稳定火力。`)
        else if (styleIdx === 4) lines.push(`${champ} ${kda}，平凡但可靠，不是主角但也不是小兵。`)
        else if (styleIdx === 5) lines.push(`${champ} ${kda}，比上不足比下有余，你说菜吧又不菜，说C吧又C不动。`)
        else lines.push(`${champ}（${kda}）发挥在及格线附近晃悠，稳是稳，但也可以理解为缺乏存在感。`)
      } else if (perf >= 0) {
        if (styleIdx === 0) lines.push(`${champ}（${kda}·${winStr}）—— ${dmgs}%伤害占比，数据平平，像极了来峡谷补觉的。`)
        else if (styleIdx === 1) lines.push(`${champ}这局${kda}，伤害${dmgs}%承伤${mits}%，感觉你玩的是单机模式，队友死活跟你没关系。`)
        else if (styleIdx === 2) lines.push(`${champ} ${kda}，表现有些挣扎，下次试试少送几个？`)
        else if (styleIdx === 3) lines.push(`${champ}这局的发挥只能说还需要更多训练，${kda}的数据难以让人满意。`)
        else if (styleIdx === 4) lines.push(`${champ}...${kda}，这就是你修炼多年的结果？再练练吧。`)
        else if (styleIdx === 5) lines.push(`${champ} ${kda}，承伤${mits}%伤害${dmgs}%，突出一个"来过"。`)
        else lines.push(`${champ}（${kda}）数据平淡如水，建议把ID改成"凑数的"。`)
      } else {
        if (styleIdx === 0) lines.push(`${champ}（${kda}·${g.win ? '胜' : '负'}）—— 这${champ}玩得像在送温暖，对面估计给你点了赞。`)
        else if (styleIdx === 1) lines.push(`${champ}这局${kda}，伤害占比才${dmgs}%死${g.deaths}次，你是峡谷慈善家？`)
        else if (styleIdx === 2) lines.push(`${champ}这局有些不在状态，${kda}的数据需要好好总结一下。`)
        else if (styleIdx === 3) lines.push(`${champ}！这个数据${kda}实在是太辣眼睛了，观众席都看不下去了！`)
        else if (styleIdx === 4) lines.push(`${champ} ${kda}——黑暗降临，这局就当是渡劫了。`)
        else if (styleIdx === 5) lines.push(`${champ} ${kda}，你这操作我看得血压都上来了。`)
        else lines.push(`${champ}（${kda}·${dmgs}%伤害）这局纯属靠队友带，建议赛后请全队喝奶茶。`)
      }

      /* extra line for leader achievements per game */
      const extraFlags: string[] = []
      if (isDmgLeader) extraFlags.push("伤害")
      if (isMitLeader) extraFlags.push("承伤")
      if (isAstLeader) extraFlags.push("助攻")
      if (extraFlags.length && perf >= 0) {
        const flagLine = pick(
          [`本局拿下${extraFlags.join("/")}榜首！`, `（${extraFlags.join("/")}三项数据位列全场第一）`, `，同时斩获${extraFlags.join("/")}头名`],
          sSeed + "_extra", gi,
        )
        lines.push(`  → ${flagLine}`)
      }

      if (g.kills === 0 && g.deaths > 3) {
        lines.push(pick(
          [`这把零击杀死${g.deaths}次，建议把手捐了。`, `拿了${g.deaths}个死没拿一个头，？？？`, `0杀${g.deaths}死，这战绩发群里会被嘲笑的。`],
          sSeed + "_0k", gi,
        ))
      }
      if (g.kills >= 10) {
        lines.push(pick(
          [`${g.kills}个人头！这${champ}在你手里跟杀神一样。`, `${g.kills}杀！对面被你这${champ}打出了心理阴影。`, `爆杀${g.kills}个，这局你说了算。`],
          sSeed + "_10k", gi,
        ))
      }
    }

    /* ═══════════════ 2. 全局单项榜首数据点评 ═══════════════ */
    lines.push(`【全局榜首数据点评】`)
    const dLead = r.damageLeaderCount
    const mLead = r.mitigationLeaderCount
    const aLead = r.assistLeaderCount
    const totLead = dLead + mLead + aLead

    if (totLead === 0) {
      lines.push(pick(
        [`${r.gamesPlayed}局打下来，没有在任何一项数据上登顶过榜首，建议换个车队或者换个游戏。`,
         `三项榜首次数全部挂零，突出一个"雨露均沾但都不突出"。`,
         `伤害/承伤/助攻榜首一个没拿到，这就是传说中的均衡之道？`],
        seed + "_l0", 0,
      ))
    }
    if (dLead > 0) {
      if (dLead >= 3) lines.push(pick(
        [`伤害榜首 ×${dLead} —— 团战输出机器，对面看到你的伤害面板就想点投降。`,
         `${dLead}局伤害登顶，你就是行走的伤害统计器，站在那就是威胁。`,
         `拿下${dLead}局伤害最高，你的字典里没有"划水"两个字。`],
        seed + "_ld", dLead,
      ))
      else if (dLead >= 2) lines.push(pick(
        [`${dLead}局伤害登顶，输出端的稳定火力点，偶尔也能当爹。`,
         `${dLead}次伤害榜首，证明你不是来峡谷观光的，是真在打伤害。`,
         `伤害榜首拿了${dLead}次，还不错，虽然不多但胜在有。`],
        seed + "_ld2", dLead,
      ))
      else lines.push(pick(
        [`1局伤害最高，昙花一现的爆发力，建议再努把力。`,
         `只拿了1次伤害榜首，说明你还有很大的进步空间。`,
         `1次伤害登顶，给你颁个"瞬间爆发奖"。`],
        seed + "_ld1", dLead,
      ))
    }
    if (mLead > 0) {
      if (mLead >= 3) lines.push(pick(
        [`承伤榜首 ×${mLead} —— 前排真男人，对面的技能全往你脸上招呼了。`,
         `${mLead}局承伤拉满，堪称人肉沙包，队友的盾都省了。`,
         `承伤之王${mLead}次登顶，这就是真正的坦克精神！`],
        seed + "_lm", mLead,
      ))
      else if (mLead >= 2) lines.push(pick(
        [`${mLead}局承伤榜首，前排抗伤意识在线，挨打也是一门艺术。`,
         `${mLead}次承伤登顶，肉得对面怀疑人生。`,
         `承伤拿了${mLead}次第一，肉盾本职完成得不错。`],
        seed + "_lm2", mLead,
      ))
      else lines.push(pick(
        [`1次承伤榜首，证明你能扛一次，但不能扛一辈子。`,
         `承伤榜首只拿1次，下次试试多吃点技能？`,
         `1局承伤最高，说明你偶尔也想当个男人。`],
        seed + "_lm1", mLead,
      ))
    }
    if (aLead > 0) {
      if (aLead >= 3) lines.push(pick(
        [`助攻榜首 ×${aLead} —— 团队发动机，你的助攻比你的KDA还亮眼。`,
         `${aLead}局助攻最多，你是团队粘合剂，没了你队友连架都打不赢。`,
         `助攻之王${aLead}次，你就是峡谷里的快递员，把胜利送到每个人手上。`],
        seed + "_la", aLead,
      ))
      else if (aLead >= 2) lines.push(pick(
        [`${aLead}局助攻最多，团队节奏带动者，给AD当狗当得心甘情愿。`,
         `${aLead}次助攻登顶，工具人当得出神入化。`,
         `助攻${aLead}局第一，团队型选手，适合五排车队。`],
        seed + "_la2", aLead,
      ))
      else lines.push(pick(
        [`1次助攻最高，你可能是个隐藏的辅助奇才。`,
         `助攻榜首拿1次，偶尔也当了一回绿叶。`,
         `1局助攻最多，证明你还是有团队意识的……大概吧。`],
        seed + "_la1", aLead,
      ))
    }

    /* ═══════════════ 3. 今日整体总表现总结 ═══════════════ */
    lines.push(`【今日整体总表现总结】`)
    const wr = r.wins / r.gamesPlayed * 100
    const mainRole = s.mainRoleLabel || "全能"
    const label = scoreEvaluationLabel(s.overallScore)
    const hl = r.highlightGames; const dl = r.disasterGames
    const vol = s.volatility

    /* header – rating-based */
    if (isExcellent) {
      lines.push(pick(
        [`综合评分 ${s.overallScore.toFixed(1)}（${label}），${r.gamesPlayed}局${wr.toFixed(0)}%胜率、${hl}局高光——今日峡谷大魔王，建议拳头削你。`,
         `评分${s.overallScore.toFixed(1)}，评级${label}，今天你就是全场最靓的仔，队友躺赢就完事了。`,
         `${s.overallScore.toFixed(1)}分，${label}级，${r.gamesPlayed}局${wr.toFixed(0)}%的胜率说明你在这个分段就是降维打击。`],
        seed + "_s1", 0,
      ))
    } else if (isGood) {
      lines.push(pick(
        [`综合评分 ${s.overallScore.toFixed(1)}（${label}），${r.gamesPlayed}局${wr.toFixed(0)}%胜率、${hl}局高光、${dl}局战犯——有点东西，但不多。`,
         `${s.overallScore.toFixed(1)}分，评级${label}，今天算是个合格的队友。`,
         `评分${s.overallScore.toFixed(1)}，${label}，${r.gamesPlayed}局总体不错，细节再打磨一下就是大腿了。`],
        seed + "_s2", 0,
      ))
    } else if (isMid) {
      lines.push(pick(
        [`综合评分 ${s.overallScore.toFixed(1)}（${label}），${r.gamesPlayed}局${wr.toFixed(0)}%胜率——说菜吧又不太菜，说强吧又不太强，主打一个尴尬。`,
         `${s.overallScore.toFixed(1)}分，${label}级，属于那种"赢了没你功劳，输了有你份"的玩家。`,
         `评分${s.overallScore.toFixed(1)}，评级${label}，你的发挥就像薛定谔的猫——又菜又C的叠加态。`],
        seed + "_s3", 0,
      ))
    } else {
      lines.push(pick(
        [`综合评分 ${s.overallScore.toFixed(1)}（${label}），${r.gamesPlayed}局仅${r.wins}胜，${dl}局战犯——要不咱换个游戏？`,
         `评分${s.overallScore.toFixed(1)}，${label}级，这数据发到朋友圈会被拉黑吧。`,
         `${s.overallScore.toFixed(1)}分，${label}，建议最近别碰排位，去大乱斗沉淀一下。`],
        seed + "_s4", 0,
      ))
    }

    /* data-driven mid-section */
    if (d > 0 && k / Math.max(d, 0.5) > 3.5 && isGood) {
      lines.push(pick(
        [`场均KDA ${k.toFixed(1)}/${d.toFixed(1)}/${a.toFixed(1)}，这KDA比你的脸还干净，稳健得一批。`,
         `KDA ${k.toFixed(1)}/${d.toFixed(1)}/${a.toFixed(1)}，又稳又C，建议去职业队试训。`],
        seed + "_kda1", 0,
      ))
    } else if (d > 0 && k / Math.max(d, 0.5) < 1) {
      lines.push(pick(
        [`KDA ${k.toFixed(1)}/${d.toFixed(1)}/${a.toFixed(1)}，死得比杀得多，建议下局玩塔姆，至少跑得快。`,
         `${k.toFixed(1)}杀${d.toFixed(1)}死，这KDA，我奶奶来打都不会死这么多次。`],
        seed + "_kda2", 0,
      ))
    }
    if (ds < 0.18 && ms < 0.18) {
      lines.push(pick(
        [`伤害${(ds * 100).toFixed(0)}%承伤${(ms * 100).toFixed(0)}%，两项数据都低于18%，你今天的表现完美诠释了"隐身"二字。`,
         `输出和承伤都垫底，你头上是不是顶着个问号——"队友去哪了？"`],
        seed + "_dmlow", 0,
      ))
    } else if (ds >= 0.28 && ms >= 0.28) {
      lines.push(pick(
        [`伤害${(ds * 100).toFixed(0)}%+承伤${(ms * 100).toFixed(0)}%，能打能扛，团队基石就是你。`,
         `双高数据${(ds * 100).toFixed(0)}%/${(ms * 100).toFixed(0)}%，六边形战士本士。`],
        seed + "_dmhigh", 0,
      ))
    }
    if (vol > 18) {
      lines.push(pick(
        [`波动率${vol.toFixed(1)}，你的状态比女朋友的心情还难以预测，建议去算一卦再开游戏。`,
         `稳定性${vol.toFixed(1)}，神一场鬼一场，队友的心脏受不了。`],
        seed + "_vol", 0,
      ))
    }

    /* concluding line */
    if (isExcellent) {
      lines.push(pick(
        [`定位${mainRole}，建议以后组车队你当队长，其他人安心当狗就行了。`,
         `核心定位${mainRole}，今天你就是峡谷唯一真神。`,
         `${mainRole}玩明白了，建议出教学视频，我一定给你三连。`],
        seed + "_end1", 0,
      ))
    } else if (isGood) {
      lines.push(pick(
        [`定位${mainRole}，下次想上分建议找两个靠谱的队友带你飞。`,
         `主要定位${mainRole}，距离顶尖还差一步，今天先这样吧。`,
         `${mainRole}是你能吃分的路子，以后就认准这个位置打。`],
        seed + "_end2", 0,
      ))
    } else if (isMid) {
      lines.push(pick(
        [`定位${mainRole}，建议多练练，少送点，争取下次不当副作用。`,
         `最适合你的位置是${mainRole}，但今天的数据说明你还有很长的路要走。`,
         `${mainRole}是你的舒适区，但舒适不等于优秀，加油练吧。`],
        seed + "_end3", 0,
      ))
    } else {
      lines.push(pick(
        [`建议先去训练营练补刀，别来排位祸害队友了。`,
         `听哥一句劝，这游戏不适合你，去玩点休闲游戏不好吗？`,
         `今天就这样吧，建议你把游戏卸了，明天重新下回来换个手感。`],
        seed + "_end4", 0,
      ))
    }

    return { puuid: r.puuid, gameName: r.gameName, tagLine: r.tagLine, score: s.overallScore, lines }
  })
})

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
    const totalK = entry.records.reduce((s, r) => s + r.kills, 0)
    const totalD = entry.records.reduce((s, r) => s + r.deaths, 0)
    const totalA = entry.records.reduce((s, r) => s + r.assists, 0)
    const avgK = totalK / n; const avgD = totalD / n; const avgA = totalA / n
    const lead = leaderCounts.get(player.puuid) || leaderInit()
    const gameRecords: PlayerGameRecord[] = entry.records.map((r) => {
      const dmgShare = (r.damageToChampions || 0) / Math.max(r.teamDamageToChampions || 0, 1)
      const mitVal = (r.totalDamageTaken || 0) + (r.damageSelfMitigated || 0)
      const mitShare = mitVal / Math.max((r.teamTotalDamageTaken || 0) + (r.teamDamageSelfMitigated || 0), 1)
      return { gameId: r.gameId, championId: r.championId, kills: r.kills, deaths: r.deaths, assists: r.assists, win: r.win, gameDuration: r.gameDuration, damageShare: dmgShare, mitigationShare: mitShare }
    })
    ratings.push({
      puuid: player.puuid, gameName: player.gameName, tagLine: player.tagLine,
      summonerName: player.summonerName, gamesPlayed: n, wins: entry.wins,
      profile, recentChampionIds: entry.records.map((r) => r.championId), championProfiles, gameRecords,
      avgKills: avgK, avgDeaths: avgD, avgAssists: avgA,
      overallKdaScore: kdaScore(avgK, avgD, avgA),
      highlightGames: Math.round(profile.highlightRate * n),
      disasterGames: Math.round(profile.disasterRate * n),
      damageLeaderCount: lead.damage, mitigationLeaderCount: lead.mitigation, assistLeaderCount: lead.assist,
      leaderGameIds: { damage: lead.damageGames, mitigation: lead.mitigationGames, assist: lead.assistGames },
    })
  }
  return ratings.sort((a, b) => b.profile.overallScore - a.profile.overallScore)
})

/* ── load ── */
async function load() {
  loading.value = true; error.value = ""
  deletedGameIds.value = new Set()
  data.value = null
  try {
    data.value = await loadTodayCustomGames(rangeStartMs.value, rangeEndMs.value)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally { loading.value = false }
}

onMounted(load)
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
          <div class="summary-item"><span class="sl">平均KDA分</span><span class="sv" :class="scoreClass(summaryStats.avgKdaScore)">{{ summaryStats.avgKdaScore.toFixed(0) }}</span></div>
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
              <ChevronDown v-if="gameListVisible" :size="14" /><ChevronUp v-else :size="14" />
              对局列表 ({{ filteredGames.length }})
            </span>
          </div>
          <div class="gsh-right">
            <div class="game-filter-buttons">
              <button :class="{ active: gameTypeFilter === 'all' }" @click="gameTypeFilter = 'all'">全部</button>
              <button :class="{ active: gameTypeFilter === 'quick' }" @click="gameTypeFilter = 'quick'">速推</button>
              <button :class="{ active: gameTypeFilter === 'long' }" @click="gameTypeFilter = 'long'">鏖战</button>
            </div>
          </div>
        </div>

        <div v-show="gameListVisible" class="game-list">
          <div v-for="game in filteredGames" :key="game.gameId" class="game-card-outer">
            <div
              class="game-card"
              :class="{ 'game-has-expanded': expandedGames.has(game.gameId) }"
              @mouseenter="hoveredGameId = game.gameId"
              @mouseleave="hoveredGameId = null"
            >
              <!-- left: blue team -->
              <div class="team-col bc-blue" :class="game.teams[0]?.win ? 'team-win-border' : 'team-lose-dim'">
                <div class="team-players-row">
                  <div v-for="p in game.teams[0]?.players || []" :key="p.puuid" class="tp-avatar-wrap">
                    <div class="tp-avatar-frame">
                      <img
                        :src="`https://ddragon.leagueoflegends.com/cdn/15.7.1/img/champion/${(props.champions as Record<number, any>)[p.championId]?.alias || p.championId}.png`"
                        class="tp-avatar"
                        :title="(props.champions as Record<number, any>)[p.championId]?.name || ''"
                      />
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
                      <img
                        :src="`https://ddragon.leagueoflegends.com/cdn/15.7.1/img/champion/${(props.champions as Record<number, any>)[p.championId]?.alias || p.championId}.png`"
                        class="tp-avatar"
                        :title="(props.champions as Record<number, any>)[p.championId]?.name || ''"
                      />
                      <Crown v-if="p.puuid === game.mvp.puuid" :size="10" class="mvp-crown" />
                    </div>
                    <span class="tp-name">{{ p.gameName.length > 6 ? p.gameName.slice(0, 6) + '..' : p.gameName }}</span>
                    <span class="tp-score" :class="scoreClass(p.gameScore)">{{ p.gameScore }}</span>
                  </div>
                </div>
              </div>

              <!-- expand btn -->
              <button class="game-expand-btn" @click="toggleGameExpand(game.gameId)">
                <ChevronDown v-if="!expandedGames.has(game.gameId)" :size="14" />
                <ChevronUp v-else :size="14" />
              </button>
              <button class="game-delete-btn" @click="deleteGame(game.gameId)" title="临时删除此局">
                <X :size="12" />
              </button>
            </div>

            <!-- expanded per-game table -->
            <div v-if="expandedGames.has(game.gameId)" class="game-expanded-table">
              <table class="mini-game-table">
                <thead>
                  <tr>
                    <th>队伍</th><th>玩家</th><th>英雄</th><th>K</th><th>D</th><th>A</th><th>KDA分</th><th>伤害</th><th>承伤</th><th>治疗</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(team, ti) in game.teams" :key="ti">
                    <td v-for="p in team.players" :key="p.puuid" style="display:contents">
                      <!-- We need a flat list; use nested approach -->
                    </td>
                  </tr>
                  <!-- Flat list of all players -->
                  <template v-for="(p) in game.teams.flatMap((t, ti) => t.players.map(pl => ({ ...pl, teamIdx: ti, teamWin: t.win })))" :key="p.puuid">
                    <tr :class="p.teamWin ? 'tr-win-bg' : 'tr-lose-bg'">
                      <td class="mg-team">{{ p.teamWin ? '🔵' : '🔴' }}</td>
                      <td class="mg-player">{{ p.gameName }}</td>
                      <td class="mg-champ"><img :src="`https://ddragon.leagueoflegends.com/cdn/15.7.1/img/champion/${(props.champions as Record<number, any>)[p.championId]?.alias || p.championId}.png`" class="mg-champ-icon"/></td>
                      <td class="mg-stat">{{ p.kills }}</td>
                      <td class="mg-stat">{{ p.deaths }}</td>
                      <td class="mg-stat">{{ p.assists }}</td>
                      <td class="mg-stat"><span :class="scoreClass(p.gameScore)">{{ p.gameScore }}</span></td>
                      <td class="mg-stat">{{ (p.damageDealtToChampions / 1000).toFixed(1) }}k</td>
                      <td class="mg-stat">{{ (p.totalDamageTaken / 1000).toFixed(1) }}k</td>
                      <td class="mg-stat">{{ (p.totalHeal / 1000).toFixed(1) }}k</td>
                    </tr>
                  </template>
                </tbody>
              </table>
            </div>

            <!-- hover tooltip -->
            <div v-if="hoveredGameId === game.gameId" class="game-hover-tooltip">
              <div v-for="team in game.teams" :key="team.teamId" class="ght-team">
                <div class="ght-header" :class="team.win ? 'ght-win' : 'ght-lose'">{{ team.win ? '胜利' : '失败' }} (均分 {{ team.avgScore.toFixed(0) }})</div>
                <div v-for="p in team.players" :key="p.puuid" class="ght-player">
                  <img :src="`https://ddragon.leagueoflegends.com/cdn/15.7.1/img/champion/${(props.champions as Record<number, any>)[p.championId]?.alias || p.championId}.png`" class="ght-icon"/>
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
      <div v-if="playerRatings.length === 0" class="empty-state"><Swords :size="32" /><span>该日期没有对局记录</span></div>

      <!-- ═══════════════ RATING TABLE ═══════════════ -->
      <div v-else class="rating-table-wrap">
        <div class="section-title" style="margin-bottom:8px">
          玩家评分
          <button class="toggle-sub" :class="{ active: gameListVisible }" @click="gameListVisible = !gameListVisible" style="margin-left:8px;font-size:11px">
            <ChevronsUpDown :size="12" /> {{ gameListVisible ? '隐藏对局' : '显示对局' }}
          </button>
        </div>

        <div class="filter-bar">
          <input v-model="filterText" placeholder="搜索玩家..." class="filter-input" />
          <div class="tag-dropdown-wrap">
            <button class="filter-select tag-dropdown-trigger" @click="tagDropdownOpen = !tagDropdownOpen" @blur="(e) => { const t = e.currentTarget as HTMLElement | null; const rt = e.relatedTarget as HTMLElement | null; if (t && (!rt || !t.contains(rt))) tagDropdownOpen = false }">
              标签{{ filterTags.length ? ` (${filterTags.length})` : '' }}
            </button>
            <div v-if="tagDropdownOpen" class="tag-dropdown-panel" @mousedown.prevent>
              <label v-for="tag in availableTags" :key="tag" class="tag-dd-item">
                <input type="checkbox" :value="tag" v-model="filterTags" />
                <span>{{ tag }}</span>
              </label>
              <div v-if="!availableTags.length" class="tag-dd-empty">暂无标签</div>
            </div>
          </div>
          <button class="toggle-sub" :class="{ active: showExtremes }" @click="showExtremes = !showExtremes" style="min-width:52px">
            <component :is="showExtremes ? ChevronDown : ChevronUp" :size="14" />
            极值
          </button>
          <button class="toggle-sub" @click="showSubColumns = !showSubColumns">
            <component :is="showSubColumns ? ChevronUp : ChevronDown" :size="14" />
            {{ showSubColumns ? '收起' : '展开' }}详细
          </button>
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
                <th class="col-kda sortable" @click="sortBy('kdaScore')">KDA分{{ sortIcon('kdaScore') }}</th>
                <th class="col-ability sortable" @click="sortBy('carry')">输出{{ sortIcon('carry') }}</th>
                <th class="col-ability sortable" @click="sortBy('frontline')">前排{{ sortIcon('frontline') }}</th>
                <th class="col-ability sortable" @click="sortBy('support')">辅助{{ sortIcon('support') }}</th>
                <th v-if="showSubColumns" class="col-detail sortable" @click="sortBy('damageShare')">伤害%{{ sortIcon('damageShare') }}</th>
                <th v-if="showSubColumns" class="col-detail sortable" @click="sortBy('mitigationShare')">承伤%{{ sortIcon('mitigationShare') }}</th>
                <th v-if="showSubColumns" class="col-detail sortable" @click="sortBy('healingShare')">治疗%{{ sortIcon('healingShare') }}</th>
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
                      <img :src="`https://ddragon.leagueoflegends.com/cdn/15.7.1/img/champion/${(props.champions as Record<number, any>)[cp.championId]?.alias || cp.championId}.png`" class="champ-icon-lg" />
                      <span class="champ-score" :class="scoreClass(cp.averageScore)">{{ cp.averageScore.toFixed(0) }}</span>
                    </div>
                  </div>
                </td>
                <td class="col-num">{{ rating.gamesPlayed }}</td>
                <td class="col-num">{{ rating.wins }}</td>
                <td class="col-num wr-cell" :class="winRate(rating) >= 50 ? 'wr-high' : 'wr-low'">{{ winRate(rating).toFixed(0) }}%</td>
                <td class="col-num" :class="cellExtreme(rating.puuid, 'avgKills')">{{ rating.avgKills.toFixed(1) }}</td>
                <td class="col-num" :class="cellExtreme(rating.puuid, 'avgDeaths')">{{ rating.avgDeaths.toFixed(1) }}</td>
                <td class="col-num" :class="cellExtreme(rating.puuid, 'overallKdaScore')"><span :class="scoreClass(rating.overallKdaScore)">{{ rating.overallKdaScore }}</span></td>
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
            <div class="rhc-row"><span class="rhc-l">KDA</span><span class="rhc-v">{{ hoveredPlayer.avgKills.toFixed(1) }} / {{ hoveredPlayer.avgDeaths.toFixed(1) }} / {{ hoveredPlayer.avgAssists.toFixed(1) }}</span><span class="rhc-l">KDA分</span><span class="rhc-v" :class="scoreClass(hoveredPlayer.overallKdaScore)">{{ hoveredPlayer.overallKdaScore }}</span></div>
            <div class="rhc-row"><span class="rhc-l">场均击杀</span><span class="rhc-v">{{ hoveredPlayer.avgKills.toFixed(1) }}</span><span class="rhc-l">场均死亡</span><span class="rhc-v">{{ hoveredPlayer.avgDeaths.toFixed(1) }}</span></div>
            <div class="rhc-divider"></div>
            <div class="rhc-row"><span class="rhc-l">标签</span><span class="rhc-tags"><span v-for="tag in hoveredPlayer.profile.tags" :key="tag" class="mini-tag">{{ tag }}</span></span></div>
            <div class="rhc-divider"></div>
            <div class="rhc-section-l">英雄详情</div>
            <div v-for="cp in hoveredPlayer.championProfiles" :key="cp.championId" class="rhc-champ">
              <img :src="`https://ddragon.leagueoflegends.com/cdn/15.7.1/img/champion/${(props.champions as Record<number, any>)[cp.championId]?.alias || cp.championId}.png`" class="rhc-ci" />
              <div class="rhc-cinfo"><span class="rhc-cn">{{ championName(champions, cp.championId) }}</span><span class="rhc-cs">{{ cp.games }}场 · 均分 <span :class="scoreClass(cp.averageScore)">{{ cp.averageScore.toFixed(0) }}</span> · 伤{{ (cp.averageDamageShare * 100).toFixed(0) }}%</span></div>
            </div>
          </div>
        </div>
      </div>

      <!-- ═══════════════ CHARTS ═══════════════ -->
      <div v-if="playerRatings.length > 0" class="charts-section">
        <div class="charts-header" @click="chartsVisible = !chartsVisible">
          <component :is="chartsVisible ? ChevronUp : ChevronDown" :size="16" />
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

      <!-- ═══════════════ PLAYER REVIEWS ═══════════════ -->
      <div v-if="playerRatings.length > 0" class="review-section">
        <div class="review-header" @click="reviewsVisible = !reviewsVisible">
          <component :is="reviewsVisible ? ChevronUp : ChevronDown" :size="16" />
          <span>玩家锐评</span>
        </div>
        <div v-show="reviewsVisible" class="review-body">
          <div v-for="review in playerReviews" :key="review.puuid" class="review-card">
            <div class="review-title">
              <span class="review-name">{{ review.gameName }}#{{ review.tagLine }}</span>
              <span class="review-score" :class="scoreClass(review.score)">{{ review.score.toFixed(1) }}</span>
              <span class="review-eval">{{ scoreEvaluationLabel(review.score) }}</span>
            </div>
            <div class="review-line" v-for="(line, li) in review.lines" :key="li">{{ line }}</div>
          </div>
        </div>
      </div>

      <!-- ═══════════════ PLAYER RADAR ═══════════════ -->
      <PlayerRadarPanel v-if="playerRatings.length > 0" :players="playerRatings" />
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
.game-section-header { display: flex; align-items: center; justify-content: space-between; }
.gsh-left { display: flex; align-items: center; gap: 8px; }
.section-title { font-size: 14px; font-weight: 600; color: var(--text-muted, #888); display: flex; align-items: center; gap: 4px; }
.game-filter-buttons { display: flex; gap: 4px; }
.game-filter-buttons button { padding: 3px 10px; border: 1px solid var(--border, #444); background: transparent; color: var(--text-muted, #888); border-radius: 4px; font-size: 11px; cursor: pointer; }
.game-filter-buttons button.active { background: var(--accent, #6366f1); border-color: var(--accent, #6366f1); color: #fff; }

.game-list { display: flex; flex-direction: column; gap: 6px; }

/* ── game card ── */
.game-card-outer { position: relative; }
.game-card { display: flex; align-items: stretch; gap: 0; background: var(--bg-tertiary, #1e1e1e); border: 1px solid var(--border, #333); border-radius: 8px; overflow: hidden; position: relative; }
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
.tp-avatar { width: 32px; height: 32px; border-radius: 6px; object-fit: cover; display: block; }
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
.game-expanded-table { background: var(--bg-secondary, #1a1a2e); border: 1px solid var(--border, #333); border-top: none; border-radius: 0 0 8px 8px; padding: 8px 12px; overflow-x: auto; }
.mini-game-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.mini-game-table th { padding: 4px 6px; text-align: center; font-weight: 600; color: var(--text-muted, #888); font-size: 10px; text-transform: uppercase; border-bottom: 1px solid var(--border, #333); }
.mini-game-table td { padding: 4px 6px; text-align: center; }
.tr-win-bg { background: rgba(34, 197, 94, 0.04); }
.tr-lose-bg { background: rgba(239, 68, 68, 0.03); }
.mg-team { font-size: 14px; }
.mg-player { text-align: left; font-weight: 600; white-space: nowrap; }
.mg-champ { text-align: center; }
.mg-champ-icon { width: 20px; height: 20px; border-radius: 3px; }
.mg-stat { font-variant-numeric: tabular-nums; font-size: 11px; }

/* hover tooltip */
.game-hover-tooltip { position: absolute; top: 100%; left: 0; right: 0; z-index: 100; background: #1a1a2e; border: 1px solid #444; border-radius: 8px; padding: 10px 14px; display: flex; gap: 16px; margin-top: 4px; box-shadow: 0 8px 24px rgba(0,0,0,0.5); }
.ght-team { flex: 1; display: flex; flex-direction: column; gap: 3px; }
.ght-header { font-size: 10px; font-weight: 700; text-transform: uppercase; margin-bottom: 3px; }
.ght-win { color: #4ade80; }
.ght-lose { color: #f87171; }
.ght-player { display: flex; align-items: center; gap: 5px; font-size: 11px; padding: 2px 4px; background: rgba(255,255,255,0.04); border-radius: 3px; }
.ght-icon { width: 16px; height: 16px; border-radius: 3px; }
.ght-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text, #ddd); }
.ght-kda { font-size: 10px; color: var(--text-muted, #888); font-variant-numeric: tabular-nums; white-space: nowrap; }
.ght-score { font-size: 10px; font-weight: 700; padding: 0 3px; border-radius: 2px; }

/* ── filter bar ── */
.filter-bar { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; flex-wrap: wrap; }
.filter-input { padding: 5px 10px; background: var(--bg-tertiary, #2a2a2a); border: 1px solid var(--border, #444); border-radius: 4px; color: var(--text, #eee); font-size: 12px; outline: none; width: 120px; }
.filter-input::placeholder { color: var(--text-muted, #666); }
.filter-select { padding: 5px 8px; background: var(--bg-tertiary, #2a2a2a); border: 1px solid var(--border, #444); border-radius: 4px; color: var(--text, #eee); font-size: 12px; outline: none; min-width: 80px; cursor: pointer; }
.tag-dropdown-wrap { position: relative; }
.tag-dropdown-panel { position: absolute; top: 100%; left: 0; z-index: 300; background: #1a1a2e; border: 1px solid #444; border-radius: 6px; padding: 6px; min-width: 120px; max-height: 240px; overflow-y: auto; box-shadow: 0 8px 24px rgba(0,0,0,0.5); display: flex; flex-direction: column; gap: 2px; margin-top: 4px; }
.tag-dd-item { display: flex; align-items: center; gap: 6px; padding: 4px 6px; border-radius: 3px; cursor: pointer; font-size: 12px; color: var(--text, #ddd); white-space: nowrap; }
.tag-dd-item:hover { background: rgba(99, 102, 241, 0.12); }
.tag-dd-item input { accent-color: #6366f1; }
.tag-dd-empty { padding: 8px; color: var(--text-muted, #666); font-size: 11px; text-align: center; }
.toggle-sub { display: inline-flex; align-items: center; gap: 4px; padding: 5px 10px; background: #fff; border: 1px solid #d0d0d0; border-radius: 4px; color: #333; font-size: 11px; cursor: pointer; }
.toggle-sub:hover { border-color: var(--accent, #6366f1); color: var(--accent, #6366f1); }
.toggle-sub.active { background: var(--accent, #6366f1); border-color: var(--accent, #6366f1); color: #fff; }
.toggle-sub.active:hover { opacity: 0.85; }
.filter-count { font-size: 11px; color: var(--text-muted, #666); margin-left: auto; white-space: nowrap; }

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
.champ-icon-lg { width: 28px; height: 28px; border-radius: 5px; object-fit: cover; }
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
.rhc-ci { width: 24px; height: 24px; border-radius: 4px; }
.rhc-cinfo { display: flex; flex-direction: column; gap: 1px; }
.rhc-cn { font-size: 12px; font-weight: 600; color: var(--text, #eee); }
.rhc-cs { font-size: 11px; color: var(--text-muted, #888); }

/* ── charts ── */
.charts-section { border-top: 1px solid var(--border, #333); padding-top: 8px; }
.charts-header { display: flex; align-items: center; gap: 6px; cursor: pointer; color: var(--text-muted, #888); font-size: 13px; font-weight: 600; padding: 6px 0; }
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
.review-header { display: flex; align-items: center; gap: 6px; cursor: pointer; color: var(--text-muted, #888); font-size: 13px; font-weight: 600; padding: 6px 0; }
.review-header:hover { color: var(--accent, #6366f1); }
.review-body { display: flex; flex-direction: column; gap: 8px; padding: 12px 0; }
.review-card { background: var(--bg-tertiary, #1e1e1e); border: 1px solid var(--border, #333); border-radius: 8px; padding: 10px 14px; }
.review-title { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.review-name { font-size: 14px; font-weight: 700; color: var(--text, #eee); }
.review-score { font-size: 13px; font-weight: 700; font-variant-numeric: tabular-nums; padding: 0 6px; border-radius: 3px; }
.review-eval { font-size: 11px; color: var(--text-muted, #888); font-weight: 600; }
.review-line { font-size: 13px; line-height: 1.6; color: #ccc; padding: 2px 0; }
.review-line::before { content: "▸ "; color: var(--accent, #6366f1); }

.loading-state, .error-state, .empty-state { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 48px 0; color: var(--text-muted, #888); }
.spin { animation: spin 1s linear infinite; }
@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
</style>

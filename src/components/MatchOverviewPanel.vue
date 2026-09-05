<script setup lang="ts">
import { computed, inject, ref, watch } from "vue"
import { ClipboardCopy, LoaderCircle, Eye, EyeOff } from "lucide-vue-next"
import { searchPlayer } from "../api"
import { copyElementAsPng } from "../imageShare"
import { notifyKey } from "../notifications"
import { buildPlayerProfile, profileTierClass, profileTierLabel, type PlayerProfile } from "../playerProfile"
import type {
  ChampionSummaryItem,
  GameAssetBundle,
  GameAssetEntry,
  MatchDetailPlayer,
  MatchDetailResponse,
  RecentGame,
} from "../types"
import { formatDate } from "../utils"
import GameDetailTeams from "./GameDetailTeams.vue"
import KillRelationsCard from "./KillRelationsCard.vue"

const PLAYER_ABILITY_SCAN_DEPTH = 150
const PLAYER_ABILITY_DISPLAY_DEPTH = 100
const PLAYER_ABILITY_CONCURRENCY = 3
const MIN_VALID_GAME_DURATION_SECONDS = 8 * 60

type PlayerAbilityState = {
  loading: boolean
  error: string
  profile: PlayerProfile | null
}

const props = defineProps<{
  game: RecentGame
  matchDetail: MatchDetailResponse | null
  loading: boolean
  error: string
  champions: Record<number, ChampionSummaryItem>
  gameAssets: GameAssetBundle
  sgpServerId?: string
}>()

const emit = defineEmits<{
  openPlayer: [player: MatchDetailPlayer]
}>()

const captureRef = ref<HTMLElement | null>(null)
const copying = ref(false)
const showPlayerAbility = ref(false)
const abilityLoading = ref(false)
const playerAbilityStates = ref<Record<string, PlayerAbilityState>>({})
const notify = inject(notifyKey, () => 0)

const spellMap = computed(() => indexAssets(props.gameAssets.summonerSpells))
const itemMap = computed(() => indexAssets(props.gameAssets.items))
const perkMap = computed(() => indexAssets(props.gameAssets.perks))
const augmentMap = computed(() => indexAssets(props.gameAssets.augments))
const ratingContext = computed(() => ({
  items: itemMap.value,
  champions: props.champions,
}))

watch(
  () => props.matchDetail?.gameId,
  () => {
    showPlayerAbility.value = false
    abilityLoading.value = false
    playerAbilityStates.value = {}
  },
)

function indexAssets(entries: GameAssetEntry[]) {
  return entries.reduce<Record<number, GameAssetEntry>>((acc, entry) => {
    acc[entry.id] = entry
    return acc
  }, {})
}

function queueName(game: RecentGame | MatchDetailResponse) {
  const map: Record<number, string> = {
    400: "匹配",
    420: "单双排",
    430: "匹配",
    440: "灵活排",
    450: "大乱斗",
    480: "极限闪击",
    490: "快速匹配",
    900: "无限火力",
    1700: "斗魂竞技场",
    1710: "斗魂竞技场",
    1711: "斗魂竞技场",
    1712: "斗魂竞技场",
    1900: "无限火力",
    2400: "海克斯大乱斗",
  }

  return map[game.queueId] || game.gameMode || `队列 ${game.queueId}`
}

function playerLabel(player: MatchDetailPlayer) {
  if (player.gameName && player.tagLine) return `${player.gameName}#${player.tagLine}`
  return player.summonerName || player.puuid || "未知玩家"
}

/** 本局所有玩家（击杀关系卡复用组件用） */
const detailAllPlayers = computed(() => {
  if (!props.matchDetail) return []
  return props.matchDetail.teams.flatMap((team) => team.players)
})

/** 行 title：普通模式显示玩家名，查看玩家能力模式显示历史能力说明 */
function playerTitleFor(player: MatchDetailPlayer) {
  return showPlayerAbility.value ? playerAbilityTitle(player) : playerLabel(player)
}

function playerAbilityLabel(player: MatchDetailPlayer) {
  const state = playerAbilityStates.value[playerAbilityKey(player)]
  if (state?.loading) return "读取中"
  if (state?.error) return "读取失败"

  const profile = state?.profile
  if (!profile) return "待读取"
  if (!profile.games) return "样本不足"
  return `${Math.round(profile.overallScore)}分 · ${profileTierLabel(profile.overallScore)}`
}

function playerAbilityTitle(player: MatchDetailPlayer) {
  const state = playerAbilityStates.value[playerAbilityKey(player)]
  if (state?.loading) return `${playerLabel(player)}\n正在读取历史能力`
  if (state?.error) return `${playerLabel(player)}\n历史能力读取失败：${state.error}`

  const profile = state?.profile
  if (!profile?.games) return `${playerLabel(player)}\n历史样本不足`

  const carry = profile.abilities.carry
  return [
    playerLabel(player),
    `历史能力 ${Math.round(profile.overallScore)}分 · ${profileTierLabel(profile.overallScore)}`,
    `样本 ${profile.games}场 · 主玩 ${profile.mainRoleLabel}`,
    `carry率 ${Math.round(profile.highlightRate * 100)}% · 战犯率 ${Math.round(profile.disasterRate * 100)}%`,
    `输出能力 ${carry.games ? `${Math.round(carry.averageScore)}分` : "样本不足"}`,
  ].join("\n")
}

function playerAbilityTone(player: MatchDetailPlayer) {
  const state = playerAbilityStates.value[playerAbilityKey(player)]
  if (state?.error) return "profile-tier-big-pit"

  const profile = state?.profile
  return profile ? profileTierClass(profile.overallScore) : "profile-empty"
}

async function togglePlayerAbility() {
  if (showPlayerAbility.value) {
    showPlayerAbility.value = false
    return
  }

  showPlayerAbility.value = true
  await loadPlayerAbilities()
}

function playerAbilityKey(player: MatchDetailPlayer) {
  return player.puuid || `${player.teamId}:${player.participantId}`
}

function allMatchPlayers() {
  return props.matchDetail?.teams.flatMap((team) => team.players) || []
}

async function loadPlayerAbilities() {
  if (!props.matchDetail || abilityLoading.value) return

  const players = allMatchPlayers().filter((player) => {
    const state = playerAbilityStates.value[playerAbilityKey(player)]
    return !state?.profile && !state?.loading
  })
  if (!players.length) return

  abilityLoading.value = true
  for (const player of players) {
    setPlayerAbilityState(player, { loading: true, error: "", profile: null })
  }

  try {
    await runWithConcurrency(players, PLAYER_ABILITY_CONCURRENCY, loadPlayerAbility)
  } finally {
    abilityLoading.value = false
  }
}

async function loadPlayerAbility(player: MatchDetailPlayer) {
  try {
    if (!player.puuid) throw new Error("缺少 PUUID")

    const stats = await searchPlayer(
      player.puuid,
      PLAYER_ABILITY_SCAN_DEPTH,
      props.sgpServerId,
      false,
      false,
    )
    const games = stats.recentGames
      .filter(
        (game) =>
          game.gameDuration >= MIN_VALID_GAME_DURATION_SECONDS &&
          abilityQueueMatches(game, props.matchDetail || props.game),
      )
      .slice(0, PLAYER_ABILITY_DISPLAY_DEPTH)
    const profile = buildPlayerProfile(games, ratingContext.value)

    setPlayerAbilityState(player, { loading: false, error: "", profile })
  } catch (error) {
    setPlayerAbilityState(player, {
      loading: false,
      error: errorMessage(error),
      profile: null,
    })
  }
}

function setPlayerAbilityState(player: MatchDetailPlayer, state: PlayerAbilityState) {
  playerAbilityStates.value = {
    ...playerAbilityStates.value,
    [playerAbilityKey(player)]: state,
  }
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
) {
  let index = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index]
      index += 1
      await worker(item)
    }
  })

  await Promise.all(workers)
}

function abilityQueueMatches(game: RecentGame, source: RecentGame | MatchDetailResponse) {
  const queueId = source.queueId
  const gameMode = source.gameMode || ""

  if (isHexAram(queueId, gameMode)) return isHexAram(game.queueId, game.gameMode)

  if (queueId === 450 || gameMode === "ARAM") {
    return !isHexAram(game.queueId, game.gameMode) && (game.queueId === 450 || game.gameMode === "ARAM")
  }

  if ([420, 440].includes(queueId)) {
    return [420, 440].includes(game.queueId)
  }

  if ([400, 430, 490].includes(queueId) || gameMode === "CLASSIC") {
    return (
      [400, 420, 430, 440, 490].includes(game.queueId) ||
      (game.gameMode === "CLASSIC" &&
        ![450, 1700, 1710, 1711, 1712, 2400].includes(game.queueId))
    )
  }

  return true
}

function isHexAram(queueId: number, gameMode: string) {
  return queueId === 2400 || ["CHERRY", "STRAWBERRY", "KIWI"].includes(gameMode.toUpperCase())
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

async function copyImage() {
  const target = captureRef.value
  if (!target || !props.matchDetail || copying.value) return

  copying.value = true
  try {
    await copyElementAsPng(target, {
      backgroundColor: "#f6faf9",
      pixelRatio: 2,
      filter: (node) => !(node instanceof HTMLElement && node.classList.contains("overview-actions")),
    })

    notify({ kind: "success", title: "分享图片已复制", message: "可以直接粘贴到聊天窗口" })
  } catch (error) {
    notify({
      kind: "error",
      title: "分享图片生成失败",
      message: errorMessage(error),
      duration: 7000,
    })
  } finally {
    copying.value = false
  }
}
</script>

<template>
  <section class="overview-panel" ref="captureRef">
    <header class="overview-toolbar">
      <div class="overview-meta">
        <strong>总览</strong>
        <span>模式 {{ queueName(matchDetail || game) }}</span>
        <span>对局时间 {{ Math.floor(game.gameDuration / 60) }}:{{ String(game.gameDuration % 60).padStart(2, "0") }}</span>
        <span>开始时间 {{ formatDate(game.gameCreation) }}</span>
      </div>
      <div class="overview-actions">
        <button class="ability-toggle" :disabled="loading || !matchDetail" @click="togglePlayerAbility">
          <LoaderCircle v-if="showPlayerAbility && abilityLoading" class="spin" :size="14" />
          <Eye v-else-if="!showPlayerAbility" :size="14" />
          <EyeOff v-else :size="14" />
          {{ showPlayerAbility ? "关闭查看" : "查看玩家能力" }}
        </button>
        <button :disabled="copying || loading || !matchDetail" @click="copyImage">
          <ClipboardCopy :size="14" />
          {{ copying ? "生成中" : "分享" }}
        </button>
      </div>
    </header>

    <div class="overview-state" v-if="loading">
      <LoaderCircle class="spin" :size="18" />
      正在读取对局详情
    </div>
    <div class="overview-state error" v-else-if="error">{{ error }}</div>

    <div class="overview-body" v-else-if="matchDetail">
      <!-- 每队 header + 十人明细行：与内战评分展开详情共用同一组件，此处用浅色主题 -->
      <GameDetailTeams
        :teams="matchDetail.teams"
        :champions="champions"
        :item-map="itemMap"
        :spell-map="spellMap"
        :perk-map="perkMap"
        :augment-map="augmentMap"
        theme="light"
        :interactive="true"
        :title-for="playerTitleFor"
        @open-player="emit('openPlayer', $event)"
      >
        <template #name="{ player }">
          <span
            v-if="!showPlayerAbility"
            class="player-name-cell"
            :title="playerLabel(player)"
          >
            {{ playerLabel(player) }}
          </span>
          <span v-else :class="['player-ability-cell', playerAbilityTone(player)]">
            {{ playerAbilityLabel(player) }}
          </span>
        </template>
      </GameDetailTeams>

      <KillRelationsCard
        v-if="detailAllPlayers.length"
        :players="detailAllPlayers"
        :champions="champions"
        theme="light"
        title="击杀关系（谁杀了谁）"
      />
    </div>
  </section>
</template>

<style scoped>
.overview-panel {
  display: flex;
  min-height: 0;
  flex-direction: column;
  gap: 10px;
  border: 1px solid #dce7e4;
  border-radius: 8px;
  background: #f6faf9;
  padding: 12px;
}

.overview-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid #dce7e4;
  padding-bottom: 10px;
}

.overview-meta {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.overview-meta strong {
  border-radius: 8px;
  color: #ffffff;
  background: #1f5f56;
  font-size: 12px;
  padding: 7px 13px;
}

.overview-meta span {
  color: #718087;
  font-size: 12px;
  font-weight: 700;
}

.overview-actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
}

.overview-actions button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border-radius: 8px;
  color: #ffffff;
  background: #1f5f56;
  cursor: pointer;
  font-size: 12px;
  font-weight: 800;
  padding: 7px 10px;
}

.overview-actions .ability-toggle {
  color: #315f58;
  background: #edf5f3;
}

.overview-state {
  display: inline-flex;
  min-height: 360px;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: #657179;
  font-weight: 800;
}

.overview-state.error {
  color: #a94745;
}

.overview-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* 名字区由 GameDetailTeams 的 #name 插槽渲染（父作用域样式直接作用于插槽内容） */
.player-name-cell {
  min-width: 0;
  overflow: hidden;
  color: #53666c;
  font-size: 13.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.player-ability-cell {
  display: inline-flex;
  max-width: 106px;
  align-items: center;
  justify-content: center;
  border-radius: 7px;
  color: inherit;
  font-size: 12px;
  font-weight: 950;
  line-height: 1;
  padding: 6px 7px;
}

.profile-tier-apex {
  position: relative;
  overflow: hidden;
  color: #5d3300;
  border: 1px solid rgba(245, 185, 52, 0.72);
  background:
    linear-gradient(135deg, rgba(255, 244, 184, 0.96), rgba(255, 195, 64, 0.9) 45%, rgba(255, 236, 150, 0.96)),
    #ffd36a;
}

.profile-tier-steady {
  color: #145b3e;
  background: rgba(204, 239, 218, 0.88);
}

.profile-tier-normal {
  color: #174d83;
  background: rgba(205, 229, 255, 0.92);
}

.profile-tier-small-pit {
  color: #8a5200;
  background: rgba(255, 238, 191, 0.94);
}

.profile-tier-big-pit {
  color: #8f3434;
  background: rgba(248, 214, 213, 0.92);
}

.profile-empty {
  color: #657179;
  background: #edf4f2;
}
</style>

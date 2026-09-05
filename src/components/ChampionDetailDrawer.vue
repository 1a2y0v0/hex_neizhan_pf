<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { ChevronRight, X } from "lucide-vue-next"
import type { ChampionSummaryItem, GameAssetEntry, MatchDetailResponse } from "../types"
import { calculateOutputRating } from "../scoring"
import AssetIcon from "./AssetIcon.vue"
import ChampionAvatar from "./ChampionAvatar.vue"
import GameDetailPopup from "./GameDetailPopup.vue"

const props = defineProps<{
  championId: number
  championName: string
  games: MatchDetailResponse[]
  champions: Record<number, ChampionSummaryItem>
  itemMap: Record<number, GameAssetEntry>
  spellMap: Record<number, GameAssetEntry>
  augmentMap: Record<number, GameAssetEntry>
  perkMap: Record<number, GameAssetEntry>
  championTotalPicks: number
  championTotalWinRate: number
}>()

const emit = defineEmits<{
  (e: "close"): void
}>()

const ratingContext = computed(() => ({ items: props.itemMap, champions: props.champions }))

interface DrawerRow {
  gameId: number
  dateStr: string
  duration: number
  kills: number
  deaths: number
  assists: number
  win: boolean
  blue: boolean
  damageShare: number
  spell1Id: number
  spell2Id: number
  itemIds: number[]
  augmentIds: number[]
  gameName: string
  score: number
}

const rows = computed<DrawerRow[]>(() => {
  const out: DrawerRow[] = []
  for (const game of props.games) {
    for (const team of game.teams) {
      for (const p of team.players) {
        if (p.championId !== props.championId) continue
        const damageShare =
          (p.damageToChampions || 0) / Math.max(p.teamDamageToChampions || 0, 1)
        out.push({
          gameId: game.gameId,
          dateStr: formatDateStr(game.gameCreation),
          duration: game.gameDuration,
          kills: p.kills,
          deaths: p.deaths,
          assists: p.assists,
          win: p.win,
          blue: p.teamId === 100,
          damageShare,
          spell1Id: p.spell1Id,
          spell2Id: p.spell2Id,
          itemIds: p.itemIds || [],
          augmentIds: p.augmentIds || [],
          gameName: p.gameName,
          score: calculateOutputRating(p, ratingContext.value).score,
        })
      }
    }
  }
  return out.sort((a, b) => b.dateStr.localeCompare(a.dateStr))
})

/* ── 对局详情弹层：保留侧边栏，点击明细行切换本局十人详情 ── */
const selectedGameId = ref<number | null>(null)
const selectedGame = computed(() => props.games.find((g) => g.gameId === selectedGameId.value) || null)

function toggleGameDetail(gameId: number) {
  selectedGameId.value = selectedGameId.value === gameId ? null : gameId
}

const picks = computed(() => rows.value.length)
const wins = computed(() => rows.value.filter((r) => r.win).length)
const winRate = computed(() => (picks.value ? (wins.value / picks.value) * 100 : 0))

const blueWins = computed(() => rows.value.filter((r) => r.blue && r.win).length)
const redWins = computed(() => wins.value - blueWins.value)

const avgDurationMin = computed(() => {
  if (!picks.value) return 0
  return rows.value.reduce((s, r) => s + r.duration, 0) / picks.value / 60
})

const avgKda = computed(() => {
  if (!picks.value) return { k: 0, d: 0, a: 0 }
  const s = rows.value.reduce(
    (acc, r) => ({
      k: acc.k + r.kills,
      d: acc.d + r.deaths,
      a: acc.a + r.assists,
    }),
    { k: 0, d: 0, a: 0 },
  )
  return { k: s.k / picks.value, d: s.d / picks.value, a: s.a / picks.value }
})

const avgDamageShare = computed(() => {
  if (!picks.value) return 0
  return rows.value.reduce((s, r) => s + r.damageShare, 0) / picks.value
})

const dateGroups = computed(() => {
  const map = new Map<string, { date: string; label: string; count: number; wins: number; scores: number[] }>()
  for (const r of rows.value) {
    const key = r.dateStr.slice(0, 10)
    let e = map.get(key)
    if (!e) {
      e = { date: key, label: dateDisplayLabel(key), count: 0, wins: 0, scores: [] }
      map.set(key, e)
    }
    e.count++
    if (r.win) e.wins++
    e.scores.push(r.score)
  }
  const arr = [...map.values()].sort((a, b) => a.date.localeCompare(b.date))
  const max = Math.max(...arr.map((e) => e.count), 1)
  return { arr, max }
})

/** 非战斗装备关键词：极地大乱斗喂魄罗的“魄罗佳肴”等装饰性消耗品不应计入核心装备 */
const ITEM_FILTER_KEYWORDS = ["魄罗佳肴"]
function isIgnoredItem(itemId: number) {
  const name = props.itemMap[itemId]?.name || ""
  return ITEM_FILTER_KEYWORDS.some((k) => name.includes(k))
}

/** 核心装备：默认展示前 N 件，可展开为全部；均按出现次数降序 */
const ITEM_PREVIEW_COUNT = 12
const itemShowAll = ref(false)
const itemAgg = computed(() => {
  const map = new Map<number, { count: number; wins: number }>()
  for (const r of rows.value) {
    for (const itemId of r.itemIds) {
      if (isIgnoredItem(itemId)) continue
      let e = map.get(itemId)
      if (!e) {
        e = { count: 0, wins: 0 }
        map.set(itemId, e)
      }
      e.count++
      if (r.win) e.wins++
    }
  }
  return [...map.entries()]
    .map(([id, e]) => ({
      id,
      count: e.count,
      winRate: e.count ? (e.wins / e.count) * 100 : 0,
    }))
    .sort((a, b) => b.count - a.count)
})
const shownItems = computed(() => (itemShowAll.value ? itemAgg.value : itemAgg.value.slice(0, ITEM_PREVIEW_COUNT)))
function toggleItemShowAll() {
  itemShowAll.value = !itemShowAll.value
}

/** 海克斯稀有度：取增强名（Riot 原始 rarity 带 k 前缀，如 kPrismatic）归一化为档位关键词 */
function augmentRarityKey(augmentId: number): string {
  const rarity = (props.augmentMap[augmentId]?.rarity || "").toLowerCase()
  if (rarity.includes("prismatic")) return "prismatic"
  if (rarity.includes("gold")) return "gold"
  if (rarity.includes("silver")) return "silver"
  if (rarity.includes("bronze")) return "bronze"
  return ""
}
function augmentRarityLabel(augmentId: number): string {
  switch (augmentRarityKey(augmentId)) {
    case "prismatic":
      return "棱彩"
    case "gold":
      return "黄金"
    case "silver":
      return "白银"
    case "bronze":
      return "青铜"
    default:
      return ""
  }
}
function augmentRarityClass(augmentId: number): string {
  switch (augmentRarityKey(augmentId)) {
    case "prismatic":
      return "cdd-aug-prismatic"
    case "gold":
      return "cdd-aug-gold"
    case "silver":
      return "cdd-aug-silver"
    case "bronze":
      return "cdd-aug-bronze"
    default:
      return ""
  }
}

/** 海克斯强化统计：默认展示前 N 个，可展开为全部；按出现次数降序 */
const AUGMENT_PREVIEW_COUNT = 12
const augmentShowAll = ref(false)
const augmentAgg = computed(() => {
  const map = new Map<number, { count: number; wins: number }>()
  for (const r of rows.value) {
    for (const augmentId of r.augmentIds) {
      let e = map.get(augmentId)
      if (!e) {
        e = { count: 0, wins: 0 }
        map.set(augmentId, e)
      }
      e.count++
      if (r.win) e.wins++
    }
  }
  return [...map.entries()]
    .map(([id, e]) => ({
      id,
      count: e.count,
      winRate: e.count ? (e.wins / e.count) * 100 : 0,
    }))
    .sort((a, b) => b.count - a.count)
})
const shownAugments = computed(() =>
  augmentShowAll.value ? augmentAgg.value : augmentAgg.value.slice(0, AUGMENT_PREVIEW_COUNT),
)
function toggleAugmentShowAll() {
  augmentShowAll.value = !augmentShowAll.value
}
function augmentTitleOf(a: { id: number; count: number; winRate: number }): string {
  const name = props.augmentMap[a.id]?.name || String(a.id)
  const rarity = augmentRarityLabel(a.id)
  return `${name}${rarity ? ` · ${rarity}` : ""} · 出现 ${a.count} 场 · 胜率 ${a.winRate.toFixed(0)}%`
}

const spellAgg = computed(() => {
  const map = new Map<string, { count: number; wins: number; a: number; b: number }>()
  for (const r of rows.value) {
    if (!r.spell1Id) continue
    const key = `${r.spell1Id}-${r.spell2Id}`
    let e = map.get(key)
    if (!e) {
      e = { count: 0, wins: 0, a: r.spell1Id, b: r.spell2Id }
      map.set(key, e)
    }
    e.count++
    if (r.win) e.wins++
  }
  return [...map.values()].sort((a, b) => b.count - a.count).slice(0, 6)
})

const playerAgg = computed(() => {
  const map = new Map<string, { gameName: string; count: number; wins: number }>()
  for (const r of rows.value) {
    let e = map.get(r.gameName)
    if (!e) {
      e = { gameName: r.gameName, count: 0, wins: 0 }
      map.set(r.gameName, e)
    }
    e.count++
    if (r.win) e.wins++
  }
  return [...map.values()].sort((a, b) => b.count - a.count)
})

/* ── 对局明细：玩家筛选（默认全部，选中后只展示该玩家的战绩条目） ── */
const playerFilter = ref<string>("")
const filteredRows = computed(() =>
  playerFilter.value ? rows.value.filter((r) => r.gameName === playerFilter.value) : rows.value,
)
// 切换到另一英雄（抽屉可能复用同一实例）时重置筛选
watch(
  () => props.championId,
  () => {
    playerFilter.value = ""
  },
)

function winRateClass(v: number) { return v >= 60 ? "sc-high" : v >= 50 ? "sc-mid" : "sc-low" }
function scoreClass(s: number) { return s >= 80 ? "sc-high" : s >= 60 ? "sc-mid" : "sc-low" }
function dateStr(ts: number) {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}
function formatDateStr(ts: number) {
  return `${dateStr(ts)} ${new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(new Date(ts))}`
}
/** "YYYY-MM-DD" → "YYYY/M/D"，例如 2026/8/31 */
function dateDisplayLabel(dateKey: string) {
  const [y, m, d] = dateKey.split("-").map(Number)
  return `${y}/${m}/${d}`
}
</script>

<template>
  <Teleport to="body">
    <div class="cdd-backdrop" @click="emit('close')">
      <aside class="cdd" @click.stop>
        <div class="cdd-header">
          <div class="cdd-title">
            <ChampionAvatar :champion-id="championId" :champions="champions" :size="42" />
            <div class="cdd-title-text">
              <h3>{{ championName }}</h3>
              <span class="cdd-subtitle">单英雄详情</span>
            </div>
          </div>
          <button class="cdd-close" @click="emit('close')"><X :size="18" /></button>
        </div>

        <div class="cdd-scroll">
          <section class="cdd-card">
            <div class="cdd-overview">
              <div class="cdd-ov-item"><span class="cdd-l">全局出局</span><span class="cdd-v">{{ picks }}</span></div>
              <div class="cdd-ov-item"><span class="cdd-l">胜率</span><span class="cdd-v" :class="winRateClass(winRate)">{{ winRate.toFixed(0) }}%</span></div>
              <div class="cdd-ov-item"><span class="cdd-l">蓝方胜</span><span class="cdd-v" style="color:#60a5fa">{{ blueWins }}</span></div>
              <div class="cdd-ov-item"><span class="cdd-l">红方胜</span><span class="cdd-v" style="color:#f87171">{{ redWins }}</span></div>
            </div>
            <div class="cdd-ov-sub">面板全局累计 {{ championTotalPicks }} 场 · 胜率 {{ championTotalWinRate.toFixed(0) }}%</div>
          </section>

          <section class="cdd-card">
            <div class="cdd-kpis">
              <div class="cdd-kpi"><span class="cdd-kpi-l">平均时局</span><span class="cdd-kpi-v">{{ avgDurationMin.toFixed(1) }} 分</span></div>
              <div class="cdd-kpi"><span class="cdd-kpi-l">平均KDA</span><span class="cdd-kpi-v">{{ avgKda.k.toFixed(1) }}/{{ avgKda.d.toFixed(1) }}/{{ avgKda.a.toFixed(1) }}</span></div>
              <div class="cdd-kpi"><span class="cdd-kpi-l">场均输出占比</span><span class="cdd-kpi-v">{{ (avgDamageShare * 100).toFixed(0) }}%</span></div>
            </div>
          </section>

          <section class="cdd-card" v-if="dateGroups.arr.length">
            <div class="cdd-sec-title">出场日期</div>
            <div class="cdd-date-list">
              <div v-for="e in dateGroups.arr" :key="e.date" class="cdd-date-row">
                <span class="cdd-date-label">{{ e.label }}</span>
                <div class="cdd-date-bar">
                  <div class="cdd-date-fill" :style="{ width: (e.count / dateGroups.max * 100) + '%' }"></div>
                </div>
                <span class="cdd-date-meta">{{ e.count }}局 · <span :class="winRateClass(e.wins / e.count * 100)">{{ Math.round(e.wins / e.count * 100) }}%</span></span>
              </div>
            </div>
          </section>

          <section class="cdd-card" v-if="playerAgg.length">
            <div class="cdd-sec-title">使用玩家</div>
            <div class="cdd-player-list">
              <div v-for="p in playerAgg.slice(0, 6)" :key="p.gameName" class="cdd-player-row">
                <span class="cdd-p-name">{{ p.gameName }}</span>
                <span class="cdd-p-num">{{ p.count }}局</span>
                <span class="cdd-p-wr" :class="winRateClass(p.wins / p.count * 100)">{{ (p.wins / p.count * 100).toFixed(0) }}%</span>
                <div class="cdd-p-bar"><div class="cdd-p-fill" :style="{ width: (p.wins / p.count * 100) + '%' }"></div></div>
              </div>
            </div>
          </section>

          <section class="cdd-card" v-if="spellAgg.length">
            <div class="cdd-sec-title">召唤师技能</div>
            <div class="cdd-spell-grid">
              <div v-for="s in spellAgg" :key="`${s.a}-${s.b}`" class="cdd-spell-item">
                <div class="cdd-spell-icons">
                  <AssetIcon :path="spellMap[s.a]?.iconPath" :label="spellMap[s.a]?.name" :fallback="String(s.a)" :size="24" />
                  <AssetIcon :path="spellMap[s.b]?.iconPath" :label="spellMap[s.b]?.name" :fallback="String(s.b)" :size="24" />
                </div>
                <span class="cdd-spell-meta">{{ s.count }}局 · <span :class="winRateClass(s.count ? s.wins / s.count * 100 : 0)">{{ Math.round(s.wins / s.count * 100) }}%</span></span>
              </div>
            </div>
          </section>

          <section class="cdd-card" v-if="itemAgg.length">
            <div class="cdd-sec-title">
              核心装备
              <button v-if="itemAgg.length > ITEM_PREVIEW_COUNT" class="cdd-more-btn" @click="toggleItemShowAll" title="按出现次数从高到低展示全部装备">
                <ChevronRight :size="12" class="cdd-more-chev" :class="{ open: itemShowAll }" />
                {{ itemShowAll ? "收起" : `展开全部 ${itemAgg.length} 件` }}
              </button>
            </div>
            <div class="cdd-stat-list">
              <div v-for="it in shownItems" :key="it.id" class="cdd-stat-row" :title="`${itemMap[it.id]?.name || it.id} · 出现 ${it.count} 场 · 胜率 ${it.winRate.toFixed(0)}%`">
                <span class="cdd-stat-lead">
                  <AssetIcon :path="itemMap[it.id]?.iconPath" :label="itemMap[it.id]?.name" :fallback="String(it.id)" :size="24" />
                  <span class="cdd-stat-name">{{ itemMap[it.id]?.name || it.id }}</span>
                </span>
                <span class="cdd-stat-count">×{{ it.count }}</span>
                <span class="cdd-stat-wr" :class="winRateClass(it.winRate)">{{ it.winRate.toFixed(0) }}%</span>
                <span class="cdd-stat-bar"><i class="cdd-stat-fill" :class="winRateClass(it.winRate)" :style="{ width: Math.min(it.winRate, 100) + '%' }"></i></span>
              </div>
            </div>
          </section>

          <section class="cdd-card" v-if="augmentAgg.length">
            <div class="cdd-sec-title">
              常用海克斯
              <button v-if="augmentAgg.length > AUGMENT_PREVIEW_COUNT" class="cdd-more-btn" @click="toggleAugmentShowAll" title="按出现次数从高到低展示全部海克斯强化">
                <ChevronRight :size="12" class="cdd-more-chev" :class="{ open: augmentShowAll }" />
                {{ augmentShowAll ? "收起" : `展开全部 ${augmentAgg.length} 个` }}
              </button>
            </div>
            <div class="cdd-stat-list">
              <div v-for="ag in shownAugments" :key="ag.id" class="cdd-stat-row" :title="augmentTitleOf(ag)">
                <span class="cdd-stat-lead">
                  <span class="cdd-aug-pill" :class="augmentRarityClass(ag.id)">
                    <i class="cdd-aug-dot" :class="augmentRarityClass(ag.id)"></i>
                    <span class="cdd-aug-tag-text">{{ augmentMap[ag.id]?.name || ag.id }}</span>
                  </span>
                </span>
                <span class="cdd-stat-count">×{{ ag.count }}</span>
                <span class="cdd-stat-wr" :class="winRateClass(ag.winRate)">{{ ag.winRate.toFixed(0) }}%</span>
                <span class="cdd-stat-bar"><i class="cdd-stat-fill" :class="winRateClass(ag.winRate)" :style="{ width: Math.min(ag.winRate, 100) + '%' }"></i></span>
              </div>
            </div>
          </section>

          <section class="cdd-card">
            <div class="cdd-sec-title">
              对局明细
              <select v-model="playerFilter" class="cdd-player-filter" title="按玩家筛选本英雄对局明细">
                <option value="">全部玩家（{{ rows.length }}局）</option>
                <option v-for="p in playerAgg" :key="p.gameName" :value="p.gameName">
                  {{ p.gameName }}（{{ p.count }}局）
                </option>
              </select>
              <span class="cdd-sec-hint">点击对局查看本局十人详情</span>
            </div>
            <div v-if="!filteredRows.length" class="cdd-empty">{{ playerFilter ? `没有「${playerFilter}」使用该英雄的对局` : "该英雄当前没有对局记录" }}</div>
            <div v-else class="cdd-game-list">
              <div
                v-for="(r, idx) in filteredRows"
                :key="`${r.gameId}-${idx}`"
                class="cdd-game clickable"
                :class="[r.win ? 'win' : 'lose', selectedGameId === r.gameId ? 'selected' : '']"
                :title="selectedGameId === r.gameId ? '点击收起对局详情' : '点击查看本局十人详情'"
                @click="toggleGameDetail(r.gameId)"
              >
                <span class="cdd-game-side" :class="r.blue ? 'blue' : 'red'">{{ r.blue ? '蓝' : '红' }}</span>
                <span class="cdd-game-result">{{ r.win ? '胜' : '负' }}</span>
                <span class="cdd-game-name" :title="r.gameName">{{ r.gameName }}</span>
                <span class="cdd-game-kda">{{ r.kills }}/{{ r.deaths }}/{{ r.assists }}</span>
                <span class="cdd-game-date">{{ r.dateStr.slice(5, 10) }}</span>
                <span class="cdd-game-dur">{{ (r.duration / 60).toFixed(0) }}分</span>
                <span class="cdd-game-dmg">{{ (r.damageShare * 100).toFixed(0) }}%</span>
                <span class="cdd-game-score" :class="scoreClass(r.score)">{{ r.score.toFixed(0) }}</span>
                <ChevronRight :size="12" class="cdd-game-chev" :class="{ open: selectedGameId === r.gameId }" />
              </div>
            </div>
          </section>
        </div>
      </aside>
    </div>

    <GameDetailPopup
      v-if="selectedGame"
      :game="selectedGame"
      :champions="champions"
      :item-map="itemMap"
      :spell-map="spellMap"
      :augment-map="augmentMap"
      :perk-map="perkMap"
      :highlight-champion-id="championId"
      @close="selectedGameId = null"
    />
  </Teleport>
</template>

<style scoped>
.cdd-backdrop {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: rgba(6, 10, 12, 0.55);
}

.cdd {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 460px;
  max-width: 90vw;
  display: flex;
  flex-direction: column;
  background: #17171f;
  border-left: 1px solid var(--border, #333);
  box-shadow: -12px 0 32px rgba(0, 0, 0, 0.45);
}

.cdd-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 18px;
  border-bottom: 1px solid var(--border, #333);
  background: #1e1e26;
}

.cdd-title { display: flex; align-items: center; gap: 12px; }
.cdd-title-text h3 { margin: 0; font-size: 18px; color: #f2f5f4; }
.cdd-subtitle { font-size: 12px; color: var(--text-muted, #888); }
.cdd-close {
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
.cdd-close:hover { color: var(--accent, #a5b4fc); border-color: var(--accent, #a5b4fc); }

.cdd-scroll { flex: 1; overflow-y: auto; padding: 14px 16px; display: flex; flex-direction: column; gap: 12px; }
.cdd-scroll::-webkit-scrollbar { width: 8px; }
.cdd-scroll::-webkit-scrollbar-thumb { background: #2e3742; border-radius: 4px; }

.cdd-card {
  background: var(--bg-tertiary, #1e1e1e);
  border: 1px solid var(--border, #333);
  border-radius: 10px;
  padding: 14px;
}

.cdd-overview { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.cdd-ov-item { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 8px 4px; border-radius: 8px; background: var(--bg-secondary, #272730); }
.cdd-l { font-size: 11px; color: var(--text-muted, #888); }
.cdd-v { font-size: 17px; font-weight: 800; color: #f2f5f4; }
.cdd-ov-sub { margin-top: 8px; font-size: 11px; color: var(--text-muted, #666); text-align: center; }

.cdd-kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.cdd-kpi { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 8px 4px; border-radius: 8px; background: var(--bg-secondary, #242730); }
.cdd-kpi-l { font-size: 11px; color: var(--text-muted, #888); }
.cdd-kpi-v { font-size: 14px; font-weight: 800; color: #f0f5f4; }

.cdd-sec-title { font-size: 13px; font-weight: 800; color: #dbe7e4; margin-bottom: 10px; display: flex; align-items: baseline; gap: 8px; }
.cdd-sec-hint { margin-left: auto; font-size: 10px; font-weight: 400; color: var(--text-muted, #666); }
.cdd-more-btn {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 7px;
  border: 1px solid var(--border, #444);
  border-radius: 6px;
  background: var(--bg-secondary, #272730);
  color: #9fb3ae;
  font-size: 11px;
  font-weight: 700;
  font-family: inherit;
  cursor: pointer;
  white-space: nowrap;
}
.cdd-more-btn:hover { color: var(--accent, #a5b4fc); border-color: var(--accent, #a5b4fc); }
.cdd-more-chev { flex-shrink: 0; transition: transform 0.15s, color 0.15s; }
.cdd-more-chev.open { transform: rotate(90deg); color: var(--accent, #a5b4fc); }
.cdd-player-filter {
  padding: 3px 6px;
  border-radius: 6px;
  border: 1px solid var(--border, #444);
  background: var(--bg-secondary, #272730);
  color: #dbe7e4;
  font-size: 12px;
  font-family: inherit;
  outline: none;
  cursor: pointer;
  max-width: 170px;
}
.cdd-player-filter option { color: #333; background: #fff; }

.cdd-date-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.cdd-date-label { width: 68px; font-size: 11px; color: #9fb3ae; flex-shrink: 0; }
.cdd-date-bar { flex: 1; height: 8px; border-radius: 4px; background: #262a33; overflow: hidden; }
.cdd-date-fill { height: 100%; background: #6366f1; border-radius: 4px; }
.cdd-date-meta { width: 82px; text-align: right; font-size: 11px; color: var(--text-muted, #777); }

.cdd-player-row { display: flex; align-items: center; gap: 8px; margin-bottom: 7px; }
.cdd-p-name { flex: 1; font-size: 13px; color: #d6e2df; font-weight: 800; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cdd-p-num { font-size: 11px; color: var(--text-muted, #888); width: 36px; }
.cdd-p-wr { font-size: 12px; font-weight: 800; width: 40px; text-align: right; }
.cdd-p-bar { flex: 0 0 60px; height: 6px; border-radius: 3px; background: #262a33; overflow: hidden; }
.cdd-p-fill { height: 100%; background: #6366f1; border-radius: 3px; }

.cdd-spell-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
.cdd-spell-item { display: flex; align-items: center; gap: 8px; padding: 8px; border-radius: 8px; background: var(--bg-secondary, #242730); }
.cdd-spell-icons { display: flex; gap: 4px; }
.cdd-spell-meta { font-size: 12px; color: #9fb3ae; }

/* 核心装备 / 常用海克斯：行式统计（名称 | 次数 | 胜率 | 进度条） */
.cdd-stat-list { display: flex; flex-direction: column; gap: 6px; }
.cdd-stat-row { display: flex; min-width: 0; align-items: center; gap: 8px; }
.cdd-stat-lead { display: flex; flex: 1; min-width: 0; align-items: center; gap: 6px; overflow: hidden; }
.cdd-stat-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; font-weight: 800; color: #d6e2df; }
.cdd-stat-count { flex: none; width: 44px; text-align: right; font-size: 11.5px; font-weight: 800; color: #9fb3ae; font-variant-numeric: tabular-nums; }
.cdd-stat-wr { flex: none; width: 44px; text-align: right; font-size: 12px; font-weight: 900; font-variant-numeric: tabular-nums; }
.cdd-stat-bar { position: relative; flex: none; width: 56px; height: 5px; border-radius: 3px; overflow: hidden; background: #2a2f3a; }
.cdd-stat-fill { position: absolute; inset: 0 auto 0 0; border-radius: 3px; background: #6366f1; }
.cdd-stat-fill.sc-high { background: #4ade80; }
.cdd-stat-fill.sc-mid { background: #facc15; }
.cdd-stat-fill.sc-low { background: #f87171; }

/* 海克斯行内标签：稀有度配色胶囊 + 圆点 */
.cdd-aug-pill {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 5px;
  max-width: 100%;
  padding: 2px 8px 2px 6px;
  border: 1px solid var(--border, #444);
  border-radius: 6px;
  color: #d8e2df;
  background: var(--bg-secondary, #242730);
  font-size: 12px;
  font-weight: 800;
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
}
.cdd-aug-pill .cdd-aug-tag-text { overflow: hidden; text-overflow: ellipsis; }
.cdd-aug-dot { flex: none; width: 7px; height: 7px; border-radius: 50%; background: #8a989c; }
.cdd-aug-pill.cdd-aug-prismatic { border-color: rgba(170, 72, 215, 0.5); color: #e2b8ff; background: rgba(109, 44, 145, 0.35); }
.cdd-aug-pill.cdd-aug-prismatic .cdd-aug-dot { background: #c77dff; box-shadow: 0 0 5px rgba(199, 125, 255, 0.8); }
.cdd-aug-pill.cdd-aug-gold { border-color: rgba(199, 144, 36, 0.55); color: #ffd36a; background: rgba(123, 77, 2, 0.32); }
.cdd-aug-pill.cdd-aug-gold .cdd-aug-dot { background: #f0b429; box-shadow: 0 0 5px rgba(240, 180, 41, 0.7); }
.cdd-aug-pill.cdd-aug-silver { border-color: rgba(134, 151, 166, 0.55); color: #c6d4de; background: rgba(73, 96, 111, 0.32); }
.cdd-aug-pill.cdd-aug-silver .cdd-aug-dot { background: #a9b7c6; box-shadow: 0 0 5px rgba(169, 183, 198, 0.6); }
.cdd-aug-pill.cdd-aug-bronze { border-color: rgba(167, 105, 60, 0.55); color: #e8b48a; background: rgba(122, 67, 35, 0.32); }
.cdd-aug-pill.cdd-aug-bronze .cdd-aug-dot { background: #c68a4e; box-shadow: 0 0 5px rgba(198, 138, 78, 0.6); }

.cdd-game-list { display: flex; flex-direction: column; gap: 5px; }
.cdd-game { display: flex; align-items: center; gap: 7px; padding: 7px 9px; border-radius: 8px; }
.cdd-game.win { background: rgba(34, 197, 94, 0.12); }
.cdd-game.lose { background: rgba(239, 68, 68, 0.12); }
.cdd-game.clickable { cursor: pointer; transition: filter 0.15s, box-shadow 0.15s; }
.cdd-game.clickable:hover { filter: brightness(1.2); }
.cdd-game.selected { box-shadow: 0 0 0 2px var(--accent, #818cf8); }
.cdd-game-side { width: 18px; font-size: 11px; font-weight: 800; text-align: center; flex-shrink: 0; }
.cdd-game-side.blue { color: #60a5fa; }
.cdd-game-side.red { color: #f87171; }
.cdd-game-result { width: 18px; font-size: 12px; font-weight: 800; flex-shrink: 0; }
.cdd-game.win .cdd-game-result { color: #4ade80; }
.cdd-game.lose .cdd-game-result { color: #f87171; }
.cdd-game-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-weight: 800; color: #d6e2df; }
.cdd-game-date { width: 30px; font-size: 11px; color: #9fb3ae; flex-shrink: 0; }
.cdd-game-kda { font-size: 12px; font-weight: 800; color: #e0e9e7; font-variant-numeric: tabular-nums; flex-shrink: 0; }
.cdd-game-dur { width: 27px; font-size: 11px; color: var(--text-muted, #888); flex-shrink: 0; }
.cdd-game-dmg { width: 30px; font-size: 11px; color: var(--text-muted, #888); text-align: right; flex-shrink: 0; }
.cdd-game-score { width: 26px; font-size: 12px; font-weight: 800; text-align: right; font-variant-numeric: tabular-nums; flex-shrink: 0; }
.cdd-game-chev { color: var(--text-muted, #777); flex-shrink: 0; transition: transform 0.15s, color 0.15s; }
.cdd-game-chev.open { transform: rotate(90deg); color: var(--accent, #a5b4fc); }

.cdd-empty { padding: 18px 0; text-align: center; font-size: 13px; color: var(--text-muted, #666); }
.sc-high { color: #4ade80; }
.sc-mid { color: #facc15; }
.sc-low { color: #f87171; }
</style>
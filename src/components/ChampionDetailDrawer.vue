<script setup lang="ts">
import { computed } from "vue"
import { X } from "lucide-vue-next"
import type { ChampionSummaryItem, GameAssetEntry, MatchDetailResponse } from "../types"
import AssetIcon from "./AssetIcon.vue"
import ChampionAvatar from "./ChampionAvatar.vue"

const props = defineProps<{
  championId: number
  championName: string
  games: MatchDetailResponse[]
  champions: Record<number, ChampionSummaryItem>
  itemMap: Record<number, GameAssetEntry>
  spellMap: Record<number, GameAssetEntry>
  championTotalPicks: number
  championTotalWinRate: number
}>()

const emit = defineEmits<{
  (e: "close"): void
}>()

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
  gameName: string
  score: number
}

function kdaScore(k: number, d: number, a: number) {
  return Math.round((k + a) / Math.max(d, 0.5) * 10) / 10
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
          gameName: p.gameName,
          score: kdaScore(p.kills, p.deaths, p.assists),
        })
      }
    }
  }
  return out.sort((a, b) => b.dateStr.localeCompare(a.dateStr))
})

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
  const map = new Map<string, { date: string; count: number; wins: number; scores: number[] }>()
  for (const r of rows.value) {
    const key = r.dateStr.slice(0, 10)
    let e = map.get(key)
    if (!e) {
      e = { date: r.dateStr.slice(5), count: 0, wins: 0, scores: [] }
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

const itemAgg = computed(() => {
  const map = new Map<number, { count: number; wins: number }>()
  for (const r of rows.value) {
    for (const itemId of r.itemIds) {
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
    .slice(0, 12)
    .sort((a, b) => a.id - b.id)
})

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

function winRateClass(v: number) { return v >= 60 ? "sc-high" : v >= 50 ? "sc-mid" : "sc-low" }
function scoreClass(s: number) { return s >= 80 ? "sc-high" : s >= 60 ? "sc-mid" : "sc-low" }
function dateStr(ts: number) {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}
function formatDateStr(ts: number) {
  return `${dateStr(ts)} ${new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(new Date(ts))}`
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
                <span class="cdd-date-label">{{ e.date.slice(5) }}</span>
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
            <div class="cdd-sec-title">核心装备</div>
            <div class="cdd-item-grid">
              <div v-for="it in itemAgg" :key="it.id" class="cdd-item" :title="`${itemMap[it.id]?.name || it.id} · ${it.count}次 · 胜率${it.winRate.toFixed(0)}%`">
                <AssetIcon :path="itemMap[it.id]?.iconPath" :label="itemMap[it.id]?.name" :fallback="String(it.id)" :size="30" />
                <span class="cdd-item-num">{{ it.count }}</span>
              </div>
            </div>
          </section>

          <section class="cdd-card">
            <div class="cdd-sec-title">对局明细</div>
            <div v-if="!rows.length" class="cdd-empty">该英雄当前没有对局记录</div>
            <div v-else class="cdd-game-list">
              <div v-for="(r, idx) in rows" :key="`${r.gameId}-${idx}`" class="cdd-game" :class="r.win ? 'win' : 'lose'">
                <span class="cdd-game-side" :class="r.blue ? 'blue' : 'red'">{{ r.blue ? '蓝' : '红' }}</span>
                <span class="cdd-game-result">{{ r.win ? '胜' : '负' }}</span>
                <span class="cdd-game-date">{{ r.dateStr.slice(5) }}</span>
                <span class="cdd-game-kda">{{ r.kills }}/{{ r.deaths }}/{{ r.assists }}</span>
                <span class="cdd-game-dur">{{ (r.duration / 60).toFixed(0) }}分</span>
                <span class="cdd-game-score" :class="scoreClass(r.score)">{{ r.score }}</span>
                <span class="cdd-game-dmg">{{ (r.damageShare * 100).toFixed(0) }}%</span>
              </div>
            </div>
          </section>
        </div>
      </aside>
    </div>
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

.cdd-sec-title { font-size: 13px; font-weight: 800; color: #dbe7e4; margin-bottom: 10px; }

.cdd-date-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.cdd-date-label { width: 52px; font-size: 12px; color: #9fb3ae; }
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

.cdd-item-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(56px, 1fr)); gap: 8px; }
.cdd-item { position: relative; display: grid; place-items: center; }
.cdd-item-num { position: absolute; right: -4px; bottom: -4px; min-width: 18px; height: 18px; padding: 0 3px; display: grid; place-items: center; border-radius: 8px; background: #6366f1; color: #fff; font-size: 10px; font-weight: 800; }

.cdd-game-list { display: flex; flex-direction: column; gap: 5px; }
.cdd-game { display: flex; align-items: center; gap: 8px; padding: 7px 10px; border-radius: 8px; }
.cdd-game.win { background: rgba(34, 197, 94, 0.12); }
.cdd-game.lose { background: rgba(239, 68, 68, 0.12); }
.cdd-game-side { width: 22px; font-size: 11px; font-weight: 800; text-align: center; }
.cdd-game-side.blue { color: #60a5fa; }
.cdd-game-side.red { color: #f87171; }
.cdd-game-result { width: 20px; font-size: 12px; font-weight: 800; }
.cdd-game.win .cdd-game-result { color: #4ade80; }
.cdd-game.lose .cdd-game-result { color: #f87171; }
.cdd-game-date { flex: 1; font-size: 12px; color: #9fb3ae; }
.cdd-game-kda { font-size: 12px; font-weight: 800; color: #e0e9e7; }
.cdd-game-dur { font-size: 11px; color: var(--text-muted, #888); }
.cdd-game-dmg { font-size: 11px; color: var(--text-muted, #888); text-align: right; }

.cdd-empty { padding: 18px 0; text-align: center; font-size: 13px; color: var(--text-muted, #666); }
.sc-high { color: #4ade80; }
.sc-mid { color: #facc15; }
.sc-low { color: #f87171; }
</style>
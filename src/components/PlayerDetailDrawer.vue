<script setup lang="ts">
import { computed, ref } from "vue"
import { Download, UserRound, X } from "lucide-vue-next"
import { save } from "@tauri-apps/plugin-dialog"
import { toBlob } from "html-to-image"
import type { ChampionSummaryItem } from "../types"
import { championName } from "../utils"
import { profileScoreLevel } from "../playerProfile"
import { scoreEvaluationLabel } from "../scoring"
import { saveExportFile } from "../api"
import ChampionAvatar from "./ChampionAvatar.vue"

interface DrawerChampProfile {
  championId: number
  games: number
  averageScore: number
  averageDamageShare: number
  label: string
}
interface DrawerPlayer {
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
  avgCspm: number
  avgKp: number
  avgKillShare: number
  avgMitigationPerDeath: number
  honors: Record<string, number>
  highlightGames: number
  disasterGames: number
  damageLeaderCount: number
  mitigationLeaderCount: number
  assistLeaderCount: number
  profile: {
    overallScore: number
    medianScore: number
    volatility: number
    highlightRate: number
    disasterRate: number
    tags: string[]
    abilities: {
      carry: { averageScore: number }
      frontline: { averageScore: number }
      support: { averageScore: number }
    }
  }
  championProfiles: DrawerChampProfile[]
}

const props = defineProps<{
  player: DrawerPlayer
  champions: Record<number, ChampionSummaryItem>
  rangeText?: string
}>()

const emit = defineEmits<{
  (e: "close"): void
}>()

/* ── 导出图片（参考玩家评分表的导出实现） ── */
const exportRef = ref<HTMLElement | null>(null)
const exportMenuOpen = ref(false)
const exporting = ref(false)
const exportMessage = ref("")

type ExportPreset = {
  key: string
  label: string
  ext: string
  type: string
  ratio: number
  quality?: number
}

const exportPresets: ExportPreset[] = [
  { key: "png2x", label: "PNG · 2x（无损）", ext: "png", type: "image/png", ratio: 2 },
  { key: "png3x", label: "PNG · 3x（超清）", ext: "png", type: "image/png", ratio: 3 },
  { key: "jpeg2x", label: "JPEG · 2x（体积小）", ext: "jpg", type: "image/jpeg", ratio: 2, quality: 0.92 },
  { key: "jpeg3x", label: "JPEG · 3x（清晰）", ext: "jpg", type: "image/jpeg", ratio: 3, quality: 0.9 },
  { key: "webp2x", label: "WebP · 2x（平衡）", ext: "webp", type: "image/webp", ratio: 2, quality: 0.92 },
  { key: "webp3x", label: "WebP · 3x（清晰）", ext: "webp", type: "image/webp", ratio: 3, quality: 0.9 },
]

function sanitizeFilename(s: string) {
  return s.replace(/[\\/:*?"<>|]/g, "-")
}
function exportFileName(preset: ExportPreset) {
  const range = sanitizeFilename(props.rangeText || "玩家详情")
  return `玩家详情_${sanitizeFilename(props.player.gameName)}_${sanitizeFilename(props.player.tagLine)}_${range}_${preset.ratio}x.${preset.ext}`
}
function ensureExportExtension(path: string, ext: string) {
  return path.toLowerCase().endsWith(`.${ext}`) ? path : `${path}.${ext}`
}

function buildExportRoot(): HTMLElement | null {
  const source = exportRef.value
  if (!source) return null

  const root = document.createElement("div")
  root.style.cssText = "position:absolute;left:0;top:0;z-index:-1;background:#ffffff;color:#111827;padding:16px;width:max-content;"
  root.style.fontFamily = getComputedStyle(source).fontFamily || "system-ui, -apple-system, Microsoft YaHei, sans-serif"

  const title = document.createElement("div")
  const range = props.rangeText || ""
  title.textContent = `玩家详情 · ${props.player.gameName}#${props.player.tagLine}${range ? ` · ${range}` : ""}`
  title.style.cssText = "margin:0 0 12px;font-size:16px;font-weight:700;color:#111827;"
  root.appendChild(title)

  const body = source.cloneNode(true) as HTMLElement
  body.style.width = "auto"
  body.style.overflow = "visible"
  body.style.background = "#ffffff"
  root.appendChild(body)

  const all = root.querySelectorAll<HTMLElement>("*")
  all.forEach((el) => {
    el.style.overflow = "visible"
    el.style.background = "transparent"
    el.style.color = "#111827"
    el.style.borderColor = "#d1d5db"
    el.style.boxShadow = "none"
    el.style.textShadow = "none"
  })

  const cards = root.querySelectorAll<HTMLElement>(".pdd-card")
  cards.forEach((el) => {
    el.style.background = "#f9fafb"
    el.style.borderColor = "#e5e7eb"
  })

  const icons = root.querySelectorAll<HTMLElement>("svg")
  icons.forEach((el) => {
    el.style.color = "#111827"
    el.setAttribute("stroke", "#111827")
  })

  return root
}

async function exportImage(preset: ExportPreset) {
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
      title: "导出玩家详情图片",
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

const HONOR_ORDER = ["MVP", "伤害王", "承伤王", "助攻王", "经济王", "KDA王", "控场王"]

function winRate(p: DrawerPlayer) {
  return p.gamesPlayed > 0 ? (p.wins / p.gamesPlayed) * 100 : 0
}
function scoreClass(s: number) { return s >= 80 ? "sc-high" : s >= 60 ? "sc-mid" : "sc-low" }
function kdaClass(s: number) { return s >= 4 ? "sc-high" : s >= 2.5 ? "sc-mid" : "sc-low" }
function abilityClass(s: number) { return s >= 80 ? "ab-high" : s >= 60 ? "ab-mid" : "ab-low" }
function weightedDamageShare(p: DrawerPlayer) {
  const total = p.championProfiles.reduce((s, cp) => s + cp.games, 0)
  return total ? p.championProfiles.reduce((s, cp) => s + cp.averageDamageShare * cp.games, 0) / total : 0
}

const honors = computed(() =>
  HONOR_ORDER.filter((h) => (props.player.honors[h] || 0) > 0),
)
</script>

<template>
  <Teleport to="body">
    <div class="pdd-backdrop" @click="emit('close')">
      <aside class="pdd" @click.stop>
        <div class="pdd-header">
          <div class="pdd-title">
            <UserRound :size="18" />
            <div class="pdd-title-text">
              <h3>{{ player.gameName }}#{{ player.tagLine }}</h3>
              <span class="pdd-subtitle">玩家详情 · {{ player.gamesPlayed }} 场内战</span>
            </div>
          </div>
          <div class="pdd-actions">
            <span v-if="exportMessage" class="pdd-export-msg">{{ exportMessage }}</span>
            <div class="pdd-export-wrap">
              <button class="pdd-export-btn" :class="{ active: exportMenuOpen }" @click="exportMenuOpen = !exportMenuOpen" :disabled="exporting" title="导出玩家详情图片">
                <Download :size="14" />
                <span>{{ exporting ? "导出中..." : "导出图片" }}</span>
              </button>
              <div v-if="exportMenuOpen" class="pdd-export-menu">
                <button v-for="p in exportPresets" :key="p.key" class="pdd-export-item" @click="exportImage(p)">
                  <span>{{ p.label }}</span>
                  <span class="pdd-export-desc">{{ p.type === "image/png" ? "无损" : p.type === "image/jpeg" ? "体积小" : "平衡" }}</span>
                </button>
              </div>
            </div>
            <button class="pdd-close" @click="emit('close')" title="关闭"><X :size="18" /></button>
          </div>
        </div>

        <div ref="exportRef" class="pdd-scroll">
          <section class="pdd-card">
            <div class="pdd-sec-title">综合概览</div>
            <div class="pdd-overview">
              <div class="pdd-ov-item"><span class="pdd-l">综合分</span><span class="pdd-v" :class="scoreClass(player.profile.overallScore)">{{ player.profile.overallScore.toFixed(1) }}</span></div>
              <div class="pdd-ov-item">
                <span class="pdd-l">评级</span>
                <span class="pdd-v badge" :class="`badge-${profileScoreLevel(player.profile.overallScore) === 'excellent' ? 'high' : profileScoreLevel(player.profile.overallScore) === 'good' ? 'mid' : 'low'}`">{{ scoreEvaluationLabel(player.profile.overallScore) }}</span>
              </div>
              <div class="pdd-ov-item"><span class="pdd-l">中位分</span><span class="pdd-v">{{ player.profile.medianScore.toFixed(1) }}</span></div>
              <div class="pdd-ov-item"><span class="pdd-l">波动率</span><span class="pdd-v">{{ player.profile.volatility.toFixed(1) }}</span></div>
              <div class="pdd-ov-item"><span class="pdd-l">高光率</span><span class="pdd-v sc-high">{{ (player.profile.highlightRate * 100).toFixed(0) }}%</span></div>
              <div class="pdd-ov-item"><span class="pdd-l">战犯率</span><span class="pdd-v sc-low">{{ (player.profile.disasterRate * 100).toFixed(0) }}%</span></div>
            </div>
          </section>

          <section class="pdd-card">
            <div class="pdd-sec-title">战绩与KDA</div>
            <div class="pdd-kv">
              <div class="pdd-kv-row"><span class="pdd-k">场次 / 胜场</span><span class="pdd-v"><b>{{ player.gamesPlayed }}</b> / <b class="sc-high">{{ player.wins }}</b></span></div>
              <div class="pdd-kv-row"><span class="pdd-k">胜率</span><span class="pdd-v" :class="winRate(player) >= 50 ? 'sc-high' : 'sc-low'"><b>{{ winRate(player).toFixed(0) }}%</b></span></div>
              <div class="pdd-kv-row"><span class="pdd-k">场均击杀 / 死亡 / 助攻</span><span class="pdd-v"><b>{{ player.avgKills.toFixed(1) }}</b> / <b>{{ player.avgDeaths.toFixed(1) }}</b> / <b>{{ player.avgAssists.toFixed(1) }}</b></span></div>
              <div class="pdd-kv-row"><span class="pdd-k">KDA</span><span class="pdd-v" :class="kdaClass(player.overallKdaScore)"><b>{{ player.overallKdaScore }}</b></span></div>
              <div class="pdd-kv-row"><span class="pdd-k">高光 / 战犯局</span><span class="pdd-v"><b class="sc-high">{{ player.highlightGames }}</b> / <b class="sc-low">{{ player.disasterGames }}</b></span></div>
            </div>
          </section>

          <section class="pdd-card">
            <div class="pdd-sec-title">能力</div>
            <div class="pdd-abilities">
              <div class="pdd-ab"><span class="pdd-l">输出</span><span class="pdd-v" :class="abilityClass(player.profile.abilities.carry.averageScore)">{{ player.profile.abilities.carry.averageScore.toFixed(0) }}</span></div>
              <div class="pdd-ab"><span class="pdd-l">前排</span><span class="pdd-v" :class="abilityClass(player.profile.abilities.frontline.averageScore)">{{ player.profile.abilities.frontline.averageScore.toFixed(0) }}</span></div>
              <div class="pdd-ab"><span class="pdd-l">辅助</span><span class="pdd-v" :class="abilityClass(player.profile.abilities.support.averageScore)">{{ player.profile.abilities.support.averageScore.toFixed(0) }}</span></div>
            </div>
          </section>

          <section class="pdd-card">
            <div class="pdd-sec-title">效率</div>
            <div class="pdd-kv">
              <div class="pdd-kv-row"><span class="pdd-k">分均经济</span><span class="pdd-v"><b>{{ player.avgGpm.toFixed(0) }}</b></span></div>
              <div class="pdd-kv-row"><span class="pdd-k">分均伤害</span><span class="pdd-v"><b>{{ player.avgDpm.toFixed(0) }}</b></span></div>
              <div class="pdd-kv-row"><span class="pdd-k">分均补刀</span><span class="pdd-v"><b>{{ player.avgCspm.toFixed(1) }}</b></span></div>
              <div class="pdd-kv-row"><span class="pdd-k">参团率</span><span class="pdd-v"><b>{{ (player.avgKp * 100).toFixed(0) }}%</b></span></div>
              <div class="pdd-kv-row"><span class="pdd-k">击杀占比</span><span class="pdd-v"><b>{{ (player.avgKillShare * 100).toFixed(0) }}%</b></span></div>
              <div class="pdd-kv-row"><span class="pdd-k">承伤每死</span><span class="pdd-v"><b>{{ player.avgMitigationPerDeath.toFixed(1) }}</b></span></div>
              <div class="pdd-kv-row"><span class="pdd-k">伤害占比</span><span class="pdd-v"><b>{{ (weightedDamageShare(player) * 100).toFixed(1) }}%</b></span></div>
            </div>
          </section>

          <section v-if="honors.length || player.damageLeaderCount || player.mitigationLeaderCount || player.assistLeaderCount" class="pdd-card">
            <div class="pdd-sec-title">荣誉与榜首</div>
            <div v-if="honors.length" class="pdd-chips">
              <span v-for="h in honors" :key="h" class="pdd-chip">{{ h }}×{{ player.honors[h] }}</span>
            </div>
            <div v-else class="pdd-empty">暂无荣誉</div>
            <div class="pdd-kv">
              <div class="pdd-kv-row"><span class="pdd-k">伤害榜首</span><span class="pdd-v" :class="player.damageLeaderCount > 0 ? 'ld-damage' : ''"><b>{{ player.damageLeaderCount }}</b> 次</span></div>
              <div class="pdd-kv-row"><span class="pdd-k">承伤榜首</span><span class="pdd-v" :class="player.mitigationLeaderCount > 0 ? 'ld-mitigation' : ''"><b>{{ player.mitigationLeaderCount }}</b> 次</span></div>
              <div class="pdd-kv-row"><span class="pdd-k">助攻榜首</span><span class="pdd-v" :class="player.assistLeaderCount > 0 ? 'ld-assist' : ''"><b>{{ player.assistLeaderCount }}</b> 次</span></div>
            </div>
          </section>

          <section v-if="player.profile.tags.length" class="pdd-card">
            <div class="pdd-sec-title">标签</div>
            <div class="pdd-chips">
              <span v-for="tag in player.profile.tags" :key="tag" class="pdd-chip">{{ tag }}</span>
            </div>
          </section>

          <section class="pdd-card">
            <div class="pdd-sec-title">英雄详情</div>
            <div v-if="!player.championProfiles.length" class="pdd-empty">暂无英雄数据</div>
            <div v-else class="pdd-champ-list">
              <div v-for="cp in player.championProfiles" :key="cp.championId" class="pdd-champ">
                <ChampionAvatar :champion-id="cp.championId" :champions="champions" :size="28" />
                <div class="pdd-cinfo">
                  <span class="pdd-cn">{{ championName(champions, cp.championId) }}<em>{{ cp.label }}</em></span>
                  <span class="pdd-cs">{{ cp.games }}场 · 均分 <b :class="scoreClass(cp.averageScore)">{{ cp.averageScore.toFixed(0) }}</b> · 伤{{ (cp.averageDamageShare * 100).toFixed(0) }}%</span>
                </div>
              </div>
            </div>
          </section>
        </div>
      </aside>
    </div>
  </Teleport>
</template>

<style scoped>
.pdd-backdrop {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: rgba(6, 10, 12, 0.55);
}

.pdd {
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

.pdd-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 18px;
  border-bottom: 1px solid var(--border, #333);
  background: #1e1e26;
}
.pdd-title { display: flex; align-items: center; gap: 12px; color: #a5b4fc; }
.pdd-title-text h3 { margin: 0; font-size: 18px; color: #f2f5f4; }
.pdd-subtitle { font-size: 12px; color: var(--text-muted, #888); }
.pdd-close {
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
.pdd-close:hover { color: var(--accent, #a5b4fc); }

/* 导出图片 */
.pdd-actions { display: flex; align-items: center; gap: 8px; }
.pdd-export-wrap { position: relative; }
.pdd-export-btn { display: inline-flex; align-items: center; gap: 5px; padding: 5px 10px; background: #fff; border: 1px solid #d0d0d0; border-radius: 5px; color: #333; font-size: 12px; cursor: pointer; height: 30px; box-sizing: border-box; }
.pdd-export-btn:hover { border-color: var(--accent, #6366f1); color: var(--accent, #6366f1); }
.pdd-export-btn.active { background: var(--accent, #6366f1); border-color: var(--accent, #6366f1); color: #fff; }
.pdd-export-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.pdd-export-menu { position: absolute; top: calc(100% + 4px); right: 0; z-index: 60; min-width: 190px; background: #1c1c24; border: 1px solid var(--border, #444); border-radius: 6px; box-shadow: 0 8px 20px rgba(0, 0, 0, 0.35); padding: 4px; display: flex; flex-direction: column; }
.pdd-export-item { display: flex; justify-content: space-between; gap: 12px; padding: 7px 9px; border: none; background: none; color: var(--text, #eee); font-size: 12px; text-align: left; cursor: pointer; border-radius: 4px; }
.pdd-export-item:hover { background: var(--accent, #6366f1); color: #fff; }
.pdd-export-desc { font-size: 11px; color: var(--text-muted, #888); }
.pdd-export-item:hover .pdd-export-desc { color: rgba(255, 255, 255, 0.8); }
.pdd-export-msg { font-size: 11px; color: var(--accent, #a5b4fc); white-space: nowrap; }

.pdd-scroll { flex: 1; overflow-y: auto; padding: 14px 16px; display: flex; flex-direction: column; gap: 12px; }
.pdd-scroll::-webkit-scrollbar { width: 8px; }
.pdd-scroll::-webkit-scrollbar-thumb { background: #2e3742; border-radius: 4px; }

.pdd-card {
  background: var(--bg-tertiary, #1e1e1e);
  border: 1px solid var(--border, #333);
  border-radius: 10px;
  padding: 14px;
}
.pdd-sec-title { font-size: 13px; font-weight: 800; color: #dbe7e4; margin-bottom: 10px; }
.pdd-empty { padding: 6px 0; font-size: 12px; color: var(--text-muted, #666); }

.pdd-overview { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.pdd-ov-item { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 8px 4px; border-radius: 8px; background: var(--bg-secondary, #272730); }
.pdd-l { font-size: 11px; color: var(--text-muted, #888); }
.pdd-v { font-size: 15px; font-weight: 800; color: #f2f5f4; font-variant-numeric: tabular-nums; }
.pdd-v b { font-weight: 800; }
.pdd-v.badge { font-size: 13px; padding: 2px 8px; border-radius: 4px; white-space: nowrap; }
.pdd-v.badge-high { background: #1a6b3c; color: #4ade80; }
.pdd-v.badge-mid { background: #6b5b1a; color: #facc15; }
.pdd-v.badge-low { background: #6b1a1a; color: #f87171; }

.pdd-kv { display: flex; flex-direction: column; gap: 7px; }
.pdd-kv-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 12px; }
.pdd-k { color: var(--text-muted, #888); flex-shrink: 0; }
.pdd-kv-row .pdd-v { font-size: 13px; }

.pdd-abilities { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.pdd-ab { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 8px 4px; border-radius: 8px; background: var(--bg-secondary, #242730); }
.pdd-ab .pdd-v { font-size: 16px; }

.pdd-chips { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 8px; }
.pdd-chip { display: inline-flex; align-items: center; gap: 2px; padding: 2px 8px; border-radius: 4px; background: rgba(165, 180, 252, 0.12); border: 1px solid rgba(165, 180, 252, 0.2); font-size: 11px; color: #a5b4fc; font-weight: 600; }

.pdd-champ-list { display: flex; flex-direction: column; gap: 6px; }
.pdd-champ { display: flex; align-items: center; gap: 10px; padding: 5px 7px; background: rgba(255, 255, 255, 0.04); border-radius: 6px; }
.pdd-cinfo { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.pdd-cn { font-size: 13px; font-weight: 700; color: #e5e7eb; }
.pdd-cn em { font-style: normal; margin-left: 6px; font-size: 10px; font-weight: 600; color: var(--text-muted, #999); }
.pdd-cs { font-size: 11px; color: var(--text-muted, #888); }
.pdd-cs b { font-weight: 800; }

.sc-high { color: #4ade80; }
.sc-mid { color: #60a5fa; }
.sc-low { color: #f87171; }
.ab-high { color: #4ade80; }
.ab-mid { color: #60a5fa; }
.ab-low { color: #f87171; }
.ld-damage { color: #fb923c; }
.ld-mitigation { color: #60a5fa; }
.ld-assist { color: #4ade80; }
</style>

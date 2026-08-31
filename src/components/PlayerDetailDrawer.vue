<script setup lang="ts">
import { ref } from "vue"
import { Download, UserRound, X } from "lucide-vue-next"
import { save } from "@tauri-apps/plugin-dialog"
import { toBlob } from "html-to-image"
import type { ChampionSummaryItem } from "../types"
import { saveExportFile } from "../api"
import { buildWhiteExportRoot, ensureExportExtension, EXPORT_PRESETS, sanitizeFilename, type ExportPreset } from "../exportUtil"
import type { DrawerPlayer } from "../playerDetailTypes"
import PlayerDetailCards from "./PlayerDetailCards.vue"

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

function exportFileName(preset: ExportPreset) {
  const range = sanitizeFilename(props.rangeText || "玩家详情")
  return `玩家详情_${sanitizeFilename(props.player.gameName)}_${sanitizeFilename(props.player.tagLine)}_${range}_${preset.ratio}x.${preset.ext}`
}

function buildExportRoot(): HTMLElement | null {
  const source = exportRef.value
  if (!source) return null
  const range = props.rangeText || ""
  return buildWhiteExportRoot(
    source,
    `玩家详情 · ${props.player.gameName}#${props.player.tagLine}${range ? ` · ${range}` : ""}`,
  )
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
                <button v-for="p in EXPORT_PRESETS" :key="p.key" class="pdd-export-item" @click="exportImage(p)">
                  <span>{{ p.label }}</span>
                  <span class="pdd-export-desc">{{ p.type === "image/png" ? "无损" : p.type === "image/jpeg" ? "体积小" : "平衡" }}</span>
                </button>
              </div>
            </div>
            <button class="pdd-close" @click="emit('close')" title="关闭"><X :size="18" /></button>
          </div>
        </div>

        <div ref="exportRef" class="pdd-scroll">
          <PlayerDetailCards :player="player" :champions="champions" />
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
</style>

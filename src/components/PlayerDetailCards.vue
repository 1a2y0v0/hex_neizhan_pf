<script setup lang="ts">
import { computed } from "vue"
import type { ChampionSummaryItem } from "../types"
import { championName } from "../utils"
import { profileScoreLevel } from "../playerProfile"
import { scoreEvaluationLabel } from "../scoring"
import type { DrawerChampProfile, DrawerPlayer } from "../playerDetailTypes"
import ChampionAvatar from "./ChampionAvatar.vue"

const props = defineProps<{
  player: DrawerPlayer
  champions: Record<number, ChampionSummaryItem>
}>()

const HONOR_ORDER = ["MVP", "伤害王", "承伤王", "助攻王", "经济王", "KDA王", "控场王"]

function winRate(p: DrawerPlayer) {
  return p.gamesPlayed > 0 ? (p.wins / p.gamesPlayed) * 100 : 0
}
function scoreClass(s: number) { return s >= 80 ? "sc-high" : s >= 60 ? "sc-mid" : "sc-low" }
function kdaClass(s: number) { return s >= 4 ? "sc-high" : s >= 2.5 ? "sc-mid" : "sc-low" }
function abilityClass(s: number) { return s >= 80 ? "ab-high" : s >= 60 ? "ab-mid" : "ab-low" }
function winRateClass(v: number) { return v >= 60 ? "sc-high" : v >= 50 ? "sc-mid" : "sc-low" }
function weightedProp(p: DrawerPlayer, fn: (cp: DrawerChampProfile) => number) {
  const total = p.championProfiles.reduce((s, cp) => s + cp.games, 0)
  return total ? p.championProfiles.reduce((s, cp) => s + fn(cp) * cp.games, 0) / total : 0
}
function formatDate(ts: number) {
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(ts))
}

const honors = computed(() =>
  HONOR_ORDER.filter((h) => (props.player.honors[h] || 0) > 0),
)
/** 最近 5 局（按时间升序，最后一局为最新） */
const recentGames = computed(() =>
  [...props.player.trend].sort((a, b) => a.gameCreation - b.gameCreation).slice(-5),
)
</script>

<template>
  <div class="pdc">
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

    <section v-if="recentGames.length" class="pdd-card">
      <div class="pdd-sec-title">最近 5 局</div>
      <div class="pdd-recent-list">
        <div
          v-for="(g, i) in recentGames"
          :key="`${g.gameCreation}-${i}`"
          class="pdd-recent"
          :class="[g.win ? 'win' : 'loss', { latest: i === recentGames.length - 1 }]"
          :title="`${formatDate(g.gameCreation)} · 评分 ${g.score.toFixed(0)} · ${g.win ? '胜' : '负'}`"
        >
          <span class="pdd-recent-res">{{ g.win ? '胜' : '负' }}</span>
          <span class="pdd-recent-score" :class="scoreClass(g.score)">{{ g.score.toFixed(0) }}</span>
        </div>
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

    <section v-if="player.profile.roleDistribution.length" class="pdd-card">
      <div class="pdd-sec-title">位置分布<span v-if="player.profile.mainRoleLabel" class="pdd-sec-sub">主定位 · {{ player.profile.mainRoleLabel }}</span></div>
      <div class="pdd-role-list">
        <div v-for="role in player.profile.roleDistribution" :key="role.label" class="pdd-role-row">
          <span class="pdd-role-label">{{ role.label }}</span>
          <div class="pdd-role-track">
            <div class="pdd-role-fill" :style="{ width: (role.rate * 100) + '%' }"></div>
          </div>
          <span class="pdd-role-meta">{{ role.games }}场 · <b :class="winRateClass(role.winRate * 100)">{{ (role.winRate * 100).toFixed(0) }}%</b></span>
        </div>
      </div>
    </section>

    <section class="pdd-card">
      <div class="pdd-sec-title">效率与占比</div>
      <div class="pdd-kv">
        <div class="pdd-kv-row"><span class="pdd-k">分均经济</span><span class="pdd-v"><b>{{ player.avgGpm.toFixed(0) }}</b></span></div>
        <div class="pdd-kv-row"><span class="pdd-k">分均伤害</span><span class="pdd-v"><b>{{ player.avgDpm.toFixed(0) }}</b></span></div>
        <div class="pdd-kv-row"><span class="pdd-k">分均补刀</span><span class="pdd-v"><b>{{ player.avgCspm.toFixed(1) }}</b></span></div>
        <div class="pdd-kv-row"><span class="pdd-k">参团率</span><span class="pdd-v"><b>{{ (player.avgKp * 100).toFixed(0) }}%</b></span></div>
        <div class="pdd-kv-row"><span class="pdd-k">击杀占比</span><span class="pdd-v"><b>{{ (player.avgKillShare * 100).toFixed(0) }}%</b></span></div>
        <div class="pdd-kv-row"><span class="pdd-k">承伤每死</span><span class="pdd-v"><b>{{ player.avgMitigationPerDeath.toFixed(1) }}</b></span></div>
        <div class="pdd-kv-row"><span class="pdd-k">伤害占比</span><span class="pdd-v"><b>{{ (weightedProp(player, (cp) => cp.averageDamageShare) * 100).toFixed(1) }}%</b></span></div>
        <div class="pdd-kv-row"><span class="pdd-k">承伤占比</span><span class="pdd-v"><b>{{ (weightedProp(player, (cp) => cp.averageMitigationShare) * 100).toFixed(1) }}%</b></span></div>
        <div class="pdd-kv-row"><span class="pdd-k">治疗/护盾占比</span><span class="pdd-v"><b>{{ (weightedProp(player, (cp) => cp.averageHealingShare) * 100).toFixed(1) }}%</b></span></div>
        <div class="pdd-kv-row"><span class="pdd-k">伤转</span><span class="pdd-v"><b>{{ (weightedProp(player, (cp) => cp.averageDamageConversion) * 100).toFixed(1) }}%</b></span></div>
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

    <section v-if="player.killMap.length" class="pdd-card">
      <div class="pdd-sec-title">击杀分布</div>
      <div class="pdd-kv">
        <div v-for="v in player.killMap" :key="v.puuid" class="pdd-kv-row" :title="`对位 ${v.games} 场 · 场均击杀 = 击杀数 ÷ 对位场次`">
          <span class="pdd-k">{{ v.name }}</span>
          <span class="pdd-v"><b class="sc-high">{{ v.kills }}</b> 杀 · 场均 <b>{{ v.avgKills.toFixed(2) }}</b><template v-if="v.assists"> · <b>{{ v.assists }}</b> 助</template></span>
        </div>
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
</template>

<style scoped>
.pdc { display: flex; flex-direction: column; gap: 12px; }

.pdd-card {
  background: var(--bg-tertiary, #1e1e1e);
  border: 1px solid var(--border, #333);
  border-radius: 10px;
  padding: 14px;
}
.pdd-sec-title { font-size: 13px; font-weight: 800; color: #dbe7e4; margin-bottom: 10px; display: flex; align-items: baseline; gap: 8px; }
.pdd-sec-sub { margin-left: auto; font-size: 11px; font-weight: 400; color: var(--text-muted, #666); }
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

/* 最近 5 局 */
.pdd-recent-list { display: flex; gap: 6px; }
.pdd-recent { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 7px 4px; border-radius: 6px; border: 1px solid; }
.pdd-recent.win { background: rgba(74, 222, 128, 0.1); border-color: rgba(74, 222, 128, 0.4); }
.pdd-recent.loss { background: rgba(248, 113, 113, 0.1); border-color: rgba(248, 113, 113, 0.4); }
.pdd-recent.latest { box-shadow: 0 0 0 1.5px var(--accent, #818cf8); }
.pdd-recent-res { font-size: 11px; font-weight: 800; }
.pdd-recent.win .pdd-recent-res { color: #4ade80; }
.pdd-recent.loss .pdd-recent-res { color: #f87171; }
.pdd-recent-score { font-size: 12px; font-weight: 800; font-variant-numeric: tabular-nums; }

/* 位置分布 */
.pdd-role-list { display: flex; flex-direction: column; gap: 6px; }
.pdd-role-row { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.pdd-role-label { width: 56px; text-align: right; color: #9fb3ae; flex-shrink: 0; }
.pdd-role-track { flex: 1; height: 8px; border-radius: 4px; background: #262a33; overflow: hidden; }
.pdd-role-fill { height: 100%; background: #6366f1; border-radius: 4px; }
.pdd-role-meta { width: 96px; text-align: right; color: var(--text-muted, #888); flex-shrink: 0; }
.pdd-role-meta b { font-weight: 800; }

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

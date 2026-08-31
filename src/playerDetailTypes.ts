/** 玩家详情抽屉 / 批量导出共用的结构化类型（由 PlayerRating 结构兼容）。 */
export interface DrawerChampProfile {
  championId: number
  games: number
  averageScore: number
  averageDamageShare: number
  averageDamageConversion: number
  averageMitigationShare: number
  averageHealingShare: number
  label: string
}

export interface DrawerPlayer {
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
    mainRoleLabel: string
    roleDistribution: { label: string; games: number; wins: number; rate: number; winRate: number }[]
    tags: string[]
    abilities: {
      carry: { averageScore: number }
      frontline: { averageScore: number }
      support: { averageScore: number }
    }
  }
  trend: { win: boolean; gameCreation: number; score: number }[]
  championProfiles: DrawerChampProfile[]
}

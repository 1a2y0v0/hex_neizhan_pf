# 会话交接文档

## 项目与仓库
- 项目根目录：`D:\lol_zhanji_exe\lol-stats`
- 当前分支：`main`
- 远端：`https://github.com/1a2y0v0/hex_neizhan_pf.git`
- 技术栈：Tauri 2 + Rust + Vue 3 + TypeScript + Vite + SQLite
- 主要工作区域：内战评分模块（`src/components/CustomGameRatingPanel.vue` + 其子组件）

## 本次会话已完成的修改

### 1. 数据可视化扩展
- 新组件 `src/components/RatingChartsSection.vue`，从 2 个条形图扩到 5 个图表块：
  - 玩家综合分、玩家胜率榜、英雄出场 TOP（悬停提示、点击定位评分表行）
  - 评分 × 胜率散点图（SVG 坐标轴 + 气泡大小=场次 + 悬停吸附）
  - 蓝红方胜场对比
- 点击图表 emit `focus-player` → 父组件打开玩家详情抽屉并滚动定位评分表行。

### 2. 选手对比增强
- 新组件 `src/components/PlayerCompareSection.vue`：
  - 能力雷达叠加图（A 靛蓝 / B 琥珀，六维归一化，顶点悬停看原始值）
  - 逐项指标对比条形图（12 项，优势高亮、场均死亡反向）
  - 交手记录（同队/对位场次与胜率 + 最近 10 局明细）
  - A/B 选择防重（选同一人自动错开）

### 3. 玩家状态趋势重绘
- 新组件 `src/components/PlayerTrendSection.vue`：
  - 补齐 Y 轴刻度/网格线与轴名、X 轴对局序号（稀疏标注）
  - 悬停吸附最近点：竖参考线 + 放大圆点 + tooltip（时间/时长/英雄/KDA/胜负/指标值）
  - 点击数据点 → `focus-game`：父组件展开并滚动到对局列表对应卡片
  - 指标切换（评分/KDA/伤害占比/分均伤害，Y 轴标尺联动）+ 5 局滑动均线
- `playerRatings` 的 `trend` 字段升级为富 `TrendPoint`（含 gameId/英雄/KDA/伤占/DPM 等）。

### 4. 英雄详情抽屉增强
- `ChampionDetailDrawer.vue`：
  - 对局明细行直接显示玩家名、可点击、选中高亮
  - 行内评分统一为真实单局评分（`calculateOutputRating`）
  - "出场日期"分组改为 `年/月/日` 格式（如 2026/8/31）
- 新组件 `GameDetailPopup.vue`：点击明细行在侧边栏左侧弹出本局十人详情（MVP/双方均分/装备/符文/海克斯/切C/伤转/评分），点击其它行切换，再点当前行或 × 关闭；海克斯两列网格 + 固定 48px 行高防跳动。

### 5. 玩家详情侧边栏
- 新组件 `PlayerDetailDrawer.vue`：点击玩家评分表行打开右侧持久抽屉（点击空白处关闭），内容含概览/评级/战绩 KDA/能力/效率/荣誉与榜首/标签/英雄详情。
- 抽屉头部支持"导出图片"（PNG/JPEG/WebP × 2x/3x，白底导出，与评分表导出同款实现）。
- 原鼠标悬停浮卡（row-hover-card）已删除。

### 6. 评分表精简
- 直接移除"标签"与"荣誉"两列（信息保留在玩家详情抽屉与荣誉墙）。
- "展开详细"与"展开效率"默认开启。
- 顶部新增快速时间范围下拉：今日（默认）/ 本周 / 本月 / 三个月内 / 全部对局（近5个月），切换后立即刷新；手动改日期自动显示"自定义"。

## 关键文件
- `src/components/CustomGameRatingPanel.vue`（主面板，~2600 行）
- `src/components/RatingChartsSection.vue` / `PlayerCompareSection.vue` / `PlayerTrendSection.vue`
- `src/components/ChampionDetailDrawer.vue` / `GameDetailPopup.vue` / `PlayerDetailDrawer.vue` / `PlayerRadarPanel.vue`
- 后端：`src-tauri/src/services/stats.rs`（`load_today_custom_games`）、`src-tauri/src/commands.rs`

## 构建与运行
- 前端类型检查（无需提权）：`node node_modules\vue-tsc\bin\vue-tsc.js --noEmit`
- **exe 必须用 `npm run tauri build`**：裸 `cargo build --release` 产物是开发模式二进制，会去连 `localhost:1420` 导致"无法访问此页面"。`tauri build` 会先跑 `npm run build` 再嵌入 dist 并打 NSIS 包。
- 打包前必须设置 LIB（普通 PowerShell 的 LIB 为空）：
  ```powershell
  $sdk='C:\Program Files (x86)\Windows Kits\10\Lib\10.0.26100.0'
  $msvc='C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC\14.44.35207\lib\x64'
  $env:LIB = "$sdk\um\x64;$sdk\ucrt\x64;$msvc;$env:LIB"
  ```
- **打包前必须关闭正在运行的 lol-stats.exe**（运行中的 exe 锁文件会导致链接失败）。
- 产物：`src-tauri\target\release\lol-stats.exe`；安装包 `src-tauri\target\release\bundle\nsis\`
- 已知无害警告：`stats.rs:143` 的 `unused_mut`。

## 环境备忘
- git 需要 `-c safe.directory=D:/lol_zhanji_exe/lol-stats` 前缀（仓库 owner 是 BUILTIN\Administrators，当前用户是 COMPUTER\Administrator；写全局 .gitconfig 可能被沙箱拒绝）。
- 本会话在 DSH 沙箱中运行：`npm.cmd`/`cargo` 等外部程序启动可能被拦，需要提权重试；`node` 可直接运行。
- `npm.ps1` 包装器在部分 PowerShell 环境下报 `$LASTEXITCODE` 错误，优先用 `npm.cmd` 或直接 `node`。
- 编译/打包输出走 stderr 时 PowerShell 会以 exit 1 结束，属误报；以日志中的 "Finished release" / "✓ built" 为准。

## 如果新对话继续做，建议先确认
1. `git -c safe.directory=D:/lol_zhanji_exe/lol-stats status` 是否干净。
2. 是否在 `main` 分支。
3. 打包前：设 LIB、关闭正在运行的 lol-stats.exe、用 `npm run tauri build`。
4. 主要改动集中在 `src/components/` 下的内战评分相关组件。

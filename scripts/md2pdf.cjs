// 将 docs/内战评分使用指南.md 转成 PDF（打印优化 HTML + Edge 无头模式打印）
// 用法：node scripts/md2pdf.cjs [输入md] [输出pdf]
const fs = require("fs")
const path = require("path")
const { spawnSync } = require("child_process")
const { convertMarkdown, renderStandaloneHtml } = require("./md2html.cjs")

const root = path.join(__dirname, "..")
const src = process.argv[2] || path.join(root, "docs", "内战评分使用指南.md")
const pdfPath = process.argv[3] || path.join(root, "docs", "内战评分使用指南.pdf")
const htmlPath = path.join(root, ".tmp-guide.html")

const body = convertMarkdown(fs.readFileSync(src, "utf8"))
fs.writeFileSync(htmlPath, renderStandaloneHtml(body), "utf8")

const edgeCandidates = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
]
const edge = edgeCandidates.find((p) => fs.existsSync(p))
if (!edge) {
  console.error("未找到 Microsoft Edge，无法生成 PDF")
  fs.unlinkSync(htmlPath)
  process.exit(1)
}

const url = "file:///" + htmlPath.replace(/\\/g, "/")
const result = spawnSync(
  edge,
  [
    "--headless",
    "--disable-gpu",
    "--disable-extensions",
    "--no-pdf-header-footer",
    "--virtual-time-budget=8000",
    `--print-to-pdf=${pdfPath}`,
    url,
  ],
  { stdio: "inherit", timeout: 120000 },
)

fs.unlinkSync(htmlPath)
if (result.error || !fs.existsSync(pdfPath)) {
  console.error("PDF 生成失败：", result.error || "未产出文件")
  process.exit(1)
}
console.log("written:", pdfPath, "bytes:", fs.statSync(pdfPath).size)

// 将 docs/内战评分使用指南.md 转成 Word 兼容的 .doc（HTML 格式，Word/WPS 均可打开）
// 用法：node scripts/md2doc.cjs
const fs = require("fs")
const path = require("path")

const src = path.join(__dirname, "..", "docs", "内战评分使用指南.md")
const out = path.join(__dirname, "..", "docs", "内战评分使用指南.doc")

const text = fs.readFileSync(src, "utf8")
const lines = text.split(/\r?\n/)

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

function inline(s) {
  let t = escapeHtml(s)
  t = t.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
  t = t.replace(/`([^`]+)`/g, '<span style="font-family:Consolas,monospace;background:#f3f4f6;padding:0 3px;">$1</span>')
  return t
}

function isTableSep(line) {
  return /^\s*\|?[\s:\-|]+\|?\s*$/.test(line) && line.includes("-")
}

const html = []
html.push("<p>")
let inList = false
let listTag = ""

function closeList() {
  if (inList) {
    html.push(`</${listTag}>`)
    inList = false
  }
}

let i = 0
while (i < lines.length) {
  const raw = lines[i]
  const line = raw.trim()

  // 表格：连续的 | 行 + 分隔行
  if (line.startsWith("|") && i + 1 < lines.length && isTableSep(lines[i + 1].trim())) {
    closeList()
    const header = line.split("|").slice(1, -1).map((c) => c.trim())
    const rows = []
    i += 2
    while (i < lines.length && lines[i].trim().startsWith("|")) {
      rows.push(lines[i].trim().split("|").slice(1, -1).map((c) => c.trim()))
      i++
    }
    html.push('<table border="1" cellspacing="0" cellpadding="4">')
    html.push("<tr>" + header.map((c) => `<th>${inline(c)}</th>`).join("") + "</tr>")
    for (const r of rows) {
      html.push("<tr>" + r.map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>")
    }
    html.push("</table>")
    continue
  }

  if (line === "---") {
    closeList()
    html.push("<hr/>")
    i++
    continue
  }
  if (line.startsWith("### ")) {
    closeList()
    html.push(`<h3>${inline(line.slice(4))}</h3>`)
    i++
    continue
  }
  if (line.startsWith("## ")) {
    closeList()
    html.push(`<h2>${inline(line.slice(3))}</h2>`)
    i++
    continue
  }
  if (line.startsWith("# ")) {
    closeList()
    html.push(`<h1>${inline(line.slice(2))}</h1>`)
    i++
    continue
  }
  if (line.startsWith("> ")) {
    closeList()
    html.push(`<div style="border-left:4px solid #6366f1;background:#eef2ff;padding:6px 12px;margin:8px 0;">${inline(line.slice(2))}</div>`)
    i++
    continue
  }
  if (line.startsWith("- ")) {
    if (!inList) {
      listTag = "ul"
      html.push("<ul>")
      inList = true
    }
    html.push(`<li>${inline(line.slice(2))}</li>`)
    i++
    continue
  }

  // 普通段落
  closeList()
  if (line === "") {
    html.push("<p>&nbsp;</p>")
  } else {
    html.push(`<p>${inline(line)}</p>`)
  }
  i++
}
closeList()

const doc = `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->
<title>LOL Stats 内战评分模块使用指南</title>
<style>
body { font-family:"Microsoft YaHei","微软雅黑",SimSun,sans-serif; font-size:11pt; line-height:1.65; color:#111827; }
h1 { font-size:20pt; color:#111827; margin:0 0 14px; }
h2 { font-size:15pt; color:#4f46e5; border-bottom:1px solid #d1d5db; padding-bottom:4px; margin:22px 0 10px; }
h3 { font-size:13pt; color:#111827; margin:14px 0 6px; }
p { margin:6px 0; }
ul { margin:6px 0 6px 22px; }
table { border-collapse:collapse; width:100%; margin:10px 0; }
th, td { border:1px solid #9ca3af; padding:5px 8px; font-size:10pt; text-align:left; vertical-align:top; }
th { background:#eef2ff; font-weight:bold; }
hr { border:none; border-top:1px solid #d1d5db; margin:16px 0; }
</style>
</head>
<body>
${html.join("\n")}
</body>
</html>
`

fs.writeFileSync(out, doc, "utf8")
console.log("written:", out, "bytes:", Buffer.byteLength(doc, "utf8"))

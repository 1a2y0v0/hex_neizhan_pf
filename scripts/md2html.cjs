// 内战评分使用指南：Markdown → HTML 转换共享模块（供 .doc 与 .pdf 生成复用）
const fs = require("fs")

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

/** Markdown 文本 → 正文 HTML（标题/表格/列表/引用/加粗/行内代码） */
function convertMarkdown(text) {
  const lines = text.split(/\r?\n/)
  const html = []
  let inList = false
  let listTag = "ul"

  const closeList = () => {
    if (inList) {
      html.push(`</${listTag}>`)
      inList = false
    }
  }

  let i = 0
  while (i < lines.length) {
    const raw = lines[i]
    const line = raw.trim()

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

    closeList()
    if (line === "") {
      html.push("<p>&nbsp;</p>")
    } else {
      html.push(`<p>${inline(line)}</p>`)
    }
    i++
  }
  closeList()
  return html.join("\n")
}

const BASE_STYLE = `
body { font-family:"Microsoft YaHei","微软雅黑",SimSun,sans-serif; font-size:11pt; line-height:1.65; color:#111827; }
h1 { font-size:20pt; color:#111827; margin:0 0 14px; }
h2 { font-size:15pt; color:#4f46e5; border-bottom:1px solid #d1d5db; padding-bottom:4px; margin:22px 0 10px; page-break-after:avoid; }
h3 { font-size:13pt; color:#111827; margin:14px 0 6px; page-break-after:avoid; }
p { margin:6px 0; }
ul { margin:6px 0 6px 22px; }
table { border-collapse:collapse; width:100%; margin:10px 0; }
th, td { border:1px solid #9ca3af; padding:5px 8px; font-size:10pt; text-align:left; vertical-align:top; }
th { background:#eef2ff; font-weight:bold; }
tr { page-break-inside:avoid; }
hr { border:none; border-top:1px solid #d1d5db; margin:16px 0; }
`

/** Word 兼容 .doc（HTML + Word 命名空间） */
function renderWordDoc(body) {
  return `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->
<title>LOL Stats 内战评分模块使用指南</title>
<style>${BASE_STYLE}</style>
</head>
<body>
${body}
</body>
</html>
`
}

/** 独立打印 HTML（供浏览器/Edge 转 PDF） */
function renderStandaloneHtml(body) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>LOL Stats 内战评分模块使用指南</title>
<style>
@page { size: A4; margin: 16mm 14mm; }
${BASE_STYLE}
body { font-size:10.5pt; }
</style>
</head>
<body>
${body}
</body>
</html>
`
}

module.exports = { convertMarkdown, renderWordDoc, renderStandaloneHtml }

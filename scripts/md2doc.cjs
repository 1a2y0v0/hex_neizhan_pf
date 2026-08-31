// 将 docs/内战评分使用指南.md 转成 Word 兼容的 .doc（HTML 格式，Word/WPS 均可打开）
// 用法：node scripts/md2doc.cjs [输入md] [输出doc]
const fs = require("fs")
const path = require("path")
const { convertMarkdown, renderWordDoc } = require("./md2html.cjs")

const src = process.argv[2] || path.join(__dirname, "..", "docs", "内战评分使用指南.md")
const out = process.argv[3] || path.join(__dirname, "..", "docs", "内战评分使用指南.doc")

const body = convertMarkdown(fs.readFileSync(src, "utf8"))
const doc = renderWordDoc(body)
fs.writeFileSync(out, doc, "utf8")
console.log("written:", out, "bytes:", Buffer.byteLength(doc, "utf8"))

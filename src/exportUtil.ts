/** 导出图片相关的通用工具：白底克隆、文件名清洗、图片就绪等待、导出格式预设。 */

export type ExportPreset = {
  key: string
  label: string
  ext: string
  type: string
  ratio: number
  quality?: number
}

export const EXPORT_PRESETS: ExportPreset[] = [
  { key: "png2x", label: "PNG · 2x（无损）", ext: "png", type: "image/png", ratio: 2 },
  { key: "png3x", label: "PNG · 3x（超清）", ext: "png", type: "image/png", ratio: 3 },
  { key: "jpeg2x", label: "JPEG · 2x（体积小）", ext: "jpg", type: "image/jpeg", ratio: 2, quality: 0.92 },
  { key: "jpeg3x", label: "JPEG · 3x（清晰）", ext: "jpg", type: "image/jpeg", ratio: 3, quality: 0.9 },
  { key: "webp2x", label: "WebP · 2x（平衡）", ext: "webp", type: "image/webp", ratio: 2, quality: 0.92 },
  { key: "webp3x", label: "WebP · 3x（清晰）", ext: "webp", type: "image/webp", ratio: 3, quality: 0.9 },
]

export function sanitizeFilename(s: string) {
  const cleaned = s.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim()
  return cleaned || "未命名"
}

export function ensureExportExtension(path: string, ext: string) {
  return path.toLowerCase().endsWith(`.${ext}`) ? path : `${path}.${ext}`
}

/** 克隆源节点并重置为白底黑字导出样式，返回已挂好（未插入文档）的根节点。 */
export function buildWhiteExportRoot(source: HTMLElement, title: string, cardSelector = ".pdd-card"): HTMLElement {
  const root = document.createElement("div")
  root.style.cssText = "position:absolute;left:0;top:0;z-index:-1;background:#ffffff;color:#111827;padding:16px;width:max-content;"
  root.style.fontFamily = getComputedStyle(source).fontFamily || "system-ui, -apple-system, Microsoft YaHei, sans-serif"

  const titleEl = document.createElement("div")
  titleEl.textContent = title
  titleEl.style.cssText = "margin:0 0 12px;font-size:16px;font-weight:700;color:#111827;"
  root.appendChild(titleEl)

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

  const cards = root.querySelectorAll<HTMLElement>(cardSelector)
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

/** 等待节点内所有图片加载完成（失败或超时也放行，导出时会回退为占位）。 */
export async function waitForImages(root: HTMLElement, timeoutMs = 8000): Promise<void> {
  const imgs = Array.from(root.querySelectorAll<HTMLImageElement>("img"))
  if (!imgs.length) return
  const deadline = Date.now() + timeoutMs
  await Promise.all(
    imgs.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete) {
            resolve()
            return
          }
          let timer = 0
          const settle = () => {
            window.clearInterval(timer)
            img.removeEventListener("load", settle)
            img.removeEventListener("error", settle)
            resolve()
          }
          img.addEventListener("load", settle)
          img.addEventListener("error", settle)
          timer = window.setInterval(() => {
            if (img.complete || Date.now() > deadline) settle()
          }, 100)
        }),
    ),
  )
}

/** 最小 ZIP（store 无压缩）打包。PNG 本身已压缩，这里只负责归档。 */

export interface ZipFileEntry {
  name: string
  data: Uint8Array
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function dosDateTime(d: Date): { time: number; date: number } {
  const time = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff
  const date = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff
  return { time, date }
}

const u16 = (v: number) => new Uint8Array([v & 0xff, (v >>> 8) & 0xff])
const u32 = (v: number) => new Uint8Array([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff])

export function buildStoreZip(files: ZipFileEntry[]): Uint8Array {
  const encoder = new TextEncoder()
  const now = new Date()
  const { time, date } = dosDateTime(now)
  const utf8Flag = 0x0800

  const chunks: Uint8Array[] = []
  const central: { nameBytes: Uint8Array; crc: number; size: number; offset: number }[] = []
  let offset = 0

  for (const file of files) {
    const nameBytes = encoder.encode(file.name)
    const crc = crc32(file.data)
    const size = file.data.length

    const local = new Uint8Array([
      ...u32(0x04034b50),
      ...u16(20),
      ...u16(utf8Flag),
      ...u16(0),
      ...u16(time),
      ...u16(date),
      ...u32(crc),
      ...u32(size),
      ...u32(size),
      ...u16(nameBytes.length),
      ...u16(0),
    ])
    chunks.push(local, nameBytes, file.data)
    central.push({ nameBytes, crc, size, offset })
    offset += local.length + nameBytes.length + size
  }

  let centralSize = 0
  const centralChunks: Uint8Array[] = []
  for (const c of central) {
    const hdr = new Uint8Array([
      ...u32(0x02014b50),
      ...u16(20),
      ...u16(20),
      ...u16(utf8Flag),
      ...u16(0),
      ...u16(time),
      ...u16(date),
      ...u32(c.crc),
      ...u32(c.size),
      ...u32(c.size),
      ...u16(c.nameBytes.length),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(0),
      ...u32(c.offset),
    ])
    centralChunks.push(hdr, c.nameBytes)
    centralSize += hdr.length + c.nameBytes.length
  }

  const eocd = new Uint8Array([
    ...u32(0x06054b50),
    ...u16(0),
    ...u16(0),
    ...u16(files.length),
    ...u16(files.length),
    ...u32(centralSize),
    ...u32(offset),
    ...u16(0),
  ])

  const all = [...chunks, ...centralChunks, eocd]
  const out = new Uint8Array(offset + centralSize + eocd.length)
  let pos = 0
  for (const chunk of all) {
    out.set(chunk, pos)
    pos += chunk.length
  }
  return out
}

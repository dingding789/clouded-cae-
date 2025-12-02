import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
// 脚本位于 frd-viewer/scripts；anli 文件夹与 frd-viewer 同级（因此使用相对路径 ../anli）
const frdPath = path.resolve(__dirname, '..', '..', 'anli', '_Kasten.frd')
const inpPath = path.resolve(__dirname, '..', '..', 'anli', '_Kasten.inp')

async function main() {
  try {
    const [frdText, inpText] = await Promise.all([
      fs.readFile(frdPath, 'utf8'),
      fs.readFile(inpPath, 'utf8')
    ])
  // 快速解析 INP：收集节点 id 和单元 id
    const inpLines = inpText.split(/\r?\n/)
    const nodes = []
    const nodeIdSet = new Set()
    const elements = []
    const elIdSet = new Set()
    let inNode = false
    let curEl = null
    for (const raw of inpLines) {
      if (!raw) continue
      const L = raw.trim()
      if (!L) continue
      if (L.startsWith('*')) {
        const up = L.toUpperCase()
        inNode = up.startsWith('*NODE')
        curEl = up.startsWith('*ELEMENT') ? up : null
        continue
      }
      if (inNode) {
        const parts = L.split(',').map(s => s.trim())
        const id = parseInt(parts[0], 10)
        if (!Number.isNaN(id)) { nodes.push(id); nodeIdSet.add(id) }
        continue
      }
      if (curEl) {
        const parts = L.split(',').map(s => s.trim()).filter(Boolean)
        const id = parseInt(parts[0], 10)
        if (!Number.isNaN(id)) {
          elements.push({ id, nodes: parts.slice(1).map(p => parseInt(p,10)).filter(n => !Number.isNaN(n)) })
          elIdSet.add(id)
        }
      }
    }

  // 扫描 FRD：把连续的 -1 行分组为块，并把每个块之前的非数据行作为 header
    const lines = frdText.split(/\r?\n/)
    const nodeRegex = /^\s*-1\s+(\d+)\s+([\-\d.Ee+]+)\s+([\-\d.Ee+]+)\s+([\-\d.Ee+]+)/
    const blocks = []
    let current = null
    let lastHeader = null
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]
      const m = l.match(nodeRegex)
      if (m) {
        const id = parseInt(m[1],10)
        const a = parseFloat(m[2])
        const b = parseFloat(m[3])
        const c = parseFloat(m[4])
        if (!current) current = { header: lastHeader || '', rows: [] }
        current.rows.push({ id, a, b, c })
      } else {
        if (current) { blocks.push(current); current = null }
        const t = l.trim()
        if (t) lastHeader = t
      }
    }
    if (current) blocks.push(current)

  // 对每个块分类：如果块内大多数 id 在 nodeIdSet 中，则视为节点型数据；否则可能为单元型
    const fields = blocks.map((blk, i) => {
      const header = blk.header || ''
      let nodeHits = 0
      let elHits = 0
      for (const r of blk.rows) {
        if (nodeIdSet.has(r.id)) nodeHits++
        if (elIdSet.has(r.id)) elHits++
      }
  // 基于 header 的基本分类
      const isDisp = /\bU\b|UX|UY|UZ|DISP|DISPLAC/i.test(header)
      const isStress = /\bS\b|STRESS|SIGMA|VMISES|EQUIV/i.test(header)
      const majorityNode = nodeHits >= Math.floor(blk.rows.length*0.5)
      return { index: i, header, rows: blk.rows.length, nodeHits, elHits, isDisp, isStress, majorityNode }
    })

    console.log('INP: nodes=', nodes.length, 'elements=', elements.length)
    console.log('FRD: found blocks=', blocks.length)
    const sample = fields.slice(0, 50)
    sample.forEach(f => {
      console.log(`block[${f.index}] rows=${f.rows} nodeHits=${f.nodeHits} elHits=${f.elHits} disp=${f.isDisp} stress=${f.isStress} majorityNode=${f.majorityNode} header="${f.header.slice(0,80)}"`)
    })

  // 查找是否存在较大的节点型数据块（用于快速定位节点坐标块）
    const largeNodeBlocks = fields.filter(f => f.majorityNode && f.rows > 100)
    console.log('Large node-based blocks (rows>100):', largeNodeBlocks.length)
    largeNodeBlocks.slice(0,10).forEach(f => console.log(` -> block[${f.index}] rows=${f.rows} nodeHits=${f.nodeHits}`))
  } catch (err) {
    console.error('Error:', err && err.stack || err)
    process.exit(1)
  }
}

main()

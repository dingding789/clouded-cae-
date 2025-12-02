//  FRD 解析器草稿：
// - 将连续的 `-1 id a b c` 行视为一个数据块（block），并保留前面的最近一行作为该块的 header，用于识别字段类型（例如位移/应力）
// - 返回结构：{ nodes: [{id,x,y,z}], fields: [{name, header, values, type, scalarValues, min, max}] }
// 这是一个增量实现，遇到特殊变体时会需要微调。

export function parseFrdText (text, inpText) {
  const lines = text.split(/\r?\n/)
  const nodeRegex = /^\s*-1\s+(\d+)\s+([\-\d.Ee+]+)\s+([\-\d.Ee+]+)\s+([\-\d.Ee+]+)/
  // 将连续的数据行分组为块；将每个数据块前面的最后一行非数据行作为该块的 header
  const blocks = []
  let currentBlock = null
  let lastHeader = null

  // 如果提供了 INP 文本，先解析 INP：收集 *NODE 和 *ELEMENT 数据，后续优先使用 INP 中的节点坐标
  let inpNodes = null
  let inpElements = []
  if (inpText && typeof inpText === 'string') {
    const inpLines = inpText.split(/\r?\n/)
    let inNodeSection = false
    let curElType = null
    for (let i = 0; i < inpLines.length; i++) {
      const raw = inpLines[i]
      if (!raw) continue
      const L = raw.trim()
      if (!L) continue
      if (L.startsWith('*')) {
        const up = L.toUpperCase()
        inNodeSection = up.startsWith('*NODE')
        if (up.startsWith('*ELEMENT')) {
          curElType = L
        } else if (!up.startsWith('*ELEMENT')) {
          curElType = null
        }
        continue
      }

      if (inNodeSection) {
        const parts = L.split(',').map(s => s.trim())
        if (parts.length >= 4) {
          if (!inpNodes) inpNodes = []
          const id = parseInt(parts[0], 10)
          const x = parseFloat(parts[1])
          const y = parseFloat(parts[2])
          const z = parseFloat(parts[3])
          if (!Number.isNaN(id)) inpNodes.push({ id, x, y, z })
        }
        continue
      }

      if (curElType) {
        const parts = L.split(',').map(s => s.trim()).filter(Boolean)
        if (parts.length >= 2) {
          const id = parseInt(parts[0], 10)
          const nodesList = parts.slice(1).map(p => parseInt(p, 10)).filter(n => !Number.isNaN(n))
          inpElements.push({ id, type: curElType, nodes: nodesList })
        }
      }
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    const m = l.match(nodeRegex)
    if (m) {
      const id = parseInt(m[1], 10)
      const a = parseFloat(m[2])
      const b = parseFloat(m[3])
      const c = parseFloat(m[4])
      if (!currentBlock) {
        currentBlock = { header: lastHeader || '', rows: [] }
      }
      currentBlock.rows.push({ id, a, b, c })
    } else {
      if (currentBlock) {
        blocks.push(currentBlock)
        currentBlock = null
      }
      const t = l.trim()
      if (t) lastHeader = t
    }
  }
  if (currentBlock) blocks.push(currentBlock)

  // 如果 FRD 中没有 -1 数据块，但我们成功解析了 INP 的节点，则返回 INP 的 nodes/elements，
  // 以支持仅上传 INP 文件的场景（直接显示网格）
  if (blocks.length === 0) {
    if (inpNodes && inpNodes.length > 0) {
      const outNodes = []
      const outIdToIndex = new Map()
      for (let i = 0; i < inpNodes.length; i++) {
        const n = inpNodes[i]
        outNodes.push({ id: n.id, x: n.x, y: n.y, z: n.z })
        outIdToIndex.set(n.id, i)
      }
      const outElements = inpElements || []
      return { nodes: outNodes, fields: [], elements: outElements }
    }
    return { nodes: [], fields: [] }
  }

  // 选择节点列表：优先使用 INP 节点（若存在），否则使用 FRD 中行数最多的数据块作为节点坐标（启发式）
  const nodes = []
  const idToIndex = new Map()
  let nodeBlockIndex = -1
  if (inpNodes && inpNodes.length > 0) {
    for (let i = 0; i < inpNodes.length; i++) {
      const n = inpNodes[i]
      nodes.push({ id: n.id, x: n.x, y: n.y, z: n.z })
      idToIndex.set(n.id, i)
    }
  } else {
  // 选择行数最多的块作为节点坐标（启发式判定）
  nodeBlockIndex = 0
    let maxRows = blocks[0].rows.length
    for (let i = 1; i < blocks.length; i++) {
      if (blocks[i].rows.length > maxRows) {
        maxRows = blocks[i].rows.length
        nodeBlockIndex = i
      }
    }

    const nodeBlock = blocks[nodeBlockIndex]
    for (let i = 0; i < nodeBlock.rows.length; i++) {
      const r = nodeBlock.rows[i]
      nodes.push({ id: r.id, x: r.a, y: r.b, z: r.c })
      idToIndex.set(r.id, i)
    }
  }

  const fields = []
  for (let bi = 0; bi < blocks.length; bi++) {
    if (bi === nodeBlockIndex) continue
    const blk = blocks[bi]
    const header = blk.header || ''
    // 计算该块中和节点/单元 id 的命中数，用于判断是 node-based 还是 element-based
    let nodeHits = 0
    let elHits = 0
    const elIdSet = new Set((inpElements || []).map(e => e.id))
    for (const r of blk.rows) {
      if (idToIndex.has(r.id)) nodeHits++
      if (elIdSet.has(r.id)) elHits++
    }
  // 根据 header 生成友好的显示名
    function prettyHeader(h) {
      if (!h) return ''
      const numRe = /[+-]?\d+(?:\.\d+)?(?:[Ee][+-]?\d+)?/g
      const nums = Array.from(h.matchAll(numRe)).map(m => m[0])
        // 尝试忽略以 -1 开头的数字序列（FRD 行头中的 -1 标记）
      if (nums.length >= 4 && (nums[0] === '-1' || nums[0] === '-1.0')) {
        const id = nums[1]
        const params = nums.slice(2)
        return `id=${id} params=${params.join(',')}`
      }
      if (nums.length > 0) return `nums=${nums.join(',')}`
  // 兜底：压缩连续空白并截取前 80 个字符作为展示名
      return h.replace(/\s+/g, ' ').trim().slice(0, 80)
    }
    let name = header || `field_${bi}`
    const displayName = prettyHeader(header)
    if (/\bU\b|UX|UY|UZ|DISP|DISPLAC/i.test(header)) name = 'displacement'
    else if (/\bS\b|STRESS|SIGMA|VMISES|EQUIV/i.test(header)) name = 'stress'
    else if (/\bE\b|STRAIN/i.test(header)) name = 'strain'

    const values = new Array(nodes.length).fill(null)
  // 另外收集那些没有映射到节点的行 —— 它们可能是按单元(element)给出的值
    const elementRows = new Map()
    const elValues = {} // 按单元的幅值映射：element id -> 幅值（供渲染器按单元着色时使用）
    for (let r of blk.rows) {
      const idx = idToIndex.get(r.id)
      if (idx !== undefined) values[idx] = { id: r.id, a: r.a, b: r.b, c: r.c }
      else elementRows.set(r.id, { id: r.id, a: r.a, b: r.b, c: r.c })
    }

    // 对字段类型进行分类（位移 / 标量 / 应变等），先尝试基于 header
    let type = 'unknown'
    if (/displacement/i.test(name) || /U\b|UX|UY|UZ/i.test(header)) type = 'displacement'
    else if (/stress|sigma|vmises|equiv|s\b/i.test(name) || /STRESS|SIGMA|VMISES/i.test(header)) type = 'scalar'
    else if (/strain/i.test(name)) type = 'scalar'

    let scalarValues = null
    let min = Infinity, max = -Infinity

  // 如果该字段看起来是按单元给出的（映射到节点的数量很少）且我们有单元定义，
  // 则将单元值插值到节点上（采用周围单元的平均值作为该节点的值）
    const nodeHasValueCount = values.reduce((c, v) => c + (v ? 1 : 0), 0)
    if ((nodeHasValueCount < Math.max(1, Math.floor(nodes.length * 0.5))) && elementRows.size > 0 && inpElements && inpElements.length > 0) {
  // 对每个节点累加值与计数（用于把按单元的字段平均到节点）
      const sums = new Array(nodes.length).fill(null).map(() => ({ ax: 0, ay: 0, az: 0, count: 0 }))
  // 构建 element id -> 元素 对照表，方便按 id 查找元素的节点列表
      const elById = new Map(inpElements.map(e => [e.id, e]))
      for (const [eid, row] of elementRows.entries()) {
        let el = elById.get(eid)
        if (!el) {
          // 如果直接按 element id 找不到对应的元素，则延迟处理（可能 FRD 中的 element id 与 INP 中不一一对应）
          // 我们将在后面尝试按排序位置进行降级映射（fallbackMapping）
          continue
        }
        // value for this element (vector)
        const vx = row.a || 0
        const vy = row.b || 0
        const vz = row.c || 0
        for (const nid of el.nodes) {
          const idx = idToIndex.get(nid)
          if (idx === undefined) continue
          sums[idx].ax += vx
          sums[idx].ay += vy
          sums[idx].az += vz
          sums[idx].count += 1
        }
      }
      // 检查是否有 elementRows 未被映射（elById 缺失），如果多数 elementRows 存在但未映射，则尝试按排序位置降级映射
      const unmapped = []
      for (const [eid, row] of elementRows.entries()) {
        if (!elById.has(eid)) unmapped.push({ eid, row })
      }
      if (unmapped.length > 0 && inpElements.length > 0) {
        // 如果有未映射的 elementRows，尝试按位置/排序进行降级映射
        // 这里不再要求 unmapped.length === inpElements.length，而是对两者中较小的数量进行一一对应
        const sortedInp = inpElements.slice().sort((a, b) => a.id - b.id)
        const sortedUn = unmapped.slice().sort((a, b) => a.eid - b.eid)
        const mapCount = Math.min(sortedInp.length, sortedUn.length)
        for (let k = 0; k < mapCount; k++) {
          const el = sortedInp[k]
          const row = sortedUn[k].row
          const vx = row.a || 0
          const vy = row.b || 0
          const vz = row.c || 0
          for (const nid of el.nodes) {
            const idx = idToIndex.get(nid)
            if (idx === undefined) continue
            sums[idx].ax += vx
            sums[idx].ay += vy
            sums[idx].az += vz
            sums[idx].count += 1
          }
        }
      }
      // 记录按单元的幅值（即每个 elementRows 中值的幅度），供渲染器选择按单元着色时使用
      for (const [eid, row] of elementRows.entries()) {
        const vx = row.a || 0
        const vy = row.b || 0
        const vz = row.c || 0
        elValues[eid] = Math.sqrt(vx * vx + vy * vy + vz * vz)
      }
  // 把平均后的单元值写回到 values[]（使每个节点都有一个插值后的字段值）
      for (let i = 0; i < sums.length; i++) {
        if (sums[i].count > 0) {
          values[i] = { id: nodes[i].id, a: sums[i].ax / sums[i].count, b: sums[i].ay / sums[i].count, c: sums[i].az / sums[i].count }
        }
      }
    }

    // 现在基于最终的 values 计算每个节点的幅值（如果有值的话），无论 header 如何
    const hasAnyValueFinal = values.some(v => v != null)
    if (hasAnyValueFinal) {
      scalarValues = new Array(nodes.length).fill(null)
      for (let i = 0; i < values.length; i++) {
        const v = values[i]
        if (!v) continue
        const a = v.a || 0
        const b = v.b || 0
        const c = v.c || 0
        const s = Math.sqrt(a * a + b * b + c * c)
        scalarValues[i] = s
        if (s < min) min = s
        if (s > max) max = s
      }
      if (min === Infinity) { min = 0; max = 0 }
    }

    // 如果解析器无法从 header 判断出类型，但该字段的节点命中数接近总节点数，
    // 很可能这是位移场（每个节点都有三个分量）。我们自动把它标为 displacement。
    try {
      if (type === 'unknown' && nodes.length > 0) {
        if (nodeHits >= Math.max(1, Math.floor(nodes.length * 0.9)) || blk.rows.length === nodes.length) {
          type = 'displacement'
        }
      }
    } catch (e) {
      // ignore
    }

    // 如果 header 无法判断类型（unknown），尝试基于几何尺度的启发式判定：
    // - 计算模型的边界框对角线长度（作为几何尺度）
    // - 若字段幅值的 max 明显小于几何尺度（例如 < 1%），很可能是位移（长度量级）
    // - 若幅值明显大于几何尺度（例如 > 10%），更可能是应力/应变之类的大量值（标量）
    if (type === 'unknown' && scalarValues) {
      try {
        if (nodes && nodes.length > 0) {
          let minx = Infinity, miny = Infinity, minz = Infinity
          let maxx = -Infinity, maxy = -Infinity, maxz = -Infinity
          for (const n of nodes) {
            if (n.x < minx) minx = n.x
            if (n.y < miny) miny = n.y
            if (n.z < minz) minz = n.z
            if (n.x > maxx) maxx = n.x
            if (n.y > maxy) maxy = n.y
            if (n.z > maxz) maxz = n.z
          }
          const dx = maxx - minx
          const dy = maxy - miny
          const dz = maxz - minz
          const diag = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0
          // thresholds chosen conservatively
          if (diag > 0) {
            if (max < diag * 0.01) {
              type = 'displacement'
            } else if (max > diag * 0.1) {
              type = 'scalar'
            }
          }
        }
      } catch (e) {
        // ignore heuristic failures
      }
    }

    const scalarCount = scalarValues ? scalarValues.reduce((c, v) => c + (v != null ? 1 : 0), 0) : 0
    fields.push({ name, header, displayName, values, type, scalarValues, min, max, nodeHits, elHits, rows: blk.rows.length, scalarCount, elValues })
  }

  const elements = inpElements || []

  return { nodes, fields, elements }
}

export default { parseFrdText }

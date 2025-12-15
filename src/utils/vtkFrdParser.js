/**
 * 使用 vtk.js 增强的 FRD 文件解析器
 * 基于成熟的解析逻辑，与原 frdParser 兼容
 * @param {string} frdText - FRD 文件内容
 * @param {string} inpText - INP 文件内容（可选）
 * @returns {Object} { nodes, fields, elements }
 */
export function parseFrdWithVtk(frdText, inpText) {
  // 1. 解析 INP 文件
  let inpNodes = []
  let inpElements = []
  
  if (inpText && typeof inpText === 'string') {
    const inpResult = parseInp(inpText)
    inpNodes = inpResult.nodes
    inpElements = inpResult.elements
  }

  // 如果没有 FRD 内容，只返回 INP
  if (!frdText || frdText.trim().length === 0) {
    return { nodes: inpNodes, fields: [], elements: inpElements }
  }

  // 2. 解析 FRD 块（宽松模式，保留分量信息）
  const lines = frdText.split(/\r?\n/)
  const blocks = []
  let currentBlock = null
  let pendingMeta = null
  let lastHeader = 'Default Header'

  for (let raw of lines) {
    const line = raw.trim()

    if (line.startsWith('-1')) {
      const parts = line.split(/\s+/).filter(Boolean)
      if (parts.length >= 3) {
        const id = parseInt(parts[1], 10)
        const values = parts.slice(2).map(v => parseFloat(v))
        if (!currentBlock) {
          currentBlock = {
            header: pendingMeta ? (pendingMeta.header || lastHeader) : lastHeader,
            compNames: pendingMeta ? pendingMeta.compNames : [],
            nComponents: pendingMeta ? pendingMeta.nComponents : values.length,
            rows: []
          }
        }
        if (!currentBlock.nComponents) currentBlock.nComponents = values.length
        currentBlock.rows.push({ id, values })
      }
      continue
    }

    // 非数据行，结束当前块
    if (currentBlock) {
      blocks.push(currentBlock)
      currentBlock = null
    }

    // 记录字段元数据（-4 行：名称+分量数；-5 行：分量名）
    if (line.startsWith('-4')) {
      const parts = line.split(/\s+/).filter(Boolean)
      pendingMeta = {
        header: parts[1] || lastHeader,
        nComponents: parseInt(parts[2] || '0', 10) || null,
        compNames: []
      }
      lastHeader = pendingMeta.header
      continue
    }

    if (line.startsWith('-5') && pendingMeta) {
      const name = line.substring(3).trim().split(/\s+/)[0]
      if (name) pendingMeta.compNames.push(name)
      continue
    }

    pendingMeta = null
    if (line.length > 2) lastHeader = line
  }
  if (currentBlock) blocks.push(currentBlock)

  // 3. 确定节点
  let nodes = []
  let nodeBlockIndex = -1
  const idToIndex = new Map()

  if (inpNodes.length > 0) {
    nodes = inpNodes
    nodes.forEach((n, i) => idToIndex.set(n.id, i))
  } else {
    // 在 FRD 中找最大行数块作为节点
    let maxRows = -1
    blocks.forEach((b, i) => {
      if (b.rows.length > maxRows) {
        maxRows = b.rows.length
        nodeBlockIndex = i
      }
    })
    if (nodeBlockIndex !== -1) {
      blocks[nodeBlockIndex].rows.forEach((r) => {
        const comps = Array.isArray(r.values) ? r.values : []
        idToIndex.set(r.id, nodes.length)
        nodes.push({
          id: r.id,
          x: comps[0] || 0,
          y: comps[1] || 0,
          z: comps[2] || 0
        })
      })
    }
  }

  // 4. 构建字段
  const fields = []
  blocks.forEach((block, i) => {
    if (i === nodeBlockIndex) return // 跳过节点块
    
    if (!block.rows || block.rows.length === 0) return

    const field = {
      name: block.header,
      displayName: block.header,
      type: 'unknown',
      rows: block.rows.length,
      nComponents: block.nComponents || 0,
      compNames: block.compNames || [],
      values: new Array(nodes.length).fill(null)
    }

    // 填充值
    block.rows.forEach(r => {
      const idx = idToIndex.get(r.id)
      if (idx !== undefined) {
        const comps = Array.isArray(r.values) ? r.values : []
        const a = comps[0] || 0
        const b = comps[1] || 0
        const c = comps[2] || 0
        field.values[idx] = { a, b, c, comps }
      }
    })

    fields.push(field)
  })

  // 5. 后处理字段
  fields.forEach(field => {
    processField(field, nodes, idToIndex, inpElements)
  })

  console.log('[vtkFrdParser] Parsed:', {
    nodes: nodes.length,
    elements: inpElements.length,
    fields: fields.length
  })

  return { nodes, fields, elements: inpElements }
}

/**
 * 解析 INP 文件提取节点和单元
 */
function parseInp(inpText) {
  const lines = inpText.split(/\r?\n/)
  const nodes = []
  const elements = []
  let section = null
  
  for (let line of lines) {
    line = line.trim()
    if (!line) continue
    
    if (line.startsWith('*')) {
      const up = line.toUpperCase()
      if (up.startsWith('*NODE')) section = 'NODE'
      else if (up.startsWith('*ELEMENT')) section = 'ELEMENT'
      else section = null
      continue
    }

    if (section === 'NODE') {
      const parts = line.split(',').map(s => parseFloat(s.trim()))
      if (parts.length >= 4 && !isNaN(parts[0])) {
        nodes.push({ 
          id: parts[0], 
          x: parts[1], 
          y: parts[2], 
          z: parts[3] 
        })
      }
    } else if (section === 'ELEMENT') {
      const parts = line.split(',').map(s => parseInt(s.trim(), 10))
      if (parts.length >= 3 && !isNaN(parts[0])) {
        elements.push({ 
          id: parts[0], 
          nodes: parts.slice(1).filter(n => !isNaN(n))
        })
      }
    }
  }
  
  return { nodes, elements }
}

/**
 * 后处理字段：计算标量、判断类型、计算元素值
 */
function processField(field, nodes, idToIndex, elements) {
  // 判断字段类型（基于名称+分量）
  const nameLower = (field.name || '').toLowerCase()
  const looksLikeStress = /stress|sig|von|mises/.test(nameLower) || (field.compNames || []).some(c => /^s/i.test(c))
  const looksLikeStrain = /strain|eps/.test(nameLower) || (field.compNames || []).some(c => /^e/i.test(c))

  if (/disp|u[xyz]?/.test(nameLower)) {
    field.type = 'displacement'
  } else if (looksLikeStress) {
    field.type = 'stress'
  } else if (looksLikeStrain) {
    field.type = 'strain'
  } else {
    // 根据幅值和模型尺寸做粗判
    let hasNonZero = false
    for (const v of field.values) {
      if (v && (Math.abs(v.a) > 1e-3 || Math.abs(v.b) > 1e-3 || Math.abs(v.c) > 1e-3)) {
        hasNonZero = true
        break
      }
    }
    
    if (hasNonZero) {
      let minx = Infinity, miny = Infinity, minz = Infinity
      let maxx = -Infinity, maxy = -Infinity, maxz = -Infinity
      
      nodes.forEach(n => {
        if (n.x < minx) minx = n.x
        if (n.y < miny) miny = n.y
        if (n.z < minz) minz = n.z
        if (n.x > maxx) maxx = n.x
        if (n.y > maxy) maxy = n.y
        if (n.z > maxz) maxz = n.z
      })
      
      const diag = Math.sqrt(
        (maxx - minx) ** 2 + 
        (maxy - miny) ** 2 + 
        (maxz - minz) ** 2
      )
      
      let maxVal = 0
      for (const v of field.values) {
        if (v) {
          const mag = Math.sqrt(v.a * v.a + v.b * v.b + v.c * v.c)
          if (mag > maxVal) maxVal = mag
        }
      }
      
      if (maxVal < diag * 0.1) {
        field.type = 'displacement'
      } else {
        field.type = 'scalar'
      }
    }
  }
  
  // 计算标量值（应力自动转 von Mises）
  const scalarValues = new Array(nodes.length).fill(null)
  let min = Infinity
  let max = -Infinity
  let count = 0
  let nodeHits = 0
  
  const computeScalar = (v) => {
    if (!v) return null
    const comps = v.comps || []
    if ((field.nComponents === 6 || looksLikeStress) && comps.length >= 6) {
      const [sxx = 0, syy = 0, szz = 0, sxy = 0, syz = 0, szx = 0] = comps
      const vm = Math.sqrt(0.5 * ((sxx - syy) ** 2 + (syy - szz) ** 2 + (szz - sxx) ** 2) + 3 * (sxy * sxy + syz * syz + szx * szx))
      return vm
    }
    if (comps.length >= 3) return Math.sqrt((comps[0] || 0) ** 2 + (comps[1] || 0) ** 2 + (comps[2] || 0) ** 2)
    if (comps.length >= 1) return comps[0]
    return Math.sqrt(v.a * v.a + v.b * v.b + v.c * v.c)
  }
  
  field.values.forEach((v, i) => {
    const magnitude = computeScalar(v)
    if (magnitude == null || !isFinite(magnitude)) return
    
    scalarValues[i] = magnitude
    nodeHits++
    
    if (magnitude < min) min = magnitude
    if (magnitude > max) max = magnitude
    count++
  })
  
  field.scalarValues = scalarValues
  field.min = min === Infinity ? 0 : min
  field.max = max === -Infinity ? 0 : max
  field.scalarCount = count
  field.nodeHits = nodeHits
  
  // 计算单元值
  const elValues = {}
  let elHits = 0
  
  if (elements && elements.length > 0) {
    elements.forEach(el => {
      if (!el.nodes || el.nodes.length === 0) return
      
      let sum = 0
      let validCount = 0
      
      el.nodes.forEach(nid => {
        const idx = idToIndex.get(nid)
        if (idx !== undefined && scalarValues[idx] != null) {
          sum += scalarValues[idx]
          validCount++
        }
      })
      
      if (validCount > 0) {
        elValues[el.id] = sum / validCount
        elHits++
      }
    })
  }
  
  field.elValues = elValues
  field.elHits = elHits
}

export default parseFrdWithVtk

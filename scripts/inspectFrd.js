(() => {
  /**
   * inspectFrd.js
   * 简要说明：
   *  - 该脚本用于快速检查 CalculiX/ccx 生成的 .frd 文件内容结构，定位数据块（以 -1 开头的行段）
   *  - 输出主要包括：检测到的数据块数量、按大小排序的若干数据块（用于定位节点块与字段块）
   *  - 使用启发式规则：把最大的连续数据块视作节点坐标块（node block），其余为可能的位移/应力/应变字段块
   *
   * 使用方式（在项目根 frd-viewer/scripts 目录下）：
   *   node inspectFrd.js
   * 注意：脚本会查找 ../anli/_Kasten.frd（基于当前脚本路径的相对定位），若文件路径不同请修改 frdPath
   */
  try {
    const fs = require('fs')
    const path = require('path')

    // 项目根相对路径，脚本位于 frd-viewer/scripts
    const projectRoot = path.resolve(__dirname, '..')
    const frdPath = path.resolve(projectRoot, '..', 'anli', '_Kasten.frd')
    if (!fs.existsSync(frdPath)) {
      console.error('FRD not found at', frdPath)
      process.exit(2)
    }
    const text = fs.readFileSync(frdPath, 'utf8')

    // 匹配 FRD 中以 -1 开头的数据行：格式通常为 "-1 <id> <v1> <v2> <v3>"
    const nodeRegex = /^\s*-1\s+(\d+)\s+([\-\d.Ee+]+)\s+([\-\d.Ee+]+)\s+([\-\d.Ee+]+)/
    const lines = text.split(/\r?\n/)

    // 将连续的 -1 数据行分为一个个块（block），并记录每个块前面的最近一行非数据行作为 header，帮助识别字段类型
    const blocks = []
    let current = null
    let lastHeader = null
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]
      const m = l.match(nodeRegex)
      if (m) {
        // 如果匹配到 -1 行，就把它加入当前块
        if (!current) current = { header: lastHeader || '', rows: [] }
        current.rows.push({ id: parseInt(m[1],10), a: parseFloat(m[2]), b: parseFloat(m[3]), c: parseFloat(m[4]), raw: l })
      } else {
        // 非数据行则把当前块收尾，并把该行记作下一块的 header
        if (current) { blocks.push(current); current = null }
        const t = l.trim()
        if (t) lastHeader = t
      }
    }
    if (current) blocks.push(current)

    // 打印基本统计：总块数，并显示按块大小排序的前若干个块的索引、行数与 header 以便人工判断
    console.log('=== Raw blocks detected ===')
    console.log(`total blocks: ${blocks.length}`)
    // 展示按行数排序的前 12 个块，便于快速查看最大的块（通常第一个就是节点坐标）
    const indexed = blocks.map((b,idx)=> ({ idx, header: b.header, count: b.rows.length }))
    indexed.sort((a,b)=> b.count - a.count)
    const top = indexed.slice(0, 12)
    top.forEach(b => console.log(`block[${b.idx}] count=${b.count} header="${b.header}"`))

    if (blocks.length === 0) {
      console.log('No data blocks found in FRD')
      process.exit(0)
    }

    // 启发式：将最大的块视为节点坐标块（node block）
    let nodeBlockIndex = 0
    let maxRows = blocks[0].rows.length
    for (let i = 1; i < blocks.length; i++) {
      if (blocks[i].rows.length > maxRows) { maxRows = blocks[i].rows.length; nodeBlockIndex = i }
    }

    const nodeBlock = blocks[nodeBlockIndex]
    // 将所选节点块的每一行转换为 { id, x, y, z }
    const nodes = nodeBlock.rows.map(r => ({ id: r.id, x: r.a, y: r.b, z: r.c }))

    console.log('\n=== Chosen node block ===')
    console.log(`nodeBlockIndex=${nodeBlockIndex} header="${nodeBlock.header}" rows=${nodeBlock.rows.length}`)
    console.log('Total nodes parsed:', nodes.length)
    console.log('Preview nodes (first 5):')
    nodes.slice(0,5).forEach(n => console.log(n))

    // 对其它块做汇总：统计每个块与节点的对齐数（aligned），并尝试基于 header 识别字段类型（位移/应力/应变）
    console.log('\n=== Field summaries (top 12 by size) ===')
    const nonNodeIndexed = indexed.filter(b => b.idx !== nodeBlockIndex).slice(0,12)
    for (const meta of nonNodeIndexed) {
      const blk = blocks[meta.idx]
      const map = new Map(blk.rows.map(r => [r.id, r]))
      // 计算该块中与节点 id 对齐（存在相同 id）的数量
      const present = nodes.reduce((acc,n)=> acc + (map.has(n.id) ? 1 : 0), 0)
      let type = 'unknown'
      if (/\bU\b|UX|UY|UZ|DISP|DISPLAC/i.test(blk.header)) type = 'displacement'
      else if (/\bS\b|STRESS|SIGMA|VMISES|EQUIV/i.test(blk.header)) type = 'stress'
      else if (/\bE\b|STRAIN/i.test(blk.header)) type = 'strain'
      // 计算该块的样本幅值范围（用于判断是否为标量场）
      let min = Infinity, max = -Infinity, sampleCount = 0
      for (const row of blk.rows) {
        const s = Math.sqrt((row.a||0)*(row.a||0) + (row.b||0)*(row.b||0) + (row.c||0)*(row.c||0))
        if (!Number.isNaN(s)) { sampleCount++; if (s < min) min = s; if (s > max) max = s }
      }
      if (min === Infinity) { min = 0; max = 0 }
      console.log(`Field[${meta.idx}] count=${meta.count} aligned=${present} type=${type} sampleCount=${sampleCount} min=${min} max=${max} header="${meta.header}"`)
    }

    process.exit(0)
  } catch (e) {
    console.error(e)
    process.exit(1)
  }
})()

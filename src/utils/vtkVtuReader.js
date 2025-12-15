// 基于 vtk.js XML 工具的 VTU 读取器
// 原理：使用 vtkXMLReader 解析 VTU (UnstructuredGrid)，自动解压 binary/zlib，提取 Points/Cells/PointData
// 输出：{ nodes, elements, elementTypes, fields }，fields 内含 scalarValues 可直接用于着色
import vtkXMLReader from '@kitware/vtk.js/IO/XML/XMLReader.js'

export async function parseVtuFile (arrayBuffer) {
  if (!arrayBuffer) throw new Error('VTU buffer is empty')
  const reader = createUnstructuredReader()
  const ok = reader.parseAsArrayBuffer(arrayBuffer)
  if (!ok) throw new Error('VTK XML parse failed')
  const output = reader.getOutputData(0)
  if (!output) throw new Error('VTU parse returned no output')
  return output
}

export default parseVtuFile

function createUnstructuredReader () {
  const publicAPI = {}
  const model = { output: [] }
  vtkXMLReader.extend(publicAPI, model, { dataType: 'UnstructuredGrid' })
 
  publicAPI.getOutputData = (idx = 0) => model.output[idx]

  publicAPI.parseXML = (rootElem, type, compressor, byteOrder, headerType) => {
    // 1) 找到 UnstructuredGrid/Piece 入口
    const datasetElem = rootElem.getElementsByTagName(type)[0]
    if (!datasetElem) throw new Error('VTU missing UnstructuredGrid root')
    const piece = datasetElem.getElementsByTagName('Piece')[0]
    if (!piece) throw new Error('VTU missing Piece element')

    const nbPoints = Number(piece.getAttribute('NumberOfPoints') || '0')
    const nbCells = Number(piece.getAttribute('NumberOfCells') || '0')

    // 2) 读 Points：processDataArray 会处理 binary/zlib/endianness
    const pointsElem = piece.getElementsByTagName('Points')[0]
    const pointsArrayElem = pointsElem ? pointsElem.getElementsByTagName('DataArray')[0] : null
    const pointArray = pointsArrayElem
      ? vtkXMLReader.processDataArray(nbPoints, pointsArrayElem, compressor, byteOrder, headerType, model.binaryBuffer)
      : { values: new Float32Array(0), numberOfComponents: 3 }
    const nodes = []
    for (let i = 0; i < nbPoints; i++) {
      const base = i * pointArray.numberOfComponents
      nodes.push({
        id: i + 1,
        x: pointArray.values[base] || 0,
        y: pointArray.values[base + 1] || 0,
        z: pointArray.values[base + 2] || 0
      })
    }

    // 3) 读 Cells：processCells 解析 connectivity/offsets/types
    const cellsElem = piece.getElementsByTagName('Cells')[0]
    const elements = []
    const elementTypes = []
    if (cellsElem && nbCells > 0) {
      const cellValues = vtkXMLReader.processCells(nbCells, cellsElem, compressor, byteOrder, headerType, model.binaryBuffer)
      const typeArrayElem = getDataArrayByName(cellsElem, 'types')
      const typeArray = typeArrayElem
        ? vtkXMLReader.processDataArray(nbCells, typeArrayElem, compressor, byteOrder, headerType, model.binaryBuffer)
        : { values: new Uint8Array(nbCells) }
      let offset = 0
      for (let i = 0; i < nbCells; i++) {
        const npts = cellValues[offset]; offset += 1
        const ids = []
        for (let j = 0; j < npts; j++, offset++) ids.push(cellValues[offset] + 1)
        const ctype = typeArray.values[i] || 0
        elements.push({ id: i + 1, nodes: ids, type: ctype })
        elementTypes.push(ctype)
      }
    }

    // 4) 读 PointData：遍历每个 DataArray，按分量数组装值并计算标量
    const fields = []
    const pointDataElem = piece.getElementsByTagName('PointData')[0]
    if (pointDataElem) {
      const dataArrays = pointDataElem.getElementsByTagName('DataArray')
      for (let idx = 0; idx < dataArrays.length; idx++) {
        const arrElem = dataArrays[idx]
        const name = arrElem.getAttribute('Name') || `Field_${idx}`
        const tuples = Number(arrElem.getAttribute('NumberOfTuples') || nbPoints || arrElem.getAttribute('NumberOfComponents') || '0')
        const { values, numberOfComponents } = vtkXMLReader.processDataArray(tuples, arrElem, compressor, byteOrder, headerType, model.binaryBuffer)
        const formattedValues = []
        const scalarValues = []
        if (numberOfComponents === 6) {
          // 6 分量张量：保存 comps 并计算等效 von Mises 作为 scalarValues
          for (let i = 0; i < nbPoints; i++) {
            const base = i * 6
            const comps = [
              values[base] || 0,
              values[base + 1] || 0,
              values[base + 2] || 0,
              values[base + 3] || 0,
              values[base + 4] || 0,
              values[base + 5] || 0
            ]
            const a = comps[0]
            const b = comps[1]
            const c = comps[2]
            formattedValues[i] = { a, b, c, comps }
            const vm = Math.sqrt(0.5 * ((comps[0] - comps[1]) ** 2 + (comps[1] - comps[2]) ** 2 + (comps[2] - comps[0]) ** 2) + 3 * (comps[3] ** 2 + comps[4] ** 2 + comps[5] ** 2))
            scalarValues[i] = vm
          }
        } else if (numberOfComponents === 3) {
          // 3 分量向量：保存 a/b/c，标量用幅值
          for (let i = 0; i < nbPoints; i++) {
            const base = i * 3
            const a = values[base] || 0
            const b = values[base + 1] || 0
            const c = values[base + 2] || 0
            formattedValues[i] = { a, b, c }
            scalarValues[i] = Math.sqrt(a * a + b * b + c * c)
          }
        } else if (numberOfComponents === 1) {
          // 1 分量标量：直接使用
          for (let i = 0; i < nbPoints; i++) {
            const v = values[i] || 0
            formattedValues[i] = { a: v, b: 0, c: 0 }
            scalarValues[i] = v
          }
        } else {
          // 其他分量：只存原值到 scalarValues
          for (let i = 0; i < values.length; i++) scalarValues[i] = values[i]
        }
        const valid = scalarValues.filter(v => Number.isFinite(v))
        const min = valid.length ? Math.min(...valid) : 0
        const max = valid.length ? Math.max(...valid) : 0
        fields.push({
          name,
          displayName: name,
          type: detectFieldType(name, numberOfComponents),
          nComponents: numberOfComponents,
          values: formattedValues,
          scalarValues,
          min,
          max,
          scalarCount: scalarValues.length,
          nPoints: nbPoints,
          dataLocation: 'point'
        })
      }
    }

    model.output[0] = { nodes, elements, elementTypes, fields }
  }

  return publicAPI
}

function getDataArrayByName (containerElem, name) {
  if (!containerElem) return null
  const arrays = containerElem.getElementsByTagName('DataArray')
  for (let i = 0; i < arrays.length; i++) {
    if ((arrays[i].getAttribute('Name') || '').toLowerCase() === name.toLowerCase()) {
      return arrays[i]
    }
  }
  return null
}

function detectFieldType (name, nComponents) {
  const lower = (name || '').toLowerCase()
  if ((nComponents === 3 || nComponents === 6) && /disp|u|velocity/.test(lower)) return 'displacement'
  if (nComponents === 6 || /stress|sig|mises|von|s_|s$/.test(lower)) return 'stress'
  if (/strain|eps|e_|e$/.test(lower)) return 'strain'
  return nComponents === 3 ? 'vector' : 'scalar'
}

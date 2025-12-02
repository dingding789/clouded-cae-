<template>
  <div ref="container" style="width:100%; height:100%;"></div>
</template>

<script>
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { onMounted, ref, watch, onBeforeUnmount } from 'vue'

export default {
  props: ['frdData', 'scale', 'deformFieldIndex', 'colorFieldIndex', 'debugSolid', 'applyDeformation', 'showEdges', 'useElementColors', 'flatShading', 'autoScale', 'colorRangeMode', 'colorRangeMin', 'colorRangeMax'],
  setup (props) {
  const container = ref(null)
  let renderer, scene, camera, controls, objectMesh

    function init () {
      scene = new THREE.Scene()
      camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10000)
      camera.position.set(200, 200, 200)

  renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(window.devicePixelRatio)
  // 不在此处设置固定画布大小；在把 canvas 附到容器后根据容器尺寸设置 renderer 大小

      const light = new THREE.DirectionalLight(0xffffff, 0.8)
      light.position.set(1, 2, 3)
      scene.add(light)
      scene.add(new THREE.AmbientLight(0x888888))

      controls = new OrbitControls(camera, renderer.domElement)
      controls.enableDamping = true

  // 网格参考线
      const grid = new THREE.GridHelper(200, 20)
      scene.add(grid)

  container.value.appendChild(renderer.domElement)
  // 通过 CSS 让 canvas 填充容器，然后把 renderer 的绘制尺寸设置为容器尺寸
  renderer.domElement.style.display = 'block'
  renderer.domElement.style.width = '100%'
  renderer.domElement.style.height = '100%'

  // 根据容器的初始尺寸调整一次
  onWindowResize()

      window.addEventListener('resize', onWindowResize)
      animate()
    }

    function onWindowResize () {
      if (!container.value) return
      const w = container.value.clientWidth
      const h = container.value.clientHeight
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      // 设置 renderer 的绘制尺寸（同时通过 CSS 控制 canvas 大小）
      renderer.setSize(w, h, false)
    }

    // 渲染循环：更新控制器并渲染场景
    function animate () {
      requestAnimationFrame(animate)
      controls.update()
      renderer.render(scene, camera)
    }  

    // 清理场景中的对象并释放资源
    function clearScene () {
      if (!scene) return
      if (objectMesh) {
        scene.remove(objectMesh)
        // 递归释放几何体与材质
        objectMesh.traverse((o) => {
          if (o.geometry) o.geometry.dispose()
          if (o.material) {
            if (Array.isArray(o.material)) o.material.forEach(m => m.dispose())
            else o.material.dispose()
          }
        })
        objectMesh = null
      }
    }

  // props.frdData 预期结构为 { nodes, fields, elements }
    function currentFields() {
      if (!props.frdData || !props.frdData.fields) return { deform: null, color: null }
      const fields = props.frdData.fields
      const deform = fields[props.deformFieldIndex] || null
      const color = fields[props.colorFieldIndex] || null
      return { deform, color }
    }

    function rerender() {
      if (!props.frdData) return
      const nodes = props.frdData.nodes || []
      const { deform, color } = currentFields()
      createPointsWithField(nodes, deform, color, props.scale, props.frdData.elements)
    }

    watch(() => props.frdData, () => rerender(), { immediate: true })
    watch(() => props.scale, () => rerender())
    watch(() => props.deformFieldIndex, () => rerender())
    watch(() => props.colorFieldIndex, () => rerender())
    watch(() => props.useElementColors, () => rerender())
    watch(() => props.flatShading, () => rerender())
    watch(() => props.autoScale, () => rerender())
    watch(() => props.colorRangeMode, () => rerender())
    watch(() => props.colorRangeMin, () => rerender())
    watch(() => props.colorRangeMax, () => rerender())

  // CAE 常见彩虹色表：蓝 → 青 → 绿 → 黄 → 橙 → 红（分段线性插值）
    function caeColorMap (t) {
      t = Math.max(0, Math.min(1, t))
      const stops = [
        { t: 0.00, rgb: [0, 0, 128] },    // 海军蓝 #000080
        { t: 0.16, rgb: [0, 0, 255] },    // 蓝色   #0000FF
        { t: 0.33, rgb: [0, 255, 255] },  // 青色   #00FFFF
        { t: 0.50, rgb: [0, 255, 0] },    // 绿色   #00FF00
        { t: 0.66, rgb: [255, 255, 0] },  // 黄色   #FFFF00
        { t: 0.83, rgb: [255, 165, 0] },  // 橙色   #FFA500
        { t: 1.00, rgb: [255, 0, 0] }     // 红色   #FF0000
      ]
      for (let i = 0; i < stops.length - 1; i++) {
        const a = stops[i]
        const b = stops[i + 1]
        if (t >= a.t && t <= b.t) {
          const u = (t - a.t) / (b.t - a.t || 1)
          const r = (a.rgb[0] + (b.rgb[0] - a.rgb[0]) * u) / 255
          const g = (a.rgb[1] + (b.rgb[1] - a.rgb[1]) * u) / 255
          const bch = (a.rgb[2] + (b.rgb[2] - a.rgb[2]) * u) / 255
          return [r, g, bch]
        }
      }
      const last = stops[stops.length - 1]
      return [last.rgb[0] / 255, last.rgb[1] / 255, last.rgb[2] / 255]
    }

    function resolveRange (min, max, altMin, altMax, valuesForQuantile) {
      // 根据 props.colorRangeMode 与手动输入，决定色带范围
      const mode = props.colorRangeMode || 'auto'
      if (mode === 'manual' && props.colorRangeMin != null && props.colorRangeMax != null) {
        return { min: props.colorRangeMin, max: props.colorRangeMax }
      }
      if (mode === 'symmetric') {
        const m = Math.max(Math.abs(min || 0), Math.abs(max || 0), Math.abs(altMin || 0), Math.abs(altMax || 0))
        return { min: -m, max: m }
      }
      if (mode === 'quantile' && valuesForQuantile && valuesForQuantile.length) {
        const arr = valuesForQuantile.filter(v => v != null && isFinite(v))
        if (!arr.length) return { min: 0, max: 1 }
        arr.sort((a, b) => a - b)
        const lowIdx = Math.floor(0.02 * (arr.length - 1))
        const highIdx = Math.floor(0.98 * (arr.length - 1))
        const qMin = arr[lowIdx]
        const qMax = arr[highIdx]
        if (qMin === qMax) return { min: qMin, max: qMax === 0 ? 1 : qMax * 1.01 }
        return { min: qMin, max: qMax }
      }
      // auto: 优先使用提供的 min/max，否则备用范围
      const mi = (min != null) ? min : (altMin != null ? altMin : 0)
      const ma = (max != null) ? max : (altMax != null ? altMax : 1)
      return { min: mi, max: ma }
    }

    function createPointsWithField (nodes, deformField, colorField, scale, elements) {
      clearScene()
      if (!nodes || nodes.length === 0) return

  // 构建 id -> index 的映射以便通过 INP 的节点 id 查找索引
      const idToIndex = new Map()
      for (let i = 0; i < nodes.length; i++) idToIndex.set(nodes[i].id, i)

  // 计算每个顶点的位置（如果需要，应用位移变形）
      const positions = new Float32Array(nodes.length * 3)
      // 计算模型对角线以支持 autoScale
      let diag = 0
      try {
        if (nodes.length > 0) {
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
          diag = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0
        }
      } catch (e) {
        diag = 0
      }

      // 当 autoScale 开启时，根据模型对角线对用户滑块进行放大
      const effectiveScale = (props.autoScale && diag > 0) ? (scale * (diag / 100.0)) : scale

      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i]
        let x = n.x
        let y = n.y
        let z = n.z
        // 如果用户强制设置该 field 类型（_forcedType），则优先使用它；否则使用解析器识别的 type
        const effectiveType = deformField && deformField._forcedType ? deformField._forcedType : (deformField ? deformField.type : null)
        if (props.applyDeformation && effectiveType === 'displacement' && deformField && deformField.values && deformField.values[i]) {
          const v = deformField.values[i]
          x = n.x + (v.a || 0) * effectiveScale
          y = n.y + (v.b || 0) * effectiveScale
          z = n.z + (v.c || 0) * effectiveScale
        }
        positions[i * 3 + 0] = x
        positions[i * 3 + 1] = y
        positions[i * 3 + 2] = z
      }

  // 如果给出了 elements 信息，则基于单元连接构建网格（对四节点单元进行简化三角化）
      if (elements && elements.length > 0) {
        // 如果启用了按单元着色并且 field 提供了 elValues，则使用非索引几何体按单元上色（flat per element）
        if (props.useElementColors && colorField && colorField.elValues && Object.keys(colorField.elValues).length > 0) {
          const posArr = []
          const colorArr = []
          let triCount = 0
          // 统计 elValues 的 min/max
          const elVals = colorField.elValues
          let elMin = Infinity, elMax = -Infinity
          for (const k of Object.keys(elVals)) {
            const v = elVals[k]
            if (v == null) continue
            if (v < elMin) elMin = v
            if (v > elMax) elMax = v
          }
          if (elMin === Infinity) { elMin = 0; elMax = 0 }
          // 覆盖率：有多少 mesh 元素在 elValues 中有值
          let covered = 0
          for (const el of elements) {
            if (el && elVals[el.id] != null) covered++
          }
          const coverage = elements.length > 0 ? (covered / elements.length) : 0
          // 如果覆盖率过低（例如 < 50%），自动回退到顶点上色，避免整片变为默认颜色
          if (coverage < 0.5) {
            console.warn('[ThreeScene] element-colors coverage too low, fallback to vertex colors. coverage=', coverage.toFixed(3), 'covered=', covered, 'total=', elements.length)
          } else {
            // 在元素着色模式下，优先使用元素范围映射颜色（更贴合“块状配色”预期）
            const { min: rangeMin, max: rangeMax } = resolveRange(null, null, elMin, elMax, Object.values(elVals))

            for (const el of elements) {
              if (!el.nodes || el.nodes.length < 3) continue
              // 三角化：对任意多边形用 fan 三角化
              const corners = el.nodes
              for (let k = 1; k < corners.length - 1; k++) {
                const i0 = idToIndex.get(corners[0])
                const i1 = idToIndex.get(corners[k])
                const i2 = idToIndex.get(corners[k + 1])
                if (i0 === undefined || i1 === undefined || i2 === undefined) continue
                const v0x = positions[i0 * 3 + 0], v0y = positions[i0 * 3 + 1], v0z = positions[i0 * 3 + 2]
                const v1x = positions[i1 * 3 + 0], v1y = positions[i1 * 3 + 1], v1z = positions[i1 * 3 + 2]
                const v2x = positions[i2 * 3 + 0], v2y = positions[i2 * 3 + 1], v2z = positions[i2 * 3 + 2]
                posArr.push(v0x, v0y, v0z, v1x, v1y, v1z, v2x, v2y, v2z)
                // 元素颜色：有值用 elValues，否则使用元素范围的最小值
                const ev = elVals[el.id] != null ? elVals[el.id] : elMin
                const t = (ev - rangeMin) / ((rangeMax - rangeMin) || 1)
                const [r, g, b] = caeColorMap(t)
                colorArr.push(r, g, b, r, g, b, r, g, b)
                triCount++
              }
            }
            if (triCount > 0) {
              const geo = new THREE.BufferGeometry()
              const posBuf = new Float32Array(posArr)
              const colBuf = new Float32Array(colorArr)
              geo.setAttribute('position', new THREE.BufferAttribute(posBuf, 3))
              geo.setAttribute('color', new THREE.BufferAttribute(colBuf, 3))
              try { geo.computeVertexNormals() } catch (e) {}
              const mat = props.debugSolid ? new THREE.MeshBasicMaterial({ color: 0x2194ce, side: THREE.DoubleSide }) : new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: !!props.flatShading, side: THREE.DoubleSide })
              objectMesh = new THREE.Mesh(geo, mat)
              scene.add(objectMesh)
              try { if (props.showEdges) { const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0xffffff })); objectMesh.add(edges) } } catch (e) {}
              const box = new THREE.Box3().setFromBufferAttribute(geo.getAttribute('position'))
              const size = box.getSize(new THREE.Vector3()).length()
              const center = box.getCenter(new THREE.Vector3())
              if (size > 0) {
                const distance = size / (2 * Math.tan(Math.PI * camera.fov / 360))
                camera.position.copy(center).add(new THREE.Vector3(distance, distance, distance))
                camera.lookAt(center)
              }
              console.log('[ThreeScene] create Mesh (element colors): tris=', triCount, 'elRange=', elMin, elMax, 'coverage=', coverage.toFixed(3), 'diag=', diag, 'effectiveScale=', effectiveScale, 'deformFieldType=', deformField ? deformField.type : null, 'colorFieldType=', colorField ? colorField.type : null)
              return
            }
          }
        }

        // 否则使用之前的顶点色/索引 mesh 路径（保持向后兼容）
        const indices = []
        for (const el of elements) {
            if (!el.nodes || el.nodes.length < 3) continue
            const corners = el.nodes
            const i0 = idToIndex.get(corners[0])
            if (i0 === undefined) continue
            // fan 三角化，支持任意多边形；当为四边形时效果与原逻辑等价
            for (let k = 1; k < corners.length - 1; k++) {
              const i1 = idToIndex.get(corners[k])
              const i2 = idToIndex.get(corners[k + 1])
              if (i1 === undefined || i2 === undefined) continue
              indices.push(i0, i1, i2)
          }
        }
        // 仅当生成了索引时创建 Mesh
        if (indices.length > 0) {
          const geo = new THREE.BufferGeometry()
          geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
          geo.setIndex(indices)

          // 计算法线以获得正确的光照与平滑着色（如果 mesh 有三角索引）
          try { geo.computeVertexNormals() } catch (e) {}

          // 顶点颜色：只要存在 scalarValues（例如位移的幅值或应力标量），就将每个顶点的 scalar 值映射为颜色
          if (colorField && colorField.scalarValues) {
            const colors = new Float32Array(nodes.length * 3)
            const { min, max } = resolveRange(colorField.min, colorField.max, null, null, colorField.scalarValues)
            const range = (max - min) || 1
            for (let i = 0; i < nodes.length; i++) {
              const s = colorField.scalarValues[i] != null ? colorField.scalarValues[i] : min
              const t = (s - min) / range
              const [r, g, b] = caeColorMap(t)
              colors[i * 3 + 0] = r
              colors[i * 3 + 1] = g
              colors[i * 3 + 2] = b
            }
            geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
          }
          const useVertexColors = !!(colorField && colorField.scalarValues && colorField.scalarValues.some(v => v != null))
          let mat
          if (props.debugSolid) {
            mat = new THREE.MeshBasicMaterial({ color: 0x2194ce, side: THREE.DoubleSide })
            console.log('[ThreeScene] DEBUG force MeshBasicMaterial')
          } else {
            const baseColor = 0x2194ce
            const emiss = useVertexColors ? 0x000000 : baseColor
            mat = new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.6, metalness: 0.1, vertexColors: useVertexColors, side: THREE.DoubleSide, emissive: emiss, flatShading: !!props.flatShading })
          }
          console.log('[ThreeScene] create Mesh: elements=', elements.length, 'indices=', indices.length, 'vertexColors=', useVertexColors, 'deformFieldType=', deformField ? deformField.type : 'null', 'colorFieldType=', colorField ? colorField.type : 'null', 'colorScalarCount=', colorField && colorField.scalarValues ? colorField.scalarValues.reduce((c,v)=> c + (v!=null?1:0),0) : 0, 'applyDeformation=', props.applyDeformation, 'diag=', diag, 'effectiveScale=', effectiveScale)
          objectMesh = new THREE.Mesh(geo, mat)
          scene.add(objectMesh)

          // 在暗色背景下添加白色边线以提高可读性
          try {
            if (props.showEdges) {
              const edgesGeo = new THREE.EdgesGeometry(geo)
              const edgesMat = new THREE.LineBasicMaterial({ color: 0xffffff })
              const edges = new THREE.LineSegments(edgesGeo, edgesMat)
              objectMesh.add(edges)
            }
          } catch (e) {
            console.warn('EdgesGeometry failed', e)
          }

          // 自动缩放相机以适配当前网格
          const box = new THREE.Box3().setFromBufferAttribute(geo.getAttribute('position'))
          const size = box.getSize(new THREE.Vector3()).length()
          const center = box.getCenter(new THREE.Vector3())
          if (size > 0) {
            const distance = size / (2 * Math.tan(Math.PI * camera.fov / 360))
            camera.position.copy(center).add(new THREE.Vector3(distance, distance, distance))
            camera.lookAt(center)
          }
          return
        }
      }

  // 回退渲染：如果没有单元信息，则以点云形式渲染
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  // color 属性当且仅当存在 scalarValues 时使用（不再严格依赖 field.type）
      let colors = null
      if (colorField && colorField.scalarValues) {
        colors = new Float32Array(nodes.length * 3)
        const { min, max } = resolveRange(colorField.min, colorField.max, null, null, colorField.scalarValues)
        const range = (max - min) || 1
        for (let i = 0; i < nodes.length; i++) {
          const s = colorField.scalarValues[i] != null ? colorField.scalarValues[i] : min
          const t = (s - min) / range
          const [r, g, b] = caeColorMap(t)
          colors[i * 3 + 0] = r
          colors[i * 3 + 1] = g
          colors[i * 3 + 2] = b
        }
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
        const useVertexColors = true
        const mat = new THREE.PointsMaterial({ size: 1.8, vertexColors: useVertexColors })
        console.log('[ThreeScene] create Points (scalar colors) nodes=', nodes.length, 'deformFieldType=', deformField ? deformField.type : null, 'colorFieldType=', colorField ? colorField.type : null)
        objectMesh = new THREE.Points(geo, mat)
        scene.add(objectMesh)
      } else {
  const mat = new THREE.PointsMaterial({ size: 3.0, color: 0xffffff })
  objectMesh = new THREE.Points(geo, mat)
  console.log('[ThreeScene] create Points (default color) nodes=', nodes.length, 'deformFieldType=', deformField ? deformField.type : null, 'colorFieldType=', colorField ? colorField.type : null)
        scene.add(objectMesh)
      }

  // 自动缩放相机以适配点云
      const box = new THREE.Box3().setFromBufferAttribute(geo.getAttribute('position'))
      const size = box.getSize(new THREE.Vector3()).length()
      const center = box.getCenter(new THREE.Vector3())
      if (size > 0) {
        const distance = size / (2 * Math.tan(Math.PI * camera.fov / 360))
        camera.position.copy(center).add(new THREE.Vector3(distance, distance, distance))
        camera.lookAt(center)
      }
    }

    onMounted(() => {
      init()
    })

    onBeforeUnmount(() => {
      window.removeEventListener('resize', onWindowResize)
      if (renderer) renderer.dispose()
    })

    return { container }
  }
}
</script>

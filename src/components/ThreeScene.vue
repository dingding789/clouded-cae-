<template>
  <div ref="container" style="width:100%; height:100%; background: #222;"></div>
</template>

<script>
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { onMounted, ref, watch, onBeforeUnmount } from 'vue'

export default {
  props: ['frdData', 'scale', 'deformFieldIndex', 'colorFieldIndex', 'applyDeformation', 'showEdges', 'autoScale', 'colorRangeMode', 'colorRangeMin', 'colorRangeMax'],
  setup (props) {
    const container = ref(null)
    let renderer, scene, camera, controls
    let contentGroup = null 

    function init () {
      scene = new THREE.Scene()
      // 背景色：深灰偏黑，让彩色云图更鲜艳
      scene.background = new THREE.Color(0x222222) 

      camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100000)
      camera.position.set(100, 100, 100)

      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
      renderer.setPixelRatio(window.devicePixelRatio)
      
      container.value.appendChild(renderer.domElement)
      renderer.domElement.style.width = '100%'
      renderer.domElement.style.height = '100%'

      controls = new OrbitControls(camera, renderer.domElement)
      controls.enableDamping = true

      // 添加坐标轴辅助 (红X 绿Y 蓝Z)
      const axesHelper = new THREE.AxesHelper(50)
      scene.add(axesHelper)

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
      renderer.setSize(w, h, false)
    }

    function animate () {
      requestAnimationFrame(animate)
      controls.update()
      renderer.render(scene, camera)
    }

    // --- 核心：CAE 彩虹色映射 (Blue -> Cyan -> Green -> Yellow -> Red) ---
    function caeColorMap (t) {
      t = Math.max(0, Math.min(1, t))
      // 0.0(蓝) -> 0.25(青) -> 0.5(绿) -> 0.75(黄) -> 1.0(红)
      const stops = [
        { t: 0.00, r:0, g:0, b:1 },    // Blue
        { t: 0.25, r:0, g:1, b:1 },    // Cyan
        { t: 0.50, r:0, g:1, b:0 },    // Green
        { t: 0.75, r:1, g:1, b:0 },    // Yellow
        { t: 1.00, r:1, g:0, b:0 }     // Red
      ]
      
      for (let i = 0; i < stops.length - 1; i++) {
        const s1 = stops[i]
        const s2 = stops[i+1]
        if (t >= s1.t && t <= s2.t) {
          const ratio = (t - s1.t) / (s2.t - s1.t)
          const r = s1.r + (s2.r - s1.r) * ratio
          const g = s1.g + (s2.g - s1.g) * ratio
          const b = s1.b + (s2.b - s1.b) * ratio
          return [r, g, b]
        }
      }
      return [1, 0, 0] // Fallback Red
    }

    // --- 核心：渲染逻辑 ---
    function rerender() {
      // 1. 清理旧模型
      if (contentGroup) {
        scene.remove(contentGroup)
        contentGroup.traverse(o => {
          if (o.geometry) o.geometry.dispose()
          if (o.material) {
            [].concat(o.material).forEach(m => m.dispose())
          }
        })
        contentGroup = null
      }

      if (!props.frdData || !props.frdData.nodes || props.frdData.nodes.length === 0) return

      const { nodes, fields, elements } = props.frdData
      const deformField = fields[props.deformFieldIndex]
      const colorField = fields[props.colorFieldIndex]

      contentGroup = new THREE.Group()
      scene.add(contentGroup)

      const idToIndex = new Map()
      nodes.forEach((n, i) => idToIndex.set(n.id, i))

      // 2. 计算变形比例 (Auto Scale)
      // 计算包围盒对角线长度，用于自动设定变形系数
      let diag = 100
      let minX=Infinity, maxX=-Infinity, minY=Infinity, maxY=-Infinity, minZ=Infinity, maxZ=-Infinity
      nodes.forEach(n => {
        if (n.x<minX) minX=n.x; if (n.x>maxX) maxX=n.x;
        if (n.y<minY) minY=n.y; if (n.y>maxY) maxY=n.y;
        if (n.z<minZ) minZ=n.z; if (n.z>maxZ) maxZ=n.z;
      })
      if (minX !== Infinity) {
        const dx=maxX-minX, dy=maxY-minY, dz=maxZ-minZ
        diag = Math.sqrt(dx*dx + dy*dy + dz*dz) || 1
      }
      
      // 如果开启 AutoScale，将变形放大到模型尺寸的 10% 左右，方便肉眼观察
      // 如果 deformField 最大值很小，scale 会很大
      let effectiveScale = props.scale
      if (props.autoScale && deformField && deformField.max > 0) {
        // 目标变形量 = 模型尺寸 * 0.15 * slider(1..200)/10
        const targetDeform = diag * 0.15 * (props.scale / 50.0) 
        effectiveScale = targetDeform / deformField.max
      }

      // 3. 计算顶点位置 (Positions) & 颜色 (Colors)
      const positions = new Float32Array(nodes.length * 3)
      const colors = new Float32Array(nodes.length * 3)

      // 确定色阶范围
      let cMin = 0, cMax = 1
      if (colorField) {
        cMin = colorField.min
        cMax = colorField.max
        // 【新增】保险措施：如果范围计算出错了，强制修正
        if (!isFinite(cMin) || !isFinite(cMax)) { cMin = 0; cMax = 1; }
        if (Math.abs(cMax - cMin) < 1e-9) { cMax = cMin + 1; }
        // 手动范围覆盖
        if (props.colorRangeMode === 'manual') {
          if (props.colorRangeMin != null) cMin = props.colorRangeMin
          if (props.colorRangeMax != null) cMax = props.colorRangeMax
        }
      }
      const cRange = cMax - cMin || 1

      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i]
        let x = n.x, y = n.y, z = n.z

        // 应用变形
        if (props.applyDeformation && deformField && deformField.values[i]) {
          const v = deformField.values[i]
          x += v.a * effectiveScale
          y += v.b * effectiveScale
          z += v.c * effectiveScale
        }
        positions[i*3] = x
        positions[i*3+1] = y
        positions[i*3+2] = z

        // 计算颜色
        let r=0.8, g=0.8, b=0.8 // 默认灰
        if (colorField && colorField.scalarValues[i] != null) {
          const val = colorField.scalarValues[i]
          const t = (val - cMin) / cRange
          const rgb = caeColorMap(t)
          r = rgb[0]; g = rgb[1]; b = rgb[2]
        }
        colors[i*3] = r
        colors[i*3+1] = g
        colors[i*3+2] = b
      }

      // 4. 构建几何体 (Geometry)
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))

      const indices = []
      if (elements && elements.length) {
        const pushTri = (a, b, c) => {
          if (a !== undefined && b !== undefined && c !== undefined) {
            indices.push(a, b, c)
          }
        }
        const pushQuad = (a, b, c, d) => {
          pushTri(a, b, c)
          pushTri(a, c, d)
        }

        elements.forEach(el => {
          const ids = el.nodes || []
          const n = ids.length
          if (n < 3) return

          const idx = ids.map(id => idToIndex.get(id))
          const type = el.type

          switch (type) {
            case 10: // VTK_TETRA (4 节点四面体，4 个三角面)
              pushTri(idx[0], idx[1], idx[2])
              pushTri(idx[0], idx[1], idx[3])
              pushTri(idx[0], idx[2], idx[3])
              pushTri(idx[1], idx[2], idx[3])
              break
            case 12: // VTK_HEXAHEDRON (8 节点六面体，6 个四边形面)
              pushQuad(idx[0], idx[1], idx[2], idx[3])
              pushQuad(idx[4], idx[5], idx[6], idx[7])
              pushQuad(idx[0], idx[1], idx[5], idx[4])
              pushQuad(idx[1], idx[2], idx[6], idx[5])
              pushQuad(idx[2], idx[3], idx[7], idx[6])
              pushQuad(idx[3], idx[0], idx[4], idx[7])
              break
            case 13: // VTK_WEDGE (6 节点棱柱，2 三角 + 3 四边形)
              pushTri(idx[0], idx[2], idx[1])
              pushTri(idx[3], idx[4], idx[5])
              pushQuad(idx[0], idx[1], idx[4], idx[3])
              pushQuad(idx[1], idx[2], idx[5], idx[4])
              pushQuad(idx[2], idx[0], idx[3], idx[5])
              break
            case 14: // VTK_PYRAMID (5 节点金字塔)
              pushQuad(idx[0], idx[1], idx[2], idx[3])
              pushTri(idx[0], idx[1], idx[4])
              pushTri(idx[1], idx[2], idx[4])
              pushTri(idx[2], idx[3], idx[4])
              pushTri(idx[3], idx[0], idx[4])
              break
            default:
              // 兜底：扇形三角化，适用于三角形/多边形面片
              for (let k = 1; k < n - 1; k++) {
                pushTri(idx[0], idx[k], idx[k + 1])
              }
              break
          }
        })
      }
      if (indices.length > 0) geometry.setIndex(indices)
      geometry.computeVertexNormals()

      // 5. 创建实体 Mesh (CAE 风格: 无光照 BasicMaterial)
      const material = new THREE.MeshBasicMaterial({
        vertexColors: true, // 必须开启，才能显示彩虹色
        side: THREE.DoubleSide,
        polygonOffset: true, // 让实体稍微退后一点，防止和网格线闪烁
        polygonOffsetFactor: 1, 
        polygonOffsetUnits: 1
      })
      const mesh = new THREE.Mesh(geometry, material)
      contentGroup.add(mesh)

      // 6. 创建线框 Mesh (黑色半透明)
      if (props.showEdges && indices.length > 0) {
        const wireMat = new THREE.MeshBasicMaterial({
          color: 0x000000,
          wireframe: true,
          transparent: true,
          opacity: 0.25 // 半透明黑色，像 ANSYS
        })
        const wireMesh = new THREE.Mesh(geometry, wireMat)
        contentGroup.add(wireMesh)
      } else if (indices.length === 0) {
        // 点云兜底
        const ptsMat = new THREE.PointsMaterial({ size: 3, vertexColors: true })
        contentGroup.add(new THREE.Points(geometry, ptsMat))
      }

      // 7. 调整相机聚焦 (仅在首次加载或切换文件时)
      if (!window.__cameraFocused && positions.length > 0) {
        const box = new THREE.Box3().setFromBufferAttribute(geometry.getAttribute('position'))
        const center = box.getCenter(new THREE.Vector3())
        const size = box.getSize(new THREE.Vector3()).length()
        camera.position.copy(center).add(new THREE.Vector3(size, size, size))
        camera.lookAt(center)
        window.__cameraFocused = true
      }
    }

    // 监听 props 变化
    watch(() => props.frdData, () => {
      window.__cameraFocused = false // 新数据重置相机
      rerender()
    }, { immediate: true })

    watch([
      () => props.scale,
      () => props.deformFieldIndex,
      () => props.colorFieldIndex,
      () => props.applyDeformation,
      () => props.showEdges,
      () => props.autoScale,
      () => props.colorRangeMode,
      () => props.colorRangeMin,
      () => props.colorRangeMax
    ], rerender)

    onMounted(init)
    onBeforeUnmount(() => { 
      window.removeEventListener('resize', onWindowResize)
      if (renderer) renderer.dispose() 
    })

    return { container }
  }
}
</script>
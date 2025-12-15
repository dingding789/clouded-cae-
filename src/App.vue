<template>
  <div style="height:100vh; display:flex; flex-direction:column;">
    <header style="padding:8px; background:#20232a; color:#fff; display:flex; gap:8px; align-items:center;">
      <label style="display:inline-flex; gap:8px; align-items:center;">
        Load FRD / INP / VTU
        <input type="file" @change="onFile" accept=".frd,.FRD,.inp,.INP,.vtu,.VTU,.vtk,.VTK" multiple />
      </label>
      <div>Scale (displacement): <input type="range" v-model.number="scale" min="0" max="200" step="1"/></div>
      <label style="display:inline-flex; gap:8px; align-items:center;">
        <input type="checkbox" v-model="debugSolid" /> Debug solid material
      </label>
      <label style="display:inline-flex; gap:8px; align-items:center;">
        <input type="checkbox" v-model="applyDeformation" /> Apply deformation
      </label>
      <label style="display:inline-flex; gap:8px; align-items:center;">
        <input type="checkbox" v-model="showEdges" /> Show edges
      </label>
      <label style="display:inline-flex; gap:8px; align-items:center;">
        <input type="checkbox" v-model="showColorbar" /> Show colorbar
      </label>
      <label style="display:inline-flex; gap:8px; align-items:center;">
        <input type="checkbox" v-model="useElementColors" /> Use element colors
      </label>
      <label style="display:inline-flex; gap:8px; align-items:center;">
        <input type="checkbox" v-model="flatShading" /> Flat shading
      </label>
      <label style="display:inline-flex; gap:8px; align-items:center;">
        <input type="checkbox" v-model="autoScale" /> Auto deformation scale
      </label>
      <div>Points: {{nodeCount}}</div>
      <div v-if="frdData && frdData.fields" style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
        <button @click="togglePlay">{{ playing ? '暂停' : '播放' }}</button>
        <label style="display:inline-flex; gap:6px; align-items:center;">速度 <input type="range" v-model.number="speed" min="0.1" max="5" step="0.1"/> {{ speed.toFixed(1) }}x</label>
        <label style="display:inline-flex; gap:6px; align-items:center;">变形字段
          <select v-model.number="deformFieldIndex">
            <option v-for="(f, i) in frdData.fields" :key="'d'+i" :value="i">{{ i }} - {{ f.displayName || f.name }} ({{ f.type }})</option>
          </select>
        </label>
        <label style="display:inline-flex; gap:6px; align-items:center;">着色字段
          <select v-model.number="colorFieldIndex">
            <option v-for="(f, i) in frdData.fields" :key="'c'+i" :value="i">{{ i }} - {{ f.displayName || f.name }} ({{ f.type }})</option>
          </select>
        </label>
        <span style="margin-left:4px;">当前着色: {{ frdData.fields[colorFieldIndex] ? (frdData.fields[colorFieldIndex].displayName || frdData.fields[colorFieldIndex].name) : 'n/a' }}</span>
        <span v-if="frdData.fields[colorFieldIndex] && frdData.fields[colorFieldIndex].min != null" style="margin-left:8px;">
          范围: {{ (frdData.fields[colorFieldIndex].min).toExponential(3) }} .. {{ (frdData.fields[colorFieldIndex].max).toExponential(3) }}
        </span>
      </div>
    </header>

  <div ref="viewArea" style="position:relative; display:flex; flex-direction:row; flex:1; min-height:0;">
    <div
      v-if="showColorbar && frdData && frdData.fields && frdData.fields[colorFieldIndex]"
      :style="{
        position: 'absolute',
        left: legendPos.x + 'px',
        top: legendPos.y + 'px',
        width: '150px',
        padding: '8px 6px 8px 10px',
        boxSizing: 'border-box',
        background: 'linear-gradient(#f5f5f5,#dcdcdc)',
        color: '#333',
        fontSize: '13px',
        lineHeight: '1.3',
        cursor: legendDragging ? 'grabbing' : 'grab',
        userSelect: 'none',
        zIndex: 5
      }"
      @mousedown.prevent="startDrag"
    >
      <div style="margin-bottom:4px; font-weight:600;">{{ frdData.fields[colorFieldIndex].displayName || frdData.fields[colorFieldIndex].name }}</div>
      <div style="margin-bottom:2px;">类型: {{ frdData.fields[colorFieldIndex].type }}</div>
      <div style="margin-bottom:6px;">色带: {{ colorRangeMode }}</div>
      <canvas ref="legendCanvas" style="width:110px; height:260px; border:1px solid #999; display:block;"></canvas>
    </div>
    <three-scene
      :frdData="frdData"
      :scale="scale"
      :deformFieldIndex="deformFieldIndex"
      :colorFieldIndex="colorFieldIndex"
      :debugSolid="debugSolid"
      :applyDeformation="applyDeformation"
      :showEdges="showEdges"
      :useElementColors="useElementColors"
      :flatShading="flatShading"
      :autoScale="autoScale"
      :colorRangeMode="colorRangeMode"
      :colorRangeMin="colorRangeMode==='manual' ? colorRangeMin : null"
      :colorRangeMax="colorRangeMode==='manual' ? colorRangeMax : null"
      style="flex:1; min-height:0;"
    />
    <div style="width:220px; padding:8px; box-sizing:border-box; background:transparent;">
      <div v-if="frdData && frdData.fields && frdData.fields.length">
          <div style="margin-bottom:8px; color:#fff;">
            <label style="display:inline-flex; gap:8px; align-items:center;">Field:
              <select v-model.number="stepIndex">
                <option v-for="(f, idx) in frdData.fields" :key="idx" :value="idx">{{idx}} - {{ f.displayName || f.name }}</option>
              </select>
            </label>
            <button style="margin-left:8px" @click.prevent="forceFieldAs(deformFieldIndex, 'displacement')">将变形字段强制为位移</button>
            <button style="margin-left:4px" @click.prevent="forceFieldAs(colorFieldIndex, 'scalar')">将着色字段强制为标量</button>
          </div>
          <div style="margin-bottom:8px; color:#fff;">
            <label style="display:inline-flex; gap:8px; align-items:center;"><input type="checkbox" v-model="useElementColors" /> Use element colors</label>
            <label style="display:inline-flex; gap:8px; align-items:center; margin-left:8px;"><input type="checkbox" v-model="flatShading" /> Flat shading</label>
            <label style="display:inline-flex; gap:8px; align-items:center; margin-left:8px;"><input type="checkbox" v-model="autoScale" /> Auto deformation scale</label>
          </div>
          <div style="margin-bottom:8px; color:#fff;">
            <label style="display:inline-flex; gap:6px; align-items:center;">Color range:
              <select v-model="colorRangeMode">
                <option value="auto">Auto (min..max)</option>
                <option value="symmetric">Symmetric (±max)</option>
                <option value="manual">Manual</option>
                <option value="quantile">Quantile (2%-98%)</option>
              </select>
            </label>
            <template v-if="colorRangeMode==='manual'">
              <label style="margin-left:8px;">min <input type="number" v-model.number="colorRangeMin" style="width:90px;" /></label>
              <label style="margin-left:8px;">max <input type="number" v-model.number="colorRangeMax" style="width:90px;" /></label>
            </template>
          </div>
        <div style="color:#fff; font-size:13px; margin-bottom:6px;">着色字段: {{ frdData.fields[colorFieldIndex].displayName || frdData.fields[colorFieldIndex].name }}</div>
        <div style="color:#fff; font-size:12px;">类型: {{ frdData.fields[colorFieldIndex].type }}</div>
        <div v-if="frdData.fields[colorFieldIndex] && frdData.fields[colorFieldIndex].min != null" style="margin-top:6px; display:flex; align-items:center;">
          <canvas class="colorbar" ref="colorbarCanvas"></canvas>
          <div class="colorbar-labels">
            <div>{{ (frdData.fields[colorFieldIndex].max).toFixed(3) }}</div>
            <div style="margin-top:6px">{{ (frdData.fields[colorFieldIndex].min).toFixed(3) }}</div>
          </div>
        </div>
      </div>
      <div style="color:#fff; margin-top:8px;">Nodes: {{nodeCount}}</div>
      <div style="color:#fff; margin-top:6px;">Deformation scale: {{ scale }}</div>
    </div>
  </div>
  </div>
</template>

<script>
import ThreeScene from './components/ThreeScene.vue'
import { ref, onMounted, watch, onBeforeUnmount } from 'vue'
import { parseFrdWithVtk } from './utils/vtkFrdParser'
import { parseVtuFile } from './utils/vtkVtuReader'

export default {
  components: { ThreeScene },
  setup () {
    const frdData = ref(null)
    const scale = ref(10)
    const nodeCount = ref(0)
    
    // 核心修复：统一使用 colorFieldIndex，删掉多余的 stepIndex
    const deformFieldIndex = ref(0)
    const colorFieldIndex = ref(0)
    
    const debugSolid = ref(false)
    const applyDeformation = ref(true)
    const showEdges = ref(true)
    const showColorbar = ref(true)
    const useElementColors = ref(false)
    const flatShading = ref(false)
    const autoScale = ref(true)
    const colorRangeMode = ref('auto')
    const colorRangeMin = ref(null)
    const colorRangeMax = ref(null)
    const colorbarCanvas = ref(null)
    const legendCanvas = ref(null)
    const viewArea = ref(null)
    const legendPos = ref({ x: 10, y: 70 })
    const legendDragging = ref(false)
    const legendOffset = ref({ x: 0, y: 0 })
    const playing = ref(false)
    const speed = ref(1) 

    // --- 文件读取逻辑 ---
    async function onFile (e) {
      const files = Array.from((e.target.files) || [])
      if (!files.length) return

      // 优先识别 VTU/VTK（使用纯 XML 解析）
      const vtuFile = files.find(f => /\.(vtk|vtu)$/i.test(f.name))
      if (vtuFile) {
        try {
          const buffer = await readAsArrayBuffer(vtuFile)
          const parsed = await parseVtuFile(buffer)
          frdData.value = parsed
          nodeCount.value = parsed.nodes ? parsed.nodes.length : 0
          autoPickDefaultFields(parsed)
          return
        } catch (err) {
          console.error('VTU parse error:', err)
          alert('VTU 文件解析失败: ' + err.message)
          return
        }
      }

      // FRD / INP 路径（文本读取）
      const reads = files.map(f => new Promise((res) => {
        const r = new FileReader()
        r.onload = () => res({ name: f.name, text: r.result })
        r.readAsText(f)
      }))
      const results = await Promise.all(reads)
      const frdFile = results.find(r => /\.frd$/i.test(r.name)) || results[0]
      const inpFile = results.find(r => /\.inp$/i.test(r.name))

      if (frdFile) {
        const parsed = parseFrdWithVtk(frdFile.text, inpFile ? inpFile.text : undefined)
        frdData.value = parsed
        nodeCount.value = parsed.nodes ? parsed.nodes.length : 0
        autoPickDefaultFields(parsed)
      }
    }

    // --- 修复后的动画逻辑 ---
    let lastTick = performance.now()
    function tick () {
      if (!playing.value || !frdData.value || !frdData.value.fields) return
      
      const now = performance.now()
      const dt = (now - lastTick) / 1000
      
      // 控制播放速度
      if (dt >= 1 / Math.max(0.1, speed.value)) {
        const maxIndex = frdData.value.fields.length - 1
        
        // 【关键修复】这里直接更新 colorFieldIndex，让画面动起来
        let nextIndex = colorFieldIndex.value + 1
        if (nextIndex > maxIndex) nextIndex = 0 // 循环播放
        
        colorFieldIndex.value = nextIndex
        deformFieldIndex.value = nextIndex // 变形和颜色同步
        
        lastTick = now
      }
      requestAnimationFrame(tick)
    }

    function togglePlay () {
      playing.value = !playing.value
      if (playing.value) {
        lastTick = performance.now()
        requestAnimationFrame(tick)
      }
    }

    function readAsArrayBuffer (file) {
      return new Promise((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve(r.result)
        r.onerror = reject
        r.readAsArrayBuffer(file)
      })
    }

    // 根据解析出的字段自动选择：变形=位移；着色=标量（应力/应变/von Mises/位移幅值）
    function autoPickDefaultFields(parsed) {
      try {
        const fields = parsed.fields || []
        // 选择位移字段作为变形，并自动开启 Apply deformation
        let deformIdx = fields.findIndex(f => f && (f._forcedType === 'displacement' || f.type === 'displacement'))
        if (deformIdx < 0) {
          deformIdx = fields.findIndex(f => f && f.values && f.values.length)
          if (deformIdx >= 0) {
            fields[deformIdx]._forcedType = 'displacement'
            fields[deformIdx].type = 'displacement'
          }
        }
        if (deformIdx >= 0) {
          deformFieldIndex.value = deformIdx
          applyDeformation.value = true
        }

        // 着色字段打分：优先标量，名称包含 mises/stress/strain/disp/mag，值域更大
        const scoreField = (f) => {
          let score = 0
          const name = (f.displayName || f.name || '').toLowerCase()
          if (f.type === 'scalar' || f.type === 'stress' || f.type === 'strain') score += 10
          if (/mises|stress|strain|sig|eps|disp|magnitude|von/.test(name)) score += 5
          const span = (isFinite(f.max) && isFinite(f.min)) ? Math.abs(f.max - f.min) : 0
          score += Math.min(5, span > 0 ? Math.log10(span + 1) : 0)
          score += Math.min(5, f.scalarCount || 0) * 0.001
          return score
        }
        let colorIdx = -1
        let bestScore = -Infinity
        for (let i = 0; i < fields.length; i++) {
          const f = fields[i]
          if (!f) continue
          const s = scoreField(f)
          if (s > bestScore) { bestScore = s; colorIdx = i }
        }
        if (colorIdx < 0 && deformIdx >= 0) {
          // 若没有标量，则把位移强制为标量（幅值）用于着色
          // 注意：直接修改 frdData 引用以触发更新
          const f = fields[deformIdx]
          if (f) {
            // 简化：交给按钮逻辑已有的计算，但这里直接设置标志并让 ThreeScene 使用 scalarValues（若已有）
            f._forcedType = 'scalar'
            f.type = 'scalar'
            colorIdx = deformIdx
          }
        }
        if (colorIdx >= 0) colorFieldIndex.value = colorIdx

        // 提升可见性：若检测到极端值导致对比度低，则默认使用 quantile 色带
        const cf = fields[colorFieldIndex.value]
        if (cf && cf.scalarValues) {
          const nonNull = cf.scalarValues.filter(v => v != null && isFinite(v))
          if (nonNull.length >= 50) {
            const sorted = [...nonNull].sort((a,b)=>a-b)
            const low = sorted[Math.floor(0.02*(sorted.length-1))]
            const high = sorted[Math.floor(0.98*(sorted.length-1))]
            const fullSpan = Math.abs((cf.max||0) - (cf.min||0))
            const qSpan = Math.abs(high - low)
            if (fullSpan > 0 && qSpan/fullSpan < 0.6) {
              colorRangeMode.value = 'quantile'
            }
          }
        }
      } catch (e) { /* ignore */ }
    }

    // --- 色带绘制逻辑 ---
    function drawColorbar () {
      const canvas = colorbarCanvas.value
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      const w = canvas.width = canvas.clientWidth || 180
      const h = canvas.height = canvas.clientHeight || 18
      ctx.clearRect(0, 0, w, h)
      
      // 绘制彩虹渐变 (Blue -> Red)
      const grad = ctx.createLinearGradient(0, 0, w, 0)
      grad.addColorStop(0.00, '#0000ff') // Blue
      grad.addColorStop(0.25, '#00ffff') // Cyan
      grad.addColorStop(0.50, '#00ff00') // Green
      grad.addColorStop(0.75, '#ffff00') // Yellow
      grad.addColorStop(1.00, '#ff0000') // Red
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, w, h)
    }

    // 左侧竖向色带，带刻度文字
    function drawLegend () {
      const canvas = legendCanvas.value
      if (!canvas || !frdData.value || !frdData.value.fields || !frdData.value.fields[colorFieldIndex.value]) return
      const field = frdData.value.fields[colorFieldIndex.value]
      const ctx = canvas.getContext('2d')
      const w = canvas.width = canvas.clientWidth || 110
      const h = canvas.height = canvas.clientHeight || 260

      // 计算色带范围，与 ThreeScene 保持一致
      let cMin = field.min
      let cMax = field.max
      if (colorRangeMode.value === 'manual') {
        if (colorRangeMin.value != null) cMin = colorRangeMin.value
        if (colorRangeMax.value != null) cMax = colorRangeMax.value
      } else if (colorRangeMode.value === 'symmetric') {
        const m = Math.max(Math.abs(cMin), Math.abs(cMax)) || 1
        cMin = -m; cMax = m
      }
      if (!isFinite(cMin) || !isFinite(cMax) || Math.abs(cMax - cMin) < 1e-12) {
        cMin = 0; cMax = 1
      }

      const fmt = (v) => {
        const av = Math.abs(v)
        if (av >= 1e4 || (av > 0 && av < 1e-3)) return v.toExponential(3)
        return v.toFixed(3)
      }

      // 背景
      ctx.fillStyle = '#f0f0f0'
      ctx.fillRect(0, 0, w, h)

      // 色带矩形
      const barX = 12
      const barW = 32
      const barY = 10
      const barH = h - 20

      // 竖向渐变 (顶端红，底端蓝，中间按停靠点插值)
      const grad = ctx.createLinearGradient(0, barY, 0, barY + barH)
      const stops = [
        { t: 0.00, c: '#ff0000' },
        { t: 0.25, c: '#ff7f00' },
        { t: 0.50, c: '#00ff00' },
        { t: 0.75, c: '#00bfff' },
        { t: 1.00, c: '#0000ff' }
      ]
      stops.forEach(s => grad.addColorStop(s.t, s.c))
      ctx.fillStyle = grad
      ctx.fillRect(barX, barY, barW, barH)
      ctx.strokeStyle = '#444'
      ctx.strokeRect(barX, barY, barW, barH)

      // 刻度线和文字（9 个刻度）
      ctx.strokeStyle = '#555'
      ctx.fillStyle = '#222'
      ctx.lineWidth = 1
      const ticks = 8
      for (let i = 0; i <= ticks; i++) {
        const t = i / ticks
        const y = barY + t * barH
        ctx.beginPath()
        ctx.moveTo(barX + barW, y)
        ctx.lineTo(barX + barW + 8, y)
        ctx.stroke()
        const val = cMax - t * (cMax - cMin)
        ctx.fillText(fmt(val), barX + barW + 12, y + 3)
      }
    }

    onMounted(() => { 
      drawColorbar(); 
      drawLegend();
      window.addEventListener('mousemove', onDragMove)
      window.addEventListener('mouseup', onDragEnd)
      window.addEventListener('mouseleave', onDragEnd)
    })

    onBeforeUnmount(() => {
      window.removeEventListener('mousemove', onDragMove)
      window.removeEventListener('mouseup', onDragEnd)
      window.removeEventListener('mouseleave', onDragEnd)
    })

    function startDrag (e) {
      legendDragging.value = true
      legendOffset.value = { x: e.clientX - legendPos.value.x, y: e.clientY - legendPos.value.y }
    }

    function onDragMove (e) {
      if (!legendDragging.value) return
      const area = viewArea.value?.getBoundingClientRect()
      const minX = 0
      const minY = 0
      const maxX = area ? area.width - 150 : window.innerWidth
      const maxY = area ? area.height - 280 : window.innerHeight
      const nx = Math.min(Math.max(e.clientX - legendOffset.value.x - (area ? area.left : 0), minX), maxX)
      const ny = Math.min(Math.max(e.clientY - legendOffset.value.y - (area ? area.top : 0), minY), maxY)
      legendPos.value = { x: nx, y: ny }
    }

    function onDragEnd () {
      legendDragging.value = false
    }

    watch([
      () => colorFieldIndex.value,
      () => colorRangeMode.value,
      () => colorRangeMin.value,
      () => colorRangeMax.value,
      () => frdData.value
    ], drawLegend)

    return { 
      frdData, onFile, scale, nodeCount, 
      deformFieldIndex, colorFieldIndex, 
      togglePlay, playing, speed, 
      debugSolid, applyDeformation, showEdges, showColorbar, 
      colorbarCanvas, useElementColors, flatShading, 
      autoScale, colorRangeMode, colorRangeMin, colorRangeMax, legendCanvas, 
      legendPos, legendDragging, startDrag, viewArea 
    }
  }
}
</script>
<style>
.colorbar {
  width: 180px;
  height: 18px;
  border: 1px solid #ccc;
  margin-left: 8px;
}
.colorbar-labels { font-size:12px; color:#fff; margin-left:8px }
</style>

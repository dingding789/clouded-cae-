<template>
  <div style="height:100vh; display:flex; flex-direction:column;">
    <header style="padding:8px; background:#20232a; color:#fff; display:flex; gap:8px; align-items:center;">
      <label style="display:inline-flex; gap:8px; align-items:center;">
        Load FRD / INP
        <input type="file" @change="onFile" accept=".frd,.FRD,.inp,.INP" multiple />
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

  <div style="display:flex; flex-direction:row; flex:1; min-height:0;">
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
import { ref, onMounted, watch } from 'vue'
import { parseFrdText } from './utils/frdParser'

export default {
  components: { ThreeScene },
  setup () {
    const frdData = ref(null)
    const forcedFieldType = ref(null) // { index, type }
    const scale = ref(10)
    const nodeCount = ref(0)
    // 旧动画/临时选择使用的索引（用于右侧“Field:”下拉与播放逻辑）
    const stepIndex = ref(0)
    // deformFieldIndex: 用于几何变形的字段（通常位移）
    // colorFieldIndex: 用于着色的字段（通常应力/位移幅值/应变）
    const deformFieldIndex = ref(0)
    const colorFieldIndex = ref(0)
  const debugSolid = ref(false)
  const applyDeformation = ref(true)
  const showEdges = ref(true)
  const showColorbar = ref(true)
  const useElementColors = ref(false)
  const flatShading = ref(false)
  const autoScale = ref(true)
  // 色带范围控制：auto（使用字段 min/max）、symmetric（使用 ±max）、manual（用户自填）
  const colorRangeMode = ref('auto')
  const colorRangeMin = ref(null)
  const colorRangeMax = ref(null)
  const colorbarCanvas = ref(null)

  // 解析文件并加载数据，以便 UI 能显示步骤/字段等信息
    async function onFile (e) {
      const files = Array.from((e.target.files) || [])
      if (!files.length) return
  // 读取所有选中文件，按扩展名区分 FRD 和 INP
      const reads = files.map(f => new Promise((res, rej) => {
        const r = new FileReader()
        r.onload = () => res({ name: f.name, text: r.result })
        r.onerror = rej
        r.readAsText(f)
      }))
      const results = await Promise.all(reads)
      const frdFile = results.find(r => /\.frd$/i.test(r.name))
      const inpFile = results.find(r => /\.inp$/i.test(r.name))
      try {
        if (frdFile) {
          const parsed = parseFrdText(frdFile.text, inpFile ? inpFile.text : undefined)
          // 打印解析摘要以便调试：节点/单元/字段统计与每个字段的简要信息
          try {
            // 保存到全局变量，方便在 DevTools 控制台手动检查
            window.__frdParsed = parsed
            const fieldsSummary = (parsed.fields || []).slice(0, 12).map(f => ({ name: f.name, type: f.type, rows: f.rows, nodeHits: f.nodeHits, elHits: f.elHits, scalarCount: f.scalarCount, min: f.min, max: f.max }))
            console.log('frd parsed summary:', { nodes: parsed.nodes ? parsed.nodes.length : 0, elements: parsed.elements ? parsed.elements.length : 0, fieldsTotal: (parsed.fields || []).length, fieldsSample: fieldsSummary })
            // 另打印第一字段的前 10 个 scalar 值（如果存在）以便快速查看数据
            if (parsed.fields && parsed.fields.length > 0 && parsed.fields[0].scalarValues) {
              console.log('first field scalar sample:', parsed.fields[0].scalarValues.slice(0, 10))
            }
          } catch (e) { /* ignore logging errors */ }
          frdData.value = parsed
          nodeCount.value = parsed.nodes ? parsed.nodes.length : 0
          stepIndex.value = 0
        } else {
          // 如果没有 FRD 文件，则尝试把第一个文件当作 FRD 来解析（兼容性处理）
          const parsed = parseFrdText(results[0].text, inpFile ? inpFile.text : undefined)
          try {
            window.__frdParsed = parsed
            const fieldsSummary = (parsed.fields || []).slice(0, 12).map(f => ({ name: f.name, type: f.type, rows: f.rows, nodeHits: f.nodeHits, elHits: f.elHits, scalarCount: f.scalarCount, min: f.min, max: f.max }))
            console.log('frd parsed summary (fallback):', { nodes: parsed.nodes ? parsed.nodes.length : 0, elements: parsed.elements ? parsed.elements.length : 0, fieldsTotal: (parsed.fields || []).length, fieldsSample: fieldsSummary })
            if (parsed.fields && parsed.fields.length > 0 && parsed.fields[0].scalarValues) {
              console.log('first field scalar sample:', parsed.fields[0].scalarValues.slice(0, 10))
            }
          } catch (e) { }
          frdData.value = parsed
          nodeCount.value = parsed.nodes ? parsed.nodes.length : 0
          stepIndex.value = 0
        }
      } catch (err) {
        frdData.value = results[0].text
      }
    }

    function forceFieldAs (idx, t) {
      if (!frdData.value || !frdData.value.fields) return
      const f = frdData.value.fields[idx]
      if (!f) return
      f._forcedType = t
      // 如果用户强制将字段视为标量，但解析器没有计算 scalarValues，则基于 values 计算幅值
      if (t === 'scalar' && (!f.scalarValues || f.scalarValues.length === 0)) {
        try {
          const nodes = frdData.value.nodes || []
          const vals = new Array(nodes.length).fill(null)
          let min = Infinity, max = -Infinity
          if (f.values) {
            for (let i = 0; i < nodes.length; i++) {
              const v = f.values[i]
              if (!v) continue
              const a = v.a || 0
              const b = v.b || 0
              const c = v.c || 0
              const s = Math.sqrt(a * a + b * b + c * c)
              vals[i] = s
              if (s < min) min = s
              if (s > max) max = s
            }
          }
          if (min === Infinity) { min = 0; max = 0 }
          f.scalarValues = vals
          f.min = min
          f.max = max
          f.scalarCount = vals.reduce((c, v) => c + (v != null ? 1 : 0), 0)
          f.type = 'scalar'
        } catch (err) {
          // ignore
        }
      }
      // 如果强制为位移，确保 type 字段也能反映出来（便于 UI 提示）
      if (t === 'displacement') {
        f.type = 'displacement'
      }

      // 更新引用以触发 ThreeScene 重渲染
      frdData.value = Object.assign({}, frdData.value)
    }

  // 动画相关控制
        const playing = ref(false)
        const speed = ref(1) // 每秒步数

        let lastTick = performance.now()
        function tick () {
          if (!playing.value || !frdData.value || !frdData.value.fields) return
          const now = performance.now()
          const dt = (now - lastTick) / 1000
          if (dt >= 1 / Math.max(0.01, speed.value)) {
            const maxIndex = Math.max(0, frdData.value.fields.length - 1)
            stepIndex.value = (stepIndex.value + 1) > maxIndex ? 0 : stepIndex.value + 1
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

    

  // 绘制 colorbar 的函数
  function drawColorbar () {
      try {
        const canvas = colorbarCanvas.value
        if (!canvas) return
        const ctx = canvas.getContext('2d')
        const w = canvas.width = canvas.clientWidth || 180
        const h = canvas.height = canvas.clientHeight || 18
        // 清空画布
        ctx.clearRect(0, 0, w, h)
        if (!frdData.value || !frdData.value.fields || !frdData.value.fields.length) return
        const f = frdData.value.fields[colorFieldIndex.value]
        if (!f || !f.min || !f.max) return
        const min = f.min
        const max = f.max
  // 从左到右的渐变（CAE 彩虹：蓝→青→绿→黄→橙→红）
        const grad = ctx.createLinearGradient(0, 0, w, 0)
        const stops = [
          { t: 0.00, hex: '#000080' }, // 海军蓝
          { t: 0.16, hex: '#0000ff' }, // 蓝
          { t: 0.33, hex: '#00ffff' }, // 青
          { t: 0.50, hex: '#00ff00' }, // 绿
          { t: 0.66, hex: '#ffff00' }, // 黄
          { t: 0.83, hex: '#ffa500' }, // 橙
          { t: 1.00, hex: '#ff0000' }  // 红
        ]
        stops.forEach(s => grad.addColorStop(s.t, s.hex))
        ctx.fillStyle = grad
        ctx.fillRect(0, 0, w, h)
  // 可选：在此绘制刻度/标签
      } catch (err) {
        // 忽略绘图错误
      }
    }

    onMounted(() => {
      drawColorbar()
    })

    // 当着色字段或数据变化时重绘色带
    watch([() => frdData.value, colorFieldIndex], () => {
      setTimeout(drawColorbar, 0)
    })

    // 不再使用 stepIndex 作为统一字段索引，改为 deformFieldIndex + colorFieldIndex
    return { frdData, onFile, scale, nodeCount, deformFieldIndex, colorFieldIndex, togglePlay, playing: playing, speed, debugSolid, applyDeformation, showEdges, showColorbar, colorbarCanvas, forceFieldAs, useElementColors, flatShading, autoScale, colorRangeMode, colorRangeMin, colorRangeMax, stepIndex }
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

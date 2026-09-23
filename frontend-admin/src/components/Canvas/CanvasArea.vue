<template>
  <div class="canvas-area card">
    <div class="canvas-wrapper" ref="wrapperRef" @click.self="clearSelection" @drop="handleDrop" @dragover="handleDragOver">
      <div class="canvas-stage">
        <div class="canvas-scaler" :style="scalerStyle">
          <div class="canvas-container" :style="canvasContainerStyle">
            <canvas ref="canvasRef" :width="store.canvasPixelWidth" :height="store.canvasPixelHeight" class="export-canvas" />
            <div class="edit-area">
              <div
                v-for="element in visibleElements"
                :key="element.id"
                class="canvas-element"
                :class="{ selected: isSelected(element.id), 'multi-selected': isMultiSelected(element.id) }"
                :style="getElementStyle(element)"
                @mousedown="handleElementMouseDown($event, element)"
                @dblclick="handleDoubleClick(element)"
              >
                <component :is="getElementComponent(element.type)" :element="element" :ref="el => setElementRef(element.id, el)" />
                <div v-if="isSelected(element.id)" class="resize-handles">
                  <div v-for="handle in resizeHandles" :key="handle" :class="['resize-handle', handle]" @mousedown.stop="startResize($event, element, handle)" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 缩放控制：与顶部工具栏共用 store.scale，始终保持同步 -->
      <div class="zoom-bar">
        <el-button-group>
          <el-button size="small" :disabled="store.scale <= 0.25" title="缩小" @click="zoomOut">
            <el-icon><ZoomOut /></el-icon>
          </el-button>
          <el-button size="small" class="zoom-value" title="重置为 100%" @click="resetView">
            {{ Math.round(store.scale * 100) }}%
          </el-button>
          <el-button size="small" :disabled="store.scale >= 4" title="放大" @click="zoomIn">
            <el-icon><ZoomIn /></el-icon>
          </el-button>
        </el-button-group>
        <el-button size="small" title="适应当前窗口" @click="fitView">
          <el-icon><Rank /></el-icon>
        </el-button>
      </div>

      <!-- 画布尺寸 / 缩放比例 / 可滚动区域 的直观视图 -->
      <CanvasMinimap :wrapper-ref="wrapperRef" />
    </div>
    <div class="canvas-info">
      <span>{{ store.canvasWidth }}×{{ store.canvasHeight }}mm</span>
      <span>{{ store.canvasPixelWidth }}×{{ store.canvasPixelHeight }}px</span>
      <span>{{ Math.round(store.scale * 100) }}% · 显示 {{ scaledCanvasWidth }}×{{ scaledCanvasHeight }}px</span>
      <span>滚动区 {{ scrollMetrics.width }}×{{ scrollMetrics.height }}px · ({{ scrollMetrics.left }},{{ scrollMetrics.top }})</span>
      <span class="tip">Ctrl+点击多选</span>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, nextTick, watch, onMounted, onBeforeUnmount } from 'vue'
import { useCanvasStore } from '@/stores/canvas'
import TextElement from './elements/TextElement.vue'
import RectElement from './elements/RectElement.vue'
import CircleElement from './elements/CircleElement.vue'
import LineElement from './elements/LineElement.vue'
import ImageElement from './elements/ImageElement.vue'
import BarcodeElement from './elements/BarcodeElement.vue'
import QrcodeElement from './elements/QrcodeElement.vue'
import TableElement from './elements/TableElement.vue'
import CanvasMinimap from './CanvasMinimap.vue'
import JsBarcode from 'jsbarcode'
import QRCode from 'qrcode'
import { ElMessage } from 'element-plus'

const store = useCanvasStore()
const canvasRef = ref(null)
const wrapperRef = ref(null)
const elementRefs = ref({})

const resizeHandles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
const scales = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4]
// 画布外留白，缩放后留白区域也属于可滚动范围，保证整块画布都能滚到
const CANVAS_PADDING = 24
let isDragging = false
let isResizing = false
let dragStartX = 0
let dragStartY = 0
let elementStartX = 0
let elementStartY = 0
let elementStartW = 0
let elementStartH = 0
let currentHandle = ''
let currentElementId = null
// 程序化切换缩放/尺寸时跳过“以视口中心为锚点”的默认滚动逻辑
let skipAnchor = false

const visibleElements = computed(() => store.elements.filter(el => el.visible))

const scaledCanvasWidth = computed(() => Math.round(store.canvasPixelWidth * store.scale))
const scaledCanvasHeight = computed(() => Math.round(store.canvasPixelHeight * store.scale))

// 外层占据缩放后的真实布局尺寸，使滚动条的可滚动范围与视觉画布一致
const scalerStyle = computed(() => ({
  width: `${scaledCanvasWidth.value}px`,
  height: `${scaledCanvasHeight.value}px`
}))

const canvasContainerStyle = computed(() => ({
  width: `${store.canvasPixelWidth}px`,
  height: `${store.canvasPixelHeight}px`,
  transform: `scale(${store.scale})`,
  transformOrigin: 'top left'
}))

// 可滚动区域信息（供底部信息栏展示）
const scrollMetricsTrigger = ref(0)
const scrollMetrics = computed(() => {
  void scrollMetricsTrigger.value
  const w = wrapperRef.value
  if (!w) return { width: 0, height: 0, left: 0, top: 0 }
  return {
    width: w.scrollWidth,
    height: w.scrollHeight,
    left: w.scrollLeft,
    top: w.scrollTop
  }
})
let metricsRaf = 0
const scheduleMetricsUpdate = () => {
  if (metricsRaf) return
  metricsRaf = requestAnimationFrame(() => { metricsRaf = 0; scrollMetricsTrigger.value++ })
}

// 返回画布内容原点相对滚动区左上的位置（含 wrapper padding 与居中边距）
const getContentOrigin = () => {
  const w = wrapperRef.value
  const scaler = w?.querySelector('.canvas-scaler')
  if (!w || !scaler) return { x: CANVAS_PADDING, y: CANVAS_PADDING }
  return {
    x: scaler.getBoundingClientRect().left - w.getBoundingClientRect().left + w.scrollLeft,
    y: scaler.getBoundingClientRect().top - w.getBoundingClientRect().top + w.scrollTop
  }
}

// 缩放时以视口中心的画布点为锚点调整滚动位置，保证来回缩放视图一致
watch(() => store.scale, (newScale, oldScale) => {
  if (skipAnchor || !newScale || !oldScale) return
  const w = wrapperRef.value
  if (!w) return
  // watcher 在 DOM 更新前触发，此时读到的是旧布局
  const oldScrollLeft = w.scrollLeft
  const oldScrollTop = w.scrollTop
  const viewW = w.clientWidth
  const viewH = w.clientHeight
  const oldOrigin = getContentOrigin()
  const oldCanvasW = store.canvasPixelWidth * oldScale
  const oldCanvasH = store.canvasPixelHeight * oldScale

  requestAnimationFrame(() => {
    if (skipAnchor) return
    const ratio = newScale / oldScale
    const newCanvasW = oldCanvasW * ratio
    const newCanvasH = oldCanvasH * ratio
    // 内容原点：溢出时为 stage padding；小于视口时为居中边距 (viewport-canvas)/2
    const originX = Math.max(CANVAS_PADDING, (viewW - newCanvasW) / 2)
    const originY = Math.max(CANVAS_PADDING, (viewH - newCanvasH) / 2)
    // 视口中心对应的旧画布坐标
    const centerCanvasX = oldScrollLeft + viewW / 2 - oldOrigin.x
    const centerCanvasY = oldScrollTop + viewH / 2 - oldOrigin.y
    w.scrollTo({
      left: originX + centerCanvasX * ratio - viewW / 2,
      top: originY + centerCanvasY * ratio - viewH / 2
    })
    scheduleMetricsUpdate()
  })
})

// 画布尺寸变化后把滚动位置限制在新范围内，并刷新滚动信息
watch(() => [store.canvasPixelWidth, store.canvasPixelHeight], () => {
  requestAnimationFrame(() => { clampScroll(); scheduleMetricsUpdate() })
})

const clampScroll = () => {
  const w = wrapperRef.value
  if (!w) return
  w.scrollTo({
    left: Math.min(w.scrollLeft, Math.max(0, w.scrollWidth - w.clientWidth)),
    top: Math.min(w.scrollTop, Math.max(0, w.scrollHeight - w.clientHeight))
  })
}

const zoomIn = () => {
  const next = scales.find(s => s > store.scale + 1e-9)
  if (next !== undefined) store.setScale(next)
}
const zoomOut = () => {
  const smaller = scales.filter(s => s < store.scale - 1e-9)
  if (smaller.length) store.setScale(smaller[smaller.length - 1])
}

// 回到初始视图：100% 缩放、滚动位置回到左上角
const resetView = () => {
  skipAnchor = true
  store.setScale(1)
  requestAnimationFrame(() => {
    wrapperRef.value?.scrollTo({ left: 0, top: 0 })
    scheduleMetricsUpdate()
    requestAnimationFrame(() => { skipAnchor = false })
  })
}

// 适应当前窗口：整块画布都可见且居中
const fitView = () => {
  const w = wrapperRef.value
  if (!w) return
  const fit = Math.min(
    (w.clientWidth - CANVAS_PADDING * 2) / store.canvasPixelWidth,
    (w.clientHeight - CANVAS_PADDING * 2) / store.canvasPixelHeight
  )
  const target = scales
    .filter(s => s <= fit)
    .sort((a, b) => b - a)[0] || scales[0]
  skipAnchor = true
  store.setScale(target)
  requestAnimationFrame(() => {
    w.scrollTo({
      left: (w.scrollWidth - w.clientWidth) / 2,
      top: (w.scrollHeight - w.clientHeight) / 2
    })
    scheduleMetricsUpdate()
    requestAnimationFrame(() => { skipAnchor = false })
  })
}

let resizeObserver = null
onMounted(() => {
  if (typeof ResizeObserver !== 'undefined' && wrapperRef.value) {
    resizeObserver = new ResizeObserver(scheduleMetricsUpdate)
    resizeObserver.observe(wrapperRef.value)
  } else {
    window.addEventListener('resize', scheduleMetricsUpdate)
  }
  wrapperRef.value?.addEventListener('scroll', scheduleMetricsUpdate, { passive: true })
  scheduleMetricsUpdate()
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  window.removeEventListener('resize', scheduleMetricsUpdate)
  wrapperRef.value?.removeEventListener('scroll', scheduleMetricsUpdate)
})

const componentMap = { text: TextElement, rect: RectElement, circle: CircleElement, line: LineElement, image: ImageElement, barcode: BarcodeElement, qrcode: QrcodeElement, table: TableElement }
const getElementComponent = (type) => componentMap[type] || 'div'

const setElementRef = (id, el) => { if (el) elementRefs.value[id] = el }

const getElementStyle = (el) => ({
  left: `${el.x}px`,
  top: `${el.y}px`,
  width: `${el.width}px`,
  height: `${el.height}px`,
  transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined
})

const isSelected = (id) => store.selectedElementId === id
const isMultiSelected = (id) => store.selectedElementIds.includes(id) && store.selectedElementIds.length > 1
const clearSelection = () => store.clearSelection()

const handleDoubleClick = (element) => {
  if (element.type === 'text') {
    const ref = elementRefs.value[element.id]
    if (ref && ref.startEdit) ref.startEdit()
  }
}

const handleElementMouseDown = (e, element) => {
  if (element.locked) return
  e.preventDefault()
  store.selectElement(element.id, e.ctrlKey || e.metaKey)
  isDragging = true
  currentElementId = element.id
  dragStartX = e.clientX
  dragStartY = e.clientY
  elementStartX = element.x
  elementStartY = element.y
  document.addEventListener('mousemove', handleMouseMove)
  document.addEventListener('mouseup', handleMouseUp)
}

const startResize = (e, element, handle) => {
  e.preventDefault()
  isResizing = true
  currentHandle = handle
  currentElementId = element.id
  dragStartX = e.clientX
  dragStartY = e.clientY
  elementStartX = element.x
  elementStartY = element.y
  elementStartW = element.width
  elementStartH = element.height
  document.addEventListener('mousemove', handleMouseMove)
  document.addEventListener('mouseup', handleMouseUp)
}

const handleMouseMove = (e) => {
  const dx = (e.clientX - dragStartX) / store.scale
  const dy = (e.clientY - dragStartY) / store.scale
  const el = store.elements.find(el => el.id === currentElementId)
  if (!el) return
  
  if (isDragging && currentElementId) {
    // 限制不超出画布
    let newX = Math.round(elementStartX + dx)
    let newY = Math.round(elementStartY + dy)
    newX = Math.max(0, Math.min(store.canvasPixelWidth - el.width, newX))
    newY = Math.max(0, Math.min(store.canvasPixelHeight - el.height, newY))
    store.updateElement(currentElementId, { x: newX, y: newY })
  } else if (isResizing && currentElementId) {
    let newX = elementStartX, newY = elementStartY, newW = elementStartW, newH = elementStartH
    
    if (currentHandle.includes('e')) newW = Math.max(10, elementStartW + dx)
    if (currentHandle.includes('w')) { newW = Math.max(10, elementStartW - dx); newX = elementStartX + dx }
    if (currentHandle.includes('s')) newH = Math.max(10, elementStartH + dy)
    if (currentHandle.includes('n')) { newH = Math.max(10, elementStartH - dy); newY = elementStartY + dy }
    
    // 限制不超出画布
    newX = Math.max(0, Math.round(newX))
    newY = Math.max(0, Math.round(newY))
    newW = Math.min(store.canvasPixelWidth - newX, Math.round(newW))
    newH = Math.min(store.canvasPixelHeight - newY, Math.round(newH))
    
    store.updateElement(currentElementId, { x: newX, y: newY, width: newW, height: newH })
  }
}

const handleMouseUp = () => {
  isDragging = false
  isResizing = false
  currentElementId = null
  document.removeEventListener('mousemove', handleMouseMove)
  document.removeEventListener('mouseup', handleMouseUp)
}

const handleDragOver = (e) => {
  e.preventDefault()
  e.dataTransfer.dropEffect = 'copy'
}

const handleDrop = (e) => {
  e.preventDefault()
  e.stopPropagation()
  const data = e.dataTransfer.getData('application/json')
  if (!data) return
  
  try {
    const item = JSON.parse(data)
    const container = wrapperRef.value.querySelector('.canvas-scaler')
    const rect = container.getBoundingClientRect()
    let x = (e.clientX - rect.left) / store.scale
    let y = (e.clientY - rect.top) / store.scale
    
    const defaultSize = {
      text: { width: 100, height: 24 },
      rect: { width: 80, height: 60 },
      circle: { width: 60, height: 60 },
      line: { width: 100, height: 4 },
      image: { width: 80, height: 80 },
      barcode: { width: 150, height: 60 },
      qrcode: { width: 80, height: 80 },
      table: { width: 200, height: 120 }
    }
    
    const size = defaultSize[item.type] || { width: 100, height: 40 }
    
    // 计算位置并限制在画布内
    x = Math.max(0, Math.min(store.canvasPixelWidth - size.width, Math.round(x - size.width / 2)))
    y = Math.max(0, Math.min(store.canvasPixelHeight - size.height, Math.round(y - size.height / 2)))
    
    store.addElement({
      type: item.type,
      ...item.defaultProps,
      x, y,
      ...size
    })
  } catch (err) {
    console.error('Drop error:', err)
  }
}

const renderCanvas = async () => {
  await nextTick()
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  
  for (const el of store.elements) {
    if (!el.visible) continue
    ctx.save()
    ctx.translate(el.x + el.width / 2, el.y + el.height / 2)
    if (el.rotation) ctx.rotate((el.rotation * Math.PI) / 180)
    ctx.translate(-el.width / 2, -el.height / 2)
    await renderElement(ctx, el)
    ctx.restore()
  }
}

const renderElement = async (ctx, el) => {
  switch (el.type) {
    case 'text':
      ctx.fillStyle = el.color || '#000'
      ctx.font = `${el.italic ? 'italic ' : ''}${el.bold ? 'bold ' : ''}${el.fontSize || 14}px ${el.fontFamily || 'Arial'}`
      ctx.textBaseline = 'top'
      ctx.fillText(el.content || '', 0, 0)
      break
    case 'rect':
      if (el.fillColor && el.fillColor !== 'transparent') { ctx.fillStyle = el.fillColor; ctx.fillRect(0, 0, el.width, el.height) }
      if (el.strokeWidth) { ctx.strokeStyle = el.strokeColor || '#000'; ctx.lineWidth = el.strokeWidth; ctx.strokeRect(0, 0, el.width, el.height) }
      break
    case 'circle':
      ctx.beginPath()
      ctx.ellipse(el.width / 2, el.height / 2, el.width / 2, el.height / 2, 0, 0, Math.PI * 2)
      if (el.fillColor && el.fillColor !== 'transparent') { ctx.fillStyle = el.fillColor; ctx.fill() }
      if (el.strokeWidth) { ctx.strokeStyle = el.strokeColor || '#000'; ctx.lineWidth = el.strokeWidth; ctx.stroke() }
      break
    case 'line':
      ctx.beginPath(); ctx.moveTo(0, el.height / 2); ctx.lineTo(el.width, el.height / 2)
      ctx.strokeStyle = el.strokeColor || '#000'; ctx.lineWidth = el.strokeWidth || 2; ctx.stroke()
      break
    case 'image':
      if (el.imageData) {
        const img = new Image(); img.src = el.imageData
        await new Promise(r => { img.onload = r; img.onerror = r })
        ctx.drawImage(img, 0, 0, el.width, el.height)
      }
      break
    case 'barcode':
      try {
        const bcCanvas = document.createElement('canvas')
        JsBarcode(bcCanvas, el.content || '123456', { format: el.format || 'CODE128', displayValue: el.showText !== false })
        ctx.drawImage(bcCanvas, 0, 0, el.width, el.height)
      } catch (e) { console.error(e) }
      break
    case 'qrcode':
      try {
        const qrCanvas = document.createElement('canvas')
        await QRCode.toCanvas(qrCanvas, el.content || 'https://example.com', { width: el.width, errorCorrectionLevel: el.errorLevel || 'M' })
        ctx.drawImage(qrCanvas, 0, 0, el.width, el.height)
      } catch (e) { console.error(e) }
      break
    case 'table': {
      const rows = el.rows || 3
      const cols = el.cols || 3
      const bw = el.borderWidth || 1
      const bc = el.borderColor || '#000000'
      const cellW = el.width / cols
      const cellH = el.height / rows
      const padding = 4
      ctx.strokeStyle = bc
      ctx.lineWidth = bw
      ctx.strokeRect(bw / 2, bw / 2, el.width - bw, el.height - bw)
      for (let r = 1; r < rows; r++) {
        ctx.beginPath()
        ctx.moveTo(0, r * cellH)
        ctx.lineTo(el.width, r * cellH)
        ctx.stroke()
      }
      for (let c = 1; c < cols; c++) {
        ctx.beginPath()
        ctx.moveTo(c * cellW, 0)
        ctx.lineTo(c * cellW, el.height)
        ctx.stroke()
      }
      const fontSize = el.cellFontSize || 12
      const fontFamily = el.cellFontFamily || 'Arial'
      const textAlign = el.cellTextAlign || 'center'
      ctx.fillStyle = el.cellFontColor || '#000000'
      ctx.font = `${fontSize}px ${fontFamily}`
      ctx.textAlign = textAlign
      ctx.textBaseline = 'middle'
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const text = (el.cells && el.cells[r] && el.cells[r][c]) || ''
          if (text) {
            let x
            if (textAlign === 'left') x = c * cellW + padding
            else if (textAlign === 'right') x = (c + 1) * cellW - padding
            else x = c * cellW + cellW / 2
            const y = r * cellH + cellH / 2
            ctx.fillText(text, x, y)
          }
        }
      }
      break
    }
  }
}

const exportToBMP = (canvas, filename = 'label.bmp') => {
  const ctx = canvas.getContext('2d')
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const pixels = imageData.data
  const width = canvas.width
  const height = canvas.height
  const rowSize = Math.ceil(width / 8)
  const paddedRowSize = Math.ceil(rowSize / 4) * 4
  const pixelDataSize = paddedRowSize * height
  const headerSize = 62
  const fileSize = headerSize + pixelDataSize
  const buffer = new ArrayBuffer(fileSize)
  const view = new DataView(buffer)
  view.setUint8(0, 0x42); view.setUint8(1, 0x4D)
  view.setUint32(2, fileSize, true); view.setUint32(6, 0, true); view.setUint32(10, headerSize, true)
  view.setUint32(14, 40, true); view.setInt32(18, width, true); view.setInt32(22, -height, true)
  view.setUint16(26, 1, true); view.setUint16(28, 1, true); view.setUint32(30, 0, true)
  view.setUint32(34, pixelDataSize, true); view.setUint32(38, 2835, true); view.setUint32(42, 2835, true)
  view.setUint32(46, 2, true); view.setUint32(50, 2, true)
  view.setUint8(54, 0); view.setUint8(55, 0); view.setUint8(56, 0); view.setUint8(57, 0)
  view.setUint8(58, 255); view.setUint8(59, 255); view.setUint8(60, 255); view.setUint8(61, 0)
  let offset = headerSize
  for (let y = 0; y < height; y++) {
    let byte = 0, bitIndex = 7
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const gray = 0.299 * pixels[i] + 0.587 * pixels[i+1] + 0.114 * pixels[i+2]
      byte |= ((gray > 128 ? 1 : 0) << bitIndex); bitIndex--
      if (bitIndex < 0 || x === width - 1) { view.setUint8(offset++, byte); byte = 0; bitIndex = 7 }
    }
    for (let p = Math.ceil(width / 8); p < paddedRowSize; p++) view.setUint8(offset++, 0)
  }
  const blob = new Blob([buffer], { type: 'image/bmp' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob); link.download = filename; link.click()
}

const exportCanvas = async (type) => {
  await renderCanvas()
  const canvas = canvasRef.value
  if (type === 'bmp') {
    exportToBMP(canvas, 'label.bmp')
    ElMessage.success('BMP 导出成功')
  } else {
    const link = document.createElement('a')
    link.href = canvas.toDataURL('image/png')
    link.download = 'label.png'
    link.click()
    ElMessage.success('PNG 导出成功')
  }
}

defineExpose({ exportCanvas })
</script>

<style lang="scss" scoped>
.canvas-area { flex: 1; display: flex; flex-direction: column; overflow: hidden; min-width: 0; }

.canvas-wrapper {
  position: relative;
  flex: 1; overflow: auto; background: #e4e7ed;
  background-image: linear-gradient(45deg, #d0d0d0 25%, transparent 25%), linear-gradient(-45deg, #d0d0d0 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #d0d0d0 75%), linear-gradient(-45deg, transparent 75%, #d0d0d0 75%);
  background-size: 20px 20px; background-position: 0 0, 0 10px, 10px -10px, -10px 0px;
}

/* 留白做在 stage 上（不能做在滚动容器 padding 上：浏览器不会把容器尾部 padding
   计入可滚动范围）。小画布时 auto margin 居中，溢出时从左上排开且四边均可滚到
   （也不能用 justify-content: center：溢出时左侧会被裁掉且无法滚到） */
.canvas-stage {
  min-width: 100%;
  min-height: 100%;
  /* 宽度按内容（含右侧 padding）撑开，否则 flex 容器宽度停在视口宽度、
     右侧留白不进入可滚动范围；min-width 保证小画布时至少铺满视口用于居中 */
  width: max-content;
  box-sizing: border-box;
  padding: 24px;
  display: flex;
}

/* 占据缩放后的真实布局尺寸，是滚动区域的实际内容边界 */
.canvas-scaler {
  flex-shrink: 0;
  margin: auto;
}

.canvas-container { position: relative; background: #fff; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15); overflow: hidden; }
.export-canvas { position: absolute; top: 0; left: 0; visibility: hidden; pointer-events: none; }
.edit-area { position: relative; width: 100%; height: 100%; }

.zoom-bar {
  position: absolute;
  left: 50%;
  bottom: 12px;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(255, 255, 255, 0.94);
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
  padding: 4px 8px;
  z-index: 20;

  .zoom-value {
    min-width: 56px;
    font-weight: 600;
    color: #409eff;
  }
}

.canvas-element {
  position: absolute; cursor: move; border: 1px solid transparent; box-sizing: border-box;
  &:hover { border-color: #409eff; }
  &.selected { border-color: #409eff; border-width: 2px; }
  &.multi-selected { border-color: #67c23a; border-width: 2px; }
}

.resize-handles .resize-handle {
  position: absolute; width: 8px; height: 8px; background: #409eff; border: 1px solid #fff; border-radius: 2px;
  &.nw { top: -4px; left: -4px; cursor: nw-resize; }
  &.n { top: -4px; left: 50%; transform: translateX(-50%); cursor: n-resize; }
  &.ne { top: -4px; right: -4px; cursor: ne-resize; }
  &.e { top: 50%; right: -4px; transform: translateY(-50%); cursor: e-resize; }
  &.se { bottom: -4px; right: -4px; cursor: se-resize; }
  &.s { bottom: -4px; left: 50%; transform: translateX(-50%); cursor: s-resize; }
  &.sw { bottom: -4px; left: -4px; cursor: sw-resize; }
  &.w { top: 50%; left: -4px; transform: translateY(-50%); cursor: w-resize; }
}

.canvas-info {
  padding: 8px 16px; background: #f5f7fa; border-top: 1px solid #e4e7ed;
  display: flex; flex-wrap: wrap; gap: 6px 24px;
  font-size: 12px; color: #909399;
  .tip { margin-left: auto; color: #409eff; }
}
</style>

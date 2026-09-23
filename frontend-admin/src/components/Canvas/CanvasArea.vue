<template>
  <div class="canvas-area card">
    <div class="canvas-wrapper" ref="wrapperRef">
      <!-- 尺寸占位层：按 缩放后尺寸 占据布局空间，决定滚动条可滚动范围，
           保证放大到 200% 以上时画布每一个角落都能滚动到达、可以点击 -->
      <div
        class="canvas-sizer"
        :style="sizerStyle"
        @click.self="clearSelection"
        @drop="handleDrop"
        @dragover="handleDragOver"
      >
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

      <!-- 导航缩略图：直观呈现 画布尺寸 / 缩放比例 / 可滚动区域 / 当前可视区域 之间的关系 -->
      <div class="navigator">
        <div class="navigator-header">
          <span class="nav-title">导航视图</span>
          <span class="nav-percent">{{ Math.round(store.scale * 100) }}%</span>
        </div>
        <div
          class="navigator-body"
          ref="navRef"
          @mousedown="startNavDrag"
        >
          <div class="nav-world" :style="navWorldStyle">
            <!-- 可滚动区域（白底）= 缩放后的画布 -->
            <div class="nav-scrollable" :style="navScrollableStyle">
              <!-- 100% 时的原始画布轮廓（虚线），便于对比缩放前后 -->
              <div class="nav-original" :style="navOriginalStyle"></div>
              <!-- 当前可视区域 -->
              <div class="nav-viewport" :style="viewportStyle"></div>
            </div>
          </div>
        </div>
        <div class="navigator-legend">
          <span><i class="legend-box original"></i>原始画布 100%</span>
          <span><i class="legend-box scrollable"></i>缩放后/可滚动</span>
          <span><i class="legend-box viewport"></i>当前可视区域</span>
        </div>
        <div class="navigator-info">
          <span>画布: {{ Math.round(displayWidth) }}×{{ Math.round(displayHeight) }} px</span>
          <span>可视: {{ viewWidth }}×{{ viewHeight }} px</span>
        </div>
        <div class="navigator-zoom">
          <el-button size="small" :disabled="store.scale <= store.MIN_SCALE" @click="zoomBy(-1)">－</el-button>
          <el-button size="small" @click="resetZoom">100%</el-button>
          <el-button size="small" @click="fitView">适应</el-button>
          <el-button size="small" :disabled="store.scale >= store.MAX_SCALE" @click="zoomBy(1)">＋</el-button>
        </div>
      </div>
    </div>
    <div class="canvas-info">
      <span>画布: {{ store.canvasWidth }}mm × {{ store.canvasHeight }}mm</span>
      <span>像素: {{ store.canvasPixelWidth }} × {{ store.canvasPixelHeight }} px</span>
      <span>缩放: {{ Math.round(store.scale * 100) }}%</span>
      <span>可滚动区域: {{ Math.round(displayWidth) + CANVAS_GAP * 2 }} × {{ Math.round(displayHeight) + CANVAS_GAP * 2 }} px</span>
      <span class="tip">提示: Ctrl+点击多选元件</span>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, nextTick, onMounted, onBeforeUnmount, watch } from 'vue'
import { useCanvasStore } from '@/stores/canvas'
import TextElement from './elements/TextElement.vue'
import RectElement from './elements/RectElement.vue'
import CircleElement from './elements/CircleElement.vue'
import LineElement from './elements/LineElement.vue'
import ImageElement from './elements/ImageElement.vue'
import BarcodeElement from './elements/BarcodeElement.vue'
import QrcodeElement from './elements/QrcodeElement.vue'
import TableElement from './elements/TableElement.vue'
import JsBarcode from 'jsbarcode'
import QRCode from 'qrcode'
import { ElMessage } from 'element-plus'

const store = useCanvasStore()
const canvasRef = ref(null)
const wrapperRef = ref(null)
const navRef = ref(null)
const elementRefs = ref({})

// 画布四周留白，属于可滚动区域的一部分
const CANVAS_GAP = 24
// 导航缩略图内部绘制区域尺寸
const NAV_SIZE = 160

const resizeHandles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
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

const visibleElements = computed(() => store.elements.filter(el => el.visible))

// 缩放后画布实际显示尺寸（不取整，保证占位层不小于 transform 后的实际渲染尺寸）
const displayWidth = computed(() => store.canvasPixelWidth * store.scale)
const displayHeight = computed(() => store.canvasPixelHeight * store.scale)

const sizerStyle = computed(() => ({
  width: `${displayWidth.value + CANVAS_GAP * 2}px`,
  height: `${displayHeight.value + CANVAS_GAP * 2}px`
}))

const canvasContainerStyle = computed(() => ({
  left: `${CANVAS_GAP}px`,
  top: `${CANVAS_GAP}px`,
  width: `${store.canvasPixelWidth}px`,
  height: `${store.canvasPixelHeight}px`,
  transform: `scale(${store.scale})`
}))

// 当前可视区域信息（以画布坐标系 px 计）
const viewRect = reactive({ width: 0, height: 0, scrollLeft: 0, scrollTop: 0 })

const viewWidth = computed(() => Math.min(Math.round(viewRect.width / store.scale), displayWidth.value))
const viewHeight = computed(() => Math.min(Math.round(viewRect.height / store.scale), displayHeight.value))

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

/* ---------------- 滚动位置：缩放 / 画布尺寸变化后回到初始位置（左上角留白处） ---------------- */

const scrollToStart = () => {
  const wrapper = wrapperRef.value
  if (!wrapper) return
  wrapper.scrollLeft = 0
  wrapper.scrollTop = 0
}

watch(() => store.scale, () => {
  nextTick(scrollToStart)
  updateViewRect()
})

watch([() => store.canvasWidth, () => store.canvasHeight], () => {
  nextTick(scrollToStart)
  nextTick(updateViewRect)
})

const updateViewRect = () => {
  const wrapper = wrapperRef.value
  if (!wrapper) return
  viewRect.width = wrapper.clientWidth
  viewRect.height = wrapper.clientHeight
  viewRect.scrollLeft = wrapper.scrollLeft
  viewRect.scrollTop = wrapper.scrollTop
}

let resizeObserver = null

onMounted(() => {
  updateViewRect()
  scrollToStart()
  const wrapper = wrapperRef.value
  if (wrapper) {
    wrapper.addEventListener('scroll', updateViewRect)
    resizeObserver = new ResizeObserver(updateViewRect)
    resizeObserver.observe(wrapper)
  }
})

onBeforeUnmount(() => {
  wrapperRef.value?.removeEventListener('scroll', updateViewRect)
  resizeObserver?.disconnect()
})

/* ---------------- 缩放控件（与顶部工具栏共用 store.scale，始终保持一致） ---------------- */

const zoomBy = (direction) => {
  const steps = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4]
  let target
  if (direction > 0) {
    target = steps.find(s => s > store.scale + 0.001) ?? store.MAX_SCALE
  } else {
    target = [...steps].reverse().find(s => s < store.scale - 0.001) ?? store.MIN_SCALE
  }
  store.setScale(target)
}

const resetZoom = () => store.setScale(1)

const fitView = () => {
  const wrapper = wrapperRef.value
  if (!wrapper) return
  const availableW = wrapper.clientWidth - CANVAS_GAP * 2
  const availableH = wrapper.clientHeight - CANVAS_GAP * 2
  const fit = Math.min(availableW / store.canvasPixelWidth, availableH / store.canvasPixelHeight)
  store.setScale(Math.min(store.MAX_SCALE, Math.max(store.MIN_SCALE, fit)))
}

/* ---------------- 导航缩略图 ---------------- */

// 可滚动区域整体（= 缩放后画布 + 四周留白）映射到导航视图的比例
const navScale = computed(() => {
  const fullW = displayWidth.value + CANVAS_GAP * 2
  const fullH = displayHeight.value + CANVAS_GAP * 2
  return Math.min(NAV_SIZE / fullW, NAV_SIZE / fullH)
})

const navWorldStyle = computed(() => ({
  width: `${(displayWidth.value + CANVAS_GAP * 2) * navScale.value}px`,
  height: `${(displayHeight.value + CANVAS_GAP * 2) * navScale.value}px`
}))

const navScrollableStyle = computed(() => ({
  width: `${displayWidth.value * navScale.value}px`,
  height: `${displayHeight.value * navScale.value}px`,
  margin: `${CANVAS_GAP * navScale.value}px`
}))

// 100% 原始画布轮廓，相对缩放后画布左上角定位
const navOriginalStyle = computed(() => {
  const w = store.canvasPixelWidth * navScale.value
  const h = store.canvasPixelHeight * navScale.value
  return {
    width: `${w}px`,
    height: `${h}px`,
    left: `${(displayWidth.value - w) / 2}px`,
    top: `${(displayHeight.value - h) / 2}px`
  }
})

// 当前可视区域框，坐标系与滚动容器一致（含留白），再换算到画布块
const navGap = computed(() => CANVAS_GAP * navScale.value)
const viewportStyle = computed(() => ({
  width: `${viewRect.width * navScale.value}px`,
  height: `${viewRect.height * navScale.value}px`,
  left: `${viewRect.scrollLeft * navScale.value - navGap.value}px`,
  top: `${viewRect.scrollTop * navScale.value - navGap.value}px`
}))

// 在缩略图上按下 / 拖动：把可视区域中心移动到点击位置
let navDragging = false

const startNavDrag = (e) => {
  e.preventDefault()
  navDragging = true
  syncScrollByNav(e)
  document.addEventListener('mousemove', onNavDrag)
  document.addEventListener('mouseup', stopNavDrag)
}

const onNavDrag = (e) => {
  if (!navDragging) return
  syncScrollByNav(e)
}

const stopNavDrag = () => {
  navDragging = false
  document.removeEventListener('mousemove', onNavDrag)
  document.removeEventListener('mouseup', stopNavDrag)
}

const syncScrollByNav = (e) => {
  const nav = navRef.value
  const world = nav?.querySelector('.nav-world')
  const wrapper = wrapperRef.value
  if (!nav || !world || !wrapper) return
  const rect = world.getBoundingClientRect()
  // 点击点相对于 可滚动区域整体（含留白）的坐标
  const x = (e.clientX - rect.left) / navScale.value
  const y = (e.clientY - rect.top) / navScale.value
  // 让可视区域中心对准该点
  wrapper.scrollTo({
    left: x - viewRect.width / 2,
    top: y - viewRect.height / 2
  })
}

/* ---------------- 元件交互 ---------------- */

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
    const container = wrapperRef.value.querySelector('.canvas-container')
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
      ctx.strokeStyle = el.strokeColor || '#000'
      ctx.lineWidth = el.strokeWidth || 2; ctx.stroke()
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
.canvas-area { flex: 1; display: flex; flex-direction: column; overflow: hidden; min-width: 0; position: relative; }

.canvas-wrapper {
  position: relative;
  flex: 1; overflow: auto; background: #e4e7ed;
  background-image: linear-gradient(45deg, #d0d0d0 25%, transparent 25%), linear-gradient(-45deg, #d0d0d0 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #d0d0d0 75%), linear-gradient(-45deg, transparent 75%, #d0d0d0 75%);
  background-size: 20px 20px; background-position: 0 0, 0 10px, 10px -10px, -10px 0px;
}

/* 尺寸占位层：其宽高 = 缩放后画布 + 四周留白，决定可滚动范围 */
.canvas-sizer { position: relative; }

.canvas-container {
  position: absolute; background: #fff; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
  overflow: hidden; flex-shrink: 0; transform-origin: top left;
}
.export-canvas { position: absolute; top: 0; left: 0; visibility: hidden; pointer-events: none; }
.edit-area { position: relative; width: 100%; height: 100%; }

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

/* ---------------- 导航缩略图 ---------------- */
.navigator {
  position: absolute; right: 12px; bottom: 12px; z-index: 10;
  width: 196px; background: rgba(255, 255, 255, 0.96);
  border: 1px solid #dcdfe6; border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
  padding: 8px 10px; font-size: 11px; color: #606266;
  user-select: none;
}

.navigator-header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 6px;
  .nav-title { font-weight: 600; color: #303133; }
  .nav-percent { color: #409eff; font-weight: 600; }
}

.navigator-body {
  position: relative;
  width: 160px;
  height: 160px;
  margin: 0 auto;
  background: #f0f2f5;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  cursor: pointer;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.nav-world { position: relative; flex-shrink: 0; }

.nav-scrollable {
  position: relative;
  background: #ffffff;
  box-shadow: 0 0 0 1px #c0c4cc inset;
}

.nav-original {
  position: absolute;
  border: 1px dashed #909399;
  background: rgba(64, 158, 255, 0.06);
  pointer-events: none;
}

.nav-viewport {
  position: absolute;
  border: 1.5px solid #f56c6c;
  background: rgba(245, 108, 108, 0.18);
  pointer-events: none;
  box-sizing: border-box;
}

.navigator-legend {
  display: flex; flex-direction: column; gap: 2px;
  margin-top: 6px;
  span { display: flex; align-items: center; gap: 4px; }
  .legend-box {
    display: inline-block; width: 10px; height: 10px; border-radius: 2px; flex-shrink: 0;
    &.original { border: 1px dashed #909399; background: rgba(64, 158, 255, 0.2); }
    &.scrollable { border: 1px solid #c0c4cc; background: #fff; }
    &.viewport { border: 1px solid #f56c6c; background: rgba(245, 108, 108, 0.25); }
  }
}

.navigator-info {
  margin-top: 6px; display: flex; flex-direction: column; gap: 2px; color: #909399;
}

.navigator-zoom {
  display: flex; gap: 4px; margin-top: 6px;
  :deep(.el-button) { flex: 1; min-width: 0; padding: 4px 0; margin: 0; }
}

.canvas-info {
  padding: 8px 16px; background: #f5f7fa; border-top: 1px solid #e4e7ed;
  display: flex; gap: 24px; font-size: 12px; color: #909399; flex-wrap: wrap;
  .tip { margin-left: auto; color: #409eff; }
}
</style>

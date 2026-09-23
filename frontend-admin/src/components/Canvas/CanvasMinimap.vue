<template>
  <div class="canvas-minimap" :title="titleText">
    <div
      ref="mapRef"
      class="minimap-body"
      @mousedown="startPan"
    >
      <!-- 可滚动区域(含留白) -->
      <div class="map-scroll-region" :style="scrollRegionStyle" />
      <!-- 画布本体 -->
      <div class="map-canvas" :style="canvasStyle" />
      <!-- 当前视口 -->
      <div
        v-if="viewStyle"
        class="map-view"
        :class="{ panning: isPanning }"
        :style="viewStyle"
      />
    </div>
    <div class="minimap-label">
      {{ store.canvasPixelWidth }}×{{ store.canvasPixelHeight }}px · {{ Math.round(store.scale * 100) }}%
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onBeforeUnmount, onMounted } from 'vue'
import { useCanvasStore } from '@/stores/canvas'

const props = defineProps({
  wrapperRef: { type: Object, default: null }
})

const store = useCanvasStore()
const mapRef = ref(null)
const isPanning = ref(false)
// 真实画布的滚动/尺寸变化不会被 Vue 侦测，用计数器驱动 computed 重算
const metricsTrigger = ref(0)

// 小地图逻辑画布尺寸(预留边距)
const MAP_PAD = 10
const MAP_W = 180
const MAP_H = 110

const metrics = computed(() => {
  // 依赖收集：缩放/画布尺寸变化 + 手动触发
  void metricsTrigger.value
  void store.scale
  void store.canvasPixelWidth
  void store.canvasPixelHeight

  const wrapper = props.wrapperRef
  const scaler = wrapper?.querySelector?.('.canvas-scaler')
  const viewW = wrapper?.clientWidth || 0
  const viewH = wrapper?.clientHeight || 0
  const scrollW = wrapper?.scrollWidth || 0
  const scrollH = wrapper?.scrollHeight || 0
  const scrollLeft = wrapper?.scrollLeft || 0
  const scrollTop = wrapper?.scrollTop || 0

  // 整个可滚动内容等比映射到小地图
  const k = Math.min(
    (MAP_W - MAP_PAD * 2) / scrollW,
    (MAP_H - MAP_PAD * 2) / scrollH,
    1
  ) || 0

  const renderW = scrollW * k
  const renderH = scrollH * k
  const offsetX = (MAP_W - renderW) / 2
  const offsetY = (MAP_H - renderH) / 2

  // 画布(缩放后)在可滚动内容中的真实位置，直接取自 DOM，兼容居中边距
  let canvasRect = null
  if (wrapper && scaler) {
    const wr = wrapper.getBoundingClientRect()
    const sr = scaler.getBoundingClientRect()
    canvasRect = {
      x: sr.left - wr.left + scrollLeft,
      y: sr.top - wr.top + scrollTop
    }
  }

  return {
    k, offsetX, offsetY,
    scrollRegion: { x: offsetX, y: offsetY, w: renderW, h: renderH },
    canvas: {
      x: offsetX + (canvasRect ? canvasRect.x * k : 0),
      y: offsetY + (canvasRect ? canvasRect.y * k : 0),
      w: store.canvasPixelWidth * store.scale * k,
      h: store.canvasPixelHeight * store.scale * k
    },
    view: {
      x: offsetX + scrollLeft * k,
      y: offsetY + scrollTop * k,
      w: Math.min(viewW, scrollW) * k,
      h: Math.min(viewH, scrollH) * k
    },
    viewW, viewH, scrollW, scrollH, scrollLeft, scrollTop
  }
})

const scrollRegionStyle = computed(() => {
  const r = metrics.value.scrollRegion
  return { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` }
})

const canvasStyle = computed(() => {
  const c = metrics.value.canvas
  return { left: `${c.x}px`, top: `${c.y}px`, width: `${c.w}px`, height: `${c.h}px` }
})

const viewStyle = computed(() => {
  const v = metrics.value.view
  if (!v.w || !v.h) return null
  return { left: `${v.x}px`, top: `${v.y}px`, width: `${v.w}px`, height: `${v.h}px` }
})

const titleText = computed(() => {
  const m = metrics.value
  return `画布 ${store.canvasWidth}×${store.canvasHeight}mm（${store.canvasPixelWidth}×${store.canvasPixelHeight}px），缩放 ${Math.round(store.scale * 100)}%，可滚动区域 ${Math.round(m.scrollW)}×${Math.round(m.scrollH)}px，视口 ${Math.round(m.viewW)}×${Math.round(m.viewH)}px。拖动可滚动画布`
})

// 拖动小地图视口 => 同步真实滚动位置
const pan = (e) => {
  const wrapper = props.wrapperRef
  if (!wrapper || !mapRef.value) return
  const rect = mapRef.value.getBoundingClientRect()
  const { k, offsetX, offsetY } = metrics.value
  if (!k) return
  // 让点击位置对准视口中心（contentX/Y 是相对可滚动内容左上的坐标）
  const contentX = (e.clientX - rect.left - offsetX) / k
  const contentY = (e.clientY - rect.top - offsetY) / k
  wrapper.scrollTo({
    left: Math.max(0, contentX - wrapper.clientWidth / 2),
    top: Math.max(0, contentY - wrapper.clientHeight / 2)
  })
}

const onMouseMove = (e) => { if (isPanning.value) pan(e) }
const onMouseUp = () => { isPanning.value = false }

const startPan = (e) => {
  e.preventDefault()
  isPanning.value = true
  pan(e)
  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp, { once: true })
}

// 真实画布滚动/尺寸变化时强制刷新小地图
let raf = 0
const scheduleUpdate = () => {
  if (raf) return
  raf = requestAnimationFrame(() => { raf = 0; metricsTrigger.value++ })
}

let wrapperEl = null
const bindWrapper = () => {
  if (wrapperEl || !props.wrapperRef) return
  wrapperEl = props.wrapperRef
  wrapperEl.addEventListener('scroll', scheduleUpdate, { passive: true })
  if (typeof ResizeObserver !== 'undefined') {
    ro.observe(wrapperEl)
  } else {
    window.addEventListener('resize', scheduleUpdate)
  }
}
const ro = new ResizeObserver(scheduleUpdate)

onMounted(() => {
  bindWrapper()
  // wrapperRef 由父组件异步传入，兜底轮询几次
  const timer = setInterval(() => {
    if (props.wrapperRef) { bindWrapper(); scheduleUpdate(); clearInterval(timer) }
  }, 100)
  setTimeout(() => clearInterval(timer), 2000)
})

onBeforeUnmount(() => {
  if (wrapperEl) wrapperEl.removeEventListener('scroll', scheduleUpdate)
  ro.disconnect()
  window.removeEventListener('resize', scheduleUpdate)
  document.removeEventListener('mousemove', onMouseMove)
  document.removeEventListener('mouseup', onMouseUp)
})
</script>

<style lang="scss" scoped>
.canvas-minimap {
  position: absolute;
  right: 16px;
  bottom: 48px;
  width: 180px;
  background: rgba(255, 255, 255, 0.94);
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
  padding: 6px;
  z-index: 20;
  user-select: none;
}

.minimap-body {
  position: relative;
  width: 180px;
  height: 110px;
  background: #f0f2f5;
  border-radius: 4px;
  cursor: pointer;
  overflow: hidden;
}

.map-scroll-region {
  position: absolute;
  background: #e4e7ed;
  border: 1px dashed #c0c4cc;
  border-radius: 2px;
  box-sizing: border-box;
}

.map-canvas {
  position: absolute;
  background: #fff;
  border: 1px solid #409eff;
  box-sizing: border-box;
  box-shadow: 0 0 4px rgba(64, 158, 255, 0.4);
}

.map-view {
  position: absolute;
  background: rgba(64, 158, 255, 0.18);
  border: 1.5px solid #409eff;
  box-sizing: border-box;
  border-radius: 2px;
  pointer-events: none;
  &.panning { background: rgba(64, 158, 255, 0.3); }
}

.minimap-label {
  margin-top: 4px;
  font-size: 11px;
  color: #606266;
  text-align: center;
}
</style>

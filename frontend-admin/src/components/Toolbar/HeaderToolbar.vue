<template>
  <div class="header-toolbar">
    <div class="toolbar-left">
      <div class="logo">
        <el-icon :size="24"><Tickets /></el-icon>
        <span>标签编辑器</span>
      </div>
      <el-divider direction="vertical" />
      <div class="canvas-size">
        <el-input-number
          :key="`w-${inputKey}`"
          v-model="width"
          size="small"
          controls-position="right"
          :class="{ 'is-invalid': invalidFields.width }"
          @input="onWidthInput"
        />
        <span class="size-label">×</span>
        <el-input-number
          :key="`h-${inputKey}`"
          v-model="height"
          size="small"
          controls-position="right"
          :class="{ 'is-invalid': invalidFields.height }"
          @input="onHeightInput"
        />
        <span class="size-unit">mm</span>
        <span class="size-unit">（允许范围 {{ store.MIN_CANVAS_MM }}-{{ store.MAX_CANVAS_MM }}mm）</span>
        <el-button type="primary" size="small" @click="applySize">应用</el-button>
      </div>
    </div>
    
    <div class="toolbar-right">
      <el-select v-model="scaleValue" size="small" style="width: 90px" @change="changeScale">
        <el-option v-for="s in scales" :key="s" :label="`${s * 100}%`" :value="s" />
      </el-select>
      <el-divider direction="vertical" />
      <el-dropdown @command="handleExport">
        <el-button type="success" size="small">
          导出<el-icon class="el-icon--right"><ArrowDown /></el-icon>
        </el-button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="bmp">导出 BMP (1-bit)</el-dropdown-item>
            <el-dropdown-item command="png">导出 PNG</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
      <el-button type="danger" size="small" @click="clearCanvas">清空</el-button>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, watch } from 'vue'
import { useCanvasStore } from '@/stores/canvas'
import { ElMessage, ElMessageBox } from 'element-plus'

const emit = defineEmits(['export'])
const store = useCanvasStore()

const width = ref(store.canvasWidth)
const height = ref(store.canvasHeight)
const scaleValue = ref(store.scale)
const scales = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4]
// 校验失败时强制重挂载输入框，避免 el-input-number 显示值与实际值不一致
const inputKey = ref(0)
const invalidFields = reactive({ width: false, height: false })

// 顶部缩放入口直接绑定 store.scale，任何入口改变缩放都会同步
watch(() => store.scale, (val) => { scaleValue.value = val })

const isInvalidSize = (v) => v === null || v === undefined || typeof v !== 'number'
  || Number.isNaN(v) || v < store.MIN_CANVAS_MM || v > store.MAX_CANVAS_MM

const onWidthInput = () => { invalidFields.width = isInvalidSize(width.value) }
const onHeightInput = () => { invalidFields.height = isInvalidSize(height.value) }

const applySize = () => {
  invalidFields.width = isInvalidSize(width.value)
  invalidFields.height = isInvalidSize(height.value)

  if (invalidFields.width || invalidFields.height) {
    const reasons = []
    if (invalidFields.width) reasons.push(`宽度无效（当前为${width.value === null || width.value === undefined ? '空' : ` ${width.value}`}）`)
    if (invalidFields.height) reasons.push(`高度无效（当前为${height.value === null || height.value === undefined ? '空' : ` ${height.value}`}）`)
    ElMessage.error(`${reasons.join('，')}；宽高须为 ${store.MIN_CANVAS_MM}-${store.MAX_CANVAS_MM}mm 之间的数值，画布未做任何更改`)
    // 还原为当前实际画布尺寸，保证输入框数值与画布一致
    width.value = store.canvasWidth
    height.value = store.canvasHeight
    invalidFields.width = false
    invalidFields.height = false
    inputKey.value++
    return
  }

  const w = width.value
  const h = height.value
  const oldWidth = store.canvasPixelWidth
  const oldHeight = store.canvasPixelHeight

  const applied = store.setCanvasSize(w, h)
  if (!applied) {
    // store 层兜底校验
    ElMessage.error(`宽高须为 ${store.MIN_CANVAS_MM}-${store.MAX_CANVAS_MM}mm 之间的数值，画布未做任何更改`)
    width.value = store.canvasWidth
    height.value = store.canvasHeight
    inputKey.value++
    return
  }

  invalidFields.width = false
  invalidFields.height = false

  const newWidth = store.canvasPixelWidth
  const newHeight = store.canvasPixelHeight

  if (store.elements.length > 0) {
    const scaleX = newWidth / oldWidth
    const scaleY = newHeight / oldHeight
    store.elements.forEach(el => {
      store.updateElement(el.id, {
        x: Math.round(el.x * scaleX),
        y: Math.round(el.y * scaleY),
        width: Math.round(el.width * scaleX),
        height: Math.round(el.height * scaleY)
      })
    })
  }
  ElMessage.success(`画布尺寸已更新为 ${w}mm × ${h}mm（${newWidth} × ${newHeight} px）`)
}

const changeScale = (val) => store.setScale(val)
const handleExport = (type) => emit('export', type)

const clearCanvas = () => {
  ElMessageBox.confirm('确定要清空画布吗？', '提示', { type: 'warning' })
    .then(() => { store.clearCanvas(); ElMessage.success('画布已清空') })
    .catch(() => {})
}

// 画布尺寸若被其他途径改动，顶部数值同步（始终与实际画布保持一致）
watch(() => [store.canvasWidth, store.canvasHeight], ([w, h]) => {
  width.value = w
  height.value = h
  invalidFields.width = false
  invalidFields.height = false
})
</script>

<style lang="scss" scoped>
.header-toolbar {
  height: 56px;
  background: #fff;
  border-bottom: 1px solid #e4e7ed;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.toolbar-left { display: flex; align-items: center; gap: 16px; }

.logo {
  display: flex; align-items: center; gap: 8px;
  font-size: 18px; font-weight: 600; color: #409eff;
}

.canvas-size {
  display: flex; align-items: center; gap: 8px;
  .size-label { color: #909399; }
  .size-unit { color: #606266; font-size: 13px; }
  :deep(.el-input-number) { width: 90px; }
  :deep(.is-invalid .el-input__wrapper) {
    box-shadow: 0 0 0 1px #f56c6c inset;
  }
}

.toolbar-right { display: flex; align-items: center; gap: 12px; }
</style>

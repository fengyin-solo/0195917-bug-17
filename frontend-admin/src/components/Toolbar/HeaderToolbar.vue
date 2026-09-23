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
          v-model="width"
          :min="store.MIN_CANVAS_SIZE"
          :max="store.MAX_CANVAS_SIZE"
          size="small"
          controls-position="right"
          :class="{ 'is-invalid-input': widthError }"
        />
        <span class="size-label">×</span>
        <el-input-number
          v-model="height"
          :min="store.MIN_CANVAS_SIZE"
          :max="store.MAX_CANVAS_SIZE"
          size="small"
          controls-position="right"
          :class="{ 'is-invalid-input': heightError }"
        />
        <span class="size-unit">mm</span>
        <span class="size-unit">（{{ store.MIN_CANVAS_SIZE }}~{{ store.MAX_CANVAS_SIZE }}mm）</span>
        <el-button type="primary" size="small" @click="applySize">应用</el-button>
      </div>
    </div>

    <div class="toolbar-right">
      <el-select :model-value="store.scale" size="small" style="width: 90px" @change="changeScale">
        <el-option
          v-for="s in scaleOptions"
          :key="s"
          :label="`${Math.round(s * 100)}%`"
          :value="s"
        />
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
import { ref, computed, watch } from 'vue'
import { useCanvasStore } from '@/stores/canvas'
import { ElMessage, ElMessageBox } from 'element-plus'

const emit = defineEmits(['export'])
const store = useCanvasStore()

const width = ref(store.canvasWidth)
const height = ref(store.canvasHeight)
const widthError = ref(false)
const heightError = ref(false)

// 预设缩放档位；若当前缩放（如"适应窗口"产生的非标准值）不在档位中，则追加一项保证工具栏始终显示真实值
const scalePresets = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4]
const scaleOptions = computed(() => {
  if (scalePresets.some(s => Math.abs(s - store.scale) < 0.001)) return scalePresets
  return [...scalePresets, store.scale].sort((a, b) => a - b)
})

// 画布尺寸一旦在 store 中变化（如外部重置），工具栏输入框立即跟随，避免数值对不上
watch(() => store.canvasWidth, (val) => { width.value = val; widthError.value = false })
watch(() => store.canvasHeight, (val) => { height.value = val; heightError.value = false })

const applySize = () => {
  widthError.value = false
  heightError.value = false

  // 宽高留空（el-input-number 清空时为 null）或超出允许范围时不执行，并说明是哪一项
  const { valid, errors } = store.validateCanvasSize(width.value, height.value)
  if (!valid) {
    if (width.value === null || width.value === undefined) widthError.value = true
    if (height.value === null || height.value === undefined) heightError.value = true
    ElMessage.error(`画布尺寸无效：${errors.join('；')}，已取消应用`)
    // 恢复为当前真实的画布尺寸，保证输入框与实际画布一致
    width.value = store.canvasWidth
    height.value = store.canvasHeight
    return
  }

  const oldWidth = store.canvasPixelWidth
  const oldHeight = store.canvasPixelHeight
  const ok = store.setCanvasSize(width.value, height.value)
  if (!ok) {
    width.value = store.canvasWidth
    height.value = store.canvasHeight
    return
  }
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
  ElMessage.success('画布尺寸已更新')
}

const changeScale = (val) => store.setScale(val)
const handleExport = (type) => emit('export', type)

const clearCanvas = () => {
  ElMessageBox.confirm('确定要清空画布吗？', '提示', { type: 'warning' })
    .then(() => { store.clearCanvas(); ElMessage.success('画布已清空') })
    .catch(() => {})
}
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
  :deep(.is-invalid-input .el-input__wrapper) {
    box-shadow: 0 0 0 1px #f56c6c inset;
  }
}

.toolbar-right { display: flex; align-items: center; gap: 12px; }
</style>

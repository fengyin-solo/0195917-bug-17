import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

const MM_TO_DOT = 8
export { MM_TO_DOT }
const MIN_CANVAS_SIZE = 10
const MAX_CANVAS_SIZE = 200
const MIN_SCALE = 0.25
const MAX_SCALE = 4

export const useCanvasStore = defineStore('canvas', () => {
  const canvasWidth = ref(80)
  const canvasHeight = ref(60)
  const scale = ref(1)
  const elements = ref([])
  const selectedElementId = ref(null)
  const selectedElementIds = ref([])
  let elementIdCounter = 0

  const canvasPixelWidth = computed(() => canvasWidth.value * MM_TO_DOT)
  const canvasPixelHeight = computed(() => canvasHeight.value * MM_TO_DOT)

  const selectedElement = computed(() => {
    if (!selectedElementId.value) return null
    return elements.value.find(el => el.id === selectedElementId.value)
  })

  const selectedElements = computed(() => {
    return elements.value.filter(el => selectedElementIds.value.includes(el.id))
  })

  // 校验宽高（单位 mm），返回 { valid, errors }，留空或超出允许范围均视为无效
  function validateCanvasSize(width, height) {
    const errors = []
    const isValidNum = (v) => typeof v === 'number' && Number.isFinite(v)
    if (!isValidNum(width)) {
      errors.push('宽度不能为空')
    } else if (width < MIN_CANVAS_SIZE || width > MAX_CANVAS_SIZE) {
      errors.push(`宽度必须在 ${MIN_CANVAS_SIZE} ~ ${MAX_CANVAS_SIZE} mm 之间`)
    }
    if (!isValidNum(height)) {
      errors.push('高度不能为空')
    } else if (height < MIN_CANVAS_SIZE || height > MAX_CANVAS_SIZE) {
      errors.push(`高度必须在 ${MIN_CANVAS_SIZE} ~ ${MAX_CANVAS_SIZE} mm 之间`)
    }
    return { valid: errors.length === 0, errors }
  }

  // 设置画布尺寸，校验不通过时不执行，返回 false
  function setCanvasSize(width, height) {
    const { valid } = validateCanvasSize(width, height)
    if (!valid) return false
    canvasWidth.value = width
    canvasHeight.value = height
    return true
  }

  function setScale(newScale) {
    const parsed = Number(newScale)
    if (!Number.isFinite(parsed)) return
    scale.value = Math.max(MIN_SCALE, Math.min(MAX_SCALE, parsed))
  }

  function addElement(element) {
    const id = `element_${++elementIdCounter}`
    const newElement = {
      id,
      ...element,
      x: element.x || 10,
      y: element.y || 10,
      width: element.width || 100,
      height: element.height || 30,
      rotation: element.rotation || 0,
      locked: false,
      visible: true
    }
    elements.value.push(newElement)
    selectElement(id)
    return id
  }

  function updateElement(id, updates) {
    const index = elements.value.findIndex(el => el.id === id)
    if (index !== -1) {
      elements.value[index] = { ...elements.value[index], ...updates }
    }
  }

  function deleteElement(id) {
    const index = elements.value.findIndex(el => el.id === id)
    if (index !== -1) {
      elements.value.splice(index, 1)
      selectedElementIds.value = selectedElementIds.value.filter(eid => eid !== id)
      
      // 删除后选中第一个元件
      if (elements.value.length > 0) {
        const firstElement = elements.value[elements.value.length - 1]
        selectedElementId.value = firstElement.id
        selectedElementIds.value = [firstElement.id]
      } else {
        selectedElementId.value = null
        selectedElementIds.value = []
      }
    }
  }

  function selectElement(id, multiSelect = false) {
    if (multiSelect) {
      if (selectedElementIds.value.includes(id)) {
        selectedElementIds.value = selectedElementIds.value.filter(eid => eid !== id)
        if (selectedElementIds.value.length > 0) {
          selectedElementId.value = selectedElementIds.value[selectedElementIds.value.length - 1]
        } else {
          selectedElementId.value = null
        }
      } else {
        selectedElementIds.value.push(id)
        selectedElementId.value = id
      }
    } else {
      selectedElementId.value = id
      selectedElementIds.value = id ? [id] : []
    }
  }

  function clearSelection() {
    selectedElementId.value = null
    selectedElementIds.value = []
  }

  // 多选元件之间对齐
  function alignElements(alignment) {
    const selected = selectedElements.value
    if (selected.length < 2) return

    switch (alignment) {
      case 'left': {
        const minX = Math.min(...selected.map(el => el.x))
        selected.forEach(el => updateElement(el.id, { x: minX }))
        break
      }
      case 'right': {
        const maxRight = Math.max(...selected.map(el => el.x + el.width))
        selected.forEach(el => updateElement(el.id, { x: maxRight - el.width }))
        break
      }
      case 'center-h': {
        const minX = Math.min(...selected.map(el => el.x))
        const maxRight = Math.max(...selected.map(el => el.x + el.width))
        const centerX = (minX + maxRight) / 2
        selected.forEach(el => updateElement(el.id, { x: Math.round(centerX - el.width / 2) }))
        break
      }
      case 'top': {
        const minY = Math.min(...selected.map(el => el.y))
        selected.forEach(el => updateElement(el.id, { y: minY }))
        break
      }
      case 'bottom': {
        const maxBottom = Math.max(...selected.map(el => el.y + el.height))
        selected.forEach(el => updateElement(el.id, { y: maxBottom - el.height }))
        break
      }
      case 'center-v': {
        const minY = Math.min(...selected.map(el => el.y))
        const maxBottom = Math.max(...selected.map(el => el.y + el.height))
        const centerY = (minY + maxBottom) / 2
        selected.forEach(el => updateElement(el.id, { y: Math.round(centerY - el.height / 2) }))
        break
      }
    }
  }

  function duplicateElement(id) {
    const element = elements.value.find(el => el.id === id)
    if (!element) return

    const newElement = {
      ...element,
      x: Math.min(element.x + 20, canvasPixelWidth.value - element.width),
      y: Math.min(element.y + 20, canvasPixelHeight.value - element.height)
    }
    delete newElement.id
    return addElement(newElement)
  }

  function clearCanvas() {
    elements.value = []
    selectedElementId.value = null
    selectedElementIds.value = []
  }

  return {
    canvasWidth,
    canvasHeight,
    scale,
    elements,
    selectedElementId,
    selectedElementIds,
    canvasPixelWidth,
    canvasPixelHeight,
    selectedElement,
    selectedElements,
    validateCanvasSize,
    setCanvasSize,
    setScale,
    addElement,
    updateElement,
    deleteElement,
    selectElement,
    clearSelection,
    alignElements,
    duplicateElement,
    clearCanvas,
    MM_TO_DOT,
    MIN_CANVAS_SIZE,
    MAX_CANVAS_SIZE,
    MIN_SCALE,
    MAX_SCALE
  }
})

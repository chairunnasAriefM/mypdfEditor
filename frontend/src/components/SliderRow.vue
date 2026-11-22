<script setup>
const props = defineProps({
  label: String,
  modelValue: Number,
  min: Number,
  max: Number,
  step: { type: Number, default: 1 },
  unit: { type: String, default: '' }
})
const emit = defineEmits(['update:modelValue'])

function set(v) {
  let n = Number(v)
  if (Number.isNaN(n)) return
  n = Math.min(props.max, Math.max(props.min, n))
  emit('update:modelValue', n)
}
</script>

<template>
  <div class="row">
    <div class="head">
      <span>{{ label }}</span>
      <span class="num">
        <input type="number" :min="min" :max="max" :step="step" :value="modelValue" @input="set($event.target.value)" />
        <i>{{ unit }}</i>
      </span>
    </div>
    <input class="range" type="range" :min="min" :max="max" :step="step" :value="modelValue" @input="set($event.target.value)" />
  </div>
</template>

<style scoped>
.row { margin-bottom: 12px; }
.head { display: flex; align-items: center; justify-content: space-between; font-size: 12.5px; color: var(--ink-soft); margin-bottom: 4px; }
.num { display: flex; align-items: center; gap: 4px; }
.num input {
  width: 62px; padding: 3px 6px; text-align: right; font-size: 12.5px;
  border: 1px solid var(--line); border-radius: 8px; background: var(--tile); color: var(--ink);
}
.num i { font-style: normal; width: 16px; font-size: 11.5px; }
.range { width: 100%; accent-color: var(--accent); }
</style>

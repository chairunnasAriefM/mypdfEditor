<script setup>
import { FileUp, RotateCcw } from 'lucide-vue-next'
defineProps({ pdf: Object, pageCount: Number })
defineEmits(['pick', 'reset'])
</script>

<template>
  <button v-if="!pdf" class="pdz" @click="$emit('pick')">
    <FileUp :size="20" />
    <b>Seret file PDF ke sini</b>
    <small>atau klik untuk memilih</small>
  </button>
  <div v-else class="pfile">
    <span class="nm" :title="pdf.name">{{ pdf.name }}</span>
    <span class="meta">{{ pageCount || '…' }} hlm • {{ pdf.sizeMB.toFixed(2) }} MB</span>
    <button class="pbtn pghost" @click="$emit('pick')">Ganti</button>
    <button class="pbtn pghost" title="Kosongkan file" @click="$emit('reset')"><RotateCcw :size="14" /></button>
  </div>
</template>

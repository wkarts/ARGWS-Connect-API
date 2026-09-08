<script setup lang="ts">
import AppShell from '@/layouts/AppShell.vue'
import PageHeader from '@/components/PageHeader.vue'
import AppIcon from '@/components/AppIcon.vue'

const documentationUrl = '/manager/docs/'

function openDocumentation() {
  window.open(documentationUrl, '_blank', 'noopener,noreferrer')
}
</script>

<template>
  <AppShell>
    <PageHeader title="Documentação" description="Consulte a referência de uso da API diretamente nesta instalação.">
      <button class="btn ghost" @click="openDocumentation">
        <AppIcon name="arrow" :size="16" />Abrir em nova aba
      </button>
    </PageHeader>

    <div class="docs-embed">
      <iframe
        :src="documentationUrl"
        title="Documentação da API Connect|API"
        loading="eager"
        referrerpolicy="same-origin"
      ></iframe>
    </div>
  </AppShell>
</template>

<style scoped>
.docs-embed {
  width: 100%;
  min-height: calc(100vh - 190px);
  border: 1px solid var(--border, #dbe4ef);
  border-radius: 14px;
  overflow: hidden;
  background: var(--surface, #fff);
}

.docs-embed iframe {
  display: block;
  width: 100%;
  min-height: calc(100vh - 190px);
  border: 0;
  background: #fff;
}

@media (max-width: 760px) {
  .docs-embed,
  .docs-embed iframe {
    min-height: calc(100vh - 150px);
  }
}
</style>

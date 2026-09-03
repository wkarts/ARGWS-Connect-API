<script setup lang="ts">
import LandingBuilder from '../components/landing/LandingBuilder.vue'
</script>

<template>
  <LandingBuilder
    api-base="/control/v1/landing"
    public-url="https://connect-api.example.com"
    plans-endpoint="/control/v1/plans"
  />
</template>

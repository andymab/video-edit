<template>
  <v-card class="pa-6">
    <v-card-title class="text-h5">О проекте</v-card-title>
    <v-card-text class="text-body-1">
      Браузерный видеоредактор на Vue 3 + Vuetify 3 + Vite. Сборка и запуск в Docker (Node 24).
      В планах: обрезка без перекодирования, склейка клипов, снимки кадров и простые оверлеи.
    </v-card-text>

    <v-divider class="my-4" />

    <v-list density="comfortable">
      <v-list-item title="Технологии" subtitle="Vue 3, Vuetify 3, Vite, Docker, @ffmpeg/ffmpeg" />
      <v-list-item title="Статус" subtitle="MVP, в активной разработке" />
      <v-list-item title="Лицензия" subtitle="MIT (можно поменять под ваши условия)" />
    </v-list>
  </v-card>
</template>

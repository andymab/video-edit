<template>
  <v-card class="pa-6">
    <v-card-title class="text-h5">Добро пожаловать в Video Edit</v-card-title>
    <v-card-text class="text-body-1">
      Лёгкий видеоредактор в браузере на Vue 3 + Vuetify 3.
      Перейдите в «Редактор», чтобы попробовать базовые операции.
    </v-card-text>

    <v-divider class="my-4" />

    <v-row>
      <v-col cols="12" md="6">
        <v-list lines="two" density="comfortable">
          <v-list-subheader>Что умеет MVP</v-list-subheader>
          <v-list-item title="Обрезка по времени" subtitle="Быстро, без лишних шагов" />
          <v-list-item title="Склейка клипов" subtitle="Несколько роликов — один файл" />
          <v-list-item title="Снимок кадра" subtitle="Экспорт картинки из видео" />
        </v-list>
      </v-col>
      <v-col cols="12" md="6">
        <v-alert type="info" variant="tonal">
          Обработка идёт локально в браузере — файлы не отправляются на сервер.
        </v-alert>
      </v-col>
    </v-row>

    <div class="mt-6 d-flex ga-3">
      <v-btn color="primary" :to="{ name: 'editor' }" component="RouterLink">Открыть редактор</v-btn>
      <v-btn variant="text" :to="{ name: 'about' }" component="RouterLink">О проекте</v-btn>
    </div>
  </v-card>
</template>

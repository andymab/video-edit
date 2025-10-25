<template>
  <v-app>
    <v-app-bar flat border>
      <v-app-bar-title>Video Edit</v-app-bar-title>
      <v-spacer />
      <v-btn variant="text" :to="{ name: 'home' }" component="RouterLink">Главная</v-btn>
      <v-btn variant="text" :to="{ name: 'editor' }" component="RouterLink">Редактор</v-btn>
      <v-btn variant="text" :to="{ name: 'about' }" component="RouterLink">О проекте</v-btn>
    </v-app-bar>

    <v-main>
      <v-container class="py-8">
        <RouterView />
      </v-container>
    </v-main>
  </v-app>
</template>

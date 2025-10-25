import { createRouter, createWebHistory } from 'vue-router'

// ленивые чанк-импорты
const Home   = () => import('@/pages/Home.vue')
const Editor = () => import('@/pages/Editor.vue')
const About  = () => import('@/pages/About.vue')

// 404
const NotFound = { template: '<div class="pa-6 text-h5">Страница не найдена</div>' }

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', name: 'home', component: Home, meta: { title: 'Главная' } },
    { path: '/editor', name: 'editor', component: Editor, meta: { title: 'Редактор' } },
    { path: '/about', name: 'about', component: About, meta: { title: 'О проекте' } },
    { path: '/:pathMatch(.*)*', name: 'not-found', component: NotFound }
  ],
  scrollBehavior() { return { top: 0 } }
})

// (опционально) динамический заголовок вкладки
router.afterEach((to) => {
  if (to.meta?.title) document.title = `Video Edit — ${to.meta.title}`
})

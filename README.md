Вот компактный, но полный README для твоего проекта. Можешь положить его в корень как `README.md`.

---

# Video Edit (Vue 3 + Vite + Vuetify 3 + FFmpeg.wasm)

Лёгкое веб-приложение для базового видеомонтажа прямо в браузере:

* **Обрезка** (Trim) — выделение отрезка по времени, быстрый путь `-c copy` + авто-фолбэк на перекодирование.
* **Склейка** (Merge) — объединение нескольких клипов, попытка без перекодирования (concat demuxer) + фолбэк на перекодирование (concat filter → H.264/AAC).
* **Всё локально в браузере** на `@ffmpeg/ffmpeg` (FFmpeg.wasm).
* UI на **Vuetify 3**, маршруты на **Vue Router 4**, сборка **Vite**.

## Стек

* Vue 3, Vue Router 4, Vuetify 3
* Vite 7
* `@ffmpeg/ffmpeg@0.12.10`, `@ffmpeg/util`
* Docker (Node 24-alpine) — dev и preview (prod build)

---

## Быстрый старт

### Вариант A — через Docker (рекомендуется)

Требуется **Docker Desktop**.

1. Клонируй проект и перейди в папку:

```bash
git clone https://github.com/andymab/video-edit.git
cd video-edit
```

2. Подними dev-контейнер:

```bash
docker compose up --build web
```

3. Открой в браузере:

```
http://localhost:5173/
```

> Если правки в файлах **не подхватываются автоматически** на Windows — см. раздел **Hot reload в Docker на Windows** ниже.

### Вариант B — локально (без Docker)

Требуется **Node 18+** (лучше 20/22/24).

```bash
npm install
npm run dev
# открой http://localhost:5173
```

---

## Структура проекта

```
src/
  components/
    MergeEditor.vue     # отдельный компонент склейки клипов
  pages/
    Editor.vue          # страница с вкладками Trim / Merge / Snapshot
  router/
    index.js            # маршруты: '/', '/editor', '/about'
  plugins/
    vuetify.js
App.vue
main.js
vite.config.js
Dockerfile
docker-compose.yml
```

---

## Команды

```bash
# Dev (локально)
npm run dev

# Type-check (если добавишь TS)
npm run type-check

# Build (прод сборка)
npm run build

# Предпросмотр билдов (локально)
npm run preview

# Dev через Docker
docker compose up --build web

# Prod-превью через Docker (если описан сервис web-prod)
docker compose up --build web-prod
```

---

## Настройки Vite / алиасы / HMR

* Алиас `@` указывает на `src/` (см. `vite.config.js` → `resolve.alias`).
* Для Docker на Windows включён **polling** вотчер (см. пример ниже).

Пример рекомендуемого `server` блока (файл `vite.config.js`):

```js
server: {
  host: true,            // 0.0.0.0
  port: 5173,
  watch: { usePolling: true, interval: 300 }, // для Docker на Windows
  hmr: { host: 'localhost', port: 5173 },     // при необходимости выставь IP хоста
}
```

---

## FFmpeg.wasm — как это работает

Проект использует **новый API**:

```js
import { FFmpeg } from '@ffmpeg/ffmpeg'
import { toBlobURL, fetchFile } from '@ffmpeg/util'

const ffmpeg = new FFmpeg()
// загрузка ядра:
await ffmpeg.load({
  coreURL: await toBlobURL('https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.js', 'text/javascript'),
  wasmURL: await toBlobURL('https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.wasm', 'application/wasm'),
})
// запись/выполнение/чтение:
await ffmpeg.writeFile('in.mp4', await fetchFile(file))
await ffmpeg.exec(['-i', 'in.mp4', /* ... */ , 'out.mp4'])
const data = await ffmpeg.readFile('out.mp4')
```

По умолчанию ядро тянется с CDN (`unpkg`). Если сеть/политики это блокируют, можно добавить **локальный fallback**:

1. Скопируй файлы ядра в проект:

```
public/ffmpeg/esm/ffmpeg-core.js
public/ffmpeg/esm/ffmpeg-core.wasm
```

(их можно взять из `node_modules/@ffmpeg/core/dist/esm/`)

2. Код уже умеет переключаться на `/ffmpeg/esm` при ошибке CDN.

---

## Hot reload в Docker на Windows

Docker Desktop на Windows не всегда присылает события изменения файлов в контейнер. Поэтому нужен polling:

В `vite.config.js`:

```js
server: {
  host: true,
  port: 5173,
  watch: { usePolling: true, interval: 300 },
  hmr: { host: 'localhost', port: 5173 }, // при необходимости укажи IP хоста
}
```

В `docker-compose.yml` (пример):

```yaml
services:
  web:
    build:
      context: .
      target: dev
    ports:
      - "5173:5173"
    volumes:
      - .:/app
      - /app/node_modules
    environment:
      CHOKIDAR_USEPOLLING: "1"
      WATCHPACK_POLLING: "1"
      VITE_HMR_HOST: "localhost"
```

Перезапусти:

```bash
docker compose down
docker compose up --build web
```

---

## Использование

* Открой `/editor`.

* Вкладка **Обрезка**:

  1. Выбери файл.
  2. Введи `Старт` / `Конец` (или поставь по текущей позиции).
  3. Нажми «Обрезать».
     Сначала пытается `-c copy` (без перекодирования), если кодеки/границы не подходят — фолбэк на H.264/AAC.
  4. Скачай `out.mp4`.

* Вкладка **Склейка**:

  1. Добавь 2+ клипа (множественный выбор).
  2. Отсортируй (стрелки ↑/↓), при желании удали/очисти.
  3. Нажми «Склеить».
     Сначала `-f concat -c copy` (без перекодирования). Если не подходит — перекодирование (concat filter).
  4. Скачай `merged.mp4`.

> Вкладка **Снимок кадра** — заглушка, можно быстро добавить командой `-ss ... -vframes 1 frame.jpg`.

---

## Частые вопросы / проблемы

**1) FFmpeg не загружается / пишет про wasm**
Проверь доступность:

* `https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.js`
* `https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.wasm`
  Если блокируется, добавь локальный fallback (см. раздел про FFmpeg.wasm выше).

**2) Ошибка `Cannot read private member #...`**
Экземпляр `FFmpeg` нельзя «реактивить». Вынеси из реактивности (`markRaw(new FFmpeg())`) — в проекте это уже учтено.

**3) HMR не ловит изменения**
Включи polling (см. раздел про Hot reload в Docker на Windows) и перезапусти контейнер.

**4) Большие файлы/мало памяти**
FFmpeg.wasm работает в памяти вкладки. Для больших файлов операция может быть долгой/память — ограниченной. Рекомендуется использовать короткие клипы или повышать лимиты браузера (не всегда возможно).

**5) Конкатенация без перекодирования не работает**
Demuxer `concat` требует одинаковые параметры (кодек/профиль/fps/размер/аудио). В таких случаях проект автоматически переключается на перекодирование (`libx264`+`aac`).

---

## Продакшн-сборка и предпросмотр

Локально:

```bash
npm run build
npm run preview
# http://localhost:4173
```

Через Docker (если есть таргет `web-prod`):

```bash
docker compose up --build web-prod
# http://localhost:4173
```

---

## Лицензия

MIT .
FFmpeg под LGPL/GPL — в проекте используется сборка FFmpeg.wasm. Проверь соответствие лицензированию под твой кейс.

---


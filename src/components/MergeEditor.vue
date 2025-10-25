<template>
  <v-sheet class="pa-4" rounded="lg" border>
    <div class="text-subtitle-1 mb-3">Склейка клипов</div>

    <v-file-input label="Клипы (можно несколько)" accept="video/*" prepend-icon="mdi-movie" :multiple="true"
      @update:model-value="onMergeFilesChange" />

    <v-alert v-if="files.length === 0" type="info" variant="tonal" class="mt-3">
      Добавьте 2+ клипа. Порядок можно менять стрелками.
    </v-alert>

    <div v-else class="mt-3">
      <v-list density="compact" lines="one" class="border rounded">
        <v-list-item v-for="(f, i) in files" :key="i" :title="f.name" :subtitle="formatSize(f.size)">
          <template #append>
            <v-btn icon="mdi-arrow-up" size="small" variant="text" @click="moveUp(i)" :disabled="i === 0" />
            <v-btn icon="mdi-arrow-down" size="small" variant="text" @click="moveDown(i)"
              :disabled="i === files.length - 1" />
            <v-btn icon="mdi-close" size="small" variant="text" @click="removeAt(i)" />
          </template>
        </v-list-item>
      </v-list>

      <div class="d-flex flex-wrap ga-3 mt-3">
        <v-btn color="primary" :loading="working || ffLoading" :disabled="files.length < 2 || working || ffLoading"
          @click="merge">
          Склеить
        </v-btn>
        <v-btn variant="text" @click="clearList" :disabled="working || ffLoading">Очистить список</v-btn>
      </div>

      <v-progress-linear v-if="working || ffLoading" class="mt-4" :model-value="ffProgress" height="8" striped
        rounded />

      <v-alert v-if="message" type="info" variant="tonal" class="mt-3">
        {{ message }}
      </v-alert>

      <div v-if="outputUrl" class="mt-6">
        <div class="text-subtitle-1 mb-2">Результат</div>
        <video :src="outputUrl" controls style="width:100%; max-height:360px;" />
        <div class="mt-2">
          <a :href="outputUrl" download="merged.mp4">Скачать merged.mp4</a>
        </div>
      </div>
    </div>
  </v-sheet>
</template>

<script>
import { markRaw } from 'vue'
import { getFFmpeg } from '@/lib/ffmpeg'

export default {
  name: 'MergeEditor',
  data() {
    return {
      files: [],
      outputUrl: '',
      message: '',

      // ffmpeg
      ffReady: false,
      ffLoading: false,
      ffProgress: 0,
      _ffmpeg: null,
      _progressHookSet: false,
      _coreURL: null,
      _wasmURL: null,

      working: false,
    }
  },
  methods: {
    // ====== FFmpeg: CDN → fallback локально ======
    async ensureFFmpeg() {
      if (this.ffReady || this.ffLoading) return
      this.ffLoading = true
      this.ffProgress = 0
      this.message = 'Загрузка FFmpeg…'
      try {
        const inst = await getFFmpeg()      // ← единый синглтон
        this._ffmpeg = markRaw(inst)
        // навешиваем прогресс-слушатель один раз на компонент
        if (!this._progressHookSet && this._ffmpeg?.on) {
          this._ffmpeg.on('progress', ({ progress }) => {
            // progress ∈ [0..1]
            this.ffProgress = Math.round(((progress || 0) * 100))
          })
          this._progressHookSet = true
        }
        this.ffReady = true
        this.message = ''
      } catch (e) {
        console.error('[Merge/ensureFFmpeg]', e)
        this.message = `Не удалось загрузить FFmpeg: ${e?.message || e}`
      } finally {
        this.ffLoading = false
      }
    },

    // ====== UI helpers ======
    onMergeFilesChange(value) {
      const arr = Array.isArray(value) ? value : (value ? [value] : [])
      if (this.outputUrl) {
        URL.revokeObjectURL(this.outputUrl)
        this.outputUrl = ''
      }
      this.files = [...this.files, ...arr]
      this.message = ''
      void this.ensureFFmpeg()
    },
    moveUp(i) {
      if (i <= 0) return
      const a = this.files.slice()
        ;[a[i - 1], a[i]] = [a[i], a[i - 1]]
      this.files = a
    },
    moveDown(i) {
      if (i >= this.files.length - 1) return
      const a = this.files.slice()
        ;[a[i + 1], a[i]] = [a[i], a[i + 1]]
      this.files = a
    },
    removeAt(i) {
      const a = this.files.slice()
      a.splice(i, 1)
      this.files = a
    },
    clearList() {
      this.files = []
      if (this.outputUrl) {
        URL.revokeObjectURL(this.outputUrl)
        this.outputUrl = ''
      }
      this.message = ''
    },
    formatSize(bytes) {
      if (!Number.isFinite(bytes)) return ''
      const units = ['B', 'KB', 'MB', 'GB']
      let i = 0, n = bytes
      while (n >= 1024 && i < units.length - 1) { n /= 1024; i++ }
      return `${n.toFixed(1)} ${units[i]}`
    },

    // ====== Merge ======
    async merge() {
      if (this.files.length < 2) {
        this.message = 'Добавьте минимум два клипа.'
        return
      }
      await this.ensureFFmpeg()
      if (!this.ffReady || !this._ffmpeg) {
        this.message = 'FFmpeg не готов. Попробуйте снова.'
        return
      }

      this.working = true
      this.message = 'Подготовка файлов…'
      if (this.outputUrl) {
        URL.revokeObjectURL(this.outputUrl)
        this.outputUrl = ''
      }

      try {
        const { fetchFile } = await import('@ffmpeg/util')

        // 1) Пишем клипы во внутреннюю FS
        for (let i = 0; i < this.files.length; i++) {
          const name = `clip${i}.mp4`
          await this._ffmpeg.writeFile(name, await fetchFile(this.files[i]))
        }

        // 2) Быстрая склейка: concat demuxer (без перекодирования)
        this.message = 'Склейка без перекодирования…'
        const listContent = this.files.map((_, i) => `file 'clip${i}.mp4'`).join('\n')
        const enc = new TextEncoder()
        await this._ffmpeg.writeFile('list.txt', enc.encode(listContent))

        let success = true
        try {
          await this._ffmpeg.exec([
            '-f', 'concat', '-safe', '0',
            '-i', 'list.txt',
            '-c', 'copy',
            'out-merge.mp4'
          ])
        } catch (e) {
          console.warn('[merge] concat demuxer failed, re-encoding…', e)
          success = false
        }

        // 3) Фолбэк: перекодирование через concat filter
        if (!success) {
          this.message = 'Перекодирование и склейка… (может занять время)'
          const inputs = []
          for (let i = 0; i < this.files.length; i++) {
            inputs.push('-i', `clip${i}.mp4`)
          }
          const n = this.files.length
          const filter = `concat=n=${n}:v=1:a=1 [v][a]`

          await this._ffmpeg.exec([
            ...inputs,
            '-filter_complex', filter,
            '-map', '[v]', '-map', '[a]',
            '-vf', 'format=yuv420p',
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
            '-c:a', 'aac', '-b:a', '160k',
            'out-merge.mp4'
          ])
        }

        // 4) Результат
        const data = await this._ffmpeg.readFile('out-merge.mp4')
        this.outputUrl = URL.createObjectURL(new Blob([data.buffer], { type: 'video/mp4' }))
        this.message = 'Готово!'
      } catch (e) {
        console.error('[merge] error:', e)
        this.message = `Ошибка склейки: ${e?.message || e}`
      } finally {
        // Чистим временные
        try { await this._ffmpeg.deleteFile('out-merge.mp4') } catch { }
        try { await this._ffmpeg.deleteFile('list.txt') } catch { }
        for (let i = 0; i < this.files.length; i++) {
          try { await this._ffmpeg.deleteFile(`clip${i}.mp4`) } catch { }
        }
        this.working = false
      }
    },
  },
  beforeUnmount() {
    if (this.outputUrl) URL.revokeObjectURL(this.outputUrl)
  },
}
</script>

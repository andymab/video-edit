<template>
  <v-sheet class="pa-4" rounded="lg" border>
    <div class="text-subtitle-1 mb-3">Склейка клипов</div>

    <v-file-input
      label="Клипы и изображения (можно несколько)"
      accept="video/*,image/jpeg,image/png,image/webp"
      prepend-icon="mdi-movie"
      :multiple="true"
      @update:model-value="onMergeFilesChange"
    />

    <div class="mt-2">
      <v-checkbox
        v-model="draftMode"
        label="Черновая склейка (быстрее, ниже качество)"
        density="compact"
        hide-details
      />
    </div>

    <v-alert v-if="files.length === 0" type="info" variant="tonal" class="mt-3">
      Добавьте 2+ элементов (видео или изображения). Порядок можно менять стрелками.
    </v-alert>

    <div v-else class="mt-3">
      <v-list density="compact" lines="one" class="border rounded">
        <v-list-item
          v-for="(f, i) in files"
          :key="i"
          :title="f.name"
          :subtitle="formatSize(f.size) + ' • ' + (isImage(f) ? 'image' : 'video')"
        >
          <template #append>
            <v-btn icon="mdi-arrow-up"   size="small" variant="text" @click="moveUp(i)"   :disabled="i === 0" />
            <v-btn icon="mdi-arrow-down" size="small" variant="text" @click="moveDown(i)" :disabled="i === files.length - 1" />
            <v-btn icon="mdi-close"      size="small" variant="text" @click="removeAt(i)" />
          </template>
        </v-list-item>
      </v-list>

      <div class="d-flex flex-wrap ga-3 mt-3">
        <v-btn
          color="primary"
          :loading="working || ffLoading"
          :disabled="files.length < 2 || working || ffLoading"
          @click="merge"
        >
          Склеить
        </v-btn>
        <v-btn variant="text" @click="clearList" :disabled="working || ffLoading">Очистить список</v-btn>
      </div>

      <v-progress-linear
        v-if="working || ffLoading"
        class="mt-4"
        :model-value="ffProgress"
        height="8"
        striped
        rounded
      />

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

      working: false,

      // настройки нормализации (по умолчанию — «качественный» режим)
      targetW: 1280,
      targetH: 720,
      fps: 30,
      imageDurationSec: 5,

      // режим черновика
      draftMode: false,
    }
  },
  methods: {
    // ====== FFmpeg (синглтон) ======
    async ensureFFmpeg() {
      if (this.ffReady || this.ffLoading) return
      this.ffLoading = true
      this.ffProgress = 0
      this.message = 'Загрузка FFmpeg…'
      try {
        const inst = await getFFmpeg()
        this._ffmpeg = markRaw(inst)
        if (!this._progressHookSet && this._ffmpeg?.on) {
          this._ffmpeg.on('progress', ({ progress }) => {
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
    isImage(file) {
      const t = (file?.type || '').toLowerCase()
      if (t.startsWith('image/')) return true
      const name = (file?.name || '').toLowerCase()
      return /\.(jpg|jpeg|png|webp)$/.test(name)
    },

    // ====== Merge (видео + изображения) ======
    async merge() {
      if (this.files.length < 2) {
        this.message = 'Добавьте минимум два клипа/изображения.'
        return
      }
      await this.ensureFFmpeg()
      if (!this.ffReady || !this._ffmpeg) {
        this.message = 'FFmpeg не готов. Попробуйте снова.'
        return
      }

      // Параметры по режимам
      const isDraft = this.draftMode
      const W   = isDraft ? 854  : this.targetW
      const H   = isDraft ? 480  : this.targetH
      const FPS = isDraft ? 24   : this.fps
      const D   = isDraft ? Math.min(3, this.imageDurationSec) : this.imageDurationSec

      // Параметры кодека по режимам
      const vcodec   = 'libx264'
      const preset   = isDraft ? 'ultrafast' : 'veryfast'
      const crf      = isDraft ? '30' : '23'
      const extraFastFlags = isDraft
        ? ['-bf', '0', '-profile:v', 'baseline', '-g', String(FPS * 10)]
        : []

      this.working = true
      this.ffProgress = 0
      this.message = isDraft ? 'Подготовка (черновик)…' : 'Подготовка…'
      if (this.outputUrl) {
        URL.revokeObjectURL(this.outputUrl)
        this.outputUrl = ''
      }

      const segNames = []
      try {
        const { fetchFile } = await import('@ffmpeg/util')

        // Унифицированный фильтр кадра
        const vf = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`

        // 1) Готовим унифицированные сегменты (видео и фото)
        for (let i = 0; i < this.files.length; i++) {
          const f = this.files[i]
          const inName = `in_${i}${this.isImage(f) ? this._extForImage(f) : this._extForVideo(f)}`
          await this._ffmpeg.writeFile(inName, await fetchFile(f))

          const seg = `seg_${i}.mp4`
          if (this.isImage(f)) {
            // изображение → короткий ролик
            const cmd = [
              '-loop', '1',
              '-t', String(D),
              '-i', inName,
              '-r', String(FPS),
              '-vf', vf,
              '-c:v', vcodec,
              '-preset', preset,
              '-crf', crf,
              ...extraFastFlags,
              '-movflags', '+faststart',
              '-an',
              seg
            ]
            // для фото можно слегка «подсказать» кодеру
            if (isDraft) cmd.splice( cmd.indexOf('-crf') + 2, 0, '-tune', 'stillimage' )
            await this._ffmpeg.exec(cmd)
          } else {
            // видео → нормализуем (без аудио)
            await this._ffmpeg.exec([
              '-i', inName,
              '-r', String(FPS),
              '-vf', vf,
              '-c:v', vcodec,
              '-preset', preset,
              '-crf', crf,
              ...extraFastFlags,
              '-movflags', '+faststart',
              '-an',
              seg
            ])
          }
          segNames.push(seg)
          try { await this._ffmpeg.deleteFile(inName) } catch {}
        }

        // 2) Склейка concat (видео=1, аудио=0)
        this.message = isDraft ? 'Склейка (черновик)…' : 'Склейка…'
        const inputs = []
        for (const s of segNames) inputs.push('-i', s)
        const n = segNames.length
        const filter = `concat=n=${n}:v=1:a=0 [v]`

        await this._ffmpeg.exec([
          ...inputs,
          '-filter_complex', filter,
          '-map', '[v]',
          '-c:v', vcodec,
          '-preset', preset,
          '-crf', crf,
          ...extraFastFlags,
          '-movflags', '+faststart',
          'out-merge.mp4'
        ])

        // 3) Результат
        const data = await this._ffmpeg.readFile('out-merge.mp4')
        this.outputUrl = URL.createObjectURL(new Blob([data.buffer], { type: 'video/mp4' }))
        this.message = isDraft ? 'Готово! (черновик, без аудио)' : 'Готово! (без аудио)'
      } catch (e) {
        console.error('[merge] error:', e)
        this.message = `Ошибка склейки: ${e?.message || e}`
      } finally {
        try { await this._ffmpeg.deleteFile('out-merge.mp4') } catch {}
        for (const s of segNames) { try { await this._ffmpeg.deleteFile(s) } catch {} }
        this.working = false
      }
    },

    _extForImage(f) {
      const name = (f?.name || '').toLowerCase()
      if (name.endsWith('.png')) return '.png'
      if (name.endsWith('.webp')) return '.webp'
      return '.jpg'
    },
    _extForVideo(f) {
      const name = (f?.name || '').toLowerCase()
      const m = name.match(/\.(mp4|mov|m4v|webm|mkv)$/)
      return m ? '.' + m[1] : '.mp4'
    },
  },
  beforeUnmount() {
    if (this.outputUrl) URL.revokeObjectURL(this.outputUrl)
  },
}
</script>

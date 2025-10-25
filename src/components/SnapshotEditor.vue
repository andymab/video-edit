<template>
  <v-sheet class="pa-4" rounded="lg" border>
    <div class="text-subtitle-1 mb-3">Снимок кадра</div>

    <v-file-input
      label="Видео для снимка"
      accept="video/*"
      prepend-icon="mdi-filmstrip"
      :multiple="false"
      @update:model-value="onFileChange"
    />

    <div v-if="src" class="my-4">
      <video
        ref="player"
        :src="src"
        controls
        preload="metadata"
        style="width:100%; max-height:360px;"
        @loadedmetadata="onLoadedMetadata"
        @timeupdate="onTimeUpdate"
      />

      <!-- Скраббер текущей позиции -->
      <div class="mt-3">
        <div class="d-flex align-center justify-space-between">
          <span class="text-caption">0</span>
          <span class="text-caption">{{ Math.floor(duration) }} c</span>
        </div>
        <v-slider
          :model-value="current"
          :min="0"
          :max="duration || 0"
          step="0.05"
          :disabled="!duration"
          @update:model-value="scrubTo"
          thumb-label
          class="mt-1"
        />
      </div>

      <!-- Параметры снимка -->
      <div class="d-flex flex-wrap ga-3 mt-4">
        <v-text-field
          v-model.number="timeSec"
          type="number"
          label="Время, сек"
          :min="0"
          :max="duration || undefined"
          style="max-width: 160px"
          hint="Оставь пустым — возьмём текущую позицию"
          persistent-hint
        />
        <v-select
          v-model="format"
          :items="formatItems"
          label="Формат"
          style="max-width: 140px"
        />
        <v-text-field
          v-model.number="quality"
          type="number"
          label="Качество (0–100)"
          :min="0" :max="100"
          style="max-width: 160px"
          hint="Для JPG/WEBP"
          persistent-hint
        />
        <v-text-field
          v-model.number="outWidth"
          type="number"
          label="Ширина (опц.)"
          :min="1"
          style="max-width: 160px"
          hint="Если пусто — исходный размер"
          persistent-hint
        />
        <v-text-field
          v-model.number="outHeight"
          type="number"
          label="Высота (опц.)"
          :min="1"
          style="max-width: 160px"
          hint="Если пусто — по пропорциям"
          persistent-hint
        />
      </div>

      <!-- Кнопки -->
      <div class="d-flex flex-wrap ga-3 mt-3">
        <v-btn color="primary" :disabled="!file || working" @click="shotCanvas">
          Снимок (Canvas)
        </v-btn>
        <v-btn color="secondary" :loading="working || ffLoading" :disabled="!file || working || ffLoading" @click="shotFFmpeg">
          Снимок (FFmpeg, точно)
        </v-btn>
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

      <!-- Результат -->
      <div v-if="outputUrl" class="mt-6">
        <div class="text-subtitle-1 mb-2">Результат</div>
        <img :src="outputUrl" alt="snapshot" style="max-width:100%; max-height:360px;" />
        <div class="mt-2">
          <a :href="outputUrl" :download="downloadName">Скачать {{ downloadName }}</a>
        </div>
      </div>
    </div>
  </v-sheet>
</template>

<script>
import { markRaw } from 'vue'

export default {
  name: 'SnapshotEditor',
  data() {
    return {
      // источник
      file: null,
      src: '',
      duration: 0,
      current: 0,

      // параметры снимка
      timeSec: null,
      format: 'jpg',         // jpg | png | webp
      quality: 90,           // для jpg/webp
      outWidth: null,
      outHeight: null,

      formatItems: [
        { title: 'JPG', value: 'jpg' },
        { title: 'PNG', value: 'png' },
        { title: 'WEBP', value: 'webp' },
      ],

      // ffmpeg
      ffReady: false,
      ffLoading: false,
      ffProgress: 0,
      _ffmpeg: null,
      _coreURL: null,
      _wasmURL: null,

      // процесс/результат
      working: false,
      message: '',
      outputUrl: '',
    }
  },

  computed: {
    downloadName() {
      return `frame.${this.format}`
    },
  },

  methods: {
    // ====== общие ======
    _revokeOutput() {
      if (this.outputUrl) {
        URL.revokeObjectURL(this.outputUrl)
        this.outputUrl = ''
      }
    },
    onFileChange(v) {
      const f = Array.isArray(v) ? v[0] : v
      this._revokeOutput()
      if (!f) {
        this.file = null
        this.src = ''
        this.duration = 0
        this.current = 0
        return
      }
      this.file = f
      this.src = URL.createObjectURL(f)
      this.message = ''
    },
    onLoadedMetadata(e) {
      const v = e.target
      this.duration = Number.isFinite(v.duration) ? v.duration : 0
      if (!Number.isFinite(this.current) || this.current < 0 || this.current > this.duration) {
        this.current = 0
      }
    },
    onTimeUpdate(e) {
      this.current = e.target.currentTime || 0
    },
    scrubTo(val) {
      const v = this.$refs.player
      if (v) v.currentTime = Number(val) || 0
    },

    // ====== Canvas snapshot (быстро) ======
    async shotCanvas() {
      if (!this.file) { this.message = 'Выберите видео.'; return }
      const video = this.$refs.player
      if (!video) return

      // при необходимости перелей таймкод
      const t = this._normalizeTime()
      if (Math.abs((video.currentTime || 0) - t) > 0.01) {
        await this._seekVideo(video, t)
      }

      // готовим размер
      const srcW = video.videoWidth || 0
      const srcH = video.videoHeight || 0
      if (!srcW || !srcH) { this.message = 'Видео не готово.'; return }

      let targetW = Number(this.outWidth) || srcW
      let targetH = Number(this.outHeight) || Math.round(srcH * (targetW / srcW))

      const can = document.createElement('canvas')
      can.width = targetW
      can.height = targetH
      const ctx = can.getContext('2d')
      ctx.drawImage(video, 0, 0, targetW, targetH)

      const mime = this.format === 'png' ? 'image/png'
                 : this.format === 'webp' ? 'image/webp'
                 : 'image/jpeg'
      const q = Math.min(1, Math.max(0, (Number(this.quality) || 90) / 100))

      const blob = await new Promise(res => can.toBlob(res, mime, q))
      if (!blob) { this.message = 'Не удалось создать снимок.'; return }

      this._revokeOutput()
      this.outputUrl = URL.createObjectURL(blob)
      this.message = 'Снимок готов (Canvas).'
    },

    _normalizeTime() {
      const t = Number(this.timeSec)
      if (!Number.isFinite(t) || t < 0) return this.current || 0
      return Math.min(t, this.duration || 0)
    },
    _seekVideo(video, t) {
      return new Promise(resolve => {
        const onSeeked = () => { video.removeEventListener('seeked', onSeeked); resolve() }
        video.addEventListener('seeked', onSeeked, { once: true })
        video.currentTime = t
      })
    },

    // ====== FFmpeg snapshot (точно) ======
    async ensureFFmpeg() {
      if (this.ffReady || this.ffLoading) return
      this.ffLoading = true
      this.ffProgress = 0
      this.message = 'Загрузка FFmpeg…'
      try {
        const { FFmpeg } = await import('@ffmpeg/ffmpeg')
        const { toBlobURL } = await import('@ffmpeg/util')

        if (!this._coreURL || !this._wasmURL) {
          const cdn = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm'
          this._coreURL = await toBlobURL(`${cdn}/ffmpeg-core.js`, 'text/javascript')
          this._wasmURL = await toBlobURL(`${cdn}/ffmpeg-core.wasm`, 'application/wasm')
        }

        this._ffmpeg = markRaw(new FFmpeg())
        this._ffmpeg.on('progress', ({ progress }) => {
          this.ffProgress = Math.round(((progress || 0) * 100))
        })

        try {
          await this._ffmpeg.load({ coreURL: this._coreURL, wasmURL: this._wasmURL })
        } catch (cdnErr) {
          console.warn('[Snapshot] CDN недоступен, пробуем локально /ffmpeg/esm', cdnErr)
          const base = '/ffmpeg/esm'
          this._coreURL = await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript')
          this._wasmURL = await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm')
          this._ffmpeg = markRaw(new FFmpeg())
          this._ffmpeg.on('progress', ({ progress }) => {
            this.ffProgress = Math.round(((progress || 0) * 100))
          })
          await this._ffmpeg.load({ coreURL: this._coreURL, wasmURL: this._wasmURL })
        }

        this.ffReady = true
        this.message = ''
      } catch (e) {
        console.error('[Snapshot/FFmpeg.load] error:', e)
        this.message = `Ошибка загрузки FFmpeg: ${e?.message || e}`
      } finally {
        this.ffLoading = false
      }
    },

    async shotFFmpeg() {
      if (!this.file) { this.message = 'Выберите видео.'; return }
      await this.ensureFFmpeg()
      if (!this.ffReady || !this._ffmpeg) { this.message = 'FFmpeg не готов.'; return }

      this.working = true
      this.ffProgress = 0
      this.message = 'Извлечение кадра…'
      this._revokeOutput()

      try {
        const { fetchFile } = await import('@ffmpeg/util')
        await this._ffmpeg.writeFile('in.mp4', await fetchFile(this.file))

        const t = this._normalizeTime()
        const outName = this.format === 'png' ? 'frame.png'
                      : this.format === 'webp' ? 'frame.webp'
                      : 'frame.jpg'
        const args = [
          '-ss', String(t),
          '-i', 'in.mp4',
          '-frames:v', '1',
        ]

        // Размер опционально
        const scaleArgs = []
        if (Number(this.outWidth) || Number(this.outHeight)) {
          const w = Number(this.outWidth) || -1
          const h = Number(this.outHeight) || -1
          scaleArgs.push('-vf', `scale=${w}:${h}`)
        }

        if (this.format === 'png') {
          await this._ffmpeg.exec([...args, ...scaleArgs, '-f', 'image2', outName])
        } else if (this.format === 'webp') {
          const q = Math.round(Math.min(100, Math.max(0, Number(this.quality) || 90)))
          await this._ffmpeg.exec([...args, ...scaleArgs, '-q:v', String(Math.round((100 - q) / 5)), outName])
        } else {
          // JPG: qscale 2..31 (меньше — лучше). Конвертируем из 0..100
          const q = Math.round(Math.min(100, Math.max(0, Number(this.quality) || 90)))
          const qscale = Math.min(31, Math.max(2, Math.round(31 - (q / 100) * 29)))
          await this._ffmpeg.exec([...args, ...scaleArgs, '-qscale:v', String(qscale), outName])
        }

        const data = await this._ffmpeg.readFile(outName)
        this.outputUrl = URL.createObjectURL(new Blob([data.buffer], { type: this._mimeByFormat(this.format) }))
        this.message = 'Готово!'
      } catch (e) {
        console.error('[shotFFmpeg] error:', e)
        this.message = `Ошибка снимка: ${e?.message || e}`
      } finally {
        try { await this._ffmpeg.deleteFile('in.mp4') } catch {}
        try { await this._ffmpeg.deleteFile('frame.jpg') } catch {}
        try { await this._ffmpeg.deleteFile('frame.png') } catch {}
        try { await this._ffmpeg.deleteFile('frame.webp') } catch {}
        this.working = false
      }
    },

    _mimeByFormat(fmt) {
      return fmt === 'png' ? 'image/png' : (fmt === 'webp' ? 'image/webp' : 'image/jpeg')
    },
  },

  beforeUnmount() {
    this._revokeOutput()
    if (this.src) URL.revokeObjectURL(this.src)
  },
}
</script>

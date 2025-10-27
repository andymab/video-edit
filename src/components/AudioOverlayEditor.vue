<template>
  <v-sheet class="pa-4" rounded="lg" border>
    <div class="text-subtitle-1 mb-3">Аудио поверх видео</div>

    <!-- Выбор видео -->
    <v-file-input
      label="Видео"
      accept="video/*"
      prepend-icon="mdi-filmstrip"
      :multiple="false"
      @update:model-value="onVideoChange"
      class="mb-3"
    />

    <!-- Предпросмотр исходного видео -->
    <div v-if="videoUrl" class="my-3">
      <div class="d-flex align-center justify-space-between">
        <div class="text-caption">Предпросмотр видео</div>
        <v-switch
          v-model="syncWithVideo"
          density="compact"
          hide-details
          inset
          :disabled="!videoUrl"
          :label="`Записывать под воспроизведение видео`"
        />
      </div>
      <video
        ref="preview"
        :src="videoUrl"
        controls
        preload="metadata"
        style="width:100%; max-height:360px;"
        @ended="onPreviewEnded"
      />
    </div>

    <v-alert v-if="!videoFile" type="info" variant="tonal" class="mb-3">
      Выберите видео, затем добавьте звук — записью с микрофона или загрузкой аудиофайла.
    </v-alert>

    <!-- Источник аудио -->
    <div class="d-flex flex-wrap ga-4" v-if="videoFile">
      <v-radio-group v-model="audioSource" inline>
        <v-radio label="Микрофон" value="mic" />
        <v-radio label="Аудиофайл" value="file" />
      </v-radio-group>
    </div>

    <!-- Микрофон -->
    <div v-if="videoFile && audioSource === 'mic'" class="mt-2">
      <v-alert
        v-if="!micSupported"
        type="warning"
        variant="tonal"
        class="mb-3"
      >
        Доступ к микрофону недоступен (нужен безопасный контекст: https или localhost,
        и разрешение браузера).
      </v-alert>

      <div class="d-flex flex-wrap ga-3">
        <v-btn
          :disabled="!micSupported || recState === 'rec' || working || ffLoading"
          color="primary"
          prepend-icon="mdi-microphone"
          @click="startRecording"
        >
          Запись
        </v-btn>
        <v-btn
          :disabled="recState !== 'rec'"
          color="error"
          prepend-icon="mdi-stop"
          @click="stopRecording"
        >
          Стоп
        </v-btn>
        <div class="text-body-2" v-if="recState === 'rec'">
          Запись идёт… {{ recDuration }}с
        </div>
        <div class="text-body-2" v-else-if="recordedBlob">
          Записано: {{ prettySize(recordedBlob.size) }}
        </div>
      </div>

      <div v-if="recordedUrl" class="mt-3">
        <audio :src="recordedUrl" controls style="width:100%;" />
      </div>
      <div v-else class="text-caption mt-2" v-if="recState !== 'rec'">
        Подсказка: при включённом переключателе выше запись начнётся вместе с воспроизведением видео, а завершится при окончании ролика.
      </div>
    </div>

    <!-- Аудиофайл -->
    <div v-if="videoFile && audioSource === 'file'" class="mt-2">
      <v-file-input
        label="Аудио (mp3, wav, m4a, webm, ogg...)"
        accept="audio/*,video/webm"
        prepend-icon="mdi-music"
        :multiple="false"
        @update:model-value="onAudioFileChange"
      />
      <div v-if="audioFile" class="mt-1 text-caption">
        Выбрано: {{ audioFile.name }} ({{ formatSize(audioFile.size) }})
      </div>
      <div v-if="audioUrl" class="mt-2">
        <audio :src="audioUrl" controls style="width:100%;" />
      </div>
    </div>

    <!-- Режим: заменить/смешать -->
    <div v-if="videoFile && hasAnyAudio" class="mt-4">
      <v-radio-group v-model="mode" inline>
        <v-radio label="Заменить исходную дорожку" value="replace" />
        <v-radio label="Смешать с исходной дорожкой" value="mix" />
      </v-radio-group>

      <div v-if="mode === 'mix'" class="d-flex flex-wrap ga-6 mt-1">
        <div style="min-width:260px">
          <div class="text-caption mb-1">Громкость оригинала</div>
          <v-slider v-model="volOrig" :min="0" :max="2" :step="0.05" thumb-label />
        </div>
        <div style="min-width:260px">
          <div class="text-caption mb-1">Громкость новой дорожки</div>
          <v-slider v-model="volNew" :min="0" :max="2" :step="0.05" thumb-label />
        </div>
      </div>
    </div>

    <!-- Кнопки -->
    <div class="d-flex flex-wrap ga-3 mt-4">
      <v-btn
        color="primary"
        :disabled="!videoFile || !hasAnyAudio || working || ffLoading"
        :loading="working || ffLoading"
        @click="applyAudio"
      >
        Применить
      </v-btn>
      <v-btn variant="text" :disabled="working || ffLoading" @click="resetAll">
        Сбросить
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

    <div v-if="outputUrl" class="mt-6">
      <div class="text-subtitle-1 mb-2">Результат</div>
      <video :src="outputUrl" controls style="width:100%; max-height:360px;" />
      <div class="mt-2">
        <a :href="outputUrl" download="with-audio.mp4">Скачать with-audio.mp4</a>
      </div>
    </div>
  </v-sheet>
</template>

<script>
import { markRaw } from 'vue'
import { getFFmpeg } from '@/lib/ffmpeg'

export default {
  name: 'AudioOverlayEditor',
  data() {
    return {
      // файлы
      videoFile: null,
      audioFile: null,
      videoUrl: '',
      audioUrl: '',

      // просмотр и синхронная запись
      syncWithVideo: true,     // «записывать под воспроизведение видео»
      _endedStopArmed: false,  // флаг: авто-стоп по окончанию видео

      // запись с микрофона
      micSupported: !!(navigator.mediaDevices && window.MediaRecorder),
      recState: 'idle',      // 'idle' | 'rec' | 'done'
      recChunks: [],
      recStartTs: 0,
      recTimer: null,
      recDuration: 0,
      recordedBlob: null,
      recordedUrl: '',
      _recorder: null,

      // режим
      audioSource: 'mic',    // 'mic' | 'file'
      mode: 'replace',       // 'replace' | 'mix'
      volOrig: 1.0,
      volNew: 1.0,

      // ffmpeg
      ffReady: false,
      ffLoading: false,
      ffProgress: 0,
      _ffmpeg: null,
      _progressHookSet: false,

      working: false,
      message: '',

      outputUrl: '',
    }
  },
  computed: {
    hasAnyAudio() {
      return this.audioSource === 'mic'
        ? !!this.recordedBlob
        : !!this.audioFile
    },
  },
  methods: {
    // ========= FFmpeg =========
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
        console.error('[AudioOverlay/ensureFFmpeg]', e)
        this.message = `Не удалось загрузить FFmpeg: ${e?.message || e}`
      } finally {
        this.ffLoading = false
      }
    },

    // ========= UI handlers =========
    onVideoChange(val) {
      const f = Array.isArray(val) ? val[0] : val
      if (this.videoUrl) URL.revokeObjectURL(this.videoUrl)
      this.videoFile = f || null
      this.videoUrl = f ? URL.createObjectURL(f) : ''
      this.message = ''
      void this.ensureFFmpeg()
    },
    onAudioFileChange(val) {
      const f = Array.isArray(val) ? val[0] : val
      if (this.audioUrl) URL.revokeObjectURL(this.audioUrl)
      this.audioFile = f || null
      this.audioUrl = f ? URL.createObjectURL(f) : ''
      this.message = ''
    },

    // ========= Recording with preview =========
    async startRecording() {
      if (!this.micSupported || this.recState === 'rec') return
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          },
          video: false
        })
        const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : (MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/ogg')
        const mr = new MediaRecorder(stream, { mimeType: mime })
        this.recChunks = []
        mr.ondataavailable = (e) => { if (e.data && e.data.size) this.recChunks.push(e.data) }
        mr.onstop = () => {
          const blob = new Blob(this.recChunks, { type: mime })
          this._setRecordedBlob(blob)
          stream.getTracks().forEach(t => t.stop())
        }
        mr.start(100) // чанки каждые 100мс
        this._recorder = mr
        this.recStartTs = Date.now()
        this.recDuration = 0
        this.recState = 'rec'
        this.recTimer = setInterval(() => {
          this.recDuration = Math.round((Date.now() - this.recStartTs) / 1000)
        }, 200)

        // синхронное воспроизведение видео при записи
        if (this.syncWithVideo) {
          const v = this.$refs.preview
          if (v) {
            try {
              v.muted = true          // чтобы не ловить фидбек из динамиков
              // если пользователь уже перемотал — пишем «с текущего»;
              // если стоим в конце, начнём с 0
              if (v.currentTime >= (v.duration || 0) - 0.05) v.currentTime = 0
              await v.play()
              this._endedStopArmed = true
            } catch (e) {
              console.warn('preview play failed', e)
            }
          }
        }
      } catch (e) {
        console.error('mic start error', e)
        this.message = 'Не удалось начать запись с микрофона.'
      }
    },
    stopRecording() {
      if (this.recState !== 'rec') return
      try { this._recorder?.stop() } catch {}
      this.recState = 'done'
      if (this.recTimer) { clearInterval(this.recTimer); this.recTimer = null }
      this._endedStopArmed = false
    },
    onPreviewEnded() {
      // если запись шла «под видео» — останавливаем запись по окончанию видео
      if (this.recState === 'rec' && this.syncWithVideo && this._endedStopArmed) {
        this.stopRecording()
      }
    },
    _setRecordedBlob(blob) {
      if (this.recordedUrl) URL.revokeObjectURL(this.recordedUrl)
      this.recordedBlob = blob
      this.recordedUrl = URL.createObjectURL(blob)
    },

    // ========= Apply =========
    async applyAudio() {
      if (!this.videoFile || !this.hasAnyAudio) return
      await this.ensureFFmpeg()
      if (!this.ffReady || !this._ffmpeg) {
        this.message = 'FFmpeg не готов.'
        return
      }

      this.working = true
      this.ffProgress = 0
      this.message = this.mode === 'replace' ? 'Замена аудио…' : 'Смешивание аудио…'
      if (this.outputUrl) { URL.revokeObjectURL(this.outputUrl); this.outputUrl = '' }

      try {
        const { fetchFile } = await import('@ffmpeg/util')

        // входы
        await this._ffmpeg.writeFile('in.mp4', await fetchFile(this.videoFile))

        let audioName = ''
        if (this.audioSource === 'mic' && this.recordedBlob) {
          audioName = 'mic.webm'
          await this._ffmpeg.writeFile(audioName, await fetchFile(this.recordedBlob))
        } else if (this.audioSource === 'file' && this.audioFile) {
          const ext = (this.audioFile.name || '').split('.').pop()?.toLowerCase() || 'bin'
          audioName = `track.${ext}`
          await this._ffmpeg.writeFile(audioName, await fetchFile(this.audioFile))
        } else {
          this.message = 'Не найден источник аудио.'
          this.working = false
          return
        }

        // команды
        if (this.mode === 'replace') {
          await this._ffmpeg.exec([
            '-i', 'in.mp4',
            '-i', audioName,
            '-map', '0:v:0',
            '-map', '1:a:0',
            '-c:v', 'copy',
            '-c:a', 'aac',
            '-b:a', '160k',
            '-shortest',
            '-movflags', '+faststart',
            'out.mp4'
          ])
        } else {
          // смешиваем с оригиналом, если она есть
          let hasOrigAudio = true
          try {
            await this._ffmpeg.exec([
              '-i', 'in.mp4',
              '-vn', '-acodec', 'copy',
              '-t', '1',
              '-f', 'null', '-'
            ])
          } catch {
            hasOrigAudio = false
          }

          if (!hasOrigAudio) {
            await this._ffmpeg.exec([
              '-i', 'in.mp4',
              '-i', audioName,
              '-map', '0:v:0',
              '-map', '1:a:0',
              '-c:v', 'copy',
              '-c:a', 'aac',
              '-b:a', '160k',
              '-shortest',
              '-movflags', '+faststart',
              'out.mp4'
            ])
          } else {
            const filter =
              `[0:a]volume=${this.volOrig}[a0];` +
              `[1:a]volume=${this.volNew}[a1];` +
              `[a0][a1]amix=inputs=2:duration=shortest:dropout_transition=0[a]`

            await this._ffmpeg.exec([
              '-i', 'in.mp4',
              '-i', audioName,
              '-filter_complex', filter,
              '-map', '0:v:0',
              '-map', '[a]',
              '-c:v', 'copy',
              '-c:a', 'aac',
              '-b:a', '160k',
              '-shortest',
              '-movflags', '+faststart',
              'out.mp4'
            ])
          }
        }

        // результат
        const data = await this._ffmpeg.readFile('out.mp4')
        this.outputUrl = URL.createObjectURL(new Blob([data.buffer], { type: 'video/mp4' }))
        this.message = 'Готово!'
      } catch (e) {
        console.error('[applyAudio] error:', e)
        this.message = `Ошибка обработки: ${e?.message || e}`
      } finally {
        try { await this._ffmpeg.deleteFile('out.mp4') } catch {}
        try { await this._ffmpeg.deleteFile('in.mp4') } catch {}
        try { await this._ffmpeg.deleteFile('mic.webm') } catch {}
        try { await this._ffmpeg.deleteFile('track.mp3') } catch {}
        this.working = false
      }
    },

    // ========= Utils =========
    resetAll() {
      if (this.videoUrl) URL.revokeObjectURL(this.videoUrl)
      if (this.audioUrl) URL.revokeObjectURL(this.audioUrl)
      if (this.recordedUrl) URL.revokeObjectURL(this.recordedUrl)
      if (this.outputUrl) URL.revokeObjectURL(this.outputUrl)

      this.videoFile = null
      this.audioFile = null
      this.videoUrl = ''
      this.audioUrl = ''
      this.recordedBlob = null
      this.recordedUrl = ''
      this.recState = 'idle'
      this.recDuration = 0
      this.volOrig = 1.0
      this.volNew = 1.0
      this.mode = 'replace'
      this.syncWithVideo = true
      this.message = ''
      if (this.recTimer) { clearInterval(this.recTimer); this.recTimer = null }
      try { this._recorder?.stop() } catch {}
    },
    formatSize(n) { return this.prettySize(n) },
    prettySize(bytes) {
      if (!Number.isFinite(bytes)) return ''
      const units = ['B', 'KB', 'MB', 'GB']
      let i = 0, v = bytes
      while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
      return `${v.toFixed(1)} ${units[i]}`
    },
  },
  beforeUnmount() {
    if (this.videoUrl) URL.revokeObjectURL(this.videoUrl)
    if (this.audioUrl) URL.revokeObjectURL(this.audioUrl)
    if (this.recordedUrl) URL.revokeObjectURL(this.recordedUrl)
    if (this.outputUrl) URL.revokeObjectURL(this.outputUrl)
    if (this.recTimer) clearInterval(this.recTimer)
    try { this._recorder?.stop() } catch {}
  },
}
</script>

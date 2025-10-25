<template>
    <v-card class="pa-4">
        <v-card-title class="text-h5">Редактор</v-card-title>
        <v-card-subtitle>Базовые операции с видео прямо в браузере</v-card-subtitle>

        <v-tabs v-model="tab" class="mt-4">
            <v-tab value="trim">Обрезка</v-tab>
            <v-tab value="merge">Склейка</v-tab>
            <v-tab value="snapshot">Снимок кадра</v-tab>
        </v-tabs>

        <v-window v-model="tab" class="mt-4">
            <!-- Обрезка -->
            <v-window-item value="trim">
                <v-sheet class="pa-4" rounded="lg" border>
                    <div class="text-subtitle-1 mb-3">Обрезка по времени</div>

                    <v-file-input label="Выберите видео" accept="video/*" prepend-icon="mdi-filmstrip" :multiple="false"
                        @update:model-value="onFileChange" />

                    <div v-if="src" class="my-4">
                        <video ref="player" :src="src" controls style="width:100%; max-height:360px;"
                            @loadedmetadata="onLoadedMetadata" @timeupdate="onTimeUpdate" />

                        <!-- Таймлайны -->
                        <div class="mt-3">
                            <div class="d-flex align-center justify-space-between">
                                <span class="text-caption">0</span>
                                <span class="text-caption">{{ Math.floor(duration) }} c</span>
                            </div>
                            <v-slider :model-value="current" :min="0" :max="duration || 0" step="0.1"
                                :disabled="!duration" @update:model-value="scrubTo" thumb-label class="mt-1" />
                        </div>

                        <div class="d-flex flex-wrap ga-3 mt-3">
                            <v-text-field v-model.number="startSec" type="number" label="Старт, сек" min="0"
                                :max="duration || undefined" style="max-width: 180px" />
                            <v-text-field v-model.number="endSec" type="number" label="Конец, сек" min="0"
                                :max="duration || undefined" style="max-width: 180px" />
                            <v-btn size="small" @click="setStartAtCurrent">Старт = текущая</v-btn>
                            <v-btn size="small" @click="setEndAtCurrent">Конец = текущая</v-btn>
                        </div>
                    </div>

                    <div class="d-flex flex-wrap ga-3 mt-3">
                        <v-btn color="primary" :loading="working || ffLoading" :disabled="!file || working || ffLoading"
                            @click="trim">
                            Обрезать
                        </v-btn>
                    </div>

                    <v-progress-linear v-if="working || ffLoading" class="mt-4" indeterminate height="8" striped
                        rounded />

                    <v-alert v-if="message" type="info" variant="tonal" class="mt-3">
                        {{ message }}
                    </v-alert>

                    <div v-if="outputUrl" class="mt-6">
                        <div class="text-subtitle-1 mb-2">Результат</div>
                        <video :src="outputUrl" controls style="width:100%; max-height:360px;" />
                        <div class="mt-2">
                            <a :href="outputUrl" download="out.mp4">Скачать out.mp4</a>
                        </div>
                    </div>
                </v-sheet>
            </v-window-item>

            <!-- Склейка -->
            <v-window-item value="merge">
                <MergeEditor />
            </v-window-item>

            <v-window-item value="snapshot">
                <v-sheet class="pa-4" rounded="lg" border>
                    <div class="text-subtitle-1 mb-3">Снимок кадра</div>
                    <v-alert type="warning" variant="tonal">Скоро добавим.</v-alert>
                </v-sheet>
            </v-window-item>
        </v-window>
    </v-card>
</template>

<script>
import MergeEditor from '@/components/MergeEditor.vue'

export default {
    name: 'Editor',
    components: { MergeEditor },
    data() {
        return {
            tab: 'trim',

            // файл/видео
            file: null,
            src: '',
            duration: 0,
            current: 0,

            // отрезок
            startSec: 0,
            endSec: 5,

            // ffmpeg / процесс
            ffReady: false,
            ffLoading: false,
            working: false,
            message: '',

            // результат
            outputUrl: '',

            // внутреннее
            _ffmpeg: null,
        }
    },
    methods: {
        // ====== FFmpeg (ЗАГРУЗКА С CDN) ======
        async ensureFFmpeg() {
            if (this.ffReady) return
            if (this.ffLoading) return

            this.ffLoading = true
            this.message = 'Загрузка FFmpeg с CDN (может занять ~30 сек)…'

            try {
                const { FFmpeg } = await import('@ffmpeg/ffmpeg')
                const { toBlobURL } = await import('@ffmpeg/util')

                this._ffmpeg = new FFmpeg()

                // Загружаем с CDN (более надёжно, чем из public/)
                const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm'

                console.log('[FFmpeg] Загрузка ядра с', baseURL)

                const coreURL = await toBlobURL(
                    `${baseURL}/ffmpeg-core.js`,
                    'text/javascript'
                )
                const wasmURL = await toBlobURL(
                    `${baseURL}/ffmpeg-core.wasm`,
                    'application/wasm'
                )

                console.log('[FFmpeg] Blob URLs готовы, запускаем load()')

                await this._ffmpeg.load({
                    coreURL,
                    wasmURL,
                })

                this.ffReady = true
                this.message = 'FFmpeg готов!'

                console.log('[FFmpeg] Успешно загружен!')

            } catch (e) {
                console.error('[FFmpeg.load] error:', e)
                this.message = `Ошибка загрузки FFmpeg: ${e.message}`
            } finally {
                this.ffLoading = false
            }
        },

        // ====== File & Video ======
        onFileChange(value) {
            const f = Array.isArray(value) ? value[0] : value
            this._cleanupOutput()

            if (!f) {
                this.file = null
                this.src = ''
                this.duration = 0
                this.current = 0
                return
            }

            this.file = f
            this.src = URL.createObjectURL(f)
            this.startSec = 0
            this.endSec = 5
            this.message = ''

            void this.ensureFFmpeg()
        },

        onLoadedMetadata(e) {
            const v = e.target
            this.duration = Number.isFinite(v.duration) ? v.duration : 0
            if (!Number.isFinite(this.endSec) || this.endSec <= 0 || this.endSec > this.duration) {
                this.endSec = Math.floor(this.duration || 5)
            }
        },

        onTimeUpdate(e) {
            this.current = e.target.currentTime || 0
        },

        scrubTo(val) {
            const v = this.$refs.player
            if (v) {
                v.currentTime = Number(val) || 0
            }
        },

        setStartAtCurrent() {
            this.startSec = Math.min(
                Math.max(0, Math.floor(this.current)),
                Math.floor(this.duration)
            )
            if (this.endSec <= this.startSec) {
                this.endSec = Math.min(this.startSec + 1, Math.ceil(this.duration))
            }
        },

        setEndAtCurrent() {
            this.endSec = Math.min(
                Math.max(0, Math.ceil(this.current)),
                Math.ceil(this.duration)
            )
            if (this.endSec <= this.startSec) {
                this.startSec = Math.max(0, this.endSec - 1)
            }
        },

        _cleanupOutput() {
            if (this.outputUrl) {
                URL.revokeObjectURL(this.outputUrl)
                this.outputUrl = ''
            }
        },

        // ====== Trim ======
        async trim() {
            if (!this.file) {
                this.message = 'Сначала выберите видео.'
                return
            }
            if (this.endSec <= this.startSec) {
                this.message = 'Конец должен быть больше старта.'
                return
            }

            await this.ensureFFmpeg()
            if (!this.ffReady || !this._ffmpeg) {
                this.message = 'FFmpeg не готов. Попробуйте снова.'
                return
            }

            this.working = true
            this.message = 'Выполняется обрезка…'
            this._cleanupOutput()

            try {
                const { fetchFile } = await import('@ffmpeg/util')

                await this._ffmpeg.writeFile('in.mp4', await fetchFile(this.file))

                let success = false
                try {
                    await this._ffmpeg.exec([
                        '-ss', String(this.startSec),
                        '-to', String(this.endSec),
                        '-i', 'in.mp4',
                        '-c', 'copy',
                        'out.mp4'
                    ])
                    success = true
                } catch (err) {
                    console.warn('Copy mode failed, trying re-encode:', err)
                }

                if (!success) {
                    await this._ffmpeg.exec([
                        '-ss', String(this.startSec),
                        '-to', String(this.endSec),
                        '-i', 'in.mp4',
                        '-vf', 'format=yuv420p',
                        '-c:v', 'libx264',
                        '-preset', 'veryfast',
                        '-crf', '23',
                        '-c:a', 'aac',
                        '-b:a', '160k',
                        'out.mp4'
                    ])
                }

                const data = await this._ffmpeg.readFile('out.mp4')
                this.outputUrl = URL.createObjectURL(
                    new Blob([data.buffer], { type: 'video/mp4' })
                )
                this.message = 'Готово!'

            } catch (e) {
                console.error('[trim] error:', e)
                this.message = `Ошибка обрезки: ${e.message}`
            } finally {
                try {
                    await this._ffmpeg.deleteFile('out.mp4')
                } catch { }

                this.working = false
            }
        },
    },

    beforeUnmount() {
        this._cleanupOutput()
        if (this.src) {
            URL.revokeObjectURL(this.src)
        }
    },
}
</script>

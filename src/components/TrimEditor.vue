<template>
    <v-sheet class="pa-4" rounded="lg" border>
        <div class="text-subtitle-1 mb-3">Обрезка по времени</div>

        <v-file-input label="Выберите видео" accept="video/*" prepend-icon="mdi-filmstrip" :multiple="false"
            @update:model-value="onFileChange" />

        <div v-if="src" class="my-4">
            <video ref="player" :src="src" controls preload="metadata" style="width:100%; max-height:360px;"
                @loadedmetadata="onLoadedMetadata" @timeupdate="onTimeUpdate" />

            <!-- Диапазон A–Б -->
            <div class="mt-3">
                <div class="d-flex align-center justify-space-between">
                    <span class="text-caption">A = {{ startSec.toFixed(2) }} c</span>
                    <span class="text-caption">Б = {{ endSec.toFixed(2) }} c</span>
                </div>

                <v-range-slider v-model="range" :min="0" :max="duration || 0" step="0.05" :disabled="!duration"
                    thumb-label class="mt-1" @start="onRangeStart" @end="onRangeEnd" @update:model-value="onRangeChange"
                    >
                    <!-- помогаем определить активный ползунок -->
                    <template #thumb-label="{ index, modelValue }">
                        <div @mousedown.stop="setActiveThumb(index)">
                            {{ index === 0 ? 'A' : 'Б' }}: {{ Number(modelValue).toFixed(2) }}c
                        </div>
                    </template>
                </v-range-slider>

                <div class="d-flex align-center justify-space-between">
                    <span class="text-caption">0</span>
                    <span class="text-caption">{{ Math.floor(duration) }} c</span>
                </div>
            </div>

            <!-- Точные поля (по желанию) -->
            <div class="d-flex flex-wrap ga-3 mt-3">
                <v-text-field v-model.number="startSec" type="number" label="Старт (A), сек" min="0"
                    :max="duration || undefined" style="max-width: 180px" @change="onStartFieldChange" />
                <v-text-field v-model.number="endSec" type="number" label="Конец (Б), сек" min="0"
                    :max="duration || undefined" style="max-width: 180px" @change="onEndFieldChange" />
                <v-btn size="small" @click="setStartAtCurrent">A = текущая</v-btn>
                <v-btn size="small" @click="setEndAtCurrent">Б = текущая</v-btn>
            </div>
        </div>

        <div class="d-flex flex-wrap ga-3 mt-3">
            <v-btn color="primary" :loading="working || ffLoading" :disabled="!file || working || ffLoading"
                @click="trim">
                Сохранить диапазон A–Б
            </v-btn>
        </div>

        <v-progress-linear v-if="working || ffLoading" class="mt-4" indeterminate height="8" striped rounded />

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
</template>

<script>
import { markRaw } from 'vue'
import { getFFmpeg } from '@/lib/ffmpeg'

export default {
    name: 'TrimEditor',
    data() {
        return {
            // файл/видео
            file: null,
            src: '',
            duration: 0,
            current: 0,

            // диапазон A–Б
            startSec: 0,
            endSec: 5,
            range: [0, 5],

            // drag-state
            _isRangeDragging: false,
            _activeThumb: null,   // 0 = A, 1 = Б
            _prevRange: [0, 5],
            _rafSeek: 0,

            // ffmpeg / процесс
            ffReady: false,
            ffLoading: false,
            working: false,
            message: '',

            // результат
            outputUrl: '',

            // внутреннее
            _ffmpeg: null,
            _progressHookSet: false,
        }
    },

    watch: {
        // СИНХРОНИЗАЦИЯ: изменение range → пересчёт start/end + seek
        range(newVal, oldVal) {
            const dur = this.duration || 0
            let [a, b] = Array.isArray(newVal) ? newVal : [0, 0]
            a = this._clamp(a, 0, dur)
            b = this._clamp(b, 0, dur)
            if (a > b) [a, b] = [b, a]

            // обновляем только если реально изменилось
            const [oa, ob] = Array.isArray(oldVal) ? oldVal : [NaN, NaN]
            const changed = Math.abs(a - oa) > 1e-6 || Math.abs(b - ob) > 1e-6
            if (!changed) return

            this.startSec = a
            this.endSec = b

            // Когда тянут — двигаем видео к активному ползунку (или к тому, что изменился сильнее)
            if (this._isRangeDragging) {
                let target
                if (this._activeThumb === 0) target = a
                else if (this._activeThumb === 1) target = b
                else {
                    const da = Math.abs(a - (this._prevRange?.[0] ?? a))
                    const db = Math.abs(b - (this._prevRange?.[1] ?? b))
                    target = da >= db ? a : b
                }
                this._seekRAF(target)
            }

            this._prevRange = [a, b]
        },

        // поля → обновляем range и делаем seek
        startSec(v) {
            const s = this._clamp(Number(v ?? 0), 0, this.duration || 0)
            const e = Math.max(s, this.endSec)
            if (this.range[0] !== s || this.range[1] !== e) this.range = [s, e]
            this._prevRange = [s, e]
            this.seekTo(s)
        },
        endSec(v) {
            const e = this._clamp(Number(v ?? 0), 0, this.duration || 0)
            const s = Math.min(this.startSec, e)
            if (this.range[0] !== s || this.range[1] !== e) this.range = [s, e]
            this._prevRange = [s, e]
            this.seekTo(e)
        },
    },

    methods: {
        // ====== FFmpeg (ЗАГРУЗКА С CDN) ======
        async ensureFFmpeg() {
            if (this.ffReady || this.ffLoading) return
            this.ffLoading = true
            this.message = 'Загрузка FFmpeg…'
            try {
                const inst = await getFFmpeg()
                this._ffmpeg = markRaw(inst)
                this.ffReady = true
                this.message = ''
            } catch (e) {
                console.error('[ensureFFmpeg]', e)
                this.message = `Не удалось загрузить FFmpeg: ${e?.message || e}`
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
                this.startSec = 0
                this.endSec = 5
                this.range = [0, 5]
                this._prevRange = [0, 5]
                return
            }
            this.file = f
            this.src = URL.createObjectURL(f)
            this.message = ''
            void this.ensureFFmpeg()
        },

        onLoadedMetadata(e) {
            const v = e.target
            this.duration = Number.isFinite(v.duration) ? v.duration : 0
            const A = 0
            const B = Math.max(0, this.duration || 0)
            this.startSec = A
            this.endSec = B
            this.range = [A, B]
            this._prevRange = [A, B]
            this.seekTo(A)
        },

        onTimeUpdate(e) {
            this.current = e.target.currentTime || 0
        },

        // ====== Range slider ======
        onRangeStart() {
            this._isRangeDragging = true
            this._activeThumb = null
            this._prevRange = [...this.range]
            const v = this.$refs.player
            if (v && !v.paused) v.pause()
        },
        onRangeEnd() {
            this._isRangeDragging = false
            this._activeThumb = null
        },
        onRangeChange(newRange) {
            // сам расчёт и seek обрабатываются в watch(range),
            // здесь только определяем активный ползунок при первом апдейте
            if (this._isRangeDragging && this._activeThumb === null) {
                const [a, b] = newRange
                const [pa, pb] = this._prevRange
                const da = Math.abs(a - pa)
                const db = Math.abs(b - pb)
                if (Math.abs(da - db) <= 0.005) {
                    // если равны — выберем ближний к текущему времени
                    this._activeThumb = Math.abs((this.current || 0) - a) <= Math.abs((this.current || 0) - b) ? 0 : 1
                } else {
                    this._activeThumb = da > db ? 0 : 1
                }
            }
        },
        setActiveThumb(i) {
            this._activeThumb = i
        },

        _seekRAF(t) {
            if (this._rafSeek) cancelAnimationFrame(this._rafSeek)
            this._rafSeek = requestAnimationFrame(() => {
                this.seekTo(t)
                this._rafSeek = 0
            })
        },
        seekTo(val) {
            const v = this.$refs.player
            if (v && Number.isFinite(val)) {
                const t = this._clamp(Number(val), 0, this.duration || 0)
                if (Math.abs((v.currentTime || 0) - t) > 0.008) v.currentTime = t
            }
        },

        // поля ввода
        onStartFieldChange() { this.startSec = Number(this.startSec) },
        onEndFieldChange() { this.endSec = Number(this.endSec) },

        setStartAtCurrent() {
            const s = this._clamp(Math.floor(this.current), 0, this.duration || 0)
            const e = Math.max(s + 0.01, this.endSec)
            this.startSec = s
            this.endSec = e
            this.range = [s, e]
            this._prevRange = [s, e]
            this.seekTo(s)
        },
        setEndAtCurrent() {
            const e = this._clamp(Math.ceil(this.current), 0, this.duration || 0)
            const s = Math.min(this.startSec, e - 0.01)
            this.startSec = s
            this.endSec = e
            this.range = [s, e]
            this._prevRange = [s, e]
            this.seekTo(e)
        },

        // ====== Trim ======
        async trim() {
            if (!this.file) { this.message = 'Сначала выберите видео.'; return }
            const dur = this.duration || 0
            const start = this._clamp(this.startSec, 0, dur)
            const end = Math.max(start + 0.1, this._clamp(this.endSec, 0, dur))
            if (end <= start) { this.message = 'Конец (Б) должен быть больше начала (A).'; return }

            await this.ensureFFmpeg()
            if (!this.ffReady || !this._ffmpeg) { this.message = 'FFmpeg не готов. Попробуйте снова.'; return }

            this.working = true
            this.message = 'Выполняется обрезка…'
            this._cleanupOutput()

            try {
                const { fetchFile } = await import('@ffmpeg/util')
                await this._ffmpeg.writeFile('in.mp4', await fetchFile(this.file))

                let success = false
                try {
                    await this._ffmpeg.exec(['-ss', String(start), '-to', String(end), '-i', 'in.mp4', '-c', 'copy', 'out.mp4'])
                    success = true
                } catch { /* fallback */ }

                if (!success) {
                    await this._ffmpeg.exec([
                        '-ss', String(start), '-to', String(end), '-i', 'in.mp4',
                        '-vf', 'format=yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
                        '-c:a', 'aac', '-b:a', '160k',
                        'out.mp4'
                    ])
                }

                const data = await this._ffmpeg.readFile('out.mp4')
                this.outputUrl = URL.createObjectURL(new Blob([data.buffer], { type: 'video/mp4' }))
                this.message = 'Готово!'
            } catch (e) {
                console.error('[trim] error:', e)
                this.message = `Ошибка обрезки: ${e?.message || e}`
            } finally {
                try { await this._ffmpeg.deleteFile('out.mp4') } catch { }
                this.working = false
            }
        },

        // utils
        _cleanupOutput() { if (this.outputUrl) { URL.revokeObjectURL(this.outputUrl); this.outputUrl = '' } },
        _clamp(x, min, max) { return Math.max(min, Math.min(max, Number(x ?? 0))) },
    },

    beforeUnmount() {
        this._cleanupOutput()
        if (this.src) URL.revokeObjectURL(this.src)
        if (this._rafSeek) cancelAnimationFrame(this._rafSeek)
    },
}
</script>

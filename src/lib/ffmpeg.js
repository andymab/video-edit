// src/lib/ffmpeg.js
// Надёжный загрузчик FFmpeg: синглтон, таймауты на fetch + load, зеркала CDN, fallback на /ffmpeg/esm.

let ffmpegSingleton = null
let loadingPromise = null

// Попробуем обе версии: сперва 0.12.10 (свежая), потом 0.12.6 (часто ставили ранее)
const CORE_VERSIONS = ['0.12.10', '0.12.6']

const CDN_BASES = (ver) => ([
  `https://unpkg.com/@ffmpeg/core@${ver}/dist/esm`,
  `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${ver}/dist/esm`,
])

function withTimeout(promise, ms = 20000, label = 'timeout') {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(label)), ms)
    promise.then(
      v => { clearTimeout(t); resolve(v) },
      e => { clearTimeout(t); reject(e) }
    )
  })
}

async function fetchWithTimeout(url, opt = {}) {
  const ctl = new AbortController()
  const id = setTimeout(() => ctl.abort(), opt.timeout || 15000)
  try {
    const res = await fetch(url, {
      mode: 'cors',
      cache: 'force-cache',
      signal: ctl.signal,
    })
    return res
  } finally {
    clearTimeout(id)
  }
}

async function toBlobURL(url, mime) {
  const res = await fetchWithTimeout(url, { timeout: 15000 })
  if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`)
  const blob = await res.blob()
  return URL.createObjectURL(new Blob([blob], { type: mime }))
}

async function tryLoadFromBase(base) {
  const { FFmpeg } = await import('@ffmpeg/ffmpeg')
  const coreURL = await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript')
  const wasmURL = await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm')
  const inst = new FFmpeg()
  await withTimeout(inst.load({ coreURL, wasmURL }), 20000, `FFmpeg load from ${base} timed out`)
  return inst
}

async function tryLoadFromPublic() {
  const base = '/ffmpeg/esm'
  // проверим что файлы действительно лежат
  const jsOK = (await fetchWithTimeout(`${base}/ffmpeg-core.js`, { timeout: 5000 })).ok
  const wasmOK = (await fetchWithTimeout(`${base}/ffmpeg-core.wasm`, { timeout: 5000 })).ok
  if (!jsOK || !wasmOK) throw new Error('public /ffmpeg/esm not found')
  return tryLoadFromBase(base)
}

export async function getFFmpeg() {
  if (ffmpegSingleton) return ffmpegSingleton
  if (loadingPromise) return loadingPromise

  loadingPromise = (async () => {
    // 1) Переберём версии и CDN
    for (const ver of CORE_VERSIONS) {
      const bases = CDN_BASES(ver)
      for (const base of bases) {
        try {
          // console.debug('[FFmpeg] try', base)
          ffmpegSingleton = await tryLoadFromBase(base)
          // console.debug('[FFmpeg] loaded from', base)
          return ffmpegSingleton
        } catch (e) {
          console.warn('[FFmpeg] CDN failed:', base, e?.message || e)
        }
      }
    }
    // 2) Локальный fallback /public/ffmpeg/esm
    try {
      ffmpegSingleton = await tryLoadFromPublic()
      console.info('[FFmpeg] loaded from /ffmpeg/esm')
      return ffmpegSingleton
    } catch (e) {
      throw new Error(`FFmpeg load failed (all sources). Hint: copy core files to public/ffmpeg/esm. Reason: ${e?.message || e}`)
    }
  })()

  try {
    return await loadingPromise
  } finally {
    loadingPromise = null
  }
}

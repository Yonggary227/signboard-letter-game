// ──────────────────────────────────────────────────────────────────────────
// OCR (하이브리드) — 텍스트 + 글자 위치(좌표)까지 반환
//
//  1) OCR.space (정확도↑, 무료·카드 불필요) — 기기에 저장된 키가 있으면 사용
//  2) Tesseract.js (브라우저 내장) — 키 없거나 실패 시 자동 폴백
//
// 두 경로 모두 단어별 bounding box를 0~1 정규화 좌표(words[])로 반환 →
// 화면에서 "찾은 위치"에 빨간 동그라미를 그릴 수 있다.
// 모든 호출은 try/catch + 타임아웃으로 감싸 "무한 로딩"을 차단한다.
// ──────────────────────────────────────────────────────────────────────────
import { createWorker, PSM, type Worker } from 'tesseract.js'
import { OCR_SPACE_API_KEY, OCR_FALLBACK_TO_TESSERACT } from './config'

// ── OCR.space 키: 이 기기(localStorage)에만 저장 ──
const LS_OCRSPACE_KEY = 'ocrspace_api_key'
export function getOcrSpaceKey(): string {
  try {
    return localStorage.getItem(LS_OCRSPACE_KEY) || OCR_SPACE_API_KEY
  } catch {
    return OCR_SPACE_API_KEY
  }
}
export function setOcrSpaceKey(key: string): void {
  try {
    const k = key.trim()
    if (k) localStorage.setItem(LS_OCRSPACE_KEY, k)
    else localStorage.removeItem(LS_OCRSPACE_KEY)
  } catch {
    /* noop */
  }
}

let workerPromise: Promise<Worker> | null = null

export function initWorker(onProgress?: (status: string, progress: number) => void): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker('kor', 1, {
      logger: (m) => onProgress?.(m.status, m.progress ?? 0),
    })
      .then(async (worker) => {
        await worker.setParameters({
          tessedit_pageseg_mode: PSM.SPARSE_TEXT,
          preserve_interword_spaces: '1',
        })
        return worker
      })
      .catch((err) => {
        workerPromise = null
        throw err
      })
  }
  return workerPromise
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`OCR 응답 시간 초과 (${(ms / 1000).toFixed(0)}초).`)),
      ms,
    )
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

/** 정규화(0~1) 단어 박스 */
export interface WordBox {
  text: string
  cx: number // 중심 x
  cy: number // 중심 y
  w: number
  h: number
}

export interface OcrResult {
  text: string
  durationMs: number
  engine: 'ocrspace' | 'clova' | 'tesseract'
  note?: string
  words: WordBox[]
}

// ── 전처리 (Tesseract용): 흑백·대비·해상도 정규화. 치수도 반환 ──
async function preprocess(file: File): Promise<{ blob: Blob; w: number; h: number }> {
  const bitmap = await createImageBitmap(file)
  const maxSide = Math.max(bitmap.width, bitmap.height)
  let scale = 1
  if (maxSide > 2000) scale = 2000 / maxSide
  else if (maxSide < 1400) scale = Math.min(2, 1400 / maxSide)
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bitmap, 0, 0, w, h)
  const img = ctx.getImageData(0, 0, w, h)
  const d = img.data
  const CONTRAST = 1.45
  for (let i = 0; i < d.length; i += 4) {
    let g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
    g = (g - 128) * CONTRAST + 128
    g = g < 0 ? 0 : g > 255 ? 255 : g
    d[i] = d[i + 1] = d[i + 2] = g
  }
  ctx.putImageData(img, 0, 0)
  const blob = await new Promise<Blob>((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error('이미지 변환 실패'))), 'image/png'),
  )
  return { blob, w, h }
}

// ── 컬러 JPEG data URL + 치수 (OCR.space용, 1MB 한도 대응) ──
async function toJpegDataUrl(
  file: File,
  maxSide: number,
  maxBytes: number,
): Promise<{ dataUrl: string; w: number; h: number }> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.max(bitmap.width, bitmap.height) > maxSide
    ? maxSide / Math.max(bitmap.width, bitmap.height)
    : 1
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h)
  for (const q of [0.85, 0.7, 0.55, 0.4]) {
    const blob = await new Promise<Blob>((res, rej) =>
      canvas.toBlob((b) => (b ? res(b) : rej(new Error('이미지 변환 실패'))), 'image/jpeg', q),
    )
    if (blob.size <= maxBytes || q === 0.4) {
      const dataUrl = await new Promise<string>((res, rej) => {
        const fr = new FileReader()
        fr.onload = () => res(String(fr.result))
        fr.onerror = () => rej(new Error('이미지 읽기 실패'))
        fr.readAsDataURL(blob)
      })
      return { dataUrl, w, h }
    }
  }
  throw new Error('이미지 인코딩 실패')
}

// ── OCR.space ──
async function recognizeWithOcrSpace(file: File, timeoutMs: number): Promise<{ text: string; words: WordBox[] }> {
  const { dataUrl, w, h } = await toJpegDataUrl(file, 1600, 1_000_000)
  const form = new FormData()
  form.append('apikey', getOcrSpaceKey())
  form.append('language', 'kor')
  form.append('OCREngine', '1')
  form.append('scale', 'true')
  form.append('isOverlayRequired', 'true') // 좌표 받기
  form.append('base64Image', dataUrl)

  const resp = await withTimeout(
    fetch('https://api.ocr.space/parse/image', { method: 'POST', body: form }),
    timeoutMs,
  )
  if (!resp.ok) {
    const body = await resp.text().catch(() => '')
    throw new Error(`OCR.space HTTP ${resp.status} ${body.slice(0, 200)}`)
  }
  const json: any = await resp.json()
  if (json.IsErroredOnProcessing) {
    throw new Error(`OCR.space 오류: ${[].concat(json.ErrorMessage || '알 수 없음').join(' ')}`)
  }
  const pr = (json.ParsedResults || [])[0]
  const text = (json.ParsedResults || []).map((r: any) => r.ParsedText).filter(Boolean).join(' ')
  const words: WordBox[] = []
  for (const line of pr?.TextOverlay?.Lines || []) {
    for (const wd of line.Words || []) {
      words.push({
        text: wd.WordText ?? '',
        cx: (wd.Left + wd.Width / 2) / w,
        cy: (wd.Top + wd.Height / 2) / h,
        w: wd.Width / w,
        h: wd.Height / h,
      })
    }
  }
  return { text, words }
}

// ── Tesseract ──
async function recognizeWithTesseract(file: File, timeoutMs: number): Promise<{ text: string; words: WordBox[] }> {
  const worker = await withTimeout(initWorker(), timeoutMs)
  const { blob, w, h } = await preprocess(file)
  const ret: any = await withTimeout(worker.recognize(blob, {}, { text: true, blocks: true }), timeoutMs)
  const data = ret.data
  const words: WordBox[] = []
  for (const b of data.blocks || []) {
    for (const p of b.paragraphs || []) {
      for (const l of p.lines || []) {
        for (const wd of l.words || []) {
          const bb = wd.bbox
          if (!bb) continue
          words.push({
            text: wd.text ?? '',
            cx: (bb.x0 + bb.x1) / 2 / w,
            cy: (bb.y0 + bb.y1) / 2 / h,
            w: (bb.x1 - bb.x0) / w,
            h: (bb.y1 - bb.y0) / h,
          })
        }
      }
    }
  }
  return { text: data.text ?? '', words }
}

export async function recognizeText(file: File, timeoutMs = 20000): Promise<OcrResult> {
  const start = performance.now()
  const elapsed = () => Math.round(performance.now() - start)

  if (getOcrSpaceKey()) {
    try {
      const r = await recognizeWithOcrSpace(file, timeoutMs)
      return { ...r, durationMs: elapsed(), engine: 'ocrspace' }
    } catch (err: any) {
      if (!OCR_FALLBACK_TO_TESSERACT) throw err
      const r = await recognizeWithTesseract(file, timeoutMs)
      return { ...r, durationMs: elapsed(), engine: 'tesseract', note: `ocrspace 실패로 폴백: ${err?.message ?? err}` }
    }
  }

  const r = await recognizeWithTesseract(file, timeoutMs)
  return { ...r, durationMs: elapsed(), engine: 'tesseract' }
}

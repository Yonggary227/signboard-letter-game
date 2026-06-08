// ──────────────────────────────────────────────────────────────────────────
// OCR (하이브리드)
//
//  1) Naver CLOVA OCR (정확도 최고) — config.ts의 OCR_PROXY_URL이 설정돼 있으면
//     프록시(백엔드)를 통해 호출한다. 시크릿 키는 프록시에만 있고 여기엔 없다.
//  2) Tesseract.js (브라우저 내장) — 프록시 미설정/실패 시 자동 폴백. 키 불필요.
//
// 어느 경로든 try/catch + 타임아웃으로 감싸 "무한 로딩"을 원천 차단한다.
// ──────────────────────────────────────────────────────────────────────────
import { createWorker, PSM, type Worker } from 'tesseract.js'
import { OCR_PROXY_URL, OCR_FALLBACK_TO_TESSERACT } from './config'

let workerPromise: Promise<Worker> | null = null

/**
 * OCR 워커를 1회만 초기화한다.
 * 한국어 학습 데이터(약 15MB)를 처음에 받아오므로, 앱 시작 시 미리 호출해
 * 첫 인식이 다운로드 때문에 느려지는 일을 막는다.
 */
export function initWorker(onProgress?: (status: string, progress: number) => void): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker('kor', 1, {
      logger: (m) => onProgress?.(m.status, m.progress ?? 0),
    })
      .then(async (worker) => {
        // 간판처럼 글자가 흩어진 장면 텍스트는 SPARSE_TEXT(11)가 인식률이 높다.
        await worker.setParameters({
          tessedit_pageseg_mode: PSM.SPARSE_TEXT,
          preserve_interword_spaces: '1',
        })
        return worker
      })
      .catch((err) => {
        // 초기화 실패 시 다음 시도에서 다시 만들 수 있도록 캐시를 비운다.
        workerPromise = null
        throw err
      })
  }
  return workerPromise
}

/** Promise에 타임아웃을 건다. 시간 내 응답이 없으면 reject. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`OCR 응답 시간 초과 (${(ms / 1000).toFixed(0)}초). 네트워크 또는 엔진 로딩이 지연되고 있어요.`))
    }, ms)
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

/**
 * OCR 정확도를 높이기 위한 이미지 전처리.
 *  - 해상도 정규화: 너무 크면 줄이고(2000px), 너무 작으면 키운다(최소 1400px).
 *    Tesseract는 글자 높이가 너무 작거나 과하게 크면 인식률이 떨어진다.
 *  - 흑백 변환 + 대비 강화: 간판 배경/조명 노이즈를 줄여 글자 윤곽을 또렷하게.
 *  - PNG(무손실)로 출력 — JPEG 압축 노이즈가 OCR을 방해하지 않도록.
 */
async function preprocess(file: File): Promise<Blob> {
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

  // 흑백 + 대비 스트레치
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

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('이미지 변환 실패'))), 'image/png')
  })
}

export interface OcrResult {
  text: string
  durationMs: number
  engine: 'clova' | 'tesseract'
  note?: string // 폴백 등 부가 안내(개발용)
}

/** CLOVA는 컬러 원본이 정확도가 높다. 너무 큰 사진만 줄이고 JPEG로 인코딩해 base64로. */
async function toClovaPayload(file: File): Promise<{ data: string; format: string }> {
  const bitmap = await createImageBitmap(file)
  const maxSide = Math.max(bitmap.width, bitmap.height)
  const scale = maxSide > 2400 ? 2400 / maxSide : 1
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h)
  const blob = await new Promise<Blob>((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error('이미지 변환 실패'))), 'image/jpeg', 0.92),
  )
  const dataUrl = await new Promise<string>((res, rej) => {
    const fr = new FileReader()
    fr.onload = () => res(String(fr.result))
    fr.onerror = () => rej(new Error('이미지 읽기 실패'))
    fr.readAsDataURL(blob)
  })
  return { data: dataUrl.split(',')[1], format: 'jpg' }
}

/** CLOVA OCR 프록시 호출. 프록시는 {text} 를 돌려준다고 약속. */
async function recognizeWithClova(file: File, timeoutMs: number): Promise<string> {
  const { data, format } = await toClovaPayload(file)
  const resp = await withTimeout(
    fetch(OCR_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: data, format }),
    }),
    timeoutMs,
  )
  if (!resp.ok) {
    const body = await resp.text().catch(() => '')
    throw new Error(`CLOVA 프록시 오류 status:${resp.status} ${body.slice(0, 200)}`)
  }
  const json = await resp.json()
  if (typeof json.text !== 'string') throw new Error('CLOVA 프록시 응답 형식 오류 (text 없음)')
  return json.text
}

/** Tesseract 인식. */
async function recognizeWithTesseract(file: File, timeoutMs: number): Promise<string> {
  const worker = await withTimeout(initWorker(), timeoutMs)
  const image = await preprocess(file)
  const { data } = await withTimeout(worker.recognize(image), timeoutMs)
  return data.text ?? ''
}

/**
 * 사진에서 텍스트를 인식한다.
 *  - 프록시(CLOVA)가 설정돼 있으면 우선 시도 → 실패 시 (옵션) Tesseract 폴백.
 *  - 설정이 없으면 바로 Tesseract.
 * 반드시 try/catch로 감싸 호출하고, 타임아웃으로 무한 대기를 막는다.
 */
export async function recognizeText(file: File, timeoutMs = 20000): Promise<OcrResult> {
  const start = performance.now()
  const elapsed = () => Math.round(performance.now() - start)

  if (OCR_PROXY_URL) {
    try {
      const text = await recognizeWithClova(file, timeoutMs)
      return { text, durationMs: elapsed(), engine: 'clova' }
    } catch (err: any) {
      if (!OCR_FALLBACK_TO_TESSERACT) throw err
      // CLOVA 실패 → 게임이 멈추지 않도록 Tesseract로 폴백
      const text = await recognizeWithTesseract(file, timeoutMs)
      return { text, durationMs: elapsed(), engine: 'tesseract', note: `CLOVA 실패로 폴백: ${err?.message ?? err}` }
    }
  }

  const text = await recognizeWithTesseract(file, timeoutMs)
  return { text, durationMs: elapsed(), engine: 'tesseract' }
}

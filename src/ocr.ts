// ──────────────────────────────────────────────────────────────────────────
// 클라이언트 측 OCR (Tesseract.js, 한국어)
//
// 왜 백엔드가 아니라 브라우저에서 직접 OCR 하나?
//  - 원래 "무한 로딩"의 흔한 원인: 백엔드 OCR API 키 누락 / CORS / 응답 형식
//    불일치인데, 그 호출이 실패해도 처리가 안 돼서 영원히 기다리는 상태가 됨.
//  - 클라이언트 OCR은 외부 API 키도, 서버도, CORS도 없어서 그 원인 자체가 사라짐.
//  - 그래도 OCR은 실패할 수 있으므로 아래에 try/catch + 타임아웃을 반드시 건다.
// ──────────────────────────────────────────────────────────────────────────
import { createWorker, type Worker } from 'tesseract.js'

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
    }).catch((err) => {
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

/** 큰 사진은 OCR 전에 적당히 줄인다. (요청 막힘/느림 방지) */
async function downscale(file: File, maxSide = 1600): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  if (scale >= 1) return file
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bitmap, 0, 0, w, h)
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('이미지 변환 실패'))),
      'image/jpeg',
      0.9,
    )
  })
}

export interface OcrResult {
  text: string
  durationMs: number
}

/**
 * 사진에서 텍스트를 인식한다.
 * 반드시 try/catch로 감싸 호출하고, 타임아웃으로 무한 대기를 막는다.
 */
export async function recognizeText(file: File, timeoutMs = 15000): Promise<OcrResult> {
  const start = performance.now()
  const worker = await withTimeout(initWorker(), timeoutMs)
  const image = await downscale(file)
  const { data } = await withTimeout(worker.recognize(image), timeoutMs)
  return { text: data.text ?? '', durationMs: Math.round(performance.now() - start) }
}

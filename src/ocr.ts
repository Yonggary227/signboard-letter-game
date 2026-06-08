// ──────────────────────────────────────────────────────────────────────────
// 클라이언트 측 OCR (Tesseract.js, 한국어)
//
// 왜 백엔드가 아니라 브라우저에서 직접 OCR 하나?
//  - 원래 "무한 로딩"의 흔한 원인: 백엔드 OCR API 키 누락 / CORS / 응답 형식
//    불일치인데, 그 호출이 실패해도 처리가 안 돼서 영원히 기다리는 상태가 됨.
//  - 클라이언트 OCR은 외부 API 키도, 서버도, CORS도 없어서 그 원인 자체가 사라짐.
//  - 그래도 OCR은 실패할 수 있으므로 아래에 try/catch + 타임아웃을 반드시 건다.
// ──────────────────────────────────────────────────────────────────────────
import { createWorker, PSM, type Worker } from 'tesseract.js'

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
}

/**
 * 사진에서 텍스트를 인식한다.
 * 반드시 try/catch로 감싸 호출하고, 타임아웃으로 무한 대기를 막는다.
 */
export async function recognizeText(file: File, timeoutMs = 20000): Promise<OcrResult> {
  const start = performance.now()
  const worker = await withTimeout(initWorker(), timeoutMs)
  const image = await preprocess(file)
  const { data } = await withTimeout(worker.recognize(image), timeoutMs)
  return { text: data.text ?? '', durationMs: Math.round(performance.now() - start) }
}

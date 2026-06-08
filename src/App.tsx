import { useEffect, useMemo, useRef, useState } from 'react'
import { initWorker, recognizeText, getOcrSpaceKey, setOcrSpaceKey, type WordBox } from './ocr'
import { pickRandomWord, toSyllables, hintImageUrl, type WordEntry } from './words'

const OCR_TIMEOUT_MS = 20000
const CREDITS_PER_WORD = 10

const ENGINE_LABEL: Record<string, string> = {
  ocrspace: 'OCR.space',
  clova: 'CLOVA',
  tesseract: 'Tesseract',
}

type Cam = 'off' | 'live' | 'frozen'
type Phase = 'idle' | 'loading' | 'error'
type Geo = { lat: number; lng: number; acc: number } | { error: string } | null

interface CaptureResult {
  text: string
  durationMs: number
  hit: boolean
  target: string
  engine: string
  note?: string
  circle: { cx: number; cy: number; d: number } | null
}

// ── 로컬 저장 (크레딧/완료수/기록) ──
const num = (k: string, d: number) => {
  try {
    return Number(localStorage.getItem(k) ?? d)
  } catch {
    return d
  }
}
const setNum = (k: string, v: number) => {
  try {
    localStorage.setItem(k, String(v))
  } catch {
    /* noop */
  }
}
function logMission(record: object) {
  try {
    const log = JSON.parse(localStorage.getItem('mission_log') || '[]')
    log.push(record)
    localStorage.setItem('mission_log', JSON.stringify(log.slice(-200)))
  } catch {
    /* noop */
  }
}

export default function App() {
  const [entry, setEntry] = useState<WordEntry>(() => pickRandomWord())
  const word = entry.ko
  const syllables = useMemo(() => toSyllables(word), [word])
  const [collected, setCollected] = useState<boolean[]>(() => syllables.map(() => false))

  const [cam, setCam] = useState<Cam>('off')
  const [camError, setCamError] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [last, setLast] = useState<CaptureResult | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [errorDetail, setErrorDetail] = useState('')
  const [preview, setPreview] = useState('')
  const [geo, setGeo] = useState<Geo>(null)

  const [credits, setCredits] = useState<number>(() => num('credits', 0))
  const [completed, setCompleted] = useState<number>(() => num('completed', 0))

  const [ocrKeySet, setOcrKeySet] = useState<boolean>(() => !!getOcrSpaceKey())
  const [showHint, setShowHint] = useState(true)
  const [hintFailed, setHintFailed] = useState(false)

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const currentIndex = collected.findIndex((c) => !c)
  const allDone = currentIndex === -1
  const target = allDone ? null : syllables[currentIndex]
  const doneCount = collected.filter(Boolean).length

  // OCR 엔진 워밍업
  useEffect(() => {
    initWorker().catch(() => {})
  }, [])

  // 언마운트 시 카메라 정리
  useEffect(() => () => stopCamera(), [])

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }

  async function startCamera() {
    setCamError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setCam('live')
      requestLocation() // 위치 권한 미리 확보
    } catch (e: any) {
      setCamError('카메라를 열 수 없어요. 브라우저에서 카메라 권한을 허용해 주세요. (' + (e?.name || e) + ')')
    }
  }

  function requestLocation() {
    if (!navigator.geolocation) {
      setGeo({ error: '이 기기에서 위치를 지원하지 않아요' })
      return
    }
    navigator.geolocation.getCurrentPosition(
      (p) => setGeo({ lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy) }),
      (err) => setGeo({ error: err.message }),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 10000 },
    )
  }

  async function capture() {
    const v = videoRef.current
    if (!v || !target || !v.videoWidth) return
    const canvas = document.createElement('canvas')
    canvas.width = v.videoWidth
    canvas.height = v.videoHeight
    canvas.getContext('2d')!.drawImage(v, 0, 0)
    setPreview(canvas.toDataURL('image/jpeg', 0.9))
    setCam('frozen')
    setPhase('loading')
    setErrorMsg('')
    setErrorDetail('')
    setShowHint(false)
    requestLocation() // 촬영 시점 위치 갱신

    const seeking = target
    const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), 'image/jpeg', 0.9))
    const file = new File([blob], 'shot.jpg', { type: 'image/jpeg' })

    try {
      const result = await recognizeText(file, OCR_TIMEOUT_MS)
      const box: WordBox | undefined = result.words.find((w) => w.text.includes(seeking))
      const hit = !!box || result.text.includes(seeking)
      const circle = box
        ? { cx: box.cx, cy: box.cy, d: Math.min(0.5, Math.max(box.w, box.h) * 1.6 + 0.04) }
        : null

      if (hit) {
        const idx = collected.findIndex((c) => !c)
        const nextCollected = collected.map((c, i) => (i === idx ? true : c))
        setCollected(nextCollected)

        const g = geo
        const at = g && 'lat' in g ? { lat: g.lat, lng: g.lng, acc: g.acc } : null
        logMission({ word, syllable: seeking, ts: new Date().toISOString(), location: at, engine: result.engine })

        // 단어 완성 → 크레딧 적립
        if (nextCollected.every(Boolean)) {
          const nc = credits + CREDITS_PER_WORD
          const ncomp = completed + 1
          setCredits(nc)
          setNum('credits', nc)
          setCompleted(ncomp)
          setNum('completed', ncomp)
        }
      }

      setLast({
        text: result.text,
        durationMs: result.durationMs,
        hit,
        target: seeking,
        engine: result.engine,
        note: result.note,
        circle,
      })
      setPhase('idle')
    } catch (err: any) {
      setPhase('error')
      setErrorMsg('글자를 인식하지 못했어요. 다시 찍어주세요.')
      setErrorDetail(formatError(err))
      setLast(null)
    }
  }

  function retake() {
    setPreview('')
    setLast(null)
    setPhase('idle')
    setCam(streamRef.current ? 'live' : 'off')
  }

  function newGame() {
    const next = pickRandomWord(word)
    setEntry(next)
    setCollected(toSyllables(next.ko).map(() => false))
    setPreview('')
    setLast(null)
    setPhase('idle')
    setErrorMsg('')
    setErrorDetail('')
    setShowHint(true)
    setHintFailed(false)
    setCam(streamRef.current ? 'live' : 'off')
  }

  function editOcrKey() {
    const input = window.prompt(
      'OCR.space 무료 API 키를 붙여넣으세요.\n\n• 이 기기에만 저장됩니다 (서버·깃허브·외부 전송 없음).\n• 키 발급(무료, 카드 불필요): ocr.space/ocrapi/freekey\n• 비우고 확인하면 기본(Tesseract)으로 돌아갑니다.',
      getOcrSpaceKey(),
    )
    if (input === null) return
    setOcrSpaceKey(input)
    setOcrKeySet(!!input.trim())
  }

  const geoText =
    geo == null
      ? '위치 확인 중…'
      : 'error' in geo
        ? `위치 미확보 (${geo.error})`
        : `위치 기록됨 · 정확도 ±${geo.acc}m`

  return (
    <div className="app">
      <div className="aurora" aria-hidden />

      <header className="topbar">
        <div className="brand">
          <span className="brand-badge">간판</span>
          글자 수집
        </div>
        <div className="credit-pill" title={`완성한 미션 ${completed}회`}>
          <span className="coin">☕</span> {credits}
          <span className="credit-sub">크레딧</span>
        </div>
      </header>

      <div className="progressbar">
        <div className="progressbar-fill" style={{ width: `${(doneCount / syllables.length) * 100}%` }} />
      </div>

      {/* 미션 카드 */}
      <section className="card mission">
        <div className="mission-top">
          <span className="eyebrow">이번 미션</span>
          <span className="count-pill">
            {doneCount}/{syllables.length}
          </span>
        </div>

        <div className="word-line">
          {syllables.map((s, i) => (
            <span key={i} className={`syl ${collected[i] ? 'got' : i === currentIndex ? 'now' : 'todo'}`}>
              {s}
            </span>
          ))}
        </div>

        {showHint && !allDone && !hintFailed && (
          <figure className="hint">
            <img
              src={hintImageUrl(entry)}
              alt={`${word} (${entry.en}) 예시`}
              loading="eager"
              onError={() => setHintFailed(true)}
            />
            <figcaption>‘{word}’ 는 이런 느낌 · 참고용</figcaption>
            <button className="hint-close" onClick={() => setShowHint(false)} aria-label="힌트 닫기">
              ✕
            </button>
          </figure>
        )}

        {!allDone && (
          <div className="seek">
            <span className="seek-label">지금 찾을 글자</span>
            <span className="seek-target">{target}</span>
            <span className="seek-help">길거리 간판에서 ‘{target}’ 한 글자를 찾아 찍어요</span>
          </div>
        )}
      </section>

      {/* 카메라 / 결과 카드 */}
      {!allDone && (
        <section className="card cam-card">
          <div className="cam-view">
            {/* 항상 마운트(스트림 연결 유지), 표시만 토글 */}
            <video
              ref={videoRef}
              className="cam-video"
              playsInline
              muted
              autoPlay
              style={{ display: cam === 'live' ? 'block' : 'none' }}
            />

            {cam === 'off' && (
              <div className="cam-placeholder">
                <span className="cam-icon">📷</span>
                <p>실시간 카메라로 ‘{target}’ 를 찾으세요</p>
                <button className="btn-primary" onClick={startCamera}>
                  카메라 켜기
                </button>
                {camError && <p className="cam-err">{camError}</p>}
              </div>
            )}

            {cam === 'frozen' && preview && (
              <div className="frozen">
                <img src={preview} alt="촬영 사진" />
                {phase === 'loading' && (
                  <div className="shot-loading">
                    <span className="spinner" />
                    <span>‘{last?.target ?? target}’ 찾는 중…</span>
                  </div>
                )}
                {phase === 'idle' && last?.hit && last.circle && (
                  <span
                    className="find-circle"
                    style={{
                      left: `${last.circle.cx * 100}%`,
                      top: `${last.circle.cy * 100}%`,
                      width: `${last.circle.d * 100}%`,
                    }}
                  />
                )}
              </div>
            )}
          </div>

          {/* 카메라 컨트롤 */}
          {cam === 'live' && (
            <div className="cam-controls">
              <button className="shutter" onClick={capture} aria-label="촬영">
                <span />
              </button>
              <p className="geo">📍 {geoText}</p>
            </div>
          )}

          {cam === 'frozen' && phase !== 'loading' && (
            <div className="result-area">
              {phase === 'error' && (
                <div className="result err">
                  <p>⚠️ {errorMsg}</p>
                  {errorDetail && (
                    <details className="dev">
                      <summary>개발용 에러 보기</summary>
                      <pre>{errorDetail}</pre>
                    </details>
                  )}
                </div>
              )}
              {phase === 'idle' && last && (
                <div className={`result ${last.hit ? 'ok' : 'miss'}`}>
                  <p>
                    {last.hit
                      ? `‘${last.target}’ 찾았다! 🎉`
                      : `이 사진엔 ‘${last.target}’ 가 안 보여요. 다른 간판에 도전!`}
                  </p>
                  <details className="dev">
                    <summary>
                      인식 텍스트 (개발용 · {ENGINE_LABEL[last.engine] ?? last.engine} · {last.durationMs}ms)
                    </summary>
                    {last.note && <pre>⚠ {last.note}</pre>}
                    <pre>{last.text || '(빈 결과)'}</pre>
                  </details>
                </div>
              )}
              <button className="btn-primary" onClick={retake}>
                다시 촬영
              </button>
            </div>
          )}
        </section>
      )}

      {/* 승리 + 사전 정의 */}
      {allDone && (
        <section className="card win">
          <div className="win-emoji">🏆</div>
          <p className="win-word">{word}</p>
          <p className="win-sub">+{CREDITS_PER_WORD} 크레딧 적립!</p>
          <div className="def-box">
            <span className="def-label">📖 {word}</span>
            <p className="def-text">{entry.def}</p>
          </div>
          <button className="btn-primary" onClick={newGame}>
            다음 단어 도전 →
          </button>
        </section>
      )}

      {/* 부정방지 안내 + OCR 키 */}
      <div className="footnote">
        <p className="anti">🔒 실시간 촬영만 가능 · 보관함/갤러리 불가 · 위치 기록</p>
        <button className="link-btn" onClick={editOcrKey}>
          {ocrKeySet ? '🎯 정확 모드 (OCR.space) · 변경' : '🎯 정확도 높이기 — 무료 OCR 키'}
        </button>
      </div>
    </div>
  )
}

function formatError(err: any): string {
  if (!err) return 'Unknown error'
  const parts: string[] = []
  if (err.name) parts.push(`name: ${err.name}`)
  if (err.message) parts.push(`message: ${err.message}`)
  if (err.status) parts.push(`status: ${err.status}`)
  if (typeof err === 'string') parts.push(err)
  return parts.length ? parts.join('\n') : JSON.stringify(err)
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { initWorker, recognizeText, getOcrSpaceKey, setOcrSpaceKey, type WordBox } from './ocr'
import { pickRandomWord, toSyllables, hintImageUrl, type WordEntry } from './words'

const OCR_TIMEOUT_MS = 20000
const CREDITS_PER_WORD = 10

const ENGINE_LABEL: Record<string, string> = {
  ocrspace: 'OCR.space',
  tesseract: 'Tesseract',
  beta: '베타',
}

type Cam = 'off' | 'live' | 'frozen'
type Phase = 'idle' | 'loading' | 'error'
type Geo = { lat: number; lng: number; acc: number } | { error: string } | null

interface CaptureResult {
  text: string
  durationMs: number
  hit: boolean
  found: string // 찾은 글자(있으면)
  remain: string // 남은 글자 목록
  engine: string
  note?: string
  circle: { cx: number; cy: number; d: number } | null
}

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

function mapEmbed(lat: number, lng: number): string {
  const d = 0.004
  const bbox = `${lng - d},${lat - d},${lng + d},${lat + d}`
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lng}`
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
  const [winImgFailed, setWinImgFailed] = useState(false)

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const allDone = collected.every(Boolean)
  const doneCount = collected.filter(Boolean).length
  const remainList = syllables.filter((_, i) => !collected[i])

  useEffect(() => {
    initWorker().catch(() => {})
    requestLocation()
  }, [])

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
      requestLocation()
    } catch (e: any) {
      setCamError('카메라 권한을 허용해 주세요. (' + (e?.name || e) + ')')
    }
  }

  function requestLocation() {
    if (!navigator.geolocation) {
      setGeo({ error: '위치 미지원 기기' })
      return
    }
    navigator.geolocation.getCurrentPosition(
      (p) => setGeo({ lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy) }),
      (err) => setGeo({ error: err.message }),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 10000 },
    )
  }

  /** 한 글자 수집 + 기록 + (완성 시) 크레딧 */
  function applyFind(idx: number) {
    const next = collected.map((c, i) => (i === idx ? true : c))
    setCollected(next)
    const g = geo
    const at = g && 'lat' in g ? { lat: g.lat, lng: g.lng, acc: g.acc } : null
    logMission({ word, syllable: syllables[idx], ts: new Date().toISOString(), location: at })
    if (next.every(Boolean)) {
      const nc = credits + CREDITS_PER_WORD
      const ncomp = completed + 1
      setCredits(nc)
      setNum('credits', nc)
      setCompleted(ncomp)
      setNum('completed', ncomp)
      setWinImgFailed(false)
    }
    return next
  }

  async function capture() {
    const v = videoRef.current
    if (!v || allDone || !v.videoWidth) return
    const canvas = document.createElement('canvas')
    canvas.width = v.videoWidth
    canvas.height = v.videoHeight
    canvas.getContext('2d')!.drawImage(v, 0, 0)
    setPreview(canvas.toDataURL('image/jpeg', 0.9))
    setCam('frozen')
    setPhase('loading')
    setErrorMsg('')
    setErrorDetail('')
    requestLocation()

    const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), 'image/jpeg', 0.9))
    const file = new File([blob], 'shot.jpg', { type: 'image/jpeg' })

    try {
      const result = await recognizeText(file, OCR_TIMEOUT_MS)

      // 남은 글자 중 사진에 보이는 첫 글자 하나를 수집 (순서 무관, 한 번에 하나)
      let foundIdx = -1
      let foundBox: WordBox | null = null
      for (let i = 0; i < syllables.length; i++) {
        if (collected[i]) continue
        const s = syllables[i]
        const box = result.words.find((w) => w.text.includes(s))
        if (box || result.text.includes(s)) {
          foundIdx = i
          foundBox = box ?? null
          break
        }
      }
      const hit = foundIdx >= 0
      const circle = foundBox
        ? { cx: foundBox.cx, cy: foundBox.cy, d: Math.min(0.5, Math.max(foundBox.w, foundBox.h) * 1.6 + 0.04) }
        : null
      if (hit) applyFind(foundIdx)

      setLast({
        text: result.text,
        durationMs: result.durationMs,
        hit,
        found: hit ? syllables[foundIdx] : '',
        remain: remainList.join(' '),
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

  /** 베타: 버튼 한 번 = 남은 글자 하나 통과 */
  function betaPass() {
    const idx = collected.findIndex((c) => !c)
    if (idx < 0) return
    applyFind(idx)
    setPreview('')
    setCam(streamRef.current ? 'live' : 'off')
    setPhase('idle')
    setLast(null)
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
    setWinImgFailed(false)
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

  const geoOk = geo != null && 'lat' in geo

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

      {!allDone && (
        <>
          {/* 미션 카드 — 사진 없이 단어만 (사진은 완성 후 보상) */}
          <section className="card mission">
            <div className="mission-top">
              <span className="eyebrow">이번 미션</span>
              <span className="count-pill">
                {doneCount}/{syllables.length}
              </span>
            </div>
            <div className="word-line">
              {syllables.map((s, i) => (
                <span key={i} className={`syl ${collected[i] ? 'got' : 'now'}`}>
                  {s}
                </span>
              ))}
            </div>
            <p className="seek-help">
              간판에서 <b>{remainList.join(', ')}</b> 글자를 찾아 찍어요 · <i>순서 상관없어요</i>
            </p>
          </section>

          {/* 카메라 카드 */}
          <section className="card cam-card">
            {cam === 'off' ? (
              <div className="cam-compact">
                <button className="btn-primary" onClick={startCamera}>
                  📷 카메라 켜기
                </button>
                <span className="cam-compact-hint">실시간 촬영만 가능</span>
                {camError && <p className="cam-err">{camError}</p>}
              </div>
            ) : (
              <>
                <div className="cam-view">
                  <video
                    ref={videoRef}
                    className="cam-video"
                    playsInline
                    muted
                    autoPlay
                    style={{ display: cam === 'live' ? 'block' : 'none' }}
                  />
                  {cam === 'frozen' && preview && (
                    <div className="frozen">
                      <img src={preview} alt="촬영 사진" />
                      {phase === 'loading' && (
                        <div className="shot-loading">
                          <span className="spinner" />
                          <span>글자 찾는 중…</span>
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

                {cam === 'live' && (
                  <div className="cam-controls">
                    <button className="shutter" onClick={capture} aria-label="촬영">
                      <span />
                    </button>
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
                        <p>{last.hit ? `‘${last.found}’ 찾았다! 🎉` : `남은 글자(${last.remain})가 안 보여요. 다시!`}</p>
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
              </>
            )}

            {/* 베타: 버튼 한 번 = 한 글자 통과 */}
            <button className="beta-btn" onClick={betaPass}>
              🐞 (베타) ‘{remainList[0]}’ 맞춘 걸로
            </button>
          </section>

          {/* 내 위치 지도 */}
          <section className="card map-card">
            <div className="map-head">
              <span>📍 내 위치</span>
              <span className="map-acc">{geoOk ? `정확도 ±${(geo as any).acc}m` : '위치 확인 중…'}</span>
            </div>
            {geoOk ? (
              <iframe
                className="map-frame"
                title="내 위치"
                src={mapEmbed((geo as any).lat, (geo as any).lng)}
                loading="lazy"
              />
            ) : (
              <div className="map-empty">
                <p>{geo && 'error' in geo ? `위치 미확보: ${geo.error}` : '위치 권한을 허용해 주세요'}</p>
                <button className="btn-mini" onClick={requestLocation}>
                  위치 다시 시도
                </button>
              </div>
            )}
          </section>
        </>
      )}

      {/* 승리 — 사진 + 사전 정의 + 크레딧 */}
      {allDone && (
        <section className="card win">
          <div className="win-emoji">🏆</div>
          <p className="win-word">{word}</p>
          {!winImgFailed && (
            <figure className="win-photo">
              <img src={hintImageUrl(entry)} alt={word} onError={() => setWinImgFailed(true)} />
            </figure>
          )}
          <div className="def-box">
            <span className="def-label">📖 {word}</span>
            <p className="def-text">{entry.def}</p>
          </div>
          <p className="win-credit">+{CREDITS_PER_WORD} 크레딧 적립!</p>
          <button className="btn-primary" onClick={newGame}>
            다음 단어 도전 →
          </button>
        </section>
      )}

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

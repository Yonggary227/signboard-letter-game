import { useEffect, useMemo, useRef, useState } from 'react'
import { initWorker, recognizeText, getOcrSpaceKey, setOcrSpaceKey, type WordBox } from './ocr'
import { pickRandomWord, toSyllables, type WordEntry } from './words'

const OCR_TIMEOUT_MS = 20000
const CREDITS_PER_WORD = 10

const ENGINE_LABEL: Record<string, string> = {
  ocrspace: 'OCR.space',
  tesseract: 'Tesseract',
}

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
/** 깔끔한 정적 지도 (키 불필요) + 빨간 핀 */
function mapImg(lat: number, lng: number): string {
  return `https://static-maps.yandex.ru/1.x/?ll=${lng},${lat}&z=16&size=600,300&l=map&lang=en_US&pt=${lng},${lat},pm2rdm`
}

export default function App() {
  const [entry, setEntry] = useState<WordEntry>(() => pickRandomWord())
  const word = entry.ko
  const syllables = useMemo(() => toSyllables(word), [word])
  const [collected, setCollected] = useState<boolean[]>(() => syllables.map(() => false))
  const [selected, setSelected] = useState(0)

  const [phase, setPhase] = useState<Phase>('idle')
  const [last, setLast] = useState<CaptureResult | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [errorDetail, setErrorDetail] = useState('')
  const [preview, setPreview] = useState('')
  const [geo, setGeo] = useState<Geo>(null)

  const [credits, setCredits] = useState<number>(() => num('credits', 0))
  const [completed, setCompleted] = useState<number>(() => num('completed', 0))
  const [ocrKeySet, setOcrKeySet] = useState<boolean>(() => !!getOcrSpaceKey())

  const fileRef = useRef<HTMLInputElement>(null)

  const allDone = collected.every(Boolean)
  const doneCount = collected.filter(Boolean).length
  const target = syllables[selected]

  useEffect(() => {
    initWorker().catch(() => {})
    requestLocation()
  }, [])

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

  function applyFind(idx: number) {
    const next = collected.map((c, i) => (i === idx ? true : c))
    setCollected(next)
    const nextUncollected = next.findIndex((c) => !c)
    if (nextUncollected >= 0) setSelected(nextUncollected)
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
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || allDone) return
    if (preview) URL.revokeObjectURL(preview)
    setPreview(URL.createObjectURL(file))
    setPhase('loading')
    setErrorMsg('')
    setErrorDetail('')
    requestLocation()

    const seeking = target
    const seekIdx = selected
    try {
      const result = await recognizeText(file, OCR_TIMEOUT_MS)
      const box: WordBox | undefined = result.words.find((w) => w.text.includes(seeking))
      const hit = !!box || result.text.includes(seeking)
      const circle = box
        ? { cx: box.cx, cy: box.cy, d: Math.min(0.5, Math.max(box.w, box.h) * 1.6 + 0.04) }
        : null
      if (hit && !collected[seekIdx]) applyFind(seekIdx)
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

  function betaPass() {
    const idx = collected[selected] ? collected.findIndex((c) => !c) : selected
    if (idx >= 0) applyFind(idx)
    clearShot()
  }

  function clearShot() {
    if (preview) URL.revokeObjectURL(preview)
    setPreview('')
    setLast(null)
    setPhase('idle')
  }

  function newGame() {
    const next = pickRandomWord(word)
    setEntry(next)
    setCollected(toSyllables(next.ko).map(() => false))
    setSelected(0)
    clearShot()
    setErrorMsg('')
    setErrorDetail('')
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
          {/* 미션 — 음절 탭 선택 */}
          <section className="card mission">
            <div className="mission-top">
              <span className="eyebrow">이번 미션</span>
              <span className="count-pill">
                {doneCount}/{syllables.length}
              </span>
            </div>
            <div className="word-line">
              {syllables.map((s, i) => (
                <button
                  key={i}
                  className={`syl ${collected[i] ? 'got' : selected === i ? 'sel' : 'idle'}`}
                  onClick={() => !collected[i] && setSelected(i)}
                  disabled={collected[i]}
                >
                  {s}
                </button>
              ))}
            </div>
            <div className="seek">
              <span className="seek-label">지금 찾을 글자</span>
              <span className="seek-target">{target}</span>
              <span className="seek-help">음절을 눌러 고르고, 간판에서 ‘{target}’ 를 찾아 찍어요</span>
            </div>
          </section>

          {/* 카메라 — 폰 기본 카메라 */}
          <section className="card cam-card">
            {!preview ? (
              <div className="cam-compact">
                <button className="btn-primary" onClick={() => fileRef.current?.click()}>
                  📷 사진 찍기
                </button>
                <span className="cam-compact-hint">기기 카메라로 ‘{target}’ 촬영</span>
              </div>
            ) : (
              <>
                <div className="shot-wrap">
                  <img className="shot-photo" src={preview} alt="촬영 사진" />
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

                {phase !== 'loading' && (
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
                        <p>{last.hit ? `‘${last.target}’ 찾았다! 🎉` : `이 사진엔 ‘${last.target}’ 가 안 보여요. 다시!`}</p>
                        <details className="dev">
                          <summary>
                            인식 텍스트 (개발용 · {ENGINE_LABEL[last.engine] ?? last.engine} · {last.durationMs}ms)
                          </summary>
                          {last.note && <pre>⚠ {last.note}</pre>}
                          <pre>{last.text || '(빈 결과)'}</pre>
                        </details>
                      </div>
                    )}
                    <button className="btn-primary" onClick={() => fileRef.current?.click()}>
                      다시 찍기
                    </button>
                  </div>
                )}
              </>
            )}

            <button className="beta-btn" onClick={betaPass}>
              🐞 (베타) ‘{target}’ 맞춘 걸로
            </button>
          </section>

          {/* 내 위치 — 정적 지도 + 핀 */}
          <section className="card map-card">
            <div className="map-head">
              <span>📍 내 위치</span>
              <span className="map-acc">{geoOk ? `정확도 ±${(geo as any).acc}m` : '위치 확인 중…'}</span>
            </div>
            {geoOk ? (
              <img className="map-frame" src={mapImg((geo as any).lat, (geo as any).lng)} alt="내 위치 지도" />
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

      {/* 승리 — 뜻 + 크레딧 */}
      {allDone && (
        <section className="card win">
          <div className="win-emoji">🏆</div>
          <p className="win-word">{word}</p>
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
        <p className="anti">🔒 실시간 촬영 권장 · 위치 기록</p>
        <button className="link-btn" onClick={editOcrKey}>
          {ocrKeySet ? '🎯 정확 모드 (OCR.space) · 변경' : '🎯 정확도 높이기 — 무료 OCR 키'}
        </button>
      </div>

      <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={onFile} hidden />
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

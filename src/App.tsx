import { useEffect, useMemo, useRef, useState } from 'react'
import { initWorker, recognizeText, getOcrSpaceKey, setOcrSpaceKey, type WordBox } from './ocr'
import { pickRandomWord, toSyllables, fetchWordInfo, type WordEntry, type WordInfo } from './words'

const OCR_TIMEOUT_MS = 20000
const CREDITS_PER_WORD = 10

type Phase = 'idle' | 'loading' | 'error'
type Geo = { lat: number; lng: number; acc: number } | { error: string } | null

interface CaptureResult {
  hit: boolean
  target: string
  errorDetail?: string
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
const getKakaoKey = () => {
  try {
    return localStorage.getItem('kakao_js_key') || ''
  } catch {
    return ''
  }
}
const setKakaoKey = (k: string) => {
  try {
    k.trim() ? localStorage.setItem('kakao_js_key', k.trim()) : localStorage.removeItem('kakao_js_key')
  } catch {
    /* noop */
  }
}
function staticMapImg(lat: number, lng: number): string {
  return `https://static-maps.yandex.ru/1.x/?ll=${lng},${lat}&z=16&size=600,300&l=map&lang=en_US&pt=${lng},${lat},pm2rdm`
}

// ── 카카오맵 ──
let kakaoLoad: Promise<any> | null = null
function loadKakao(key: string): Promise<any> {
  const w = window as any
  if (w.kakao && w.kakao.maps) return Promise.resolve(w.kakao)
  if (!kakaoLoad) {
    kakaoLoad = new Promise((res, rej) => {
      const s = document.createElement('script')
      s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${key}&autoload=false`
      s.onload = () => w.kakao.maps.load(() => res(w.kakao))
      s.onerror = () => {
        kakaoLoad = null
        rej(new Error('카카오맵 SDK 로드 실패'))
      }
      document.head.appendChild(s)
    })
  }
  return kakaoLoad
}

function KakaoMap({ lat, lng, apiKey }: { lat: number; lng: number; apiKey: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    let cancelled = false
    loadKakao(apiKey)
      .then((kakao) => {
        if (cancelled || !ref.current) return
        const center = new kakao.maps.LatLng(lat, lng)
        const map = new kakao.maps.Map(ref.current, { center, level: 3 })
        new kakao.maps.Marker({ position: center, map })
      })
      .catch(() => setErr('카카오맵 로드 실패 — 키/도메인 등록을 확인하세요'))
    return () => {
      cancelled = true
    }
  }, [lat, lng, apiKey])
  if (err) return <div className="map-empty"><p>{err}</p></div>
  return <div ref={ref} className="map-frame" />
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
  const [preview, setPreview] = useState('')
  const [geo, setGeo] = useState<Geo>(null)

  const [credits, setCredits] = useState<number>(() => num('credits', 0))
  const [completed, setCompleted] = useState<number>(() => num('completed', 0))
  const [ocrKeySet, setOcrKeySet] = useState<boolean>(() => !!getOcrSpaceKey())
  const [kakaoKey, setKakaoKeyState] = useState<string>(() => getKakaoKey())
  const [winImgFailed, setWinImgFailed] = useState(false)
  const [wiki, setWiki] = useState<WordInfo | null>(null)
  const [wikiLoading, setWikiLoading] = useState(false)

  const fileRef = useRef<HTMLInputElement>(null)

  const allDone = collected.every(Boolean)
  const doneCount = collected.filter(Boolean).length
  const target = syllables[selected]

  useEffect(() => {
    initWorker().catch(() => {})
    requestLocation()
  }, [])

  // 미션 성공 시 위키백과에서 사진 + 사전적 설명 가져오기
  useEffect(() => {
    if (!allDone) {
      setWiki(null)
      return
    }
    let alive = true
    setWikiLoading(true)
    setWinImgFailed(false)
    fetchWordInfo(word).then((info) => {
      if (alive) {
        setWiki(info)
        setWikiLoading(false)
      }
    })
    return () => {
      alive = false
    }
  }, [allDone, word])

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
      setWinImgFailed(false)
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
      setLast({ hit, target: seeking, circle })
      setPhase('idle')
    } catch (err: any) {
      setPhase('error')
      setErrorMsg('글자를 인식하지 못했어요. 다시 찍어주세요.')
      setLast({ hit: false, target: seeking, circle: null, errorDetail: formatError(err) })
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
    setWinImgFailed(false)
    clearShot()
    setErrorMsg('')
  }

  function editOcrKey() {
    const input = window.prompt(
      'OCR.space 무료 API 키를 붙여넣으세요.\n\n• 이 기기에만 저장됩니다.\n• 키 발급(무료, 카드 불필요): ocr.space/ocrapi/freekey\n• 비우고 확인하면 기본(Tesseract)으로.',
      getOcrSpaceKey(),
    )
    if (input === null) return
    setOcrSpaceKey(input)
    setOcrKeySet(!!input.trim())
  }

  function editKakaoKey() {
    const input = window.prompt(
      '카카오맵 JavaScript 키를 붙여넣으세요.\n\n1) developers.kakao.com → 내 애플리케이션 → 앱 키 → JavaScript 키\n2) 플랫폼 → Web → 사이트 도메인에 https://yonggary227.github.io 등록\n\n• 이 기기에만 저장됩니다. 비우면 기본 지도로.',
      getKakaoKey(),
    )
    if (input === null) return
    setKakaoKey(input)
    setKakaoKeyState(input.trim())
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
          <section className="card mission">
            <div className="mission-top">
              <span className="eyebrow">{entry.emoji} {entry.category}</span>
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
                  <div className="shot-inner">
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
                </div>

                {phase !== 'loading' && (
                  <div className="result-area">
                    {phase === 'error' && <div className="result err"><p>⚠️ {errorMsg}</p></div>}
                    {phase === 'idle' && last && (
                      <div className={`result ${last.hit ? 'ok' : 'miss'}`}>
                        <p>{last.hit ? `‘${last.target}’ 찾았다! 🎉` : `이 사진엔 ‘${last.target}’ 가 안 보여요. 다시!`}</p>
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

          {/* 내 위치 — 카카오맵(키 있으면) / 정적 지도(폴백). 촬영 중엔 숨겨 스크롤 최소화 */}
          {!preview && (
            <section className="card map-card">
              <div className="map-head">
                <span>📍 내 위치</span>
                {geoOk ? (
                  <button className="map-link" onClick={editKakaoKey}>
                    {kakaoKey ? '카카오맵 ✓' : '카카오맵 연결'}
                  </button>
                ) : (
                  <span className="map-acc">위치 확인 중…</span>
                )}
              </div>
              {geoOk ? (
                kakaoKey ? (
                  <KakaoMap lat={(geo as any).lat} lng={(geo as any).lng} apiKey={kakaoKey} />
                ) : (
                  <img className="map-frame" src={staticMapImg((geo as any).lat, (geo as any).lng)} alt="내 위치 지도" />
                )
              ) : (
                <div className="map-empty">
                  <p>{geo && 'error' in geo ? `위치 미확보: ${geo.error}` : '위치 권한을 허용해 주세요'}</p>
                  <button className="btn-mini" onClick={requestLocation}>
                    위치 다시 시도
                  </button>
                </div>
              )}
            </section>
          )}
        </>
      )}

      {/* 승리 — 연상 사진 + 뜻 + 크레딧 */}
      {allDone && (
        <section className="card win">
          <div className="win-emoji">🏆</div>
          <p className="win-word">{word}</p>
          <p className="win-cat">{entry.emoji} {entry.category}</p>
          {wiki?.thumb && !winImgFailed && (
            <figure className="win-photo">
              <img src={wiki.thumb} alt={word} onError={() => setWinImgFailed(true)} />
            </figure>
          )}
          <div className="def-box">
            <span className="def-label">📖 {word}</span>
            <p className="def-text">
              {wikiLoading
                ? '사전에서 뜻을 불러오는 중…'
                : wiki?.extract
                  ? wiki.extract.length > 160
                    ? wiki.extract.slice(0, 160) + '…'
                    : wiki.extract
                  : '이 단어의 설명을 찾지 못했어요. 일상에서 자주 보이는 단어예요!'}
            </p>
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
  if (err.message) return String(err.message)
  if (typeof err === 'string') return err
  return JSON.stringify(err)
}

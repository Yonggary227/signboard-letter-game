import { useEffect, useMemo, useRef, useState } from 'react'
import { initWorker, recognizeText, getOcrSpaceKey, setOcrSpaceKey } from './ocr'
import { pickRandomWord, toSyllables, hintImageUrl } from './words'

const OCR_TIMEOUT_MS = 20000

const ENGINE_LABEL: Record<string, string> = {
  ocrspace: 'OCR.space',
  clova: 'CLOVA',
  tesseract: 'Tesseract',
}

type Phase = 'idle' | 'loading' | 'error'

interface CaptureResult {
  text: string
  durationMs: number
  hit: boolean
  target: string
  engine: string
  note?: string
}

export default function App() {
  const [entry, setEntry] = useState(() => pickRandomWord())
  const word = entry.ko
  const syllables = useMemo(() => toSyllables(word), [word])
  const [collected, setCollected] = useState<boolean[]>(() => syllables.map(() => false))

  const [phase, setPhase] = useState<Phase>('idle')
  const [last, setLast] = useState<CaptureResult | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [errorDetail, setErrorDetail] = useState('')
  const [preview, setPreview] = useState('')
  const [engineStatus, setEngineStatus] = useState('OCR 엔진 준비 중…')
  const [engineReady, setEngineReady] = useState(false)
  const [ocrKeySet, setOcrKeySet] = useState<boolean>(() => !!getOcrSpaceKey())
  const [showHint, setShowHint] = useState(true)
  const [hintFailed, setHintFailed] = useState(false)

  const fileRef = useRef<HTMLInputElement>(null)

  const currentIndex = collected.findIndex((c) => !c)
  const allDone = currentIndex === -1
  const target = allDone ? null : syllables[currentIndex]
  const doneCount = collected.filter(Boolean).length

  useEffect(() => {
    let alive = true
    initWorker((status, progress) => {
      if (!alive) return
      setEngineStatus(`OCR 엔진 준비 중… ${status} ${Math.round(progress * 100)}%`)
    })
      .then(() => alive && (setEngineReady(true), setEngineStatus('준비 완료')))
      .catch((e) => {
        if (!alive) return
        setEngineStatus('엔진 로딩 실패 — 사진을 찍으면 다시 시도합니다.')
        setErrorDetail(String(e?.message ?? e))
      })
    return () => {
      alive = false
    }
  }, [])

  function newGame() {
    const next = pickRandomWord(word)
    setEntry(next)
    setCollected(toSyllables(next.ko).map(() => false))
    setPhase('idle')
    setLast(null)
    setErrorMsg('')
    setErrorDetail('')
    setPreview('')
    setShowHint(true)
    setHintFailed(false)
  }

  function openCamera() {
    fileRef.current?.click()
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

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !target) return

    setShowHint(false)
    setPreview(URL.createObjectURL(file))
    setPhase('loading')
    setErrorMsg('')
    setErrorDetail('')

    const seeking = target
    try {
      const result = await recognizeText(file, OCR_TIMEOUT_MS)
      const hit = result.text.includes(seeking)
      if (hit) {
        setCollected((prev) => {
          const n = [...prev]
          const idx = n.findIndex((c) => !c) // 현재 찾는 글자
          if (idx >= 0) n[idx] = true
          return n
        })
      }
      setLast({
        text: result.text,
        durationMs: result.durationMs,
        hit,
        target: seeking,
        engine: result.engine,
        note: result.note,
      })
      setPhase('idle')
    } catch (err: any) {
      setPhase('error')
      setErrorMsg('글자를 인식하지 못했어요. 다시 찍어주세요.')
      setErrorDetail(formatError(err))
      setLast(null)
    }
  }

  return (
    <div className="app">
      <div className="aurora" aria-hidden />

      <header className="topbar">
        <div className="brand">
          <span className="brand-badge">간판</span>
          글자 수집
        </div>
        <button className="ghost" onClick={newGame}>
          새 단어
        </button>
      </header>

      {/* 진행 바 */}
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
            <span
              key={i}
              className={`syl ${collected[i] ? 'got' : i === currentIndex ? 'now' : 'todo'}`}
            >
              {s}
            </span>
          ))}
        </div>

        {/* 참고 사진 (1회성 힌트) — 로드 실패 시 잘못된 사진 대신 숨김 */}
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
            <span className="seek-help">간판에서 ‘{target}’ 한 글자만 찾아 찍어요</span>
          </div>
        )}
      </section>

      {/* 촬영 결과 영역 */}
      {preview && !allDone && (
        <section className="card shot">
          <div className="shot-img">
            <img src={preview} alt="찍은 사진" />
            {phase === 'loading' && (
              <div className="shot-loading">
                <span className="spinner" />
                <span>‘{target}’ 찾는 중…</span>
              </div>
            )}
          </div>

          {phase === 'error' && (
            <div className="result err">
              <p>⚠️ {errorMsg}</p>
              <button className="btn-mini" onClick={openCamera}>
                다시 찍기
              </button>
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
                {last.hit ? `‘${last.target}’ 찾았다! 🎉` : `이 사진엔 ‘${last.target}’ 가 안 보여요. 다시 도전!`}
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
        </section>
      )}

      {/* 승리 */}
      {allDone && (
        <section className="card win">
          <div className="win-emoji">🏆</div>
          <p className="win-word">{word}</p>
          <p className="win-sub">모든 글자를 모았어요!</p>
          <button className="btn-primary" onClick={newGame}>
            다음 단어 도전 →
          </button>
        </section>
      )}

      {/* 하단 액션 */}
      {!allDone && (
        <div className="dock">
          <button className="btn-primary big" onClick={openCamera} disabled={phase === 'loading'}>
            <span className="cam">📷</span> ‘{target}’ 찾으러 사진 찍기
          </button>
          <div className="dock-meta">
            {!engineReady && <span className="muted">{engineStatus}</span>}
            <button className="link-btn" onClick={editOcrKey}>
              {ocrKeySet ? '🎯 정확 모드 (OCR.space) · 변경' : '🎯 정확도 높이기 — 무료 OCR 키'}
            </button>
          </div>
        </div>
      )}

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

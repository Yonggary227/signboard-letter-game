import { useEffect, useMemo, useRef, useState } from 'react'
import { initWorker, recognizeText } from './ocr'
import { pickRandomWord, toSyllables } from './words'

const OCR_TIMEOUT_MS = 20000

type Phase = 'idle' | 'loading' | 'error'

interface CaptureResult {
  text: string
  durationMs: number
  found: string[] // 이번 촬영에서 새로 모은 음절
  engine: string // 'clova' | 'tesseract'
  note?: string
}

export default function App() {
  // 미션 단어 — 새로고침/새 게임마다 랜덤
  const [word, setWord] = useState<string>(() => pickRandomWord())
  const syllables = useMemo(() => toSyllables(word), [word])

  // 모은 음절(인덱스 기준). 같은 음절이 두 칸이면 각각 따로 채움.
  const [collected, setCollected] = useState<boolean[]>(() => syllables.map(() => false))

  const [phase, setPhase] = useState<Phase>('idle')
  const [last, setLast] = useState<CaptureResult | null>(null)
  const [errorMsg, setErrorMsg] = useState<string>('')
  const [errorDetail, setErrorDetail] = useState<string>('') // 개발용 상세
  const [preview, setPreview] = useState<string>('')
  const [engineStatus, setEngineStatus] = useState<string>('OCR 엔진 준비 중…')
  const [engineReady, setEngineReady] = useState(false)

  const fileRef = useRef<HTMLInputElement>(null)

  // 앱 시작 시 OCR 워커를 미리 로드 (첫 인식 지연 방지)
  useEffect(() => {
    let alive = true
    initWorker((status, progress) => {
      if (!alive) return
      const pct = Math.round(progress * 100)
      setEngineStatus(`OCR 엔진 준비 중… ${status} ${pct}%`)
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

  const allDone = collected.every(Boolean)

  function newGame() {
    const next = pickRandomWord(word)
    setWord(next)
    setCollected(toSyllables(next).map(() => false))
    setPhase('idle')
    setLast(null)
    setErrorMsg('')
    setErrorDetail('')
    setPreview('')
  }

  function openCamera() {
    fileRef.current?.click()
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // 같은 파일 다시 선택 가능하게
    if (!file) return

    setPreview(URL.createObjectURL(file))
    setPhase('loading')
    setErrorMsg('')
    setErrorDetail('')

    try {
      const result = await recognizeText(file, OCR_TIMEOUT_MS)

      // 인식 텍스트에서 아직 못 모은 음절을 찾아 채운다.
      const newFound: string[] = []
      setCollected((prev) => {
        const next = [...prev]
        syllables.forEach((s, i) => {
          if (!next[i] && result.text.includes(s)) {
            next[i] = true
            newFound.push(s)
          }
        })
        return next
      })

      setLast({
        text: result.text,
        durationMs: result.durationMs,
        found: newFound,
        engine: result.engine,
        note: result.note,
      })
      setPhase('idle')
    } catch (err: any) {
      // 무한 로딩 방지: 어떤 실패든 여기서 로딩을 즉시 끝낸다.
      setPhase('error')
      setErrorMsg('글자를 인식하지 못했어요. 다시 찍어주세요.')
      setErrorDetail(formatError(err))
      setLast(null)
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">🪧 간판 글자 수집</div>
        <button className="ghost" onClick={newGame}>새 단어 ↺</button>
      </header>

      <section className="mission">
        <p className="mission-label">이번 미션 단어</p>
        <p className="mission-word">{word}</p>
        <div className="slots">
          {syllables.map((s, i) => (
            <div key={i} className={`slot ${collected[i] ? 'filled' : 'pending'}`}>
              {s}
            </div>
          ))}
        </div>
        <p className="progress">
          {collected.filter(Boolean).length} / {syllables.length} 음절 수집 · 간판에서 이 글자들을 찾아 찍어보세요
        </p>
      </section>

      {preview && (
        <div className="preview">
          <img src={preview} alt="찍은 사진" />
        </div>
      )}

      {/* 상태별 안내 */}
      {phase === 'loading' && (
        <div className="status loading">
          <div className="spinner" />
          <p>간판 글자를 읽는 중… (최대 {OCR_TIMEOUT_MS / 1000}초)</p>
        </div>
      )}

      {phase === 'error' && (
        <div className="status error">
          <p className="err-title">⚠️ {errorMsg}</p>
          <button className="primary" onClick={openCamera}>다시 찍기</button>
          {errorDetail && (
            <details className="dev">
              <summary>개발용 에러 보기</summary>
              <pre>{errorDetail}</pre>
            </details>
          )}
        </div>
      )}

      {phase === 'idle' && last && (
        <div className="status result">
          {last.found.length > 0 ? (
            <p className="ok">✅ 새로 모은 글자: {last.found.map((s) => `[${s}]`).join(' ')}</p>
          ) : (
            <p className="miss">이 사진엔 필요한 글자가 없네요. 다른 간판을 찍어보세요!</p>
          )}
          <details className="dev">
            <summary>
              인식된 텍스트 보기 (개발용 · {last.engine === 'clova' ? 'CLOVA' : 'Tesseract'} · {last.durationMs}ms)
            </summary>
            {last.note && <pre>⚠ {last.note}</pre>}
            <pre>{last.text || '(빈 결과)'}</pre>
          </details>
        </div>
      )}

      {allDone && (
        <div className="win">
          🎉 <strong>{word}</strong> 완성! 모든 글자를 모았어요.
          <button className="primary" onClick={newGame}>다음 단어 도전</button>
        </div>
      )}

      {/* 하단 촬영 버튼 */}
      {!allDone && (
        <div className="actions">
          <button className="primary big" onClick={openCamera} disabled={phase === 'loading'}>
            📷 사진 찍기
          </button>
          <p className="engine-status">{engineReady ? '' : engineStatus}</p>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={onFile}
        hidden
      />
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

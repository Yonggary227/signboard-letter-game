// ──────────────────────────────────────────────────────────────────────────
// 미션 단어 풀
// 단어를 추가/삭제하려면 이 배열만 수정하면 됩니다.
//  - ko: 화면에 보일 한글 단어 (음절 수에 맞춰 칸이 자동 생성)
//  - en: 참고 사진을 가져올 영어 키워드 (이미지 검색용)
// ──────────────────────────────────────────────────────────────────────────
export interface WordEntry {
  ko: string
  en: string
}

export const WORD_POOL: WordEntry[] = [
  { ko: '선풍기', en: 'electric fan' },
  { ko: '커피', en: 'coffee' },
  { ko: '산책', en: 'park walk path' },
  { ko: '보물', en: 'treasure chest' },
  { ko: '햇살', en: 'sunlight' },
  { ko: '골목', en: 'alley street' },
  { ko: '우산', en: 'umbrella rain' },
  { ko: '바람', en: 'wind field' },
  { ko: '노을', en: 'sunset sky' },
  { ko: '거리', en: 'city street' },
  { ko: '동네', en: 'neighborhood town' },
  { ko: '빵집', en: 'bakery bread' },
  { ko: '약국', en: 'pharmacy' },
  { ko: '시계', en: 'clock' },
  { ko: '나무', en: 'tree' },
  { ko: '보물찾기', en: 'treasure map' },
]

/** 풀에서 단어 하나를 랜덤으로 고른다. (직전 단어와 다르게 뽑도록 시도) */
export function pickRandomWord(excludeKo?: string): WordEntry {
  const candidates =
    excludeKo && WORD_POOL.length > 1 ? WORD_POOL.filter((w) => w.ko !== excludeKo) : WORD_POOL
  return candidates[Math.floor(Math.random() * candidates.length)]
}

/** 단어를 음절(글자) 단위로 분리한다. 예: "보물찾기" → ["보","물","찾","기"] */
export function toSyllables(word: string): string[] {
  return Array.from(word)
}

/** 작은 해시(키워드별 안정적인 이미지 lock 값 생성용) */
function hashStr(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h % 1000
}

/** 단어의 참고 사진 URL (키워드 기반, lock으로 단어마다 고정 이미지) */
export function hintImageUrl(en: string): string {
  const lock = hashStr(en)
  return `https://loremflickr.com/640/440/${encodeURIComponent(en)}?lock=${lock}`
}

/** 1차 이미지가 실패하면 쓰는 폴백 URL */
export function hintImageFallback(en: string): string {
  return `https://picsum.photos/seed/${encodeURIComponent(en)}/640/440`
}

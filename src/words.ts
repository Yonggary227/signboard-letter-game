// ──────────────────────────────────────────────────────────────────────────
// 미션 단어 풀
// 단어를 추가/삭제하려면 이 배열만 수정하면 됩니다.
//  - ko: 화면에 보일 한글 단어 (음절 수에 맞춰 칸이 자동 생성)
//  - en: 대체 텍스트(alt)용 영어 의미
//  - photo: 참고 사진 Unsplash 사진 ID (단어 의미에 맞게 큐레이션·검증됨)
// ──────────────────────────────────────────────────────────────────────────
export interface WordEntry {
  ko: string
  en: string
  photo: string
}

export const WORD_POOL: WordEntry[] = [
  { ko: '고양이', en: 'cat', photo: '1514888286974-6c03e2ca1dba' },
  { ko: '커피', en: 'coffee', photo: '1509042239860-f550ce710b93' },
  { ko: '산책', en: 'walk at sunset', photo: '1476611338391-6f395a0ebc7b' },
  { ko: '보물', en: 'treasure gold', photo: '1607344645866-009c320b63e0' },
  { ko: '햇살', en: 'sunlight', photo: '1504370805625-d32c54b16100' },
  { ko: '골목', en: 'street', photo: '1519677100203-a0e668c92439' },
  { ko: '우산', en: 'rain', photo: '1534274988757-a28bf1a57c17' },
  { ko: '바람', en: 'wind field', photo: '1500382017468-9049fed747ef' },
  { ko: '노을', en: 'sunset', photo: '1495616811223-4d98c6e9c869' },
  { ko: '거리', en: 'city street', photo: '1449824913935-59a10b8d2000' },
  { ko: '동네', en: 'town', photo: '1480714378408-67cf0d13bc1b' },
  { ko: '빵집', en: 'bakery bread', photo: '1509440159596-0249088772ff' },
  { ko: '약국', en: 'pharmacy', photo: '1587854692152-cbe660dbde88' },
  { ko: '시계', en: 'clock', photo: '1509048191080-d2984bad6ae5' },
  { ko: '나무', en: 'tree', photo: '1518495973542-4542c06a5843' },
  { ko: '보물찾기', en: 'old treasure map', photo: '1577086664693-894d8405334a' },
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

/** 단어의 참고 사진 URL (Unsplash CDN, 640x440 크롭) */
export function hintImageUrl(entry: WordEntry): string {
  return `https://images.unsplash.com/photo-${entry.photo}?w=640&h=440&fit=crop&q=80`
}

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
  def: string // 사전적 정의
}

export const WORD_POOL: WordEntry[] = [
  { ko: '고양이', en: 'cat', photo: '1514888286974-6c03e2ca1dba', def: '고양잇과의 작은 포유류로, 사람이 가까이 두고 기르는 반려동물.' },
  { ko: '커피', en: 'coffee', photo: '1509042239860-f550ce710b93', def: '커피나무 열매를 볶아 갈아서 우려낸, 쌉싸름한 향의 음료.' },
  { ko: '산책', en: 'walk at sunset', photo: '1476611338391-6f395a0ebc7b', def: '휴식이나 건강을 위해 천천히 걷는 일.' },
  { ko: '보물', en: 'treasure gold', photo: '1607344645866-009c320b63e0', def: '매우 귀하고 소중히 여기는 물건.' },
  { ko: '햇살', en: 'sunlight', photo: '1504370805625-d32c54b16100', def: '해에서 내리쬐는 빛의 줄기.' },
  { ko: '골목', en: 'street', photo: '1519677100203-a0e668c92439', def: '큰길에서 갈라져 들어간 좁은 길.' },
  { ko: '우산', en: 'rain', photo: '1534274988757-a28bf1a57c17', def: '비를 막기 위해 펴 들고 다니는 도구.' },
  { ko: '바람', en: 'wind field', photo: '1500382017468-9049fed747ef', def: '기압의 차이로 공기가 흐르며 이동하는 현상.' },
  { ko: '노을', en: 'sunset', photo: '1495616811223-4d98c6e9c869', def: '해가 뜨거나 질 때 하늘이 붉게 물드는 현상.' },
  { ko: '거리', en: 'city street', photo: '1449824913935-59a10b8d2000', def: '사람과 차가 다니는, 양옆에 건물이 늘어선 길.' },
  { ko: '동네', en: 'town', photo: '1480714378408-67cf0d13bc1b', def: '자기가 사는 집을 중심으로 한 가까운 마을 구역.' },
  { ko: '빵집', en: 'bakery bread', photo: '1509440159596-0249088772ff', def: '빵을 구워 파는 가게. 제과점.' },
  { ko: '약국', en: 'pharmacy', photo: '1587854692152-cbe660dbde88', def: '약사가 약을 조제하거나 파는 곳.' },
  { ko: '시계', en: 'clock', photo: '1509048191080-d2984bad6ae5', def: '시각을 나타내거나 시간을 재는 기계.' },
  { ko: '나무', en: 'tree', photo: '1518495973542-4542c06a5843', def: '단단한 줄기를 가진 여러해살이 식물.' },
  { ko: '보물찾기', en: 'old treasure map', photo: '1577086664693-894d8405334a', def: '숨겨 놓은 물건을 단서를 따라 찾아내는 놀이.' },
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

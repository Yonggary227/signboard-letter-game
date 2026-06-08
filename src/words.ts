// ──────────────────────────────────────────────────────────────────────────
// 미션 단어 풀
// 단어를 추가/삭제하려면 이 배열만 수정하면 됩니다.
// 2~4음절(또는 그 이상)이 섞여 있어도 음절 수에 맞게 칸이 자동 생성됩니다.
// ──────────────────────────────────────────────────────────────────────────
export const WORD_POOL: string[] = [
  '선풍기',
  '커피',
  '산책',
  '보물',
  '햇살',
  '골목',
  '우산',
  '바람',
  '노을',
  '거리',
  '동네',
  '빵집',
  '약국',
  '시계',
  '나무',
  '보물찾기',
]

/** 풀에서 단어 하나를 랜덤으로 고른다. (직전 단어와 다르게 뽑도록 시도) */
export function pickRandomWord(exclude?: string): string {
  const candidates =
    exclude && WORD_POOL.length > 1
      ? WORD_POOL.filter((w) => w !== exclude)
      : WORD_POOL
  const idx = Math.floor(Math.random() * candidates.length)
  return candidates[idx]
}

/** 단어를 음절(글자) 단위로 분리한다. 예: "보물찾기" → ["보","물","찾","기"] */
export function toSyllables(word: string): string[] {
  return Array.from(word)
}

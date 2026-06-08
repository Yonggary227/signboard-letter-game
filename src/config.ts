// ──────────────────────────────────────────────────────────────────────────
// OCR 설정 — 정확도 우선순위: OCR.space → CLOVA(프록시) → Tesseract(내장)
//
// 어느 것도 설정 안 하면(빈 값) 브라우저 내장 Tesseract만 사용한다(무료·키 불필요).
// 클라우드 OCR이 실패/지연되면 자동으로 Tesseract로 폴백해 게임이 멈추지 않는다.
// ──────────────────────────────────────────────────────────────────────────

// ✅ 추천(무료·카드 불필요): OCR.space 무료 API 키.
//    https://ocr.space/ocrapi/freekey 에서 이메일만 넣으면 키가 발송된다(신용카드 X).
//    받은 키를 아래 따옴표 안에 붙여넣고 `npm run build && npx gh-pages -d dist` 재배포.
//    참고: 이 키는 공개 사이트 번들에 포함된다(월 25,000건 제한, 언제든 교체 가능).
export const OCR_SPACE_API_KEY: string = ''

// (선택) 최고 정확도용 CLOVA 프록시 URL. 카드 필요. 설정 시 OCR.space보다 우선.
export const OCR_PROXY_URL: string = ''

// 클라우드 OCR 실패 시 Tesseract로 자동 폴백 (true 권장 — 게임이 멈추지 않도록)
export const OCR_FALLBACK_TO_TESSERACT = true

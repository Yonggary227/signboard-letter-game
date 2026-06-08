// ──────────────────────────────────────────────────────────────────────────
// OCR 프록시 설정
//
// Naver CLOVA OCR을 쓰려면, 시크릿 키를 안전하게 보관할 백엔드 프록시가 필요하다.
// (공개 사이트(GitHub Pages)에 키를 두면 노출되므로 절대 금지.)
//
// 프록시(Cloudflare Worker 등)를 배포한 뒤, 그 URL을 여기에 붙여넣고
// `npm run build && npx gh-pages -d dist` 로 다시 배포하면 CLOVA가 활성화된다.
//
// 비워두면(''), 앱은 키 없이 동작하는 브라우저 내장 OCR(Tesseract)만 사용한다.
// ──────────────────────────────────────────────────────────────────────────
export const OCR_PROXY_URL: string = ''

/** CLOVA 실패/지연 시 Tesseract로 자동 폴백할지 (true 권장 — 게임이 멈추지 않도록) */
export const OCR_FALLBACK_TO_TESSERACT = true

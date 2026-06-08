# OCR 정확도 올리기 (무료 · 카드 불필요) — OCR.space

추천 경로입니다. **신용카드 없이**, 이메일로 무료 키만 받으면 끝납니다.
백엔드도 필요 없습니다(브라우저에서 바로 호출).

## 단 2단계

### 1. 무료 키 받기 (1분, 카드 X)
1. https://ocr.space/ocrapi/freekey 접속
2. 이메일 입력 → **Subscribe to receive your free API key**
3. 메일로 온 **API 키** 복사 (예: `K81234567...`)

> 무료 플랜: 월 25,000건, 한국어(Engine 1) 지원.

### 2. 앱에 키 넣고 재배포
`src/config.ts` 에서:
```ts
export const OCR_SPACE_API_KEY: string = 'K81234567...'  // ← 받은 키 붙여넣기
```
그리고:
```powershell
npm run build
npx gh-pages -d dist
```
1~2분 뒤부터 앱이 **OCR.space**로 인식합니다. (결과의 "개발용" 칸에 `OCR.space`로 표시)

## 동작 / 안전장치
- 키가 비어 있으면 **Tesseract**(무료·내장)만 사용.
- OCR.space 실패/타임아웃(20초) 시 **자동으로 Tesseract 폴백** → 게임이 멈추지 않음.
- 실패 사유는 결과 화면 "개발용 에러 보기"에서 확인.

## 참고: 키 노출에 대해
이 키는 공개 사이트 번들에 포함됩니다. **무료·요율제한 키**라 위험은 낮고, 언제든 새 키로 교체할 수 있습니다.
키를 절대 노출하기 싫다면, 더 정확한 **CLOVA OCR(카드 필요) + 프록시** 경로가 있습니다 → [SETUP-CLOVA.md](SETUP-CLOVA.md)

## 정확도 더 높이려면 (선택 · 카드 필요)
- **Naver CLOVA OCR**: 한국어 정확도 최고. 설정은 [SETUP-CLOVA.md](SETUP-CLOVA.md). (네이버 클라우드 결제수단 등록 필요)

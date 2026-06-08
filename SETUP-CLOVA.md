# Naver CLOVA OCR 연동 가이드

가장 정확도 높은 한국어 OCR(CLOVA)을 쓰기 위한 설정입니다.
구조: **앱(공개) → Cloudflare Worker(프록시, 시크릿 보관) → CLOVA OCR**.
시크릿 키는 Worker에만 있고, 앱·GitHub·대화에는 노출되지 않습니다.

---

## 1단계 — CLOVA OCR 키 발급 (네이버 클라우드 플랫폼)

1. https://www.ncloud.com 가입/로그인 (결제수단 등록 필요, 소액 종량제)
2. 콘솔 → **Services → AI·NAVER API → CLOVA OCR** → **이용 신청**
3. **Domain 생성**: OCR 종류는 **General**(일반 문서/텍스트) 선택, 언어 **한국어**
4. 생성된 도메인에서 두 가지를 복사해 둡니다:
   - **APIGW Invoke URL** (예: `https://xxxxxxxx.apigw.ntruss.com/custom/v1/00000/xxxx/general`)
   - **Secret Key**

> 이 두 값이 "키"입니다. **Secret Key는 절대 앱이나 깃허브에 넣지 마세요.** 아래에서 Worker의 secret으로만 등록합니다.

---

## 2단계 — Cloudflare Worker(프록시) 배포

Cloudflare 계정이 필요합니다(무료). 프로젝트 폴더에서:

```powershell
# 1) Cloudflare 로그인 (브라우저 창이 열림)
npx wrangler login

# 2) wrangler.toml 의 CLOVA_INVOKE_URL 값을 1단계의 Invoke URL로 교체
#    (파일을 열어 "여기에_INVOKE_URL_붙여넣기" 를 실제 URL로)

# 3) Secret Key를 안전하게 등록 (입력창에 Secret Key 붙여넣기)
npx wrangler secret put CLOVA_SECRET

# 4) 배포
npx wrangler deploy
```

배포가 끝나면 Worker URL이 출력됩니다. 예:
`https://clova-ocr-proxy.<계정>.workers.dev`

---

## 3단계 — 앱에 프록시 URL 연결

`src/config.ts` 를 열고 2단계의 Worker URL을 붙여넣습니다:

```ts
export const OCR_PROXY_URL: string = 'https://clova-ocr-proxy.<계정>.workers.dev'
```

그리고 다시 빌드·배포:

```powershell
npm run build
npx gh-pages -d dist
```

1~2분 뒤부터 앱이 **CLOVA OCR**을 사용합니다. (사진 인식 결과의 "개발용" 칸에 `CLOVA`로 표시됩니다.)

---

## 동작 방식 / 안전장치

- 프록시 URL이 비어 있으면(`''`) 앱은 **Tesseract**(브라우저 내장, 무료)만 사용합니다.
- CLOVA 호출이 실패하거나 20초 타임아웃이면 **자동으로 Tesseract로 폴백**해 게임이 멈추지 않습니다. (`src/config.ts`의 `OCR_FALLBACK_TO_TESSERACT`)
- 실패 사유는 결과 화면 "개발용 에러 보기"에서 확인할 수 있습니다.

## 프라이버시 주의

CLOVA를 쓰면 촬영 사진이 네이버 클라우드로 전송됩니다(인식 목적). 민감한 사진은 피하세요.

// ──────────────────────────────────────────────────────────────────────────
// Naver CLOVA OCR 프록시 (Cloudflare Worker)
//
// 앱(공개 사이트)이 보낸 이미지를 받아 CLOVA OCR을 호출하고 인식 텍스트만 돌려준다.
// CLOVA 시크릿 키는 이 Worker의 환경변수(secret)에만 존재 → 클라이언트에 노출 안 됨.
//
// 필요한 환경변수:
//   - CLOVA_INVOKE_URL : CLOVA OCR 도메인 생성 시 발급되는 APIGW Invoke URL
//                        (General OCR이면 보통 .../general 로 끝남)
//   - CLOVA_SECRET     : 도메인의 Secret Key  ← `wrangler secret put CLOVA_SECRET` 로 설정
//   - ALLOW_ORIGIN     : CORS 허용 출처 (예: https://yonggary227.github.io)
// ──────────────────────────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    const cors = {
      'Access-Control-Allow-Origin': env.ALLOW_ORIGIN || '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors })
    if (request.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405, cors)

    try {
      if (!env.CLOVA_INVOKE_URL || !env.CLOVA_SECRET) {
        return json({ error: 'server not configured (CLOVA_INVOKE_URL/CLOVA_SECRET 누락)' }, 500, cors)
      }
      const { image, format } = await request.json()
      if (!image) return json({ error: 'no image' }, 400, cors)

      const body = {
        version: 'V2',
        requestId: crypto.randomUUID(),
        timestamp: Date.now(),
        images: [{ format: format || 'jpg', name: 'sign', data: image }],
      }

      const r = await fetch(env.CLOVA_INVOKE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-OCR-SECRET': env.CLOVA_SECRET },
        body: JSON.stringify(body),
      })

      if (!r.ok) {
        const detail = (await r.text().catch(() => '')).slice(0, 300)
        return json({ error: 'CLOVA error', status: r.status, detail }, 502, cors)
      }

      const data = await r.json()
      const fields = (data && data.images && data.images[0] && data.images[0].fields) || []
      // inferText들을 줄바꿈/공백으로 이어붙인다. (게임은 텍스트에 음절이 포함되는지만 확인)
      const text = fields.map((f) => f.inferText).filter(Boolean).join(' ')
      return json({ text }, 200, cors)
    } catch (e) {
      return json({ error: String((e && e.message) || e) }, 500, cors)
    }
  },
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors },
  })
}

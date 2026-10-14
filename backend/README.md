# Pokémon Stock Radar Backend

Cloudflare Workers용 백엔드입니다.

## 현재 상태
- `/health`: 백엔드 상태 확인
- `/api/products`: 브랜드별 포켓몬 카드 상품 검색 중계
- `/api/inventory`: 브랜드별 재고 조회 중계
- CU는 현재 공개 API가 정상 동작하는 범위에서 사용 가능
- GS25/이마트24/세븐일레븐은 공개 중계 API 장애/인증 문제를 우선 진단하기 위한 구조이며, 이후 직접 연결 로직을 이 Worker에 추가할 예정

## Cloudflare 배포
1. Cloudflare Dashboard 로그인
2. Workers & Pages → Create → Import a repository
3. GitHub 저장소 `noir8754/pokemon-stock-radar` 선택
4. Worker 이름: `pokemon-stock-radar-api`
5. Deploy
6. 발급된 `*.workers.dev` 주소의 `/health`를 열어 `{ "ok": true }`가 나오면 성공

발급된 Worker 주소는 프런트엔드의 API 주소로 연결하면 됩니다.

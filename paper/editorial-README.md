# 독자용 편집 개정판

## 현재 검토 대상 — 2026-09-12

현재 Notion 검토 원고의 로컬 대응본은 `final-review-ko.md`이며 미리보기는
`final-review-preview.html`이다. `submission-ko.md`는 과거 동결 출판본,
`editorial-ko.md`와 `visual-v2-ko.md`는 그 이후 편집 이력이다. 아래의 “기존 Notion 유지”는
당시 생성기가 원격 페이지를 자동 수정하지 않았다는 설명이며 현재 게시본을 뜻하지 않는다.
수동 입력 대상인 팀 EVM 주소·학회 코드는 저장소에 넣지 않는다.

검증은 `pnpm run publication:verify`, 마지막 문장 수정의 재생성은
`node docs/experiments/audits/final-review-edition.mjs`로 수행한다.
이 명령들은 새 실험이나 Notion 쓰기를 수행하지 않는다.

9월 12일의 추가 보완에서는 6.1.4절에 같은 사례의 정책 차이를 분해한 사후 설명 분석을
넣었다. [분석 기록](../docs/experiments/guard-differential-analysis.md)과
`../artifacts/guard-differential-audit.json`을 함께 확인한다. 현재 검토판은 표 10개·자료 행
38개·그림 6개·참고문헌 14개이며, 기존 표 9개와 실험 점수는 그대로다. 이 추가 분석을
새로운 실험이나 제품 간 성능 검증으로 해석하지 않는다.

### 개인 런타임 없는 그림 재생성

`pnpm install --frozen-lockfile` 후 `pnpm run publication:rebuild`를 사용한다.
이 경로는 선언된 `sharp@0.35.4`를 사용해 새 임시 폴더에서 세 과거 판본을 재생성한다.
개인 Codex 캐시에 의존하던 로더는 임시 사본에서만 교체하므로 동결된 생성기와 원고·그림의
해시 연결을 훼손하지 않는다. 명령이 출력한 임시 폴더의 `rebuild-report.json`을 확인한다.
원본·Notion·원시 실험 결과는 수정하지 않는다.

PNG는 운영체제와 설치된 한글 글꼴의 영향을 받는다. 재생성 성공과 원래 PNG의 바이트 일치는
다른 조건이다. 새 파일이 달라지면 글자 누락·겹침을 직접 검수한 뒤 새 manifest로 관리해야 한다.
2026-09-12 Windows 검증에서는 의미 파일 19개와 PNG 16개가 기존 출력과 일치했다.
다른 운영체제의 동일 PNG 바이트나 실제 Notion 화면 검수를 보장하는 문구가 아니다.

최종 저자 승인, 실제 Notion 단어 수·댓글 허용·익명 공유 접근, 등록 주소 확인과 Admin 제출은
여전히 별도 단계다. 현재 일정은 팀원이 정정한 PR #55의 2026-09-13 기준으로 확인하며,
동결된 9월 5일 manifest의 옛 날짜를 현재 제출 일정으로 사용하지 않는다.

## 9월 6일 편집 이력

기존 제출본을 바꾸지 않고 비교할 수 있도록 만든 별도 개정판이다. 연구 결과나 실험 범위를
바꾼 것이 아니며, 최종 저자가 문체·관점·그림을 검토하기 전까지 새 제출본으로 확정하지 않는다.

- `editorial-ko.md`: 제목·요약·논지와 문장 흐름을 고친 국문 원고.
- `editorial-preview.html`: 외부 스크립트 없이 읽을 수 있는 로컬 미리보기.
- `../figures/editorial/`: 표지 1개, 설명 그림 2개, 결과 그림 3개. 원본 SVG와 업로드용 PNG.
- `../docs/experiments/fourpillars-editorial-review.md`: 공개 사례 분석과 적용 근거.
- `../artifacts/editorial-ko-manifest.json`: 입력·출력 해시, 편집 기록과 검증 상태.

## 확인할 관점

문장을 일부러 구어체로 만드는 것이 아니라, 개별 호출의 허용과 전체 요청의 충족이 다르다는
문제를 구체적으로 설명하는 데 초점을 뒀다. 위반 허용 감소와 정상 완료 개선을 분리하고,
사후 발견으로 이미 발생한 위반을 지울 수 없다는 결과를 결론에 반영한다. AI 활용·검수 고지는
그대로 남긴다.

## 재생성 및 검증

저장소 루트에서 실행한다. 새 실험이나 원격 API 호출은 수행하지 않는다.

```text
node docs/experiments/audits/build-editorial-edition.mjs
node docs/experiments/audits/verify-editorial-edition.mjs
node docs/experiments/audits/verify-submission-bundle.mjs
```

새 PNG가 달라지면 시각 검수 상태가 자동으로 해제된다. 실제 렌더링을 확인한 뒤 해당 파일
해시에 대한 검수 기록을 갱신해야 한다. 코드의 숫자 검증만으로 시각 검수를 통과 처리하지 않는다.

## 보존 및 제출 경계

`submission-ko.md`, 기존 장표, 원시 데이터, 분석표, 기존 Notion 페이지는 유지된다.
새 디자인에 Four Pillars 로고나 공식 발행물 워터마크를 넣지 않았다. 미제공 팀 EVM 주소와
학회 코드는 여전히 공란이다. 로컬 단어 수는 Notion의 실제 단어 수 확인을 대신하지 않는다.
개정판의 Notion 반영과 대회 최종 제출은 별도 확인 사항이다.

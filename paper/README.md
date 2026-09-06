# Paper

제출 원고, 표 설명, 참고 문헌 메모를 관리합니다. 최종 Notion 변환 전에 개인 이름, 이메일,
GitHub 주소, 로컬 경로와 문서 메타데이터를 제거합니다.

## 결과 이후 조립 순서

`draft-*.md`는 결과 전 연구 초안이며 그 자체가 제출본이 아니다. 동결된 primary·ablation·adaptive
실행을 한 뒤 `pnpm evaluation:analyze ...`가 9개 표 파일, 결과 metadata와 4개 SVG를 함께 생성한다.
`paper/final-source.md`는 검수 담당자 1명·AI 보조 검토 절차에 맞춘 제출용 조립 원문이다. 참가 팀은 2명이다. 결과 수치는
실행 전 추정하지 않으며 아래 slot으로만 연결한다. 이 파일이 존재해도 최종 저자 승인을 뜻하지 않는다.
분석 결과를 commit한 뒤 결과 서술을 해당 원문과 대조하고, 필요한 위치에
다음 slot을 각각 정확히 한 번 둔다.

- `{{ARCHITECTURE_FIGURE}}`
- `{{PRIMARY_RESULTS_TABLE}}`
- `{{SECURITY_UTILITY_FIGURE}}`
- `{{ERROR_TAXONOMY_FIGURE}}`
- `{{LATENCY_FIGURE}}`
- `{{ABLATION_RESULTS_TABLE}}`
- `{{ADAPTIVE_RESULTS_TABLE}}`
- `{{NEGATIVE_RESULTS}}`
- `{{ANALYSIS_PROVENANCE}}`

다음 명령은 9개 표·4개 그림·metadata의 run identity, 개수와 claim scope를 먼저 검증하고 slot을
실제 산출물로 바꾼다. placeholder, 금지 형식, 공개 식별자 또는 로컬 단어 수 한도를 위반하면
`paper/final.md`를 쓰지 않는다.

```text
pnpm paper:assemble --source=paper/final-source.md
```

결과가 없을 때 이 명령이 실행 가능하다고 표시하거나 수치를 미리 채우지 않는다. `paper/final.md`와
`artifacts/submission-manifest.json`이 생성되어도 사람 검수 완료를 뜻하지 않는다.

## 국문 제출본

`paper/submission-ko.md`가 Notion에 옮길 국문 편집본이다. 원본 분석표와 그림의 해시를 바꾸지 않고
별도 출판 변환기로 국문화하며, 출처와 산출물 해시는 `artifacts/submission-ko-manifest.json`에 보존한다.
국문 그림은 `figures/ko/`의 PNG를 사용한다. 2026-09-06 사용자 제공 Four Pillars 형식을 반영했고,
공식 Notion CLI로 새 페이지에 본문·표·PNG를 업로드했다. 상대 경로가 자동 업로드된 것은 아니며
첨부 파일과 본문 블록을 별도로 생성한 뒤 실제 저장 내용을 대조했다.
실행 방법은 `docs/experiments/audits/localize-submission.mjs`를 참고한다.

확정 제출 조건은 **2명 / MetaMask / 2026-09-06**이다. 미제공 EVM 주소·학회 코드는 사용자 요청대로
공란으로 뒀다. 제공된 템플릿 구조와의 대조는 완료했고, 최종 화면 검수, Notion 실제 단어 수,
댓글·익명 공유와 최종 제출은 `artifacts/submission-checklist.md`에 따라 팀이 확인한다.
이 체크리스트에 없는 식별 정보를 공개 저장소에 채우지 않는다.

## 13,000단어와 익명성

제공된 공식 안내는 국문 원고를 **13,000단어** 이내로 제한하고 Notion의 단어 수 표시를 확인하라고
한다. 로컬 감사의 Unicode token count는 사전 경고용 추정치이며 실제 Notion 확인을 대체하지 않는다.

저장소 원고에는 팀의 대회용 EVM 주소를 넣지 않는다. 실제 Notion export까지 자동 감사할 때는 저장소
밖 파일에 신규 대회용 주소만 넣고 `--allowed-evm-address-file=<private-path>`로 전달할 수 있다. 이
주소와 forbidden-term 파일의 내용은 출력하거나 commit하지 않는다. allowlist에 없는 다른 전체 EVM
주소는 계속 실패 처리한다.

```text
pnpm submission:audit --file=paper/final.md --forbidden-terms-file=<private-path>
```

현재 절차는 `SOLO_AI_ASSISTED`다. 최종 권위는 저자의 명시적 승인, Notion preview·단어 수·댓글
권한 확인과 private 제출 기록이다. AI 보조 검토를 두 번째 독립 인간으로 세지 않는다. 제출 조립 파일의
제작 완료와 실제 제출 완료는 분리하며, 최종 저자 승인 대기는 내부 제출 기록에 둔다.

## 유지보수 환경과 동결 연구 환경

최신 `main`의 의존성 업데이트와 정적 검사 호환성 수정은 개발 환경 유지보수다. 회귀 검사 통과는
논문의 기존 실험을 새 환경에서 다시 실행했다는 뜻이 아니다. 표·그림·원시 결과와 동결 기록은
변경하지 않으며, 재현할 때는 각 실행 기록에 연결된 커밋의 소스·설정·잠금 파일을 함께 사용한다.

저장된 primary·ablation·adaptive 결과 전체를 분석하는 기준 커밋은
`919c896a2f46932299ac3643d8448e9fa046818a`다. 해당 커밋의 별도 깨끗한 작업 디렉터리에서
`pnpm install --frozen-lockfile`로 환경을 구성한다. 최신 `main`에서 기존 동결 해시를 갱신해
재현 검사를 우회하지 않는다. 제출본의 무결성만 확인하려면 저장소 루트에서
`node docs/experiments/audits/verify-submission-bundle.mjs`를 실행한다. 이는 새 실험 실행이나
최종 저자 승인·Notion 제출을 대신하지 않는 읽기 전용 검사다.

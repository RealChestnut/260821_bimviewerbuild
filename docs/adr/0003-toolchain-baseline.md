# ADR-0003: Phase 0 도구 체계와 버전 고정

- 상태: 채택
- 날짜: 2026-08-21
- 관련 문서: `docs/DEVELOPMENT_MASTER_PLAN.md` 9절(Phase 0), 13절, 17절

## 맥락

마스터 계획 13절은 "Node.js 패키지 관리자: 프로젝트 초기화 시 npm 또는 pnpm 중 하나로 고정"과 "정확한 버전은 Phase 0에서 공식 호환성을 확인한 뒤 lockfile로 고정"만 정하고, 어느 쪽인지는 미결로 남겼다. Phase 0 착수 시점에 확정해야 이후 모든 CI와 개발 환경이 같은 해석을 쓴다.

## 결정

**패키지 관리자는 pnpm workspace로 고정한다.** 버전은 `package.json`의 `packageManager` 필드에 `pnpm@10.34.5`로 못박고, CI도 같은 버전을 쓴다.

Workspace 구성:

```text
apps/viewer-web        @bim4d/viewer-web
packages/contracts     @bim4d/contracts
packages/domain        @bim4d/domain
packages/test-fixtures @bim4d/test-fixtures
```

Phase 0에서 확인한 라이브러리 조합(정확한 버전으로 고정, 범위 지정자 없음):

| 패키지                       | 버전    | 확인한 peer 범위                                                                               |
| ---------------------------- | ------- | ---------------------------------------------------------------------------------------------- |
| `@thatopen/components`       | 3.4.8   | `@thatopen/fragments ~3.4.7`, `three >=0.182.0`, `web-ifc >=0.0.77`, `camera-controls >=3.1.2` |
| `@thatopen/components-front` | 3.4.4   | `@thatopen/fragments ~3.4.0`, `three >=0.182.0`, `web-ifc >=0.0.77`                            |
| `@thatopen/fragments`        | 3.4.7   | 위 두 peer 범위를 동시에 만족하는 유일한 선택                                                  |
| `three`                      | 0.185.1 | —                                                                                              |
| `web-ifc`                    | 0.0.77  | —                                                                                              |
| `camera-controls`            | 3.1.2   | —                                                                                              |

TypeScript는 **5.9.3**으로 고정한다. 최신은 7.0.2이지만 typescript-eslint 8.67의 peer 범위가 `>=4.8.4 <6.1.0`이라 type-aware lint가 동작하지 않는다. 품질 게이트(10.3절)가 lint 0 오류를 요구하므로 lint 쪽을 기준으로 맞춘다.

검증 게이트는 `pnpm verify` = `typecheck → lint → test → build` 순서다. 브라우저 테스트는 `pnpm test:e2e`로 분리하고 CI에서 별도 job으로 돌린다.

## 대안

| 대안                         | 장점                        | 단점                                                        | 채택하지 않은 이유                                                               |
| ---------------------------- | --------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------- |
| npm workspaces               | 추가 설치 없음, Node에 내장 | 중복 설치가 크고 peer 처리 규칙이 느슨하다                  | Viewer 의존성(three, web-ifc, That Open)이 무거워 디스크와 설치 시간 차이가 크다 |
| TypeScript 7.0.2 채택        | 컴파일 속도                 | typescript-eslint가 지원하지 않아 type-aware lint 불가      | 품질 게이트가 lint를 요구한다. typescript-eslint가 지원하면 재검토한다           |
| 라이브러리를 `^` 범위로 지정 | 보안 패치 자동 반영         | That Open peer가 `~`로 묶여 있어 개별 상향 시 조합이 깨진다 | `AGENTS.md` 2.7절 위반                                                           |

## 결과

- 모든 개발 환경과 CI가 같은 pnpm 버전과 같은 lockfile을 쓴다.
- That Open 계열 세 패키지는 한 묶음으로만 올린다. 개별 상향은 금지다.
- TypeScript 상향은 typescript-eslint 지원 여부를 확인한 뒤 별도 ADR로 처리한다.

## 후속 작업

- [ ] typescript-eslint가 TypeScript 6 이상을 지원하면 TypeScript 버전 재검토
- [ ] Phase 2에서 That Open으로 실제 모델을 적재한 뒤 조합 재확인

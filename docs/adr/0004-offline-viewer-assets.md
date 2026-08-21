# ADR-0004: web-ifc WASM과 fragments worker를 앱과 함께 배포한다

- 상태: 채택
- 날짜: 2026-08-21
- 관련 문서: `docs/DEVELOPMENT_MASTER_PLAN.md` 3.1절, 9절(Phase 2), ADR-0001, ADR-0003

## 맥락

That Open의 기본 동작은 두 자산을 실행 시점에 unpkg에서 내려받는 것이다.

- `IfcLoader.setup({ autoSetWasm: true })` — `https://unpkg.com/@thatopen/components@<version>/package.json`을 조회한 뒤 web-ifc WASM 경로를 설정한다.
- `FragmentsManager.getWorker()` — `https://unpkg.com/@thatopen/fragments@3.4.7/dist/worker/worker.mjs`를 가져온다.

이 제품은 WebView2로 실행되는 Windows 독립 실행형 애플리케이션이다. 현장 PC가 인터넷에 연결돼 있다는 보장이 없고, 사내망에서 외부 CDN이 막혀 있는 경우도 흔하다. 기본 동작을 그대로 두면 모델 열기가 네트워크 상태에 좌우된다.

## 결정

두 자산을 앱과 함께 배포하고, 실행 시 로컬 경로에서만 읽는다.

| 자산 | 원본 | 배포 경로 |
| --- | --- | --- |
| web-ifc WASM | `web-ifc/web-ifc.wasm` | `/vendor/web-ifc/web-ifc.wasm` |
| fragments worker | `@thatopen/fragments/dist/Worker/worker.mjs` | `/vendor/fragments/worker.mjs` |

- 복사는 `apps/viewer-web/vite.config.ts`의 `bim4d:vendor-assets` 플러그인이 빌드와 개발 서버 시작 시점에 수행한다. 수동 복사에 의존하지 않는다.
- 복사본은 빌드 산출물이므로 저장소에 커밋하지 않는다(`.gitignore`).
- 버전은 `node_modules`에 설치된 것을 그대로 쓴다. 따라서 lockfile이 곧 자산 버전이며, ADR-0003의 버전 고정이 그대로 적용된다.
- Adapter는 `autoSetWasm: false`와 `wasm: { path: '/vendor/web-ifc/', absolute: true }`를 명시하고, worker URL도 직접 넘긴다. 네트워크로 빠지는 경로를 남기지 않는다.

## 대안

| 대안 | 장점 | 단점 | 채택하지 않은 이유 |
| --- | --- | --- | --- |
| 기본값(unpkg) 유지 | 설정이 없다 | 오프라인·폐쇄망에서 모델을 열 수 없다 | 제품 실행 환경 가정과 어긋난다 |
| 자산을 저장소에 커밋 | 빌드 단계가 단순해진다 | 1.3MB WASM과 3.2MB worker가 이력에 쌓이고, 패키지 버전과 어긋날 수 있다 | lockfile을 단일 진실로 두는 편이 낫다 |
| 최초 실행 시 내려받아 캐시 | 배포 크기가 작다 | 첫 실행에 네트워크가 필요하고 캐시 무효화 규칙이 늘어난다 | 오프라인 요구를 만족하지 못한다 |

## 결과

- 모델 열기가 네트워크 상태와 무관해진다.
- 배포 크기가 약 4.5MB 늘어난다. 설치형 데스크톱 앱이므로 감당할 수 있는 비용이다.
- That Open 버전을 올리면 자산도 자동으로 함께 바뀐다. 별도 갱신 절차가 없다.

## 함께 기록해 두는 동작

`@thatopen/fragments` 3.4.7에서 모델을 해제한 직후 `FragmentsModels.update(true)`를 호출하면 worker 응답을 기다린 채 돌아오지 않는 경우가 있다. 재현은 결정적이지 않고, 브라우저 테스트에서 3회 중 2회 발생했다.

Adapter는 해제 경로에서 강제 update를 호출하지 않는다. Scene에서 이미 object를 제거했으므로 다음 렌더 프레임에 화면이 갱신된다. 적재 경로의 `update(true)`는 정상 동작하므로 그대로 둔다.

## 후속 작업

- [ ] fragments 버전을 올릴 때 해제 직후 `update(true)` 동작을 다시 확인하고, 고쳐졌으면 위 예외를 없앤다
- [ ] C# Shell 패키징 단계에서 `dist/vendor/`가 설치 산출물에 포함되는지 확인한다 (Phase 9)

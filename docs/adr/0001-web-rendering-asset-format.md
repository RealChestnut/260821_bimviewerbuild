# ADR-0001. Web Rendering Asset 포맷을 Fragments(.frag)로 확정한다

- 상태: 채택
- 일자: 2026-08-21
- 관련: `docs/DEVELOPMENT_MASTER_PLAN.md` 3.2, 7, 14절 · `docs/IFC_통합_정리_2026-08-20.md` 19절 · `AGENTS.md` 1.4, 2.7절
- 대체 대상: IFC 기준서 19절 흐름도의 미결정 항목 `.frag / GLB / XKT 등`

## Decision

Web Viewer가 표시하는 Rendering Asset 포맷은 **Fragments(`.frag`)** 로 확정한다.

- 변환 라이브러리는 `@thatopen/fragments` 3.x 계열을 사용한다 (확인 시점 최신 3.4.7).
- IFC → Fragments 변환은 `@thatopen/fragments`가 제공하는 IFC 변환기(web-ifc 기반)로 수행한다.
- Python IfcOpenShell Worker는 형상 변환 경로에서 제외한다. Worker의 책임은 IFC 의미 해석, 일정 관계, 검증, IFC Export로 한정한다.
- `.frag`은 **파생물**이다. 진실의 원천은 원본 IFC 파일과 그 fingerprint다.

## Drivers

1. 마스터 계획 3.2절이 Viewer를 That Open Components + Three.js로 이미 확정했다. Fragments는 그 스택의 네이티브 포맷이다.
2. 마스터 계획 14절이 "대형 모델 브라우저 메모리"를 주요 위험으로 지목하고 대응책에 Fragments를 명시한다. 포맷 선택이 그 대응의 전제다.
3. Selection, Isolation, 4D 가시성 제어가 모두 Element 단위로 동작해야 한다. 포맷이 Element identity를 잃으면 제품의 핵심 기능이 성립하지 않는다.
4. Windows 상용 배포 대상이므로 렌더링 스택의 라이선스가 제약 조건이다.

## Alternatives considered

1. **GLB / glTF** — 범용 포맷, 도구 생태계가 넓다.
2. **XKT (xeokit)** — BIM 특화 포맷, 대형 모델 성능이 검증되어 있다.
3. **사전 변환 없이 런타임에 web-ifc로 IFC 직접 파싱** — 변환 단계가 사라진다.
4. **Fragments(.frag)**

## Why chosen

**GLB/glTF 기각.** glTF는 IFC Element identity와 Property를 표준 방식으로 담지 않는다. GlobalId와 Pset을 별도 사이드카로 관리해야 하고, Selection 단위가 exporter가 만든 mesh/node 구조에 종속된다. 4D 시뮬레이션이 요구하는 "GlobalId로 지정한 객체 하나의 가시성 토글"이 포맷 차원에서 보장되지 않는다.

**XKT 기각.** `@xeokit/xeokit-sdk`(확인 시점 2.6.113)는 **AGPL-3.0**이다. Windows 상용 데스크톱 배포에는 별도 상용 라이선스 계약이 필요하다. 더불어 XKT 채택은 That Open 스택 폐기를 뜻하므로 마스터 계획 3.2절의 재결정을 수반한다. 성능 이점만으로 정당화되지 않는다.

**런타임 직접 파싱 기각.** 사전 변환이 없으면 모델을 열 때마다 IFC 전체를 재파싱한다. 대형 모델의 로딩 시간과 피크 메모리가 그대로 노출되며, 이는 14절 위험을 완화하지 못하고 악화시킨다. 프로젝트를 다시 열 때 캐시가 없다는 뜻이기도 하다.

**Fragments 채택 근거.**

| 항목 | 확인값 |
|---|---|
| `@thatopen/fragments` 라이선스 | MIT |
| `@thatopen/components` 라이선스 | MIT |
| `web-ifc` 라이선스 | MPL-2.0 |
| Fragments 내부 인코딩 | flatbuffers 25.2.10 기반 binary |
| 압축 | pako (zlib) |
| `@thatopen/components` 3.4.8의 peer 제약 | `@thatopen/fragments: ~3.4.7`, `three: >=0.182.0`, `web-ifc: >=0.0.77` |

MIT / MPL-2.0 조합은 상용 Windows 배포에 제약이 없다. flatbuffers 기반 binary는 전체 역직렬화 없이 부분 접근이 가능한 구조이므로 지연 로딩 전략과 맞는다. 그리고 `components`가 `fragments`를 `~` 범위로 고정하고 있어, That Open Components를 쓰는 한 Fragments는 선택이 아니라 스택의 구성 요소다.

## Consequences

- IFC 기준서 19절 변환 흐름의 마지막 단계가 확정된다: `내부 Element Registry + Geometry Asset` → **Fragments 변환** → `4D Viewer`.
- **Fragments 포맷은 안정 API가 아니다.** 3.0.0(2025-04-10) 이후 3.1.0(2025-07), 3.2.0(2025-10), 3.3.0(2026-01), 3.4.0(2026-04)으로 minor가 반복 출시됐다. 포맷과 API 변경 이력이 있으므로 `.frag` 산출물을 영구 캐시로 신뢰하면 안 된다.
- 따라서 `.frag` 캐시에는 생성에 사용한 fragments 버전과 원본 IFC fingerprint를 함께 기록하고, 둘 중 하나라도 불일치하면 재변환한다.
- `@thatopen/components`와 `@thatopen/fragments`는 개별 업그레이드가 불가능하다. 항상 함께 올리고, 업그레이드는 별도 작업 패킷으로 다룬다.
- `three`와 `web-ifc`의 peer 범위가 `>=`로 열려 있다. lockfile로 정확한 버전을 고정하지 않으면 재현 불가능한 빌드가 나온다.
- 형상 변환이 TypeScript 측에 있으므로 Python Worker 없이도 Viewer를 독립 개발할 수 있다. 마스터 계획 8.1절 Viewer-first 전략과 일치한다.

## Follow-ups

- Phase 0에서 `three`, `web-ifc`, `@thatopen/components`, `@thatopen/fragments` 버전을 lockfile로 고정한다.
- Phase 2에서 설치된 버전 기준으로 IFC → Fragments 변환기의 정확한 API 이름과 시그니처를 확인하고 문서화한다. 본 ADR은 API 세부를 확정하지 않는다.
- `.frag` 캐시 스키마에 `fragmentsVersion`, `sourceFingerprint` 필드를 포함한다.
- 대좌표 모델의 원점 오프셋(`AGENTS.md` 2.5절)을 변환 단계에서 적용할지 렌더 단계에서 적용할지 Phase 2에서 결정한다.
- 성능 목표 수치(삼각형 수, 파일 크기 상한, 목표 FPS, 최대 Element 수)는 여전히 미결정이다. Phase 2 종료 시 실측을 근거로 확정한다.

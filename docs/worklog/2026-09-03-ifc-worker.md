# 작업 기록 — IfcOpenShell Worker (Phase 7)

- 날짜: 2026-09-03
- 브랜치: `feature/task-element-assignment`
- 대상 Phase: Phase 7 — IfcOpenShell Worker (마스터 계획 9절)

---

## 1. 무엇을 만들었나

| 마스터 계획 항목 | 어디에 |
| --- | --- |
| IPC 계약 | ADR-0009. 자식 프로세스 stdio에 줄 단위 JSON |
| Worker 프로세스 관리 | `packages/ifc-worker-client` — 띄우기, 줄 세우기, 놓기 |
| Worker timeout/crash/restart | 같은 곳. 마감은 부모가 재고, 죽으면 다음 요청에서 다시 띄운다 |
| IFC metadata 검증 | `inspect` — Schema, 부재 수, GlobalId 중복·누락, 일정 유무, 단위 |
| Ifc4D 일정 가져오기·내보내기 | `import-schedule` / `export-schedule` + 왕복 테스트 |
| Python 런타임 패키징 | 개발용 실행 조건 고정(`requirements.txt`)과 CI job. 런타임 동봉은 Phase 9 |

## 2. 전송 방식을 고르기까지

마스터 계획 16절 Follow-ups에 이런 줄이 있었다.

> IPC 방식은 초기 HTTP/WebSocket으로 시작하고 보안 요구가 확정되면 Named Pipe를 검토한다.

이 줄은 **결정이 아니라 숙제**다. 같은 목록의 "Phase 0에서 패키지 관리자 확정"은 ADR-0003으로 닫혔고, 이 줄은 열려 있었다. 문장 자체도 전환을 전제한다.

후보를 열 개 늘어놓고 제품 조건으로 걸렀다. Pythonnet과 Pyodide는 마스터 계획 3.1절의 "Worker로 격리"와 16절이 적은 이점(워커 장애가 Desktop을 죽이지 않는다)을 정면으로 버려서 탈락. gRPC는 메서드 넷에 툴체인이 과하고, 파일 드롭 큐는 대화형에 안 맞고, AF_UNIX는 Named Pipe와 얻는 게 같은데 Windows 지원이 못하고, WebSocket은 HTTP의 비용을 다 지고 서버 푸시만 얻는다.

결선 넷을 축으로 재고 **stdio JSON Lines**를 골랐다.

| 축 | stdio | HTTP | Named Pipe | 일회성 CLI |
| --- | --- | --- | --- | --- |
| 포트·방화벽 | 없음 | 임의 포트 + 정책 위험 | 없음 | 없음 |
| 크래시 감지 | EOF + exit code | 타임아웃 추정 | 파이프 끊김 | exit code |
| 고아 프로세스 | 부모가 죽으면 자멸 | 남을 수 있음 | 감시 필요 | 없음 |
| 시작 지연 | 한 번 | 한 번 | 한 번 | 매 요청 |
| 원격 확장 | 불가 | 가능 | 불가 | 불가 |

Phase 7의 완료 항목이 timeout·crash·restart라서, 그 셋을 가장 직접 다루는 쪽을 골랐다. 원격 확장은 이 제품(단일 PC 데스크톱, 폐쇄망 배포 대상)에서 지금 쓰지 않을 이점이다.

**되돌릴 수 있게 두었다.** `IfcWorkerPort`에는 전송이 등장하지 않고, 어느 전송으로도 지킬 수 있는 것만 넣었다. 진행률 콜백과 취소를 넣지 않은 것은 그래서다. 넣는 순간 Port가 전송을 전제하게 되고 이 결정을 되돌릴 수 없게 된다.

## 3. 진행 순서

1. **ADR-0009** — 규약, 오류 코드, 수명 정책, 패키징 범위를 먼저 적었다. 구현이 문서를 따라가게 했다
2. **protocol.py** — 줄 파싱과 응답 만들기. 형태를 믿지 않고 전부 검사한다
3. **inspection.py** — 수령 파일 점검. 기준서 20절 항목 중 기계가 볼 수 있는 것만
4. **schedule_io.py** — Ifc4D 왕복. 여기가 가장 크다
5. **loop.py / `__main__.py`** — 줄을 읽고 줄을 쓰는 본체
6. **`packages/ifc-worker-client`** — 띄우기와 수명 관리
7. **CI job과 문서**

각 단계마다 pytest 또는 vitest를 먼저 썼다.

## 4. 정한 규칙과 그 이유

**stdout은 프로토콜 전용이다.** 사람이 읽을 것은 전부 stderr로 간다. 한 줄이라도 섞이면 그 응답은 파싱되지 않으므로, 클라이언트는 그런 줄을 보면 프로세스를 놓는다.

**큰 파일은 경로로 오간다.** 수백 MB를 base64로 한 줄에 실으면 파이프 버퍼와 메모리가 함께 터진다. 원본은 읽기만 하고 쓰기는 부모가 지정한 출력 경로에만 한다 (AGENTS.md 2.1절).

**`inspect`는 판정하지 않는다.** 사실만 돌려주고 "받아들일 만한 파일인가"는 부르는 쪽이 정한다. 검증 게이트(reject / warn)는 AGENTS.md 1.4절이 아직 미결정으로 둔 항목이라 여기서 굳히지 않았다.

**내보내기는 일정을 얹지 않고 갈아 끼운다.** 걷어 내지 않으면 같은 파일을 두 번 내보낼 때 Task가 겹쳐 쌓인다. 부재와 공간 구조는 건드리지 않고 일정이 만든 것만 지운다.

**마감은 부모가 잰다.** 무한 루프에 빠진 워커는 자기 시계를 못 본다.

**실패 횟수는 응답을 하나 받았을 때 0으로 돌린다.** 처음에는 "뜨는 데 성공하면 0"으로 짰는데, 요청마다 뜨고 죽는 워커가 매번 새로 떠서 횟수가 1을 넘지 못했다. 부팅 루프를 막는 장치가 무력해진다.

## 5. ADR-0002의 잠정 매핑을 확정했다

ADR-0002는 IFC Export 매핑을 적으면서 "fixture 왕복 테스트로 검증하기 전에는 확정으로 취급하지 않는다"고 못 박았다. Phase 7이 그 시점이다.

`three-elements-ifc4.ifc`를 원본으로 네 operation을 모두 내보내고 다시 읽어 확인했다.

| TaskOperation | PredefinedType | 관계 | 왕복 |
| --- | --- | --- | --- |
| `CONSTRUCT` | `CONSTRUCTION` | `IfcRelAssignsToProduct` | 복원 |
| `DEMOLISH` | `DEMOLITION` | `IfcRelAssignsToProcess` | 복원 |
| `MODIFY` | `RENOVATION` | `IfcRelAssignsToProduct` | 복원 |
| `TEMPORARY` | `USERDEFINED` + `ObjectType` | `IfcRelAssignsToProduct` | 복원 |

**자체 PropertySet은 쓰지 않기로 했다.** ADR-0002는 `TEMPORARY`에 `USERDEFINED + ObjectType`과 자체 Pset을 함께 적었는데, `ObjectType`만으로 왕복이 된다. 같은 사실을 두 곳에 적으면 어긋날 때 어느 쪽이 정본인지 알 수 없다. ADR-0002를 그렇게 갱신했다.

`IfcTask.PredefinedType`은 Task 하나에 하나뿐이다. 그래서 한 Task가 서로 다른 operation으로 여러 부재를 다루면 IFC로 온전히 옮길 수 없다. 그런 할당과 그 파일에 없는 부재는 건너뛰고 `skippedAssignments`로 몇 개를 못 썼는지 알린다.

## 6. 겪은 것

**Windows에서 한글이 깨져 나갔다.** 파이프로 연결하면 Python이 지역 코드 페이지(cp949)를 쓴다. 워커가 한글이 든 응답을 쓰는 순간 인코딩이 깨졌고, Node 쪽에서는 access violation(0xC0000005)으로 프로세스가 죽은 것처럼 보였다. 세 스트림을 UTF-8로 맞추자 사라졌다. 규약이 UTF-8이라고 적어 두었어도 런타임이 그렇게 동작하는지는 별개다.

**죽인 프로세스의 유령이 새 프로세스를 죽였다.** 마감을 넘겨 워커를 죽인 뒤 다음 요청으로 새 워커를 띄웠는데, 앞 프로세스의 `exit` 이벤트가 뒤늦게 도착해 방금 띄운 워커를 놓아 버렸다. 이벤트 처리기가 "지금 살아 있는 프로세스가 나인가"를 확인하게 고쳤다.

**`ifcopenshell`의 소멸자가 경고를 낸다.** `file.__del__`에서 `KeyError`가 뜬다. 라이브러리 쪽 문제이며 테스트 결과에는 영향이 없어 그대로 두었다.

## 7. 만들고 고친 파일

| 파일 | 성격 |
| --- | --- |
| `docs/adr/0009-ifc-worker-ipc.md` | 신규 — 규약의 정본 |
| `services/ifc-worker/ifc_worker/protocol.py` | 신규 — 줄 파싱과 응답 |
| `services/ifc-worker/ifc_worker/inspection.py` | 신규 — 수령 파일 점검 |
| `services/ifc-worker/ifc_worker/schedule_io.py` | 신규 — Ifc4D 왕복 |
| `services/ifc-worker/ifc_worker/loop.py` | 신규 — 본체, UTF-8 고정 |
| `services/ifc-worker/tests/**` | 신규 — pytest 49개 |
| `packages/contracts/src/ifcWorker.ts` | 신규 — 전송이 없는 Port |
| `packages/ifc-worker-client/**` | 신규 — stdio 어댑터, vitest 14개 |
| `.github/workflows/ci.yml` | 수정 — Python job 추가 |
| `docs/adr/0002-4d-operation-vocabulary.md` | 수정 — 매핑 확정 |
| `AGENTS.md`, `README.md`, 마스터 계획 7절 | 수정 |

## 8. 쓴 언어와 도구

| 갈래 | 쓴 것 |
| --- | --- |
| 워커 | Python 3.14(로컬) / 3.13(CI), ifcopenshell 0.8.5, 표준 라이브러리만 |
| 워커 테스트 | pytest 9 |
| 클라이언트 | TypeScript 5.9.3, Node `child_process`, 의존성 없음 |
| 클라이언트 테스트 | Vitest 4 (실제 프로세스를 띄운다) |

가짜 워커는 Node 스크립트를 임시 파일에 써서 띄웠다. 마감을 안 지키는 워커, 요청을 받으면 죽는 워커, 규약 버전이 다른 워커, stdout을 더럽히는 워커를 각각 만들어 시험했다.

## 9. 검증 결과

| 게이트 | 결과 |
| --- | --- |
| `pnpm verify` | 통과 |
| 단위·계약 테스트 (vitest) | 629개 통과 |
| `pnpm test:worker` | 14개 통과 (실제 Python 워커) |
| `python -m pytest` | 49개 통과 |

## 10. 남긴 것

- **앱은 아직 워커를 부르지 않는다.** `apps/viewer-web`은 브라우저라 프로세스를 띄울 수 없다. 워커를 관리하는 것은 마스터 계획 3.1절대로 Phase 8의 C# Shell이다. 지금은 규약과 클라이언트, 그리고 그것을 검증하는 테스트까지가 산출물이다
- **런타임 동봉**은 Phase 9에서 설치 프로그램과 함께 정한다 (embeddable Python / PyInstaller)
- **검증 게이트**(reject / warn)는 여전히 미결정이다. `inspect`는 사실만 돌려준다

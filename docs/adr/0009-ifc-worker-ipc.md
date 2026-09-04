# ADR-0009: IFC Worker와 stdio JSON Lines로 주고받는다

- 상태: 채택
- 날짜: 2026-09-03
- 관련 문서: `docs/DEVELOPMENT_MASTER_PLAN.md` 3.1절, 5절, 7절, 9절(Phase 7), 16절 Follow-ups · `docs/IFC_통합_정리_2026-08-20.md` 13, 20절 · `AGENTS.md` 2.1, 2.6, 2.7, 3절
- 해소 대상: 마스터 계획 16절 Follow-up "IPC 방식은 초기 HTTP/WebSocket으로 시작하고 보안 요구가 확정되면 Named Pipe를 검토한다"

## 맥락

Phase 7은 Python IfcOpenShell Worker를 세운다. 마스터 계획 9절이 요구하는 것은 여섯이다 — Python 런타임 패키징, Worker 프로세스 관리, IPC 계약, IFC metadata 검증, Ifc4D 일정 가져오기·내보내기, Worker timeout/crash/restart 처리.

전송 방식은 정해진 적이 없다. 마스터 계획 3.1절은 "IfcOpenShell/Ifc4D는 별도 Python Worker로 격리한다"까지만 못 박고, 16절 Follow-ups가 "초기 HTTP/WebSocket으로 시작하고 보안 요구가 확정되면 Named Pipe를 검토한다"를 **결정이 아니라 남은 숙제**로 적어 두었다. 5절 통신 규칙도 앱 안의 Command/Event/Query만 다루고 프로세스 경계는 다루지 않는다.

제약 셋이 선택을 좁힌다.

1. **단일 PC 데스크톱이다.** 마스터 계획 2.1절의 1차 범위는 Windows x64 독립 실행형이며, 워커를 다른 머신에 두는 그림은 범위에 없다.
2. **폐쇄망 배포가 대상이다.** Phase 9가 WebView2 Fixed Version을 폐쇄망용으로 명시한다. 그런 환경에서 로컬 서버 소켓을 여는 일은 보안 정책과 다툴 수 있다.
3. **Phase 7의 완료 항목이 프로세스 수명이다.** timeout·crash·restart가 이 단계의 본체이며, 전송 방식이 그 셋을 얼마나 직접 다루는지가 곧 구현 난이도다.

## 결정

### 전송 — stdio JSON Lines

부모가 워커를 자식 프로세스로 띄우고 `stdin` / `stdout`으로 **한 줄에 JSON 하나**를 주고받는다. 포트도, 토큰도, 소켓도 쓰지 않는다.

```text
부모  ──spawn──>  python -m ifc_worker
  stdin   {"id":"1","method":"inspect","params":{"path":"C:/…/a.ifc"}}\n
  stdout  {"id":"1","ok":true,"result":{…}}\n
  stderr  구조화 로그 (사람이 읽는다)
```

- 인코딩은 UTF-8, 줄 끝은 `\n` 하나다. 줄 안에 날 개행을 넣지 않는다(JSON이 `\n`으로 이스케이프한다).
- **`stdout`은 프로토콜 전용이다.** 워커의 어떤 코드도 `print`로 stdout을 더럽히지 않는다. 사람이 읽을 것은 전부 `stderr`로 간다. 한 줄이라도 섞이면 그 응답은 파싱되지 않는다.
- 시작하면 워커가 `ready` 한 줄을 먼저 낸다. 부모는 이 줄을 보고 준비를 안다.

```json
{ "event": "ready", "protocol": 1, "ifcopenshell": "0.8.5", "python": "3.14.6" }
```

`protocol`이 부모가 아는 값과 다르면 부모는 워커를 죽이고 실패로 돌려준다. 모르는 규약으로 계속 말하지 않는다.

### 요청과 응답

| 방향 | 모양 |
| --- | --- |
| 요청 | `{"id": string, "method": string, "params": object}` |
| 성공 | `{"id": string, "ok": true, "result": object}` |
| 실패 | `{"id": string, "ok": false, "error": {"code": string, "message": string}}` |

- `id`는 부모가 만든다. 응답은 같은 `id`를 되돌린다.
- 실패는 예외가 아니라 값이다. 워커는 처리 중 예외를 잡아 `ok:false`로 바꾼다. 이는 저장소의 `Parsed<T>` / `CommandResult`와 같은 방침이다.
- 오류 `code`는 기계가 분기할 수 있는 안정된 문자열이며 `worker.`로 시작한다.

| 코드 | 뜻 |
| --- | --- |
| `worker.request.malformed` | 줄이 JSON이 아니거나 필드가 빠졌다 |
| `worker.method.unknown` | 모르는 method다 |
| `worker.file.not-found` | 경로가 없다 |
| `worker.ifc.unreadable` | IfcOpenShell이 파일을 열지 못했다 |
| `worker.ifc.unsupported-schema` | IFC2X3 / IFC4 / IFC4X3이 아니다 |
| `worker.schedule.not-found` | 파일에 `IfcWorkSchedule`이 없다 |
| `worker.internal` | 위에 없는 실패. `message`에 원인을 적는다 |

### 큰 바이트는 줄에 싣지 않는다

IFC 파일은 수십에서 수백 MB가 된다. base64로 한 줄에 실으면 파이프 버퍼와 메모리가 함께 터진다. **파일은 경로로 주고받는다.**

- 입력 경로는 **읽기 전용**이다. 워커는 원본 IFC를 열되 쓰지 않는다 (`AGENTS.md` 2.1절).
- 쓰기는 부모가 지정한 출력 경로에만 한다. 워커가 저장 위치를 정하지 않는다.

### 메서드

| method | params | result |
| --- | --- | --- |
| `ping` | `{}` | `{ "pong": true }` |
| `inspect` | `{ "path": string }` | 아래 metadata |
| `import-schedule` | `{ "path": string }` | `{ "schedule": <일정 v3 JSON> }` |
| `export-schedule` | `{ "sourcePath": string, "outputPath": string, "schedule": <일정 v3 JSON> }` | `{ "outputPath": string, "taskCount": number }` |

`inspect`가 돌려주는 metadata는 기준서 20절 수령 파일 점검에서 기계가 볼 수 있는 항목만 담는다.

```json
{
  "schema": "IFC4",
  "productCount": 3,
  "products": { "IfcWall": 2, "IfcSlab": 1 },
  "duplicateGlobalIds": [],
  "missingGlobalIdCount": 0,
  "hasWorkSchedule": false,
  "units": { "length": "MILLIMETRE" }
}
```

**판정하지 않는다.** `inspect`는 사실만 돌려주고 "받아들일 만한 파일인가"는 부르는 쪽이 정한다. 검증 게이트(reject / warn)는 `AGENTS.md` 1.4절이 아직 미결정으로 표시한 항목이라 여기서 굳히지 않는다.

일정 가져오기·내보내기는 ADR-0005·0006·0008이 정한 v3 JSON을 그대로 주고받는다. Worker가 새 스키마를 만들지 않는다. IFC 쪽 Entity는 `AGENTS.md` 2.6절이 정한 여섯을 쓴다 — `IfcWorkSchedule`, `IfcTask`, `IfcTaskTime`, `IfcRelSequence`, `IfcRelAssignsToProduct`, `IfcRelAssignsToProcess`.

### 수명 · timeout · 재시작

- **한 번에 하나만 처리한다.** 부모가 직렬 큐로 보낸다. `id` 다중화는 규약에 있으나 지금은 쓰지 않는다. 워커 안에서 IfcOpenShell을 동시에 굴리면 메모리가 배로 든다.
- **요청마다 마감이 있다.** 부모가 정한 시간을 넘기면 그 요청은 `worker.timeout`으로 실패하고 부모가 프로세스를 죽인다. 워커가 스스로 마감을 재지 않는다. 무한 루프에 빠진 워커는 자기 시계를 못 본다.
- **죽으면 다음 요청에서 다시 띄운다.** 미리 살려 두지 않는다. 크래시 직후 다시 죽는 워커를 계속 살리면 부팅 루프가 된다.
- **연속 실패에는 멈춘다.** 같은 이유로 이어서 세 번 죽으면 그 뒤 요청은 띄우지 않고 즉시 실패로 돌려준다. 사람이 볼 수 있게 마지막 `stderr`를 함께 남긴다.
- 부모가 죽으면 워커의 `stdin`이 닫힌다. 워커는 EOF를 보고 스스로 끝낸다. 고아 프로세스를 남기지 않는다.

### 어디에 두는가

| 자리 | 내용 |
| --- | --- |
| `services/ifc-worker/` | Python 워커. `python -m ifc_worker`로 실행 |
| `packages/ifc-worker-client/` | TypeScript 클라이언트. 자식 프로세스를 띄우고 줄을 주고받는다 (Node 전용) |
| `packages/contracts` | `IfcWorkerPort` — 전송이 등장하지 않는 계약 |

`IfcWorkerPort`에는 **어느 전송으로도 지킬 수 있는 것만** 넣는다. 진행률 콜백이나 취소처럼 전송마다 뜻이 달라지는 것은 넣지 않는다. 넣는 순간 Port가 전송을 전제하게 되고, 이 결정을 되돌릴 수 없게 된다.

Phase 8의 C# Shell은 같은 규약을 C#으로 구현한다. 규약이 문서에 있고 전송이 stdio라 언어가 달라도 같은 워커를 쓴다.

### 패키징의 범위

Phase 7에서는 **개발용 실행 조건만 고정한다.**

- `services/ifc-worker/requirements.txt`에 `ifcopenshell` 버전을 고정한다
- CI가 그 조건으로 pytest를 돌린다

**런타임 동봉은 Phase 9의 일이다.** 마스터 계획 9절이 "Python/IfcOpenShell runtime 포함"을 Phase 9 항목으로 적었다. embeddable Python이냐 PyInstaller냐는 설치 프로그램 형태와 함께 정한다.

## 대안

| 대안 | 장점 | 단점 | 채택하지 않은 이유 |
| ---- | ---- | ---- | ------------------ |
| 로컬 HTTP (16절 문구) | curl로 시험, 동시 요청 공짜, 원격 확장 가능 | 임의 포트 핸드셰이크, 토큰 인증, 방화벽·보안 정책, 부모가 죽어도 남는 고아 서버, 크래시를 타임아웃으로만 안다 | 지금 쓰지 않을 이점(원격)에 Phase 7의 본체(수명 관리) 비용을 지불한다 |
| 로컬 WebSocket | 서버 푸시로 진행률 | HTTP의 단점을 그대로 지고 얻는 것은 푸시뿐 | 진행률은 stdio에서도 같은 줄로 밀 수 있다 |
| Named Pipe | 포트 없음, ACL로 접근 제한 | 파이프 이름 관리, Node 쪽 시험이 번거롭다 | 얻는 것이 stdio와 거의 같은데 코드가 는다. 보안 요구가 확정되면 어댑터를 갈아 끼운다 |
| 일회성 CLI | 상주 프로세스가 없어 수명 관리가 공짜 | 요청마다 인터프리터와 IfcOpenShell 로딩(1초 안팎), 진행률 불가 | 내보내기처럼 느린 작업이 반복되면 그 비용이 그대로 쌓인다 |
| gRPC | 스키마 강제, 스트리밍 | protoc 툴체인, 코드 생성, 배포 크기 | 메서드 넷에 과하다 |
| Pythonnet 임베드 | 프로세스 경계가 없다 | 워커 크래시가 Desktop 전체를 죽인다 | 마스터 계획 3.1절의 격리와 16절이 적은 이점을 정면으로 버린다 |
| Pyodide/WASM | Python 프로세스 자체가 없다 | ifcopenshell WASM의 크기·성숙도, 브라우저 메모리 | 3.1절의 역할 분담을 바꾸는 일이라 이 결정의 범위를 넘는다 |

## 결과

**가능해지는 것**

- 포트·토큰·방화벽 없이 워커를 띄운다. 폐쇄망에서 변수가 하나 줄어든다
- 크래시를 exit code와 EOF로 즉시 안다. 부모가 죽으면 워커도 함께 끝난다
- Node(개발·CI)와 C#(Phase 8)이 같은 규약으로 같은 워커를 쓴다

**포기하는 것**

- 워커를 다른 머신에 두는 길. 필요해지면 HTTP 어댑터를 새로 만든다
- `curl` 한 줄로 찔러 보는 편의. 대신 손으로 시험할 작은 CLI를 함께 둔다
- 동시 요청. 규약에는 `id`가 있으나 지금은 직렬로만 보낸다

**영향 받는 경로와 계약**

- `services/ifc-worker/**` — 워커 본체와 pytest
- `packages/ifc-worker-client/**` — stdio 어댑터, 수명·timeout·재시작
- `packages/contracts` — `IfcWorkerPort`
- `.github/workflows/ci.yml` — Python job 추가
- Phase 8의 C# Shell — 같은 규약을 구현한다

## 후속 작업

- [x] 마스터 계획 16절 Follow-up을 이 ADR로 대체했음을 `AGENTS.md` 1.4절 해소 표에 적는다
- [x] 마스터 계획 7절 저장소 구조에 `packages/ifc-worker-client/`를 더한다
- [ ] Phase 9에서 Python 런타임 동봉 방식을 정한다 (embeddable / PyInstaller)
- [ ] 검증 게이트(reject / warn)는 `AGENTS.md` 1.4절에 미결정으로 남긴다. `inspect`는 사실만 돌려준다

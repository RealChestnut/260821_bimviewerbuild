# ifc-worker

Python IfcOpenShell Worker. IFC 의미 해석, 공정 관계, 검증, IFC 내보내기를 담당한다.

형상 변환은 이 Worker의 책임이 아니다. TypeScript 측에서 Fragments로 변환한다 (`AGENTS.md` 2.7절).

부모가 자식 프로세스로 띄우고 `stdin` / `stdout`으로 줄 단위 JSON을 주고받는다. 규약의 정본은
[`docs/adr/0009-ifc-worker-ipc.md`](../../docs/adr/0009-ifc-worker-ipc.md)다.

## 실행

```bash
pip install -r requirements-dev.txt
python -m ifc_worker
```

한 줄에 요청 하나를 넣으면 한 줄에 응답 하나가 나온다.

```console
$ python -m ifc_worker
{"event":"ready","protocol":1,"ifcopenshell":"0.8.5","python":"3.13.1"}
{"id":"1","method":"inspect","params":{"path":"../../packages/test-fixtures/ifc/three-elements-ifc4.ifc"}}
{"id":"1","ok":true,"result":{"schema":"IFC4","productCount":3,...}}
```

`stdout`은 프로토콜 전용이다. 사람이 읽을 것은 전부 `stderr`로 간다. 한 줄이라도 섞이면 그
응답은 파싱되지 않는다.

## 메서드

| method | params | result |
| --- | --- | --- |
| `ping` | `{}` | `{ "pong": true }` |
| `inspect` | `{ "path" }` | Schema, 부재 수, GlobalId 중복·누락, 일정 유무, 길이 단위 |
| `import-schedule` | `{ "path" }` | `{ "schedule": <일정 v3 JSON> }` |
| `export-schedule` | `{ "sourcePath", "outputPath", "schedule" }` | `{ "outputPath", "taskCount", "skippedAssignments" }` |

`inspect`는 **사실만** 돌려준다. "받아들일 만한 파일인가"는 부르는 쪽이 정한다. 검증 게이트는
`AGENTS.md` 1.4절이 아직 미결정으로 둔 항목이다.

큰 파일은 값이 아니라 경로로 오간다. 원본은 읽기만 하고, 쓰기는 부모가 지정한 출력 경로에만
한다 (`AGENTS.md` 2.1절).

## 시험

```bash
python -m pytest          # 이 디렉터리에서
pnpm test:worker          # 저장소 뿌리에서. 실제 워커를 띄워 클라이언트까지 함께 본다
```

## 요구 환경

- Python 3.11 이상 (CI는 3.13)
- `requirements.txt`가 `ifcopenshell` 버전을 고정한다

런타임 동봉(embeddable Python / PyInstaller)은 Phase 9에서 설치 프로그램과 함께 정한다.

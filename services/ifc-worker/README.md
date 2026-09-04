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

| method            | params                                       | result                                                    |
| ----------------- | -------------------------------------------- | --------------------------------------------------------- |
| `ping`            | `{}`                                         | `{ "pong": true }`                                        |
| `inspect`         | `{ "path" }`                                 | Schema, 부재 수, GlobalId 중복·누락, 일정 유무, 길이 단위 |
| `import-schedule` | `{ "path" }`                                 | `{ "schedule": <일정 v3 JSON> }`                          |
| `export-schedule` | `{ "sourcePath", "outputPath", "schedule" }` | `{ "outputPath", "taskCount", "skippedAssignments" }`     |

`inspect`는 **사실만** 돌려준다. "받아들일 만한 파일인가"는 부르는 쪽이 정한다. 검증 게이트는
`AGENTS.md` 1.4절이 아직 미결정으로 둔 항목이다.

큰 파일은 값이 아니라 경로로 오간다. 원본은 읽기만 하고, 쓰기는 부모가 지정한 출력 경로에만
한다 (`AGENTS.md` 2.1절).

## 시험

```bash
python -m pytest          # 이 디렉터리에서
pnpm test:worker          # 저장소 뿌리에서. 실제 워커를 띄워 클라이언트까지 함께 본다
```

## 설치본용 런타임 만들기

설치본은 시스템 Python을 쓰지 않는다. 임베더블 CPython을 풀고 그 안에 wheel을 깐다
([`docs/adr/0011-install-layout.md`](../../docs/adr/0011-install-layout.md)).

```bash
pnpm worker:runtime       # 저장소 뿌리에서
```

만드는 자리는 `apps/desktop/artifacts/runtime`이며 트리는 이렇다.

```text
runtime/
  python/                  임베더블 CPython 3.13.15
    python.exe
    python313._pth         sys.path를 정한다. PYTHONPATH도 작업 디렉터리도 보지 않는다
    Lib/site-packages/     ifcopenshell과 그 의존 wheel
  ifc-worker/
    ifc_worker/            이 폴더의 패키지를 복사한 것
```

만든 뒤 워커를 **다른 작업 디렉터리에서** 띄워 `ping`과 `inspect`까지 실제로 돌려 본다.
`_pth`가 워커를 찾는지가 이 배치의 핵심이라 그 확인이 절차에 들어 있다.

폐쇄망에서는 미리 받아 둔 것을 준다. 그러면 네트워크를 쓰지 않는다.

```bash
python services/ifc-worker/tools/build_runtime.py --embed-zip <zip> --wheel-dir <폴더>
```

임베더블 zip은 크기와 sha256을 확인한 뒤에만 푼다.

## 요구 환경

- Python 3.11 이상 (CI는 3.13)
- `requirements.txt`가 `ifcopenshell` 버전을 고정한다
- 설치본에 동봉하는 CPython 버전은 `tools/build_runtime.py`가 고정한다. 시스템 Python을
  따라가지 않으므로 올릴 때 wheel과 임베더블 zip을 함께 바꾼다

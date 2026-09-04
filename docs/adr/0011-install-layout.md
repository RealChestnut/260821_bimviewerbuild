# ADR-0011: 설치본은 실행 파일 옆에 web · ifc-worker · python을 둔다

- 상태: 채택
- 날짜: 2026-09-04
- 관련 문서: `docs/DEVELOPMENT_MASTER_PLAN.md` 7절, 9절(Phase 9) · ADR-0003 · ADR-0009 · ADR-0010 · `AGENTS.md` 3절
- 해소 대상: 마스터 계획 9절 Phase 9의 "Web assets 포함", "Python/IfcOpenShell runtime 포함", "WebView2 Evergreen 우선, 폐쇄망용 Fixed Version 선택 제공"

## 맥락

Phase 8의 셸은 실행 파일 옆에 `web/`과 `ifc-worker/`가 있으면 그쪽을 먼저 보고, 없으면 저장소 루트를 거슬러 올라가 `apps/viewer-web/dist`와 `services/ifc-worker`를 쓴다. 그 코드에는 주석이 붙어 있다 — "설치 배치는 Phase 9에서 정한다".

지금 정해야 할 것이 셋이다.

1. **설치 폴더에 무엇이 어디 놓이나.** 셸·웹·Python 워커 세 런타임이 한 폴더 안에서 서로를 찾아야 한다.
2. **Python 런타임을 어떻게 동봉하나.** `ShellSettings.PythonCommand`의 기본값은 `"python"`이며 PATH에 기대고 있다. 설치본에는 Python이 깔려 있다는 보장이 없고, 폐쇄망에서는 나중에 받아 올 수도 없다.
3. **WebView2 런타임을 어떻게 다루나.** 마스터 계획은 Evergreen 우선에 폐쇄망용 Fixed Version을 선택으로 두었다.

제약이 있다.

- **ADR-0009가 워커 실행 규약을 이미 정했다.** 자식 프로세스 stdio에 줄 단위 JSON이며, 셸은 `Command` 하나와 `Arguments`로 워커를 띄운다. 동봉 방식이 이 규약을 바꾸면 안 된다.
- **개발 배치가 계속 살아 있어야 한다.** `pnpm dev`, xunit, Playwright가 모두 저장소 배치에서 돈다.
- **ifcopenshell은 native 확장을 담은 wheel이다.** `ifcopenshell==0.8.5`는 `ifcopenshell-0.8.5-py313-none-win_amd64.whl`(24.5 MB)로 배포된다. 소스 빌드가 아니라 이 wheel을 그대로 푼다.

## 결정

### 설치 폴더 배치

```text
Bim4dViewer/
  Bim4d.Desktop.exe            셸. .NET self-contained win-x64
  *.dll                        .NET 런타임과 셸 어셈블리
  web/                         apps/viewer-web/dist를 그대로 복사
    index.html
    assets/ ...
  ifc-worker/                  services/ifc-worker의 파이썬 패키지
    ifc_worker/
  python/                      임베더블 CPython 3.13 (win-x64)
    python.exe
    python313.dll
    python313._pth
    Lib/site-packages/
      ifcopenshell/ ...
```

`web/`과 `ifc-worker/`는 Phase 8이 이미 먼저 보던 이름이다. 그 규칙을 바꾸지 않고 `python/`만 더한다.

### Python은 임베더블 배포판을 푼다

PyInstaller로 워커를 실행 파일 하나로 묶지 않는다. 임베더블 CPython을 `python/`에 풀고 그 안에 wheel을 설치한다.

- ADR-0009가 정한 실행 모양이 그대로 남는다. `Command`가 `python`에서 `python\python.exe`로 바뀔 뿐 `Arguments`는 여전히 `["-m", "ifc_worker"]`다.
- 빌드가 복사와 압축 해제뿐이라 재현된다. hidden import를 손으로 잡을 일이 없다.
- 폐쇄망에서도 wheel과 임베더블 zip 두 파일만 미리 받아 두면 만들 수 있다.

동봉하는 CPython은 **3.13.15**(win-x64 임베더블, 11,009,825 바이트)로 고정한다. 크기와
sha256을 확인한 뒤에만 푼다. 만들어진 `python/` 트리는 152 MB이며 그중 80 MB가
ifcopenshell, 45 MB가 numpy다. `ifc-worker/`는 88 KB다.

### sys.path는 `python313._pth`가 정한다

임베더블 배포판은 `python313._pth`가 있으면 `PYTHONPATH`와 사용자 site를 무시한다. 그 성질을 그대로 쓴다. 파일 내용은 이렇다.

```text
python313.zip
.
Lib\site-packages
..\ifc-worker
import site
```

경로는 `_pth` 파일이 있는 폴더 기준이므로 `..\ifc-worker`가 워커 패키지의 부모를 가리킨다. **워커를 찾는 일이 작업 디렉터리에 매이지 않는다.** 셸이 어디서 실행되든 `python\python.exe -m ifc_worker`가 같은 것을 연다.

### 배치를 고르는 규칙

셸은 시작할 때 배치를 한 번 고르고 그 사실을 로그에 남긴다.

| 순서 | 조건 | web | ifc-worker | python |
| --- | --- | --- | --- | --- |
| 1. 설치본 배치 | 실행 파일 옆에 `web/`이 있다 | `<base>/web` | `<base>/ifc-worker` | `<base>/python/python.exe` |
| 2. 개발 배치 | 위로 올라가 `pnpm-workspace.yaml`을 찾았다 | `<repo>/apps/viewer-web/dist` | `<repo>/services/ifc-worker` | PATH의 `python` |
| 3. 어느 쪽도 아니다 | — | 오류 | 오류 | 오류 |

**판단 기준은 `web/` 하나다.** 세 폴더를 따로 보면 반쯤 설치된 상태에서 배치가 섞인다.

**3번은 조용히 넘어가지 않는다.** 지금 코드는 없는 경로를 그대로 돌려주어 WebView2가 빈 화면을 띄운다. 무엇이 없는지 코드와 함께 알린다 (Phase 8이 정한 "오류는 코드와 로그 자리를 함께 보인다"를 따른다).

**개발 배치 탐색은 Release 빌드에서도 남긴다.** `dotnet run -c Release`로 저장소에서 셸을 띄우는 길을 막지 않는다. 설치본에는 `web/`이 항상 있으므로 1번에서 끝난다.

### `PythonCommand`는 자동 해석을 기본으로 둔다

`ShellSettings.PythonCommand`의 기본값을 `"python"`에서 빈 문자열로 바꾼다. 빈 값은 "배치에서 고른다"는 뜻이며 위 표의 python 열을 따른다. 사람이 값을 적으면 그 값이 이긴다.

설정 파일을 손으로 고쳐 다른 Python을 가리키는 길은 그대로 남는다. 기본값이 PATH에 기대지 않을 뿐이다.

### WebView2는 Evergreen이 기본이다

설치본은 Evergreen Runtime을 요구한다. 설치 프로그램이 존재를 확인하고 없으면 Microsoft의 bootstrapper를 부른다.

폐쇄망용 Fixed Version은 **같은 설치본의 옵션이 아니라 별도 산출물**이다. 배치에 `webview2/` 폴더가 하나 더 붙고 셸이 그 폴더를 런타임으로 지정한다. 기본 설치본을 180 MB 키워 모든 사용자에게 물리지 않는다.

## 대안

| 대안 | 장점 | 단점 | 채택하지 않은 이유 |
| ---- | ---- | ---- | ------------------ |
| PyInstaller로 워커를 exe 하나로 묶는다 | 배치가 깔끔하다. Python 개념이 사라진다 | 빌드 도구가 하나 늘고, native 확장의 hidden import를 손으로 잡아야 한다. 실행마다 압축 해제 비용 | ADR-0009의 실행 규약을 바꾸는 값어치가 없다. 임베더블은 복사뿐이라 재현된다 |
| 시스템 Python을 요구한다 | 설치본이 작다 | 사용자 PC에 3.13과 ifcopenshell이 있어야 한다. 폐쇄망에서 받아 올 수 없다 | 데스크톱 앱이 아니라 개발 환경 요구 사항이 된다 |
| `python/`도 저장소 배치처럼 `.venv`를 쓴다 | 개발과 설치본이 같아진다 | `.venv`는 만든 경로가 스크립트에 박힌다. 복사해 옮기면 깨진다 | 설치 경로가 사용자마다 다르다 |
| 작업 디렉터리로 워커를 찾는다 (지금 방식) | 코드가 짧다 | 셸을 어디서 실행하느냐에 결과가 달라진다 | `_pth`가 같은 일을 더 확실하게 한다 |
| Fixed Version을 기본으로 삼는다 | 설치본이 하나다. 브라우저 버전이 고정돼 화면이 재현된다 | 설치본이 180 MB 커지고 브라우저 보안 패치를 우리가 따라가야 한다 | 폐쇄망은 일부다. 그쪽에만 별도 산출물을 준다 |
| 세 폴더를 각각 보고 섞어 쓴다 | 반쯤 설치된 상태에서도 돈다 | 어떤 조합으로 돌고 있는지 알 수 없다 | 진단할 수 없는 상태를 만들지 않는다 |

## 결과

**가능해지는 것**

- 설치본은 Python도 Node도 깔지 않은 Windows에서 뜬다
- 배치가 이름으로 고정되어 Phase 9의 게시 스크립트와 설치 프로그램이 같은 트리를 만든다
- 폐쇄망 산출물이 기본 설치본을 키우지 않는다

**포기하는 것**

- 설치 폴더의 파일 수가 많다. 임베더블 Python과 ifcopenshell이 각자의 트리를 편다
- Python 버전 올리기가 우리 일이 된다. 시스템 Python을 따라가지 않으므로 3.14로 옮기려면 wheel과 임베더블 zip을 함께 바꿔야 한다

**영향 받는 경로와 계약**

| 무엇 | 어떻게 바뀌나 |
| --- | --- |
| `apps/desktop/src/Bim4d.Desktop/MainWindow.xaml.cs`의 `ViewerAssets` | 배치 판단이 `Bim4d.Desktop.Core`로 옮겨 간다. 창은 결과만 받는다 |
| `apps/desktop/src/Bim4d.Desktop.Core/ShellState.cs`의 `PythonCommand` | 기본값이 빈 문자열이 된다. 빈 값은 자동 해석 |
| `services/ifc-worker` | 코드는 그대로다. 설치본에서 `ifc-worker/ifc_worker`로 복사될 뿐 |
| ADR-0009의 워커 실행 규약 | 바뀌지 않는다. `Command`가 가리키는 곳만 달라진다 |

## 후속 작업

- [ ] `AGENTS.md` 1.4절 해소 표에 설치본 배치 행 추가
- [x] 배치 해석을 `Bim4d.Desktop.Core`로 옮기고 세 경우(설치본·개발·둘 다 아님)를 xunit으로 덮는다
- [x] `python/` 트리를 만드는 절차를 스크립트로 두고 CI에서 돌린다
- [ ] 게시 산출물 전체(셸 포함)의 실제 크기를 재어 이 문서에 적는다
- [ ] `ifcopenshell`의 이행 의존(numpy·shapely 등)까지 고정할지 정한다. 지금 `requirements.txt`는 `ifcopenshell`만 고정하므로 같은 커밋에서 만든 설치본이 항상 같지는 않다
- [ ] 설치 프로그램(Setup EXE 또는 MSI) 선택은 별도 ADR로 남긴다
- [ ] 제거 시 `%APPDATA%\Bim4dViewer`(설정·최근 목록·로그)를 어떻게 할지는 설치 프로그램 ADR에서 정한다

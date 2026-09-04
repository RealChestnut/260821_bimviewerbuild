# 작업 기록 — 배포 (Phase 9)

- 날짜: 2026-09-04
- 브랜치: `chore/repo-hygiene`, `feat/install-layout`, `feat/worker-runtime-packaging`, `feat/shell-install-layout`, `feat/desktop-publish`, `feat/installer-adr`, `feat/code-signing`
- 대상 Phase: Phase 9 — 배포 (마스터 계획 9절)

---

## 1. 무엇을 만들었나

| 마스터 계획 항목 | 어디에 |
| --- | --- |
| .NET self-contained Windows x64 | `apps/desktop/tools/publish.py` |
| Web assets 포함 | 같은 스크립트가 `dist`를 `web/`으로 |
| Python/IfcOpenShell runtime 포함 | `services/ifc-worker/tools/build_runtime.py` |
| WebView2 Evergreen 우선 | 설치 중 레지스트리 확인, 없을 때만 bootstrapper |
| Setup EXE 또는 MSI | `apps/desktop/installer/Bim4dViewer.iss` (Inno Setup, ADR-0012) |
| 설치·업데이트·제거 테스트 | 이 PC에서 `/VERYSILENT /CURRENTUSER`로 전부 |
| 코드 서명 준비 | `apps/desktop/tools/signing.py` |

명령 셋으로 끝난다.

```bash
pnpm build             # 뷰어 자산
pnpm shell:publish     # 설치본 폴더 (318 MB)
pnpm shell:installer   # 설치 프로그램 (81 MB)
```

## 2. 배치를 먼저 정했다 (ADR-0011)

Phase 8이 남긴 주석은 이랬다 — "설치 배치는 Phase 9에서 정한다". 코드를 짜기 전에 그 자리를 닫았다.

```text
Bim4dViewer/
  Bim4d.Desktop.exe        .NET self-contained
  web/                     apps/viewer-web/dist
  ifc-worker/ifc_worker/   워커 패키지
  python/                  임베더블 CPython 3.13.15 + ifcopenshell
```

**Python을 어떻게 넣을 것인가**가 갈림길이었다.

| 후보 | 문제 |
| --- | --- |
| 시스템 Python을 요구한다 | 사용자 PC에 3.13과 ifcopenshell이 있어야 한다. 폐쇄망에서 받아 올 수 없다 |
| PyInstaller로 exe 하나 | 빌드 도구가 늘고 native 확장의 hidden import를 손으로 잡아야 한다 |
| `.venv`를 복사한다 | 만든 경로가 스크립트에 박혀 옮기면 깨진다 |

**임베더블 CPython을 골랐다.** ADR-0009가 정한 실행 모양(`python -m ifc_worker`)이 그대로 남고 `Command`가 가리키는 곳만 달라진다. 빌드가 복사와 압축 해제뿐이라 재현된다.

`sys.path`는 `python313._pth`가 정한다. 임베더블 배포판은 이 파일이 있으면 `PYTHONPATH`도 사용자 site도 무시한다. 그 성질을 그대로 써서 **워커를 찾는 일이 작업 디렉터리에 매이지 않게** 했다.

## 3. 배치를 읽는 쪽도 창 밖으로 옮겼다

`MainWindow`의 `ViewerAssets`는 창을 띄우지 않고는 돌릴 수 없었다. xunit 43개 중 이것을 덮는 것이 하나도 없었고, Phase 8이 세운 "판단은 Core에" 규칙에서 이것만 빠져 있었다.

`Bim4d.Desktop.Core`의 `InstallLayout`으로 옮기고 세 경우를 시험으로 덮었다 — 설치본, 개발(저장소), 어느 쪽도 아님.

**옛 코드는 설치본이 깨졌을 때 조용히 빈 화면을 띄웠다.** `web/`도 없고 저장소도 아니면 존재하지 않는 경로를 그대로 돌려주었고, WebView2가 그것을 열고, 기록에는 아무것도 남지 않았다. 이제 무엇을 어디서 찾았는지 코드(`shell.layout.unknown`)와 함께 말한다.

`ShellSettings.PythonCommand`의 기본값도 `"python"`에서 빈 문자열로 바꿨다. PATH에 기대던 탓에 **동봉한 런타임을 아무도 보지 않고 있었다.**

## 4. 만든 것을 실제로 띄워 본다

게시가 끝나면 셸을 띄워 `--self-check`를 돌린다. 워커까지 왕복하는지 보고, 통과하지 못하면 게시가 실패한다.

**배치를 만드는 쪽과 읽는 쪽이 같은 이름을 쓰는지는 그렇게만 증명된다.** 양쪽 다 자기 몫을 정확히 해도 이름이 어긋나면 아무 일도 일어나지 않는다.

```text
만들었다: ...\apps\desktop\artifacts\publish  (318 MB)
띄워 봤다: 자체 점검을 통과했다 · layout Installed · python ...\publish\python\python.exe
```

이 길을 안전하게 만들려고 `StartupOptions.Automated`를 더했다. `--self-check`나 `--exit-after`로 띄운 창은 실패해도 대화상자를 내지 않는다. 자동으로 띄운 창의 대화상자는 아무도 누르지 않아 그대로 멈추고, CI에서는 그것이 몇 시간짜리 멈춤이 된다.

## 5. 포장은 Inno Setup EXE로 (ADR-0012)

MSI로 가지 않은 이유는 셋이다.

- **WebView2 선행 조건 때문에 MSI 하나로 끝나지 않는다.** MSI는 조건부로 다른 설치 프로그램을 부르지 못한다. WiX로 가면 Burn 번들 `.exe`가 MSI를 감싸는 모양이 되고, 만들 것과 서명할 것이 둘이 된다
- **파일 2,000개의 컴포넌트 GUID를 관리해야 한다.** 대가로 얻는 복구·패치를 지금 아무도 요구하지 않는다
- **서명할 파일이 하나다**

GPO·SCCM 요구가 오면 같은 폴더를 WiX로 다시 싸면 된다. 배치가 ADR-0011로 고정돼 있어 포장만 갈아 끼우는 일이다.

## 6. 실제로 깔았다 지웠다

`/VERYSILENT /CURRENTUSER`로 이 PC에서 전부 돌렸다.

| 단계 | 결과 |
| --- | --- |
| 설치 | `%LOCALAPPDATA%\Programs\BIM 4D Viewer`, 334 MB. 시작 메뉴와 프로그램 목록에 `0.1.0` |
| 실행 | `--self-check` 통과 — 동봉한 `python.exe`로 워커 왕복 |
| IFC 열기 | `모델을 열었다: three-elements-ifc4.ifc` |
| 덮어쓰기 설치 | 제자리에서. 등록 항목 1개, 설치 폴더 1개 |
| 제거 | 설치 폴더·시작 메뉴 사라짐, 등록 항목 0 |
| 제거 뒤 | `%APPDATA%\Bim4dViewer`와 최근 목록 남음 — 계약대로 |

## 7. 정한 규칙과 이유

- **배치는 `web/` 하나로 고른다.** 세 폴더를 따로 보면 반쯤 설치된 상태에서 배치가 섞이고, 어떤 조합으로 돌고 있는지 알 수 없다
- **배치를 골랐지만 빠진 자리가 있으면 뜨되 기록에 남긴다.** 뜨지 않으면 사용자가 고칠 길이 없다
- **제거해도 사용자 데이터는 남긴다.** 다시 깔면 최근 목록이 살아 있고, 로그는 왜 그랬는지 물을 때 필요한 물건이다. 조용히 지우는 것은 되돌릴 수 없다
- **`.ifc` 파일 연결은 하지 않는다.** 여러 프로그램이 함께 쓰는 확장자를 설치가 조용히 가져가지 않는다
- **우리가 만든 것만 서명한다.** .NET 런타임과 CPython과 ifcopenshell과 WebView2는 각자 만든 곳이 이미 서명했다. 덧씌우면 원래 서명을 지우고 출처를 흐린다
- **서명은 싸기 전에 한다.** 싸고 나면 안을 못 고친다

## 8. 넣지 않은 것

**MSI.** 위의 이유. 요구가 오면 같은 폴더를 다시 싼다.

**소스 맵을 뺄지 말지.** `web/` 33 MB 중 20 MB가 소스 맵이다. `dist`를 그대로 복사하므로 함께 들어간다. 데스크톱 앱에서 소스 맵은 devtools를 열 때만 쓸모가 있지만, 빼면 오류 보고가 읽기 어려워진다. ADR-0011의 후속 목록에 두었다.

**이행 의존 고정.** `requirements.txt`는 `ifcopenshell`만 고정한다. numpy·shapely는 그때 최신이 들어오므로 같은 커밋에서 만든 설치본이 항상 같지는 않다.

**폐쇄망용 Fixed Version WebView2 산출물.** ADR-0011이 별도로 두기로 했고 아직 만들지 않았다.

**실제 서명.** 이 PC에 Windows SDK도 인증서도 없다. 대상 선택과 명령 만들기와 순서까지가 증명된 것이다.

## 9. 검증 결과

| 게이트 | 결과 |
| --- | --- |
| `pnpm verify` | 통과 |
| vitest | 641개 통과 |
| `pnpm shell:test` (xunit) | 64개 통과 (43 → +21) |
| `pnpm test:python` | 90개 통과 (워커 69 + 도구 21) |
| `pnpm shell:publish` | 318 MB, 자체 점검 통과 |
| `pnpm shell:installer` | 81 MB |
| 실제 설치·제거 | 위 6절 |

CI의 desktop job이 설치본을 만들고 창을 띄워 자체 점검을 통과시킨 뒤 설치 프로그램까지 만든다 (약 3분 30초). runner 이미지에 Inno Setup 6.7.1이 이미 있었다. python job은 런타임 트리를 만들어 띄워 본다.

## 10. 겪은 것

**CI가 한국어를 못 냈다.** 런타임을 다 만든 뒤 결과를 알리는 줄에서 죽었다.

```text
UnicodeEncodeError: 'charmap' codec can't encode characters in position 0-3
```

CI의 지역 코드 페이지가 cp1252였다. 워커의 `loop.main`이 같은 이유로 이미 하던 UTF-8 재설정을 이 스크립트도 하게 했다. `PYTHONIOENCODING=cp1252`로 로컬에서 그 상황을 만들어 확인했다. **개발 PC가 cp949라 한글이 우연히 통과하고 있었다.**

**제거했는데 폴더가 남았다.** 안에 파일 22개 — WebView2가 실행 중에 만든 `{app}\Bim4d.Desktop.exe.WebView2\EBWebView` 캐시였다. 설치 프로그램이 담은 것이 아니라 Inno가 지울 줄 모르는 자리다. `[UninstallDelete]`로 함께 지우게 했다.

**둘 다 만들어 보고 실제로 돌려야 나오는 종류였다.** 컴파일도, 단위 시험도, 자체 점검도 전부 통과한 상태였다.

**호스트 Python과 동봉 Python이 다르다.** 이 PC의 호스트는 3.14인데 3.13 wheel을 깔아야 한다. `--python-version 3.13 --platform win_amd64 --only-binary=:all:`로 짝을 직접 적었고, 그 덕에 CI(3.13)와 개발 PC(3.14)가 같은 결과를 낸다.

**`pnpm verify`에 `format:check`가 없다.** CI에는 있다. `package.json`을 손으로 고쳤다가 CI에서 prettier로 걸렸다.

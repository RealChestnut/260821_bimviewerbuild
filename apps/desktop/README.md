# desktop

C# WPF Desktop Shell. WebView2 호스팅, 창·메뉴·파일 대화상자, Python Worker 프로세스 관리, 설치와 업데이트를 담당한다.

마스터 계획 Phase 8에서 구현한다. 지금은 자리만 잡아 둔 상태다.

## 개발 환경 (.vsconfig)

이 디렉터리의 `.vsconfig`는 Desktop Shell 개발에 필요한 Visual Studio 2026 구성이다.
Visual Studio 설치 관리자에서 "구성 가져오기"로 불러온다.

기준: Visual Studio 2026 (Dev18), MSVC 툴셋 v145.

| 항목                                         | 마스터 계획 근거                          |
| -------------------------------------------- | ----------------------------------------- |
| `Workload.ManagedDesktop`                    | Phase 8 WPF Shell, 3.2절 Desktop Host     |
| `NetCore.Component.SDK`                      | .NET 빌드와 Phase 9 self-contained 배포   |
| `Component.NuGet`                            | WebView2 SDK 등 패키지 참조               |
| `Component.Git`                              | 13절 개발 도구                            |
| `Workload.NativeDesktop`, `VC.Tools.x86.x64` | 14절 x64 고정, 네이티브 모듈 빌드         |
| `VC.Redist.14.Latest`                        | Phase 9 설치 패키지의 재배포 가능 런타임  |
| `VC.CMake.Project`, `Vcpkg`                  | IfcOpenShell/OpenCascade 계열 소스 빌드   |
| `Windows11SDK.26100`                         | Phase 9 코드 서명(signtool)과 Windows API |

### 포함하지 않은 것

- Node.js / Python 워크로드: 13절이 TypeScript와 Python 작업을 Visual Studio Code에 배정한다.
  Node는 루트 `package.json`의 engines(>=22), Python은 별도 가상환경으로 버전을 고정한다.
- WebView2 SDK: Visual Studio 설치 옵션이 아니다. NuGet `Microsoft.Web.WebView2`로 참조한다.
- 설치 패키지 생성 도구: Visual Studio 2026에 기본 포함되지 않는다.
  Phase 9에서 WiX 또는 동등 도구를 선택해 별도로 도입한다.

### 미결정 사항

.NET 타깃 프레임워크 버전은 아직 정해지지 않았다. 13절의 "정확한 버전은 확인 후 고정한다"는
원칙에 따라 `.vsconfig`에는 버전 고정 런타임 컴포넌트를 넣지 않았다.
Phase 8 착수 전에 TFM을 정하고 해당 런타임 컴포넌트를 이 파일에 추가한다.

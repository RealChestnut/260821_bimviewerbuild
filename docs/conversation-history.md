# BIM 4D Viewer 프로젝트 대화 기록

- 내보낸 날짜: 2026-08-21
- 범위: 이 작업에서 사용자와 Assistant가 주고받은 실제 대화
- 제외: 시스템/개발자 지침, 내부 추론, 도구 호출 원문
- 저장소: `https://github.com/RealChestnut/260821_bimviewerbuild.git`

---

## 1. 개발 과정 관련 파일 탐색 요청

### 사용자

지금까지 우리 개발 프로세스와 개발 과정이 담긴 파일을 모두 찾아줘

> 이 요청 직후 구체적인 BIM 4D 기술 평가 요청으로 대화 주제가 전환되었습니다.

---

## 2. Bonsai + IfcOpenShell + Ifc4D + That Open Components 평가

### 사용자

**Bonsai + IfcOpenShell + Ifc4D + That Open Components** 이 조합으로 4D BIM simulation를 구현하려고 해. 1차적으로 평가 부탁해.

### Assistant

1차 결론은 **웹 기반 OpenBIM 4D 시뮬레이션을 만들기에 적합한 조합이지만, 네 제품 사이의 역할과 데이터 소유권을 분명하게 나눠야 한다**는 것입니다.

종합 평가는 약 **8/10**입니다. 기술적으로 충분히 구현 가능하고 벤더 종속성도 낮습니다. 다만 네 도구를 단순히 연결한다고 4D 제품이 완성되는 것은 아니며, **일정–객체 매핑 계층과 시뮬레이션 상태 엔진은 직접 개발해야 합니다.**

권장 역할은 다음과 같습니다.

- Bonsai: IFC 모델과 공정계획을 사람이 작성·검토하는 도구
- IfcOpenShell + Ifc4D: IFC 및 일정 데이터를 검증·변환·계산하는 백엔드
- That Open Components: 브라우저 기반 3D Viewer와 시각화 계층
- 자체 개발 영역: 일정–객체 연결, 4D 상태 계산, 타임라인 UI, 프로젝트 저장

Bonsai는 `IfcWorkSchedule`, `IfcTask`, 작업 기간, 선후행 관계와 객체 연결을 IFC에 기록하고 시각적으로 검토하는 데 적합합니다. 하지만 공식 일정 문서가 아직 발전 중이므로 상용 제품의 핵심 실행 엔진을 Bonsai UI 자동화에 의존하는 것은 위험합니다.

IfcOpenShell의 Sequence API는 Work Schedule, Task, Calendar, Sequence, Lag 등을 처리할 수 있습니다. 생성 작업은 `IfcRelAssignsToProduct`, 철거나 유지관리의 입력 객체는 `IfcRelAssignsToProcess`로 구분해야 합니다.

Ifc4D는 독립적인 완제품 시뮬레이터라기보다 IfcOpenShell 생태계 안의 일정 변환·처리 모듈에 가깝습니다. 백엔드 도메인 계층으로는 적합하지만 웹 플레이어까지 제공하는 것은 아닙니다.

That Open Components는 `@thatopen/components`, `@thatopen/components-front`, `@thatopen/fragments` 조합으로 이해하는 것이 정확합니다. 웹 IFC Viewer, 객체 선택·숨김·강조·분류·단면·측정·속성 표시와 대형 모델의 Fragments 표시에 적합합니다. 4D 타임라인 자체보다는 4D 계산 결과를 화면에 표현하는 렌더링 계층으로 사용하는 것이 좋습니다.

가장 중요한 설계 원칙은 다음과 같습니다.

1. IFC를 기준 데이터로 사용하고 객체 연결은 STEP ID가 아니라 `IfcRoot.GlobalId`를 사용한다.
2. 브라우저에서 매 프레임 IFC 전체를 해석하지 않는다.
3. IfcOpenShell은 일정·관계·캘린더 계산을 담당하고 web-ifc/That Open은 형상·속성 표시를 담당한다.
4. 양쪽의 연결은 `GlobalId`로 수행한다.

초기 MVP는 다음으로 제한하는 것이 좋습니다.

1. IFC4 모델 하나 로딩
2. `IfcWorkSchedule` 하나 선택
3. `IfcTask` 시작·종료일 읽기
4. 생성 작업과 객체 연결
5. 날짜 슬라이더 및 재생/정지
6. 예정 전·작업 중·완료 색상 표시
7. 객체 선택 시 연결 작업 표시
8. 매핑 누락과 잘못된 날짜 검증

최종적으로 Bonsai를 4D 작성·검토 도구, IfcOpenShell/Ifc4D를 일정 처리 백엔드, That Open Components를 웹 시각화 엔진으로 두는 구조가 적합합니다.

---

## 3. C#과 Visual Studio로 실행파일 배포 검토

### 사용자

아예 실행파일을 만들어서 배포하고 싶은데 Visual Studio C#이 적당할까?

### Assistant

Windows용 독립 실행 프로그램으로 배포한다면 **Visual Studio + C#은 적당합니다.** 다만 C#으로 모든 기능을 다시 만드는 방식보다는 **C#을 데스크톱 앱의 Shell과 통합 계층으로 사용하는 구조**가 좋습니다.

Windows 전용 기준 적합도는 약 **8.5/10**입니다.

추천 구조:

```text
C# WPF Desktop App
 ├─ WebView2
 │   └─ React/TypeScript + That Open Components
 ├─ Python Backend Process
 │   └─ IfcOpenShell + Ifc4D
 └─ Files, Settings, Updates, Project Management
```

C# WPF는 프로그램 창, 메뉴, 파일 열기, 프로젝트 관리, Python 프로세스 실행·종료, 오류 로그, 설치·업데이트, WebView2와 Python 사이 통신을 담당합니다.

첫 버전은 WinUI 3보다 WPF가 적합합니다. WPF는 성숙하고 WebView2 통합 사례가 많으며 BIM 업무용 데스크톱 애플리케이션에 충분합니다.

That Open Components는 브라우저 환경에 맞으므로 C# 3D 엔진으로 옮기지 않고 WPF 내부 WebView2에서 실행하는 것이 좋습니다.

Python + IfcOpenShell/Ifc4D는 별도 백그라운드 프로세스로 포함합니다. 담당 기능은 IFC 읽기·쓰기, 일정 처리, 객체–작업 연결 검증, 외부 일정 변환, 시뮬레이션 JSON 생성입니다.

초기 버전에서는 C#에서 IfcOpenShell C++를 직접 바인딩하는 방식을 권장하지 않습니다. C++ ABI, OpenCascade DLL, marshaling, 아키텍처별 빌드와 버전 업데이트 부담이 크기 때문입니다. Python 프로세스로 격리하고 HTTP/WebSocket, Named Pipe 또는 JSON-RPC로 통신하는 편이 안전합니다.

배포는 모든 파일을 억지로 하나의 EXE에 넣기보다 다음처럼 구성하는 것이 안정적입니다.

```text
Bim4D-Setup.exe
  └─ C:\Program Files\Bim4D\
      ├─ Bim4D.exe
      ├─ Python Runtime
      ├─ IfcOpenShell
      ├─ Web Assets
      └─ WebView2 관련 파일
```

사용자에게는 설치 파일 하나를 제공하지만 내부에는 여러 런타임 파일이 존재하는 방식입니다.

Bonsai는 메인 프로그램에 직접 임베딩하지 않고 외부 작성·검토 도구로 취급합니다. 필요하면 나중에 “Bonsai에서 열기” 기능을 제공할 수 있습니다.

추천 기술 스택:

```text
IDE             Visual Studio
Desktop         C# / .NET / WPF / MVVM
Web container   Microsoft WebView2
Viewer          TypeScript + Vite + That Open Components
4D UI           React
IFC backend     Embedded Python + IfcOpenShell + Ifc4D
IPC             localhost HTTP + WebSocket, 이후 Named Pipe 검토
Database        SQLite
Installer       MSI 또는 Setup EXE
Architecture    Windows x64 우선
```

핵심은 C#으로 4D Viewer까지 다시 만들지 않고, C#은 Desktop 통합, That Open은 WebView2, IfcOpenShell/Ifc4D는 Python Worker에 배치하는 것입니다.

---

## 4. Pub/Sub, ROS 유사 구조와 TDD·AI 위임 방식

### 사용자

내가 생각하는 개발 과정은 이러해. 화면 구성하는 Viewer 파트 + Scheduler 파트 + IFC read를 위한 파일 매칭 시스템. 그런데 가장 먼저 생각하고 있는 것은 Viewer를 먼저 구성하는 거야.

개발 방식은 기능별로 구현하고, 마치 C#으로 개발하는 방식처럼 기능 하나가 붙으면 그와 관련된 코드가 붙는 구조로 만들고 싶어. Publish/Subscribe 통신 구조처럼, ROS 구조처럼 간단하지만 강력한 로우레벨 개발자 친화적인 개발 방식으로 가고 싶어.

그와 동시에 TDD 방식을 적용해서 기능 단위로 AI에게 개발을 위임하고, 기능이 붙는 것을 확인하면서 가고 싶어.

### Assistant

이 방향에는 **Typed Event-Driven Modular Monolith + TDD + 기능 단위 Vertical Slice** 구조가 잘 맞습니다.

다만 모든 통신을 Pub/Sub로 만들지 말고 다음을 구분해야 합니다.

- Command: 특정 기능 하나에 작업 요청
- Event: 이미 발생한 사실을 여러 기능에 통지
- Query: 데이터 조회
- State/Repository: IFC 형상·속성·일정 데이터 보관

전체 구조는 Application Kernel을 중심으로 Viewer, Scheduler, IFC–Schedule Matching, Project 모듈을 연결하고, IfcOpenShell Worker는 외부 Adapter로 배치합니다.

모든 기능은 동일한 Component 생명주기를 구현합니다.

```ts
export interface AppComponent {
  readonly id: string;
  initialize(context: AppContext): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  dispose(): Promise<void>;
}
```

Viewer 내부 기능도 `WorldComponent`, `ModelLoaderComponent`, `SelectionComponent`, `VisibilityComponent`, `ClippingComponent`, `PropertyComponent`, `CameraComponent`, `ViewerStateComponent`처럼 독립된 컴포넌트로 구성합니다.

통신은 문자열 기반의 느슨한 이벤트가 아니라 TypeScript가 검증하는 Typed Event Bus를 사용합니다.

```ts
export interface AppEventMap {
  "model.load.requested": {
    modelId: string;
    source: ModelSource;
  };
  "model.loaded": {
    modelId: string;
    productCount: number;
  };
  "selection.changed": {
    modelId: string;
    globalIds: string[];
  };
  "schedule.time.changed": {
    currentTime: string;
  };
}
```

Event Bus에는 전체 IFC 파일, Three.js Mesh, Fragments 바이너리처럼 큰 데이터를 직접 보내면 안 됩니다. 작은 DTO와 ID만 전달하고 실제 데이터는 Repository가 소유합니다.

권장 디렉터리는 기능별 구조입니다.

```text
src/
 ├─ kernel/
 │   ├─ components/
 │   ├─ events/
 │   ├─ commands/
 │   └─ errors/
 ├─ features/
 │   ├─ model-loading/
 │   ├─ selection/
 │   ├─ visibility/
 │   ├─ clipping/
 │   ├─ properties/
 │   ├─ scheduling/
 │   ├─ simulation/
 │   └─ matching/
 ├─ infrastructure/
 │   ├─ thatopen/
 │   ├─ webview/
 │   ├─ storage/
 │   └─ ifcopenshell/
 └─ app/
```

Viewer 전체를 한 번에 완성하지 않고 첫 Vertical Slice를 다음으로 정합니다.

> IFC 열기 → 화면 표시 → 객체 선택 → GlobalId 출력

이 기능으로 That Open 초기화, WASM/Worker, IFC 로딩, 렌더링, picking, GlobalId 매핑, Event Bus, 오류 처리와 해제를 검증합니다.

테스트는 세 층 이상으로 나눕니다.

- 단위 테스트: Event Bus, 생명주기, 선택 상태, 시뮬레이션 상태 계산, 매칭
- 계약 테스트: Viewer–Repository, Web–IfcOpenShell, WebView2–C# 계약
- 브라우저 통합/E2E: IFC 열기, 선택, 패널 표시, 모델 제거, 오류와 메모리 해제

AI에는 “Selection 기능 만들어줘”가 아니라 작업 패킷을 전달합니다.

```text
Feature:
목적:
입력:
출력:
변경 허용 경로:
변경 금지 경로:
선행 테스트:
수용 조건:
검증 명령:
```

AI 개발의 필수 게이트는 다음과 같습니다.

```text
Unit Test
  → Contract Test
  → Browser Integration Test
  → Build / Type Check / Lint
  → 수동 기능 확인
  → Merge
```

Viewer는 우선 브라우저에서 독립 개발하고 기능이 안정화된 다음 WPF + WebView2 Shell을 연결하는 것이 좋습니다.

---

## 5. IFC 편집기와 독립된 Viewer·4D 선행 개발

### 사용자

여기서 IFC 편집기나 모델링 하는 것은 어떤 제품이 들어올지 몰라. 그러나 내가 하고 싶은 Viewer랑 4D 공정 삽입 관련해서는 미리 구현해볼 수 있는 거니까.

### Assistant

그렇다면 Bonsai나 특정 IFC 편집기를 제품의 필수 구성요소에서 제외해야 합니다.

핵심 제품은 다음 세 부분입니다.

```text
임의의 IFC 작성 도구
        ↓ IFC
[Viewer] + [4D Scheduler] + [객체–공정 연결]
```

Bonsai, Revit, Archicad, Tekla는 외부 입력 도구일 뿐입니다. 지금은 샘플 IFC와 가상 일정 데이터로 Viewer와 4D 기능을 충분히 선행 구현할 수 있습니다.

중요한 결정은 원본 IFC를 바로 수정하지 않는 것입니다. 공정 연결 결과를 프로젝트 내부에 별도로 보관합니다.

```json
{
  "modelId": "architecture-v1",
  "modelFingerprint": "sha256:...",
  "links": [
    {
      "taskId": "TASK-A1010",
      "productGlobalIds": ["3uY$7v...", "1Ad90P..."],
      "operation": "CONSTRUCT"
    }
  ]
}
```

이 방식은 원본 IFC를 보호하고, 일정 수정과 여러 기준 일정 저장, 모델 교체 비교, 이후 선택적인 IFC 4D 내보내기를 가능하게 합니다.

Viewer는 다음을 먼저 개발할 수 있습니다.

- IFC 열기와 표시
- 객체 선택과 `GlobalId` 추출
- 속성 조회
- 숨김·표시·격리·분류·단면
- 복수 모델 로딩
- 객체별 색상 변경
- 대형 모델 성능 관리

Scheduler도 IFC 일정 없이 독립적으로 개발할 수 있습니다.

```ts
interface Task {
  id: string;
  parentId?: string;
  name: string;
  start: string;
  finish: string;
  progress: number;
  operation: "CONSTRUCT" | "DEMOLISH" | "TEMPORARY" | "MAINTAIN";
}
```

객체–공정 연결은 Viewer에서 선택한 객체의 GlobalId 목록을 현재 Task에 할당하는 방식으로 시작합니다.

4D 시뮬레이션은 실제 Scheduler가 없어도 가상 일정으로 개발할 수 있습니다. 초기 상태는 미착수, 진행 중, 완료, 철거 예정, 철거 중, 철거 완료 등으로 정의합니다.

Model 입력은 `ModelProvider`, 일정 입력은 `ScheduleProvider`로 추상화합니다. 현재 구현은 That Open과 내부 Scheduler지만 나중에 Cloud, IFC Schedule, Primavera, Microsoft Project, CSV Adapter를 추가할 수 있습니다.

Viewer-first 개발 순서는 다음과 같습니다.

1. Viewer Kernel
2. IFC 로딩·선택·GlobalId Vertical Slice
3. Viewer 조작 기능
4. 가상 4D JSON과 시간 슬라이더
5. Scheduler UI
6. 파일·객체 매칭

첫 제품 목표는 다음입니다.

> 사용자가 임의의 IFC 파일을 열고 객체를 선택해 가상의 공정에 할당한 뒤, 날짜 슬라이더를 움직여 4D 시공 상태를 확인할 수 있다.

---

## 6. GitHub 저장소 연결

### 사용자

`https://github.com/RealChestnut/260821_bimviewerbuild.git` 여기에 커밋하고 푸시할 거야, 이제부터.

### Assistant

설정 완료했습니다.

- 로컬 브랜치: `main`
- 현재 상태: 아직 커밋 없음
- 원격 이름: `origin`
- 원격 저장소: `https://github.com/RealChestnut/260821_bimviewerbuild.git`

앞으로 기능 단위로 테스트와 검증을 통과한 파일만 선별해 커밋하고 이 저장소로 푸시하겠습니다.

---

## 7. 전체 개발 프로세스 최초 정리와 OMC 질문

### 사용자

자, 그럼 다시 처음부터 개발 과정, 개발 전략, 개발 툴 등 전체 프로세스와 관련된 최종 내용을 한번 정리하자.

### Assistant

전체 개발 방향을 하나의 마스터 계획으로 정리했습니다. 당시 설치되어 있던 OMC 계획 도구의 형식에 따라 `.omc/plans/bim4d-development-master-plan.md`에 승인 대기 문서가 생성되었습니다.

핵심 결정:

- 특정 IFC 모델링 도구에 종속되지 않는 Windows용 4D BIM 애플리케이션
- C# WPF + WebView2 + That Open Viewer + Python IfcOpenShell Worker
- Typed Event-Driven Modular Monolith + Ports/Adapters
- Viewer → Mock 4D → Scheduler → IFC–Task Matching → IfcOpenShell → Desktop 배포
- 원본 IFC 읽기 전용, 프로젝트 데이터 별도 저장
- `modelId + IfcRoot.GlobalId` 기반 영구 식별
- Command/Event/Query 구분
- 기능별 Vertical Slice와 TDD
- AI 변경 범위를 작업 패킷으로 제한
- 작은 기능 브랜치, Conventional Commits, CI 병합 게이트

### 사용자

지금 이렇게 plan이 나온 게 OMC 때문인가?

### Assistant

네. `.omc/plans/` 경로와 `승인 대기` 형식은 OMC의 `omc-plan` 도구가 적용됐기 때문입니다.

기술 내용은 지금까지 대화한 요구사항을 종합한 것이고, `.omc` 경로와 승인 절차만 OMC 방식입니다. 프로젝트 공식 문서로 사용하려면 `docs/DEVELOPMENT_MASTER_PLAN.md`나 `ARCHITECTURE.md`가 더 적합합니다.

### 사용자

그러면 앞으로 프로그래밍도 OMC 구조로 이어지나?

### Assistant

아닙니다. 계획이 `.omc/plans/`에 저장됐다고 해서 제품 코드가 OMC 구조에 종속되는 것은 아닙니다.

OMC는 개발 작업 운영 도구이고 제품 아키텍처와는 별개입니다. OMC를 제거해도 Viewer, Scheduler, Matching, Event Bus, C#/TypeScript/Python 코드는 그대로 빌드되고 실행돼야 합니다. 제품 코드에서 OMC 라이브러리나 `.omc` 파일을 참조해서는 안 됩니다.

기본 개발 흐름은 다음과 같습니다.

```text
기능 작업 패킷 작성
→ 테스트 먼저 작성
→ 기능 구현
→ 단위·통합·E2E 검증
→ 사용자 기능 확인
→ 커밋
→ GitHub 푸시
```

---

## 8. OMC 제거 후 공식 개발 마스터 플랜 정리

### 사용자

OMC를 제거했어. 자, 그럼 다시 처음부터 개발 과정, 개발 전략, 개발 툴 등 전체 프로세스와 관련된 최종 내용을 한번 정리하자.

### Assistant

OMC 전용 승인 절차와 `.omc` 형식을 제외하고, 프로젝트 자체의 공식 개발 기준으로 다시 정리했습니다.

공식 문서:

`docs/DEVELOPMENT_MASTER_PLAN.md`

문서에는 다음이 포함됩니다.

- 제품 비전과 1차 범위
- WPF + WebView2 + That Open + Python Worker 구조
- Viewer, Scheduler, Matching, Simulation, Project 모듈
- Command/Event/Query 규칙
- GlobalId 및 프로젝트 데이터 전략
- 저장소 디렉터리 구조
- Phase 0부터 Phase 9까지 개발 로드맵
- TDD 및 품질 게이트
- AI 작업 패킷과 Definition of Done
- Git/GitHub 커밋·브랜치·병합 기준
- 개발 도구와 주요 라이브러리
- 위험과 대응
- 첫 제품 마일스톤과 첫 구현 단위

### 사용자

내가 OMC 파일은 삭제했어.

### Assistant

확인 결과 `.omc` 폴더는 제거됐고 OMC와 무관한 공식 프로젝트 문서만 남았습니다.

- 공식 문서: `docs/DEVELOPMENT_MASTER_PLAN.md`
- Git 상태: `docs/`는 아직 커밋되지 않은 새 파일
- 현재 저장소: 아직 첫 커밋 전

최종 기술 기준:

- C# WPF: Windows 실행 프로그램과 시스템 통합
- WebView2: 웹 Viewer 호스팅
- That Open Components: IFC 3D Viewer
- Python + IfcOpenShell/Ifc4D: IFC 검증과 4D 입출력
- SQLite: 프로젝트·일정·객체 연결 저장
- Typed Event Bus와 Ports/Adapters
- Vertical Slice + TDD
- 개발 순서: 기반 → Viewer → Mock 4D → Scheduler → Matching → IfcOpenShell → WPF → 배포

---

## 9. 현재 사용자 요청

### 사용자

여기서 나눈 대화 모두 workspace로 output해.

### Assistant

이 문서는 해당 요청에 따라 생성된 대화 기록입니다.

---

## 관련 프로젝트 문서

- 개발 마스터 플랜: `docs/DEVELOPMENT_MASTER_PLAN.md`
- 대화 기록: `outputs/conversation-history.md`


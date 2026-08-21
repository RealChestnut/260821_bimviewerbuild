---
name: Feature 작업 패킷
about: AI 또는 사람이 기능 하나를 구현할 때 사용하는 작업 단위
title: 'feat(<module>): '
labels: feature
---

<!-- 마스터 계획 11.1절 작업 패킷 형식이다. 기능 하나만 담는다. -->

## Feature

## 목적

## 사용자 시나리오

## 입력

## 출력

## 발행 Command/Event

## 구독 Command/Event

## 변경 허용 경로

```text

```

## 변경 금지 경로

```text

```

## 선행 테스트

<!-- 먼저 작성해 실패를 확인할 테스트 -->

## 수용 조건

- [ ]

## 성능·메모리 조건

<!-- 정량 기준이 아직 없으면 "미정 (마스터 계획 10.3절)"이라고 적는다 -->

## 완료 검증 명령

```bash
pnpm verify
pnpm test:e2e
```

## Definition of Done (마스터 계획 11.3절)

- [ ] 수용 조건 충족
- [ ] 테스트 추가 및 통과
- [ ] build / typecheck / lint 통과
- [ ] 오류 경로와 `dispose()` 경로 구현
- [ ] 공용 계약 문서화
- [ ] 관련 없는 변경 없음
- [ ] 사용자 기능 확인 완료

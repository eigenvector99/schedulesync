# 직원 스케줄 관리 및 프로젝트 참여 승인 시스템 (v1.0 확정본) 구현 계획

> 직원들의 프로젝트 참여 일정을 공유하고, 프로젝트 간 시간 겹침을 정밀하게 탐지·차단하며, 확정 원칙에 따른 3가지 배정 승인 및 일정 변경 워크플로를 제공하는 종합 스케줄 관리 시스템 구현 계획입니다.

---

## 사용자 확인 및 확정 결정 사항 요약

> [!IMPORTANT]
> 사전 질의응답을 통해 확정된 요구사항과 설계 문서 v1.0의 비즈니스 규칙을 100% 반영하여 구축합니다.

- **확정된 페르소나 스위처**: 복잡한 다자간 승인(A부서장 등록 → 직원 수락 → A/B 부서장 전원 승인)을 즉시 테스트할 수 있도록 화면 상단에 '데모 계정 전환 바'를 제공합니다.
- **기본 캘린더 뷰**: 직원별 타임라인 뷰(행: 직원, 열: 일자/시간 블록)를 기본으로 제공하며, 주간/월간 뷰 및 대기 중(점선 표시)·허용된 겹침(아이콘 표시)을 지원합니다.
- **초기 시드 데이터**: 2개 부서(플랫폼개발팀, 프로덕트디자인팀), 부서장 2명(김부서장 A, 이부서장 B), 일반 직원 6명, 시스템 관리자 1명 및 겹침/대기 시나리오를 포함한 프로젝트 3건을 기본 제공합니다.

---

## 1. 개요 및 핵심 개념

### 1.1 시스템 목적
- **투명한 일정 공유**: 전 직원의 확정 및 대기 중 프로젝트 작업 일정을 전사 타임라인 캘린더 및 참여 현황 매트릭스로 공개합니다.
- **시간 겹침 정밀 검증**: `A.start < B.end && B.start < A.end` 알고리즘과 iCalendar RRULE 반복 일정 전개기를 통해 다중 프로젝트 간 시간 충돌을 실시간 감지합니다.
- **역할별 3단계 배정 워크플로**:
  1. **셀프 투입 (허가권자 본인)**: 승인 불필요, 충돌 시 경고 확인 후 즉시 확정 (`allowed_overlaps` 기록).
  2. **허가권자 간 배정 (A → B)**: 대상자(B) 수락만으로 즉시 확정, 별도 승인 없음.
  3. **일반 직원 배정 (A → 직원 X)**: 직원 X 수락 후 **A와 B 허가권자 전원이 각각 승인**해야 확정 (1명이라도 반려 시 즉시 반려, 충돌 시 승인 버튼 잠금).
- **확정 후 일정 변경 관리**: 변경 시 충돌 발생 유형(본인 프로젝트 간 vs 타 허가권자 프로젝트)에 따라 타 허가권자 승인 + 참여 직원 동의 동시 충족 워크플로 구현.

### 1.2 사용자 페르소나
1. **일반 직원**: 내 일정 및 참여 프로젝트 조회, 배정 요청 수락/거절, 일정 변경 동의/거절.
2. **허가권자 (부서장 A, B)**: 프로젝트 등록, 본인 등록 프로젝트 세션/배정 관리, 셀프 투입, 일반 직원 배정 전원 승인/반려, 일정 변경 승인.
3. **시스템 관리자**: 계정 발급/비활성화, 부서 및 허가권자 지정, 무결성 감사 로그(Audit Logs) 조회.

---

## 2. 사용자 경험 (UX) 및 화면 인터페이스 설계

### 2.1 상단 글로벌 컨트롤 & 내비게이션
- **Top Bar Contract**:
  - 좌측: 시스템 워드마크 `ScheduleSync Pro` 및 현재 접속자 프로필 정보.
  - 중앙: 메인 탭 내비게이션 (`전사 캘린더`, `참여 현황`, `프로젝트 관리`, `내 처리함`, `관리자`).
  - 우측: 실시간 알림 벨(미확인 알림 카운트) 및 모의 이메일 수신함 토글 버튼.
- **상단 데모 페르소나 스위처 (Quick Switcher)**:
  - `[관리자] 총괄관리자` | `[허가권자 A] 김부서장(개발)` | `[허가권자 B] 이부서장(디자인)` | `[직원] 박개발` | `[직원] 최디자인` 등 클릭 한 번으로 역할 즉시 전환.

### 2.2 핵심 화면별 구성
1. **전사 타임라인 캘린더 (Timeline View)**:
   - 좌측 Y축: 직원 목록 (부서별 그룹화 및 검색/필터).
   - 상단 X축: 날짜 및 시간 눈금 (주간/일간 시간대 단위 스케일).
   - 타임 블록: 프로젝트별 고유 컬러, 확정 상태(실선), 승인 대기 상태(점선 테두리 및 빗금 패턴), 허용된 겹침 표시 아이콘(`⚠️ 허용됨`).
   - 클릭 시 프로젝트 및 참여 상세 팝업 오픈.
2. **참여 현황 매트릭스 (Participation Matrix)**:
   - 직원(행) × 프로젝트(열) 교차 테이블.
   - 확정 참여(초록 태그), 대기 중(주황 태그), 역할 표시.
3. **프로젝트 관리 & 배정 (허가권자 전용)**:
   - 프로젝트 생성/수정 모달 (기간, 반복 세션 규칙 RFC 5545 호환, 필요 인원).
   - 직관적인 직원 배정 패널:
     - 🟢 `겹침 없음`: 배정 가능
     - 🔴 `시간 겹침`: 충돌 프로젝트명, 등록 허가권자, 겹치는 시간대 명시 (배정 시 경고 모달, 승인 단계에서 차단)
     - ⏳ `대기 중`: 타 프로젝트 승인 진행 중 알림
     - `나를 투입 (셀프 배정)` 원클릭 버튼 및 경고 확인 팝업.
4. **내 처리함 (Inbox) - 역할 맞춤 탭**:
   - **수락 대기함 (직원)**: 내가 배정받은 프로젝트 목록, 겹침 경고 확인, [수락] / [거절(사유 입력)]
   - **배정 승인 대기함 (허가권자)**: 직원이 수락 완료한 요청, A/B 승인 상태 현황(예: "김부서장 승인 완료, 이부서장 대기 중"), 겹침 발생 시 [승인] 버튼 비활성화 툴팁 및 [반려(사유 필수)] 버튼
   - **일정 변경 동의/승인함**: 제안된 일정과 기존 일정의 Diff 시각화, 상대 허가권자 승인 및 참여 직원 동의 처리
5. **관리자 콘솔 (Admin Console)**:
   - 계정 발급 (이메일, 이름, 부서, 역할), 계정 활성화/비활성화
   - 부서 등록 및 부서장(허가권자) 지정
   - 전체 감사 로그 (Actor, Action, Target, Before/After JSON, 타임스탬프) 필터 및 검색
6. **인앱 알림 & 모의 이메일 발송 뷰어**:
   - 알림 드롭다운 (읽음 처리)
   - 모의 SMTP 이메일 팝업: 배정 안내, 수락/거절 결과, 승인 요청 메일 본문 시각화

---

## 3. 핵심 비즈니스 로직 및 충돌 방지 엔진

### 3.1 시간 겹침 검증 (Overlap Detection)
```
function checkOverlap(employeeId, newSessions, excludeProjectId):
    targetExpanded = expandRecurrence(newSessions, projectDateRange)
    confirmedProjects = getConfirmedProjectsForEmployee(employeeId, excludeProjectId)
    
    conflicts = []
    for target in targetExpanded:
        for confirmed in confirmedProjects:
            if (target.start < confirmed.end && confirmed.start < target.end):
                if not isAllowedOverlap(employeeId, target, confirmed):
                    conflicts.push({ target, confirmed })
                    
    pendingCount = getPendingAssignmentsCount(employeeId, excludeProjectId)
    return { hasConflict: conflicts.length > 0, conflicts, isPending: pendingCount > 0 }
```

### 3.2 3가지 배정 상태 머신 흐름
```
┌────────────────────────────────────────────────────────────────────────┐
│ ① 셀프 투입 (허가권자 본인)                                            │
│   배정 클릭 ──▶ [충돌 확인] ──(충돌 시 경고 확인)──▶ [APPROVED] 즉시 확정  │
├────────────────────────────────────────────────────────────────────────┤
│ ② 허가권자 A ──▶ 허가권자 B 배정                                       │
│   배정 ──▶ [EMPLOYEE_PENDING] ──B 수락(충돌 없어야 함)──▶ [APPROVED]   │
├────────────────────────────────────────────────────────────────────────┤
│ ③ 허가권자 A ──▶ 일반 직원 X 배정                                      │
│   배정 ──▶ [EMPLOYEE_PENDING] ──X 수락──▶ [APPROVAL_PENDING]           │
│                                                   │                    │
│                        허가권자 전원(A & B) 각각 승인                  │
│                        (충돌 있으면 승인 버튼 잠금)                     │
│                                                   ▼                    │
│                                              [APPROVED]                │
│                                                                        │
│   * 수락 단계 거절 ──▶ [DECLINED]                                      │
│   * 승인 단계 1명이라도 반려 ──▶ [REJECTED]                            │
│   * 등록 허가권자 철회 ──▶ [WITHDRAWN]                                 │
└────────────────────────────────────────────────────────────────────────┘
```

### 3.3 일정 변경 요청 (Session Change Request) 상태 머신
- 허가권자 A가 일정 변경 시도:
  - 겹침 없음: 즉시 반영 후 참가자 전원 알림
  - 본인 프로젝트끼리 겹침: 경고 확인 후 즉시 반영 (직원 동의 불필요)
  - 타 허가권자 B의 프로젝트와 겹침: `CHANGE_PENDING` 요청 생성
    - B 승인 + 대상 직원 전원 동의 시 `CHANGE_APPROVED` (반영 및 `allowed_overlaps` 등록)
    - 1명이라도 반려/거절 시 `CHANGE_REJECTED` (기존 일정 온전 보존)

---

## 4. 기술 아키텍처 및 데이터 모델

### 4.1 시스템 아키텍처 다이어그램
```
┌────────────────────────────────────────────────────────────────────────┐
│                          React SPA Client                              │
│  ┌───────────────────┬───────────────────┬──────────────────────────┐  │
│  │ Persona Switcher  │ Top Navigation    │ In-App & Email Notifier  │  │
│  ├───────────────────┴───────────────────┴──────────────────────────┤  │
│  │ View Router (Calendar, Matrix, Projects, Inbox, Admin)           │  │
│  ├──────────────────────────────────────────────────────────────────┤  │
│  │ Overlap Detection Engine (RFC 5545 Session Expander)             │  │
│  ├──────────────────────────────────────────────────────────────────┤  │
│  │ State Store & Workflow State Machine (Local & Session Persistence│  │
│  └──────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

### 4.2 데이터 스키마 정의
- `departments`: `id, name, headEmployeeId`
- `employees`: `id, email, name, departmentId, role ('EMPLOYEE'|'APPROVER'|'ADMIN'), status ('ACTIVE'|'INVITED'|'DISABLED'), timezone`
- `projects`: `id, name, description, createdBy, startDate, endDate, status, headcount, color`
- `project_sessions`: `id, projectId, title, startAt, endAt, rrule, dayOfWeek, startTime, endTime`
- `assignments`: `id, projectId, employeeId, assignedBy, type ('SELF'|'APPROVER'|'EMPLOYEE'), status ('EMPLOYEE_PENDING'|'APPROVAL_PENDING'|'APPROVED'|'DECLINED'|'REJECTED'|'WITHDRAWN'|'RELEASED'), declineReason, createdAt`
- `approval_decisions`: `id, assignmentId, approverId, decision ('PENDING'|'APPROVED'|'REJECTED'), comment, decidedAt`
- `session_change_requests`: `id, projectId, requestedBy, proposedSessions, conflicts, status ('CHANGE_PENDING'|'CHANGE_APPROVED'|'CHANGE_REJECTED'), createdAt`
- `change_decisions`: `id, changeRequestId, actorId, kind ('APPROVAL'|'CONSENT'|'BOTH'), decision ('PENDING'|'APPROVED'|'REJECTED'), comment, decidedAt`
- `allowed_overlaps`: `id, employeeId, sessionAId, sessionBId, source, createdAt`
- `notifications`: `id, recipientId, type, title, message, read, createdAt`
- `mock_emails`: `id, to, toName, subject, body, sentAt`
- `audit_logs`: `id, actorId, actorName, action, targetType, targetId, details, createdAt`

---

## 5. 실행 및 검증 계획

1. **상태 관리 및 엔진 구축**:
   - iCalendar RRULE 기반 요일/시간대 반복 일정 전개 함수 및 겹침 검출기 작성.
   - 3가지 배정 흐름 및 다자간 승인 룰 검증 함수 구현.
2. **사전 시드 데이터 탑재**:
   - 부서 2개 (플랫폼개발팀, 프로덕트디자인팀), 부서장 A(김팀장), B(이팀장), 일반 직원 6명, 관리자 1명.
   - 샘플 프로젝트 3개 (확정 세션, 겹침 발생 예정 세션, 진행 중 배정).
3. **UI 컴포넌트 구현**:
   - 상단 페르소나 전환기 및 네비게이션.
   - 전사 직원별 타임라인 캘린더 (배정 확정 실선, 대기 점선, 충돌 시각화).
   - 프로젝트 관리 & 실시간 겹침 확인 배정 모달.
   - 내 처리함 (직원 수락 탭, 허가권자 전원 승인 탭, 일정 변경 검토 탭).
   - 관리자 계정/부서 관리 및 감사 로그 뷰어.
   - 인앱 알림 & 모의 이메일 센터.
4. **빌드 및 시나리오 검증**:
   - `compile_applet`을 통한 TypeScript 타입 안정성 및 번들 컴파일 검증.
   - 시나리오 1: A가 일반 직원 배정 → 직원 수락 → A 승인 후 대기 → B 승인 시 최종 확정.
   - 시나리오 2: 겹치는 프로젝트가 있을 때 일반 직원 승인 버튼 잠금 확인.
   - 시나리오 3: 허가권자 본인 셀프 투입 시 겹침 경고 확인 후 확정 (`allowed_overlaps` 등록).
   - 시나리오 4: 일정 변경 시 타 허가권자 승인 + 직원 동의 동시 처리 검증.

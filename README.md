# ScheduleSync Pro

직원의 프로젝트 참여 일정을 공유하고, 시간 겹침을 검증하며, 허가권자 승인으로 참여를 확정하는 스케줄 관리 시스템.

- **스택**: Express(`server.ts`) + React/Vite(`src/`), 저장소는 파일 기반 JSON(`DATA_DIR/database.json`)
- **역할**: 일반 직원 / 허가권자(부서장) / 시스템 관리자

## 빠른 시작

```bash
npm install
cp .env.example .env      # ADMIN_EMAIL, ADMIN_PASSWORD 를 채운다
npm run dev               # http://localhost:3000
```

데모 계정은 **없습니다**. 데이터베이스가 비어 있는 첫 실행에서만 `ADMIN_EMAIL` / `ADMIN_PASSWORD`
(10자 이상, 영문+숫자)로 관리자 1명이 만들어지고, 이후에는 이 환경변수를 지워도 됩니다.
관리자는 로그인 후 **부서 등록 → 직원 초대 → 부서장 지정** 순서로 조직을 구성합니다.

## 환경변수

| 이름 | 필수 | 설명 |
|---|---|---|
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | 첫 실행 | 최초 관리자 계정 (`ADMIN_NAME` 선택) |
| `APP_URL` | 운영 | 초대/재설정 메일의 링크 기준 주소 |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | 운영 | 메일 발송. **미설정 시 초대·비밀번호 재설정 메일이 나가지 않는다** (개발 모드에서는 서버 콘솔에 출력) |
| `DATA_DIR` | 선택 | `database.json` 위치 (기본 `./data`). git 밖에 두고 백업할 것 |
| `PORT` | 선택 | 기본 3000 |
| `TRUST_PROXY` | 선택 | 리버스 프록시 뒤에서 `true` (로그인 시도 제한이 실제 클라이언트 IP 기준이 되도록) |

## 운영 실행

```bash
npm run build
npm start        # NODE_ENV=production
```

HTTPS 종단(리버스 프록시/로드밸런서)은 별도로 구성해야 합니다.

## 계정 흐름

- 관리자가 직원을 등록하면 **초대 메일**(72시간, 1회용 링크)이 발송되고, 직원이 비밀번호를 직접 설정하면 활성화됩니다.
- 비밀번호 재설정 링크는 30분, 1회용입니다. 존재하지 않는 이메일에도 동일하게 응답합니다.
- 비밀번호 변경/재설정/계정 비활성화 시 기존 세션은 모두 종료됩니다.

## 기존 데이터에서 이전할 때

이전 버전의 `database.json`은 그대로 읽힙니다. 다만 다음에 유의하세요.

- 세션 토큰 저장 방식이 바뀌어 **모든 사용자가 다시 로그인**해야 합니다.
- 기존 해시(1,000회 PBKDF2)는 각자 다음 로그인 때 자동으로 강화됩니다.
- 이전 버전의 데모 시드 계정(`*.company.internal`)이 남아 있다면 **운영 전에 반드시 비활성화/삭제**하세요.
- 파일이 손상되면 서버는 초기화하지 않고 `database.json.corrupt-*` 사본을 남긴 뒤 종료합니다.

## 개발

```bash
npm run lint     # tsc --noEmit
npm test         # 실제 서버를 임시 데이터 디렉터리로 띄워 API 시나리오 검증 (tests/api.test.ts)
npm run build
```

## 알려진 한계 (로드맵)

- JSON 파일 저장소: 단일 프로세스 전용, 동시성/백업 한계 → RDB 전환 예정
- 일정 전개 로직이 서버 로컬 타임존을 사용 → `Asia/Seoul` 기준 통일 예정
- "허가권자 전원 승인"의 범위(현재: 활성 허가권자 전체)는 제품 정책 확정 필요
- SSO, 알림 큐/리마인더, 공휴일 처리 미구현

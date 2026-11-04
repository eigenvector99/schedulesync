# ScheduleSync Pro

직원의 프로젝트 참여 일정을 공유하고, 시간 겹침을 검증하며, 허가권자 승인으로 참여를 확정하는 스케줄 관리 시스템.

- **스택**: Express(`server.ts`) + React/Vite(`src/`), 저장소는 PostgreSQL (`DATABASE_URL`, 없으면 내장 PostgreSQL)
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
| `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_TEAM_ID` | 선택(권장) | Slack 로그인(SSO). 설정하면 일반 직원은 Slack으로만 로그인합니다. 아래 "Slack 로그인" 참고 |
| `SLACK_BOT_TOKEN` | 운영(권장) | Slack DM 발송용 Bot 토큰(`xoxb-…`). 아래 "Slack 알림" 참고 |
| `SLACK_NOTIFY_EVENTS` | 선택 | `false`면 업무 알림은 보내지 않고 초대/재설정 링크만 DM으로 발송 |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | 선택 | Slack 미설정/실패 시 대체 발송 수단 |
| `DATABASE_URL` | 운영(권장) | PostgreSQL 접속 문자열. 없으면 `DATA_DIR/pgdata`의 내장 PostgreSQL 사용 |
| `DATABASE_SSL`, `DATABASE_POOL_MAX` | 선택 | 관리형 DB의 TLS 요구, 커넥션 풀 크기(기본 10) |
| `DATA_DIR` | 선택 | 내장 DB 위치 (기본 `./data`). git 밖에 두고 백업할 것 |
| `PORT` | 선택 | 기본 3000 |
| `TRUST_PROXY` | 선택 | 리버스 프록시 뒤에서 `true` (로그인 시도 제한이 실제 클라이언트 IP 기준이 되도록) |

## 운영 실행

```bash
npm run build
npm start        # NODE_ENV=production, 시작 시 DB 마이그레이션을 자동 적용
```

HTTPS 종단(리버스 프록시/로드밸런서)은 별도로 구성해야 합니다. 헬스체크는 `GET /api/health` (DB 연결까지 확인)입니다.

> **GitHub Pages만으로는 배포할 수 없습니다.** Pages는 정적 파일만 서빙하므로 API 서버(`server.ts`)를 실행할 수 없습니다. 화면과 API를 한 서버에서 함께 서빙하는 PaaS(Render, Railway, Fly.io 등)를 권장합니다.

### 데이터베이스

| 방식 | 설정 | 특징 |
|---|---|---|
| **관리형 PostgreSQL (권장)** | `DATABASE_URL` | 백업/복구를 제공자가 관리, 디스크 불필요, 여러 인스턴스 가능 |
| 내장 PostgreSQL | `DATABASE_URL` 없음 | 설정 불필요. **재시작 후에도 유지되는 디스크와 인스턴스 1개**가 필요하고 백업은 직접 해야 함 (`DATA_DIR/pgdata` 통째로 복사) |

- 스키마는 `server/migrations/*.sql`에 있고 서버 시작 시 순서대로 적용됩니다(`schema_migrations` 테이블로 이력 관리).
- 정합성은 DB가 직접 보장합니다: 한 직원이 한 프로젝트에 가질 수 있는 진행 중 배정은 1건(부분 유니크 인덱스), 승인 결정 중복 불가, 감사 로그는 수정·삭제 불가(트리거), 잘못된 상태값/날짜 거부(CHECK).
- 같은 직원의 일정에 영향을 주는 요청(배정 수락, 승인, 일정 변경)은 행 잠금으로 직렬화됩니다. 겹치는 두 배정을 동시에 승인해도 한쪽만 확정됩니다.

## Slack 알림

초대·비밀번호 재설정 링크와 업무 알림(배정 요청, 승인 요청, 반려, 일정 변경 등)을 Slack DM으로 보냅니다.

1. https://api.slack.com/apps 에서 앱 생성 → **OAuth & Permissions → Bot Token Scopes**에 `chat:write`, `users:read.email` 추가
2. **Install to Workspace** 후 *Bot User OAuth Token*(`xoxb-…`)을 서버 환경변수 `SLACK_BOT_TOKEN`에 설정
3. 직원의 **ScheduleSync 이메일 = Slack 계정 이메일**이어야 합니다(이메일로 사용자를 찾음). 서버 시작 시 토큰을 검증해 로그에 결과를 남깁니다.

- 발송 순서: Slack DM → (실패/미설정 시) SMTP → (개발 모드) 서버 콘솔
- Slack에서 사용자를 찾지 못하는 등 자동 발송에 실패하면 관리자 화면에 **1회용 링크**가 표시되어 직접 전달할 수 있습니다(감사 로그에 기록). 초대 대기 중인 직원은 *초대 재발송*으로 새 링크를 보낼 수 있고 이전 링크는 무효가 됩니다.
- 업무 알림 DM은 부가 기능입니다. 실패해도 업무 처리는 영향받지 않고 앱 내 알림함에는 그대로 쌓입니다.
- 토큰은 서버에만 두세요. 프런트(예: GitHub Pages)에 넣으면 누구나 볼 수 있습니다.

## Slack 로그인 (SSO)

`SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET`을 설정하면 로그인 화면에 **Slack으로 로그인**이 나타납니다(OpenID Connect, 인가 코드 방식).

1. Slack 앱의 *OpenID Connect* 설정에서 **Redirect URL**을 등록합니다: `<APP_URL>/api/auth/slack/callback` (개발: `http://localhost:3000/api/auth/slack/callback`). 주소가 정해지면 Slack 앱과 `APP_URL`만 바꾸면 됩니다.
2. *Basic Information*의 Client ID/Secret을 환경변수에 넣고, 가능하면 `SLACK_TEAM_ID`로 워크스페이스를 제한합니다.
3. 직원 계정은 이전처럼 **관리자가 먼저 등록**합니다. Slack 이메일과 같은 이메일로 매칭되며, 등록되지 않은 사람은 로그인할 수 없고 시도는 감사 로그(`SSO_LOGIN_REJECTED`)에 남습니다.

동작 방식
- 초대 대기 계정은 첫 Slack 로그인에서 자동으로 활성화됩니다. 초대 DM은 비밀번호 링크 대신 "Slack으로 로그인하세요" 안내만 보냅니다.
- 첫 로그인 때 계정이 그 Slack 사용자 ID에 **묶입니다**. 이후 같은 이메일을 다른 Slack 사람이 쓰면(주소 재사용) 거부됩니다.
- **비밀번호 로그인은 관리자 전용 비상 수단**입니다. 일반 직원은 비밀번호가 맞아도 거부되고, 로그인 화면에서도 "관리자 비상 로그인"을 눌러야 입력 폼이 보입니다. Slack 장애 시 관리자는 이 경로로 들어와 계정과 설정을 관리할 수 있습니다.
- 보안: `state`는 1회용이며 시작한 브라우저의 쿠키에 묶입니다(로그인 CSRF 방지). `nonce`, 발급자, 대상(audience), 만료, 이메일 인증, 워크스페이스를 검증하고, 로그인 결과는 1회용 60초 코드로만 프런트에 전달됩니다(URL에 세션 토큰 없음).
- `SLACK_CLIENT_ID`가 없으면 이전처럼 모든 계정이 비밀번호로 로그인합니다.

## 일정 변경 요청의 재검증

다른 허가권자의 프로젝트와 겹치는 일정 변경은 "상대 허가권자 승인 + 해당 직원 동의"가 모두 모여야 반영됩니다. 승인은 **요청 당시의 상황**에 대한 결정이므로, 서버는 승인할 때마다(그리고 반영 직전에 같은 잠금 안에서) 그 상황이 여전히 유효한지 확인합니다. 유효하지 않으면 요청을 **종료**하고(`CHANGE_WITHDRAWN` + 사유), 요청자와 관련자에게 알립니다.

| 종료 사유 | 의미 |
|---|---|
| `BASE_CHANGED` | 요청 이후 프로젝트의 기간/세션이 바뀜 |
| `NEW_CONFLICT` | 승인자들이 보지 못한 새로운 시간 겹침이 생김 |
| `PROJECT_CLOSED` | 프로젝트가 취소/종료됨 |
| `OWNER_CHANGED`, `REQUESTER_INACTIVE` | 요청자가 더 이상 프로젝트 소유 허가권자가 아니거나 비활성화됨 |
| `WITHDRAWN_BY_REQUESTER` | 요청자가 철회 |

- 프로젝트당 진행 중 요청은 **1건**입니다(DB 부분 유니크 인덱스로도 강제). 새 요청을 올릴 때 이미 무효가 된 이전 요청은 자동으로 종료되어 막지 않습니다.
- 요청자는 처리함의 "내가 요청한 일정 변경"에서 진행 상황을 보고 철회할 수 있습니다.
- 반려는 재검증 없이 항상 가능합니다.
- 이 기능 이전에 만들어진 진행 중 요청은 일정 지문(`base_hash`)이 없어 `BASE_CHANGED` 검사만 건너뛰고, 새 충돌 검사는 동일하게 적용됩니다.

## 시간대

- 캘린더는 항상 회사 기준 시간대(`Asia/Seoul`, `src/utils/dateAndRrule.ts`의 `DEFAULT_TZ`)로 표시합니다. 브라우저나 서버 컨테이너의 시간대(UTC 등)와 무관하게 같은 결과가 나옵니다.
- 반복 세션은 "세션 시간대의 벽시계 시간"(예: 매주 화 14:00 서울)으로 정의되고, 겹침 검사는 이를 실제 시각으로 변환해 비교합니다. 세션마다 `timezone`(IANA 이름)을 가질 수 있고 DST도 처리합니다.
- 단일(비반복) 세션의 `startAt`/`endAt`은 `Z` 또는 `+09:00` 같은 오프셋을 반드시 포함해야 합니다(없으면 API가 거부). 알 수 없는 타임존과 약 10년을 넘는 프로젝트 기간도 거부합니다.
- 감사 로그·알림함의 시각도 회사 시간대로 표시됩니다.

## 계정 흐름

- 관리자가 직원을 등록하면 **초대 DM**(72시간, 1회용 링크)이 발송되고, 직원이 비밀번호를 직접 설정하면 활성화됩니다.
- 비밀번호 재설정 링크는 30분, 1회용입니다. 존재하지 않는 이메일에도 동일하게 응답합니다.
- 비밀번호 변경/재설정/계정 비활성화 시 기존 세션은 모두 종료됩니다.

## 기존 `database.json`에서 이전할 때

이전 버전(JSON 파일 저장소)을 쓰던 데이터는 **서버를 처음 시작하기 전에** 가져옵니다. 빈 데이터베이스에만 가져올 수 있고 전체가 하나의 트랜잭션입니다(실패하면 아무것도 바뀌지 않음).

```bash
# DATABASE_URL (또는 DATA_DIR)을 설정한 상태에서
ADMIN_EMAIL=admin@회사.com ADMIN_PASSWORD='…' npm run db:import -- data/database.json
```

- 세션(로그인 상태)은 이전되지 않아 **모든 사용자가 다시 로그인**해야 합니다.
- 기존 해시(1,000회 PBKDF2)는 그대로 검증되고 각자 다음 로그인 때 자동으로 강화됩니다.
- **데모 시드 계정(`*.company.internal`)은 비활성(DISABLED)으로 가져옵니다.** 활성 관리자가 없으면 `ADMIN_EMAIL`/`ADMIN_PASSWORD`로 새 관리자를 만듭니다.
- 이전 버전에서 생길 수 있던 중복 진행 배정은 가장 최근 1건만 남기고 나머지는 `WITHDRAWN`으로 정리됩니다.

## 개발

```bash
npm run lint     # tsc --noEmit
npm test         # 실제 서버를 띄워 API·Slack·동시성·스키마·이전 시나리오 검증 (tests/)
TEST_DATABASE_ADMIN_URL=postgres://user:pw@localhost:5432/postgres npm test   # 실제 PostgreSQL(pg 드라이버)로 검증
npm run build
```

## 알려진 한계 (로드맵)

- 로그인/재설정 시도 제한은 프로세스 메모리 기반이라 **인스턴스가 여러 개면 인스턴스별로 적용**됩니다(공유 저장소 필요).
- "허가권자 전원 승인"의 범위(현재: 활성 허가권자 전체)는 제품 정책 확정 필요 (`server.ts`의 `activeApprovers()` 한 곳에서 변경)
- `/api/state`가 전체 데이터를 한 번에 내려줌 (페이지네이션 미구현)
- SSO(Slack 로그인), Slack 내 승인/반려 버튼, 알림 큐/리마인더, 공휴일 처리 미구현

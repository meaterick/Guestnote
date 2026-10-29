# Guestnote — 오늘의 방명록

날마다 새로 열리는 커다란 유리 보드에 방명록·메모·사진을 자유롭게 붙이는 웹사이트예요.

**사이트:** https://meaterick.github.io/Guestnote/

![Guestnote 화면](docs/screenshot.jpg)

## 기능

- **큰 보드**: 4000×2600 보드를 끌어서 둘러보고, 휠이나 두 손가락으로 확대·축소해요. 전체 위치는 미니맵으로 보여요.
- **글쓰기**: 방명록·메모·사진 세 종류에, 유리 색을 7가지 중에서 골라요. 빈 곳을 두 번 누르면 그 자리에 붙어요.
- **자리 옮기기**: 내 글은 끌어서(또는 화살표 키로) 옮기고, 오늘 안에서는 고칠 수 있어요. 지우는 건 언제든 돼요.
- **사진 압축**: 올리기 전에 브라우저에서 줄여요. 보드에는 작은 사진(640px, 48KB 이하)이 보이고, 큰 사진(1600px, 300KB 이하)은 눌렀을 때만 불러와요.
- **날마다 초기화**: 한국 시간 자정에 새 보드가 열려요. 지난 보드는 날짜를 눌러 달력에서 고르거나 `#/2026-10-28` 같은 주소로 열 수 있고, 읽기만 돼요.
- **Google 로그인과 실시간**: 보드는 누구나 보고, 글을 남길 때만 Google로 로그인해요. 다른 사람이 남기거나 옮긴 글은 새로고침 없이 바로 보여요. 이메일은 보드에 나오지 않아요.
- **글래스 디자인**: 날짜마다 배경 빛깔이 달라지고, 다크 모드와 휴대폰 화면을 지원해요.

## 구성

| 부분 | 내용 |
| --- | --- |
| 사이트 | `public/` 정적 파일. `main`에 올리면 GitHub Actions가 GitHub Pages로 배포해요. (Settings → Pages → Source: GitHub Actions) |
| 저장소 | Firebase 프로젝트 `note-5997b`의 Firestore(서울). 설정값은 [public/config.js](public/config.js)에 있어요. |
| 로그인 | Firebase Authentication의 Google 로그인. 승인된 도메인에 `meaterick.github.io`를 넣어 두었어요. |
| 보안 규칙 | [firebase/firestore.rules](firebase/firestore.rules): 누구나 읽기, Google로 로그인한 사람만 오늘 보드에 쓰기, 내 글만 수정, 관리자는 모든 글을 옮기거나 지우기, 사진 용량 제한 |

데이터는 `notes`(글과 작은 사진), `images`(큰 사진), `admins`(관리자 표시) 컬렉션에 저장돼요.

## 관리

- **고친 내용 배포**: `main`에 올리면 1분 안쪽으로 사이트에 반영돼요.
- **보안 규칙 변경**: `firebase/firestore.rules`를 고쳤다면 Firebase 콘솔 → Firestore → 규칙에 붙여 넣고 게시해요.
- **관리자 등록**: 사이트에서 Google로 로그인 → 오른쪽 위 ⓘ → "사이트 관리자라면"에서 계정 ID를 복사 → Firestore `admins` 컬렉션에 그 ID로 문서를 만들어요. 필드는 `name: 관리자` 하나면 돼요.
- **시간대·사진 용량**: [public/config.js](public/config.js)에서 바꿔요. 시간대를 바꾸면 규칙의 `utcOffsetHours()`도 같이 바꾸고, 사진 용량을 늘리면 규칙의 상한도 늘려 주세요.

## 폴더

```
public/              배포되는 사이트 (index.html, config.js, assets/app.css, assets/js/)
firebase/            Firestore 보안 규칙과 색인 설정
tests/               날짜 단위 테스트, 보안 규칙 테스트, 브라우저 테스트
.github/workflows/   GitHub Pages 배포, 테스트
```

## 테스트

```bash
npm install
npx playwright install chromium
npm test
```

Firebase 에뮬레이터 위에서 보안 규칙과 화면 흐름(로그인, 실시간 동기화, 드래그, 사진, 지난 기록, 자정 초기화, 휴대폰)을 확인해요. Java 21 이상이 필요하고, Google 로그인 창 스크립트를 받을 수 있게 인터넷이 연결돼 있어야 해요. `main`에 올릴 때마다 GitHub Actions에서도 자동으로 돌아가요.

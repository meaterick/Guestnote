# Guestnote — 오늘의 방명록

날마다 새로 열리는 커다란 유리 보드에 방명록, 메모, 사진을 자유롭게 붙이는 웹사이트예요.
보드는 매일 자정(한국 시간)에 새로 열리고, 지난 날의 보드는 달력에서 다시 볼 수 있어요.

![Guestnote 화면](docs/screenshot.jpg)

## 무엇을 할 수 있나요

- **큰 보드** — 4000×2600 크기의 보드를 끌어서 둘러보고, 휠·두 손가락으로 확대하고 줄여요. 오른쪽 아래 미니맵으로 전체 위치를 볼 수 있어요.
- **방명록 · 메모 · 사진** — 세 가지 글과 일곱 가지 유리 색 중에서 골라 남겨요.
- **자유로운 자리** — 빈 곳을 두 번 누르면 그 자리에 붙고, 내가 남긴 글은 끌어서 옮길 수 있어요. 키보드 화살표로도 움직여요.
- **사진 자동 압축** — 올리기 전에 브라우저에서 사진을 줄여요. 보드에는 작은 사진만 먼저 보이고, 큰 사진은 글을 눌렀을 때만 불러와요.
- **날마다 초기화** — 자정이 되면 열려 있는 화면도 새 보드로 바뀌어요. 지난 보드는 위쪽 날짜를 눌러 달력에서 찾거나, 주소 뒤에 `#/2026-10-28`처럼 날짜를 붙여 바로 열 수 있어요. 지난 보드는 읽기만 할 수 있어요.
- **글래스 디자인** — 반투명한 유리 카드 뒤로 날마다 다른 빛깔의 하늘이 비쳐요. 다크 모드와 휴대폰 화면도 지원해요.
- **Google 로그인** — 보드는 누구나 볼 수 있고, 글을 남기거나 옮길 때만 Google 계정으로 로그인해요. 같은 계정이면 휴대폰과 PC 어디서든 '내 글'로 알아봐요. 이메일은 보드에 나오지 않아요.
- **실시간** — Firebase를 연결하면 다른 사람이 남기거나 옮긴 글이 새로고침 없이 바로 보여요.

## 1. 내 컴퓨터에서 바로 보기

```bash
npm start
```

브라우저에서 http://127.0.0.1:4173 을 열어요. (Node.js가 없다면 `python3 -m http.server -d public 4173` 도 돼요.)

처음에는 **로컬 모드**로 동작해서 글이 각자의 브라우저에만 저장돼요. 방문자 모두가 같은 보드를 보려면 아래 3번의 Firebase 연결을 해 주세요.

## 2. GitHub Pages로 배포하기

`main` 브랜치에 올라가면 GitHub Actions가 `public/` 폴더를 GitHub Pages에 자동으로 배포해요. ([.github/workflows/pages.yml](.github/workflows/pages.yml))

1. 이 작업 브랜치를 `main`에 병합해요. (Pull Request로 병합하면 돼요.)
2. 저장소 **Settings → Pages → Build and deployment → Source** 를 **GitHub Actions** 로 바꿔요. (처음 한 번만)
3. **Actions** 탭에서 `GitHub Pages 배포`가 끝나면 사이트 주소가 나와요. 예: `https://meaterick.github.io/Guestnote/`
   - 2번을 하기 전에 배포가 먼저 실행돼서 실패했다면, Actions 탭에서 그 실행을 다시 돌리면(Re-run) 돼요.
   - 무료 계정에서는 **공개 저장소**여야 GitHub Pages를 쓸 수 있어요.

## 3. 방문자 모두가 같은 보드를 보게 하기 (Firebase 연결)

GitHub Pages는 파일만 보여 주는 정적 호스팅이라 글을 저장할 서버가 없어요. 그래서 글은 무료로 쓸 수 있는 Firebase(Firestore)에 저장해요. 신용카드 없이 무료 요금제(Spark)로 충분해요.

1. [Firebase 콘솔](https://console.firebase.google.com)에서 **프로젝트 추가**를 눌러 새 프로젝트를 만들어요. (Google 애널리틱스는 꺼도 돼요.)
2. **빌드 → Firestore Database → 데이터베이스 만들기**
   - 버전을 고르라고 하면 **Standard**
   - 위치: `asia-northeast3 (서울)` 추천
   - 보안 규칙: **프로덕션 모드**
3. Firestore의 **규칙** 탭에 [firebase/firestore.rules](firebase/firestore.rules) 내용을 통째로 붙여 넣고 **게시**해요.
4. **빌드 → Authentication → 시작하기 → 로그인 방법 → Google**을 **사용 설정**하고, 프로젝트 지원 이메일을 골라 저장해요.
5. 같은 Authentication의 **설정 → 승인된 도메인 → 도메인 추가**에서 `meaterick.github.io` 를 추가해요.
   이 주소가 없으면 사이트에서 Google 로그인 창이 열리지 않아요.
6. **프로젝트 설정(톱니바퀴) → 내 앱 → 웹(`</>`)** 으로 앱을 등록하면 `firebaseConfig`가 나와요.
   그 값을 [public/config.js](public/config.js)의 `firebase:` 자리에 붙여 넣어요.

   ```js
   firebase: {
     apiKey: 'AIza...',
     authDomain: 'my-guestnote.firebaseapp.com',
     projectId: 'my-guestnote',
     storageBucket: 'my-guestnote.firebasestorage.app',
     messagingSenderId: '1234567890',
     appId: '1:1234567890:web:abcdef',
   },
   ```

7. 커밋해서 `main`에 올리면 자동으로 다시 배포돼요. 오른쪽 위의 `로컬 모드` 표시가 `로그인` 버튼으로 바뀌면 연결된 거예요.

> `firebaseConfig`의 `apiKey`는 비밀번호가 아니라 프로젝트를 가리키는 이름표라서 공개 저장소에 올려도 괜찮아요. 데이터는 3번의 보안 규칙이 지켜요.
>
> 카카오톡이나 인스타그램처럼 앱 안에서 연 화면에서는 Google이 로그인을 막아요. 사이트가 이런 화면을 알아보고 크롬·사파리로 열도록 안내해요. (카카오톡에서는 `다른 브라우저로 열기` 버튼이 나와요.)

### 관리자 되기 (부적절한 글 지우기)

1. 사이트에서 관리자로 쓸 Google 계정으로 로그인한 뒤, 오른쪽 위 ⓘ 버튼 → **사이트 관리자라면** → 계정 ID를 복사해요.
2. Firestore **데이터** 탭에서 컬렉션 `admins`를 만들고, 문서 ID에 복사한 계정 ID를 넣어 저장해요. (필드는 아무거나 하나 있어도 돼요. 예: `name` = `관리자`)
3. 새로고침하면 `관리자` 표시가 나오고, 어느 날의 글이든 옮기거나 지울 수 있어요.

계정 ID는 Google 계정마다 고정이라, 같은 계정으로 로그인하면 다른 기기에서도 관리자예요.

## 용량 정책

사진은 올리기 전에 브라우저에서 줄여서, 원본은 어디에도 올라가지 않아요.

| 항목 | 기본값 | 바꾸는 곳 |
| --- | --- | --- |
| 보드에 보이는 작은 사진 | 긴 변 640px, 48KB 이하 | `config.js` → `image.thumbSide`, `image.thumbBytes` |
| 눌렀을 때 보는 큰 사진 | 긴 변 1600px, 300KB 이하 | `config.js` → `image.fullSide`, `image.fullBytes` |
| 고를 수 있는 원본 사진 | 25MB 이하 | `config.js` → `image.maxInputBytes` |
| 글자 수 | 이름 20자, 내용 500자 | `firestore.rules`, `assets/js/notes.js` |

- WebP로 저장하고, WebP를 만들 수 없는 브라우저에서는 JPEG로 저장해요. 정해진 용량에 들 때까지 화질과 크기를 단계적으로 낮춰요.
- 원본이 640px보다 작으면 큰 사진을 따로 만들지 않아요.
- 움직이는 GIF는 첫 장면만 저장돼요.
- Firestore 무료 한도(저장 1GiB, 하루 읽기 5만 번·쓰기 2만 번)로 사진 글을 대략 2,000~3,000장 담을 수 있어요. 용량 예산을 늘린다면 `firestore.rules`의 상한(작은 사진 90,000자, 큰 사진 560,000자)도 함께 늘려 주세요.
- 선택: [firebase/firestore.indexes.json](firebase/firestore.indexes.json)을 Firebase CLI로 배포(`firebase deploy --only firestore:indexes`)하면 사진과 본문 필드를 색인에서 빼서 저장 공간을 아껴요.

## 하루 기준 시간대 바꾸기

[public/config.js](public/config.js)의 `timeZone`과 [firebase/firestore.rules](firebase/firestore.rules)의 `utcOffsetHours()`를 같은 시간대로 맞춰 주세요. (기본: 한국 `Asia/Seoul` = 9)

## 폴더 구조

```
public/                 GitHub Pages로 배포되는 사이트
  index.html
  config.js             사이트 이름, Firebase 설정, 사진 용량
  assets/app.css        글래스 디자인
  assets/js/
    main.js             날짜별 보드 열기, 자정 초기화, 화면 연결
    board.js            큰 보드: 둘러보기, 확대/축소, 끌어서 옮기기, 미니맵
    notes.js            글 카드
    composer.js         글쓰기 창
    detail.js           자세히 보기 창
    calendar.js         지난 기록 달력
    image.js            사진 줄이기
    dates.js            날짜 계산
    store/              저장소 (local.js: 브라우저 IndexedDB, firebase.js: Firestore)
firebase/               Firestore 보안 규칙과 색인 설정
tests/                  테스트
.github/workflows/      GitHub Pages 배포, 테스트
```

## 개발자용: 테스트

```bash
npm install
npx playwright install chromium   # 처음 한 번
npm test
```

- `npm run test:unit` — 날짜 계산
- `npm run test:e2e` — 로컬 모드 브라우저 테스트 (글쓰기, 끌어서 옮기기, 사진 압축, 지난 기록, 자정 초기화, 휴대폰)
- `npm run test:firebase` — Firebase 에뮬레이터로 보안 규칙, Google 로그인, 두 방문자의 실시간 동기화를 확인해요. Java 21 이상이 필요하고, 로그인 창 스크립트(apis.google.com)를 받을 수 있게 인터넷이 연결돼 있어야 해요.

## 보안 메모

- 누구나 모든 날짜의 글을 읽을 수 있어요. 공개 방명록이라 개인정보는 남기지 않도록 안내해 주세요.
- 글은 Google로 로그인한 사람만, 서버 시각 기준 오늘 보드에만 쓸 수 있어요. 내 글만 옮기거나 고칠 수 있어요. 관리자는 모든 글을 옮기거나 지울 수 있지만 내용은 고칠 수 없어요.
- 글은 텍스트로만 그리고 사진은 줄인 이미지 데이터만 받아서, 글에 스크립트를 숨겨 넣을 수 없어요.
- 누구나 글을 남길 수 있는 만큼 스팸이 걱정된다면 Firebase **App Check**를 켜는 것도 고려해 보세요.

// Guestnote 설정 파일
// 이 파일만 고치면 사이트 이름, 저장 방식, 사진 용량을 바꿀 수 있어요.

export default {
  siteTitle: 'Guestnote',
  siteSubtitle: '오늘의 방명록',

  // 하루가 바뀌는 기준 시간대예요. 보드는 이 시간대의 자정마다 새로 열려요.
  // 바꾸면 firebase/firestore.rules 의 utcOffsetHours() 도 같은 값으로 맞춰 주세요.
  timeZone: 'Asia/Seoul',

  // Firebase 웹 앱 설정 (프로젝트 설정 → 내 앱에서 복사한 값)
  // 비밀번호가 아니라 프로젝트를 가리키는 이름표라 공개돼도 괜찮아요. 데이터는 보안 규칙이 지켜요.
  firebase: {
    apiKey: 'AIzaSyCCtrhYJBnY5iqPTwS2Z95LQTQwkK5p8pc',
    authDomain: 'note-5997b.firebaseapp.com',
    projectId: 'note-5997b',
    storageBucket: 'note-5997b.firebasestorage.app',
    messagingSenderId: '347832250387',
    appId: '1:347832250387:web:0a68a613b370d1ed5b0fe6',
    measurementId: 'G-MN9V443NPJ',
  },

  // 테스트용: Firebase 에뮬레이터에 연결할 때만 채워요. (테스트가 알아서 채워요)
  emulator: null,

  // 사진은 올리기 전에 브라우저에서 줄여요. (용량 단위: 바이트)
  // - 보드용 작은 사진: 보드에 바로 보이는 이미지
  // - 크게 보기용 사진: 글을 눌렀을 때만 따로 불러오는 이미지
  // firestore.rules 의 상한(작은 사진 90,000자, 큰 사진 560,000자)을 넘지 않게 해 주세요.
  image: {
    thumbSide: 640,
    thumbBytes: 48 * 1024,
    fullSide: 1600,
    fullBytes: 300 * 1024,
    maxInputBytes: 25 * 1024 * 1024,
  },
};

// config.firebase 가 있으면 공유 모드(Firebase), 없으면 로컬 모드로 저장소를 골라요.
export async function createStore(config) {
  if (config.firebase) {
    const { createFirebaseStore } = await import('./firebase.js');
    return createFirebaseStore(config);
  }
  const { createLocalStore } = await import('./local.js');
  return createLocalStore(config);
}

// 페이지(MAIN) 세계에서 돈다. content.js(격리된 세계)는 유튜브 플레이어 객체를 볼 수 없어서,
// <video> 의 currentTime 이 실제 곡 위치보다 얼마나 앞서 있는지를 <html data-ym-time-base> 에 적어 준다.
// 곡이 자동으로 넘어가면 유튜브가 다음 곡을 같은 버퍼에 이어 붙여 currentTime 이 0 으로 돌아가지 않는다
// (예: 화면은 0:08 인데 currentTime 은 225초). 플레이어의 getCurrentTime() 은 그때도 곡 기준이다.
setInterval(() => {
  const player = document.getElementById('movie_player');
  const video = document.querySelector('video');
  if (!player?.getCurrentTime || !video) return;
  const base = (video.currentTime - player.getCurrentTime()).toFixed(2);
  const data = document.documentElement.dataset;
  if (data.ymTimeBase !== base) data.ymTimeBase = base;
}, 250);

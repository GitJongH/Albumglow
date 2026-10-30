// 단축키로 테마 켜기/끄기. content.js 가 storage 변경을 감지해 즉시 반영한다.
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-theme') return;
  const { enabled = true } = await chrome.storage.sync.get('enabled');
  await chrome.storage.sync.set({ enabled: !enabled });
});

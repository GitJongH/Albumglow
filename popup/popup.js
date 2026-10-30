const DEFAULTS = { enabled: true, preset: 'apple', blur: 30, intensity: 70, accent: '#fa233b' };

const $ = (id) => document.getElementById(id);

function render(s) {
  $('enabled').checked = s.enabled;
  $('blur').value = s.blur;
  $('intensity').value = s.intensity;
  $('accent').value = s.accent;
  $('accentRow').hidden = s.preset !== 'custom';
  for (const b of document.querySelectorAll('#presets button')) {
    b.classList.toggle('active', b.dataset.preset === s.preset);
  }
}

chrome.storage.sync.get(DEFAULTS).then(render);

// 저장하면 content.js 의 storage.onChanged 가 즉시 반영한다.
function save(patch) {
  chrome.storage.sync.set(patch).then(() => chrome.storage.sync.get(DEFAULTS)).then(render);
}

$('enabled').addEventListener('change', (e) => save({ enabled: e.target.checked }));
$('blur').addEventListener('input', (e) => save({ blur: Number(e.target.value) }));
$('intensity').addEventListener('input', (e) => save({ intensity: Number(e.target.value) }));
$('accent').addEventListener('input', (e) => save({ accent: e.target.value }));
$('presets').addEventListener('click', (e) => {
  if (e.target.dataset.preset) save({ preset: e.target.dataset.preset });
});

// 단축키로 켜고 끈 경우 팝업이 열려 있어도 따라간다.
chrome.storage.onChanged.addListener(() => chrome.storage.sync.get(DEFAULTS).then(render));

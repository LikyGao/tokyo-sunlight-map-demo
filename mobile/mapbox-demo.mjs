import { tokyoDay, validDay, simulationTime, searchResults, searchZoom, floorBand } from './mapbox-demo-utils.mjs';
import { searchRequest, describeAddress, automaticAddress } from './address-search.mjs';

const el = id => document.getElementById(id);
const initialView = { center: [139.7648, 35.6812], zoom: 16.3, bearing: 25, pitch: 60 };
const noTransition = { duration: 0, delay: 0 };
let map, selected, facadeTint, modelUnits, accessToken;
let ready = false, pendingFrame = 0, floorBuilding = null, floorRequest = 0;
let day = tokyoDay(), sheet = null, noticeTimer, searchController, searchGeneration = 0;
let searchMarker;
const unitMode = !new URLSearchParams(location.search).has('ordinaryOnly');

lucide.createIcons();
function notice(message) {
  clearTimeout(noticeTimer);
  el('notice').textContent = message;
  el('notice').hidden = !message;
  if (message) noticeTimer = setTimeout(() => { el('notice').hidden = true; }, 5000);
}
function closeSearch() {
  searchGeneration++;
  searchController?.abort();
  el('search-results').hidden = true;
  el('search').setAttribute('aria-expanded', 'false');
}
function showSheet(next) {
  if (next === 'floor' && !floorBuilding) return;
  if (document.activeElement instanceof HTMLElement && (next || document.activeElement.closest('.sheet'))) document.activeElement.blur();
  sheet = next;
  document.body.dataset.sheet = next || '';
  for (const name of ['floor', 'date']) {
    el(`${name}-panel`).hidden = name !== next;
    el(`${name}-toggle`).setAttribute('aria-expanded', String(name === next));
  }
  if (next) {
    closeSearch();
    // Focus a non-editable surface, never an input that opens the mobile keyboard.
    el(`${next}-panel`).focus({ preventScroll: true });
  }
}
function setBadge(floor) {
  el('floor-badge').hidden = !floor;
  el('floor-badge').textContent = floor ? `${floor}F` : '';
  el('floor-toggle').classList.toggle('has-floor', !!floor);
  el('floor-toggle').setAttribute('aria-label', floor ? `階別の日当たり・${floor}階を表示中` : '階別の日当たり');
}
function floorError(message) {
  el('floor-error').textContent = message;
  if (message && sheet !== 'floor') notice(message);
}
function removeFloor() {
  floorRequest++;
  modelUnits?.resetFloor();
  facadeTint?.setFloor(null, null);
  if (selected) map.setFeatureState(selected, { select: true });
  setBadge(null);
  el('floor-result').textContent = '';
  el('floor-error').textContent = '';
  el('floor-apply').disabled = !floorBuilding;
}
function openFloor(height, base, officialFloors) {
  setBadge(null);
  el('floor-result').textContent = '';
  el('floor-error').textContent = '';
  el('floor-toggle').disabled = !floorBuilding;
  el('floor-apply').disabled = !floorBuilding;
  const floors = Number(officialFloors);
  el('total-floors').value = Number.isInteger(floors) && floors > 0 && floors <= 300 ? floors : Math.min(300, Math.max(1, Math.round((height - base) / 3)));
  el('target-floor').value = '1';
  el('target-floor').max = el('total-floors').value;
  if (floorBuilding) showSheet('floor');
  else { showSheet(null); notice('この建物の高さを取得できません。'); }
}
function selectModelUnit(feature) {
  floorRequest++;
  if (selected) { map.setFeatureState(selected, { select: false }); selected = null; }
  const height = Number(feature.properties.height);
  const valid = facadeTint.setModelSelection(feature);
  floorBuilding = valid ? { height, base: 0, model: true } : null;
  openFloor(height, 0);
}
function selectFloorBuilding(feature) {
  removeFloor();
  facadeTint?.setSelection(null);
  const height = Number(feature.properties.height), base = Number(feature.properties.min_height ?? 0);
  const geometry = feature.geometry;
  const valid = geometry && ['Polygon', 'MultiPolygon'].includes(geometry.type) && Number.isFinite(height) && Number.isFinite(base) && base >= 0 && height > base && facadeTint.setSelection(feature);
  floorBuilding = valid ? { height, base, geometry } : null;
  openFloor(height, base, feature.properties.floors);
}
function clearSelection() {
  modelUnits?.clear();
  if (selected) { map.setFeatureState(selected, { select: false }); selected = null; }
  floorBuilding = null;
  removeFloor();
  facadeTint?.setSelection(null);
  el('floor-toggle').disabled = true;
  if (sheet === 'floor') showSheet(null);
}
function settleKeyboard() {
  document.activeElement?.blur();
  return new Promise(resolve => {
    let timer;
    const finish = () => { clearTimeout(timer); clearTimeout(limit); window.visualViewport?.removeEventListener('resize', reset); resolve(); };
    const reset = () => { clearTimeout(timer); timer = setTimeout(finish, 180); };
    const limit = setTimeout(finish, 800);
    window.visualViewport?.addEventListener('resize', reset);
    reset();
  });
}
el('total-floors').addEventListener('input', () => { el('target-floor').max = el('total-floors').value || '300'; });
el('floor-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!floorBuilding) return;
  const total = Number(el('total-floors').value), floor = Number(el('target-floor').value);
  const range = floorBand(floorBuilding.base, floorBuilding.height, total, floor);
  if (!range) { floorError('確認する階は、総階数以下の整数を入力してください。'); return; }
  const building = floorBuilding, request = ++floorRequest;
  el('floor-apply').disabled = true;
  try {
    await settleKeyboard();
    if (building !== floorBuilding || request !== floorRequest) return;
    const success = building.model ? await modelUnits.setFloor(...range) : facadeTint.setFloor(...range);
    if (building !== floorBuilding || request !== floorRequest) return;
    if (!success) { floorError('地図の移動が終わってから、もう一度お試しください。'); return; }
    if (selected) map.setFeatureState(selected, { select: false });
    floorError('');
    el('floor-result').textContent = `${floor}階 / ${total}階`;
    setBadge(floor);
    showSheet(null);
    el('floor-toggle').focus({ preventScroll: true });
  } catch { floorError('階を表示できませんでした。もう一度お試しください。'); }
  finally { if (building === floorBuilding) el('floor-apply').disabled = false; }
});
el('floor-reset').addEventListener('click', () => { removeFloor(); showSheet(null); });
el('floor-close').addEventListener('click', () => { showSheet(null); el('floor-toggle').focus({ preventScroll: true }); });
el('floor-toggle').addEventListener('click', () => showSheet(sheet === 'floor' ? null : 'floor'));

function updateDateUI() {
  el('date').textContent = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(simulationTime(day, 720));
  el('date-input').value = day;
  if (window.Astronomy) {
    const seasons = Astronomy.Seasons(Number(day.slice(0, 4)));
    for (const button of document.querySelectorAll('[data-season]')) button.setAttribute('aria-pressed', String(tokyoDay(seasons[button.dataset.season].date) === day));
  }
}
function applyDay(value) {
  if (!validDay(value)) { el('date-error').textContent = '1900年から2100年の有効な日付を選択してください。'; return; }
  day = value;
  el('date-error').textContent = '';
  updateDateUI();
  document.dispatchEvent(new Event('sunmap:lightchange'));
  queueSun();
  showSheet(null);
}
el('date-toggle').addEventListener('click', () => showSheet(sheet === 'date' ? null : 'date'));
el('date-close').addEventListener('click', () => { showSheet(null); el('date-toggle').focus({ preventScroll: true }); });
el('date-form').addEventListener('submit', event => { event.preventDefault(); applyDay(el('date-input').value); });
el('today').addEventListener('click', () => applyDay(tokyoDay()));
for (const button of document.querySelectorAll('[data-season]')) button.addEventListener('click', () => {
  if (!window.Astronomy) { el('date-error').textContent = '季節の日付を取得できません。カレンダーから選択してください。'; return; }
  const year = Number((el('date-input').value || day).slice(0, 4));
  if (year < 1900 || year > 2100) { el('date-error').textContent = '1900年から2100年を選択してください。'; return; }
  applyDay(tokyoDay(Astronomy.Seasons(year)[button.dataset.season].date));
});
updateDateUI();

function applySun() {
  pendingFrame = 0;
  const minutes = Number(el('time').value);
  el('clock').value = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  el('time').setAttribute('aria-valuetext', `${el('clock').value} JST`);
  el('time').style.setProperty('--progress', `${minutes / 1439 * 100}%`);
  if (!ready) return;
  const center = map.getCenter();
  const position = SunCalc.getPosition(simulationTime(day, minutes), center.lat, center.lng);
  const altitude = position.altitude * 180 / Math.PI;
  const azimuth = (position.azimuth * 180 / Math.PI + 540) % 360;
  const above = altitude > 0, daylight = Math.max(0, Math.min(1, (altitude + 6) / 18));
  // SunCalc uses south-relative azimuth; Mapbox expects north-relative azimuth and zenith.
  map.setLights([
    { id: 'sunmap-ambient', type: 'ambient', properties: { color: '#ffffff', intensity: 0.12 + 0.3 * daylight, 'intensity-transition': noTransition } },
    { id: 'sunmap-sun', type: 'directional', properties: { direction: [azimuth, Math.max(0, Math.min(90, 90 - altitude))], color: altitude < 10 ? '#ffdfb0' : '#ffffff', intensity: above ? Math.min(0.85, altitude / 10 * 0.85) : 0, 'cast-shadows': above, 'shadow-intensity': 0.85, 'direction-transition': noTransition, 'intensity-transition': noTransition, 'color-transition': noTransition } }
  ]);
}
function queueSun() { if (!pendingFrame) pendingFrame = requestAnimationFrame(applySun); }
el('time').addEventListener('input', queueSun);
el('time').addEventListener('change', queueSun);

function updateTools() {
  el('north-arrow').style.transform = `rotate(${-map.getBearing()}deg)`;
  const is3D = map.getPitch() > 10;
  el('view-toggle').setAttribute('aria-pressed', String(is3D));
  const label = is3D ? '2D表示に切り替え' : '3D表示に切り替え';
  el('view-toggle').setAttribute('aria-label', label);
  el('view-toggle').title = label;
}
el('zoom-in').addEventListener('click', () => map?.zoomIn());
el('zoom-out').addEventListener('click', () => map?.zoomOut());
el('north').addEventListener('click', () => map?.easeTo({ bearing: 0, duration: 400 }));
el('view-toggle').addEventListener('click', () => map?.easeTo({ pitch: map.getPitch() > 10 ? 0 : 60, duration: 500 }));

function locateSearchResult(feature, title, addressInfo) {
  clearSelection(); showSheet(null); closeSearch();
  el('search').value = title;
  document.activeElement?.blur();
  searchMarker?.remove();
  searchMarker = new mapboxgl.Marker({ color: '#d69a28', scale: 0.7 }).setLngLat(feature.geometry.coordinates).addTo(map);
  const zoom = searchZoom(feature);
  map.flyTo({ center: feature.geometry.coordinates, zoom, pitch: zoom >= 15 ? 60 : 0, duration: 1200 });
  if (addressInfo) notice(addressInfo.exact ? addressInfo.label : '番地は未確認です。候補の周辺を表示しています。');
}

el('search-form').addEventListener('submit', async event => {
  event.preventDefault();
  const q = el('search').value.trim();
  if (!ready || !q) return;
  showSheet(null);
  closeSearch();
  const generation = searchGeneration, controller = searchController = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  el('search').blur();
  el('search-results').hidden = false;
  el('search').setAttribute('aria-expanded', 'true');
  el('result-list').replaceChildren();
  el('search-attribution').textContent = '';
  el('search-status').textContent = '検索中…';
  try {
    const { url, address: isAddress } = searchRequest(q, accessToken, map.getCenter());
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error([401, 403].includes(response.status) ? '検索サービスに接続できません。' : response.status === 429 ? 'しばらく待ってから再検索してください。' : '検索できませんでした。通信を確認してください。');
    const data = await response.json();
    if (generation !== searchGeneration) return;
    const results = searchResults(data);
    const automatic = isAddress && automaticAddress(results, q);
    if (automatic) {
      const info = describeAddress(automatic, q);
      locateSearchResult(automatic, info.title, info);
      return;
    }
    if (isAddress) {
      results.sort((a, b) => Number(describeAddress(b, q).exact) - Number(describeAddress(a, q).exact));
      el('search-status').textContent = results.length ? '住所候補をご確認ください' : '住所が見つかりませんでした。市区町村・町名・番地をご確認ください。';
    } else el('search-status').textContent = results.length ? `${results.length}件` : '見つかりませんでした。名称や住所を変えてお試しください。';
    el('search-attribution').textContent = data.attribution || '© Mapbox and its suppliers';
    for (const feature of results) {
      const properties = feature.properties;
      const addressInfo = isAddress ? describeAddress(feature, q) : null;
      const item = document.createElement('li'), button = document.createElement('button');
      const name = document.createElement('strong'), address = document.createElement('span');
      name.textContent = addressInfo ? addressInfo.title : properties.name_preferred || properties.name || '検索結果';
      address.textContent = addressInfo ? addressInfo.label : properties.full_address || properties.place_formatted || '';
      button.type = 'button';
      button.append(name, address); item.append(button); el('result-list').append(item);
      button.addEventListener('click', () => locateSearchResult(feature, name.textContent, addressInfo));
    }
  } catch (error) {
    if (generation === searchGeneration) el('search-status').textContent = error.name === 'AbortError' ? '検索に時間がかかっています。もう一度お試しください。' : /^[\u3040-\u9fff]/.test(error.message) ? error.message : '検索できませんでした。通信を確認してください。';
  } finally { clearTimeout(timeout); }
});
el('search').addEventListener('input', closeSearch);
el('search').addEventListener('focus', () => showSheet(null));
el('search-close').addEventListener('click', closeSearch);
el('search').addEventListener('keydown', event => {
  if (event.key === 'ArrowDown' && !el('search-results').hidden) { event.preventDefault(); el('result-list').querySelector('button')?.focus(); }
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') { closeSearch(); showSheet(null); }
});

function viewportChanged() {
  const viewport = window.visualViewport;
  const inset = viewport ? Math.max(0, innerHeight - viewport.height - viewport.offsetTop) : 0;
  document.documentElement.style.setProperty('--keyboard', `${inset > 80 ? inset : 0}px`);
  const editing = document.activeElement?.matches('input:not([type=range])');
  document.body.classList.toggle('keyboard-open', !!editing && (inset > 80 || innerHeight < 500));
}
window.visualViewport?.addEventListener('resize', viewportChanged);
window.visualViewport?.addEventListener('scroll', viewportChanged);
document.addEventListener('focusin', viewportChanged);
document.addEventListener('focusout', () => setTimeout(viewportChanged, 0));

if (!window.sunlightConfig?.mapboxPublicToken?.startsWith('pk.')) el('setup').showModal();
el('setup').addEventListener('cancel', event => { if (!map) event.preventDefault(); });
el('connect').addEventListener('submit', event => {
  event.preventDefault();
  const token = el('token').value.trim();
  if (!token.startsWith('pk.')) { el('setup-error').textContent = 'pk. で始まる公開トークンを入力してください。'; return; }
  if (!window.mapboxgl || !window.SunCalc || !window.turf || !window.THREE) { el('setup-error').textContent = '地図を読み込めません。通信を確認して再読み込みしてください。'; return; }
  try {
    map = new mapboxgl.Map({ container: 'map', accessToken: token, style: 'mapbox://styles/mapbox/standard', ...initialView, antialias: true, language: 'ja', locale: { 'AttributionControl.ToggleAttribution': '出典を表示' }, config: { basemap: { lightPreset: 'day', colorBuildingSelect: '#589ddf' } } });
  } catch { el('setup-error').textContent = '地図を開始できません。通信とブラウザーの設定を確認してください。'; return; }
  accessToken = token;
  el('token').value = '';
  el('setup').close();
  notice('地図を読み込み中…');
  map.on('error', event => {
    const code = event.error?.status;
    if (code === 401 || code === 403) notice('地図に接続できません。トークンの設定を確認してください。');
    else if (!ready) notice('地図を読み込めませんでした。通信を確認してください。');
  });
  map.on('load', async () => {
    const addTint = () => { facadeTint = createFacadeTintLayer(floorError); map.addLayer(facadeTint); };
    try {
      addTint();
      if (unitMode) {
        const { startModelUnitDemo } = await import('./model-unit-demo.mjs?v=2');
        modelUnits = await startModelUnitDemo(map, token, {
          tint: () => facadeTint, onSelect: selectModelUnit,
          onOrdinary: feature => {
            if (selected) map.setFeatureState(selected, { select: false });
            selected = feature; map.setFeatureState(feature, { select: true }); selectFloorBuilding(feature);
          },
          onClear: clearSelection, onStatus: () => {}, onError: floorError,
          onStyleReady: addTint
        });
      }
      ready = true;
      el('map-ui').hidden = false;
      notice(''); applySun(); updateTools();
      map.on('moveend', queueSun);
      map.on('rotate', updateTools);
      map.on('pitch', updateTools);
      map.on('click', event => {
        closeSearch(); searchMarker?.remove();
        if (unitMode) return;
        const feature = map.queryRenderedFeatures(event.point, { target: { featuresetId: 'buildings', importId: 'basemap' } }).find(item => ['Polygon', 'MultiPolygon'].includes(item.geometry?.type));
        if (!feature) { clearSelection(); return; }
        if (selected) map.setFeatureState(selected, { select: false });
        selected = feature; map.setFeatureState(selected, { select: true }); selectFloorBuilding(feature);
      });
    } catch { notice('地図を開始できませんでした。再読み込みしてください。'); }
  });
});

if (window.sunlightConfig?.mapboxPublicToken?.startsWith('pk.')) {
  el('token').value = window.sunlightConfig.mapboxPublicToken;
  el('connect').requestSubmit();
  if (!map) el('setup').showModal();
}

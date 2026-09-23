import { createModelHitProbe } from './model-hit-probe.mjs?v=units-1';

// Selection is the data's model ID, which may represent part of a building or a complex.
export async function startModelUnitDemo(map, token, ui) {
  const url = new URL('https://api.mapbox.com/styles/v1/mapbox/standard');
  url.searchParams.set('access_token', token);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const style = await response.json();
  const layer = style.layers?.find(item => item.id === 'building-models' && item.type === 'model');
  if (!layer) throw new Error('精細モデルのレイヤーを取得できません');
  const color = layer.paint?.['model-color'] ?? '#ffffff';
  const mix = layer.paint?.['model-color-mix-intensity'] ?? 0;
  style.fragment = false;
  await new Promise(resolve => {
    map.once('style.load', resolve);
    map.setStyle(style, { diff: false });
  });
  ui.onStyleReady();
  const probe = createModelHitProbe(map, layer.id);
  let selected = null, floor = null, busy = false, generation = 0, dirty = false;
  let visibleMask = false;

  function paint() {
    if (busy || !map.getLayer(layer.id)) return;
    const match = selected && !(floor && visibleMask) ? ['==', ['to-string', ['id']], String(selected.id)] : false;
    map.setPaintProperty(layer.id, 'model-color', ['case', match, '#267ecf', color]);
    map.setPaintProperty(layer.id, 'model-color-mix-intensity', ['case', match, 0.8, mix]);
  }
  map.setPaintProperty(layer.id, 'model-color-transition', { duration: 0, delay: 0 });
  map.setPaintProperty(layer.id, 'model-color-mix-intensity-transition', { duration: 0, delay: 0 });

  function invalidateMask() {
    generation++;
    probe.cancel();
    visibleMask = false;
    ui.tint().setModelMask(null);
    dirty = !!(floor && selected);
    if (dirty) ui.onStatus('視点の更新後に外壁を再確認します');
    paint();
  }

  async function refreshMask() {
    if (busy || !selected || !floor || map.isMoving()) return false;
    busy = true;
    dirty = false;
    const version = generation, id = selected.id;
    ui.onStatus('選択ユニットの外壁を確認中…');
    try {
      const result = await probe.run({ x: 0, y: 0 }, [{ id }], { captureMask: true });
      if (version !== generation) return false;
      // Off-screen or fully occluded units are normal after a camera/viewport change.
      if (!result.mask?.count) { ui.onError(''); return false; }
      ui.tint().setModelMask(result.mask);
      if (!ui.tint().setFloor(...floor)) throw new Error('このモデルの高さを取得できません');
      visibleMask = true;
      ui.onError('');
      ui.onStatus('選択ユニット · 推定階の表示中');
      return true;
    } catch (error) {
      if (version === generation) ui.onError(error.message);
      return false;
    } finally {
      busy = false;
      paint();
      if (dirty) map.triggerRepaint();
    }
  }

  const controller = {
    clear() {
      selected = null; floor = null; dirty = false;
      invalidateMask();
      ui.onStatus('太陽位置連動・ユニット検証');
    },
    resetFloor() {
      floor = null;
      invalidateMask();
      ui.tint().setFloor(null, null);
      if (selected) ui.onStatus('精細モデル · ユニット選択中');
    },
    async setFloor(low, high) {
      if (!selected || busy) return false;
      floor = [low, high];
      if (visibleMask) {
        ui.tint().setFloor(low, high);
        return true;
      }
      return refreshMask();
    }
  };

  map.on('movestart', invalidateMask);
  map.on('resize', invalidateMask);
  map.on('sourcedata', event => {
    if (event.sourceId === layer.source && event.sourceDataType === 'content' && selected) invalidateMask();
  });
  map.on('idle', () => { if (dirty) refreshMask(); });
  document.getElementById('time').addEventListener('input', () => {
    // Lighting changes do not invalidate geometry; only an in-progress probe must stop.
    if (busy) invalidateMask();
  });
  document.addEventListener('sunmap:lightchange', () => {
    if (busy) invalidateMask();
  });
  map.on('click', async event => {
    if (busy || map.isMoving()) return;
    const version = ++generation;
    const candidates = map.queryRenderedFeatures(event.point, { layers: [layer.id] });
    if (candidates.length) {
      busy = true;
      ui.onStatus('クリックしたユニットを確認中…');
      try {
        const result = await probe.run(event.point, candidates);
        if (version !== generation) return;
        if (result.matches.length === 1) {
          selected = candidates.find(feature => String(feature.id) === result.matches[0]);
          floor = null; visibleMask = false; dirty = false;
          ui.onSelect(selected);
          ui.onStatus('精細モデル · ユニット選択中');
          return;
        }
        // A bounding-box candidate alone is not an actual model hit.
      } catch (error) {
        if (version === generation) ui.onError(error.message);
        return;
      } finally {
        busy = false;
        paint();
      }
    }
    if (version !== generation) return;
    const ordinary = map.queryRenderedFeatures(event.point, { target: { featuresetId: 'buildings' } })
      .find(feature => ['Polygon', 'MultiPolygon'].includes(feature.geometry?.type));
    controller.clear();
    if (ordinary) ui.onOrdinary(ordinary);
    else ui.onClear();
  });
  return controller;
}

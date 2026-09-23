// Diagnostic pixel check. It identifies rendered assets, not individual buildings.
export function classifyModelProbe(red, green, repeatRed) {
  if (![red, green, repeatRed].every(sample => sample?.length === 4 && sample.every(Number.isFinite) && sample[3] >= 250)) return false;
  const stable = red.slice(0, 3).every((value, i) => Math.abs(value - repeatRed[i]) <= 12);
  return stable && red[0] - green[0] > 35 && green[1] - red[1] > 35 && Math.abs(red[2] - green[2]) < 30;
}

export function buildModelMask(frames, width, height) {
  if (frames.length !== 3 || frames.some(frame => frame.length !== width * height * 4)) throw new Error('Invalid mask frames');
  const [red, green, repeat] = frames;
  const data = new Uint8Array(width * height);
  let count = 0;
  for (let i = 0, pixel = 0; i < red.length; i += 4, pixel++) {
    if (red[i + 3] < 250 || green[i + 3] < 250 || repeat[i + 3] < 250) continue;
    if (Math.abs(red[i] - repeat[i]) > 12 || Math.abs(red[i + 1] - repeat[i + 1]) > 12 || Math.abs(red[i + 2] - repeat[i + 2]) > 12) continue;
    if (red[i] - green[i] > 35 && green[i + 1] - red[i + 1] > 35 && Math.abs(red[i + 2] - green[i + 2]) < 30) {
      data[pixel] = 255; count++;
    }
  }
  return { data, width, height, count };
}

export function createModelHitProbe(map, layerId) {
  let controller = null;
  const cancel = () => controller?.abort();
  map.on('movestart', cancel);
  map.on('resize', cancel);
  map.on('remove', cancel);
  document.getElementById('time')?.addEventListener('input', cancel);

  function frame(read, signal) {
    return new Promise((resolve, reject) => {
      const finish = (error, value) => {
        clearTimeout(timer);
        map.off('render', onRender);
        signal?.removeEventListener('abort', onAbort);
        error ? reject(error) : resolve(value);
      };
      const onAbort = () => finish(new Error('操作の変更により検証を中止しました'));
      const onRender = () => {
        try { finish(null, read()); } catch (error) { finish(error); }
      };
      const timer = setTimeout(() => finish(new Error('描画の待機がタイムアウトしました')), 3000);
      map.on('render', onRender);
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();
      else map.triggerRepaint();
    });
  }

  return {
    cancel,
    async run(point, candidates, { captureMask = false } = {}) {
      if (controller) throw new Error('検証中です');
      if (map.isMoving()) throw new Error('地図の移動後に再度選択してください');
      const ids = [...new Set(candidates.map(feature => String(feature.id)))];
      if (captureMask && ids.length !== 1) throw new Error('Mask capture requires one model ID');
      if (ids.length > 8) throw new Error('候補が多すぎます。拡大して再度選択してください');
      if (!ids.length) return { status: 'no-candidate', matches: [], samples: [] };
      controller = new AbortController();
      const signal = controller.signal;
      const canvas = map.getCanvas();
      const x = Math.max(0, Math.min(canvas.width - 1, Math.floor(point.x * canvas.width / canvas.clientWidth)));
      const y = Math.max(0, Math.min(canvas.height - 1, Math.floor(point.y * canvas.height / canvas.clientHeight)));
      const shield = document.createElement('canvas');
      shield.setAttribute('aria-hidden', 'true');
      shield.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:1';
      shield.width = canvas.width; shield.height = canvas.height;
      const shieldContext = shield.getContext('2d');
      const pixel = document.createElement('canvas');pixel.width = pixel.height = 1;
      const context = pixel.getContext('2d', { willReadFrequently: true });
      const capture = captureMask ? document.createElement('canvas') : null;
      if (capture) { capture.width = canvas.width; capture.height = canvas.height; }
      const captureContext = capture?.getContext('2d', { willReadFrequently: true });
      const frames = [];
      const names = ['model-color', 'model-color-mix-intensity', 'model-emissive-strength'];
      const saved = new Map(names.flatMap(name => [name, `${name}-transition`]).map(name => [name, map.getPaintProperty(layerId, name)]));
      const start = performance.now();
      const read = () => {
        if (captureContext) {
          captureContext.clearRect(0, 0, canvas.width, canvas.height);
          captureContext.drawImage(canvas, 0, 0);
          frames.push(captureContext.getImageData(0, 0, canvas.width, canvas.height).data);
        }
        context.clearRect(0, 0, 1, 1);
        context.drawImage(canvas, x, y, 1, 1, 0, 0, 1, 1);
        return [...context.getImageData(0, 0, 1, 1).data];
      };
      try {
        await frame(() => shieldContext.drawImage(canvas, 0, 0), signal);
        map.getCanvasContainer().append(shield);
        for (const name of names) map.setPaintProperty(layerId, `${name}-transition`, { duration: 0, delay: 0 });
        const samples = [];
        for (const id of ids) {
          const match = ['==', ['to-string', ['id']], id];
          map.setPaintProperty(layerId, 'model-color-mix-intensity', ['case', match, 1, saved.get('model-color-mix-intensity') ?? 0]);
          map.setPaintProperty(layerId, 'model-emissive-strength', ['case', match, 1, saved.get('model-emissive-strength') ?? 0]);
          const colors = [];
          for (const color of ['#ff0000', '#00ff00', '#ff0000']) {
            if (signal.aborted) throw new Error('操作の変更により検証を中止しました');
            map.setPaintProperty(layerId, 'model-color', ['case', match, color, saved.get('model-color') ?? '#ffffff']);
            colors.push(await frame(read, signal));
          }
          samples.push({ id, colors, visibleAtPixel: classifyModelProbe(...colors) });
        }
        const matches = samples.filter(sample => sample.visibleAtPixel).map(sample => sample.id);
        return { status: matches.length === 1 ? 'single-asset' : matches.length ? 'ambiguous' : 'unconfirmed',
          matches, samples, mask: captureMask ? buildModelMask(frames, canvas.width, canvas.height) : null,
          durationMs: Math.round(performance.now() - start) };
      } finally {
        try {
          if (map.getLayer(layerId)) {
            for (const name of names) map.setPaintProperty(layerId, name, saved.get(name) ?? null);
            // Render the restored image before exposing the live canvas again.
            await frame(() => {}, null);
            for (const name of names) map.setPaintProperty(layerId, `${name}-transition`, saved.get(`${name}-transition`) ?? null);
          }
        } finally { shield.remove(); controller = null; }
      }
    }
  };
}

// Read-only, version-pinned internal audit. Never used for selection or styling.
export function auditModelStructure(map, sourceId, id) {
  const cache = map.style?.getOwnSourceCache?.(sourceId);
  if (!cache?._tiles) return { status: 'internal-api-unavailable' };
  const nodes = [];
  const seen = new Set();
  const summarize = (node, depth = 0) => ({
    id: node.id ?? null, name: node.name ?? null,
    meshCount: node.meshes?.length ?? 0, lodMeshCount: node.lodMeshes?.length ?? 0,
    meshes: (node.meshes || []).map((mesh, index) => ({
      index, light: index === node.lightMeshIndex,
      bounds: mesh.aabb ? { min: Array.from(mesh.aabb.min), max: Array.from(mesh.aabb.max) } : null,
      retainedPositionBytes: mesh.vertexArray?.arrayBuffer?.byteLength ?? 0,
      retainedIndexBytes: mesh.indexArray?.arrayBuffer?.byteLength ?? 0,
      materialName: mesh.material?.name ?? null,
      featureValueCount: mesh.featureData?.length ?? 0
    })),
    children: depth < 4 ? (node.children || []).map(child => summarize(child, depth + 1)) : 'depth-limit'
  });
  for (const tile of Object.values(cache._tiles)) {
    for (const bucket of Object.values(tile.buckets || {})) {
      if (!bucket.isTiled3dModelBucket || seen.has(bucket)) continue;
      seen.add(bucket);
      for (const info of bucket.nodesInfo || []) {
        if (String(info.feature?.id) === String(id)) nodes.push(summarize(info.node));
      }
    }
  }
  return { status: 'internal-read-only', version: mapboxgl.version, nodes };
}

// Keep place names intact; normalize only number widths and address separators.
export function normalizeSearchQuery(value) {
  return value.normalize('NFKC').trim()
    .replace(/(\d)\s*[‐‑‒–—―−ー-]\s*(?=\d)/g, '$1-');
}

function addressKey(value) {
  return normalizeSearchQuery(value || '')
    .replace(/^日本\s*[,、]?\s*/, '')
    .replace(/^〒?\s*\d{3}-\d{4}(?!\d)\s*/, '')
    .replace(/([〇零一二三四五六七八九十]+)丁目/g, (_, numeral) => {
      const digits = '〇一二三四五六七八九';
      const parts = numeral.replaceAll('零', '〇').split('十');
      if (parts.length > 2) return `${numeral}丁目`;
      const number = parts.length === 2 ? (parts[0] ? digits.indexOf(parts[0]) : 1) * 10 + (parts[1] ? digits.indexOf(parts[1]) : 0) : digits.indexOf(parts[0]);
      return number >= 0 ? `${number}丁目` : `${numeral}丁目`;
    })
    .replace(/(\d+)(?:丁目|番地の|番地|番|号)/g, '$1-')
    .replace(/\s+/g, '').replace(/-+$/g, '');
}

export function isAddressQuery(query) {
  const key = addressKey(query);
  return /\d+-\d+(?:-\d+)?$/.test(key) || /[都道府県市区町村].*\d/.test(key) || /\d+\s*(?:丁目|番地|番|号)/.test(normalizeSearchQuery(query)) || /^〒?\s*\d{3}-\d{4}$/.test(normalizeSearchQuery(query));
}

export function searchRequest(query, token, center) {
  const q = normalizeSearchQuery(query), address = isAddressQuery(q);
  const url = new URL(address ? 'https://api.mapbox.com/search/geocode/v6/forward' : 'https://api.mapbox.com/search/searchbox/v1/forward');
  const params = { q, access_token: token, language: 'ja', proximity: `${center.lng},${center.lat}`, limit: '7' };
  if (address) Object.assign(params, { country: 'jp', autocomplete: 'false' });
  url.search = new URLSearchParams(params);
  return { url, address };
}

export function describeAddress(feature, query) {
  const p = feature.properties || {}, context = p.context || {};
  const full = p.full_address || `${p.place_formatted || ''} ${p.name || ''}`;
  const key = addressKey(full), input = addressKey(query);
  const region = addressKey(context.region?.name), place = addressKey(context.place?.name);
  const withoutRegion = region && key.startsWith(region) ? key.slice(region.length) : key;
  const withoutPlace = place && withoutRegion.startsWith(place) ? withoutRegion.slice(place.length) : withoutRegion;
  const suppliedPostcode = normalizeSearchQuery(query).match(/(?:^|〒|\s)(\d{3}-\d{4})(?!\d)/)?.[1];
  const postcodeMatches = !suppliedPostcode || suppliedPostcode === normalizeSearchQuery(context.postcode?.name || '');
  const exact = p.feature_type === 'address' && /\d+-\d+(?:-\d+)?$/.test(input) && postcodeMatches && [key, withoutRegion, withoutPlace].includes(input);
  const knownPoint = ['rooftop', 'parcel', 'point'].includes(p.coordinates?.accuracy);
  // Japanese responses may mark hyphenated numeric components unmatched even when
  // the returned full address matches. Compare the address text as well as type/accuracy.
  const automatic = exact && knownPoint && !!place && (input === key || input === withoutRegion);
  let label;
  if (exact) label = knownPoint ? '番地一致' : '番地一致・位置は概算';
  else if (p.feature_type === 'address') label = '住所候補・入力との一致は未確認';
  else label = ({ block: '街区付近・番地未確認', neighborhood: '丁目付近・番地未確認', locality: '町名付近・番地未確認', postcode: '郵便番号の範囲・番地未確認' })[p.feature_type] || '地域の中心付近・番地未確認';
  return { title: full.replace(/^日本\s*[,、]?\s*/, ''), label, exact, automatic };
}

export function automaticAddress(results, query) {
  const exact = results.filter(feature => describeAddress(feature, query).exact);
  return exact.length === 1 && describeAddress(exact[0], query).automatic ? exact[0] : null;
}

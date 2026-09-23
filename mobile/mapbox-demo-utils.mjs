export function tokyoDay(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const part = key => parts.find(item => item.type === key).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function validDay(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < '1900-01-01' || day > '2100-12-31') return false;
  const time = new Date(`${day}T00:00:00Z`);
  return Number.isFinite(time.getTime()) && time.toISOString().slice(0, 10) === day;
}

export function simulationTime(day, minutes) {
  if (!validDay(day) || !Number.isInteger(minutes) || minutes < 0 || minutes > 1439) throw new Error('Invalid date or time');
  return new Date(Date.parse(`${day}T00:00:00+09:00`) + minutes * 60000);
}

export function searchResults(data) {
  const seen = new Set();
  return (Array.isArray(data.features) ? data.features : []).filter(feature => {
    const p = feature.properties || {}, c = feature.geometry?.coordinates;
    if (feature.geometry?.type !== 'Point' || !Array.isArray(c) || c.length < 2 || !c.slice(0, 2).every(Number.isFinite) || Math.abs(c[0]) > 180 || Math.abs(c[1]) > 90) return false;
    const key = `${p.name || ''}|${p.full_address || p.place_formatted || ''}|${c[0].toFixed(3)},${c[1].toFixed(3)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 7);
}

export function searchZoom(feature) {
  const type = feature.properties?.feature_type;
  return ({ country: 4, region: 8, place: 12, city: 12, locality: 14, neighborhood: 15, postcode: 15 })[type] || 16.3;
}

export function floorBand(base, height, total, floor) {
  if (![base, height].every(Number.isFinite) || base < 0 || height <= base || !Number.isInteger(total) || total < 1 || total > 300 || !Number.isInteger(floor) || floor < 1 || floor > total) return null;
  const step = (height - base) / total;
  return [base + (floor - 1) * step, base + floor * step];
}

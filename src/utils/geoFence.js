// Haversine formula — same logic as your Laravel check-in
function getDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000; // metres
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

function isWithinRadius(userLat, userLng, storeLat, storeLng, radius) {
  const dist = getDistance(userLat, userLng, storeLat, storeLng);
  return { allowed: dist <= radius, distance: Math.round(dist) };
}

module.exports = { getDistance, isWithinRadius };
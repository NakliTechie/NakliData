// Pure coordinate helpers for the Map cell. Keep the inference deliberately
// narrower than a generic x/y picker: a latitude-like header, a
// longitude-like header, and at least one jointly valid geographic pair are
// all required before the UI auto-binds the result.

export interface CoordinateColumns {
  latitudeCol: string;
  longitudeCol: string;
}

interface CoordinateResult {
  columns: string[];
  rows: Array<Record<string, unknown>>;
}

export function inferCoordinateColumns(result: CoordinateResult): CoordinateColumns | null {
  const latitudeCol = result.columns.find((column) => coordinateRole(column) === 'latitude');
  const longitudeCol = result.columns.find((column) => coordinateRole(column) === 'longitude');
  if (!latitudeCol || !longitudeCol) return null;
  const hasValidPair = result.rows.some(
    (row) => coordinatePoint(row[latitudeCol], row[longitudeCol]) !== null,
  );
  return hasValidPair ? { latitudeCol, longitudeCol } : null;
}

export function coordinatePoint(latitude: unknown, longitude: unknown): [number, number] | null {
  const lat = boundedNumber(latitude, 90);
  const lon = boundedNumber(longitude, 180);
  return lat === null || lon === null ? null : [lon, lat];
}

function coordinateRole(column: string): 'latitude' | 'longitude' | null {
  const normalized = column.toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (normalized === 'lat' || normalized === 'latitude' || normalized === 'decimallatitude') {
    return 'latitude';
  }
  if (
    normalized === 'lon' ||
    normalized === 'lng' ||
    normalized === 'long' ||
    normalized === 'longitude' ||
    normalized === 'decimallongitude'
  ) {
    return 'longitude';
  }
  return null;
}

function boundedNumber(value: unknown, limit: number): number | null {
  if (
    (typeof value !== 'number' && typeof value !== 'bigint' && typeof value !== 'string') ||
    (typeof value === 'string' && value.trim() === '')
  ) {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) && Math.abs(number) <= limit ? number : null;
}

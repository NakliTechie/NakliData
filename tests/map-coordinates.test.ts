import { describe, expect, it } from 'vitest';
import { coordinatePoint, inferCoordinateColumns } from '../src/core/map-coordinates.ts';

describe('direct map coordinates', () => {
  it('infers taxonomy-compatible latitude and longitude headers with a valid pair', () => {
    expect(
      inferCoordinateColumns({
        columns: ['listing_id', 'Latitude', 'decimal_longitude'],
        rows: [
          { listing_id: 1, Latitude: '40.7128', decimal_longitude: '-74.006' },
          { listing_id: 2, Latitude: 91, decimal_longitude: -73.9 },
        ],
      }),
    ).toEqual({
      latitudeCol: 'Latitude',
      longitudeCol: 'decimal_longitude',
    });
  });

  it('does not infer generic x/y columns or named coordinates with no valid pair', () => {
    expect(
      inferCoordinateColumns({
        columns: ['x', 'y'],
        rows: [{ x: -74, y: 40 }],
      }),
    ).toBeNull();
    expect(
      inferCoordinateColumns({
        columns: ['lat', 'lng'],
        rows: [{ lat: 500, lng: 800 }],
      }),
    ).toBeNull();
  });

  it('returns GeoJSON coordinate order and rejects blanks, non-finite values, and bad ranges', () => {
    expect(coordinatePoint('12.97', '77.59')).toEqual([77.59, 12.97]);
    expect(coordinatePoint(-90, 180)).toEqual([180, -90]);
    expect(coordinatePoint('', 0)).toBeNull();
    expect(coordinatePoint(Number.NaN, 0)).toBeNull();
    expect(coordinatePoint(90.01, 0)).toBeNull();
    expect(coordinatePoint(0, -180.01)).toBeNull();
  });
});

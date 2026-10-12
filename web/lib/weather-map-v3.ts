export type WeatherMapV3Marker = Readonly<{ id: string; x: number; y: number; county: string | null }>;

export const WEATHER_MAP_V3_VIEWBOX = '0 0 619 847';
export const WEATHER_MAP_V3_CANVAS = { width: 619, height: 847 } as const;
export const WEATHER_MAP_V3_BADGE_RADIUS = 31.5;
export const WEATHER_MAP_V3_TEMPERATURE_LABEL_OFFSET_Y = 19;
export const WEATHER_MAP_V3_MAP_MATRIX = [1.3093575418994412, 0, 0, 1.4523664432256753, -241.52234636871503, -232.76315254925856] as const;

// Centers and the sole confirmed county link come from marker-anchors.json.
// Unknown marker-to-county relationships stay null until an authoritative mapping is supplied.
export const WEATHER_MAP_V3_MARKERS = [
  {
    "id": "weather-01",
    "x": 388.52,
    "y": 94.35,
    "county": null
  },
  {
    "id": "weather-02",
    "x": 461.82,
    "y": 82.32,
    "county": null
  },
  {
    "id": "weather-03",
    "x": 328.19,
    "y": 129.36,
    "county": null
  },
  {
    "id": "weather-04",
    "x": 534.37,
    "y": 123.29,
    "county": null
  },
  {
    "id": "weather-05",
    "x": 278.25,
    "y": 186.15,
    "county": null
  },
  {
    "id": "weather-06",
    "x": 240.23,
    "y": 240.25,
    "county": null
  },
  {
    "id": "weather-07",
    "x": 201.63,
    "y": 302.73,
    "county": null
  },
  {
    "id": "weather-08",
    "x": 156.75,
    "y": 380,
    "county": null
  },
  {
    "id": "weather-09",
    "x": 126.17,
    "y": 442.69,
    "county": null
  },
  {
    "id": "weather-10",
    "x": 120.09,
    "y": 507.25,
    "county": null
  },
  {
    "id": "weather-11",
    "x": 132.98,
    "y": 638.16,
    "county": null
  },
  {
    "id": "weather-12",
    "x": 160.61,
    "y": 718.78,
    "county": null
  },
  {
    "id": "weather-13",
    "x": 226.42,
    "y": 800.84,
    "county": null
  },
  {
    "id": "weather-14",
    "x": 518.99,
    "y": 320.48,
    "county": null
  },
  {
    "id": "weather-15",
    "x": 325,
    "y": 432,
    "county": "南投縣"
  },
  {
    "id": "weather-16",
    "x": 104.24,
    "y": 571.38,
    "county": null
  },
  {
    "id": "weather-17",
    "x": 554.82,
    "y": 207.14,
    "county": null
  },
  {
    "id": "weather-18",
    "x": 479.85,
    "y": 453.68,
    "county": null
  },
  {
    "id": "weather-19",
    "x": 370.14,
    "y": 707.43,
    "county": null
  }
] as const satisfies readonly WeatherMapV3Marker[];

export function projectCountySvgPointToWeatherMap(x: number, y: number): readonly [number, number] {
  const [scaleX, skewY, skewX, scaleY, translateX, translateY] = WEATHER_MAP_V3_MAP_MATRIX;
  return [scaleX * x + skewX * y + translateX, skewY * x + scaleY * y + translateY];
}

import type { CanonicalFixture } from './contracts';
import { createFixturePort, type FixturePort, type MapSource } from './fixture-port';
import { findRoute } from './routing';

export function createEnginePort(fixture: CanonicalFixture, mapSource: MapSource): FixturePort {
  const view = {
    ...fixture,
    buildings: [...mapSource.buildings],
    junctions: [...mapSource.junctions],
    road_segments: [...mapSource.road_segments],
  };
  // 东门与南门位于路网边缘，为校门标签留出边距。
  const port = createFixturePort(view, view, { padding: 54 });
  return { ...port, getRoute: (query) => findRoute(port.map, query) };
}

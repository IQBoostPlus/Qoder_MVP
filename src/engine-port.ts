import type { ActionAttempt, CanonicalFixture, RunEvent, SimSeconds } from './contracts';
import { createActionJudge, type ActionSubmissionInput } from './action-engine';
import { buildMapView, createFixturePort, snapshotRound, visibleReportsAt, windowAt, type FixturePort, type MapSource, type RoundSnapshot } from './fixture-port';
import type { RoundData } from './scenario-generation/contracts';
import { findRoute } from './routing';
import { scoreRound, type RoundScore } from './score-engine';

export interface EnginePort extends FixturePort {
  judgeAction(input: ActionSubmissionInput): ActionAttempt;
  snapshotRound(events: readonly RunEvent[], t: SimSeconds): RoundSnapshot;
  scoreRound(events: readonly RunEvent[]): RoundScore;
}

export function createEnginePort(fixture: RoundData | CanonicalFixture, mapSource: MapSource): EnginePort {
  const view = {
    ...fixture,
    buildings: [...mapSource.buildings],
    junctions: [...mapSource.junctions],
    road_segments: [...mapSource.road_segments],
  };
  // 东门与南门位于路网边缘，为校门标签留出边距。
  const port: FixturePort = 'runs' in fixture
    ? createFixturePort({ ...fixture, ...view }, view, { padding: 54 })
    : {
      map: buildMapView(mapSource, { padding: 54 }),
      visibleReportsAt: (t) => visibleReportsAt(view, t),
      windowAt: (id, t) => windowAt(view, id, t),
      replayTo: () => null,
      getScore: () => null,
      getRoute: (query) => findRoute(mapSource, query),
    };
  return {
    ...port,
    getRoute: (query) => findRoute(port.map, query),
    judgeAction: createActionJudge(view, port.map),
    snapshotRound: (events, t) => snapshotRound(view, events, t),
    scoreRound: (events) => scoreRound(view, events),
  };
}

import type { ActionAttempt, CanonicalFixture, RunEvent, SimSeconds } from './contracts';
import { createActionJudge, type ActionSubmissionInput } from './action-engine';
import { createFixturePort, snapshotRound, type FixturePort, type MapSource, type RoundSnapshot } from './fixture-port';
import { findRoute } from './routing';
import { scoreRound, type RoundScore } from './score-engine';

export interface EnginePort extends FixturePort {
  judgeAction(input: ActionSubmissionInput): ActionAttempt;
  snapshotRound(events: readonly RunEvent[], t: SimSeconds): RoundSnapshot;
  scoreRound(events: readonly RunEvent[]): RoundScore;
}

export function createEnginePort(fixture: CanonicalFixture, mapSource: MapSource): EnginePort {
  const view = {
    ...fixture,
    buildings: [...mapSource.buildings],
    junctions: [...mapSource.junctions],
    road_segments: [...mapSource.road_segments],
  };
  // 东门与南门位于路网边缘，为校门标签留出边距。
  const port = createFixturePort(view, view, { padding: 54 });
  return {
    ...port,
    getRoute: (query) => findRoute(port.map, query),
    judgeAction: createActionJudge(view, port.map),
    snapshotRound: (events, t) => snapshotRound(view, events, t),
    scoreRound: (events) => scoreRound(view, events),
  };
}

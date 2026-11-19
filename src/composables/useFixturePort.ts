import fixtureJson from '../../fixtures/canonical-run.json';
import mapJson from '../../fixtures/campus-map.json';
import type { CanonicalFixture } from '../contracts';
import { createEnginePort, type EnginePort } from '../engine-port';
import type { MapSource } from '../fixture-port';

// JSON 导入的推断类型会把字面量联合拓宽为 string，这里按 A 校验器同款口径断言为契约类型。
const fixture = fixtureJson as unknown as CanonicalFixture;
const campusMap = mapJson as MapSource;

let singleton: EnginePort | null = null;

export function useFixturePort(): EnginePort {
  singleton ??= createEnginePort(fixture, campusMap);
  return singleton;
}

export function useFixtureData(): CanonicalFixture {
  return fixture;
}

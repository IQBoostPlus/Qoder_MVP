import fixtureJson from '../../fixtures/canonical-run.json';
import type { CanonicalFixture } from '../contracts';
import { createFixturePort, type FixturePort } from '../fixture-port';

// JSON 导入的推断类型会把字面量联合拓宽为 string，这里按 A 校验器同款口径断言为契约类型。
const fixture = fixtureJson as unknown as CanonicalFixture;

let singleton: FixturePort | null = null;

export function useFixturePort(): FixturePort {
  singleton ??= createFixturePort(fixture);
  return singleton;
}

export function useFixtureData(): CanonicalFixture {
  return fixture;
}
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const verificationDir = process.argv[2];
assert.ok(verificationDir, '请传入安装 @electric-sql/pglite 的验证目录');
const require = createRequire(import.meta.url);
const engine = require.resolve('@electric-sql/pglite', { paths: [verificationDir] });
const { PGlite } = await import(pathToFileURL(engine).href);
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const campus = JSON.parse(read('../fixtures/campus-map.json'));
const db = new PGlite();

try {
  const { rows: [version] } = await db.query('SELECT version()');
  console.log(version.version);
  await db.exec('CREATE SCHEMA app');
  await db.transaction(async (tx) => {
    await tx.exec(read('../db/migrations/d2-campus-app.sql'));
    for (const building of campus.buildings) {
      await tx.query(`
        INSERT INTO app.campus_buildings
          (id, name, zone, category, floors, capacity, risk_tag, polygon_json, adjacency_json)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb)
      `, [building.id, building.name, building.zone, building.category, building.floors,
        building.capacity, building.risk_tag, JSON.stringify(building.polygon), JSON.stringify(building.adjacency)]);
    }
    for (const road of campus.road_segments) {
      await tx.query(`
        INSERT INTO app.road_segments
          (id, name, from_node_id, to_node_id, geometry_json, blocked, hazard, block_reason)
        VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)
      `, [road.id, road.name, road.from, road.to, JSON.stringify(road.geometry),
        Number(road.blocked), road.hazard, road.block_reason]);
    }
  });

  const { rows: tables } = await db.query(`
    SELECT table_name FROM information_schema.tables WHERE table_schema = 'app' ORDER BY table_name
  `);
  assert.deepEqual(tables.map(({ table_name }) => table_name), [
    'action_catalog', 'campus_buildings', 'disaster_templates', 'road_segments',
    'run_events', 'runs', 'scenarios', 'ugc_reports',
  ]);
  const { rows: buildings } = await db.query('SELECT * FROM app.campus_buildings');
  const { rows: roads } = await db.query('SELECT * FROM app.road_segments');
  const compare = (a, b) => a.id < b.id ? -1 : Number(a.id > b.id);
  assert.deepEqual(buildings.map(({ created_at, is_training, polygon_json, adjacency_json, ...building }) => {
    assert.equal(is_training, 1);
    assert.ok(created_at instanceof Date && Number.isFinite(created_at.getTime()));
    return { ...building, polygon: polygon_json, adjacency: adjacency_json };
  }).sort(compare), [...campus.buildings].sort(compare));
  assert.deepEqual(roads.map(({ updated_at, is_training, from_node_id, to_node_id, geometry_json, blocked, ...road }) => {
    assert.equal(is_training, 1);
    assert.ok(updated_at instanceof Date && Number.isFinite(updated_at.getTime()));
    return { ...road, from: from_node_id, to: to_node_id, geometry: geometry_json, blocked: Boolean(blocked) };
  }).sort(compare), [...campus.road_segments].sort(compare));

  const names = new Map(campus.junctions.map(({ id, name }) => [id, name]));
  const nodeIds = new Set([...buildings.map(({ id }) => id), ...names.keys()]);
  const knownGates = new Set();
  for (const { from_node_id, to_node_id } of roads) {
    for (const id of [from_node_id, to_node_id]) {
      assert.ok(nodeIds.has(id), id);
      if (names.has(id)) knownGates.add(id);
    }
  }
  assert.deepEqual([...knownGates].sort(), [...names.keys()].sort());
  await assert.rejects(db.query('INSERT INTO app.campus_buildings SELECT * FROM app.campus_buildings LIMIT 1'), { code: '23505' });
  await assert.rejects(db.query("UPDATE app.road_segments SET geometry_json = NULL"), { code: '23502' });
  const { rows: [action] } = await db.query(`
    INSERT INTO app.action_catalog
      (id, name, target_kind, critical, weight, duration_sim, resource_id, preconditions_json)
    VALUES ('test', 'test', 'building', 0, '1.25'::jsonb, '2.5'::jsonb, 'test', '[]'::jsonb)
    RETURNING weight, duration_sim
  `);
  assert.deepEqual(action, { weight: 1.25, duration_sim: 2.5 });
  console.log(`app schema: ${tables.length} tables; all columns round-tripped for ${buildings.length} buildings, ${roads.length} roads`);
  console.log('Fixture ' + campus.schema_version + ' resolves persisted gate references: ' + [...knownGates].sort().map((id) => id + '=' + names.get(id)).join(', '));
  console.log('Primary key, required geometry and fractional JSONB values verified');
  console.log('D2 local PostgreSQL map round-trip PASSED');
} finally {
  await db.close();
}

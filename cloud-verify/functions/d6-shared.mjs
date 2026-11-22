var FixturePortError = class extends Error {
	code;
	object_id;
	constructor(code, objectId, detail) {
		super(`${code}: ${objectId}: ${detail}`);
		this.name = "FixturePortError";
		this.code = code;
		this.object_id = objectId;
	}
};
function samePoint(a, b) {
	return Math.abs(a.x - b.x) <= 1e-9 && Math.abs(a.y - b.y) <= 1e-9;
}
function assertPoint(point, roadId) {
	if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new FixturePortError("MAP_INVALID_GEOMETRY", roadId, "折线包含非有限坐标");
}
function roadLengthPx(road) {
	if (road.geometry.length < 2) throw new FixturePortError("MAP_INVALID_GEOMETRY", road.id, "折线少于 2 个点");
	let length = 0;
	let previous;
	for (const point of road.geometry) {
		if (!point) throw new FixturePortError("MAP_INVALID_GEOMETRY", road.id, "折线缺少点");
		assertPoint(point, road.id);
		if (previous) length += Math.hypot(point.x - previous.x, point.y - previous.y);
		previous = point;
	}
	if (!Number.isFinite(length)) throw new FixturePortError("MAP_INVALID_GEOMETRY", road.id, "路段折线长度必须有限");
	if (length === 0) throw new FixturePortError("MAP_ZERO_LENGTH", road.id, "路段折线长度必须大于 0");
	return length;
}
function buildMapView(source, options = {}) {
	const padding = options.padding ?? 20;
	if (!Number.isFinite(padding) || padding < 0) throw new FixturePortError("MAP_INVALID_GEOMETRY", "view_box", "留白必须是非负有限数");
	const nodeIds = /* @__PURE__ */ new Set();
	for (const building of source.buildings) {
		if (nodeIds.has(building.id)) throw new FixturePortError("MAP_DUPLICATE_NODE_ID", building.id, "楼栋 id 重复");
		nodeIds.add(building.id);
	}
	for (const junction of source.junctions) {
		if (nodeIds.has(junction.id)) throw new FixturePortError("MAP_DUPLICATE_NODE_ID", junction.id, "路口 id 与楼栋或其他路口重复");
		nodeIds.add(junction.id);
	}
	const junctionIds = new Set(source.junctions.map((junction) => junction.id));
	const junctionPositions = /* @__PURE__ */ new Map();
	const roadIds = /* @__PURE__ */ new Set();
	const roadLengths = /* @__PURE__ */ new Map();
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	function includePoint(point, ownerId) {
		assertPoint(point, ownerId);
		minX = Math.min(minX, point.x);
		minY = Math.min(minY, point.y);
		maxX = Math.max(maxX, point.x);
		maxY = Math.max(maxY, point.y);
	}
	for (const building of source.buildings) for (const point of building.polygon) includePoint(point, building.id);
	function recordJunctionPosition(junctionId, point, roadId) {
		const existing = junctionPositions.get(junctionId);
		if (existing && !samePoint(existing, point)) throw new FixturePortError("MAP_ENDPOINT_MISMATCH", junctionId, `路口 ${junctionId} 在路段 ${roadId} 的端点与先前引用不一致`);
		if (!existing) junctionPositions.set(junctionId, {
			x: point.x,
			y: point.y
		});
	}
	for (const road of source.road_segments) {
		if (roadIds.has(road.id)) throw new FixturePortError("MAP_DUPLICATE_ROAD_ID", road.id, "路段 id 重复");
		roadIds.add(road.id);
		if (!nodeIds.has(road.from)) throw new FixturePortError("MAP_UNKNOWN_ENDPOINT", road.id, `起点 ${road.from} 不存在`);
		if (!nodeIds.has(road.to)) throw new FixturePortError("MAP_UNKNOWN_ENDPOINT", road.id, `终点 ${road.to} 不存在`);
		if (road.from === road.to) throw new FixturePortError("MAP_SAME_ENDPOINTS", road.id, "起点与终点相同");
		const length = roadLengthPx(road);
		for (const point of road.geometry) includePoint(point, road.id);
		const first = road.geometry[0];
		const last = road.geometry[road.geometry.length - 1];
		if (!first || !last) throw new FixturePortError("MAP_INVALID_GEOMETRY", road.id, "折线缺少端点");
		if (junctionIds.has(road.from)) recordJunctionPosition(road.from, first, road.id);
		if (junctionIds.has(road.to)) recordJunctionPosition(road.to, last, road.id);
		roadLengths.set(road.id, length);
	}
	for (const junction of source.junctions) if (!junctionPositions.has(junction.id)) throw new FixturePortError("MAP_JUNCTION_UNREFERENCED", junction.id, "路口未被任何路段引用");
	if (![
		minX,
		minY,
		maxX,
		maxY
	].every(Number.isFinite)) throw new FixturePortError("MAP_INVALID_GEOMETRY", "view_box", "没有可用于计算视图的坐标");
	const bounds = {
		min_x: minX,
		min_y: minY,
		max_x: maxX,
		max_y: maxY
	};
	const viewBox = {
		x: minX - padding,
		y: minY - padding,
		width: maxX - minX + padding * 2,
		height: maxY - minY + padding * 2
	};
	return {
		buildings: source.buildings,
		junctions: source.junctions,
		road_segments: source.road_segments,
		junction_positions: Object.fromEntries(junctionPositions),
		road_lengths_px: Object.fromEntries(roadLengths),
		bounds,
		view_box: viewBox,
		view_box_svg: `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`
	};
}
function visibleReportsAt(fixture, t) {
	if (!Number.isFinite(t)) return [];
	return fixture.ugc_reports.map((report, index) => ({
		report,
		index
	})).filter(({ report }) => report.appears_at_sim <= t).sort((a, b) => a.report.appears_at_sim - b.report.appears_at_sim || a.index - b.index).map(({ report }) => report);
}
function windowAt(fixture, reportId, t) {
	const report = fixture.ugc_reports.find((candidate) => candidate.id === reportId);
	if (!report || !Number.isFinite(t) || t < report.appears_at_sim) return null;
	return report.judgment_windows.find((window) => t >= window.from_sim && (window.to_sim === null || t < window.to_sim)) ?? null;
}
const isActionEvent = (event) => event.kind === "action";
const isVerdictEvent = (event) => event.kind === "verdict";
const isSortEvent = (event) => event.kind === "sort";
function actionCompletedBy(action, t) {
	return action.status === "accepted" && action.completed_at_sim !== null && action.completed_at_sim <= t;
}
function scenarioEventsAt(scenario, t) {
	return scenario.nodes.filter((node) => node.t_sim <= t).sort((a, b) => a.t_sim - b.t_sim).flatMap((node) => node.events.map((event) => ({
		node_id: node.id,
		t_sim: node.t_sim,
		event
	})));
}
function replayTo(fixture, runId, options = {}) {
	const run = fixture.runs.find((candidate) => candidate.run_id === runId);
	if (!run) return null;
	if (options.seq !== void 0 && (!Number.isInteger(options.seq) || options.seq < 0)) throw new FixturePortError("REPLAY_INVALID_CUT", "seq", "序号必须是非负整数");
	if (options.t_sim !== void 0 && (!Number.isFinite(options.t_sim) || options.t_sim < 0)) throw new FixturePortError("REPLAY_INVALID_CUT", "t_sim", "时刻必须是非负有限数");
	const seqLimit = options.seq ?? Infinity;
	const tLimit = options.t_sim ?? Infinity;
	const includedEvents = run.events.filter((event) => event.seq <= seqLimit && event.t_sim <= tLimit).sort((a, b) => a.seq - b.seq).map((event) => structuredClone(event));
	const lastIncluded = includedEvents[includedEvents.length - 1];
	const lastIncludedT = lastIncluded ? lastIncluded.t_sim : 0;
	let snapshotT;
	if (options.seq === void 0 && options.t_sim === void 0) snapshotT = fixture.scenario.t_end;
	else if (options.t_sim === void 0) snapshotT = lastIncludedT;
	else if (options.seq === void 0) snapshotT = Math.min(options.t_sim, fixture.scenario.t_end);
	else snapshotT = Math.min(options.t_sim, lastIncludedT, fixture.scenario.t_end);
	return {
		...deriveRoundState(fixture, includedEvents, {
			requested_seq: options.seq ?? null,
			requested_t_sim: options.t_sim ?? null,
			applied_t_sim: snapshotT
		}, run.resource_occupancy),
		run_id: run.run_id,
		scenario_id: run.scenario_id,
		branch: run.branch,
		playback_speed: run.playback_speed
	};
}
/** 学员轮次没有示例 run_id/branch；查看时刻之外的操作和效果不可见。 */
function snapshotRound(source, events, t) {
	if (!Number.isFinite(t) || t < 0) throw new FixturePortError("REPLAY_INVALID_CUT", "t_sim", "时刻必须是非负有限数");
	const snapshotT = Math.min(t, source.scenario.t_end);
	const included = events.filter((event) => event.t_sim <= snapshotT).sort((a, b) => a.seq - b.seq);
	return deriveRoundState(source, structuredClone(included), {
		requested_seq: null,
		requested_t_sim: t,
		applied_t_sim: snapshotT
	});
}
function deriveRoundState(source, includedEvents, cut, recordedOccupancy) {
	const snapshotT = cut.applied_t_sim;
	const scenarioEvents = structuredClone(scenarioEventsAt(source.scenario, snapshotT));
	const latestByReport = /* @__PURE__ */ new Map();
	const actions = [];
	let sorting = null;
	for (const event of includedEvents) if (isVerdictEvent(event)) latestByReport.set(event.payload.report_id, event.payload);
	else if (isActionEvent(event)) actions.push(event.payload);
	else if (isSortEvent(event)) sorting = event.payload;
	const latestVerdicts = [...latestByReport.values()].sort((a, b) => a.seq - b.seq);
	const includedActionSeqs = new Set(actions.map((action) => action.seq));
	const occupancy = recordedOccupancy ? recordedOccupancy.filter((usage) => includedActionSeqs.has(usage.action_seq)).map((usage) => structuredClone(usage)) : actions.flatMap((action) => action.status === "accepted" && action.resource_usage ? [action.resource_usage] : []);
	const activeOccupancy = occupancy.filter((usage) => usage.from_sim <= snapshotT && (usage.to_sim === null || snapshotT < usage.to_sim));
	const roads = source.road_segments.map((road) => {
		let hazard = road.hazard;
		let hazardAt = hazard === null ? null : 0;
		let hazardDescription = null;
		for (const entry of scenarioEvents) if (entry.event.type === "road_hazard" && entry.event.road_id === road.id) {
			hazard = entry.event.hazard;
			hazardAt = entry.t_sim;
			hazardDescription = entry.event.description;
		}
		let closed = road.blocked;
		let closedAt = closed ? 0 : null;
		let closedBy = null;
		for (const action of actions) if (action.action_id === "A5" && action.target_id === road.id && actionCompletedBy(action, snapshotT)) {
			if (closedAt === null || action.completed_at_sim >= closedAt) {
				closed = true;
				closedAt = action.completed_at_sim;
				closedBy = action.seq;
			}
		}
		return {
			road_id: road.id,
			name: road.name,
			hazard,
			hazard_at_sim: hazardAt,
			hazard_description: hazardDescription,
			formally_closed: closed,
			closed_at_sim: closedAt,
			closed_by_action_seq: closedBy,
			block_reason: road.block_reason
		};
	});
	const powerCuts = /* @__PURE__ */ new Map();
	for (const action of actions) if (action.action_id === "A6" && actionCompletedBy(action, snapshotT)) {
		const previous = powerCuts.get(action.target_id);
		if (!previous || action.completed_at_sim < previous.at_sim) powerCuts.set(action.target_id, {
			building_id: action.target_id,
			at_sim: action.completed_at_sim,
			seq: action.seq
		});
	}
	return {
		scenario_id: source.scenario.id,
		t_sim: snapshotT,
		cut,
		scenario_events: scenarioEvents,
		events: includedEvents,
		latest_verdicts: latestVerdicts,
		actions,
		sorting,
		resource_occupancy: occupancy,
		active_resource_occupancy: activeOccupancy,
		roads,
		power_cuts: [...powerCuts.values()]
	};
}
function canonicalJson(value) {
	if (value === null || typeof value !== "object") {
		const encoded = JSON.stringify(value);
		return encoded === void 0 ? "undefined" : encoded;
	}
	if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
	const record = value;
	return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}
/**
* 仅对完整匹配的基线流水返回 expected_scores。
* 省略 currentEvents 只用于明确载入的原始样例；交互中必须传入当前流水。
*/
function getScore(fixture, runId, currentEvents) {
	const run = fixture.runs.find((candidate) => candidate.run_id === runId);
	const expected = fixture.expected_scores[runId];
	if (!run || !expected) return null;
	if (currentEvents === void 0) return structuredClone(expected);
	if (canonicalJson(currentEvents) !== canonicalJson(run.events)) return null;
	return structuredClone(expected);
}
/** D1-v2 静态模式没有路径数据；null 表示待引擎接入，不表示不可达。 */
function getRoute(_query) {
	return null;
}
function createFixturePort(fixture, mapSource = fixture, mapOptions = {}) {
	return {
		map: buildMapView(mapSource, mapOptions),
		visibleReportsAt: (t) => visibleReportsAt(fixture, t),
		windowAt: (reportId, t) => windowAt(fixture, reportId, t),
		replayTo: (runId, options) => replayTo(fixture, runId, options),
		getScore: (runId, currentEvents) => getScore(fixture, runId, currentEvents),
		getRoute
	};
}
// src/action-engine.ts
var ActionEngineError = class extends Error {
	code;
	constructor(code, detail) {
		super(`${code}: ${detail}`);
		this.code = code;
		this.name = "ActionEngineError";
	}
};
function resourceFits(candidate, attempts, capacity) {
	if (candidate.from_sim === candidate.to_sim) return true;
	const checkpoints = /* @__PURE__ */ new Map([[candidate.from_sim, candidate.units]]);
	function add(t, delta) {
		checkpoints.set(t, (checkpoints.get(t) ?? 0) + delta);
	}
	for (const action of attempts) {
		const usage = action.resource_usage;
		if (action.status !== "accepted" || !usage || usage.resource_id !== candidate.resource_id) continue;
		const start = Math.max(candidate.from_sim, usage.from_sim);
		const end = Math.min(candidate.to_sim, usage.to_sim ?? Infinity);
		if (start >= end) continue;
		add(start, usage.units);
		add(end, -usage.units);
	}
	let active = 0;
	for (const [, delta] of [...checkpoints].sort(([a], [b]) => a - b)) {
		active += delta;
		if (active > capacity) return false;
	}
	return true;
}
function createActionJudge({ scenario, action_catalog }, map) {
	const catalog = new Map(action_catalog.map((action) => [action.id, action]));
	const resources = new Map(scenario.resources.map((resource) => [resource.id, resource]));
	const nodeTimes = new Set(scenario.nodes.map((node) => node.t_sim));
	const targets = new Map([
		...map.buildings.map(({ id }) => [id, "building"]),
		...map.road_segments.map(({ id }) => [id, "road"]),
		...map.junctions.map(({ id }) => [id, "junction"])
	]);
	const initiallyClosed = new Set(map.road_segments.filter((road) => road.blocked).map((road) => road.id));
	function invalidConfig(detail) {
		throw new ActionEngineError("INVALID_ACTION_CONFIG", detail);
	}
	function compilePrecondition(action, rule) {
		const reason = rule.description;
		switch (rule.type) {
			case "requires_completed_action": {
				const required = rule.action_id && catalog.get(rule.action_id);
				if (!required || required.target_kind !== action.target_kind) return invalidConfig(`${action.id} 的前置动作不存在或对象类型不匹配`);
				return ({ completed }) => completed.some((item) => item.action_id === required.id) ? null : {
					code: "PRECONDITION_NOT_MET",
					reason
				};
			}
			case "requires_disaster_annotation": return ({ input }) => scenarioEventsAt(scenario, input.submitted_at_sim).some(({ event }) => event.type === "disaster_confirm" && event.building_id === input.target_id && event.adds_disaster_annotation) ? null : {
				code: "TARGET_NOT_APPLICABLE",
				reason
			};
			case "not_already_completed": return ({ action, completed }) => completed.some((item) => item.action_id === action.id) ? {
				code: "STATUS_CONFLICT",
				reason
			} : null;
			case "not_powered_off": return ({ completed }) => completed.some((item) => item.action_id === "A6") ? {
				code: "STATUS_CONFLICT",
				reason
			} : null;
			case "road_not_closed": return ({ input, completed }) => initiallyClosed.has(input.target_id) || completed.some((item) => item.action_id === "A5") ? {
				code: "STATUS_CONFLICT",
				reason
			} : null;
			default: return invalidConfig(`${action.id} 声明了未知前置条件 ${rule.type}`);
		}
	}
	if (catalog.size !== action_catalog.length || resources.size !== scenario.resources.length) invalidConfig("动作或资源 ID 重复");
	const compiled = new Map(action_catalog.map((action) => {
		const resource = resources.get(action.resource_id);
		if (!resource || !Number.isSafeInteger(resource.capacity) || resource.capacity < 0) return invalidConfig(`${action.id} 对应的资源 ${action.resource_id} 不存在或容量非法`);
		if (!Number.isSafeInteger(action.resource_units) || action.resource_units <= 0 || !Number.isFinite(action.duration_sim) || action.duration_sim < 0) return invalidConfig(`${action.id} 的资源数量或耗时非法`);
		if (action.target_kind !== "building" && action.target_kind !== "road") return invalidConfig(`${action.id} 的目标类型非法`);
		return [action.id, {
			action,
			resource,
			checks: action.preconditions.map((rule) => compilePrecondition(action, rule))
		}];
	}));
	return (input) => {
		const { action_id, target_id, submitted_at_sim, seq, prior_events } = input;
		const definition = compiled.get(action_id);
		if (!definition) throw new ActionEngineError("UNKNOWN_ACTION", `未知动作 ${action_id}`);
		if (!Number.isFinite(submitted_at_sim) || submitted_at_sim < 0 || submitted_at_sim > scenario.t_end || !nodeTimes.has(submitted_at_sim)) throw new ActionEngineError("INVALID_ACTION_TIME", `提交时刻 ${submitted_at_sim} 必须是剧本回合节点`);
		let previousSeq = 0;
		let previousTime = 0;
		const attempts = [];
		for (const event of prior_events) {
			if (!Number.isSafeInteger(event.seq) || event.seq <= previousSeq || event.payload.seq !== event.seq) throw new ActionEngineError("INVALID_ACTION_SEQUENCE", `历史序号重复、倒序或与载荷不一致：${event.seq}`);
			if (!nodeTimes.has(event.t_sim) || event.t_sim < previousTime || event.t_sim > submitted_at_sim) throw new ActionEngineError("INVALID_ACTION_TIME", `历史序号 ${event.seq} 的时刻无效或晚于提交时刻`);
			previousSeq = event.seq;
			previousTime = event.t_sim;
			if (event.kind === "action") attempts.push(event.payload);
		}
		if (!Number.isSafeInteger(seq) || seq <= previousSeq) throw new ActionEngineError("INVALID_ACTION_SEQUENCE", `提交序号 ${seq} 必须是大于历史末序号的整数`);
		const { action, resource, checks } = definition;
		const sameTarget = attempts.filter((item) => item.target_id === target_id);
		const core = {
			seq,
			attempt: sameTarget.filter((item) => item.action_id === action_id).length + 1,
			action_id,
			target_id,
			submitted_at_sim,
			duration_sim: action.duration_sim
		};
		function reject(code, reason) {
			return {
				...core,
				status: "rejected",
				reject_reason_code: code,
				reject_reason: reason,
				completed_at_sim: null,
				resource_usage: null
			};
		}
		const targetKind = targets.get(target_id);
		if (!targetKind) return reject("UNKNOWN_TARGET", `找不到目标 ${target_id}`);
		if (targetKind !== action.target_kind) return reject("TARGET_NOT_APPLICABLE", `${action.name}的目标须为${action.target_kind === "building" ? "楼栋" : "路段"}`);
		const completed = sameTarget.filter((item) => actionCompletedBy(item, submitted_at_sim));
		for (const check of checks) {
			const failure = check({
				input,
				action,
				completed
			});
			if (failure) return reject(failure.code, failure.reason);
		}
		const completion = submitted_at_sim + action.duration_sim;
		if (!Number.isFinite(completion)) invalidConfig(`${action.id} 的完成时刻超出可表示范围`);
		const usage = {
			resource_id: resource.id,
			units: action.resource_units,
			action_seq: seq,
			from_sim: submitted_at_sim,
			to_sim: completion
		};
		if (!resourceFits(usage, attempts, resource.capacity)) return reject("RESOURCE_UNAVAILABLE", `${resource.name}在预计执行区间内余量不足（需要 ${action.resource_units} ${resource.unit}）`);
		return {
			...core,
			status: "accepted",
			reject_reason_code: null,
			reject_reason: null,
			completed_at_sim: completion,
			resource_usage: usage
		};
	};
}
// fixtures/campus-map.json
var campus_map_default = {
	schema_version: "d2-1",
	generated_at: "2026-11-18",
	buildings: [
		{
			"id": "N7",
			"name": "萃园 7 幢（北 7）",
			"zone": "萃园·北区",
			"category": "dormitory",
			"floors": 5,
			"capacity": 500,
			"risk_tag": "夜间人员密集、用电",
			"polygon": [
				{
					"x": 220,
					"y": 460
				},
				{
					"x": 380,
					"y": 460
				},
				{
					"x": 380,
					"y": 580
				},
				{
					"x": 220,
					"y": 580
				}
			],
			"adjacency": ["N1", "SA"]
		},
		{
			"id": "N1",
			"name": "萃园 1 幢（北 1）",
			"zone": "萃园·北区",
			"category": "dormitory",
			"floors": 5,
			"capacity": 500,
			"risk_tag": "夜间人员密集、用电",
			"polygon": [
				{
					"x": 60,
					"y": 420
				},
				{
					"x": 180,
					"y": 420
				},
				{
					"x": 180,
					"y": 540
				},
				{
					"x": 60,
					"y": 540
				}
			],
			"adjacency": ["N2", "N7"]
		},
		{
			"id": "N2",
			"name": "萃园 2 幢（北 2）",
			"zone": "萃园·北区",
			"category": "dormitory",
			"floors": 5,
			"capacity": 500,
			"risk_tag": "夜间人员密集、用电",
			"polygon": [
				{
					"x": 60,
					"y": 280
				},
				{
					"x": 180,
					"y": 280
				},
				{
					"x": 180,
					"y": 380
				},
				{
					"x": 60,
					"y": 380
				}
			],
			"adjacency": ["CN1", "N1"]
		},
		{
			"id": "N11",
			"name": "萃园 11 幢（北 11）",
			"zone": "萃园·北区",
			"category": "dormitory",
			"floors": 5,
			"capacity": 400,
			"risk_tag": "夜间人员密集",
			"polygon": [
				{
					"x": 380,
					"y": 60
				},
				{
					"x": 500,
					"y": 60
				},
				{
					"x": 500,
					"y": 180
				},
				{
					"x": 380,
					"y": 180
				}
			],
			"adjacency": ["CN2", "SAC"]
		},
		{
			"id": "E1",
			"name": "润园 1 幢（东 1）",
			"zone": "润园·东区",
			"category": "dormitory",
			"floors": 5,
			"capacity": 500,
			"risk_tag": "夜间人员密集",
			"polygon": [
				{
					"x": 1140,
					"y": 270
				},
				{
					"x": 1285,
					"y": 270
				},
				{
					"x": 1285,
					"y": 370
				},
				{
					"x": 1140,
					"y": 370
				}
			],
			"adjacency": ["CE1", "E7"]
		},
		{
			"id": "E7",
			"name": "润园 7 幢（东 7）",
			"zone": "润园·东区",
			"category": "dormitory",
			"floors": 5,
			"capacity": 600,
			"risk_tag": "男女分区混住、疏散组织复杂",
			"polygon": [
				{
					"x": 1140,
					"y": 110
				},
				{
					"x": 1285,
					"y": 110
				},
				{
					"x": 1285,
					"y": 210
				},
				{
					"x": 1140,
					"y": 210
				}
			],
			"adjacency": ["E1"]
		},
		{
			"id": "CN1",
			"name": "萃园一食堂（北一）",
			"zone": "萃园·北区",
			"category": "canteen",
			"floors": 3,
			"capacity": 800,
			"risk_tag": "燃气、就餐高峰人流",
			"polygon": [
				{
					"x": 220,
					"y": 260
				},
				{
					"x": 360,
					"y": 260
				},
				{
					"x": 360,
					"y": 380
				},
				{
					"x": 220,
					"y": 380
				}
			],
			"adjacency": [
				"CN2",
				"GYM",
				"N2"
			]
		},
		{
			"id": "CN2",
			"name": "萃园二食堂（北二）",
			"zone": "萃园·北区",
			"category": "canteen",
			"floors": 3,
			"capacity": 800,
			"risk_tag": "燃气",
			"polygon": [
				{
					"x": 430,
					"y": 260
				},
				{
					"x": 570,
					"y": 260
				},
				{
					"x": 570,
					"y": 380
				},
				{
					"x": 430,
					"y": 380
				}
			],
			"adjacency": [
				"CN1",
				"N11",
				"SAC"
			]
		},
		{
			"id": "CE1",
			"name": "润园一食堂（东一）",
			"zone": "润园·东区",
			"category": "canteen",
			"floors": 3,
			"capacity": 800,
			"risk_tag": "燃气、清真窗口",
			"polygon": [
				{
					"x": 1140,
					"y": 435
				},
				{
					"x": 1285,
					"y": 435
				},
				{
					"x": 1285,
					"y": 555
				},
				{
					"x": 1140,
					"y": 555
				}
			],
			"adjacency": [
				"E1",
				"EA",
				"G8"
			]
		},
		{
			"id": "GYM",
			"name": "天健苑·体育中心",
			"zone": "天健苑·西部",
			"category": "gymnasium",
			"floors": null,
			"capacity": 3e3,
			"risk_tag": "散场人流对冲、通讯中断",
			"polygon": [
				{
					"x": 700,
					"y": 240
				},
				{
					"x": 880,
					"y": 240
				},
				{
					"x": 880,
					"y": 380
				},
				{
					"x": 700,
					"y": 380
				}
			],
			"adjacency": [
				"CN1",
				"LIB",
				"SAC"
			]
		},
		{
			"id": "SY",
			"name": "基础实验楼",
			"zone": "教学区",
			"category": "laboratory",
			"floors": 5,
			"capacity": 600,
			"risk_tag": "危化品、通风",
			"polygon": [
				{
					"x": 680,
					"y": 640
				},
				{
					"x": 835,
					"y": 640
				},
				{
					"x": 835,
					"y": 750
				},
				{
					"x": 680,
					"y": 750
				}
			],
			"adjacency": [
				"ADM",
				"G3",
				"SA"
			]
		},
		{
			"id": "G3",
			"name": "工程实践中心 3 号楼",
			"zone": "至行苑",
			"category": "laboratory",
			"floors": 5,
			"capacity": 400,
			"risk_tag": "大功率设备、用电",
			"polygon": [
				{
					"x": 930,
					"y": 640
				},
				{
					"x": 1085,
					"y": 640
				},
				{
					"x": 1085,
					"y": 750
				},
				{
					"x": 930,
					"y": 750
				}
			],
			"adjacency": [
				"EA",
				"G8",
				"SY"
			]
		},
		{
			"id": "G8",
			"name": "工程实践中心 8 号楼",
			"zone": "至行苑",
			"category": "laboratory",
			"floors": 5,
			"capacity": 400,
			"risk_tag": "大功率设备、用电",
			"polygon": [
				{
					"x": 1155,
					"y": 640
				},
				{
					"x": 1310,
					"y": 640
				},
				{
					"x": 1310,
					"y": 750
				},
				{
					"x": 1155,
					"y": 750
				}
			],
			"adjacency": [
				"CE1",
				"CLI",
				"G3"
			]
		},
		{
			"id": "LIB",
			"name": "文博苑·逸夫图书信息中心",
			"zone": "文博苑·中部",
			"category": "library",
			"floors": 5,
			"capacity": 2500,
			"risk_tag": "密集藏书、用电",
			"polygon": [
				{
					"x": 700,
					"y": 440
				},
				{
					"x": 900,
					"y": 440
				},
				{
					"x": 900,
					"y": 580
				},
				{
					"x": 700,
					"y": 580
				}
			],
			"adjacency": ["EA", "GYM"]
		},
		{
			"id": "ADM",
			"name": "至勤楼·行政中心",
			"zone": "南部",
			"category": "office",
			"floors": 5,
			"capacity": 300,
			"risk_tag": "变电（模拟设定）",
			"polygon": [
				{
					"x": 560,
					"y": 815
				},
				{
					"x": 720,
					"y": 815
				},
				{
					"x": 720,
					"y": 905
				},
				{
					"x": 560,
					"y": 905
				}
			],
			"adjacency": ["CLI", "SY"]
		},
		{
			"id": "SA",
			"name": "南馆 A 座（顶部钟楼）",
			"zone": "学海苑",
			"category": "teaching",
			"floors": 5,
			"capacity": 1200,
			"risk_tag": "地标钟楼、夜间照明",
			"polygon": [
				{
					"x": 405,
					"y": 640
				},
				{
					"x": 585,
					"y": 640
				},
				{
					"x": 585,
					"y": 750
				},
				{
					"x": 405,
					"y": 750
				}
			],
			"adjacency": ["N7", "SY"]
		},
		{
			"id": "EA",
			"name": "东馆 A 座",
			"zone": "学海苑",
			"category": "teaching",
			"floors": 4,
			"capacity": 1200,
			"risk_tag": "大人流公共课",
			"polygon": [
				{
					"x": 920,
					"y": 410
				},
				{
					"x": 1080,
					"y": 410
				},
				{
					"x": 1080,
					"y": 525
				},
				{
					"x": 920,
					"y": 525
				}
			],
			"adjacency": [
				"CE1",
				"G3",
				"LIB",
				"WL"
			]
		},
		{
			"id": "WL",
			"name": "文理楼",
			"zone": "至和苑·东区",
			"category": "teaching",
			"floors": 5,
			"capacity": 800,
			"risk_tag": "院系办公",
			"polygon": [
				{
					"x": 925,
					"y": 240
				},
				{
					"x": 1080,
					"y": 240
				},
				{
					"x": 1080,
					"y": 355
				},
				{
					"x": 925,
					"y": 355
				}
			],
			"adjacency": ["EA"]
		},
		{
			"id": "CLI",
			"name": "门诊部",
			"zone": "校内",
			"category": "other",
			"floors": null,
			"capacity": 50,
			"risk_tag": "氧气瓶、伤员接收点",
			"polygon": [
				{
					"x": 925,
					"y": 815
				},
				{
					"x": 1065,
					"y": 815
				},
				{
					"x": 1065,
					"y": 905
				},
				{
					"x": 925,
					"y": 905
				}
			],
			"adjacency": ["ADM", "G8"]
		},
		{
			"id": "SAC",
			"name": "至馨苑·综合服务楼（北大活）",
			"zone": "至馨苑·北区",
			"category": "other",
			"floors": 2,
			"capacity": 600,
			"risk_tag": "活动人流、临时集合点",
			"polygon": [
				{
					"x": 540,
					"y": 85
				},
				{
					"x": 705,
					"y": 85
				},
				{
					"x": 705,
					"y": 190
				},
				{
					"x": 540,
					"y": 190
				}
			],
			"adjacency": [
				"CN2",
				"GYM",
				"N11"
			]
		}
	],
	junctions: [
		{
			"id": "GATE3",
			"name": "3 号门（近北区）",
			"kind": "gate"
		},
		{
			"id": "GATE4",
			"name": "4 号门（近东区）",
			"kind": "gate"
		},
		{
			"id": "GATES",
			"name": "南门（名义正门）",
			"kind": "gate"
		}
	],
	road_segments: [
		{
			"id": "R-N7E",
			"name": "北 7 东侧至 3 号门",
			"from": "N7",
			"to": "GATE3",
			"geometry": [{
				"x": 380,
				"y": 520
			}, {
				"x": 500,
				"y": 520
			}],
			"blocked": false,
			"hazard": null,
			"block_reason": null
		},
		{
			"id": "R-N7-N1",
			"name": "萃园 7 幢至 1 幢",
			"from": "N7",
			"to": "N1",
			"geometry": [
				{
					"x": 380,
					"y": 520
				},
				{
					"x": 220,
					"y": 500
				},
				{
					"x": 180,
					"y": 500
				}
			],
			"blocked": false,
			"hazard": null,
			"block_reason": null
		},
		{
			"id": "R-N1-N2",
			"name": "萃园 1 幢至 2 幢",
			"from": "N1",
			"to": "N2",
			"geometry": [
				{
					"x": 180,
					"y": 500
				},
				{
					"x": 120,
					"y": 420
				},
				{
					"x": 120,
					"y": 380
				}
			],
			"blocked": false,
			"hazard": null,
			"block_reason": null
		},
		{
			"id": "R-N2-CN1",
			"name": "萃园 2 幢至北一食堂",
			"from": "N2",
			"to": "CN1",
			"geometry": [
				{
					"x": 120,
					"y": 380
				},
				{
					"x": 180,
					"y": 330
				},
				{
					"x": 220,
					"y": 330
				},
				{
					"x": 360,
					"y": 330
				}
			],
			"blocked": false,
			"hazard": null,
			"block_reason": null
		},
		{
			"id": "R-CN1-CN2",
			"name": "北一食堂至北二食堂",
			"from": "CN1",
			"to": "CN2",
			"geometry": [{
				"x": 360,
				"y": 330
			}, {
				"x": 430,
				"y": 330
			}],
			"blocked": false,
			"hazard": null,
			"block_reason": null
		},
		{
			"id": "R-N11-CN2",
			"name": "北 11 至北二食堂",
			"from": "N11",
			"to": "CN2",
			"geometry": [
				{
					"x": 440,
					"y": 180
				},
				{
					"x": 440,
					"y": 260
				},
				{
					"x": 430,
					"y": 330
				}
			],
			"blocked": false,
			"hazard": null,
			"block_reason": null
		},
		{
			"id": "R-CN1-GYM",
			"name": "北区至体育中心（训练级简化）",
			"from": "CN1",
			"to": "GYM",
			"geometry": [
				{
					"x": 360,
					"y": 330
				},
				{
					"x": 360,
					"y": 300
				},
				{
					"x": 390,
					"y": 210
				},
				{
					"x": 650,
					"y": 210
				},
				{
					"x": 700,
					"y": 300
				}
			],
			"blocked": false,
			"hazard": null,
			"block_reason": null
		},
		{
			"id": "R-GYM-LIB",
			"name": "体育中心至图书馆",
			"from": "GYM",
			"to": "LIB",
			"geometry": [
				{
					"x": 700,
					"y": 300
				},
				{
					"x": 790,
					"y": 380
				},
				{
					"x": 790,
					"y": 440
				}
			],
			"blocked": false,
			"hazard": null,
			"block_reason": null
		},
		{
			"id": "R-N1-GATE3",
			"name": "北 1 至 3 号门（训练备用道路）",
			"from": "N1",
			"to": "GATE3",
			"geometry": [
				{
					"x": 180,
					"y": 500
				},
				{
					"x": 195,
					"y": 595
				},
				{
					"x": 480,
					"y": 595
				},
				{
					"x": 500,
					"y": 520
				}
			],
			"blocked": false,
			"hazard": null,
			"block_reason": null
		},
		{
			"id": "R-N11-SAC",
			"name": "北 11 至北大活",
			"from": "N11",
			"to": "SAC",
			"geometry": [
				{
					"x": 440,
					"y": 180
				},
				{
					"x": 525,
					"y": 195
				},
				{
					"x": 600,
					"y": 190
				}
			],
			"blocked": false,
			"hazard": null,
			"block_reason": null
		},
		{
			"id": "R-CN2-SAC",
			"name": "北二食堂至北大活",
			"from": "CN2",
			"to": "SAC",
			"geometry": [
				{
					"x": 430,
					"y": 330
				},
				{
					"x": 395,
					"y": 330
				},
				{
					"x": 395,
					"y": 225
				},
				{
					"x": 600,
					"y": 225
				},
				{
					"x": 600,
					"y": 190
				}
			],
			"blocked": false,
			"hazard": null,
			"block_reason": null
		},
		{
			"id": "R-SAC-GYM",
			"name": "北大活至体育中心",
			"from": "SAC",
			"to": "GYM",
			"geometry": [
				{
					"x": 600,
					"y": 190
				},
				{
					"x": 670,
					"y": 195
				},
				{
					"x": 670,
					"y": 285
				},
				{
					"x": 700,
					"y": 300
				}
			],
			"blocked": false,
			"hazard": null,
			"block_reason": null
		},
		{
			"id": "R-N7-SA",
			"name": "萃园至南馆",
			"from": "N7",
			"to": "SA",
			"geometry": [
				{
					"x": 380,
					"y": 520
				},
				{
					"x": 395,
					"y": 610
				},
				{
					"x": 600,
					"y": 610
				},
				{
					"x": 600,
					"y": 675
				},
				{
					"x": 585,
					"y": 695
				}
			],
			"blocked": false,
			"hazard": null,
			"block_reason": null
		},
		{
			"id": "R-SA-SY",
			"name": "南馆至基础实验楼",
			"from": "SA",
			"to": "SY",
			"geometry": [
				{
					"x": 585,
					"y": 695
				},
				{
					"x": 630,
					"y": 695
				},
				{
					"x": 630,
					"y": 605
				},
				{
					"x": 855,
					"y": 605
				},
				{
					"x": 855,
					"y": 695
				},
				{
					"x": 835,
					"y": 695
				}
			],
			"blocked": false,
			"hazard": null,
			"block_reason": null
		},
		{
			"id": "R-SY-G3",
			"name": "基础实验楼至实训 3 号楼",
			"from": "SY",
			"to": "G3",
			"geometry": [{
				"x": 835,
				"y": 695
			}, {
				"x": 930,
				"y": 695
			}],
			"blocked": false,
			"hazard": null,
			"block_reason": null
		},
		{
			"id": "R-G3-G8",
			"name": "工程实践中心内部通道",
			"from": "G3",
			"to": "G8",
			"geometry": [
				{
					"x": 930,
					"y": 695
				},
				{
					"x": 907,
					"y": 767
				},
				{
					"x": 1135,
					"y": 767
				},
				{
					"x": 1155,
					"y": 695
				}
			],
			"blocked": false,
			"hazard": null,
			"block_reason": null
		},
		{
			"id": "R-SY-ADM",
			"name": "基础实验楼至行政中心",
			"from": "SY",
			"to": "ADM",
			"geometry": [
				{
					"x": 835,
					"y": 695
				},
				{
					"x": 850,
					"y": 780
				},
				{
					"x": 743,
					"y": 780
				},
				{
					"x": 743,
					"y": 860
				},
				{
					"x": 720,
					"y": 860
				}
			],
			"blocked": false,
			"hazard": null,
			"block_reason": null
		},
		{
			"id": "R-ADM-GATES",
			"name": "行政中心至南门",
			"from": "ADM",
			"to": "GATES",
			"geometry": [{
				"x": 720,
				"y": 860
			}, {
				"x": 720,
				"y": 930
			}],
			"blocked": false,
			"hazard": null,
			"block_reason": null
		},
		{
			"id": "R-ADM-CLI",
			"name": "行政中心至门诊部",
			"from": "ADM",
			"to": "CLI",
			"geometry": [{
				"x": 720,
				"y": 860
			}, {
				"x": 925,
				"y": 860
			}],
			"blocked": false,
			"hazard": null,
			"block_reason": null
		},
		{
			"id": "R-G8-CLI",
			"name": "实训 8 号楼至门诊部",
			"from": "G8",
			"to": "CLI",
			"geometry": [
				{
					"x": 1155,
					"y": 695
				},
				{
					"x": 1125,
					"y": 785
				},
				{
					"x": 895,
					"y": 785
				},
				{
					"x": 895,
					"y": 860
				},
				{
					"x": 925,
					"y": 860
				}
			],
			"blocked": false,
			"hazard": null,
			"block_reason": null
		},
		{
			"id": "R-LIB-EA",
			"name": "图书馆至东馆",
			"from": "LIB",
			"to": "EA",
			"geometry": [
				{
					"x": 790,
					"y": 440
				},
				{
					"x": 908,
					"y": 395
				},
				{
					"x": 907,
					"y": 545
				},
				{
					"x": 1e3,
					"y": 545
				},
				{
					"x": 1e3,
					"y": 525
				}
			],
			"blocked": false,
			"hazard": null,
			"block_reason": null
		},
		{
			"id": "R-WL-EA",
			"name": "文理楼至东馆",
			"from": "WL",
			"to": "EA",
			"geometry": [
				{
					"x": 1e3,
					"y": 355
				},
				{
					"x": 1105,
					"y": 387
				},
				{
					"x": 1105,
					"y": 550
				},
				{
					"x": 1e3,
					"y": 525
				}
			],
			"blocked": false,
			"hazard": null,
			"block_reason": null
		},
		{
			"id": "R-EA-CE1",
			"name": "东馆至东一食堂",
			"from": "EA",
			"to": "CE1",
			"geometry": [
				{
					"x": 1e3,
					"y": 525
				},
				{
					"x": 1105,
					"y": 552
				},
				{
					"x": 1120,
					"y": 495
				},
				{
					"x": 1140,
					"y": 495
				}
			],
			"blocked": false,
			"hazard": null,
			"block_reason": null
		},
		{
			"id": "R-CE1-E1",
			"name": "东一食堂至润园 1 幢",
			"from": "CE1",
			"to": "E1",
			"geometry": [
				{
					"x": 1140,
					"y": 495
				},
				{
					"x": 1120,
					"y": 400
				},
				{
					"x": 1210,
					"y": 400
				},
				{
					"x": 1210,
					"y": 370
				}
			],
			"blocked": false,
			"hazard": null,
			"block_reason": null
		},
		{
			"id": "R-E1-E7",
			"name": "润园 1 幢至 7 幢",
			"from": "E1",
			"to": "E7",
			"geometry": [
				{
					"x": 1210,
					"y": 370
				},
				{
					"x": 1120,
					"y": 415
				},
				{
					"x": 1120,
					"y": 240
				},
				{
					"x": 1210,
					"y": 240
				},
				{
					"x": 1210,
					"y": 210
				}
			],
			"blocked": false,
			"hazard": null,
			"block_reason": null
		},
		{
			"id": "R-CE1-GATE4",
			"name": "东一食堂至 4 号门",
			"from": "CE1",
			"to": "GATE4",
			"geometry": [
				{
					"x": 1140,
					"y": 495
				},
				{
					"x": 1120,
					"y": 580
				},
				{
					"x": 1350,
					"y": 580
				},
				{
					"x": 1350,
					"y": 495
				}
			],
			"blocked": false,
			"hazard": null,
			"block_reason": null
		},
		{
			"id": "R-EA-G3",
			"name": "东馆至工程实践中心",
			"from": "EA",
			"to": "G3",
			"geometry": [
				{
					"x": 1e3,
					"y": 525
				},
				{
					"x": 1e3,
					"y": 615
				},
				{
					"x": 910,
					"y": 615
				},
				{
					"x": 910,
					"y": 695
				},
				{
					"x": 930,
					"y": 695
				}
			],
			"blocked": false,
			"hazard": null,
			"block_reason": null
		},
		{
			"id": "R-CE1-G8",
			"name": "东区至工程实践中心",
			"from": "CE1",
			"to": "G8",
			"geometry": [
				{
					"x": 1140,
					"y": 495
				},
				{
					"x": 1120,
					"y": 595
				},
				{
					"x": 1130,
					"y": 695
				},
				{
					"x": 1155,
					"y": 695
				}
			],
			"blocked": false,
			"hazard": null,
			"block_reason": null
		}
	]
};
// src/scenario-generation/templates.ts
const canonical = {
	schema_version: "d1-1",
	generated_at: "2026-11-17",
	scenario: {
		"id": "SC-NIGHT-DORM-01",
		"template_id": "TPL-NIGHT-DORM-01",
		"title": "夜间宿舍火灾 · 暴雨内涝（训练样例）",
		"source": "canonical",
		"modifiers": {
			"night": true,
			"heavy_rain": true,
			"comms_outage": false,
			"crowd_peak": false
		},
		"start_building_id": "N7",
		"t_end": 300,
		"nodes": [
			{
				"id": "n030",
				"t_sim": 30,
				"label": "U1 出现；可判读并提交 A1",
				"events": [{
					"type": "ugc_appear",
					"report_id": "U1"
				}]
			},
			{
				"id": "n045",
				"t_sim": 45,
				"label": "U3 出现",
				"events": [{
					"type": "ugc_appear",
					"report_id": "U3"
				}]
			},
			{
				"id": "n060",
				"t_sim": 60,
				"label": "U2 出现",
				"events": [{
					"type": "ugc_appear",
					"report_id": "U2"
				}]
			},
			{
				"id": "n070",
				"t_sim": 70,
				"label": "U4 出现",
				"events": [{
					"type": "ugc_appear",
					"report_id": "U4"
				}]
			},
			{
				"id": "n080",
				"t_sim": 80,
				"label": "U5 出现",
				"events": [{
					"type": "ugc_appear",
					"report_id": "U5"
				}]
			},
			{
				"id": "n090",
				"t_sim": 90,
				"label": "导调核实：北 7 三层确认真实火情",
				"events": [{
					"type": "disaster_confirm",
					"building_id": "N7",
					"title": "北 7 三层确认为真实火情",
					"adds_disaster_annotation": true
				}]
			},
			{
				"id": "n100",
				"t_sim": 100,
				"label": "U6 出现；U1 可改判",
				"events": [{
					"type": "ugc_appear",
					"report_id": "U6"
				}]
			},
			{
				"id": "n110",
				"t_sim": 110,
				"label": "U7 出现",
				"events": [{
					"type": "ugc_appear",
					"report_id": "U7"
				}]
			},
			{
				"id": "n130",
				"t_sim": 130,
				"label": "U8 出现",
				"events": [{
					"type": "ugc_appear",
					"report_id": "U8"
				}]
			},
			{
				"id": "n140",
				"t_sim": 140,
				"label": "U9 出现；R-N7E 积水阻断",
				"events": [{
					"type": "ugc_appear",
					"report_id": "U9"
				}, {
					"type": "road_hazard",
					"road_id": "R-N7E",
					"hazard": "flood",
					"description": "北 7 东侧至 3 号门积水过深，车辆无法通行"
				}]
			},
			{
				"id": "n150",
				"t_sim": 150,
				"label": "U10 出现",
				"events": [{
					"type": "ugc_appear",
					"report_id": "U10"
				}]
			},
			{
				"id": "n220",
				"t_sim": 220,
				"label": "推进回合：无新事件",
				"events": []
			},
			{
				"id": "n250",
				"t_sim": 250,
				"label": "推进回合：无新事件",
				"events": []
			},
			{
				"id": "n300",
				"t_sim": 300,
				"label": "末回合：开放整批排序，结束核对关键项",
				"events": []
			}
		],
		"standard_actions": [
			{
				"action_id": "A1",
				"target_id": "N7",
				"label": "上报核查 萃园 7 幢（北 7）"
			},
			{
				"action_id": "A2",
				"target_id": "N7",
				"label": "派队 萃园 7 幢（北 7）"
			},
			{
				"action_id": "A3",
				"target_id": "N7",
				"label": "警戒 萃园 7 幢（北 7）周边"
			},
			{
				"action_id": "A4",
				"target_id": "N7",
				"label": "广播疏散 萃园 7 幢（北 7）"
			},
			{
				"action_id": "A5",
				"target_id": "R-N7E",
				"label": "封路 R-N7E（北 7 东侧至 3 号门）"
			},
			{
				"action_id": "A6",
				"target_id": "N7",
				"label": "断电 萃园 7 幢（北 7）"
			}
		],
		"critical_items": [
			{
				"action_id": "A2",
				"target_id": "N7",
				"label": "派队 萃园 7 幢（北 7）"
			},
			{
				"action_id": "A3",
				"target_id": "N7",
				"label": "警戒 萃园 7 幢（北 7）周边"
			},
			{
				"action_id": "A4",
				"target_id": "N7",
				"label": "广播疏散 萃园 7 幢（北 7）"
			}
		],
		"resources": [
			{
				"id": "inspection_team",
				"name": "核查组",
				"capacity": 1,
				"unit": "组"
			},
			{
				"id": "rescue_team",
				"name": "救援队",
				"capacity": 1,
				"unit": "队"
			},
			{
				"id": "barrier_team",
				"name": "警戒组",
				"capacity": 1,
				"unit": "组"
			},
			{
				"id": "broadcast_system",
				"name": "广播系统",
				"capacity": 1,
				"unit": "套"
			},
			{
				"id": "traffic_team",
				"name": "交通管制组",
				"capacity": 1,
				"unit": "组"
			},
			{
				"id": "electrician",
				"name": "电工组",
				"capacity": 1,
				"unit": "组"
			}
		],
		"playback_speeds": [1, 4]
	},
	buildings: [
		{
			"id": "N7",
			"name": "萃园 7 幢（北 7）",
			"zone": "萃园·北区",
			"category": "dormitory",
			"floors": 5,
			"capacity": 500,
			"risk_tag": "夜间人员密集、用电",
			"polygon": [
				{
					"x": 220,
					"y": 460
				},
				{
					"x": 380,
					"y": 460
				},
				{
					"x": 380,
					"y": 580
				},
				{
					"x": 220,
					"y": 580
				}
			],
			"adjacency": ["N1"]
		},
		{
			"id": "N1",
			"name": "萃园 1 幢（北 1）",
			"zone": "萃园·北区",
			"category": "dormitory",
			"floors": 5,
			"capacity": 500,
			"risk_tag": "夜间人员密集、用电",
			"polygon": [
				{
					"x": 60,
					"y": 420
				},
				{
					"x": 180,
					"y": 420
				},
				{
					"x": 180,
					"y": 540
				},
				{
					"x": 60,
					"y": 540
				}
			],
			"adjacency": ["N7", "N2"]
		},
		{
			"id": "N2",
			"name": "萃园 2 幢（北 2）",
			"zone": "萃园·北区",
			"category": "dormitory",
			"floors": 5,
			"capacity": 500,
			"risk_tag": "夜间人员密集、用电",
			"polygon": [
				{
					"x": 60,
					"y": 280
				},
				{
					"x": 180,
					"y": 280
				},
				{
					"x": 180,
					"y": 380
				},
				{
					"x": 60,
					"y": 380
				}
			],
			"adjacency": ["N1", "CN1"]
		},
		{
			"id": "N11",
			"name": "萃园 11 幢（北 11）",
			"zone": "萃园·北区",
			"category": "dormitory",
			"floors": 5,
			"capacity": 400,
			"risk_tag": "夜间人员密集",
			"polygon": [
				{
					"x": 380,
					"y": 60
				},
				{
					"x": 500,
					"y": 60
				},
				{
					"x": 500,
					"y": 180
				},
				{
					"x": 380,
					"y": 180
				}
			],
			"adjacency": ["CN2"]
		},
		{
			"id": "CN1",
			"name": "萃园一食堂（北一）",
			"zone": "萃园·北区",
			"category": "canteen",
			"floors": 3,
			"capacity": 800,
			"risk_tag": "燃气、就餐高峰人流",
			"polygon": [
				{
					"x": 220,
					"y": 260
				},
				{
					"x": 360,
					"y": 260
				},
				{
					"x": 360,
					"y": 380
				},
				{
					"x": 220,
					"y": 380
				}
			],
			"adjacency": [
				"N2",
				"CN2",
				"GYM"
			]
		},
		{
			"id": "CN2",
			"name": "萃园二食堂（北二）",
			"zone": "萃园·北区",
			"category": "canteen",
			"floors": 3,
			"capacity": 800,
			"risk_tag": "燃气",
			"polygon": [
				{
					"x": 430,
					"y": 260
				},
				{
					"x": 570,
					"y": 260
				},
				{
					"x": 570,
					"y": 380
				},
				{
					"x": 430,
					"y": 380
				}
			],
			"adjacency": ["CN1", "N11"]
		},
		{
			"id": "GYM",
			"name": "天健苑·体育中心",
			"zone": "天健苑·西部",
			"category": "gymnasium",
			"floors": null,
			"capacity": 3e3,
			"risk_tag": "散场人流对冲、通讯中断",
			"polygon": [
				{
					"x": 700,
					"y": 240
				},
				{
					"x": 880,
					"y": 240
				},
				{
					"x": 880,
					"y": 380
				},
				{
					"x": 700,
					"y": 380
				}
			],
			"adjacency": ["CN1", "LIB"]
		},
		{
			"id": "LIB",
			"name": "文博苑·逸夫图书信息中心",
			"zone": "文博苑·中部",
			"category": "library",
			"floors": 5,
			"capacity": 2500,
			"risk_tag": "密集藏书、用电",
			"polygon": [
				{
					"x": 700,
					"y": 440
				},
				{
					"x": 900,
					"y": 440
				},
				{
					"x": 900,
					"y": 580
				},
				{
					"x": 700,
					"y": 580
				}
			],
			"adjacency": ["GYM"]
		}
	],
	junctions: [{
		"id": "GATE3",
		"name": "3 号门（近北区）",
		"kind": "gate"
	}],
	road_segments: [
		{
			"id": "R-N7E",
			"name": "北 7 东侧至 3 号门",
			"from": "N7",
			"to": "GATE3",
			"geometry": [{
				"x": 380,
				"y": 520
			}, {
				"x": 500,
				"y": 520
			}],
			"blocked": false,
			"hazard": null,
			"block_reason": null
		},
		{
			"id": "R-N7-N1",
			"name": "萃园 7 幢至 1 幢",
			"from": "N7",
			"to": "N1",
			"geometry": [{
				"x": 220,
				"y": 500
			}, {
				"x": 180,
				"y": 500
			}],
			"blocked": false,
			"hazard": null,
			"block_reason": null
		},
		{
			"id": "R-N1-N2",
			"name": "萃园 1 幢至 2 幢",
			"from": "N1",
			"to": "N2",
			"geometry": [{
				"x": 120,
				"y": 420
			}, {
				"x": 120,
				"y": 380
			}],
			"blocked": false,
			"hazard": null,
			"block_reason": null
		},
		{
			"id": "R-N2-CN1",
			"name": "萃园 2 幢至北一食堂",
			"from": "N2",
			"to": "CN1",
			"geometry": [{
				"x": 180,
				"y": 330
			}, {
				"x": 220,
				"y": 330
			}],
			"blocked": false,
			"hazard": null,
			"block_reason": null
		},
		{
			"id": "R-CN1-CN2",
			"name": "北一食堂至北二食堂",
			"from": "CN1",
			"to": "CN2",
			"geometry": [{
				"x": 360,
				"y": 330
			}, {
				"x": 430,
				"y": 330
			}],
			"blocked": false,
			"hazard": null,
			"block_reason": null
		},
		{
			"id": "R-N11-CN2",
			"name": "北 11 至北二食堂",
			"from": "N11",
			"to": "CN2",
			"geometry": [{
				"x": 440,
				"y": 180
			}, {
				"x": 440,
				"y": 260
			}],
			"blocked": false,
			"hazard": null,
			"block_reason": null
		},
		{
			"id": "R-CN1-GYM",
			"name": "北区至体育中心（训练级简化）",
			"from": "CN1",
			"to": "GYM",
			"geometry": [
				{
					"x": 360,
					"y": 300
				},
				{
					"x": 390,
					"y": 210
				},
				{
					"x": 650,
					"y": 210
				},
				{
					"x": 700,
					"y": 300
				}
			],
			"blocked": false,
			"hazard": null,
			"block_reason": null
		},
		{
			"id": "R-GYM-LIB",
			"name": "体育中心至图书馆",
			"from": "GYM",
			"to": "LIB",
			"geometry": [{
				"x": 790,
				"y": 380
			}, {
				"x": 790,
				"y": 440
			}],
			"blocked": false,
			"hazard": null,
			"block_reason": null
		}
	],
	action_catalog: [
		{
			"id": "A1",
			"name": "上报核查",
			"target_kind": "building",
			"critical": false,
			"weight": 1,
			"duration_sim": 45,
			"resource_id": "inspection_team",
			"resource_units": 1,
			"preconditions": []
		},
		{
			"id": "A2",
			"name": "派队",
			"target_kind": "building",
			"critical": true,
			"weight": 3,
			"duration_sim": 60,
			"resource_id": "rescue_team",
			"resource_units": 1,
			"preconditions": []
		},
		{
			"id": "A3",
			"name": "警戒",
			"target_kind": "building",
			"critical": true,
			"weight": 2,
			"duration_sim": 30,
			"resource_id": "barrier_team",
			"resource_units": 1,
			"preconditions": []
		},
		{
			"id": "A4",
			"name": "广播疏散",
			"target_kind": "building",
			"critical": true,
			"weight": 2,
			"duration_sim": 20,
			"resource_id": "broadcast_system",
			"resource_units": 1,
			"preconditions": [{
				"type": "requires_completed_action",
				"action_id": "A3",
				"description": "同楼栋 A3 警戒必须先完成"
			}]
		},
		{
			"id": "A5",
			"name": "封路",
			"target_kind": "road",
			"critical": false,
			"weight": 1,
			"duration_sim": 25,
			"resource_id": "traffic_team",
			"resource_units": 1,
			"preconditions": []
		},
		{
			"id": "A6",
			"name": "断电",
			"target_kind": "building",
			"critical": false,
			"weight": 1,
			"duration_sim": 35,
			"resource_id": "electrician",
			"resource_units": 1,
			"preconditions": [{
				"type": "requires_disaster_annotation",
				"description": "对象楼栋必须已有灾情标注"
			}, {
				"type": "not_powered_off",
				"description": "同一楼栋不可重复断电"
			}]
		}
	],
	ugc_reports: [
		{
			"id": "U1",
			"category": "true_report",
			"appears_at_sim": 30,
			"text": "北 7 好像有烟，不确定是不是有人烧东西",
			"event_truth": {
				"is_real": true,
				"locatable": true,
				"building_id": "N7"
			},
			"judgment_windows": [{
				"from_sim": 30,
				"to_sim": 90,
				"expected": "待核",
				"reason": "仅闻到烟味，尚无明火或核实结论"
			}, {
				"from_sim": 90,
				"to_sim": null,
				"expected": "真报",
				"reason": "导调已核实北 7 三层真实火情"
			}],
			"priority": 4,
			"is_training": 1
		},
		{
			"id": "U2",
			"category": "true_report",
			"appears_at_sim": 60,
			"text": "北 7 三楼窗口看到明火，浓烟很大",
			"event_truth": {
				"is_real": true,
				"locatable": true,
				"building_id": "N7"
			},
			"judgment_windows": [{
				"from_sim": 60,
				"to_sim": null,
				"expected": "真报",
				"reason": "明火与浓烟同时被目击，证据充分"
			}],
			"priority": 1,
			"is_training": 1
		},
		{
			"id": "U3",
			"category": "false_report",
			"appears_at_sim": 45,
			"text": "是不是又在搞消防演习啊",
			"event_truth": {
				"is_real": false,
				"locatable": false,
				"building_id": null
			},
			"judgment_windows": [{
				"from_sim": 45,
				"to_sim": null,
				"expected": "误报",
				"reason": "无具体位置与灾情细节，属于演习联想"
			}],
			"priority": 8,
			"is_training": 1
		},
		{
			"id": "U4",
			"category": "emotional",
			"appears_at_sim": 70,
			"text": "救命啊我们楼好可怕我要死了",
			"event_truth": {
				"is_real": true,
				"locatable": false,
				"building_id": null
			},
			"judgment_windows": [{
				"from_sim": 70,
				"to_sim": null,
				"expected": "待核",
				"reason": "情绪化描述且无法定位，需先核实"
			}],
			"priority": 3,
			"is_training": 1
		},
		{
			"id": "U5",
			"category": "vague_location",
			"appears_at_sim": 80,
			"text": "3 号门那边有烟（实为 N7）",
			"event_truth": {
				"is_real": true,
				"locatable": false,
				"building_id": null
			},
			"judgment_windows": [{
				"from_sim": 80,
				"to_sim": null,
				"expected": "待核",
				"reason": "指向校门方向，不能直接定位到具体楼栋"
			}],
			"priority": 6,
			"is_training": 1
		},
		{
			"id": "U6",
			"category": "duplicate",
			"appears_at_sim": 100,
			"text": "北 7 着火了！（重复 U2）",
			"event_truth": {
				"is_real": true,
				"locatable": true,
				"building_id": "N7"
			},
			"judgment_windows": [{
				"from_sim": 100,
				"to_sim": null,
				"expected": "真报",
				"reason": "与 U2 内容重复，但事实成立"
			}],
			"priority": 7,
			"is_training": 1
		},
		{
			"id": "U7",
			"category": "false_report",
			"appears_at_sim": 110,
			"text": "食堂好像也冒烟了",
			"event_truth": {
				"is_real": false,
				"locatable": false,
				"building_id": null
			},
			"judgment_windows": [{
				"from_sim": 110,
				"to_sim": null,
				"expected": "误报",
				"reason": "北区有 CN1、CN2 两座食堂且未指明，表述为猜测"
			}],
			"priority": 9,
			"is_training": 1
		},
		{
			"id": "U8",
			"category": "true_report",
			"appears_at_sim": 130,
			"text": "宿管确认北 7 三层起火",
			"event_truth": {
				"is_real": true,
				"locatable": true,
				"building_id": "N7"
			},
			"judgment_windows": [{
				"from_sim": 130,
				"to_sim": null,
				"expected": "真报",
				"reason": "宿管现场确认"
			}],
			"priority": 2,
			"is_training": 1
		},
		{
			"id": "U9",
			"category": "true_report",
			"appears_at_sim": 140,
			"text": "北 7 东侧路面积水很深，车过不去",
			"event_truth": {
				"is_real": true,
				"locatable": true,
				"building_id": "N7"
			},
			"judgment_windows": [{
				"from_sim": 140,
				"to_sim": null,
				"expected": "真报",
				"reason": "位置参考楼栋为 N7；阻断对象 R-N7E 由同回合灾情事件引用"
			}],
			"priority": 5,
			"is_training": 1
		},
		{
			"id": "U10",
			"category": "false_report",
			"appears_at_sim": 150,
			"text": "听说整个学校都停电了",
			"event_truth": {
				"is_real": false,
				"locatable": false,
				"building_id": null
			},
			"judgment_windows": [{
				"from_sim": 150,
				"to_sim": null,
				"expected": "误报",
				"reason": "仅传闻且明显夸大"
			}],
			"priority": 10,
			"is_training": 1
		}
	],
	runs: [
		{
			"run_id": "run-jia-1x",
			"scenario_id": "SC-NIGHT-DORM-01",
			"branch": "甲",
			"playback_speed": 1,
			"events": [
				{
					"seq": 1,
					"t_sim": 30,
					"kind": "action",
					"payload": {
						"seq": 1,
						"attempt": 1,
						"action_id": "A1",
						"target_id": "N7",
						"submitted_at_sim": 30,
						"duration_sim": 45,
						"completed_at_sim": 75,
						"status": "accepted",
						"reject_reason_code": null,
						"reject_reason": null,
						"resource_usage": {
							"resource_id": "inspection_team",
							"units": 1,
							"action_seq": 1,
							"from_sim": 30,
							"to_sim": 75
						}
					}
				},
				{
					"seq": 2,
					"t_sim": 30,
					"kind": "verdict",
					"payload": {
						"seq": 2,
						"report_id": "U1",
						"judged_at_sim": 30,
						"verdict": "待核",
						"location": "N7",
						"supersedes_seq": null
					}
				},
				{
					"seq": 3,
					"t_sim": 45,
					"kind": "verdict",
					"payload": {
						"seq": 3,
						"report_id": "U3",
						"judged_at_sim": 45,
						"verdict": "误报",
						"location": "无法定位",
						"supersedes_seq": null
					}
				},
				{
					"seq": 4,
					"t_sim": 60,
					"kind": "verdict",
					"payload": {
						"seq": 4,
						"report_id": "U2",
						"judged_at_sim": 60,
						"verdict": "真报",
						"location": "N7",
						"supersedes_seq": null
					}
				},
				{
					"seq": 5,
					"t_sim": 70,
					"kind": "verdict",
					"payload": {
						"seq": 5,
						"report_id": "U4",
						"judged_at_sim": 70,
						"verdict": "待核",
						"location": "无法定位",
						"supersedes_seq": null
					}
				},
				{
					"seq": 6,
					"t_sim": 80,
					"kind": "verdict",
					"payload": {
						"seq": 6,
						"report_id": "U5",
						"judged_at_sim": 80,
						"verdict": "真报",
						"location": "无法定位",
						"supersedes_seq": null
					}
				},
				{
					"seq": 7,
					"t_sim": 100,
					"kind": "verdict",
					"payload": {
						"seq": 7,
						"report_id": "U1",
						"judged_at_sim": 100,
						"verdict": "真报",
						"location": "N7",
						"supersedes_seq": 2
					}
				},
				{
					"seq": 8,
					"t_sim": 100,
					"kind": "verdict",
					"payload": {
						"seq": 8,
						"report_id": "U6",
						"judged_at_sim": 100,
						"verdict": "真报",
						"location": "N7",
						"supersedes_seq": null
					}
				},
				{
					"seq": 9,
					"t_sim": 100,
					"kind": "action",
					"payload": {
						"seq": 9,
						"attempt": 1,
						"action_id": "A2",
						"target_id": "N7",
						"submitted_at_sim": 100,
						"duration_sim": 60,
						"completed_at_sim": 160,
						"status": "accepted",
						"reject_reason_code": null,
						"reject_reason": null,
						"resource_usage": {
							"resource_id": "rescue_team",
							"units": 1,
							"action_seq": 9,
							"from_sim": 100,
							"to_sim": 160
						}
					}
				},
				{
					"seq": 10,
					"t_sim": 100,
					"kind": "action",
					"payload": {
						"seq": 10,
						"attempt": 1,
						"action_id": "A3",
						"target_id": "N7",
						"submitted_at_sim": 100,
						"duration_sim": 30,
						"completed_at_sim": 130,
						"status": "accepted",
						"reject_reason_code": null,
						"reject_reason": null,
						"resource_usage": {
							"resource_id": "barrier_team",
							"units": 1,
							"action_seq": 10,
							"from_sim": 100,
							"to_sim": 130
						}
					}
				},
				{
					"seq": 11,
					"t_sim": 110,
					"kind": "verdict",
					"payload": {
						"seq": 11,
						"report_id": "U7",
						"judged_at_sim": 110,
						"verdict": "误报",
						"location": "无法定位",
						"supersedes_seq": null
					}
				},
				{
					"seq": 12,
					"t_sim": 110,
					"kind": "action",
					"payload": {
						"seq": 12,
						"attempt": 1,
						"action_id": "A6",
						"target_id": "N7",
						"submitted_at_sim": 110,
						"duration_sim": 35,
						"completed_at_sim": 145,
						"status": "accepted",
						"reject_reason_code": null,
						"reject_reason": null,
						"resource_usage": {
							"resource_id": "electrician",
							"units": 1,
							"action_seq": 12,
							"from_sim": 110,
							"to_sim": 145
						}
					}
				},
				{
					"seq": 13,
					"t_sim": 110,
					"kind": "action",
					"payload": {
						"seq": 13,
						"attempt": 1,
						"action_id": "A6",
						"target_id": "CN1",
						"submitted_at_sim": 110,
						"duration_sim": 35,
						"completed_at_sim": null,
						"status": "rejected",
						"reject_reason_code": "TARGET_NOT_APPLICABLE",
						"reject_reason": "北一食堂 CN1 在提交时刻没有灾情标注，A6 断电不适用",
						"resource_usage": null
					}
				},
				{
					"seq": 14,
					"t_sim": 110,
					"kind": "action",
					"payload": {
						"seq": 14,
						"attempt": 2,
						"action_id": "A6",
						"target_id": "CN1",
						"submitted_at_sim": 110,
						"duration_sim": 35,
						"completed_at_sim": null,
						"status": "rejected",
						"reject_reason_code": "TARGET_NOT_APPLICABLE",
						"reject_reason": "CN1 仍无灾情标注；首次被拒后再次提交，计违规",
						"resource_usage": null
					}
				},
				{
					"seq": 15,
					"t_sim": 130,
					"kind": "verdict",
					"payload": {
						"seq": 15,
						"report_id": "U8",
						"judged_at_sim": 130,
						"verdict": "真报",
						"location": "N7",
						"supersedes_seq": null
					}
				},
				{
					"seq": 16,
					"t_sim": 140,
					"kind": "verdict",
					"payload": {
						"seq": 16,
						"report_id": "U9",
						"judged_at_sim": 140,
						"verdict": "真报",
						"location": "N7",
						"supersedes_seq": null
					}
				},
				{
					"seq": 17,
					"t_sim": 140,
					"kind": "action",
					"payload": {
						"seq": 17,
						"attempt": 1,
						"action_id": "A5",
						"target_id": "R-N7E",
						"submitted_at_sim": 140,
						"duration_sim": 25,
						"completed_at_sim": 165,
						"status": "accepted",
						"reject_reason_code": null,
						"reject_reason": null,
						"resource_usage": {
							"resource_id": "traffic_team",
							"units": 1,
							"action_seq": 17,
							"from_sim": 140,
							"to_sim": 165
						}
					}
				},
				{
					"seq": 18,
					"t_sim": 150,
					"kind": "verdict",
					"payload": {
						"seq": 18,
						"report_id": "U10",
						"judged_at_sim": 150,
						"verdict": "待核",
						"location": "无法定位",
						"supersedes_seq": null
					}
				},
				{
					"seq": 19,
					"t_sim": 150,
					"kind": "action",
					"payload": {
						"seq": 19,
						"attempt": 2,
						"action_id": "A6",
						"target_id": "N7",
						"submitted_at_sim": 150,
						"duration_sim": 35,
						"completed_at_sim": null,
						"status": "rejected",
						"reject_reason_code": "STATUS_CONFLICT",
						"reject_reason": "N7 已于模拟 145 秒完成断电，A6 不可重复执行",
						"resource_usage": null
					}
				},
				{
					"seq": 20,
					"t_sim": 150,
					"kind": "action",
					"payload": {
						"seq": 20,
						"attempt": 3,
						"action_id": "A6",
						"target_id": "N7",
						"submitted_at_sim": 150,
						"duration_sim": 35,
						"completed_at_sim": null,
						"status": "rejected",
						"reject_reason_code": "STATUS_CONFLICT",
						"reject_reason": "N7 已断电；首次被拒后再次提交，计违规",
						"resource_usage": null
					}
				},
				{
					"seq": 21,
					"t_sim": 300,
					"kind": "sort",
					"payload": {
						"seq": 21,
						"t_sim": 300,
						"ordered_report_ids": [
							"U2",
							"U8",
							"U4"
						]
					}
				}
			],
			"resource_occupancy": [
				{
					"resource_id": "inspection_team",
					"units": 1,
					"action_seq": 1,
					"from_sim": 30,
					"to_sim": 75
				},
				{
					"resource_id": "rescue_team",
					"units": 1,
					"action_seq": 9,
					"from_sim": 100,
					"to_sim": 160
				},
				{
					"resource_id": "barrier_team",
					"units": 1,
					"action_seq": 10,
					"from_sim": 100,
					"to_sim": 130
				},
				{
					"resource_id": "electrician",
					"units": 1,
					"action_seq": 12,
					"from_sim": 110,
					"to_sim": 145
				},
				{
					"resource_id": "traffic_team",
					"units": 1,
					"action_seq": 17,
					"from_sim": 140,
					"to_sim": 165
				}
			]
		},
		{
			"run_id": "run-yi-1x",
			"scenario_id": "SC-NIGHT-DORM-01",
			"branch": "乙",
			"playback_speed": 1,
			"events": [
				{
					"seq": 1,
					"t_sim": 30,
					"kind": "verdict",
					"payload": {
						"seq": 1,
						"report_id": "U1",
						"judged_at_sim": 30,
						"verdict": "误报",
						"location": "无法定位",
						"supersedes_seq": null
					}
				},
				{
					"seq": 2,
					"t_sim": 45,
					"kind": "verdict",
					"payload": {
						"seq": 2,
						"report_id": "U3",
						"judged_at_sim": 45,
						"verdict": "误报",
						"location": "无法定位",
						"supersedes_seq": null
					}
				},
				{
					"seq": 3,
					"t_sim": 60,
					"kind": "verdict",
					"payload": {
						"seq": 3,
						"report_id": "U2",
						"judged_at_sim": 60,
						"verdict": "真报",
						"location": "N7",
						"supersedes_seq": null
					}
				},
				{
					"seq": 4,
					"t_sim": 70,
					"kind": "verdict",
					"payload": {
						"seq": 4,
						"report_id": "U4",
						"judged_at_sim": 70,
						"verdict": "真报",
						"location": "无法定位",
						"supersedes_seq": null
					}
				},
				{
					"seq": 5,
					"t_sim": 80,
					"kind": "verdict",
					"payload": {
						"seq": 5,
						"report_id": "U5",
						"judged_at_sim": 80,
						"verdict": "真报",
						"location": "无法定位",
						"supersedes_seq": null
					}
				},
				{
					"seq": 6,
					"t_sim": 100,
					"kind": "verdict",
					"payload": {
						"seq": 6,
						"report_id": "U6",
						"judged_at_sim": 100,
						"verdict": "真报",
						"location": "N7",
						"supersedes_seq": null
					}
				},
				{
					"seq": 7,
					"t_sim": 110,
					"kind": "verdict",
					"payload": {
						"seq": 7,
						"report_id": "U7",
						"judged_at_sim": 110,
						"verdict": "误报",
						"location": "无法定位",
						"supersedes_seq": null
					}
				},
				{
					"seq": 8,
					"t_sim": 110,
					"kind": "action",
					"payload": {
						"seq": 8,
						"attempt": 1,
						"action_id": "A6",
						"target_id": "CN1",
						"submitted_at_sim": 110,
						"duration_sim": 35,
						"completed_at_sim": null,
						"status": "rejected",
						"reject_reason_code": "TARGET_NOT_APPLICABLE",
						"reject_reason": "北一食堂 CN1 在提交时刻没有灾情标注，A6 断电不适用",
						"resource_usage": null
					}
				},
				{
					"seq": 9,
					"t_sim": 110,
					"kind": "action",
					"payload": {
						"seq": 9,
						"attempt": 2,
						"action_id": "A6",
						"target_id": "CN1",
						"submitted_at_sim": 110,
						"duration_sim": 35,
						"completed_at_sim": null,
						"status": "rejected",
						"reject_reason_code": "TARGET_NOT_APPLICABLE",
						"reject_reason": "CN1 仍无灾情标注；首次被拒后再次提交，计违规",
						"resource_usage": null
					}
				},
				{
					"seq": 10,
					"t_sim": 130,
					"kind": "verdict",
					"payload": {
						"seq": 10,
						"report_id": "U8",
						"judged_at_sim": 130,
						"verdict": "真报",
						"location": "N7",
						"supersedes_seq": null
					}
				},
				{
					"seq": 11,
					"t_sim": 140,
					"kind": "verdict",
					"payload": {
						"seq": 11,
						"report_id": "U9",
						"judged_at_sim": 140,
						"verdict": "真报",
						"location": "N7",
						"supersedes_seq": null
					}
				},
				{
					"seq": 12,
					"t_sim": 150,
					"kind": "verdict",
					"payload": {
						"seq": 12,
						"report_id": "U10",
						"judged_at_sim": 150,
						"verdict": "待核",
						"location": "无法定位",
						"supersedes_seq": null
					}
				},
				{
					"seq": 13,
					"t_sim": 150,
					"kind": "action",
					"payload": {
						"seq": 13,
						"attempt": 1,
						"action_id": "A4",
						"target_id": "N7",
						"submitted_at_sim": 150,
						"duration_sim": 20,
						"completed_at_sim": null,
						"status": "rejected",
						"reject_reason_code": "PRECONDITION_NOT_MET",
						"reject_reason": "同楼栋 A3 警戒尚未完成，A4 广播疏散不可执行",
						"resource_usage": null
					}
				},
				{
					"seq": 14,
					"t_sim": 150,
					"kind": "action",
					"payload": {
						"seq": 14,
						"attempt": 2,
						"action_id": "A4",
						"target_id": "N7",
						"submitted_at_sim": 150,
						"duration_sim": 20,
						"completed_at_sim": null,
						"status": "rejected",
						"reject_reason_code": "PRECONDITION_NOT_MET",
						"reject_reason": "A3 仍未完成；首次被拒后再次提交，计违规",
						"resource_usage": null
					}
				},
				{
					"seq": 15,
					"t_sim": 150,
					"kind": "action",
					"payload": {
						"seq": 15,
						"attempt": 3,
						"action_id": "A4",
						"target_id": "N7",
						"submitted_at_sim": 150,
						"duration_sim": 20,
						"completed_at_sim": null,
						"status": "rejected",
						"reject_reason_code": "PRECONDITION_NOT_MET",
						"reject_reason": "A3 仍未完成；再次提交，计违规",
						"resource_usage": null
					}
				},
				{
					"seq": 16,
					"t_sim": 220,
					"kind": "action",
					"payload": {
						"seq": 16,
						"attempt": 1,
						"action_id": "A2",
						"target_id": "N7",
						"submitted_at_sim": 220,
						"duration_sim": 60,
						"completed_at_sim": 280,
						"status": "accepted",
						"reject_reason_code": null,
						"reject_reason": null,
						"resource_usage": {
							"resource_id": "rescue_team",
							"units": 1,
							"action_seq": 16,
							"from_sim": 220,
							"to_sim": 280
						}
					}
				},
				{
					"seq": 17,
					"t_sim": 250,
					"kind": "action",
					"payload": {
						"seq": 17,
						"attempt": 1,
						"action_id": "A3",
						"target_id": "N7",
						"submitted_at_sim": 250,
						"duration_sim": 30,
						"completed_at_sim": 280,
						"status": "accepted",
						"reject_reason_code": null,
						"reject_reason": null,
						"resource_usage": {
							"resource_id": "barrier_team",
							"units": 1,
							"action_seq": 17,
							"from_sim": 250,
							"to_sim": 280
						}
					}
				},
				{
					"seq": 18,
					"t_sim": 300,
					"kind": "sort",
					"payload": {
						"seq": 18,
						"t_sim": 300,
						"ordered_report_ids": [
							"U2",
							"U8",
							"U4"
						]
					}
				}
			],
			"resource_occupancy": [{
				"resource_id": "rescue_team",
				"units": 1,
				"action_seq": 16,
				"from_sim": 220,
				"to_sim": 280
			}, {
				"resource_id": "barrier_team",
				"units": 1,
				"action_seq": 17,
				"from_sim": 250,
				"to_sim": 280
			}]
		},
		{
			"run_id": "run-jia-plus-a4",
			"scenario_id": "SC-NIGHT-DORM-01",
			"branch": "甲补做A4",
			"playback_speed": 1,
			"events": [
				{
					"seq": 1,
					"t_sim": 30,
					"kind": "action",
					"payload": {
						"seq": 1,
						"attempt": 1,
						"action_id": "A1",
						"target_id": "N7",
						"submitted_at_sim": 30,
						"duration_sim": 45,
						"completed_at_sim": 75,
						"status": "accepted",
						"reject_reason_code": null,
						"reject_reason": null,
						"resource_usage": {
							"resource_id": "inspection_team",
							"units": 1,
							"action_seq": 1,
							"from_sim": 30,
							"to_sim": 75
						}
					}
				},
				{
					"seq": 2,
					"t_sim": 30,
					"kind": "verdict",
					"payload": {
						"seq": 2,
						"report_id": "U1",
						"judged_at_sim": 30,
						"verdict": "待核",
						"location": "N7",
						"supersedes_seq": null
					}
				},
				{
					"seq": 3,
					"t_sim": 45,
					"kind": "verdict",
					"payload": {
						"seq": 3,
						"report_id": "U3",
						"judged_at_sim": 45,
						"verdict": "误报",
						"location": "无法定位",
						"supersedes_seq": null
					}
				},
				{
					"seq": 4,
					"t_sim": 60,
					"kind": "verdict",
					"payload": {
						"seq": 4,
						"report_id": "U2",
						"judged_at_sim": 60,
						"verdict": "真报",
						"location": "N7",
						"supersedes_seq": null
					}
				},
				{
					"seq": 5,
					"t_sim": 70,
					"kind": "verdict",
					"payload": {
						"seq": 5,
						"report_id": "U4",
						"judged_at_sim": 70,
						"verdict": "待核",
						"location": "无法定位",
						"supersedes_seq": null
					}
				},
				{
					"seq": 6,
					"t_sim": 80,
					"kind": "verdict",
					"payload": {
						"seq": 6,
						"report_id": "U5",
						"judged_at_sim": 80,
						"verdict": "真报",
						"location": "无法定位",
						"supersedes_seq": null
					}
				},
				{
					"seq": 7,
					"t_sim": 100,
					"kind": "verdict",
					"payload": {
						"seq": 7,
						"report_id": "U1",
						"judged_at_sim": 100,
						"verdict": "真报",
						"location": "N7",
						"supersedes_seq": 2
					}
				},
				{
					"seq": 8,
					"t_sim": 100,
					"kind": "verdict",
					"payload": {
						"seq": 8,
						"report_id": "U6",
						"judged_at_sim": 100,
						"verdict": "真报",
						"location": "N7",
						"supersedes_seq": null
					}
				},
				{
					"seq": 9,
					"t_sim": 100,
					"kind": "action",
					"payload": {
						"seq": 9,
						"attempt": 1,
						"action_id": "A2",
						"target_id": "N7",
						"submitted_at_sim": 100,
						"duration_sim": 60,
						"completed_at_sim": 160,
						"status": "accepted",
						"reject_reason_code": null,
						"reject_reason": null,
						"resource_usage": {
							"resource_id": "rescue_team",
							"units": 1,
							"action_seq": 9,
							"from_sim": 100,
							"to_sim": 160
						}
					}
				},
				{
					"seq": 10,
					"t_sim": 100,
					"kind": "action",
					"payload": {
						"seq": 10,
						"attempt": 1,
						"action_id": "A3",
						"target_id": "N7",
						"submitted_at_sim": 100,
						"duration_sim": 30,
						"completed_at_sim": 130,
						"status": "accepted",
						"reject_reason_code": null,
						"reject_reason": null,
						"resource_usage": {
							"resource_id": "barrier_team",
							"units": 1,
							"action_seq": 10,
							"from_sim": 100,
							"to_sim": 130
						}
					}
				},
				{
					"seq": 11,
					"t_sim": 110,
					"kind": "verdict",
					"payload": {
						"seq": 11,
						"report_id": "U7",
						"judged_at_sim": 110,
						"verdict": "误报",
						"location": "无法定位",
						"supersedes_seq": null
					}
				},
				{
					"seq": 12,
					"t_sim": 110,
					"kind": "action",
					"payload": {
						"seq": 12,
						"attempt": 1,
						"action_id": "A6",
						"target_id": "N7",
						"submitted_at_sim": 110,
						"duration_sim": 35,
						"completed_at_sim": 145,
						"status": "accepted",
						"reject_reason_code": null,
						"reject_reason": null,
						"resource_usage": {
							"resource_id": "electrician",
							"units": 1,
							"action_seq": 12,
							"from_sim": 110,
							"to_sim": 145
						}
					}
				},
				{
					"seq": 13,
					"t_sim": 110,
					"kind": "action",
					"payload": {
						"seq": 13,
						"attempt": 1,
						"action_id": "A6",
						"target_id": "CN1",
						"submitted_at_sim": 110,
						"duration_sim": 35,
						"completed_at_sim": null,
						"status": "rejected",
						"reject_reason_code": "TARGET_NOT_APPLICABLE",
						"reject_reason": "北一食堂 CN1 在提交时刻没有灾情标注，A6 断电不适用",
						"resource_usage": null
					}
				},
				{
					"seq": 14,
					"t_sim": 110,
					"kind": "action",
					"payload": {
						"seq": 14,
						"attempt": 2,
						"action_id": "A6",
						"target_id": "CN1",
						"submitted_at_sim": 110,
						"duration_sim": 35,
						"completed_at_sim": null,
						"status": "rejected",
						"reject_reason_code": "TARGET_NOT_APPLICABLE",
						"reject_reason": "CN1 仍无灾情标注；首次被拒后再次提交，计违规",
						"resource_usage": null
					}
				},
				{
					"seq": 15,
					"t_sim": 130,
					"kind": "verdict",
					"payload": {
						"seq": 15,
						"report_id": "U8",
						"judged_at_sim": 130,
						"verdict": "真报",
						"location": "N7",
						"supersedes_seq": null
					}
				},
				{
					"seq": 16,
					"t_sim": 140,
					"kind": "verdict",
					"payload": {
						"seq": 16,
						"report_id": "U9",
						"judged_at_sim": 140,
						"verdict": "真报",
						"location": "N7",
						"supersedes_seq": null
					}
				},
				{
					"seq": 17,
					"t_sim": 140,
					"kind": "action",
					"payload": {
						"seq": 17,
						"attempt": 1,
						"action_id": "A5",
						"target_id": "R-N7E",
						"submitted_at_sim": 140,
						"duration_sim": 25,
						"completed_at_sim": 165,
						"status": "accepted",
						"reject_reason_code": null,
						"reject_reason": null,
						"resource_usage": {
							"resource_id": "traffic_team",
							"units": 1,
							"action_seq": 17,
							"from_sim": 140,
							"to_sim": 165
						}
					}
				},
				{
					"seq": 18,
					"t_sim": 150,
					"kind": "verdict",
					"payload": {
						"seq": 18,
						"report_id": "U10",
						"judged_at_sim": 150,
						"verdict": "待核",
						"location": "无法定位",
						"supersedes_seq": null
					}
				},
				{
					"seq": 19,
					"t_sim": 150,
					"kind": "action",
					"payload": {
						"seq": 19,
						"attempt": 1,
						"action_id": "A4",
						"target_id": "N7",
						"submitted_at_sim": 150,
						"duration_sim": 20,
						"completed_at_sim": 170,
						"status": "accepted",
						"reject_reason_code": null,
						"reject_reason": null,
						"resource_usage": {
							"resource_id": "broadcast_system",
							"units": 1,
							"action_seq": 19,
							"from_sim": 150,
							"to_sim": 170
						}
					}
				},
				{
					"seq": 20,
					"t_sim": 150,
					"kind": "action",
					"payload": {
						"seq": 20,
						"attempt": 2,
						"action_id": "A6",
						"target_id": "N7",
						"submitted_at_sim": 150,
						"duration_sim": 35,
						"completed_at_sim": null,
						"status": "rejected",
						"reject_reason_code": "STATUS_CONFLICT",
						"reject_reason": "N7 已于模拟 145 秒完成断电，A6 不可重复执行",
						"resource_usage": null
					}
				},
				{
					"seq": 21,
					"t_sim": 150,
					"kind": "action",
					"payload": {
						"seq": 21,
						"attempt": 3,
						"action_id": "A6",
						"target_id": "N7",
						"submitted_at_sim": 150,
						"duration_sim": 35,
						"completed_at_sim": null,
						"status": "rejected",
						"reject_reason_code": "STATUS_CONFLICT",
						"reject_reason": "N7 已断电；首次被拒后再次提交，计违规",
						"resource_usage": null
					}
				},
				{
					"seq": 22,
					"t_sim": 300,
					"kind": "sort",
					"payload": {
						"seq": 22,
						"t_sim": 300,
						"ordered_report_ids": [
							"U2",
							"U8",
							"U4"
						]
					}
				}
			],
			"resource_occupancy": [
				{
					"resource_id": "inspection_team",
					"units": 1,
					"action_seq": 1,
					"from_sim": 30,
					"to_sim": 75
				},
				{
					"resource_id": "rescue_team",
					"units": 1,
					"action_seq": 9,
					"from_sim": 100,
					"to_sim": 160
				},
				{
					"resource_id": "barrier_team",
					"units": 1,
					"action_seq": 10,
					"from_sim": 100,
					"to_sim": 130
				},
				{
					"resource_id": "electrician",
					"units": 1,
					"action_seq": 12,
					"from_sim": 110,
					"to_sim": 145
				},
				{
					"resource_id": "traffic_team",
					"units": 1,
					"action_seq": 17,
					"from_sim": 140,
					"to_sim": 165
				},
				{
					"resource_id": "broadcast_system",
					"units": 1,
					"action_seq": 19,
					"from_sim": 150,
					"to_sim": 170
				}
			]
		}
	],
	clock_checks: [{
		"label": "甲分支 1× 播放",
		"run_id": "run-jia-1x",
		"playback_speed": 1,
		"expected_response_seconds": 45
	}, {
		"label": "甲分支 4× 播放（模拟时刻不变）",
		"run_id": "run-jia-1x",
		"playback_speed": 4,
		"expected_response_seconds": 45
	}],
	expected_sort: [
		"U2",
		"U8",
		"U4"
	],
	expected_scores: {
		"run-jia-1x": {
			"discrimination": 80,
			"response": 100,
			"coverage": 80,
			"violation": 70,
			"total": 83,
			"details": {
				"correct_judgments": 8,
				"total_reports": 10,
				"wrong_report_ids": ["U5", "U10"],
				"first_real_report_id": "U1",
				"first_response_action_seq": 1,
				"response_seconds": 45,
				"coverage_hit_weights": 8,
				"coverage_total_weights": 10,
				"missed_items": [{
					"action_id": "A4",
					"target_id": "N7",
					"label": "广播疏散 萃园 7 幢（北 7）"
				}],
				"violation_count": 2,
				"violation_event_seqs": [14, 20]
			},
			"sorting": {
				"expected": [
					"U2",
					"U8",
					"U4"
				],
				"actual": [
					"U2",
					"U8",
					"U4"
				],
				"correct": true
			}
		},
		"run-yi-1x": {
			"discrimination": 60,
			"response": 0,
			"coverage": 50,
			"violation": 55,
			"total": 44,
			"details": {
				"correct_judgments": 6,
				"total_reports": 10,
				"wrong_report_ids": [
					"U1",
					"U4",
					"U5",
					"U10"
				],
				"first_real_report_id": "U1",
				"first_response_action_seq": 16,
				"response_seconds": 250,
				"coverage_hit_weights": 5,
				"coverage_total_weights": 10,
				"missed_items": [
					{
						"action_id": "A1",
						"target_id": "N7",
						"label": "上报核查 萃园 7 幢（北 7）"
					},
					{
						"action_id": "A4",
						"target_id": "N7",
						"label": "广播疏散 萃园 7 幢（北 7）"
					},
					{
						"action_id": "A5",
						"target_id": "R-N7E",
						"label": "封路 R-N7E（北 7 东侧至 3 号门）"
					},
					{
						"action_id": "A6",
						"target_id": "N7",
						"label": "断电 萃园 7 幢（北 7）"
					}
				],
				"violation_count": 3,
				"violation_event_seqs": [
					9,
					14,
					15
				]
			},
			"sorting": {
				"expected": [
					"U2",
					"U8",
					"U4"
				],
				"actual": [
					"U2",
					"U8",
					"U4"
				],
				"correct": true
			}
		},
		"run-jia-plus-a4": {
			"discrimination": 80,
			"response": 100,
			"coverage": 100,
			"violation": 70,
			"total": 90,
			"details": {
				"correct_judgments": 8,
				"total_reports": 10,
				"wrong_report_ids": ["U5", "U10"],
				"first_real_report_id": "U1",
				"first_response_action_seq": 1,
				"response_seconds": 45,
				"coverage_hit_weights": 10,
				"coverage_total_weights": 10,
				"missed_items": [],
				"violation_count": 2,
				"violation_event_seqs": [14, 21]
			},
			"sorting": {
				"expected": [
					"U2",
					"U8",
					"U4"
				],
				"actual": [
					"U2",
					"U8",
					"U4"
				],
				"correct": true
			}
		}
	}
};
const campusMap = campus_map_default;
canonical.action_catalog;
canonical.scenario.resources;
canonical.scenario.playback_speeds;
// src/scenario-generation/bundle.ts
var ValidationError = class extends Error {
	issue;
	constructor(issue) {
		super(issue.message);
		this.issue = issue;
	}
};
function record(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
// src/routing.ts
function compareId(a, b) {
	return a < b ? -1 : a > b ? 1 : 0;
}
function comparePath(a, b) {
	if (a.length !== b.length) return a.length - b.length;
	for (const [index, arc] of a.arcs.entries()) {
		const other = b.arcs[index];
		if (!other) return 1;
		const order = compareId(arc.road.id, other.road.id);
		if (order !== 0) return order;
	}
	return a.arcs.length - b.arcs.length;
}
function buildGraph(source, snapshot) {
	const graph = /* @__PURE__ */ new Map();
	for (const { id } of [...source.buildings, ...source.junctions]) {
		if (graph.has(id)) throw new FixturePortError("MAP_DUPLICATE_NODE_ID", id, "路网节点 id 重复");
		graph.set(id, []);
	}
	const mapRoadIds = /* @__PURE__ */ new Set();
	for (const { id } of source.road_segments) {
		if (mapRoadIds.has(id)) throw new FixturePortError("MAP_DUPLICATE_ROAD_ID", id, "初始路段 id 重复");
		mapRoadIds.add(id);
	}
	const endpoints = /* @__PURE__ */ new Map();
	function recordEndpoint(id, point, roadId) {
		const previous = endpoints.get(id);
		if (previous && (previous.x !== point.x || previous.y !== point.y)) throw new FixturePortError("MAP_ENDPOINT_MISMATCH", id, `路段 ${roadId} 与该节点的其他路段连接点不一致`);
		endpoints.set(id, point);
	}
	const roads = [...snapshot ?? source.road_segments].sort((a, b) => compareId(a.id, b.id));
	const seenRoads = /* @__PURE__ */ new Set();
	for (const road of roads) {
		if (seenRoads.has(road.id)) throw new FixturePortError("MAP_DUPLICATE_ROAD_ID", road.id, "快照路段 id 重复");
		if (!mapRoadIds.has(road.id)) throw new FixturePortError("MAP_ROAD_SET_MISMATCH", road.id, "快照包含未知路段");
		seenRoads.add(road.id);
		const from = graph.get(road.from);
		const to = graph.get(road.to);
		if (!from || !to) throw new FixturePortError("MAP_UNKNOWN_ENDPOINT", road.id, "路段引用未知节点");
		if (road.from === road.to) throw new FixturePortError("MAP_SAME_ENDPOINTS", road.id, "路段起终点相同");
		const length = roadLengthPx(road);
		recordEndpoint(road.from, road.geometry[0], road.id);
		recordEndpoint(road.to, road.geometry[road.geometry.length - 1], road.id);
		if (road.blocked || road.hazard !== null) continue;
		from.push({
			to: road.to,
			road,
			length,
			reverse: false
		});
		to.push({
			to: road.from,
			road,
			length,
			reverse: true
		});
	}
	for (const id of mapRoadIds) if (!seenRoads.has(id)) throw new FixturePortError("MAP_ROAD_SET_MISMATCH", id, "快照缺少路段");
	return graph;
}
/** 双向 Dijkstra；等长路径按路段 ID 序列字典序取最小值。 */
function findRoute(source, query) {
	const { from_node_id: from, to_node_id: to, at_sim } = query;
	const graph = buildGraph(source, query.road_segments);
	const result = {
		from_node_id: from,
		to_node_id: to,
		at_sim
	};
	const unknown = [from, to].find((id) => !graph.has(id));
	if (unknown !== void 0) return {
		...result,
		status: "unreachable",
		reason: `未知路网节点：${unknown}`
	};
	const candidates = /* @__PURE__ */ new Map([[from, {
		nodeIds: [from],
		arcs: [],
		length: 0
	}]]);
	const settled = /* @__PURE__ */ new Set();
	while (candidates.size > 0) {
		const [node, path] = [...candidates].sort(([idA, a], [idB, b]) => comparePath(a, b) || compareId(idA, idB))[0];
		if (node === to) {
			const points = path.arcs.flatMap(({ road, reverse }, index) => {
				return (reverse ? [...road.geometry].reverse() : road.geometry).slice(index === 0 ? 0 : 1).map(({ x, y }) => ({
					x,
					y
				}));
			});
			return {
				...result,
				status: "ready",
				node_ids: path.nodeIds,
				road_ids: path.arcs.map(({ road }) => road.id),
				points,
				length_px: path.length
			};
		}
		candidates.delete(node);
		settled.add(node);
		for (const arc of graph.get(node)) {
			if (settled.has(arc.to)) continue;
			const candidate = {
				nodeIds: [...path.nodeIds, arc.to],
				arcs: [...path.arcs, arc],
				length: path.length + arc.length
			};
			if (!Number.isFinite(candidate.length)) throw new FixturePortError("MAP_INVALID_GEOMETRY", arc.road.id, "路径总长必须有限");
			const previous = candidates.get(arc.to);
			if (!previous || comparePath(candidate, previous) < 0) candidates.set(arc.to, candidate);
		}
	}
	return {
		...result,
		status: "unreachable",
		reason: "当前路网无可通行路径"
	};
}
const percentage = (count, total) => total === 0 ? 0 : 100 * count / total;
const actionKey = (item) => JSON.stringify([item.action_id, item.target_id]);
function assessReport(source, report, attempt) {
	const window = attempt ? windowAt(source, report.id, attempt.judged_at_sim) : null;
	const expectedLocation = report.event_truth.locatable ? report.event_truth.building_id : "无法定位";
	return {
		report_id: report.id,
		attempt,
		window,
		correct: window !== null && window.expected === attempt?.verdict,
		expected_location: expectedLocation,
		location_correct: expectedLocation !== null && attempt?.location === expectedLocation
	};
}
/** Recalculate a finished round from its confirmed events and scenario, without fixture scores. */
function scoreRound(source, events) {
	const { t_end: end, standard_actions: standards } = source.scenario;
	const ordered = events.filter((event) => event.t_sim <= end).sort((a, b) => a.seq - b.seq);
	const reports = source.ugc_reports.filter((report) => report.appears_at_sim <= end);
	const verdicts = /* @__PURE__ */ new Map();
	const rejected = /* @__PURE__ */ new Set();
	const violations = [];
	const hits = /* @__PURE__ */ new Set();
	const firstReal = reports.reduce((first, report) => report.event_truth.is_real && (first === null || report.appears_at_sim < first.appears_at_sim) ? report : first, null);
	let firstResponse = null;
	let actualSort = [];
	for (const event of ordered) {
		if (event.kind === "verdict") {
			verdicts.set(event.payload.report_id, event.payload);
			continue;
		}
		if (event.kind === "sort") {
			if (event.t_sim === end) actualSort = [...event.payload.ordered_report_ids];
			continue;
		}
		const action = event.payload;
		const key = actionKey(action);
		if (action.status === "rejected") {
			if (rejected.has(key)) violations.push(action.seq);
			rejected.add(key);
		}
		if (!actionCompletedBy(action, end)) continue;
		hits.add(key);
		if (firstReal && action.target_id === firstReal.event_truth.building_id && action.completed_at_sim >= firstReal.appears_at_sim && (firstResponse === null || action.completed_at_sim < firstResponse.completedAt)) firstResponse = {
			seq: action.seq,
			completedAt: action.completed_at_sim
		};
	}
	const judgments = reports.map((report) => assessReport(source, report, verdicts.get(report.id) ?? null));
	const wrong = judgments.filter((judgment) => !judgment.correct).map((judgment) => judgment.report_id);
	const correct = judgments.length - wrong.length;
	const locationCorrect = judgments.filter((judgment) => judgment.location_correct).length;
	const responseSeconds = firstReal && firstResponse ? firstResponse.completedAt - firstReal.appears_at_sim : null;
	const actionWeights = new Map(source.action_catalog.map(({ id, weight }) => [id, weight]));
	const missed = standards.filter((item) => !hits.has(actionKey(item)));
	const sumWeights = (items) => items.reduce((sum, item) => sum + (actionWeights.get(item.action_id) ?? 0), 0);
	const standardWeight = sumWeights(standards);
	const hitWeight = standardWeight - sumWeights(missed);
	const expectedSort = [...reports].sort((a, b) => a.priority - b.priority).slice(0, 3).map(({ id }) => id);
	const discrimination = percentage(correct, judgments.length);
	const response = responseSeconds === null ? 0 : Math.max(0, Math.min(100, percentage(240 - responseSeconds, 180)));
	const coverage = percentage(hitWeight, standardWeight);
	const violation = Math.max(0, 100 - 15 * violations.length);
	return {
		discrimination,
		response,
		coverage,
		violation,
		total: Math.round(discrimination * .3 + response * .2 + coverage * .35 + violation * .15),
		details: {
			correct_judgments: correct,
			total_reports: judgments.length,
			wrong_report_ids: wrong,
			first_real_report_id: firstReal?.id ?? null,
			first_response_action_seq: firstResponse?.seq ?? null,
			response_seconds: responseSeconds,
			coverage_hit_weights: hitWeight,
			coverage_total_weights: standardWeight,
			missed_items: missed.map((item) => ({ ...item })),
			violation_count: violations.length,
			violation_event_seqs: violations
		},
		sorting: {
			actual: actualSort,
			expected: expectedSort,
			correct: actualSort.length === expectedSort.length && actualSort.every((id, index) => id === expectedSort[index])
		},
		judgments,
		location: {
			correct: locationCorrect,
			total: judgments.length,
			percent: percentage(locationCorrect, judgments.length)
		}
	};
}
// src/engine-port.ts
function createEnginePort(fixture, mapSource) {
	const view = {
		...fixture,
		buildings: [...mapSource.buildings],
		junctions: [...mapSource.junctions],
		road_segments: [...mapSource.road_segments]
	};
	const port = "runs" in fixture ? createFixturePort({
		...fixture,
		...view
	}, view, { padding: 54 }) : {
		map: buildMapView(mapSource, { padding: 54 }),
		visibleReportsAt: (t) => visibleReportsAt(view, t),
		windowAt: (id, t) => windowAt(view, id, t),
		replayTo: () => null,
		getScore: () => null,
		getRoute: (query) => findRoute(mapSource, query)
	};
	return {
		...port,
		getRoute: (query) => findRoute(port.map, query),
		judgeAction: createActionJudge(view, port.map),
		snapshotRound: (events, t) => snapshotRound(view, events, t),
		scoreRound: (events) => scoreRound(view, events)
	};
}
// src/run-store/contracts.ts
var RunStoreError = class extends Error {
	code;
	constructor(code, message) {
		super(message);
		this.code = code;
	}
};
// src/run-store/validation.ts
function stable(value) {
	return JSON.stringify(value, (_, item) => record(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
}
const same$1 = (a, b) => stable(a) === stable(b);
const whole = (n) => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
const identifier = (value) => typeof value === "string" && /^[\w-]{12,80}$/.test(value);
function requireRun(condition, message) {
	if (!condition) throw new RunStoreError("CORRUPT", message);
}
function validateRun(input) {
	try {
		requireRun(record(input), "轮次记录格式无效");
		if (input.schema_version !== 1 || input.engine_version !== "d4-1" || input.map_version !== "d2-1") throw new RunStoreError("VERSION", "轮次、地图或评分版本不受支持");
		requireRun(identifier(input.run_id) && whole(input.revision) && input.revision > 0 && typeof input.created_at === "string" && typeof input.updated_at === "string" && Number.isFinite(Date.parse(input.created_at)) && Date.parse(input.updated_at) >= Date.parse(input.created_at), "轮次头信息无效");
		requireRun(record(input.bundle) && record(input.map) && record(input.progress) && Array.isArray(input.events), "轮次缺少题目包、地图、进度或事件");
		const run = input;
		const { scenario, ugc_reports: reports } = run.bundle;
		requireRun(record(scenario) && scenario.id === run.scenario_id && Array.isArray(scenario.nodes) && Array.isArray(reports) && reports.length === 10 && Array.isArray(run.bundle.action_catalog), "冻结题目包无效");
		const times = scenario.nodes.map((node) => node.t_sim);
		requireRun(times.length > 0 && whole(scenario.t_end) && scenario.t_end > 0 && times.at(-1) === scenario.t_end && times.every((time, index) => whole(time) && (index === 0 || time > times[index - 1])) && new Set(scenario.nodes.map(({ id }) => id)).size === times.length, "场景节点或时间无效");
		const engine = createEnginePort(run.bundle, run.map);
		const buildingIds = new Set(engine.map.buildings.map(({ id }) => id));
		const roadIds = new Set(engine.map.road_segments.map(({ id }) => id));
		requireRun(buildingIds.has(scenario.start_building_id), "起始楼栋不存在");
		const postings = /* @__PURE__ */ new Map();
		for (const node of scenario.nodes) for (const event of node.events) if (event.type === "ugc_appear") {
			requireRun(!postings.has(event.report_id), "上报重复投放");
			postings.set(event.report_id, node.t_sim);
		} else if (event.type === "road_hazard") requireRun(roadIds.has(event.road_id), "路段不存在");
		else requireRun(event.type === "disaster_confirm" && buildingIds.has(event.building_id), "灾情对象不存在或类型无效");
		const byReport = new Map(reports.map((report) => [report.id, report]));
		requireRun(byReport.size === 10 && postings.size === 10 && new Set(reports.map(({ priority }) => priority)).size === 10, "上报 ID、投放或优先级重复");
		for (const report of reports) {
			requireRun(report.is_training === 1 && typeof report.text === "string" && report.text.length > 0 && whole(report.priority) && report.priority > 0 && postings.get(report.id) === report.appears_at_sim && typeof report.event_truth.is_real === "boolean" && typeof report.event_truth.locatable === "boolean" && (report.event_truth.locatable ? buildingIds.has(report.event_truth.building_id ?? "") : report.event_truth.building_id === null), "上报标签或引用无效");
			const windows = report.judgment_windows;
			requireRun(windows.length > 0 && windows[0]?.from_sim === report.appears_at_sim && windows.every((window, index) => [
				"真报",
				"误报",
				"待核"
			].includes(window.expected) && typeof window.reason === "string" && (index === windows.length - 1 ? window.to_sim === null : window.to_sim === windows[index + 1]?.from_sim && window.to_sim > window.from_sim && window.to_sim <= scenario.t_end)), "判断窗口无效");
		}
		const p = run.progress;
		requireRun(whole(p.node) && whole(p.furthest) && p.node <= p.furthest && p.furthest < times.length && scenario.playback_speeds.includes(p.speed) && whole(p.elapsed_ms) && typeof p.started === "boolean" && typeof p.finished === "boolean" && (!p.finished || p.started && p.furthest === times.length - 1) && (p.started || p.furthest === 0 && !p.elapsed_ms && !run.events.length), "训练进度或时钟无效");
		const seenVerdicts = /* @__PURE__ */ new Map();
		let previousTime = -1;
		let sorted = false;
		const prior = [];
		for (const entry of run.events) {
			requireRun(record(entry) && record(entry.payload) && entry.seq === prior.length + 1 && entry.payload.seq === entry.seq && times.includes(entry.t_sim) && entry.t_sim >= previousTime && entry.t_sim <= times[p.furthest], "流水序号或时刻无效");
			if (entry.kind === "verdict") {
				const v = entry.payload;
				const report = byReport.get(v.report_id);
				requireRun(report && report.appears_at_sim <= entry.t_sim && v.judged_at_sim === entry.t_sim && [
					"真报",
					"误报",
					"待核"
				].includes(v.verdict) && (v.location === null || v.location === "无法定位" || buildingIds.has(v.location)) && v.supersedes_seq === (seenVerdicts.get(v.report_id) ?? null), "判读或改判引用无效");
				seenVerdicts.set(v.report_id, entry.seq);
			} else if (entry.kind === "action") {
				const expected = engine.judgeAction({
					action_id: entry.payload.action_id,
					target_id: entry.payload.target_id,
					submitted_at_sim: entry.t_sim,
					seq: entry.seq,
					prior_events: prior
				});
				requireRun(same$1({
					...expected,
					reject_reason: entry.payload.reject_reason
				}, entry.payload), "动作完成、拒绝或资源流水不一致");
			} else {
				requireRun(entry.kind === "sort" && !sorted && entry.t_sim === scenario.t_end && entry.payload.t_sim === entry.t_sim && Array.isArray(entry.payload.ordered_report_ids) && entry.payload.ordered_report_ids.length === 3 && new Set(entry.payload.ordered_report_ids).size === 3 && entry.payload.ordered_report_ids.every((id) => byReport.has(id)), "末回合排序无效");
				sorted = true;
			}
			prior.push(entry);
			previousTime = entry.t_sim;
		}
		const score = p.finished ? engine.scoreRound(run.events) : null;
		requireRun(same$1(run.score, score), "评分缓存与流水复算不一致");
		return run;
	} catch (error) {
		if (error instanceof RunStoreError) throw error;
		throw new RunStoreError("CORRUPT", "冻结题目或学员流水无法校验");
	}
}
function assertRunUpdate(previous, next) {
	if (next.revision !== previous.revision + 1 || next.created_at !== previous.created_at || Date.parse(next.updated_at) < Date.parse(previous.updated_at) || !same$1(next.bundle, previous.bundle) || !same$1(next.map, previous.map) || !same$1(next.origin, previous.origin) || next.events.length < previous.events.length || !same$1(previous.events, next.events.slice(0, previous.events.length)) || next.progress.furthest < previous.progress.furthest || next.progress.elapsed_ms < previous.progress.elapsed_ms || previous.progress.started && !next.progress.started || previous.progress.finished && (!next.progress.finished || next.events.length !== previous.events.length || next.progress.elapsed_ms !== previous.progress.elapsed_ms)) throw new RunStoreError("CONFLICT", "轮次版本、题目或已有流水发生冲突，请刷新读取最新记录");
}
// server/run-repository.ts
const RUN_COLUMNS = "id,scenario_id,d6_revision,d6_event_seq,d6_progress_json,d6_origin_json,d6_owner_hash,d6_created_at,d6_updated_at,score_json";
const TEMPLATE_COLUMNS = "id,modifiers_json,start_building_id,standard_actions_json,critical_items_json";
const SCENARIO_COLUMNS = "id,d6_bundle_json";
const REPORT_COLUMNS = "id,scenario_id,appears_at_sim,category,text,event_truth_json,judgment_windows_json,priority,is_training";
const EVENT_COLUMNS = "run_id,seq,t_sim,kind,payload_json";
const reportKey = (sid, id) => `${sid.length}:${sid}${id}`;
function iso(value) {
	const date = new Date(String(value));
	if (!Number.isFinite(date.getTime())) throw new Error("database_timestamp_invalid");
	return date.toISOString();
}
function scoreFields(score) {
	return score === null ? {
		score_json: null,
		total_score: null,
		discrimination: null,
		response: null,
		coverage: null,
		violation: null
	} : {
		score_json: score,
		total_score: score.total,
		discrimination: score.discrimination,
		response: score.response,
		coverage: score.coverage,
		violation: score.violation
	};
}
function buildingRow(building) {
	return {
		id: building.id,
		name: building.name,
		zone: building.zone,
		category: building.category,
		floors: building.floors,
		capacity: building.capacity,
		risk_tag: building.risk_tag,
		polygon_json: building.polygon,
		adjacency_json: building.adjacency,
		is_training: 1
	};
}
function scenarioRow(sid, frozen) {
	const scenario = frozen.scenario;
	return {
		id: sid,
		template_id: scenario.template_id,
		source: scenario.source,
		title: scenario.title,
		modifiers_json: scenario.modifiers,
		start_building_id: scenario.start_building_id,
		t_end: scenario.t_end,
		nodes_json: scenario.nodes,
		standard_actions_json: scenario.standard_actions,
		critical_items_json: scenario.critical_items,
		d6_bundle_json: frozen,
		is_training: 1
	};
}
function reportRow(sid, report) {
	return {
		id: reportKey(sid, String(report.id)),
		scenario_id: sid,
		appears_at_sim: report.appears_at_sim,
		category: report.category,
		text: report.text,
		event_truth_json: report.event_truth,
		judgment_windows_json: report.judgment_windows,
		priority: report.priority,
		is_training: 1
	};
}
function eventRow(runId, event) {
	return {
		run_id: runId,
		seq: event.seq,
		t_sim: event.t_sim,
		kind: event.kind,
		payload_json: event.payload
	};
}
function createRunRepository(db) {
	async function select(table, columns, filter, limit) {
		const result = await filter(db.from(table).select(columns)).limit(limit);
		if (result?.error) throw new Error("database_read_failed");
		return Array.isArray(result?.data) ? result.data : [];
	}
	async function insert(table, rows) {
		try {
			return await db.from(table).insert(rows);
		} catch {
			throw new Error("database_write_failed");
		}
	}
	const unique = (error) => error?.error?.code === "23505";
	async function read(runId, owner) {
		const [head] = await select("runs", RUN_COLUMNS, (query) => query.eq("id", runId), 1);
		if (!head || head.d6_owner_hash !== owner || !Number.isSafeInteger(head.d6_revision) || head.d6_revision === 0 || !Number.isSafeInteger(head.d6_event_seq)) return null;
		const sid = String(head.scenario_id);
		const [scene] = await select("scenarios", SCENARIO_COLUMNS, (query) => query.eq("id", sid), 1);
		const frozen = scene?.d6_bundle_json;
		if (!frozen || !Array.isArray(frozen.report_ids)) throw new RunStoreError("CORRUPT", "数据库缺少冻结场景");
		const reportRows = await select("ugc_reports", REPORT_COLUMNS, (query) => query.eq("scenario_id", sid), 20);
		const byReport = new Map(reportRows.map((row) => [row.id, row]));
		const reports = frozen.report_ids.map((id) => {
			const row = byReport.get(reportKey(sid, String(id)));
			if (!row) throw new RunStoreError("CORRUPT", "数据库缺少上报行");
			return {
				id,
				category: row.category,
				appears_at_sim: row.appears_at_sim,
				text: row.text,
				event_truth: row.event_truth_json,
				judgment_windows: row.judgment_windows_json,
				priority: row.priority,
				is_training: row.is_training
			};
		});
		const committed = Number(head.d6_event_seq);
		const events = (await select("run_events", EVENT_COLUMNS, (query) => query.eq("run_id", runId), 1e3)).filter((row) => Number.isSafeInteger(row.seq) && Number(row.seq) >= 1 && Number(row.seq) <= committed).sort((a, b) => Number(a.seq) - Number(b.seq)).map((row) => ({
			seq: row.seq,
			t_sim: row.t_sim,
			kind: row.kind,
			payload: row.payload_json
		}));
		const scenario = frozen.scenario;
		return validateRun({
			schema_version: frozen.schema_version,
			engine_version: frozen.engine_version,
			map_version: frozen.map_version,
			run_id: head.id,
			scenario_id: scenario.id,
			revision: head.d6_revision,
			created_at: iso(head.d6_created_at),
			updated_at: iso(head.d6_updated_at),
			bundle: {
				scenario,
				ugc_reports: reports,
				action_catalog: frozen.action_catalog
			},
			map: frozen.map,
			origin: head.d6_origin_json ?? null,
			progress: head.d6_progress_json,
			events,
			score: head.score_json ?? null
		});
	}
	async function ensureStartBuilding(snapshot) {
		const id = snapshot.bundle.scenario.start_building_id;
		const find = () => select("campus_buildings", "id", (query) => query.eq("id", id), 1);
		if ((await find()).length) return;
		const declared = snapshot.map.buildings.find((building) => building.id === id);
		const trusted = snapshot.map_version === "d2-1" && campusMap.buildings.find((building) => building.id === id);
		if (!declared || !trusted || stable(buildingRow(declared)) !== stable(buildingRow(trusted))) throw new RunStoreError("CORRUPT", "起始楼栋与可信地图不一致");
		const result = await insert("campus_buildings", buildingRow(trusted));
		if (!result?.error) return;
		if (!unique(result) || !(await find()).length) throw new Error("database_write_failed");
	}
	async function ensureTemplate(frozen) {
		const scenario = frozen.scenario;
		const id = String(scenario.template_id);
		const wanted = {
			id,
			modifiers_json: scenario.modifiers,
			start_building_id: scenario.start_building_id,
			standard_actions_json: scenario.standard_actions,
			critical_items_json: scenario.critical_items
		};
		const [existing] = await select("disaster_templates", TEMPLATE_COLUMNS, (query) => query.eq("id", id), 1);
		if (existing) return "ok";
		const result = await insert("disaster_templates", {
			...wanted,
			name: id,
			description: "D6 training template",
			is_training: 1
		});
		if (!result?.error) return "ok";
		if (!unique(result)) throw new Error("database_write_failed");
		const [raced] = await select("disaster_templates", TEMPLATE_COLUMNS, (query) => query.eq("id", id), 1);
		return raced ? "ok" : "conflict";
	}
	async function ensureScenario(sid, frozen) {
		const [existing] = await select("scenarios", SCENARIO_COLUMNS, (query) => query.eq("id", sid), 1);
		if (existing) return stable(existing.d6_bundle_json) === stable(frozen) ? "ok" : "conflict";
		const result = await insert("scenarios", scenarioRow(sid, frozen));
		if (!result?.error) return "ok";
		if (!unique(result)) throw new Error("database_write_failed");
		const [raced] = await select("scenarios", SCENARIO_COLUMNS, (query) => query.eq("id", sid), 1);
		return raced && stable(raced.d6_bundle_json) === stable(frozen) ? "ok" : "conflict";
	}
	async function ensureReports(sid, reports) {
		const existing = await select("ugc_reports", REPORT_COLUMNS, (query) => query.eq("scenario_id", sid), 20);
		const byId = new Map(existing.map((row) => [row.id, row]));
		const wanted = reports.map((report) => reportRow(sid, report));
		for (const row of wanted) {
			const found = byId.get(row.id);
			if (found && stable(found) !== stable(row)) return "conflict";
		}
		const missing = wanted.filter((row) => !byId.has(row.id));
		if (!missing.length) return "ok";
		const result = await insert("ugc_reports", missing);
		if (!result?.error) return "ok";
		if (!unique(result)) throw new Error("database_write_failed");
		const after = await select("ugc_reports", REPORT_COLUMNS, (query) => query.eq("scenario_id", sid), 20);
		const settled = new Map(after.map((row) => [row.id, row]));
		return wanted.every((row) => settled.has(row.id) && stable(settled.get(row.id)) === stable(row)) ? "ok" : "conflict";
	}
	async function ensureEvents(runId, events) {
		const existing = await select("run_events", EVENT_COLUMNS, (query) => query.eq("run_id", runId), 1e3);
		existing.sort((a, b) => Number(a.seq) - Number(b.seq));
		if (existing.length > events.length) return "conflict";
		for (let index = 0; index < existing.length; index++) if (stable(existing[index]) !== stable(eventRow(runId, events[index]))) return "conflict";
		if (existing.length === events.length) return "ok";
		const result = await insert("run_events", events.slice(existing.length).map((event) => eventRow(runId, event)));
		if (!result?.error) return "ok";
		if (!unique(result)) throw new Error("database_write_failed");
		const after = await select("run_events", EVENT_COLUMNS, (query) => query.eq("run_id", runId), 1e3);
		after.sort((a, b) => Number(a.seq) - Number(b.seq));
		if (after.length !== events.length) return "conflict";
		return after.every((row, index) => stable(row) === stable(eventRow(runId, events[index]))) ? "ok" : "conflict";
	}
	async function save(snapshot, owner, expectedRevision) {
		if (!/^[0-9a-f]{64}$/.test(owner)) return "missing";
		const [head] = await select("runs", RUN_COLUMNS, (query) => query.eq("id", snapshot.run_id), 1);
		if (head && head.d6_owner_hash !== owner) return "missing";
		const sid = `d6:${owner}:${snapshot.scenario_id}`;
		if (head && head.scenario_id !== sid) return "conflict";
		if ((head?.d6_revision ?? 0) !== expectedRevision) {
			const actual = await read(snapshot.run_id, owner);
			return actual && stable(actual) === stable(snapshot) ? "saved" : "conflict";
		}
		const frozen = {
			schema_version: snapshot.schema_version,
			engine_version: snapshot.engine_version,
			map_version: snapshot.map_version,
			map: snapshot.map,
			scenario: snapshot.bundle.scenario,
			action_catalog: snapshot.bundle.action_catalog,
			report_ids: snapshot.bundle.ugc_reports.map((report) => report.id)
		};
		await ensureStartBuilding(snapshot);
		if (await ensureTemplate(frozen) === "conflict") return "conflict";
		if (await ensureScenario(sid, frozen) === "conflict") return "conflict";
		if (await ensureReports(sid, snapshot.bundle.ugc_reports) === "conflict") return "conflict";
		const committed = snapshot.events.length;
		const fields = {
			scenario_id: sid,
			playback_speed: snapshot.progress.speed,
			d6_revision: snapshot.revision,
			d6_event_seq: committed,
			d6_progress_json: snapshot.progress,
			d6_origin_json: snapshot.origin,
			d6_owner_hash: owner,
			d6_created_at: snapshot.created_at,
			d6_updated_at: snapshot.updated_at,
			ended_at: snapshot.progress.finished ? snapshot.updated_at : null,
			...scoreFields(snapshot.score)
		};
		if (!head) {
			const result = await insert("runs", {
				id: snapshot.run_id,
				branch: "learner",
				started_at: snapshot.created_at,
				is_training: 1,
				...fields,
				d6_revision: 0,
				d6_event_seq: 0
			});
			if (result?.error) {
				if (!unique(result)) throw new Error("database_write_failed");
				const [raced] = await select("runs", RUN_COLUMNS, (query) => query.eq("id", snapshot.run_id), 1);
				if (!raced) throw new Error("database_read_failed");
				if (raced.d6_owner_hash !== owner) return "missing";
				const racedRun = await read(snapshot.run_id, owner);
				return racedRun && stable(racedRun) === stable(snapshot) ? "saved" : "conflict";
			}
		}
		if (await ensureEvents(snapshot.run_id, snapshot.events) === "conflict") return "conflict";
		const written = await db.from("runs").update(fields).eq("id", snapshot.run_id).eq("d6_owner_hash", owner).eq("d6_revision", expectedRevision).select("id");
		if (written?.error) throw new Error("database_write_failed");
		if (Array.isArray(written?.data) && written.data.length) return "saved";
		const actual = await read(snapshot.run_id, owner);
		return actual && stable(actual) === stable(snapshot) ? "saved" : "conflict";
	}
	return {
		read,
		save
	};
}
// server/run-route.ts
function createRunRoute(db, enabled) {
	const repository = db ? createRunRepository(db) : null;
	const json = (data, status = 200) => Response.json(data, {
		status,
		headers: { "Cache-Control": "no-store" }
	});
	return async function handle(request) {
		if (!enabled() || !repository) return json({ code: "CLOUD_UNAVAILABLE" }, 503);
		if (request.headers.get("sec-fetch-site") === "cross-site") return json({ code: "CROSS_ORIGIN" }, 403);
		if (request.method !== "GET" && request.method !== "PUT") return json({ code: "METHOD" }, 405);
		const key = request.headers.get("x-run-key");
		if (!key || !/^[a-f0-9]{64}$/.test(key)) return json({ code: "NOT_FOUND" }, 404);
		const id = new URL(request.url).searchParams.get("run_id");
		if (!id || !/^[\w-]{12,80}$/.test(id)) return json({ code: "NOT_FOUND" }, 404);
		const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
		const owner = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
		try {
			const stored = await repository.read(id, owner);
			if (request.method === "GET") return stored ? json({ run: stored }) : json({ code: "NOT_FOUND" }, 404);
			if (!request.headers.get("content-type")?.startsWith("application/json")) return json({ code: "CONTENT_TYPE" }, 415);
			const stream = request.body?.pipeThrough(new TextDecoderStream());
			if (!stream) return json({ code: "REQUEST" }, 400);
			let body = "";
			const reader = stream.getReader();
			try {
				for (;;) {
					const { done, value } = await reader.read();
					if (done) break;
					body += value;
					if (body.length > 1e6) {
						await reader.cancel();
						return json({ code: "TOO_LARGE" }, 413);
					}
				}
			} finally {
				reader.releaseLock();
			}
			const input = JSON.parse(body);
			if (!record(input) || typeof input.expected_revision !== "number" || !Number.isSafeInteger(input.expected_revision) || input.expected_revision < 0) return json({ code: "REQUEST" }, 400);
			const incoming = validateRun(input.run);
			if (incoming.run_id !== id) return json({ code: "REQUEST" }, 400);
			if (stored && stable(incoming) === stable(stored)) return json({ revision: stored.revision });
			if (!stored) {
				if (input.expected_revision !== 0) return json({ code: "CONFLICT" }, 409);
			} else {
				if (input.expected_revision !== stored.revision || incoming.revision <= stored.revision) return json({ code: "CONFLICT" }, 409);
				assertRunUpdate(stored, {
					...incoming,
					revision: stored.revision + 1
				});
			}
			const write = await repository.save(incoming, owner, input.expected_revision);
			if (write === "conflict") return json({ code: "CONFLICT" }, 409);
			if (write === "missing") return json({ code: "NOT_FOUND" }, 404);
			return json({ revision: incoming.revision });
		} catch (error) {
			if (error instanceof SyntaxError) return json({ code: "REQUEST" }, 400);
			if (error instanceof RunStoreError) return json({ code: error.code }, error.code === "CONFLICT" ? 409 : 422);
			return json({ code: "CLOUD_UNAVAILABLE" }, 503);
		}
	};
}
// src/scenario-generation/reports.ts
const openings = {
	true_report: [
		"现场补充：",
		"值班记录：",
		"收到一条消息："
	],
	false_report: [
		"核对消息：",
		"补记一条：",
		"转来一条说明："
	],
	emotional: [
		"我想补充：",
		"有点着急：",
		"再发一条："
	],
	vague_location: [
		"我听到的消息：",
		"先转一条：",
		"我也说不准："
	],
	duplicate: [
		"再转一次：",
		"补转原消息：",
		"同一条消息再发一下："
	],
	other: ["补记："]
};
const keys = [
	"id",
	"category",
	"appears_at_sim",
	"priority",
	"event_truth",
	"judgment_windows"
];
function fail(path, code, message) {
	throw new ValidationError({
		path,
		code,
		message
	});
}
function same(a, b) {
	if (record(b)) return record(a) && Object.keys(a).length === Object.keys(b).length && Object.entries(b).every(([key, value]) => same(a[key], value));
	if (Array.isArray(b)) return Array.isArray(a) && a.length === b.length && b.every((item, i) => same(a[i], item));
	return a === b;
}
function copyLabels(report) {
	const { id, category, appears_at_sim, priority, event_truth, judgment_windows } = report;
	return {
		id,
		category,
		appears_at_sim,
		priority,
		event_truth,
		judgment_windows
	};
}
function choices(report) {
	return [report.text, ...openings[report.category].map((opening) => opening + report.text)];
}
function reportCandidates(preset) {
	return preset.map((report) => ({
		...copyLabels(report),
		text: choices(report)
	}));
}
function reportsPrompt(preset, issue) {
	return JSON.stringify({
		task: "d6_reports",
		instruction: "一次返回完整 JSON 数组，恰好 10 个对象。保留每个槽位的全部标签，并把 text 从候选数组中选为单个字符串；优先选不同于预置首项的自然表述。不要添加未给出的事实、地点、答案或解释。",
		slots: reportCandidates(preset),
		previous_validation_issue: issue ? {
			code: issue.code,
			path: issue.path
		} : void 0
	});
}
function validateReportBatch(input, preset) {
	if (!Array.isArray(input) || input.length !== 10) fail("reports", "REPORT_COUNT", "必须一次提交 10 条上报");
	const slots = new Map(preset.map((report) => [report.id, report]));
	const unique = /* @__PURE__ */ new Map();
	for (const [index, value] of input.entries()) {
		const path = "reports." + index;
		if (!record(value) || Object.keys(value).some((key) => ![
			...keys,
			"text",
			"is_training"
		].includes(key)) || value.is_training !== void 0 && value.is_training !== 1) fail(path, "REPORT_STRUCTURE", "上报字段无效");
		const slot = typeof value.id === "string" ? slots.get(value.id) : void 0;
		if (!slot || unique.has(slot.id)) fail(path + ".id", "REPORT_ID", "未知或重复的上报槽位");
		for (const key of keys) if (!same(value[key], slot[key])) fail(path + "." + key, "REPORT_LABEL_CONFLICT", "上报标签与可信槽位不一致");
		const text = value.text;
		if (typeof text !== "string" || !choices(slot).includes(text)) fail(path + ".text", "REPORT_FACT_CONFLICT", "文案与槽位事实或表达范围不符");
		unique.set(slot.id, {
			...slot,
			text
		});
	}
	const reports = preset.map((report) => unique.get(report.id));
	if (reports.every((report, index) => report.text === preset[index]?.text)) fail("reports", "REPORTS_UNCHANGED", "整批文案与预置完全相同");
	return reports;
}
function parseReportBatch(raw, preset) {
	if (raw.length > 24e3) fail("reports", "REPORTS_TOO_LARGE", "上报批次过大");
	let data;
	try {
		data = JSON.parse(raw);
	} catch {
		fail("reports", "INVALID_JSON", "模型上报不是 JSON");
	}
	return validateReportBatch(data, preset);
}
// server/report-stage.ts
async function generateReports(scenario, io, signal) {
	if (scenario.selection !== "generated" || scenario.provider === null) return scenario;
	const provider = scenario.provider;
	const correlation = {
		request_id: scenario.request.request_id,
		provider
	};
	const preset = scenario.bundle.ugc_reports;
	async function fallback(reason) {
		const usage = await Promise.resolve().then(() => io.usage()).catch(() => ({
			calls: null,
			shared_retry_used: null,
			upstream_state: "unknown"
		}));
		return {
			...scenario,
			...usage,
			report_source: "fallback",
			reports: {
				...correlation,
				fallback_reason: reason
			}
		};
	}
	let lastIssue;
	for (const slot of ["reports", "retry"]) try {
		if (signal.aborted || (await io.usage()).upstream_state === "unknown") return fallback("timeout");
		if (!await io.reserve(slot)) return fallback(lastIssue ? "invalid_candidate" : "budget");
		const session = await io.prepare();
		if (signal.aborted) return fallback("timeout");
		if (!await io.markSent(slot, session)) return fallback("budget");
		const candidate = await io.send(session, reportsPrompt(preset, lastIssue));
		await io.complete(slot);
		const reports = parseReportBatch(candidate, preset);
		return {
			...scenario,
			...await io.usage(),
			bundle: {
				...scenario.bundle,
				ugc_reports: reports
			},
			report_source: "generated",
			reports: {
				...correlation,
				fallback_reason: null
			}
		};
	} catch (error) {
		if (signal.aborted) return fallback("timeout");
		if (error instanceof ValidationError) {
			lastIssue = error.issue;
			continue;
		}
		if (typeof error === "object" && error !== null && "definitive" in error && error.definitive === true) try {
			await io.complete(slot);
		} catch {
			return fallback("network");
		}
		return fallback(typeof error === "object" && error !== null && "reason" in error && error.reason === "unauthorized" ? "unauthorized" : "network");
	}
	return fallback("invalid_candidate");
}
export { createRunRoute, generateReports };

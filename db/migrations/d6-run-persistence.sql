-- Snapshot metadata stays separate from score_json. Apply after D2.
ALTER TABLE app.scenarios ADD COLUMN d6_bundle_json JSONB;
ALTER TABLE app.runs ADD COLUMN d6_revision INTEGER;
ALTER TABLE app.runs ADD COLUMN d6_progress_json JSONB;
ALTER TABLE app.runs ADD COLUMN d6_origin_json JSONB;
ALTER TABLE app.runs ADD COLUMN d6_owner_hash TEXT;
ALTER TABLE app.runs ADD COLUMN d6_created_at TIMESTAMPTZ;
ALTER TABLE app.runs ADD COLUMN d6_updated_at TIMESTAMPTZ;

-- Held by the only transaction that can publish a revision of this run.
CREATE FUNCTION app.d6_save_run(snapshot JSONB, owner_hash TEXT, expected_revision INTEGER)
RETURNS TEXT LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, app AS $$
DECLARE
  rid TEXT := snapshot->>'run_id';
  sid TEXT := 'd6:' || owner_hash || ':' || (snapshot->>'scenario_id');
  sc JSONB := snapshot->'bundle'->'scenario';
  prog JSONB := snapshot->'progress';
  frozen JSONB := jsonb_build_object(
    'scenario', sc, 'action_catalog', snapshot->'bundle'->'action_catalog', 'map', snapshot->'map',
    'engine_version', snapshot->'engine_version', 'map_version', snapshot->'map_version',
    'schema_version', snapshot->'schema_version',
    'report_ids', (SELECT jsonb_agg(value->'id' ORDER BY ordinality) FROM jsonb_array_elements(snapshot->'bundle'->'ugc_reports') WITH ORDINALITY));
  prior app.runs%ROWTYPE;
  old_frozen JSONB;
  incoming_revision INTEGER := (snapshot->>'revision')::INTEGER;
  item JSONB;
  saved_item RECORD;
  existing_id TEXT;
BEGIN
  IF owner_hash IS NULL OR owner_hash !~ '^[0-9a-f]{64}$' OR expected_revision IS NULL OR
    expected_revision < 0 OR incoming_revision IS NULL OR incoming_revision < 1 THEN RETURN 'invalid'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('d6-run:' || rid, 0));
  SELECT * INTO prior FROM app.runs WHERE id = rid;
  existing_id := prior.id;
  IF existing_id IS NOT NULL AND prior.d6_owner_hash IS DISTINCT FROM owner_hash THEN RETURN 'missing'; END IF;
  IF existing_id IS NOT NULL AND (prior.scenario_id <> sid OR prior.d6_origin_json IS DISTINCT FROM snapshot->'origin') THEN RETURN 'conflict'; END IF;
  IF COALESCE(prior.d6_revision, 0) <> expected_revision OR incoming_revision <= expected_revision THEN RETURN 'conflict'; END IF;

  -- Existing templates may be absent in D2-only databases. This insert is
  -- idempotent and keeps all pre-existing data and template definitions.
  INSERT INTO app.disaster_templates (id,name,description,modifiers_json,start_building_id,standard_actions_json,critical_items_json)
    VALUES (sc->>'template_id',sc->>'template_id','D6 training template',sc->'modifiers',sc->>'start_building_id',
      sc->'standard_actions',sc->'critical_items') ON CONFLICT (id) DO NOTHING;
  INSERT INTO app.scenarios (id,template_id,source,title,modifiers_json,start_building_id,t_end,nodes_json,standard_actions_json,critical_items_json,d6_bundle_json)
    VALUES (sid,sc->>'template_id',sc->>'source',sc->>'title',sc->'modifiers',sc->>'start_building_id',sc->'t_end',sc->'nodes',
      sc->'standard_actions',sc->'critical_items',frozen) ON CONFLICT (id) DO NOTHING;
  SELECT d6_bundle_json INTO old_frozen FROM app.scenarios WHERE id = sid;
  IF old_frozen IS DISTINCT FROM frozen THEN RAISE EXCEPTION 'D6 scenario conflict' USING ERRCODE = '23505'; END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(snapshot->'bundle'->'ugc_reports') LOOP
    -- Length-prefix is reversible even if scenario IDs contain separators.
    INSERT INTO app.ugc_reports (id,scenario_id,appears_at_sim,category,text,event_truth_json,judgment_windows_json,priority,is_training)
      VALUES (length(sid)::text || ':' || sid || (item->>'id'),sid,item->'appears_at_sim',item->>'category',
        item->>'text',item->'event_truth',item->'judgment_windows',(item->>'priority')::int,1) ON CONFLICT (id) DO NOTHING;
    SELECT appears_at_sim,category,text,event_truth_json,judgment_windows_json,priority,is_training
      INTO saved_item FROM app.ugc_reports WHERE id = length(sid)::text || ':' || sid || (item->>'id');
    IF ROW(saved_item.appears_at_sim,saved_item.category,saved_item.text,saved_item.event_truth_json,saved_item.judgment_windows_json,saved_item.priority,saved_item.is_training)
      IS DISTINCT FROM ROW(item->'appears_at_sim',item->>'category',item->>'text',item->'event_truth',item->'judgment_windows',(item->>'priority')::int,1)
      THEN RAISE EXCEPTION 'D6 report conflict' USING ERRCODE = '23505'; END IF;
  END LOOP;

  IF existing_id IS NULL THEN
    INSERT INTO app.runs (id,scenario_id,branch,playback_speed,d6_owner_hash,d6_created_at)
      VALUES (rid,sid,'learner',prog->'speed',owner_hash,(snapshot->>'created_at')::timestamptz);
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(snapshot->'events') LOOP
    INSERT INTO app.run_events (run_id,seq,t_sim,kind,payload_json)
      VALUES (rid,(item->>'seq')::int,item->'t_sim',item->>'kind',item->'payload') ON CONFLICT (run_id,seq) DO NOTHING;
    SELECT t_sim,kind,payload_json INTO saved_item FROM app.run_events WHERE run_id=rid AND seq=(item->>'seq')::int;
    IF ROW(saved_item.t_sim,saved_item.kind,saved_item.payload_json) IS DISTINCT FROM ROW(item->'t_sim',item->>'kind',item->'payload')
      THEN RAISE EXCEPTION 'D6 event conflict' USING ERRCODE = '23505'; END IF;
  END LOOP;
  IF (SELECT count(*) FROM app.run_events WHERE run_id=rid) <> jsonb_array_length(snapshot->'events')
    THEN RAISE EXCEPTION 'D6 event history is incomplete' USING ERRCODE = '23505'; END IF;

  UPDATE app.runs SET d6_revision=incoming_revision,d6_progress_json=prog,
    d6_origin_json=snapshot->'origin',d6_updated_at=(snapshot->>'updated_at')::timestamptz,
    playback_speed=prog->'speed',score_json=NULLIF(snapshot->'score','null'::jsonb),
    total_score=(snapshot->'score'->>'total')::int,discrimination=snapshot->'score'->'discrimination',
    response=snapshot->'score'->'response',coverage=snapshot->'score'->'coverage',violation=snapshot->'score'->'violation',
    ended_at=CASE WHEN (prog->>'finished')::boolean THEN COALESCE(ended_at,now()) ELSE NULL END
    WHERE id=rid;
  RETURN 'saved';
END $$;

CREATE FUNCTION app.d6_read_run(run_key TEXT, owner_hash TEXT)
RETURNS JSONB LANGUAGE sql SECURITY INVOKER SET search_path = pg_catalog, app AS $$
  SELECT jsonb_build_object(
    'schema_version', s.d6_bundle_json->'schema_version', 'engine_version',s.d6_bundle_json->'engine_version',
    'map_version',s.d6_bundle_json->'map_version','map',s.d6_bundle_json->'map',
    'run_id',r.id,'scenario_id',s.d6_bundle_json->'scenario'->>'id','revision',r.d6_revision,'origin',r.d6_origin_json,
    'created_at',to_char(r.d6_created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'updated_at',to_char(r.d6_updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'progress',r.d6_progress_json,'score',r.score_json,
    'bundle',jsonb_build_object('scenario',s.d6_bundle_json->'scenario','action_catalog',s.d6_bundle_json->'action_catalog',
      'ugc_reports',(SELECT jsonb_agg(jsonb_build_object(
        'id',substring(u.id from length(length(s.id)::text) + length(s.id) + 2),
        'category',u.category,'appears_at_sim',u.appears_at_sim,'text',u.text,'event_truth',u.event_truth_json,
        'judgment_windows',u.judgment_windows_json,'priority',u.priority,'is_training',u.is_training)
        ORDER BY i.ordinality)
        FROM jsonb_array_elements_text(s.d6_bundle_json->'report_ids') WITH ORDINALITY AS i(report_id,ordinality)
        JOIN app.ugc_reports u ON u.scenario_id=s.id AND u.id=length(s.id)::text || ':' || s.id || i.report_id)),
    'events',COALESCE((SELECT jsonb_agg(jsonb_build_object('seq',e.seq,'t_sim',e.t_sim,'kind',e.kind,'payload',e.payload_json)
      ORDER BY e.seq) FROM app.run_events e WHERE e.run_id=r.id),'[]'::jsonb))
  FROM app.runs r JOIN app.scenarios s ON s.id=r.scenario_id
  WHERE r.id=run_key AND r.d6_owner_hash=owner_hash AND r.d6_revision IS NOT NULL
$$;
REVOKE ALL ON FUNCTION app.d6_save_run(JSONB,TEXT,INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.d6_read_run(TEXT,TEXT) FROM PUBLIC;
-- Grant EXECUTE only to the verified Function database role.

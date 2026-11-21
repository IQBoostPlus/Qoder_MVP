"""D6 PostgreSQL adapter integration using a disposable localhost cluster."""
import json
import os
import socket
import subprocess
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

root = Path(__file__).resolve().parent.parent
bin_dir = Path(os.environ["D6_PG_BIN"])
exe_suffix = ".exe" if os.name == "nt" else ""

def tool(executable, args, **options):
    return subprocess.run(
        [str(bin_dir / (executable + exe_suffix)), *args],
        encoding="utf-8", errors="replace", timeout=45, **options,
    )

def literal(value):
    return "'" + value.replace("'", "''") + "'"

def sql_json(value):
    return literal(json.dumps(value, ensure_ascii=False)) + "::jsonb"

with socket.socket() as sock:
    sock.bind(("127.0.0.1", 0))
    port = str(sock.getsockname()[1])

with tempfile.TemporaryDirectory(prefix="d6-postgres-") as temp:
    data = Path(temp) / "db"
    env = {**os.environ, "PGCLIENTENCODING": "UTF8"}
    tool("initdb", ["-D", str(data), "-U", "d6_test", "-A", "trust",
                    "--encoding=UTF8", "--no-locale"], stdout=subprocess.DEVNULL, check=True)
    tool("pg_ctl", ["-D", str(data), "-l", str(Path(temp) / "postgres.log"),
                    "-o", f"-h 127.0.0.1 -p {port}", "-w", "start"],
         stdout=subprocess.DEVNULL, check=True)

    def sql(statement, ok=True):
        result = tool("psql", ["-XqAt", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1",
                               "-p", port, "-U", "d6_test", "-d", "postgres"],
                      input=statement, env=env, capture_output=True)
        assert (result.returncode == 0) == ok, result.stderr
        return result.stdout.strip()

    try:
        sql("create schema app;")
        for name in ("d2-campus-app.sql", "d5-generation-ledger-baseline.sql", "d6-run-persistence.sql"):
            sql((root / "db/migrations" / name).read_text(encoding="utf-8"))
        print("PostgreSQL: D2, D5 baseline and D6 migrations applied.")
        fixture = json.loads((root / "fixtures/canonical-run.json").read_text(encoding="utf-8"))
        campus = json.loads((root / "fixtures/campus-map.json").read_text(encoding="utf-8"))
        sql("""insert into app.campus_buildings (id,name,category,zone,capacity,polygon_json,adjacency_json)
            select id,name,category,zone,capacity,polygon,adjacency from jsonb_to_recordset("""
            + sql_json(campus["buildings"]) + """)
            as x(id text,name text,category text,zone text,capacity integer,polygon jsonb,adjacency jsonb);""")
        owner = "f" * 64

        def make(label, index):
            scenario = fixture["scenario"] | {"id": "d6-test-scenario-" + label}
            run = fixture["runs"][index]
            return dict(
                schema_version=1, engine_version="d4-1", map_version="d2-1",
                map={k: campus[k] for k in ("buildings", "junctions", "road_segments")},
                run_id="d6-testing-run-" + label, scenario_id=scenario["id"], revision=1,
                created_at="2026-11-21T00:00:00.000Z", updated_at="2026-11-21T00:00:00.000Z",
                bundle=dict(scenario=scenario, ugc_reports=fixture["ugc_reports"], action_catalog=fixture["action_catalog"]),
                origin=None, progress=dict(node=len(scenario["nodes"])-1, furthest=len(scenario["nodes"])-1,
                                           started=True, finished=True, speed=1, elapsed_ms=1000),
                events=run["events"], score=fixture["expected_scores"][run["run_id"]],
            )

        def put(run, expected=0, ok=True):
            return sql(f"select app.d6_save_run({sql_json(run)},{literal(owner)},{expected});", ok)

        def read(run, who=owner):
            return sql(f"select app.d6_read_run({literal(run['run_id'])},{literal(who)});")

        one, two = make("alpha", 0), make("beta", 1)
        with ThreadPoolExecutor(max_workers=4) as pool:
            outcome = list(pool.map(lambda _: put(one), range(4)))
        assert outcome.count("saved") == 1 and outcome.count("conflict") == 3, outcome
        assert put(two) == "saved"
        for run in (one, two):
            restored = json.loads(read(run))
            assert restored == run, [key for key in restored if restored[key] != run[key]]
            assert read(run, "0" * 64) == ""
        newer = one | {"revision": 2}
        assert put(newer, 1) == "saved"
        bad = one | {"revision": 3, "events": json.loads(json.dumps(one["events"]))}
        bad["events"][0]["payload"]["duration_sim"] = 333
        put(bad, 2, False)
        assert json.loads(read(one)) == newer
        broken = make("rollback", 0)
        broken["events"][1]["seq"] = broken["events"][0]["seq"]
        put(broken, 0, False)
        assert read(broken) == ""
        assert sql("select count(*) from app.scenarios;") == "2"
        assert sql("select count(*) from app.ugc_reports;") == "20"
        assert sql("select count(*) from app.run_events;") == "39"
        print("Two runs read back every field, with 20 distinct report rows and 39 events.")
        print("Four first writers: one commit, three conflicts. Wrong owner denied, conflicting seq and partial writes rolled back.")
    finally:
        tool("pg_ctl", ["-D", str(data), "-m", "fast", "-w", "stop"],
             stdout=subprocess.DEVNULL, check=True)

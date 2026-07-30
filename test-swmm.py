from pyswmm import Simulation, Nodes
import json, sys

inp = """[TITLE]
Test SWMM Run
[OPTIONS]
FLOW_UNITS CMS
INFILTRATION HORTON
START_DATE 01/01/2023
START_TIME 00:00:00
END_DATE 01/01/2023
END_TIME 02:00:00
REPORT_STEP 00:05:00
WET_STEP 00:01:00
DRY_STEP 00:15:00
ROUTING_STEP 00:00:30

[RAINGAGES]
G1 INTENSITY 0:30 1.0 TIMESERIES TS1

[SUBCATCHMENTS]
S1 G1 O1 1.0 50 100 0.5

[SUBAREAS]
S1 0.5 0.01 0.1 0.1 25

[INFILTRATION]
S1 3.0 0.5 0.25 7.0

[OUTFALLS]
O1 0 FREE

[TIMESERIES]
TS1 0:00 0.0
TS1 1:00 25.4
TS1 2:00 0.0

[REPORT]
NODES ALL
LINKS ALL
"""

with open('/tmp/t.inp', 'w') as f:
    f.write(inp)

try:
    sim = Simulation('/tmp/t.inp')
    sim.execute()
    maxd = 0
    steps = 0
    for step in sim:
        steps += 1
        for node in Nodes(sim):
            if node.depth > maxd:
                maxd = node.depth
    print(json.dumps({"ok": True, "timesteps": steps, "max_depth": round(maxd, 3)}))
    sim.close()
except Exception as e:
    print(json.dumps({"ok": False, "error": str(e)}))

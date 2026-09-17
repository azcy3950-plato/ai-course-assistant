"""SWMM engine execution and output extraction for the student sandbox. No synthetic results."""
import sys, json, re
from enum import Enum
from pathlib import Path
from swmm.toolkit import solver, output as out
from swmm.toolkit.shared_enum import ElementType, Time, NodeAttribute, SystemAttribute

def rows(text, name):
    found=re.search(r'\['+name+r'\]([\s\S]*?)(?=\n\s*\[|$)',text,re.I)
    return [line.split(';')[0].split() for line in (found.group(1) if found else '').splitlines() if line.split(';')[0].strip()]

def run(inp, result_file, mapping_file):
    inp=Path(inp); rpt=inp.with_suffix('.rpt'); binary=inp.with_suffix('.out')
    raw=inp.read_bytes()
    try: text=raw.decode('utf-8')
    except UnicodeDecodeError: text=raw.decode('gb18030')
    # This campus model uses CMS and hectares; stats volumes are cubic metres.
    if dict((r[0],r[1]) for r in rows(text,'OPTIONS')).get('FLOW_UNITS')!='CMS':
        raise ValueError('The campus runner requires a CMS model')
    mapping=json.loads(Path(mapping_file).read_text(encoding='utf-8'))
    subcatchments=rows(text,'SUBCATCHMENTS')
    zone_totals={str(i):0.0 for i in range(1,11)}
    solver.swmm_open(str(inp),str(rpt),str(binary))
    try:
        solver.swmm_start(True)
        while solver.swmm_step()>0: pass
        # Totals use every internal solver step, not sparse report samples.
        runoff_volume=float(solver.system_get_runoff_totals().runoff)*sum(float(r[3]) for r in subcatchments)*10
        flood_volume=float(solver.system_get_routing_totals().flooding)
        for i,row in enumerate(subcatchments):
            zone=mapping.get(row[0])
            if zone: zone_totals[str(zone)]+=float(solver.subcatch_get_stats(i).runoff)
        # Continuity errors are finalised by swmm_end(), not swmm_step().
        solver.swmm_end()
        errors=list(solver.swmm_get_mass_balance())
        solver.swmm_report()
    finally: solver.swmm_close()
    h=out.init();out.open(h,str(binary))
    try:
        count=out.get_times(h,Time.NUM_PERIODS);end=count-1;step=out.get_times(h,Time.REPORT_STEP)
        def system(attr):return [float(x) for x in out.get_system_series(h,attr,0,end)]
        runoff=system(SystemAttribute.RUNOFF_FLOW); discharge=system(SystemAttribute.OUTFALL_FLOWS)
        sizes=out.get_proj_size(h)
        nodes={};node_ids=[]
        for i in range(sizes[1]):
            name=out.get_elem_name(h,ElementType.NODE,i)
            if isinstance(name,bytes):name=name.decode('utf-8')
            node_ids.append(name)
            nodes[name]=[round(float(v),5) for v in out.get_node_series(h,i,NodeAttribute.INVERT_DEPTH,0,end)]
        outfall_ids={r[0] for r in rows(text,'OUTFALLS')};outfalls=[i for i,n in enumerate(node_ids) if n in outfall_ids]
        flows={i:list(out.get_node_series(h,i,NodeAttribute.TOTAL_INFLOW,0,end)) for i in outfalls}
        pollutants={};pollutant_rows=rows(text,'POLLUTANTS')
        # The Python binding requires Enum members. Plain ints silently read
        # attribute 0 (node depth), so each pollutant needs a typed attribute.
        quality_attributes=Enum('QualityAttribute',{str(i):NodeAttribute.POLLUT_CONC_0.value+i for i in range(len(pollutant_rows))})
        for pi,row in enumerate(pollutant_rows):
            name=row[0];rate=[0.0]*count;flow_sum=[0.0]*count
            concentrations={i:list(out.get_node_series(h,i,quality_attributes[str(pi)],0,end)) for i in outfalls}
            for i in outfalls:
                for t in range(count):
                    q=max(0,float(flows[i][t]));flow_sum[t]+=q;rate[t]+=q*max(0,float(concentrations[i][t]))/1000
            pollutants[name]={'concentration':[rate[t]*1000/flow_sum[t] if flow_sum[t]>1e-10 else 0 for t in range(count)],'load':sum(rate)*step,'loadRate':rate}
        result={'source':'SWMM','engine':str(out.get_version(h)),'times':[(i+1)*step/3600 for i in range(count)],'runoff':runoff,'outflow':discharge,
                'runoffVolume':runoff_volume,'peakFlow':max(discharge,default=0),'floodVolume':flood_volume,
                'maxDepth':max((max(v,default=0) for v in nodes.values()),default=0),
                'continuity':dict(zip(['runoff','routing','quality'],errors)),
                'pollutants':pollutants,'zoneRunoff':zone_totals,'nodeDepth':nodes}
    finally:out.close(h)
    Path(result_file).write_text(json.dumps(result,allow_nan=False),encoding='utf-8')

if __name__=='__main__':
    run(*sys.argv[1:4])

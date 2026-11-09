#!/usr/bin/env python3
"""Check exact object identity and revisions from the synthetic native/Web story.
Consumes only the fixture's public, token-free manifests; never calls a remote API.
"""
import argparse,json
from pathlib import Path

def require(condition,message):
    if not condition: raise ValueError(message)

def plan(path):
    value=json.loads(Path(path).read_text())
    matches=[p for p in value['plans'] if p['draft']['title']=='N5 three-surface plan']
    require(len(matches)==1,'Expected exactly one joint plan')
    return matches[0]

def identity(before,after):
    require(after['id']==before['id'],'Canonical plan ID changed')
    require(after['goal_id']==before['goal_id'],'Canonical goal ID changed')
    require(after['draft']['tasks'][0]['id']==before['draft']['tasks'][0]['id'],'Draft action ID changed')

def main():
    p=argparse.ArgumentParser();p.add_argument('--web',required=True);p.add_argument('--ios',required=True)
    p.add_argument('--android');p.add_argument('--completed');p.add_argument('--conflict');p.add_argument('--requests');p.add_argument('--output',required=True)
    args=p.parse_args();initial=plan(args.web);ios=plan(args.ios)
    require(initial['version']==1 and initial['status']=='proposed' and initial['tasks']==[],'Web v1 must be inert')
    require(initial['draft']['tasks'][0]['title']=='N5 web draft action','Unexpected Web input')
    identity(initial,ios)
    require(ios['version']==2 and ios['status']=='proposed' and ios['tasks']==[],'iOS v2 must be inert')
    require(ios['draft']['tasks'][0]['title']=='N5 iOS edited same action','iOS must replace the complete title, not insert or append text')
    result={'plan_id':initial['id'],'goal_id':initial['goal_id'],'web_to_ios_exact_edit':True}
    if args.android or args.completed:
        require(bool(args.android and args.completed),'Supply both Android and completion manifests')
        android=plan(args.android);completed=plan(args.completed)
        for value in [android,completed]:
            identity(initial,value)
            require(value['version']==4 and value['status']=='active','Confirmed plan must remain v4')
            require(len(value['tasks'])==1,'Exactly one executable task is allowed')
            require(value['draft']['tasks'][0]['title']=='N5 Android edited same action','Unexpected confirmed draft')
        task=android['tasks'][0];final=completed['tasks'][0]
        require(task['id']==final['id'],'Completion created a different task')
        require(task['status']=='pending' and final['status']=='completed','Expected explicit completion of the same task')
        require(task['estimated_duration_minutes'] is None,'Unknown effort must remain unknown')
        require(bool(args.conflict and args.requests),'Supply conflict and request manifests for the full story')
        require(plan(args.conflict)==android,'Stale Web write changed the confirmed plan')
        requests=json.loads(Path(args.requests).read_text())['requests']
        require(any(r['status']==409 and initial['id'] in r['path'] for r in requests),'No actual stale-plan 409 observed')
        failures=[r for r in requests if r['status']>=500]
        require(all(r['path']=='/api/v1/lighttick/action-plans' and r['status']==503 for r in failures),'Unexpected API server failure')
        result.update(task_id=task['id'],full_three_surface_plan_story=True,completed_same_task=True,
                      stale_write_status=409,conflict_no_side_effects=True,background_feature_unavailable=failures)
    result['passed']=True;Path(args.output).write_text(json.dumps(result,indent=2));print(json.dumps(result))

if __name__=='__main__':main()

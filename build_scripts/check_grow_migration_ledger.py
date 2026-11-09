"""Fail closed on unreviewed legacy behavior. This is a local evidence gate, never a deployment command."""
import argparse
import json


def check(ledger, inventory):
    entries=ledger['entries'];keys=[(row['method'],row['legacy_path']) for row in entries]
    declared={(row['method'],row['path']) for row in inventory['declarations']}
    errors=[]
    if len(set(keys))!=len(keys):errors.append('Duplicate operation identities')
    if declared-set(keys):errors.append('Current declarations are missing from the ledger')
    if inventory['unresolved'] or inventory['baseline_not_located']:errors.append('Source registration inventory is unresolved')
    pending=[]
    for row in entries:
        if row.get('disposition') not in {'verified_native','retired_authorized'}:
            pending.append(row);continue
        if not row.get('acceptance_evidence') or not row.get('test_evidence'):
            errors.append(row['method']+' '+row['legacy_path']+' lacks operation-specific implementation/test evidence')
        if row['disposition']=='verified_native' and not row.get('target_contract'):
            errors.append(row['method']+' '+row['legacy_path']+' lacks a reviewed canonical contract')
        if row['disposition']=='retired_authorized' and not row.get('authorization_reference'):
            errors.append(row['method']+' '+row['legacy_path']+' lacks explicit retirement authorization')
    return {'passed':not errors and not pending,'operations':len(entries),'pending_semantic_review':len(pending),'errors':errors,'note':'Route/page existence and successful builds never establish legacy behavior equivalence.'}


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--ledger',required=True);parser.add_argument('--inventory',required=True);args=parser.parse_args()
    with open(args.ledger) as f:ledger=json.load(f)
    with open(args.inventory) as f:inventory=json.load(f)
    result=check(ledger,inventory);print(json.dumps(result,ensure_ascii=False));raise SystemExit(0 if result['passed'] else 1)

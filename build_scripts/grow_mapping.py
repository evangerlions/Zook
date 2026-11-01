"""Offline Z0 mapping-review validator, never a database importer or authority switch."""
import json
import re
from pathlib import Path

MODULES = {'record', 'goal', 'plan_cycle', 'task', 'action_workspace', 'action_link', 'course_route', 'lesson', 'learning_private'}
KEYS = ('source_instance', 'source_account', 'module', 'legacy_id')


def validate(document):
    if document.get('schema_version') != 1 or not isinstance(document.get('objects'), list):
        raise ValueError('Unsupported mapping review document.')
    identities = {}
    canonical = {}
    for row in document['objects']:
        for key in (*KEYS, 'app_id', 'user_id', 'canonical_id', 'owner_verification_ref'):
            if not isinstance(row.get(key), str) or not row[key].strip():
                raise ValueError('Missing explicit mapping identity: '+key)
        if row['module'] not in MODULES:
            raise ValueError('Unknown mapping module.')
        if row.get('authority') != 'legacy' or row.get('authority_epoch') != 0:
            raise ValueError('Z0 manifest cannot claim authority cutover.')
        for key in ('source_version', 'canonical_revision'):
            if not isinstance(row.get(key), (str, int)) or isinstance(row[key], bool) or str(row[key]) == '':
                raise ValueError('Keep source and canonical versions separately: '+key)
        if row.get('completed_at') is not None and not isinstance(row['completed_at'], str):
            raise ValueError('Unknown completion time stays null.')
        key = tuple(row[k] for k in KEYS)
        owner = (row['app_id'], row['user_id'])
        target = (*owner, row['module'], row['canonical_id'])
        if key in identities and identities[key] != (target, row):
            raise ValueError('Source identity remapped or replay content changed.')
        if target in canonical and canonical[target] != key:
            raise ValueError('Distinct source objects cannot be merged by name or content.')
        identities[key] = (target, row)
        canonical[target] = key
    return {'objects': len(identities), 'owners': len({v[0][:2] for v in identities.values()}), 'authority': 'legacy'}


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('manifest', type=Path)
    args = parser.parse_args()
    print(json.dumps(validate(json.loads(args.manifest.read_text()))))

#!/usr/bin/env python3
"""Run on the deployment server after actual dev functional acceptance, never before it."""
import argparse
from pathlib import Path
from grow_acceptance import accept

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--deploy-root',type=Path,default=Path('.deploy'))
    parser.add_argument('--evidence',type=Path,required=True)
    args = parser.parse_args()
    try:
        receipt = accept(args.deploy_root,args.evidence)
        print('Accepted dev source '+receipt['source_main']+'; locked image IDs will be promoted, not rebuilt.')
    except (ValueError,OSError) as exc:
        parser.exit(2,str(exc)+'\n')

"""Refresh bundled Grow checksums after reviewing service source changes."""
import argparse
import json
from pathlib import Path
from grow_source import bundled_archive, read_lock, sha


def refresh(repo, check=False):
    path = repo/'deploy_configs/grow-source.lock.json'
    lock = read_lock(path)
    if lock.get('source_type') != 'bundled':
        raise ValueError('Only bundled source locks may be refreshed here.')
    root = repo/'services/grow'
    updates = {'archive_sha256': sha(bundled_archive(root)),
               'dockerfile_sha256': sha((root/'Dockerfile').read_bytes()),
               'requirements_lock_sha256': sha((root/'requirements.lock').read_bytes())}
    if check:
        if any(lock[key] != value for key, value in updates.items()):
            raise ValueError('Bundled Grow source lock is stale.')
    else:
        path.write_text(json.dumps({**lock, **updates}, indent=2)+'\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    refresh(Path(__file__).resolve().parents[1], args.check)

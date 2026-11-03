"""Pinned legacy Grow source packaging; never exports user runtime data or credentials."""
import hashlib
import io
import json
import re
import subprocess
import tarfile
from pathlib import Path, PurePosixPath

REPOSITORY = 'xiaohao19910303/grow'
REMOTE_URLS = {'git@github.com:xiaohao19910303/grow.git', 'https://github.com/xiaohao19910303/grow.git'}
PUBLIC_FOLDERS = ('知行成长/学习资料/英文阅读/每日文章/', '知行成长/学习资料/结构化表达/每日练习/', '知行成长/学习资料/现代思维工具教程/')


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read_lock(path):
    lock = json.loads(path.read_text())
    if lock.get('schema_version') != 1 or lock.get('repository') != REPOSITORY or lock.get('protocol_version') != 1:
        raise ValueError('Unsupported Grow source lock/repository/protocol.')
    for key, size in [('commit', 40), ('archive_sha256', 64), ('dockerfile_sha256', 64), ('requirements_lock_sha256', 64)]:
        if not isinstance(lock.get(key), str) or not re.fullmatch('[0-9a-f]{'+str(size)+'}', lock[key]):
            raise ValueError('Invalid Grow lock field: ' + key)
    if not re.fullmatch(r'python@sha256:[0-9a-f]{64}', str(lock.get('base_image', ''))):
        raise ValueError('Grow base image must be an immutable official python digest.')
    if lock.get('source_type', 'mirror') not in ('mirror', 'bundled'):
        raise ValueError('Unsupported Grow source type.')
    return lock


def read_archive(mirror, lock):
    """Archive a locked object; dirty worktree and moving HEAD never participate."""
    if lock.get('source_type') == 'bundled':
        value = bundled_archive(Path(mirror))
        if sha(value) != lock['archive_sha256']:
            raise ValueError('Bundled Grow source checksum mismatch; review and refresh the source lock.')
        return value
    mirror = Path(mirror).resolve()
    def git(*args, check=True):
        return subprocess.run(['git', '--git-dir='+str(mirror), *args], check=check, capture_output=True)
    remote = git('config', '--get', 'remote.origin.url').stdout.decode().strip()
    if remote not in REMOTE_URLS:
        raise ValueError('Grow mirror origin is not the approved repository.')
    if git('cat-file', '-e', lock['commit']+'^{commit}', check=False).returncode:
        # No branch fetch/fallback, no credentials in a URL or argv.
        if git('fetch', '--no-tags', 'origin', lock['commit'], check=False).returncode:
            raise ValueError('Locked Grow commit unavailable; check mirror credentials/object retention.')
    value = git('archive', '--format=tar', lock['commit']).stdout
    if len(value) > 256 * 1024 * 1024 or sha(value) != lock['archive_sha256']:
        raise ValueError('Grow source archive checksum/size mismatch.')
    return value


def bundled_archive(directory):
    """Deterministic, allowlisted build context owned by the Zook release tree."""
    if not directory.is_dir() or directory.is_symlink():
        raise ValueError('Bundled Grow source directory is missing or a symlink.')
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode='w', format=tarfile.PAX_FORMAT) as archive:
        for path in sorted(directory.rglob('*')):
            name = path.relative_to(directory).as_posix()
            if path.is_symlink():
                raise ValueError('Bundled Grow source must not contain symlinks.')
            if not path.is_file() or not selected(name):
                continue
            data = path.read_bytes()
            item = tarfile.TarInfo(name)
            item.size, item.mode = len(data), 0o644
            archive.addfile(item, io.BytesIO(data))
    return output.getvalue()


def selected(name):
    path = PurePosixPath(name)
    if path.is_absolute() or '..' in path.parts:
        raise ValueError('Unsafe archive path.')
    if name in ('Dockerfile', '.dockerignore', 'requirements.txt', 'requirements.lock'):
        return True
    if any(part.startswith('.') or part in ('tests', '__pycache__', '.venv', 'runtime', 'node_modules') for part in path.parts):
        return False
    if path.suffix.lower() in ('.db', '.log', '.pyc', '.sqlite', '.sqlite3', '.pem', '.key', '.p12', '.pfx', '.dump', '.bak') or path.name == 'pending_sync.json':
        return False
    if path.name.startswith(('test_', 'test-', 'requirements-test')):
        return False
    if name.startswith('知行成长/server/'):
        return True
    return any(name.startswith(prefix) and '/' not in name[len(prefix):] and name.endswith('.md') for prefix in PUBLIC_FOLDERS)


def extract_context(data, lock, destination):
    if len(data) > 256 * 1024 * 1024 or sha(data) != lock['archive_sha256']:
        raise ValueError('Grow source archive checksum/size mismatch.')
    seen = set()
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:') as archive:
        for item in archive:
            if item.isdir():
                continue
            if not selected(item.name):
                continue
            if not item.isfile() or item.name in seen:
                raise ValueError('Grow build context contains a link/duplicate/special file.')
            seen.add(item.name)
            target = destination / item.name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(archive.extractfile(item).read())
    dockerfile = destination / 'Dockerfile'
    for filename, key in [('Dockerfile', 'dockerfile_sha256'), ('requirements.lock', 'requirements_lock_sha256')]:
        if not (destination / filename).is_file() or sha((destination / filename).read_bytes()) != lock.get(key):
            raise ValueError('Grow pinned file mismatch: '+filename)
    source = dockerfile.read_text()
    if source.splitlines()[0] != 'FROM python:3.12-slim-bookworm' or len(re.findall(r'^FROM ', source, re.M)) != 1:
        raise ValueError('Grow Dockerfile needs explicit base-image review.')
    dockerfile.write_text(source.replace('FROM python:3.12-slim-bookworm', 'FROM '+lock['base_image'], 1))

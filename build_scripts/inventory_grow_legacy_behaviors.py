"""Source-only FastAPI declaration audit. Never import or start the historical service."""
import argparse
import ast
import hashlib
import json
import re
import subprocess
from pathlib import Path

METHODS = {'get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'websocket', 'api_route', 'route'}


def literal(node, values):
    if isinstance(node, ast.Constant):
        return node.value
    if isinstance(node, ast.Name):
        return values.get(node.id)
    if isinstance(node, (ast.List, ast.Tuple)):
        return [literal(item, values) for item in node.elts]
    if isinstance(node, ast.Dict):
        keys = [literal(item, values) for item in node.keys]
        if all(isinstance(key, str) for key in keys):
            return dict(zip(keys, [literal(item, values) for item in node.values]))
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
        left, right = literal(node.left, values), literal(node.right, values)
        if isinstance(left, str) and isinstance(right, str):
            return left + right
    if isinstance(node, ast.JoinedStr):
        parts = [literal(item.value, values) if isinstance(item, ast.FormattedValue) else literal(item, values) for item in node.values]
        if all(isinstance(part, (str, int)) for part in parts):
            return ''.join(str(part) for part in parts)
    return None


def condition(node, values):
    if isinstance(node, ast.Compare) and len(node.ops) == 1:
        left, right = literal(node.left, values), literal(node.comparators[0], values)
        if left is not None and right is not None:
            if isinstance(node.ops[0], ast.In): return left in right
            if isinstance(node.ops[0], ast.NotIn): return left not in right
            if isinstance(node.ops[0], ast.Eq): return left == right
            if isinstance(node.ops[0], ast.NotEq): return left != right
    return None


def declarations(source, filename, receiver_prefixes=None, module_info=None, link=None):
    tree = ast.parse(source, filename=filename)
    found, unresolved = [], []
    checksum = hashlib.sha256(source.encode('utf8')).hexdigest()

    def route(call, values, routers, handler, line):
        if not isinstance(call, ast.Call) or not isinstance(call.func, ast.Attribute):
            return
        method = call.func.attr
        if method not in METHODS | {'add_api_route'}:
            return
        receiver = call.func.value.id if isinstance(call.func.value, ast.Name) else None
        if receiver is None:
            return
        args = {keyword.arg: keyword.value for keyword in call.keywords}
        path = literal(call.args[0] if call.args else args.get('path'), values)
        prefix = routers.get(receiver, '' if receiver in {'app', 'application'} else None)
        methods = literal(args.get('methods'), values) if method in {'route', 'api_route', 'add_api_route'} else [method.upper()]
        if methods is None and method in {'route', 'api_route', 'add_api_route'}:
            methods = ['GET']
        if not isinstance(path, str) or prefix is None or not isinstance(methods, list) or not all(isinstance(item,str) for item in methods):
            unresolved.append({'file': filename, 'line': line, 'handler': handler, 'expression': ast.unparse(call), 'reason': 'Dynamic route/prefix/methods require registration review; never guessed.'})
            return
        schema = literal(args.get('include_in_schema'), values)
        for verb in methods:
            found.append({'method': str(verb).upper(), 'path': re.sub(r'\{([^{}:]+):[^{}]+\}', r'{\1}', prefix + path), 'file': filename, 'line': line, 'handler': handler, 'hidden': schema is False or method == 'websocket', 'source_sha256': checksum, 'registration': 'declaration_only'})

    def walk(statements, inherited=None, inherited_routers=None, inherited_imports=None):
        values, routers, imports = dict(inherited or {}), dict(inherited_routers or {}), dict(inherited_imports or {})
        for statement in statements:
            if isinstance(statement, ast.ImportFrom) and module_info is not None:
                package = list(Path(filename).parent.parts)
                if statement.level:
                    package = package[:len(package)-statement.level+1]
                else:
                    package=[]
                base = package + ((statement.module or '').split('.') if statement.module else [])
                for alias in statement.names:
                    target = '/'.join(base + ([] if statement.module else [alias.name])) + '.py'
                    symbol = alias.name if statement.module else None
                    imports[alias.asname or alias.name] = (target,symbol)
                    if target in module_info and symbol in module_info[target]['constants']:
                        values[alias.asname or alias.name] = module_info[target]['constants'][symbol]
            if isinstance(statement, (ast.Assign, ast.AnnAssign)):
                targets = statement.targets if isinstance(statement, ast.Assign) else [statement.target]
                value = statement.value
                for target in targets:
                    if isinstance(target, ast.Name):
                        values[target.id] = literal(value, values)
                        if isinstance(value, ast.Call) and isinstance(value.func, ast.Name) and value.func.id == 'APIRouter':
                            prefix = next((item.value for item in value.keywords if item.arg == 'prefix'), ast.Constant(''))
                            routers[target.id] = literal(prefix, values)
            if isinstance(statement, (ast.FunctionDef, ast.AsyncFunctionDef)):
                for decorator in statement.decorator_list:
                    before=len(found)
                    route(decorator, values, routers, statement.name, statement.lineno)
                    for row in found[before:]:row['summary']=(ast.get_docstring(statement) or '').strip()[:300]
                walk(statement.body, values, routers, imports)
            elif isinstance(statement, ast.ClassDef):
                walk(statement.body, values, routers, imports)
            elif isinstance(statement, (ast.Expr, ast.Assign, ast.AnnAssign)) and isinstance(statement.value, ast.Call):
                call = statement.value
                if isinstance(call.func, ast.Attribute) and call.func.attr == 'add_api_route':
                    endpoint = next((item.value for item in call.keywords if item.arg == 'endpoint'), call.args[1] if len(call.args) > 1 else ast.Constant('unknown'))
                    route(call, values, routers, ast.unparse(endpoint), statement.lineno)
                if link is not None and isinstance(call.func, ast.Name) and call.func.id in imports and call.args:
                    target,symbol=imports[call.func.id]
                    for index,arg in enumerate(call.args):
                        receiver=arg.id if isinstance(arg,ast.Name) else None
                        prefix=routers.get(receiver,'' if receiver in {'app','application'} else None)
                        if prefix is not None:link(target,symbol,index,prefix)
            elif isinstance(statement, ast.For):
                iterable = literal(statement.iter,values)
                if isinstance(statement.iter,ast.Call) and isinstance(statement.iter.func,ast.Attribute) and statement.iter.func.attr=='items':
                    mapping=literal(statement.iter.func.value,values)
                    if isinstance(mapping,dict):iterable=list(mapping.items())
                if isinstance(iterable,(list,tuple)) and len(iterable)<=100:
                    for item in iterable:
                        local=dict(values)
                        if isinstance(statement.target,ast.Name):local[statement.target.id]=item
                        elif isinstance(statement.target,ast.Tuple) and isinstance(item,(list,tuple)):
                            for target,value in zip(statement.target.elts,item):
                                if isinstance(target,ast.Name):local[target.id]=value
                        walk(statement.body,local,routers,imports)
                else:walk(statement.body,values,routers,imports)
                walk(statement.orelse,values,routers,imports)
            elif isinstance(statement, ast.If):
                answer=condition(statement.test,values)
                if answer is not False:walk(statement.body,values,routers,imports)
                if answer is not True:walk(statement.orelse,values,routers,imports)
            elif isinstance(statement, (ast.While, ast.With, ast.Try)):
                for name in ['body', 'orelse', 'finalbody']:
                    walk(getattr(statement, name, []), values, routers,imports)
                for handler in getattr(statement, 'handlers', []):
                    walk(handler.body, values, routers,imports)
    walk(tree.body,inherited_routers=receiver_prefixes)
    return found, unresolved


def inventory(root, baseline):
    rows, unresolved, files, modules = [], [], [], {}
    try:
        paths=[root / name for name in subprocess.check_output(['git','-C',str(root),'ls-files','-z','--cached','--others','--exclude-standard','--','*.py'],stderr=subprocess.DEVNULL).decode('utf8').split('\0') if name]
    except subprocess.CalledProcessError:
        paths=list(root.rglob('*.py'))
    for path in sorted(set(paths)):
        relative = path.relative_to(root)
        if path.is_symlink() or not path.is_file() or any(part in {'tests', '.venv', 'venv', '__pycache__', '.worktrees', '.runtime', 'runtime', 'private', 'uploads', 'backups', 'node_modules'} for part in relative.parts) or path.name.startswith('test_'):
            continue
        source = path.read_text(encoding='utf8')
        files.append({'file': str(relative), 'sha256': hashlib.sha256(source.encode('utf8')).hexdigest()})
        constants={};functions={}
        for node in ast.parse(source).body:
            if isinstance(node,ast.Assign):
                for target in node.targets:
                    if isinstance(target,ast.Name):constants[target.id]=literal(node.value,constants)
            if isinstance(node,(ast.FunctionDef,ast.AsyncFunctionDef)):functions[node.name]=[arg.arg for arg in node.args.args]
        modules[str(relative)]={'source':source,'constants':constants,'functions':functions}
    contexts={filename:{()} for filename in modules}
    while True:
        changed=[False]
        def add_context(target,symbol,index,prefix):
            if target not in modules:return
            params=modules[target]['functions'].get(symbol,[])
            if index>=len(params):return
            param=params[index]
            context=((param,prefix),)
            if context not in contexts[target]:contexts[target].add(context);changed[0]=True
        for filename,info in modules.items():
            for context in list(contexts[filename]):
                declarations(info['source'],filename,dict(context),modules,add_context)
        if not changed[0]:break
    for filename,info in modules.items():
        for context in sorted(contexts[filename]):
            found,dynamic=declarations(info['source'],filename,dict(context),modules)
            rows.extend(found);unresolved.extend(dynamic)
    rows=list({(r['file'],r['line'],r['method'],r['path']):r for r in rows}.values())
    resolved_lines={(row['file'],row['line']) for row in rows}
    unresolved=list({(r['file'],r['line'],r['expression']):r for r in unresolved if (r['file'],r['line']) not in resolved_lines}.values())
    by_key = {}
    for row in rows:
        by_key.setdefault((row['method'], row['path']), []).append(row)
    old = {(entry['method'], entry['path']) for entry in baseline['routes']}
    current = set(by_key)
    return {'scope': 'Static source declarations only, including hidden endpoints and current uncommitted Python source; no service imports, data or env reads. Declaration presence is not route registration, functional parity or migration completion.', 'files': files, 'declarations': rows, 'unresolved': unresolved, 'counts': {'baseline_visible_operations': len(old), 'current_declared_operations': len(current), 'overlap': len(old & current), 'new_declarations': len(current - old), 'baseline_not_located': len(old - current)}, 'new_declarations': [{'method': key[0], 'path': key[1], 'sources': by_key[key]} for key in sorted(current - old)], 'baseline_not_located': [{'method': key[0], 'path': key[1], 'disposition': 'Keep migration gate open; inspect dynamic registration or intentional removal before accepting.'} for key in sorted(old - current)]}


def enrich_ledger(ledger, snapshot):
    """Attach traceable obligations; never infer equivalence from an existing route or menu."""
    groups={
        'accounts':('U1/U5','/grow/','test/unit/lighttick-native-learning.api.test.ts'),
        'actions-goals-rhythm':('U2','/grow/actions','test/unit/grow-web-u2-boundaries.test.ts'),
        'courses-and-copilot':('U3','/grow/learning','test/unit/lighttick-native-learning.test.ts'),
        'planning':('U3','/grow/learning','test/unit/lighttick-learning-migration.test.ts'),
        'learning':('U3','/grow/learning','test/unit/lighttick-native-learning.api.test.ts'),
        'reading':('U3/U4','/grow/reading',None),
        'records-and-reflections':('U1/U4','/grow/records','test/unit/lighttick-records.api.test.ts'),
        'knowledge-search-timeline':('U4','/grow/growth',None),
        'cognition':('U4','/grow/cognition',None),
        'investment-and-research':('U5','/grow/investments',None),
        'stocks':('U5','/grow/investments',None),
        'legacy-migration':('U3/U5',None,'test/unit/lighttick-learning-migration.test.ts'),
        'cross-module-and-compatibility':('U0/U5',None,None),
    }
    entries={(row['method'],row['legacy_path']):dict(row) for row in ledger['entries']}
    sources={}
    for row in snapshot['declarations']:sources.setdefault((row['method'],row['path']),[]).append(row)
    for key,locations in sources.items():
        if key not in entries:entries[key]={'method':key[0],'legacy_path':key[1],'capability_group':'accounts' if key[1]=='/login' else 'courses-and-copilot' if '/copilot/' in key[1] else 'cross-module-and-compatibility','target_contract':None,'disposition':'unreviewed','semantic_differences':[],'acceptance_evidence':[]}
    for key,row in entries.items():
        stage,page,test=groups.get(row['capability_group'],groups['cross-module-and-compatibility'])
        path=key[1]
        proposed='/api/v1/lighttick'+path[4:] if path.startswith('/api/') else None
        note='Preserve owner/resource/version/original request identity; freeze, reconcile counts/digests/relationships and explicitly activate the migrated module. Existing test candidates are not per-operation parity evidence.'
        if path.startswith('/api/plans'):
            proposed='/api/v1/lighttick/learning/routes'+path[len('/api/plans'):]
            note+=' Formal course routes/stages are distinct from native goal/manual plans; do not merge IDs or titles.'
        if path.startswith('/api/auth/'):
            proposed='/api/v1/auth/'+path.rsplit('/',1)[-1]
            note+=' Reuse platform LightTick membership and explicit historical identity mapping, not legacy sessions.'
        if path.startswith('/api/account/github') or path.startswith('/api/copilot/settings'):
            proposed=None;note='Replace credential configuration with existing platform admin server-side secret references. Do not export credentials or echo keys to a client; endpoint equivalence remains pending.'
        if path.startswith('/api/data'):
            proposed=None;note='Decompose legacy state into per-domain commands and receipts. Generic sync/push remains task-only. Projection rebuild must preserve drafts and original pending commands.'
        if row['capability_group']=='legacy-migration':
            proposed=None;note='Use existing admin permissions and module migration controls. Current learning controls do not cover every legacy file/module; all missing adapters remain release blockers. No whole-database restore after native writes.'
        row.update({'source_locations':sources.get(key,[]),'delivery_slice':stage,'proposed_contract':{'method':key[0],'path':proposed,'status':'design_candidate_not_verified'},'page_candidate':page,'test_candidate':test,'required_verification':['legacy golden request/response and side effects','owner/version/CAS/idempotent replay and revocation','migration counts/digests/relationships and non-destructive recovery'],'migration_disposition':note})
    result=dict(ledger);result['entries']=[entries[key] for key in sorted(entries)];result['status']=str(len(entries))+' source operations traced; per-operation functional equivalence is still gated, including hidden routes and current uncommitted behavior.';return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-root', type=Path, required=True)
    parser.add_argument('--baseline', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--ledger',type=Path)
    parser.add_argument('--ledger-output',type=Path)
    args = parser.parse_args()
    result = inventory(args.source_root.resolve(), json.loads(args.baseline.read_text()))
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    if args.ledger or args.ledger_output:
        if not args.ledger or not args.ledger_output:parser.error('--ledger and --ledger-output must be supplied together')
        args.ledger_output.write_text(json.dumps(enrich_ledger(json.loads(args.ledger.read_text()),result),ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(result['counts']))

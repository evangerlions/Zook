"""AST-based strategy parameter extraction; ported from quant_system with Grow contracts."""
import ast,re
from typing import Any
PARAM_PATTERNS=('max_','min_','_count','_period','_days','window','factor','threshold',
    'ratio','limit','stop','period','length','size','level','rate','span','bars','offset')
def extract(code:str)->dict:
    params:dict[str,dict[str,Any]]={};defaults:dict[str,Any]={}
    try:return _ast_extract(code)
    except Exception:return _regex_fallback(code)
def _ast_extract(code:str)->dict:
    params:dict[str,dict[str,Any]]={};defaults:dict[str,Any]={}
    tree=ast.parse(code)
    for node in ast.walk(tree):
        if isinstance(node,ast.FunctionDef) and node.name=='__init__':
            for d in node.args.defaults:
                arg_index=len(node.args.args)-len(node.args.defaults)+node.args.defaults.index(d)
                if arg_index<0 or arg_index>=len(node.args.args):continue
                name=node.args.args[arg_index].arg
                if name=='self':continue
                value=_literal(d)
                if value is not None and _is_param(name):
                    params[name]={'name':name,'default':value,'type':type(value).__name__,'doc':''}
                    defaults[name]=value
        elif isinstance(node,ast.Assign):
            for target in node.targets:
                name=None
                if isinstance(target,ast.Attribute) and isinstance(target.value,ast.Name) and target.value.id=='self':
                    name=target.attr
                elif isinstance(target,ast.Name):name=target.id
                if not name or not _is_param(name):continue
                value=_literal(node.value)
                if value is None:continue
                params[name]={'name':name,'default':value,'type':type(value).__name__,'doc':''}
                defaults.setdefault(name,value)
    return {'params':params,'defaults':defaults}
def _is_param(name:str)->bool:
    return any(name.startswith(p) or name.endswith(p) or f'_{p}' in name for p in PARAM_PATTERNS)
def _literal(node)->Any:
    if isinstance(node,ast.Constant):return node.value
    if isinstance(node,(ast.List,ast.Tuple)):
        values=[_literal(e) for e in node.elts]
        if all(v is not None for v in values):return list(values) if isinstance(node,ast.List) else tuple(values)
        return None
    if isinstance(node,ast.Dict):
        result={}
        for k,v in zip(node.keys,node.values):
            if k is None:return None
            kk=_literal(k);vv=_literal(v)
            if kk is None or vv is None:return None
            result[kk]=vv
        return result
    if isinstance(node,ast.UnaryOp) and isinstance(node.op,ast.USub):
        inner=_literal(node.operand)
        if isinstance(inner,(int,float)):return -inner
    if isinstance(node,ast.BinOp) and isinstance(node.op,(ast.Add,ast.Sub,ast.Mult,ast.Div)):
        left=_literal(node.left);right=_literal(node.right)
        if isinstance(left,(int,float)) and isinstance(right,(int,float)):
            ops={ast.Add:lambda a,b:a+b,ast.Sub:lambda a,b:a-b,ast.Mult:lambda a,b:a*b,ast.Div:lambda a,b:a/b if b else None}
            return ops[type(node.op)](left,right)
    return None
def _regex_fallback(code:str)->dict:
    params:dict[str,dict[str,Any]]={};defaults:dict[str,Any]={}
    for match in re.finditer(r'self\.(\w+)\s*=\s*([\d.+\-]+)',code):
        name,value_str=match.group(1),match.group(2)
        if not _is_param(name):continue
        try:
            value=int(value_str) if '.' not in value_str else float(value_str)
            params[name]={'name':name,'default':value,'type':type(value).__name__,'doc':''}
            defaults[name]=value
        except ValueError:pass
    return {'params':params,'defaults':defaults}

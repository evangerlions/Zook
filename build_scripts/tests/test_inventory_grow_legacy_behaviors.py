import importlib.util
from pathlib import Path
import unittest
import tempfile

spec = importlib.util.spec_from_file_location('inventory', Path(__file__).parents[1] / 'inventory_grow_legacy_behaviors.py')
inventory = importlib.util.module_from_spec(spec)
spec.loader.exec_module(inventory)
gate_spec = importlib.util.spec_from_file_location('ledger_gate', Path(__file__).parents[1] / 'check_grow_migration_ledger.py')
gate = importlib.util.module_from_spec(gate_spec)
gate_spec.loader.exec_module(gate)


class LegacyInventoryTest(unittest.TestCase):
    def test_gate_rejects_menu_presence_and_requires_per_operation_evidence(self):
        source={'declarations':[{'method':'GET','path':'/api/plans'}],'unresolved':[],'baseline_not_located':[]}
        row={'method':'GET','legacy_path':'/api/plans','disposition':'unreviewed','page_candidate':'/grow/learning'}
        self.assertFalse(gate.check({'entries':[row]},source)['passed'])
        row.update(disposition='verified_native',target_contract='/api/v1/lighttick/learning/routes',acceptance_evidence=['source proof'])
        self.assertFalse(gate.check({'entries':[row]},source)['passed'])
        row['test_evidence']=['operation-specific test']
        self.assertTrue(gate.check({'entries':[row]},source)['passed'])
        row['disposition']='retired_authorized'
        self.assertFalse(gate.check({'entries':[row]},source)['passed'])
        row['authorization_reference']='explicit scoped retirement decision'
        self.assertTrue(gate.check({'entries':[row]},source)['passed'])

    def test_enrichment_does_not_promote_routes_or_expose_hidden_credential_settings(self):
        ledger={'entries':[{'method':'GET','legacy_path':'/api/plans','capability_group':'planning','disposition':'unreviewed','target_contract':None,'acceptance_evidence':[]}]}
        snapshot={'declarations':[{'method':'GET','path':'/api/plans','file':'plans/api.py','line':1},{'method':'GET','path':'/api/copilot/settings','file':'copilot/ai_api.py','line':2}]}
        result=inventory.enrich_ledger(ledger,snapshot);self.assertEqual(len(result['entries']),2)
        self.assertTrue(all(row['disposition']=='unreviewed' for row in result['entries']))
        self.assertEqual(next(row for row in result['entries'] if row['legacy_path']=='/api/plans')['proposed_contract']['path'],'/api/v1/lighttick/learning/routes')
        hidden=next(row for row in result['entries'] if row['legacy_path']=='/api/copilot/settings');self.assertIsNone(hidden['proposed_contract']['path']);self.assertIn('Do not export credentials',hidden['migration_disposition'])
    def test_prefix_hidden_methods_and_current_nested_registration_without_execution(self):
        source = '''
raise RuntimeError("Historical source must never execute")
ROOT = "/api"
def register(app):
    router = APIRouter(prefix=ROOT+"/knowledge")
    @router.get("/graph")
    def graph(): pass
    @router.api_route("/hidden", methods=["GET","POST"], include_in_schema=False)
    def hidden(): pass
    @app.get(f"{ROOT}/asset/{name}")
    def dynamic(): pass
    app.add_api_route("/api/extra/{tail:path}", endpoint=hidden, methods=["PUT"])
'''
        rows, unresolved = inventory.declarations(source, 'fixture.py')
        self.assertEqual([(row['method'], row['path']) for row in rows], [('GET', '/api/knowledge/graph'), ('GET', '/api/knowledge/hidden'), ('POST', '/api/knowledge/hidden'), ('PUT', '/api/extra/{tail}')])
        self.assertEqual([row['hidden'] for row in rows], [False, True, True, False])
        self.assertEqual(len(unresolved), 1)

    def test_unknown_router_prefix_is_not_silently_omitted(self):
        rows, unresolved = inventory.declarations('router=APIRouter(prefix=runtime_prefix())\n@router.post("/write")\ndef write(): pass\n', 'dynamic.py')
        self.assertEqual(rows, [])
        self.assertEqual(len(unresolved), 1)

    def test_cross_file_router_argument_and_literal_resource_factory_are_resolved_without_importing(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);(root/'investments').mkdir()
            (root/'investments'/'contracts.py').write_text('RESOURCE_MODELS={"accounts":AccountModel,"policies":PolicyModel}\n')
            (root/'investments'/'child.py').write_text('def register(app,router):\n @router.get("/extra")\n def read(): pass\n')
            (root/'investments'/'api.py').write_text('''
from .contracts import RESOURCE_MODELS
def register(app):
 router=APIRouter(prefix="/api/investments")
 from .child import register as register_child
 register_child(app,router)
 for kind,model in RESOURCE_MODELS.items():
  router.add_api_route('/'+kind,creator(kind,model),methods=['POST'])
  if kind in ('policies',):
   router.add_api_route('/'+kind+'/{id}',editor(kind),methods=['PUT'])
''')
            result=inventory.inventory(root,{'routes':[]})
            self.assertEqual({(row['method'],row['path']) for row in result['declarations']},{('GET','/api/investments/extra'),('POST','/api/investments/accounts'),('POST','/api/investments/policies'),('PUT','/api/investments/policies/{id}')})
            self.assertEqual(result['unresolved'],[])


if __name__ == '__main__':
    unittest.main()

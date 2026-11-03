import hashlib
import importlib.util
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch, Mock
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import grow_group_state as state
import grow_deploy as deploy
import grow_acceptance as acceptance


class GroupTest(unittest.TestCase):
    def test_private_literal_snapshot_and_checksum(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'group'/'compose.json'
            state.freeze(p,{'services':{'api':{'environment':{'SECRET':'one$two${X}'}}}})
            self.assertEqual(p.stat().st_mode&0o777,0o600)
            self.assertEqual(p.parent.stat().st_mode&0o777,0o700)
            self.assertEqual(json.loads(p.read_text())['services']['api']['environment']['SECRET'],'one$$two$${X}')
            group={'snapshot':str(p),'snapshot_sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
            state.checked_snapshot(group,Path(d));p.write_text('{}')
            with self.assertRaises(ValueError):state.checked_snapshot(group,Path(d))

    def test_schema_or_authority_changes_are_not_auto_rolled_back(self):
        previous={'authority':'legacy','schema_bundle_sha256':'old'}
        with self.assertRaises(ValueError):state.compatible(previous,{'authority':'legacy','schema_bundle_sha256':'new'})
        previous['authority']='zook'
        with self.assertRaises(ValueError):state.compatible(previous,{'authority':'legacy','schema_bundle_sha256':'old'})

    def flow(self, directory):
        repo=Path(directory);(repo/'compose.yaml').write_text('DATABASE_URL: ${DATABASE_URL}\n')
        env=repo/'api.env';env.write_text('DATABASE_URL=postgresql://u:p@host/zook\n')
        root=repo/'.deploy';groupdir=root/'dev/groups/previous';snapshot=groupdir/'compose.json'
        state.freeze(snapshot,{'services':{}})
        previous={'group_version':1,'authority':'legacy','schema_bundle_sha256':'schema','snapshot':str(snapshot),
                  'snapshot_sha256':hashlib.sha256(snapshot.read_bytes()).hexdigest(),'project_name':'qa','images':{'api':'old'},'components':{},'health':{}}
        args=SimpleNamespace(dry_run=False,dockerfile='Dockerfile',skip_image_cleanup=True,tag_suffix='localdeploy')
        engine=SimpleNamespace(build_local_image=Mock(),run_database_migrations=Mock(),get_git_status=lambda r:'',
                               git_output=lambda r,*a: 'a'*40 if a[0]=='rev-list' else 'tree')
        kwargs=dict(repo=repo,args=args,project='qa',slot='dev',state_file=root/'dev/deploy_state.json',compose_files=[repo/'compose.yaml'],
                    compose_env={'APP_ENV_FILE':str(env)},new_release={'image':'zook:new','image_name':'zook','image_tag':'new','commit':'a'*40},
                    previous=previous,health={'host_port':'3101','admin_host_port':'3111'},engine=engine)
        return kwargs

    def test_compose_exception_restores_prior_group_and_old_private_config(self):
        with tempfile.TemporaryDirectory() as d:
            kwargs=self.flow(d);journal=kwargs['state_file'].parent/'grow-pending.json';applies=[]
            def apply(project,path):
                self.assertTrue(journal.exists());applies.append(path)
                if len(applies)==1:raise ValueError('partial compose failure')
            with patch.object(deploy.grow_plan,'prepare',return_value=None), patch.object(state,'image_id',return_value='sha256:'+'a'*64), \
                 patch.object(state,'migration_digest',return_value='schema'),patch.object(state,'render',return_value={'services':{'api':{'environment':{'DATABASE_URL':'original$pass'}}}}),\
                 patch.object(state,'apply',side_effect=apply),patch.object(deploy,'probe',return_value=True):
                self.assertEqual(deploy.execute(**kwargs),1)
            self.assertEqual(len(applies),2);self.assertEqual(Path(applies[1]).resolve(),Path(kwargs['previous']['snapshot']).resolve());self.assertFalse(journal.exists())
            self.assertEqual(json.loads(kwargs['state_file'].read_text())['active_release']['images'],{'api':'old'})
            migration_file=kwargs['engine'].run_database_migrations.call_args.args[1]
            self.assertEqual(migration_file.read_text(),'DATABASE_URL=original$pass\n')

    def test_failed_migration_keeps_journal_and_never_replaces_services(self):
        with tempfile.TemporaryDirectory() as d:
            kwargs=self.flow(d);kwargs['engine'].run_database_migrations.side_effect=RuntimeError('failed')
            with patch.object(deploy.grow_plan,'prepare',return_value=None),patch.object(state,'image_id',return_value='sha256:'+'a'*64),\
                 patch.object(state,'migration_digest',return_value='schema'),patch.object(state,'render',return_value={'services':{'api':{}}}),patch.object(state,'apply') as apply:
                with self.assertRaises(ValueError):deploy.execute(**kwargs)
                apply.assert_not_called()
            journal=kwargs['state_file'].parent/'grow-pending.json'
            self.assertEqual(json.loads(journal.read_text())['phase'],'migration_failed')
            with self.assertRaises(ValueError):deploy.reconcile(kwargs['state_file'],journal,kwargs['state_file'].parent.parent,kwargs['engine'])

    def test_crash_after_success_reconciles_without_new_build(self):
        with tempfile.TemporaryDirectory() as d:
            kwargs=self.flow(d);target=kwargs['previous'];journal=kwargs['state_file'].parent/'grow-pending.json'
            state.atomic_json(journal,{'phase':'deploying','target':target,'previous':None})
            with patch.object(state,'configuration_matches',return_value=True),patch.object(deploy,'probe',return_value=True):
                self.assertTrue(deploy.reconcile(kwargs['state_file'],journal,kwargs['state_file'].parent.parent,kwargs['engine']))
            self.assertFalse(journal.exists());kwargs['engine'].build_local_image.assert_not_called()

    def test_online_without_dev_receipt_is_rejected_before_build(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaisesRegex(ValueError,'acceptance receipt'):acceptance.promoted(Path(d),'main','tree',None)

    def test_acceptance_cannot_be_filled_with_changed_config_or_images(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);active={'group_version':1,'project_name':'qa','config_revision':'v2','images':{'api':'new'},'source_main':'main','source_tree':'tree'}
            state.atomic_json(root/'dev/deploy_state.json',{'active_release':active})
            evidence=root/'evidence.json';evidence.write_text(json.dumps({'config_revision':'v1','checks':{k:True for k in acceptance.REQUIRED_CHECKS}}))
            with self.assertRaises(ValueError):acceptance.accept(root,evidence)
            self.assertFalse((root/'dev/grow-accepted.json').exists())


    def test_preflight_is_bound_to_final_rendered_credentials(self):
        import copy
        plan={'env':{'DATABASE_URL':'postgresql://u:p@h/grow','APP_PASSWORD':'first'},
              'api_env':{'DATABASE_URL':'postgresql://u:p@h/zook','GROW_ACTION_BRIDGE_SECRET':'bridge'}}
        good={'services':{'grow':{'environment':plan['env']},'api':{'environment':plan['api_env']},'worker':{'environment':plan['api_env']}}}
        deploy.grow_plan.verify_frozen(plan,good)
        for service,key,value in [('grow','DATABASE_URL','postgresql://u:p@h/zook'),('grow','APP_PASSWORD','changed'),('api','DATABASE_URL','postgresql://u:p@other/zook'),('worker','GROW_ACTION_BRIDGE_SECRET','changed')]:
            bad=copy.deepcopy(good);bad['services'][service]['environment'][key]=value
            with self.assertRaises(ValueError):deploy.grow_plan.verify_frozen(plan,bad)

    def test_disabled_group_can_have_truthful_component_specific_acceptance(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);active={'group_version':1,'group_retired':True,'project_name':'qa','config_revision':'v2','images':{'api':'sha256:base'},'source_main':'main','source_tree':'tree'}
            state.atomic_json(root/'dev/deploy_state.json',{'active_release':active})
            evidence=root/'evidence.json';evidence.write_text(json.dumps({'config_revision':'v2','checks':{k:True for k in acceptance.CORE_CHECKS}}))
            with patch.object(state,'configuration_matches',return_value=True):
                receipt=acceptance.accept(root,evidence)
            self.assertEqual(receipt['images'],active['images'])

    def test_release_wrapper_and_main_merge_keep_same_actual_main_identity(self):
        import subprocess
        with tempfile.TemporaryDirectory() as d:
            repo=Path(d)
            def git(r,*args):return subprocess.check_output(['git','-C',str(r),*args],text=True,stderr=subprocess.DEVNULL).strip()
            git(repo,'init','-b','main');git(repo,'config','user.name','QA');git(repo,'config','user.email','qa@example.invalid')
            (repo/'a').write_text('base');git(repo,'add','.');git(repo,'commit','-m','base')
            git(repo,'branch','release-online');git(repo,'checkout','-b','feature/x')
            (repo/'a').write_text('feature');git(repo,'commit','-am','feature')
            git(repo,'checkout','main');git(repo,'merge','--no-ff','feature/x','-m','Merge feature/x')
            main,tree=acceptance.source_identity(repo,git)
            self.assertEqual(main,git(repo,'rev-parse','HEAD'))
            git(repo,'checkout','-b','release-dev') # Initial release seeded directly at a main merge.
            self.assertEqual(acceptance.source_identity(repo,git),(main,tree))
            git(repo,'checkout','release-online');git(repo,'merge','--no-ff','main','-m','Merge origin/main into release-online')
            self.assertEqual(acceptance.source_identity(repo,git),(main,tree))
            (repo/'a').write_text('release-only edit');git(repo,'commit','-am','release-only edit','--amend')
            git(repo,'commit','--amend','-m','Merge origin/main into release-online')
            with self.assertRaisesRegex(ValueError,'source main tree'):acceptance.source_identity(repo,git)

    def test_missing_api_preserves_structured_group_metadata(self):
        spec=importlib.util.spec_from_file_location('z1_engine',Path(__file__).resolve().parents[1]/'build_and_push_docker.py')
        engine=importlib.util.module_from_spec(spec);spec.loader.exec_module(engine)
        with tempfile.TemporaryDirectory() as d:
            file=Path(d)/'state.json';group={'group_version':1,'images':{'api':'old','grow':'old-grow'}}
            state.atomic_json(file,{'active_release':group})
            with patch.object(engine,'get_service_image',return_value=None):self.assertEqual(engine.resolve_current_release('qa',file),group)


    def test_cleanup_preserves_both_slots_previous_and_pending_component_ids(self):
        spec=importlib.util.spec_from_file_location('z1_cleanup',Path(__file__).resolve().parents[1]/'build_and_push_docker.py')
        engine=importlib.util.module_from_spec(spec);spec.loader.exec_module(engine)
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            for slot in ('dev','online'):
                state.atomic_json(root/slot/'deploy_state.json',{'active_release':{'images':{'api':'sha256:'+slot,'grow':'sha256:'+slot+'-grow'},'components':{'grow':{'build_ref':'grow:'+slot}}},'previous_release':{'images':{'grow':'sha256:'+slot+'-previous'}}})
            state.atomic_json(root/'online/grow-pending.json',{'target':{'images':{'grow':'sha256:pending'}},'previous':{}})
            kept=engine.collect_preserved_release_images(root)
            self.assertEqual(len(kept),9);self.assertIn('sha256:pending',kept)
            with patch.object(engine,'list_managed_release_images',return_value=[('grow:old-localdeploy',None),('grow:discard-localdeploy',None)]), \
                 patch.object(engine,'collect_running_container_images',return_value=set()), \
                 patch.object(engine,'command_output',side_effect=['sha256:dev-previous','sha256:unused']),patch.object(engine,'run_command') as remove:
                removed,failed,_=engine.cleanup_old_release_images(image_name='grow',tag_suffix='localdeploy',deploy_root=root,keep_releases=0)
            self.assertEqual(removed,['grow:discard-localdeploy']);self.assertEqual(failed,[])
            self.assertEqual(remove.call_count,1)
            (root/'dev/deploy_state.json').write_text('{broken')
            with self.assertRaises(engine.ScriptError):engine.collect_preserved_release_images(root)

if __name__=='__main__':unittest.main()

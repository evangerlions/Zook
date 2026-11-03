import copy
import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import grow_mapping as m


def row(module='lesson', owner='alice', id='1'):
    return {'source_instance':'isolated-grow-dev','source_account':owner,'module':module,'legacy_id':id,
            'app_id':'lighttick','user_id':owner,'canonical_id':id,'owner_verification_ref':'qa-explicit-pairing',
            'source_version':'source-hash','canonical_revision':0,'authority':'legacy','authority_epoch':0,
            'title':'same name','completed_at':None}


class MappingTest(unittest.TestCase):
    def test_same_title_different_owner_and_module_are_distinct(self):
        doc={'schema_version':1,'objects':[row(),row(owner='bob'),row(module='plan_cycle'),row(module='course_route')]}
        self.assertEqual(m.validate(doc),{'objects':4,'owners':2,'authority':'legacy'})
        self.assertIsNone(doc['objects'][0]['completed_at'])

    def test_duplicate_replay_same_mapping_is_idempotent(self):
        r=row();self.assertEqual(m.validate({'schema_version':1,'objects':[r,copy.deepcopy(r)]})['objects'],1)

    def test_cross_owner_remap_and_title_merge_rejected(self):
        first=row();second=copy.deepcopy(first);second['user_id']='bob'
        with self.assertRaises(ValueError):m.validate({'schema_version':1,'objects':[first,second]})
        second=copy.deepcopy(first);second['legacy_id']='2'
        with self.assertRaises(ValueError):m.validate({'schema_version':1,'objects':[first,second]})

    def test_verification_and_versions_required_no_cutover(self):
        for key,value in [('owner_verification_ref',''),('source_version',None),('authority','zook'),('authority_epoch',1)]:
            bad=row();bad[key]=value
            with self.assertRaises(ValueError):m.validate({'schema_version':1,'objects':[bad]})

if __name__=='__main__':unittest.main()

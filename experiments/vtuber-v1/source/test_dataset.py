import json
from pathlib import Path
import tempfile
import unittest
import numpy as np
import torch
from common import ASSET_HASH, PROFILE, write, sha
from data import prepare, load_dataset, tensors
from networks import ActionExpert
from trajectory import compile_trajectory


class ReviewedDatasetTests(unittest.TestCase):
    def test_nondefault_eyelids_and_sixteen_channel_models_roundtrip(self):
        profile=json.loads(json.dumps(PROFILE))
        profile['channels'] += [
            {'id':'ParamEyeLOpen','min':0,'max':1.25,'neutral':1},
            {'id':'ParamEyeROpen','min':0,'max':1.25,'neutral':1},
            {'id':'ParamMouthForm','min':-.6,'max':.8,'neutral':0},
            {'id':'ParamMouthOpenY','min':0,'max':.65,'neutral':0}]
        state={c['id']:c['neutral'] for c in profile['channels']}
        row={'recording':{'parameter_ids':list(state),'initial_state':{'driver':state},'duration_ms':100,
                         'frames':[{'time_ms':100,'driver':list(state.values())}],'commands':[]}}
        data=tensors([row],profile)
        self.assertAlmostEqual(data['actions'][0,0,12],.6,places=6)
        self.assertEqual(data['state'].shape,(1,21))
        h=torch.randn(1,16,1024);mask=torch.zeros(1,16,dtype=torch.bool);s=torch.from_numpy(data['state'])
        for kind in ['regression','flow']:
            model=ActionExpert(kind,action_dim=16).eval()
            result,_,_=model.sample(h,s,mask,steps=2)
            self.assertEqual(result.shape,(1,64,16))
            restored=ActionExpert(kind,action_dim=16).eval();restored.load_state_dict(model.state_dict())
            self.assertTrue(torch.equal(result,restored.sample(h,s,mask,steps=2)[0]))
        command,_=compile_trajectory(np.tile(list(state.values()),(64,1)),[0]*64,[0]*64,{},profile)
        self.assertEqual(command['params']['events'][0]['params']['values']['ParamEyeLOpen'],1)

    def test_review_gate_and_train_split_are_enforced(self):
        with tempfile.TemporaryDirectory(prefix='vtuber-review-unit-') as tmp:
            folder=Path(tmp);(folder/'samples').mkdir();(folder/'candidates').mkdir()
            write(folder/'profile.json',PROFILE)
            write(folder/'dataset.json',{'schema':'reviewed_vtuber.v1','status':'sealed','default_split':'train'})
            reviews=[]
            for i,split in enumerate(['train','test']):
                clip_id=f'clip-{i}';write(folder/'candidates'/(clip_id+'.json'),{'source':'synthetic-fixture'})
                review={'clip_id':clip_id,'review_id':f'review-{i}','decision':'accepted','visual_reviewed':True,'automated_pass':True,'candidate_sha256':sha(folder/'candidates'/(clip_id+'.json'))}
                reviews.append(review)
                values={c['id']:c['neutral'] for c in PROFILE['channels']}
                write(folder/'samples'/(clip_id+'.json'),{'id':clip_id,'clip_id':clip_id,'family':clip_id,'split':split,'profile_sha256':PROFILE['sha256'],
                    'candidate_sha256':review['candidate_sha256'],'review_id':review['review_id'],'annotation':{'source_type':'program_authored','human_reviewed':False},
                    'recording':{'asset_hash':ASSET_HASH,'duration_ms':100,'parameter_ids':list(values),'initial_state':{'driver':values},'frames':[{'time_ms':100,'driver':list(values.values())}],'commands':[]}})
            ledger=folder/'reviews.jsonl';ledger.write_text('\n'.join(json.dumps(r) for r in reviews),encoding='utf-8')
            rows,manifest,data=prepare(folder)
            self.assertEqual([r['split'] for r in rows],['train'])
            self.assertEqual(manifest['sample_count'],2)
            self.assertEqual(manifest['selection']['sample_count'],1)
            self.assertEqual([r['split'] for r in prepare(folder,'test')[0]],['test'])
            reviews[0]['decision']='rejected';ledger.write_text('\n'.join(json.dumps(r) for r in reviews),encoding='utf-8')
            with self.assertRaises(ValueError):load_dataset(folder)


if __name__=='__main__':
    torch.set_num_threads(2)
    unittest.main()

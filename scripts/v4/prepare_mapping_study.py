"""Freeze a new asset-mapping experiment using existing genuine speech, not new model labels."""
import gzip
import hashlib
import json
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
STUDY=ROOT/'research/vtuber-v4-mapping-r1'
DATA=ROOT/'datasets/vtuber-v4-mapping-r1'


def read(p):return json.loads(p.read_text(encoding='utf-8-sig'))
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def write(p,v):p.write_text(json.dumps(v,ensure_ascii=False,indent=2,allow_nan=False)+'\n',encoding='utf-8')


def main():
    STUDY.mkdir(parents=True,exist_ok=True);DATA.mkdir(parents=True,exist_ok=True)
    protected=read(ROOT/'research/vtuber-v4-prosody-study/runtime-before.json')['files']
    for p,h in protected.items():assert sha(ROOT/p)==h,p
    more=['server/index.ts','src/controller.ts','src/eye-style.ts','research/vtuber-v4-prosody-study/provenance.json',
          'research/vtuber-v4-playback-diagnosis-r1/provenance.json']
    protected={**protected,**{p:sha(ROOT/p) for p in more}}
    before=STUDY/'runtime-before.json'
    if before.exists():assert read(before)['files']==protected
    else:write(before,dict(created_utc=datetime.now(timezone.utc).isoformat(),files=protected))
    vts_path=ROOT/'live2d/DeepSeek/DeepSeek/大肥鱼.vtube.json'
    settings=read(vts_path)['ParameterSettings'];assert len(settings)==40
    write(STUDY/'mapping-settings.json',dict(asset_file=str(vts_path.relative_to(ROOT)).replace('\\','/'),
         asset_sha256=sha(vts_path),settings=settings))
    selected=[('welcome','招呼 · 头身联动','full'),('shy','害羞 · 眉眼近景','portrait'),
              ('cajole','撒娇 · 躯干与慢眨眼','full'),('neutral','中性 · 安静保持','full')]
    scenes=[]
    for id,title,framing in selected:
        scene=read(ROOT/'datasets/vtuber-v4-prosody-r1'/id/'scene.json')
        archived=ROOT/'test-results/v4-prosody-study'/(id+'-fixed')/'input.json.gz'
        inputs=json.loads(gzip.decompress(archived.read_bytes()))
        folder=DATA/id;folder.mkdir(exist_ok=True)
        # Fixed, existing authored intent/arm paths isolate the execution mechanism.
        (folder/'baseline.json.gz').write_bytes(archived.read_bytes())
        source_audio=ROOT/'datasets/vtuber-v4-prosody-r1'/id/'audio.wav'
        (folder/'audio.wav').write_bytes(source_audio.read_bytes())
        write(folder/'scene.json',dict(id=id,title=title,framing=framing,cues=scene['cues'],
            texts=[c['text'] for c in scene['cues']],duration_ms=scene['duration_ms'],
            frames=inputs['frames'],audio_sha256=sha(source_audio),baseline_sha256=sha(archived),
            input_source='Archived fixed-intent development scene; not a model prediction or human gold.'))
        scenes.append(dict(id=id,title=title,framing=framing,frames=inputs['frames'],audio_sha256=sha(source_audio)))
    protocol=dict(schema='asset-mapping-study.v1',created_utc=read(before)['created_utc'],promoted=False,
        trained=False,semantic_model_used=False,final_test_loaded=False,human_quality_accepted=False,
        conditions=['current','mapped','mapped_micro'],scenes=scenes,parameter_hz=60,physics_hz=60,image_hz=60,
        ownership=dict(mapped_outputs=['AngleX','AngleY','AngleZ','PositionX','PositionY','PositionZ','ParamEyeBallX','ParamEyeBallY'],
                       replaces_not_adds=True,lean_input='unchanged baseline',arm_finger_inputs='bit-identical baseline',
                       physics_outputs='Cubism native physics',mouth_open='same real PCM envelope',appearance='unchanged explicit defaults'),
        mapping_scope=dict(total_asset_entries=40,active_entries=8,inputs=['FaceAngleX','FaceAngleY','FaceAngleZ','EyeRightX','EyeRightY'],
            source='Original local asset VTube Studio configuration',inverse_head_targets=True,
            inverse_reason='Same unsmoothed head target amplitude as baseline before applying the mapping filter.',
            smoothing='Independent exponential filters, tau = asset Smoothing * 5 ms; an experimental interpretation, not a VTube Studio fidelity claim.'),
        controls=['Identical audio PCM, mouth envelope, base face overlay, camera within each scene, arm/finger curves and action count.',
                  'mapped replaces all eight owned outputs; never adds mapped output to old torso offsets.',
                  'Micro reactions are newly authored, sparse, finite and minimum-jerk; neutral gets no extra reaction.',
                  'No acoustic energy modulation, periodic body noise or whole-gesture retiming.'],
        limitations=['This tests execution, not semantic selection or generalization.',
                     'The eight head/gaze mappings are exercised; this is not a rendering audit of all 40 entries.',
                     'Micro event timing is authored relative to known clause onsets, not automatically aligned to individual words.',
                     'Same head target does not mean equal motion energy after different filters; diagnostics cannot select naturalness winners.',
                     'Local policy time excludes TTS, semantic inference, network and renderer; no concurrent latency acceptance.'],
        reference=dict(project='WHALEL2D',commit='1576fc34ddf9f061e91cbe56a37b488c0d0fcaae',
            borrowed='Design of asset-aware mapping, held states and short reactions.',
            implementation='Independent local TypeScript implementation from asset settings and existing project primitives; no third-party code ported.'))
    p=STUDY/'protocol.json'
    if p.exists():assert read(p)==protocol,'Use a new revision if protocol changes'
    else:write(p,protocol)
    write(DATA/'manifest.json',dict(schema='asset-mapping-inputs.v1',protocol_sha256=sha(p),scenes=scenes))
    with urllib.request.urlopen('http://127.0.0.1:8775/api/manifest',timeout=10) as response:manifest=json.load(response)
    write(STUDY/'asset-manifest.json',manifest)
    print(json.dumps(dict(scenes=len(scenes),clips=len(scenes)*3,mappings=8,real_fps=60,trained=False,promoted=False)),flush=True)


if __name__=='__main__':main()

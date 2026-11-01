"""Numerical QA, rendered storyboards, and explicit assistant-review admission.

Build does not approve anything. Accept requires a visual review decision file.
"""
import argparse
import datetime as dt
import json
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from common import ROOT, ASSET_HASH, read, write, sha, digest


def font(size):
    for file in ['/mnt/c/Windows/Fonts/msyh.ttc', 'C:/Windows/Fonts/msyh.ttc', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf']:
        if Path(file).exists():
            return ImageFont.truetype(file, size)
    return ImageFont.load_default(size=size)


def composite(file):
    source=Image.open(file).convert('RGBA')
    background=Image.new('RGBA',source.size,'#f1f4ec')
    return Image.alpha_composite(background,source).convert('RGB')


def audit(folder, clip, channels):
    trace=clip['trace']; recording=read(folder/clip['recording_file'])
    values=np.array([t['driver'] for t in trace],float)
    actual=np.array([t['actual'] for t in trace],float)
    lo=np.array([c['min'] for c in channels]);hi=np.array([c['max'] for c in channels]);neutral=np.array([c['neutral'] for c in channels])
    norm=(values-neutral)/(hi-lo)
    span=np.ptp(values,axis=0)/(hi-lo)
    index={c['id']:i for i,c in enumerate(channels)}
    geometry=np.array([[t['geometry']['weighted_x'],t['geometry']['weighted_y']] for t in trace])
    delta=float(np.linalg.norm(geometry-geometry[0],axis=1).max())
    correlation=float(np.corrcoef(values[:,index['AngleZ']],values[:,index['PositionZ']])[0,1])
    nonblink=[i for i,c in enumerate(channels) if c['id'] not in ['ParamEyeLOpen','ParamEyeROpen']]
    maxstep=float(np.abs(np.diff(norm[:,nonblink],axis=0)).max())
    gates={
        'correct_asset':recording['asset_hash']==ASSET_HASH==clip['asset_hash'],
        'complete_native_recording':len(recording['frames'])==64 and not recording.get('limitReached') and abs(recording['duration_ms']-6400)<1,
        'native_physics_enabled':recording['initial_state']['behavior']['physicsEnabled'] is True,
        'finite':bool(np.isfinite(values).all() and np.isfinite(actual).all() and np.isfinite(geometry).all()),
        'within_profile':bool(((values>=lo-1e-4)&(values<=hi+1e-4)).all()),
        'neutral_return':bool(np.abs(norm[-1]).max()<.025 and max(trace[-1]['hand_values'])<.03),
        'head_body_coupled':bool(abs(correlation)>.55),
        'head_body_gaze_face_active':all(any(span[index[c]]>.015 for c in group) for group in [['AngleX','AngleY','AngleZ'],['PositionX','PositionY','PositionZ','LeanInput'],['ParamEyeBallX','ParamEyeBallY'],['EyeSmile','ParamMouthForm']]),
        'no_nonblink_jump':maxstep<.25,
        'rendered_mesh_changes':delta>10 and all(t['geometry']['opacity_sum']>10 for t in trace),
        'rendered_frames_intact':all((folder/f['file']).exists() and sha(folder/f['file'])==f['sha256'] for f in clip['rendered_frames']),
        'recording_hash':sha(folder/clip['recording_file'])==clip['recording_sha256'],
    }
    if clip.get('expressions'):
        body=np.array([t.get('physics_body',[0,0,0]) for t in trace],float)
        gates['native_torso_motion_visible']=bool(np.isfinite(body).all() and np.ptp(body,axis=0).max()>2)
        switches=[e for e in recording['commands'] if e['method']=='expressions.set']
        expected_any=any(any(frame) for frame in clip['expressions'])
        visible_any=any(any(v>.1 for v in t.get('expression_values',{}).values()) for t in trace)
        gates['expression_targets_executed']=(not expected_any) or (len(switches)>=2 and visible_any)
        gates['expressions_exit']=not trace[-1].get('expressions') and all(abs(v)<.01 for v in trace[-1].get('expression_values',{}).values())
        gates['exclusive_eye_styles']=all(sum(t.get('expression_values',{}).get(k,0)>.2 for k in ['key3','key4','key5','key6'])<=1 for t in trace)
    return {'clip_id':clip['id'],'pass':all(gates.values()),'gates':gates,'metrics':{'head_body_roll_correlation':correlation,'maximum_nonblink_normalized_step':maxstep,
        'native_torso_axis_spans':np.ptp(np.array([t.get('physics_body',[0,0,0]) for t in trace],float),axis=0).tolist(),
        'mesh_delta_max':delta,'active_channels':int((span>.015).sum()),'maximum_tail_normalized_displacement':float(np.abs(norm[-1]).max()),
        'span_by_channel':{c['id']:float(span[i]) for i,c in enumerate(channels)}}}


def build(folder):
    profile=read(folder/'profile.json');channels=profile['channels']
    paths=sorted((folder/'candidates').glob('*.json'));clips=[read(p) for p in paths]
    results={c['id']:audit(folder,c,channels) for c in clips}
    (folder/'review/contact-sheets').mkdir(exist_ok=True)
    (folder/'review/animations').mkdir(exist_ok=True)
    families=sorted({c['family'] for c in clips});sheets=[]
    for family in families:
        group=[c for c in clips if c['family']==family]
        if len(group)!=8:continue
        cell=(160,214);rowheight=245
        canvas=Image.new('RGB',(960,55+rowheight*len(group)),'#fafbf8');draw=ImageDraw.Draw(canvas)
        draw.text((12,10),f"{group[0]['label']} / {family} / {group[0]['split']}",font=font(19),fill='#253831')
        for row,c in enumerate(group):
            y=55+row*rowheight
            color='#39745c' if results[c['id']]['pass'] else '#b14343'
            draw.text((8,y),f"{c['id']} | numerical {'PASS' if results[c['id']]['pass'] else 'FAIL'}",font=font(13),fill=color)
            for col,frame in enumerate(c['rendered_frames']):
                picture=composite(folder/frame['file']);picture.thumbnail(cell)
                canvas.paste(picture,(col*160,y+24))
                draw.text((col*160+5,y+rowheight-17),f"{frame['time_ms']/1000:.1f}s",font=font(11),fill='#52665b')
        sheet=folder/f'review/contact-sheets/{family}.jpg';canvas.save(sheet,quality=94)
        sheets.append({'family':family,'file':str(sheet.relative_to(folder)),'sha256':sha(sheet),'clip_ids':[c['id'] for c in group]})
        representative=next(c for c in group if c['variant']==3)
        frames=sorted((folder/'review/animation-frames').glob(representative['id']+'-*.png'))
        if len(frames)==65:
            animation=[composite(f) for f in frames]
            animation[0].save(folder/f"review/animations/{family}.webp",save_all=True,append_images=animation[1:],duration=100,loop=0,quality=88,method=4)
    reference=Image.new('RGB',(8*160,240),'#f1f4ec')
    for i in range(8):
        file=folder/f'review/frames/native-reference-{i}.png'
        if file.exists():reference.paste(composite(file).resize((160,214)),(i*160,15))
    reference.save(folder/'review/native-reference.jpg',quality=94)
    report={'schema':'vtuber_quality.v1','clips':len(clips),'pass':sum(r['pass'] for r in results.values()),'results':results,'sheets':sheets,
            'human_reviewed':False,'visual_decision_pending':True}
    write(folder/'review/automated-qa.json',report)
    print(json.dumps({'clips':len(clips),'pass':report['pass'],'failed':{k:[g for g,v in r['gates'].items() if not v] for k,r in results.items() if not r['pass']},'sheets':len(sheets)}))


def accept(folder, decisions):
    if (folder/'manifest.json').exists() or (folder/'reviews.jsonl').exists():raise ValueError('Dataset already sealed; use a new version')
    qa=read(folder/'review/automated-qa.json');visual=read(decisions)
    reviews=[];samples=[];seen=set();duplicate_captions=0
    for entry in qa['sheets']:
        decision=visual.get(entry['family'])
        if not decision or decision['contact_sheet_sha256']!=sha(folder/entry['file']):raise ValueError('Missing or stale visual review')
        for clip_id in entry['clip_ids']:
            cfile=folder/'candidates'/f'{clip_id}.json';clip=read(cfile);result=qa['results'][clip_id]
            rejected=decision.get('rejected_clips',{})
            accepted=result['pass'] and clip_id not in rejected
            review_id=digest({'clip':sha(cfile),'visual':decision,'qa':result})[:24]
            review={'review_id':review_id,'clip_id':clip_id,'candidate_sha256':sha(cfile),'decision':'accepted' if accepted else 'rejected',
                    'reviewer':'codex_assistant','human_reviewed':False,'automated_pass':result['pass'],'visual_reviewed':True,
                    'visual_evidence':entry,'visual_notes':rejected.get(clip_id,decision['notes']),'metrics':result['metrics'],
                    'reviewed_at_utc':dt.datetime.now(dt.timezone.utc).isoformat()}
            reviews.append(review)
            if not accepted:continue
            rec=read(folder/clip['recording_file'])
            for caption_index,a in enumerate(clip['captions']):
                fingerprint=digest(a)
                if fingerprint in seen:duplicate_captions+=1;continue
                seen.add(fingerprint)
                sample_id=f'{clip_id}-caption-{caption_index+1}'
                samples.append({'id':sample_id,'clip_id':clip_id,'family':clip['family'],'split':clip['split'],
                    'profile_sha256':clip['profile_sha256'],'candidate_sha256':review['candidate_sha256'],'review_id':review_id,
                    'annotation':{**a,'source_type':'program_authored','primary_action':clip['family'],'human_reviewed':False,'review_status':'assistant_accepted',
                                  'session_id':folder.name+'-'+clip['family'],'paraphrase_family':clip['family'],'motion_family':clip['family']},'recording':rec})
    (folder/'samples').mkdir(exist_ok=False)
    for sample in samples:write(folder/'samples'/f"{sample['id']}.json",sample)
    (folder/'reviews.jsonl').write_text(''.join(json.dumps(r,ensure_ascii=False,allow_nan=False)+'\n' for r in reviews),encoding='utf-8')
    counts={split:sum(s['split']==split for s in samples) for split in ['train','validation','test']}
    metadata={'schema':'reviewed_vtuber.v1','status':'sealed','source_type':'program_authored','human_reviewed':False,'assistant_reviewed':True,
              'accepted_clips':sum(r['decision']=='accepted' for r in reviews),'rejected_clips':sum(r['decision']=='rejected' for r in reviews),
              'sample_count':len(samples),'duplicate_caption_pairs_removed':duplicate_captions,'split_counts':counts,'default_split':'train',
              'split_policy':{'key':'choreography_and_paraphrase_family','native_style_sources':1,'train':[s['family'] for s in qa['sheets'] if any(x['family']==s['family'] and x['split']=='train' for x in samples)],
                              'meaning':'synthetic family holdout; not independent human motion generalization'},'profile_sha256':read(folder/'profile.json')['sha256']}
    write(folder/'dataset.json',metadata)
    from data import prepare
    prepare(folder)
    write(folder/'review/gallery.json',{'metadata':metadata,'clips':[{k:c[k] for k in ['id','family','label','split','rendered_frames','captions']}|{'decision':next(r['decision'] for r in reviews if r['clip_id']==c['id'])} for c in [read(p) for p in sorted((folder/'candidates').glob('*.json'))]]})
    print(json.dumps(metadata,ensure_ascii=False))


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('action',choices=['build','accept']);parser.add_argument('--dataset',default='datasets/vtuber-v2');parser.add_argument('--decisions',default='datasets/vtuber-v2/review/visual-decisions.json')
    args=parser.parse_args();folder=ROOT/args.dataset
    build(folder) if args.action=='build' else accept(folder,ROOT/args.decisions)

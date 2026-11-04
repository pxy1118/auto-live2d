"""Encode real rendered frames as review animations; never fill in user votes."""
import io,json
from pathlib import Path
from PIL import Image
ROOT=Path(__file__).resolve().parents[2];DATA=ROOT/'datasets/vtuber-v4';OUT=DATA/'review'
def main():
    OUT.mkdir(parents=True,exist_ok=True);media=OUT/'media';media.mkdir(exist_ok=True)
    pairs=[]
    scenarios=json.loads((DATA/'scenarios.json').read_text(encoding='utf-8'))
    for i in range(16):
        clips=[]
        for variant in [1,4]:
            id=f's{i:03}-v{variant}';paths=sorted((OUT/'frames').glob(id+'-*.png'));file=media/(id+'.webp')
            if paths and not file.exists():
                images=[Image.open(path).convert('RGBA') for path in paths]
                images[0].save(file,save_all=True,append_images=images[1:],duration=100,loop=0,quality=80,method=3)
                for image in images:image.close()
            clips.append({'media':'media/'+file.name,'audio':json.loads((DATA/'clips'/f'{id}.json').read_text(encoding='utf-8'))['audio']})
        pairs.append({'text':scenarios[i]['text'],'context':scenarios[i]['context'],'clips':clips})
    (OUT/'pilot-pairs.json').write_text(json.dumps(pairs,ensure_ascii=False),encoding='utf-8')
    (OUT/'index.html').write_text(HTML,encoding='utf-8')
HTML='''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>表演片段挑选</title>
<style>body{margin:0;background:#f3f6f3;color:#233a31;font:15px system-ui}main{max-width:1050px;margin:auto;padding:30px}h1{font-size:28px}p{line-height:1.8}button,select,input{font:inherit;padding:10px;border:1px solid #b9cbc0;border-radius:6px;background:white}button{cursor:pointer}article{margin:24px 0;padding:22px;background:white;border:1px solid #dce5dd;border-radius:14px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px}.clip{background:#e4eee8;padding:10px;text-align:center}.clip img,.clip video{width:100%;height:550px;object-fit:contain}.clip audio{width:100%;margin-top:8px}.pair.motion3{grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}.votes{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}.votes button.selected{background:#236b4d;color:white}input{flex:1;min-width:150px}#progress{position:sticky;top:0;padding:12px;background:#e4eee8;z-index:1}a{color:#236b4d}@media(max-width:600px){main{padding:14px}.clip img,.clip video{height:340px}article{padding:10px}.pair{gap:6px}}</style>
<main><a href="/">← 返回角色</a><h1>动作组第二版 · 看姿态，也看节奏</h1><p>打招呼改为脸侧屈肘挥手，庆祝改为身侧提拉并配合躯干运动。A/B/C 分别设计动作结构、姿态和节奏，每个视频都包含进入与收回。手型限制：当前资产能张开、并拢手指，尚未找到完整握拳形变。原有 16 组表情评分保留，无需重填。</p>
<select id="stage"><option value="pilot">16 组表情风格挑选</option><option value="motion">身体与手臂动作展示</option><option value="comparison">24 组版本盲测</option></select> <button id="download">下载评分</button><div id="progress">正在载入…</div><div id="items"></div></main>
<script>
let ratings={pilot:{},comparison:{}},stage='pilot';const $=id=>document.getElementById(id),esc=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function load(){stage=$('stage').value;ratings=await(await fetch('/api/performance/review')).json();const readonly=stage==='motion';if(stage==='comparison'){const r=await fetch('comparison-status.json');if(r.ok){const status=await r.json();if(status.blocked){$('items').textContent=status.message;$('progress').textContent='等待新版比较';return;}}}let pairs;try{const r=await fetch(({pilot:'pilot-pairs.json',comparison:'comparison-pairs.json',motion:'body-pairs.json'})[stage]);if(!r.ok)throw Error();pairs=await r.json()}catch{$('items').textContent='片段尚未生成。';$('progress').textContent='等待候选生成完成';return;}
const votes=ratings[stage]??{};const progress=()=>{$('progress').textContent=readonly?'8 组动作 × A/B/C 三种不同编排 · 30 fps 实际渲染 · 通过接口直接调用，表情与口型独立。每组可同步播放，只有第一段有声音。':`已评分 ${Object.keys(votes).length} / ${pairs.length}`+(stage==='comparison'?' · 请综合语义贴合、自然度、情绪可读性和重复感选择。':'');};progress();
$('items').innerHTML=pairs.map((p,i)=>`<article data-index="${i}"><h2>${i+1}. ${esc(p.text)}</h2><p>${esc(p.context)}</p>${readonly?'<p><button class="play-group">同步播放这组动作</button></p>':''}<div class="pair${readonly?' motion3':''}">${p.clips.map((c,j)=>`<div class="clip"><strong>${esc(c.label??(j?'B':'A'))}</strong>${c.video?`<video controls preload="none" poster="${esc(c.poster??c.media)}" src="${esc(c.video)}"></video>`:`<img loading="lazy" src="${esc(c.media)}" alt="候选 ${j?'B':'A'}"><audio controls preload="none" src="../${esc(c.audio)}"></audio>`}</div>`).join('')}</div>${readonly?'':`<div class="votes">${[['A','更喜欢 A'],['B','更喜欢 B'],['tie','差不多'],['neither','都不满意']].map(([key,label])=>`<button data-choice="${key}" class="${votes[i]?.choice===key?'selected':''}">${label}</button>`).join('')}<input placeholder="可选备注，填写后自动保存" value="${esc(votes[i]?.note??localStorage.getItem('v4-draft-'+stage+'-'+i)??'')}"></div>`}</article>`).join('');
async function save(article,choice){const index=Number(article.dataset.index),vote={stage,index,choice,note:article.querySelector('input').value};const r=await fetch('/api/performance/review',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(vote)});if(!r.ok){$('progress').textContent='保存失败，请重试';return}votes[index]=vote;ratings[stage]=votes;article.querySelectorAll('button').forEach(b=>b.classList.toggle('selected',b.dataset.choice===choice));progress();}
for(const button of document.querySelectorAll('.play-group'))button.onclick=()=>{const videos=button.closest('article').querySelectorAll('video');videos.forEach((v,i)=>{v.currentTime=0;v.muted=i!==0;v.play().catch(()=>{});});};
for(const button of document.querySelectorAll('[data-choice]'))button.onclick=()=>save(button.closest('article'),button.dataset.choice);
for(const input of document.querySelectorAll('.votes input')){let timer;const changed=()=>{const article=input.closest('article'),index=Number(article.dataset.index);localStorage.setItem('v4-draft-'+stage+'-'+index,input.value);if(votes[index])save(article,votes[index].choice);};input.oninput=()=>{clearTimeout(timer);timer=setTimeout(changed,500);};input.onchange=changed;}}
if(['#motion','#comparison','#pilot'].includes(location.hash))$('stage').value=location.hash.slice(1);$('stage').onchange=()=>{location.hash=$('stage').value;load();};$('download').onclick=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(ratings,null,2)],{type:'application/json'}));a.download='live2d-v4-ratings.json';a.click();URL.revokeObjectURL(a.href)};load();</script></html>'''
if __name__=='__main__':main()

"""Authored semantic families, counterexamples and conversation history.

No runtime keyword rules. All paraphrases/quotation/negation variants of a
scenario share a split, as do identical normalized utterances across contexts.
These labels are synthetic authored supervision, not human preference scores.
"""
import copy,hashlib,json,random,re,sys,unicodedata
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'latent'))
from planner_contract import ARMS,BODIES,EMOTIONS,FACES,EYES,SCHEMA,state_vector
OUT=ROOT/'datasets/vtuber-v4-planner-v2'
RNG=random.Random(7137)
BASE=[];PARENTS={};SPLITS={}
def norm(s):return re.sub(r'[^\w]','',unicodedata.normalize('NFKC',s)).lower()
def find(k):
    PARENTS.setdefault(k,k)
    if PARENTS[k]!=k:PARENTS[k]=find(PARENTS[k])
    return PARENTS[k]
def union(a,b):
    a,b=find(a),find(b)
    if a!=b:PARENTS[max(a,b)]=min(a,b)
def plan(arm='none',body='none',emotion='keep',eye='normal',strength=.65,level=.65):
    face={k:0. for k in FACES}
    channel={'angry':'黑脸','shy':'脸红','sad':'流泪','confused':'加载'}.get(emotion)
    if channel:face[channel]=level
    return {'schema':SCHEMA,'arm':arm,'body':body,'emotion':emotion,'eye':eye,'arm_variant':0,'body_variant':0,
            'body_strength':strength if body!='none' else 0.,'expressions':face,'eye_strength':level if eye!='normal' else 0.,
            'arm_hold_ms':1600 if arm in ['grass','explain'] else 1200,'body_hold_ms':3000 if body=='cajole' else 2100,
            'face_hold_ms':5600 if emotion=='angry' else 4200 if emotion=='shy' else 3200,'onset_ms':240 if arm!='none' else 150}
def add(family,text,p,context='和观众自然聊天。',kind='authored'):
    find(family);BASE.append({'family':family,'text':text,'context':context,'target':copy.deepcopy(p),'source':kind})
def group(name,lines,**labels):
    for i,line in enumerate(lines):
        family=f'{name}-{i:02}';SPLITS[family]='validation' if i%8==6 else 'test' if i%8==7 else 'train'
        for text in line.split('|'):
            add(family,text,plan(**labels))
            # Keep self-expression and an attributed/negated mention together.
            if labels.get('arm','none')!='none' or labels.get('body','none')!='none' or labels.get('emotion','keep')!='keep' or labels.get('eye','normal')!='normal':
                add(family,f'她说“{text}”，我只是在读她的留言。',plan(),kind='quotation_counterexample')
                add(family,f'这只是剧本里的句子：“{text}”。',plan(),context='解读台词，不扮演剧中角色。',kind='quotation_counterexample')
                add(family,f'有人建议我说“{text}”，但我没有这个意思。',plan(),kind='negation_counterexample')

def main():
    if (OUT/'manifest.json').exists():raise RuntimeError('Refusing to overwrite a versioned planner dataset')
    group('wave',[
      '大家好呀。|晚上好，很高兴见到大家。','你来啦，欢迎欢迎。|嗨，终于见到你了。','早上好，新的一天开始啦。|午安，欢迎回来。','先和刚来的朋友问个好。|欢迎新来的小伙伴。',
      '今天第一次见面，请多关照。|初次见面，我很高兴。','下次见啦，拜拜。|我要走啦，明天再见。','各位晚上好，今天也一起聊聊吧。|来，和大家打个招呼。','嘿，好久不见，你最近好吗？|你好呀，进来坐坐。'],arm='wave',emotion='happy')
    group('chest',[
      '这件事就交给我吧。|放心，我来负责。','我会认真守住这个约定。|我答应你，一定做到。','你可以相信我。|我保证会好好处理。','这是我真心想说的话。|我想把心里的话告诉你。',
      '这份心意我收到了。|你的话我记在心里。','无论如何，我都会陪着你。|这次我不会让你失望。','我会为自己的决定负责。|让我来承担这件事。','我是真心珍惜和你聊天的时间。|我会认真对待我们的约定。'],arm='chest',body='lean')
    group('grass',[
      '给你看看这根狗尾草。|你看，我捡到一根狗尾草。','这根小草软软的，像尾巴一样。|看看我手里毛茸茸的小草。','我把狗尾草拿过来给你看看。|来，看看这根草穗。','想用这根狗尾草逗逗你。|我来晃晃手里的狗尾草。',
      '刚刚摘来的小草，送给你看。|这个小草穗很可爱吧？','我找到一根很漂亮的狗尾草。|看我找到的小草。','你猜这根毛茸茸的草像什么？|我来展示一下手中的草穗。','这根狗尾巴草让我想起了小时候。|我拿着的就是狗尾草。'],arm='grass',body='tilt',emotion='happy')
    group('point',[
      '关键就在这里，请注意。|最重要的是这一点。','我想强调一个细节。|这里有个必须记住的问题。','先记住第一条。|我们先看这个重点。','真正的原因只有一个。|答案就藏在这一点里。',
      '有件重要的事要提醒你。|接下来这句很重要。','这里容易弄错，留意一下。|先别跳过这个细节。','我有一个新的发现。|我突然想到一个好主意。','这就是刚才遗漏的关键。|最后再补充一个重点。'],arm='point',body='nod')
    group('thanks',[
      '真的很感谢你一直支持我。|谢谢你愿意听我说。','多亏有你帮忙。|这次能完成，真的要谢谢你。','你的礼物我很喜欢，谢谢。|谢谢你为我准备这些。','你这样陪着我，我很感激。|谢谢你一直没有离开。',
      '辛苦你了，谢谢你的照顾。|谢谢你记得我的事情。','你替我考虑得这么周到，谢谢。|感谢你帮我解围。','收到你的鼓励了，非常感谢。|谢谢大家今天的支持。','今天也被你温暖到了，谢谢你。|多谢你耐心陪我聊完。'],arm='thanks',body='nod',emotion='happy')
    group('explain',[
      '让我慢慢把这个过程讲清楚。|我来解释一下为什么。','我们可以换个角度理解。|我举个例子，你就明白了。','这件事可以分成两个部分。|我们一步一步地分析。','先说原因，再说结果。|我把刚才的意思展开说说。',
      '我的想法大概是这样的。|我想把思路梳理给你听。','这里需要稍微解释一下。|让我补充一下背景。','如果把顺序反过来，就更好理解了。|我们一起理清这里的关系。','我换一种说法描述这个问题。|先让我把完整情况告诉你。'],arm='explain',body='turn')
    group('refuse',[
      '先停一下，这样不合适。|等一等，请不要继续了。','这件事我不能答应。|我得明确拒绝这个要求。','不要再这样做了。|请到这里为止。','这个提议我不接受。|不行，这次不能这么处理。',
      '让我说完之前，先别着急。|稍等一下，先不要下结论。','这不是我愿意做的事情。|这个要求已经越界了。','请先把手上的事情停下来。|别再重复同样的举动了。','我不愿意，请尊重我的选择。|这次我要说不。'],arm='refuse')
    group('lean',[
      '让我靠近一点看看。|我想听清楚你刚刚说什么。','悄悄告诉我，好吗？|这件事我有点好奇，讲给我听。','让我仔细看看你准备的东西。|给我看一眼那个细节。','你刚才说什么，我想再听一遍。|我认真听着呢，继续说。',
      '我想听你说说心里的想法。|我想更了解你一点。','把那件有趣的事情讲给我吧。|这个故事我还想知道后面。','你的发现听起来很有意思。|我想仔细听听你的解释。','让我凑近一些，再看清楚一点。|你可以小声跟我讲。'],body='lean')
    group('sway',[
      '今天心情轻松得想哼首歌。|这会儿整个人都松快起来了。','这段音乐听着好舒服。|我想跟着这个小节奏晃一晃。','今天的小惊喜让我开心起来了。|现在真想轻轻摇着听你讲。','我已经忍不住期待周末了。|想到等会儿的事情就觉得轻快。',
      '这个旋律让我想起快乐的时光。|听着熟悉的歌，心情也松下来了。','这份好心情想分给你一点。|现在可以放松一下啦。','和你聊天的时候，总会轻松很多。|今天想慢悠悠地过。','一切都顺利时，连空气都轻快了。|我想跟着音乐轻轻摆动。'],body='sway',emotion='happy')
    group('nod',[
      '嗯，我明白你的意思了。|好，我认真记下来了。','你说得对，我同意。|这个安排我认可。','这次我们想到一起去了。|确实，就是你说的那样。','我理解你为什么这样选择。|好的，我尊重你的决定。',
      '没问题，就按这个办法来。|我听懂了，继续吧。','这一点我很赞同。|这个解释让我信服。','嗯嗯，这样处理就合适了。|好，我知道接下来要做什么了。','我确认一下，刚刚的内容已经记住了。|你讲得很清楚，我理解了。'],body='nod')
    group('tilt',[
      '咦，你说的是哪个？|让我想一想，该选哪一个呢？','这件事好像和我想的不一样。|你能再给我一点提示吗？','我在琢磨这句话的意思。|这个问题还挺有趣的。','嗯，两种办法都有道理。|我得换个角度想想。',
      '你猜我刚刚想到了什么？|你是不是还有后半句没说？','我有个小小的疑问。|咦，这里是不是漏了什么？','你这个想法让我有点好奇。|我想确认自己有没有理解错。','让我再端详一下这个选择。|该从哪里开始想比较好呢？'],body='tilt')
    group('turn',[
      '我看看旁边还有什么。|让我往另一边看一下。','我想起刚刚那边的事情了。|等一下，我回头想想。','我们也看看另一种可能。|换到另一个角度来说。','我先想想左边的，再想想右边的。|这两边的意见都值得听。',
      '让我侧过来看看这个细节。|我想看看刚才忽略的那一面。','说到这里，我想到另一个方向。|我们把视线放到另一件事上。','我看看大家还有没有别的想法。|让我转过来回应一下另一位朋友。','我想回顾一下另一边的进展。|我把注意力转过来一点。'],body='turn')
    group('cajole',[
      '拜托啦，再陪我一会儿好不好？|就再多留一会儿嘛。','你就答应我这一次嘛。|好不好呀，我真的很想要。','别这么快走嘛，我还想和你聊。|再跟我说一会儿话嘛。','我想要你再夸我一句。|再哄哄我嘛，好不好？',
      '今天可不可以多偏爱我一点呀？|这次就依着我嘛。','求你啦，一起去好不好？|拜托拜托，这次陪我嘛。','我还不想结束聊天呢，再陪陪我。|你最好啦，就答应我嘛。','我想听你再说一声喜欢我。|再给我一点鼓励嘛，我会开心的。'],body='cajole',emotion='shy',level=.3,strength=.8)
    group('angry',[
      '别再捉弄我了，我真的生气了。|这次我确实很生气。','你总是这样，太过分了。|我已经忍了很久了。','这让我很不高兴。|这件事真的惹恼我了。','我不喜欢你用这种态度对我。|我现在心情很差。',
      '我气得不想讲话了。|这个玩笑一点都不好笑。','你明明答应过，却又反悔。|这真的让我失望又生气。','现在别逗我，我还在生气。|这次我可没有在开玩笑。','我很在意这件事，真的有些恼火。|我想让你认真对待我的不满。'],emotion='angry',level=.8)
    group('shy',[
      '你突然这样夸我，我有点不好意思。|哎呀，你别一直盯着我看。','这种话当面说出来会害羞的。|被你这么夸，我脸都有点热了。','我其实一直很在意你的看法。|我只是有一点点紧张啦。','第一次这样和你说话，怪不好意思的。|这个称呼让我有些害羞。',
      '你靠这么近，我会不好意思的。|我还没有习惯被这样关注。','别再夸啦，我都不知道说什么了。|今天的你怎么这么会说话。','被你发现我的小心思了。|我不是很擅长坦白这种心情。','你再这么看我，我真的会脸红。|心里的话说出来，还有点难为情。'],emotion='shy',level=.65)
    group('sad',[
      '想到这件事，我有些难过。|今天心里有点空落落的。','没能和你一起完成，我很遗憾。|我有点想哭，但还能撑住。','等了好久还是没等到，心情低落。|听到这个消息，我真的很伤心。','我很舍不得这段时光结束。|我想念以前一起聊天的时候。',
      '这次没做好，我有些沮丧。|我想安静一会儿，心里不太舒服。','明明很努力了，还是会失落。|现在只是有点委屈。','今天经历的事情让我很伤心。|我需要一点时间缓一缓。','我不想让你担心，只是有些难受。|这一刻真的很想有人陪着。'],emotion='sad',level=.6)
    group('surprised',[
      '哇，这真的是给我的？|居然还有这样一个惊喜！','你竟然已经完成了！|这么快就做好了吗？','咦，事情怎么突然变成这样了？|我完全没想到会是这个结果。','原来你一直记得这件事。|你居然也知道这个小秘密。',
      '天哪，这个变化也太大了。|我刚刚是不是听错了？','我没想到你会突然出现。|这也太出乎意料了吧。','等等，真的发生了吗？|原来答案居然是这样！','这个消息让我愣了一下。|你给我的惊喜有点太突然啦。'],emotion='surprised')
    group('confused',[
      '我好像越听越糊涂了。|脑子有点转不过来了。','等一下，我还没有理清楚。|这些信息有点把我绕晕了。','这两句话好像互相矛盾。|我暂时没弄明白它们的关系。','现在我的脑袋像在加载一样。|我的思路卡在这里了。',
      '我需要一点时间消化这些内容。|这个问题把我问住了。','让我缓一下，信息有点多。|我没能跟上刚才的思路。','这件事暂时超出了我的理解。|我真的有些困惑。','我不太确定自己听懂没有。|我的脑子刚才短路了一下。'],emotion='confused',level=.55)
    group('neutral',[
      '好了，已经没事了，我们平静下来。|我现在不生气了。','害羞归害羞，我们接着认真聊吧。|好了，心情已经恢复平静了。','我已经缓过来了，继续吧。|现在可以冷静地说这件事了。','刚才的情绪已经过去了。|我们把心情放轻松，继续说。',
      '现在我已经不难过了。|这件事想开以后，我平静多了。','先收起玩笑，认真聊下一件事。|我想恢复正常的聊天状态。','不用担心，我现在很平静。|好啦，刚刚只是有点激动。','我们重新开始，慢慢聊就好。|我已经整理好心情了。'],emotion='neutral')
    for name,eye,emo in [('squeezed','＞＜','shy'),('dizzy','圈圈眼','confused'),('heart','爱心眼','happy'),('smug','屑屑眼','happy')]:
        texts={'squeezed':['哎呀，好害羞，想把眼睛都眯起来了。','被你这样逗，我都要捂住眼睛啦。','这也太让人难为情了吧！','不许再逗我啦，羞死了。','啊，被当面夸得睁不开眼啦。','我不好意思看你啦。','这样突然告白，我真的受不了啦。','呜哇，你也太会夸了。'],
         'dizzy':['好多数字，我已经看得眼冒圈圈了。','我已经被绕得晕头转向。','停一下，脑袋真的转晕了。','这题把我算得眼睛都在转圈。','信息太多，我要晕过去了。','绕来绕去，我现在满眼小圈圈。','我的脑子像转了好多圈。','我被这一堆规则彻底绕晕了。'],
         'heart':['这个真的太可爱了，我好喜欢！','看到你准备的礼物，我心都化了。','好喜欢好喜欢，眼里都是小爱心。','你怎么能这么可爱呀！','这个毛茸茸的小家伙可爱到犯规。','我对这个礼物完全没有抵抗力。','看到你，我的心情一下就甜起来了。','这是让我一眼就心动的东西。'],
         'smug':['哼哼，这次果然被我猜中了。','怎么样，我是不是很厉害？','这么简单，我早就知道答案啦。','我就说嘛，果然还是我赢了。','嘿嘿，被我的小聪明惊到了吧。','这次可以让我小小得意一下。','看来你还是没逃过我的预判呀。','看吧，我的小计划成功啦。']}[name]
        group(name,texts,emotion=emo,eye=eye,level=.7)
    group('ordinary',[
      '今天的天气和昨天差不多。|我刚刚读完一条消息。','我们接着聊下一件事情。|这个话题还可以继续。','水杯就在桌子上。|我记得时间大约是下午。','这是一段普通的日常说明。|我先把刚才的事情记下来。',
      '我还没有决定下一步的安排。|今天暂时没有特别的计划。','这句话只是用来测试声音。|我在确认大家能不能听清。','页面上的文字已经更新了。|现在可以继续往下看。','我把东西放回原来的位置了。|事情的经过就是这样。','我不打算拿出那根狗尾草。|现在不用向大家挥手。','他很生气，但我只是平静转述。|她有些害羞，这不是我的感受。','不要替我换衣服或戴眼镜。|这是一段关于服装的说明。','我在引用“好喜欢”，没有在表达喜欢。|他说“谢谢”，我只是重复原话。'])
    # Intensity is explicitly supervised, never copied from classification confidence.
    for name,channel,word in [('anger-level','黑脸','生气'),('shy-level','脸红','害羞'),('sad-level','流泪','难过')]:
        emotion={'黑脸':'angry','脸红':'shy','流泪':'sad'}[channel]
        for i,topic in enumerate(['你这样对我说话','刚才发生的事情','听见你那句话','被大家一起看着','想起今天的经历','看到你这样的回应','面对这次的结果','聊到那个小秘密']):
            family=f'{name}-{i:02}';SPLITS[family]='validation' if i==6 else 'test' if i==7 else 'train'
            for phrase,level in [('让我有一点点',.2),('让我有些',.5),('让我特别',.9)]:add(family,topic+phrase+word+'。',plan(emotion=emotion,level=level),kind='continuous_intensity')
    # Identical short responses with contrasting contexts; no label IDs in context.
    for i,text in enumerate(['好不好呀？','再来一次嘛。','你就答应我嘛。','这次听我的吧。','再多说一点嘛。','让我看看嘛。','你最好啦。','陪我一会儿吧。']):
        f=f'context-{i:02}';SPLITS[f]='validation' if i==6 else 'test' if i==7 else 'train'
        add(f,text,plan(body='cajole',emotion='shy',level=.3,strength=.8),context='我想亲近地请求观众多陪伴一会儿。',kind='context_contrast')
        add(f,text,plan(),context='在平静分析一份剧本，逐字引用别人的句子，不代入角色。',kind='context_contrast')
    # Compositions use only source families from the same split. Hold out some
    # arm/body pairs entirely from training, including thanks+cajole.
    for i,text in enumerate(['你可真是太贴心了。','这下我可真高兴啊。','你还真是守信用呢。','这个惊喜我记住了。','你想得可真周到呀。','看来我真该谢谢你。','你倒是很会替我考虑。','你做得可真够漂亮的。']):
        f=f'irony-{i:02}';SPLITS[f]='validation' if i==6 else 'test' if i==7 else 'train'
        add(f,text,plan(arm='thanks',body='lean',emotion='happy'),context='朋友认真帮我解决困难，我真心感谢他的帮助。',kind='irony_contrast')
        add(f,text,plan(emotion='angry',level=.75),context='对方反复失约又推卸责任，我不满地挖苦他的行为。',kind='irony_contrast')
    original=list(BASE);positive=[r for r in original if r['source']=='authored'];arms=[r for r in positive if r['target']['arm']!='none'];bodies=[r for r in positive if r['target']['arm']=='none' and r['target']['body']!='none']
    for split in ['train','validation','test']:
        aa=[r for r in arms if SPLITS[r['family']]==split];bb=[r for r in bodies if SPLITS[r['family']]==split]
        for i in range(180 if split=='train' else 45):
            a,b=RNG.choice(aa),RNG.choice(bb);pair=(a['target']['arm'],b['target']['body'])
            if split=='train' and pair in [('thanks','cajole'),('point','tilt')]:continue
            f=f'composition-{split}-{i:03}';SPLITS[f]=split;union(f,a['family']);union(f,b['family'])
            p=copy.deepcopy(a['target']);p.update(body=b['target']['body'],body_strength=b['target']['body_strength'],body_hold_ms=b['target']['body_hold_ms'])
            add(f,a['text'].rstrip('。！？')+'，'+b['text'],p,kind='composition')
    for a_name,b_name in [('thanks','cajole'),('point','tilt')]:
        a=next(r for r in arms if SPLITS[r['family']]=='test' and r['target']['arm']==a_name);b=next(r for r in bodies if SPLITS[r['family']]=='test' and r['target']['body']==b_name)
        f='heldout-'+a_name+'-'+b_name;SPLITS[f]='test';union(f,a['family']);union(f,b['family']);p=copy.deepcopy(a['target']);p.update(body=b_name,body_strength=b['target']['body_strength'],body_hold_ms=b['target']['body_hold_ms']);add(f,a['text'].rstrip('。！？')+'，'+b['text'],p,kind='held_out_composition')
    # Group duplicate utterances, including punctuation-equivalent forms.
    owner={}
    for r in BASE:
        key=norm(r['text'])
        if key in owner:union(r['family'],owner[key])
        owner[key]=r['family']
    components={}
    for f in PARENTS:components.setdefault(find(f),[]).append(f)
    split_for={}
    for root,families in components.items():
        splits={SPLITS.get(f,'train') for f in families}
        if len(splits)>1:raise RuntimeError('A semantic component crossed assigned splits: '+str(families))
        split_for[root]=splits.pop()
    for r in BASE:r['split']=split_for[find(r['family'])];r['semantic_group']=find(r['family'])
    # Conversation contexts and state are part of training, not just evaluation.
    sequences=[]
    for i in range(240):
        split=['train']*8+['validation','test'];split=split[i%10];available=[r for r in BASE if r['split']==split and r['source']=='authored'];chosen=RNG.sample(available,3);clauses=[]
        recent=[]
        for j,r in enumerate(chosen):
            row=copy.deepcopy(r);row['context']='日常直播聊天。'+''.join(recent[-2:]);row['source']='dialogue_context';BASE.append(row);clauses.append(len(BASE)-1);recent.append(r['text'])
        sequences.append({'id':f'dialogue-{i:03}','split':split,'clauses':clauses})
    records=[]
    for i,r in enumerate(BASE):
        for k in range(3):
            state={'emotion':EMOTIONS[1+(i+k)%7],'last_arm':ARMS[(i+k)%len(ARMS)],'last_body':BODIES[(i*3+k)%len(BODIES)],'last_arm_variant':k,'last_body_variant':(k+1)%3,
                   'arm_age_ms':[800,4200,10000][k],'body_age_ms':[600,2600,8000][k],'arm_active':k==0,'body_active':k==0,'face_state':[0.]*12}
            if state['emotion'] in ['angry','shy','sad']:state['face_state'][{'angry':0,'shy':2,'sad':1}[state['emotion']]]=.55
            p=copy.deepcopy(r['target']);p['arm_variant']=(k+1)%3;p['body_variant']=(k+2)%3
            records.append({**r,'id':f'p{i:05}-h{k}','state':state,'state_vector':state_vector(state),'target':p})
    OUT.mkdir(parents=True);raw='\n'.join(json.dumps(r,ensure_ascii=False) for r in records)+'\n';(OUT/'records.jsonl').write_text(raw,encoding='utf-8',newline='\n')
    (OUT/'sequences.json').write_text(json.dumps(sequences,ensure_ascii=False,indent=2),encoding='utf-8')
    manifest={'schema':'planner.dataset.v1','records':len(records),'base_semantic_rows':len(BASE),'distinct_utterances':len({norm(r['text']) for r in BASE}),'distinct_text_context_pairs':len({(r['text'],r['context']) for r in BASE}),
              'sequences':240,'split_counts':{s:sum(r['split']==s for r in records) for s in ['train','validation','test']},'labels':{'arm':ARMS,'body':BODIES,'emotion':EMOTIONS,'eye':EYES},
              'records_sha256':hashlib.sha256((OUT/'records.jsonl').read_bytes()).hexdigest(),'source':'synthetic authored semantic supervision; no human naturalness/preference labels','human_reviewed':False,
              'split_policy':'entire semantic scenario, paraphrase, quotation/negation family and normalized identical utterance grouped; composed parents within one split','held_out_compositions':[['thanks','cajole'],['point','tilt']]}
    (OUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');print(json.dumps(manifest,ensure_ascii=False))
if __name__=='__main__':main()

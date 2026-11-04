"""Constrained next-token semantic decision, with explicit policy and order audit."""
import json
import random
from planner_contract import BODIES
from common import feature_message

CLASSES=[('forbidden','none'),('optional','none')]+[('optional',b) for b in BODIES[1:]]+[('required',b) for b in BODIES[1:]]
LETTERS=list('ABCDEFGHIJKLMN')
POLICY='''你为Live2D角色选择一次身体回应。默认风格明显但有节制；普通讲话不能每句都歪头或点头。
context是事实、过去对白和观众发言；text是角色即将说的原话。先判断这句话在当前情境中的用途，再判断身体。朗读、引用、转述、校对台词时，被引用者的请求或情绪不属于角色本人；没有明确演绎要求时应保持。普通数字、文件信息、步骤播报和进度汇报也保持。单凭问号、称赞词或撒娇句式不能决定动作，须结合事实语境。否定和反讽按真实意图理解。
forbidden=不新启动明显动作组；optional=可以轻微回应，也可以保持；required=当下沟通意图确实需要可见回应。none仍有呼吸和眨眼。
lean=靠近关注、看微小细节；sway=跟随正在播放的音乐；nod=确认、赞同、支持；tilt=思考、疑惑、亲近回应；turn=转向另一人或声源、回避；cajole=亲近地挽留、讨小愿望。只选一组。没有清楚动机时用none。
从下面选择一项，只输出对应的一个英文字母，不输出解释或JSON。'''

def class_order(seed):
    order=list(range(len(CLASSES)));random.Random(seed).shuffle(order);return order

def code_messages(text,context,seed):
    item=feature_message(text,context,'natural');order=class_order(seed)
    choices='\n'.join(f'{letter}={CLASSES[i][0]},{CLASSES[i][1]}' for letter,i in zip(LETTERS,order))
    return [dict(role='system',content=POLICY+'\n'+choices),dict(role='user',content=json.dumps(dict(context=item['context'],text=item['text']),ensure_ascii=False))]

def semantic_order(letter_probabilities,seed):
    result=[0.]*len(CLASSES)
    for value,index in zip(letter_probabilities,class_order(seed)):result[index]=float(value)
    return result

def marginals(probabilities):
    import torch
    probabilities=torch.as_tensor(probabilities,dtype=torch.float32);shape=probabilities.shape[:-1]
    body=probabilities.new_zeros(*shape,len(BODIES));necessity=probabilities.new_zeros(*shape,3)
    for i,(n,b) in enumerate(CLASSES):
        body[...,BODIES.index(b)]+=probabilities[...,i];necessity[... ,['forbidden','optional','required'].index(n)]+=probabilities[...,i]
    return dict(logits=body.clamp_min(1e-10).log(),necessity=necessity.clamp_min(1e-10).log(),
                strength=probabilities.new_zeros(shape)+.6)

def editorial_strength(pred,necessity_logits):
    import torch
    # Provisional defaults, never described as learned amplitude or render validation.
    return torch.where(pred==0,0.,torch.where(necessity_logits.argmax(-1)==2,.6,.24))

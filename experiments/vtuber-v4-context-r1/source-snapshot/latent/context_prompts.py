"""Input-only variants for the frozen-backbone context experiment.

No sample IDs, annotations, acceptable sets or target intensities are accepted.
The task prompt is a generic editorial policy, with no labeled examples.
"""
import json
import math
from common import feature_message
from planner_contract import BODIES

MODES=['legacy_json','context_first','task_context_first']
TASK_PROMPT='''你是Live2D角色的身体导演。context给出事实、过去对白与当前观众发言；text是角色即将说的话。结合语境理解含蓄意图、否定和反讽，区分角色本人和被引用的人。只选一个身体动作组，外观和手臂不在本次任务内。
动作：none保持当前姿态；lean靠近关注或看细节；sway随正在播放的节奏轻摇；nod确认、赞同或支持；tilt思考、疑惑或亲近回应；turn转向发言者、声源或回避；cajole亲近地挽留或讨小愿望，前倾扭动。
必要性：forbidden表示普通汇报或原样转述无需新启动明显身体组；optional表示小幅回应或保持都合理；required表示此刻应有清楚的身体回应。none不关闭背景呼吸。
仅输出JSON，字段necessity只能为forbidden/optional/required，body只能为上述动作名，strength为0到1数值。forbidden必须none；required不得none；none强度为0。optional启用时通常0.12到0.35，required通常0.45到0.8。强度独立于置信度。不要解释。'''

def messages(text,context,mode):
    original=feature_message(text,context,'natural')
    if mode=='legacy_json':return [{'role':'user','content':json.dumps(original,ensure_ascii=False)}]
    if mode not in MODES:raise ValueError('Unknown context mode')
    content=json.dumps(dict(context=original['context'],text=original['text'],style=original['style']),ensure_ascii=False)
    user=dict(role='user',content=content)
    return ([dict(role='system',content=TASK_PROMPT)] if mode=='task_context_first' else [])+[user]

def prompt(tokenizer,text,context,mode):
    return tokenizer.apply_chat_template(messages(text,context,mode),tokenize=False,add_generation_prompt=True,enable_thinking=False)

def parse_direct(text):
    """Strict output contract: no regex salvage or hidden retries."""
    result=json.loads(text)
    if not isinstance(result,dict) or set(result)!=set(['necessity','body','strength']):raise ValueError('Unexpected fields')
    if result['necessity'] not in ['forbidden','optional','required']:raise ValueError('Unknown necessity')
    if result['body'] not in BODIES:raise ValueError('Unknown body')
    value=result['strength']
    if isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value) or not 0<=value<=1:raise ValueError('Invalid strength')
    if result['necessity']=='forbidden' and result['body']!='none':raise ValueError('Forbidden active group')
    if result['necessity']=='required' and result['body']=='none':raise ValueError('Required none')
    if result['body']=='none' and value!=0:raise ValueError('Inactive strength')
    return result

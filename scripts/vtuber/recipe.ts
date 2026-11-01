/** Semantic balance: ordinary dialogue is mostly hands-down and has no blush preset. */
export type Pose = { yaw:number; pitch:number; tilt:number; lean?:number; smile?:number; brow?:number; mouth?:number; open?:number; gazeY?:number; hand?:'point'|'chest'|'grass'|'both'; wink?:boolean; bounce?:number };
export type Effect = [number,number,string[]];
export type Family = { id:string; label:string; split:'train'|'validation'|'test'; pose:Pose; texts:string[]; contexts:string[]; effects?:Effect[]; variants?:number; body?:'default'|'preset1'|'preset2'; nativeMotion?:string; kind?:'quiet'|'expressive'|'configuration'|'native' };
const quiet:Pose={yaw:2,pitch:-1.5,tilt:2.5,smile:.14,mouth:.12,gazeY:.08};
export const families:Family[]=[
 {id:'greeting_calm',label:'自然问候',split:'train',pose:{...quiet,smile:.3},texts:['大家晚上好，我们开始吧。','你来啦，今天也一起聊聊。','上午好，今天过得怎么样？','欢迎回来，坐下来休息一下吧。'],contexts:['直播开始，正常问候观众。','熟悉的观众进入直播间，友好地回应。']},
 {id:'thanks_calm',label:'礼貌道谢',split:'train',pose:{...quiet,pitch:-3,smile:.28},texts:['谢谢你的建议，我记下了。','收到你的支持啦，我们继续。','多谢提醒，刚才差一点忘了。','谢谢你耐心等我处理完。'],contexts:['观众给出普通帮助，礼貌道谢。','日常互动中的感谢，没有被调侃或告白。']},
 {id:'explain_calm',label:'平静说明',split:'train',pose:{...quiet,yaw:-3,brow:.08},texts:['保存设置后，下次打开会继续使用。','这个选项可以在菜单里找到。','我们先把文件放进同一个目录。','这一段的意思是先准备好材料。'],contexts:['向观众正常解释操作或概念。','按顺序说明一个普通步骤。']},
 {id:'casual_chat',label:'日常闲聊',split:'train',pose:quiet,texts:['今天阳光不错，出去走走挺舒服的。','我刚刚喝了一杯热茶。','周末想在家看看书。','这段音乐听起来很放松。'],contexts:['直播间轻松闲聊日常生活。','与观众随意聊天，没有特别强烈的情绪。']},
 {id:'acknowledge',label:'自然确认',split:'train',pose:{...quiet,pitch:-2},texts:['嗯，我已经收到了。','好的，我记得这件事。','明白，我们接着往下看。','可以，就按照这个顺序来。'],contexts:['确认普通消息或安排。','回答对方的日常确认，不需要强调。']},
 {id:'listen',label:'安静倾听',split:'train',pose:{...quiet,lean:-1.8},texts:['我在听，你慢慢讲。','然后呢，我想听后面的事情。','这个部分可以再说详细一点吗？','好呀，今天听你来分享。'],contexts:['观众分享生活，角色安静倾听。','让出说话空间，保持关注。']},
 {id:'think_calm',label:'轻轻思考',split:'train',pose:{...quiet,yaw:4,pitch:2,tilt:-4,gazeY:.16},texts:['我再想一下，应该还有别的做法。','这个问题需要考虑几个方面。','我好像在别的地方见过它。','先整理一下思路，再给你答案。'],contexts:['认真思考问题，短暂移开视线。','回答需要组织语言的问题。']},
 {id:'reassure',label:'温和安慰',split:'train',pose:{...quiet,lean:-3,smile:.25,brow:-.12},texts:['没关系，我们慢慢来就好了。','今天很努力了，先休息一会儿。','偶尔做不好也没有关系。','别着急，我会陪你一起想办法。'],contexts:['温和安慰遇到困难的观众。','对方有点沮丧，给予平静支持。']},
 {id:'happy_smile',label:'开心微笑',split:'train',pose:{yaw:4,pitch:-2,tilt:-4,smile:.5,mouth:.5},texts:['这个结果不错，我很开心。','今天的进展比预想中顺利。','能和大家一起玩真好。','刚刚那个故事让我忍不住笑了。'],contexts:['普通的开心和愉悦，不是害羞。','直播中遇到令人开心的小事。']},
 {id:'agree_nod',label:'点头赞同',split:'train',pose:{...quiet,pitch:-5,tilt:-3,smile:.25},texts:['嗯嗯，你说得有道理。','我也认为这样更合适。','这个方案不错，我们试试看。','好，那我们就达成一致啦。'],contexts:['听完说明后温和赞同。','与观众对普通问题达成共识。']},
 {id:'deny_playful',label:'轻松否认',split:'train',pose:{yaw:7,pitch:1,tilt:-4,smile:.26,mouth:.3},texts:['才没有偷懒呢，我一直很认真。','哎呀，你又在开我的玩笑了。','刚刚那一次不能算我输嘛。','别乱猜啦，事情不是那样的。'],contexts:['熟人之间轻松调侃，并非真正生气。','小游戏里的无害玩笑回应。']},
 {id:'confused',label:'短暂迷糊',split:'train',pose:{yaw:-6,pitch:2,tilt:6,brow:.2,gazeY:.14},effects:[[1.2,2.2,['加载']],[2.7,3.7,['圈圈眼']]],texts:['这条规则有点绕，让我缓一下。','刚刚的信息太多，我需要整理一下。','嗯？我好像没有跟上。','再解释一遍好不好，我有点迷糊。'],contexts:['短暂困惑，用轻微喜剧表情回应。','面对复杂信息，表现思考中的迷糊。']},
 {id:'moved',label:'感动泪花',split:'train',pose:{yaw:3,pitch:-3,tilt:-4,lean:-2.5,smile:.35,mouth:.3},effects:[[1.3,3.3,['流泪']]],texts:['你们一直陪着我，我真的很感动。','原来大家都还记得这件事。','谢谢，这份温暖我收到了。','努力终于被看见了，心里有一点酸酸的。'],contexts:['收到温暖支持，感动得眼含泪花。','积极的感动，而不是害羞或悲痛。']},
 {id:'wink_tiny',label:'轻轻眨一只眼',split:'train',pose:{yaw:-4,pitch:-1,tilt:5,smile:.4,mouth:.4,wink:true},texts:['这是我们的小秘密，记得保密哦。','刚刚那一下，我是故意让你的啦。','猜对了会有小奖励哦。','嘿嘿，下一步可要注意看。'],contexts:['友好的小玩笑，短暂单眼眨眼。','与观众俏皮互动，不含夸奖或告白。']},
 {id:'shy_praise',label:'被夸奖时害羞',split:'train',pose:{yaw:-4,pitch:-2,tilt:5,smile:.35,mouth:.3},effects:[[1.5,2.9,['脸红']]],texts:['你突然这样夸我，我有一点不好意思。','别一直夸啦，我都不知道看哪里了。','被你这么认真地夸奖，怪难为情的。','我会害羞的啦，先让我缓一缓。'],contexts:['观众真诚地夸角色本人，角色明确害羞。','连续收到关于自己的赞美，略微羞涩。']},
 {id:'shy_secret',label:'含蓄表达喜欢',split:'train',pose:{yaw:4,pitch:-2,tilt:-5,smile:.35,mouth:.25},effects:[[1.5,2.9,['脸红']]],texts:['说出来很难为情，我真的很喜欢你。','这句话我练习了好久才敢说。','别笑我啦，我是真的有些紧张。','我有一点点喜欢和你待在一起。'],contexts:['含蓄告白或表达心意，明显羞涩。','谈及自己的心意，害羞而不夸张。']},
 {id:'anger_boundary',label:'认真表达边界',split:'train',pose:{yaw:-3,pitch:-2,tilt:2,lean:-2,smile:0,brow:-.38,mouth:-.35},effects:[[1,3.5,['黑脸']]],texts:['请停止这样的玩笑，我已经说过不喜欢。','这句话真的让我生气了。','我不接受被这样对待，请认真一点。','你已经越过我的底线了。'],contexts:['被冒犯而认真生气，明确表达边界。','严肃恼火，不是撒娇或调情。']},
 {id:'anger_game',label:'失败时恼火',split:'train',pose:{yaw:4,pitch:1,tilt:-3,smile:0,brow:-.35,mouth:-.3},effects:[[1,3.5,['黑脸']]],texts:['可恶，这次失败也太离谱了！','又被卡在这里，真的很烦。','明明已经成功了，怎么又出问题！','这也太不公平了吧，我真的不服气。'],contexts:['游戏失败带来真实恼火，短暂黑脸。','因为不合理的挫折而生气，不是玩笑。']},
 {id:'point_explain',label:'必要时短暂食指',split:'train',pose:{yaw:-4,pitch:-1,tilt:3,smile:.2,hand:'point'},texts:['注意看这个位置，这是关键的一步。','这里有个重点，我单独指出来。','先记住第一条规则，其他的后面再说。','看我指的这里，不要漏掉这个按钮。'],contexts:['讲解一个需要特别指出的重点，短暂食指。','明确向观众指示重点位置。']},
 {id:'grass_prop',label:'明确展示狗尾草',split:'train',pose:{yaw:5,pitch:1,tilt:-5,smile:.35,hand:'grass'},texts:['看这个小草草，是不是很可爱？','让我拿出那根狗尾草给你看。','这个小道具会不会让你开心一点？','猜猜我手里的狗尾草像什么。'],contexts:['明确拿出角色自带狗尾草道具。','观众要求展示狗尾草，进行短暂演示。']},
 {id:'chest_gesture',label:'郑重抚胸',split:'train',pose:{yaw:-3,pitch:-3,tilt:3,lean:-2,smile:.25,hand:'chest'},texts:['我向你保证，这件事我会认真对待。','这份承诺，我会放在心上。','请相信我，我会尽力完成。','让我郑重地说一声，谢谢你的信任。'],contexts:['郑重表达承诺，短暂抚胸。','需要明确仪式感的承诺或致谢。']},
 {id:'celebrate',label:'身体雀跃为主',split:'train',pose:{yaw:5,pitch:-3,tilt:-5,smile:.58,mouth:.55,bounce:.8,hand:'both'},effects:[[1.4,2.8,['＞＜']]],texts:['成功啦，我们终于做到了！','好耶，这一关终于过了！','太棒了，这次配合真顺利。','我们的努力有结果啦！'],contexts:['完成挑战后开心庆祝，以头身雀跃为主。','胜利后的喜悦，少量强调动作。']},
 {id:'question_calm',label:'平静询问',split:'validation',pose:quiet,texts:['你刚刚说的是哪一个选项？','这个问题你想先听哪一部分？','要不要先把条件再确认一下？','你今天想聊些什么呢？'],contexts:['普通询问并等待回答。','日常对话中的平静提问。']},
 {id:'anger_ignored',label:'被忽视的恼火',split:'validation',pose:{yaw:3,pitch:-2,tilt:-2,smile:0,brow:-.35,mouth:-.3},effects:[[1.1,3.4,['黑脸']]],texts:['我已经提醒过两次了，别再忽略我的话。','这件事不能再这样敷衍过去。','我不是在开玩笑，请认真听我说。','一直被打断真的让我很不高兴。'],contexts:['反复被忽视，严肃而克制地生气。','真实恼怒，不是撒娇。']},
 {id:'shy_ack',label:'羞涩接受心意',split:'validation',pose:{yaw:-3,pitch:-2,tilt:4,smile:.3,mouth:.2},effects:[[1.6,2.8,['脸红']]],texts:['你这样认真地说，我会脸红的。','原来你一直在注意我，好难为情。','别盯着我看啦，我真的会害羞。','这份心意让我有点不知所措。'],contexts:['被认真表白或注视，明确羞涩。','关于角色本人的亲密赞美，害羞接受。']},
 {id:'status_plain',label:'普通进度汇报',split:'test',pose:quiet,texts:['文件整理好了，可以继续了。','我已经检查过一遍，没有遗漏。','这里的内容全部保存好了。','准备工作结束，我们进入下一步。'],contexts:['普通任务进度汇报。','正常说明已经完成的工作。']},
 {id:'anger_reject',label:'生气地拒绝',split:'test',pose:{yaw:-3,pitch:0,tilt:2,smile:0,brow:-.38,mouth:-.32},effects:[[1,3.4,['黑脸']]],texts:['够了，这种要求我不会答应。','我很生气，这件事到此为止。','请不要再用这种态度和我说话。','你这样做真的太过分了。'],contexts:['面对冒犯，严肃生气地拒绝。','明确的愤怒与边界表达，不是玩笑。']},
 {id:'thanks_plain',label:'普通感谢回应',split:'test',pose:{...quiet,pitch:-2.5,smile:.25},texts:['谢谢提醒，幸好你告诉我了。','辛苦了，我们继续下一项。','多谢你的帮助，这下就顺利了。','你提供的信息很有用，谢谢。'],contexts:['对普通帮助表示感谢。','友好的工作或生活感谢。']}
];

const configuration=(id:string,label:string,pose:Pose,texts:string[],effects:Effect[]=[],body?:Family['body'],nativeMotion?:string):Family=>({id,label,split:'train',pose,texts,contexts:['观众明确请求切换或展示这个角色配置。','按指定要求演示该配置，随后恢复默认。'],effects,body,nativeMotion,variants:2,kind:nativeMotion?'native':'configuration'});
families.push(
 configuration('config_glasses','黑框眼镜配置',quiet,['戴上黑框眼镜给我看看。','演示一下黑框眼镜的样子。'],[[1,4,['黑框眼镜']]]),
 configuration('config_monocle','单片眼镜配置',quiet,['换成单片眼镜吧。','让我看看单片眼镜的效果。'],[[1,4,['单片眼镜']]]),
 configuration('config_bowl','钢盆配置',quiet,['把钢盆顶在头上玩一下。','展示一下角色的钢盆道具。'],[[1,4,['钢盆']]]),
 configuration('config_rabbit','兔牙配置',quiet,['露出可爱的兔牙看看。','演示一下兔牙表情。'],[[1,4,['兔牙']]]),
 configuration('config_heart','爱心眼配置',quiet,['切到爱心眼给我看一下。','展示一下爱心眼的效果。'],[[1,4,['爱心眼']]]),
 configuration('config_smug','屑屑眼配置',quiet,['表演一下屑屑眼的表情。','换成那个得意的眼神吧。'],[[1,4,['屑屑眼']]]),
 configuration('config_sweat','流冷汗配置',quiet,['展示一下流冷汗的效果。','来个尴尬冒冷汗的表情。'],[[1,4,['流冷汗']]]),
 configuration('config_skirt','裙子切换配置',quiet,['演示一下裙子切换。','换一下裙子的配置看看。'],[[1,4,['裙子切换']]]),
 configuration('config_shoes','鞋子切换配置',quiet,['演示一下脱鞋再穿回去。','看看鞋子切换的配置。'],[[1,4,['脱鞋']]]),
 configuration('config_tail','尾巴开关配置',quiet,['把尾巴先藏起来，再恢复。','演示一下尾巴开关。'],[[1,4,['尾巴开关']]]),
 configuration('config_collar','胸口衣服配置',quiet,['切换一下胸口衣服的配置。','演示这个领口衣服选项。'],[[1,4,['胸口衣服']]]),
 configuration('config_body1','体型1配置',quiet,['切换到体型一，再恢复默认。','展示一下体型一的样子。'],[],'preset1'),
 configuration('config_body2','体型2配置',quiet,['切换到体型二，再恢复默认。','展示一下体型二的样子。'],[],'preset2'),
 configuration('config_default_body','默认体型配置',quiet,['把体型切回默认。','恢复角色默认体型吧。'],[],'default'),
 configuration('config_lean','前倾配置',{...quiet,lean:-12},['来一次明显的前倾，再回正。','演示一下前倾的设定。']),
 configuration('config_native','完整脱捕动画',{...quiet},['表演原始的脱捕动画。','播放失去跟踪时的完整原生动作。'],[],undefined,'脱捕')
);

// These quiet variants share exact target trajectories with casual_chat/default-body.
// Keep their entire equivalence group in train, before any model is fitted.
for(const f of families) if(['question_calm','status_plain'].includes(f.id)) f.split='train';
export const expressionPlan:Record<string,Effect[]>=Object.fromEntries(families.map(f=>[f.id,f.effects??[]]));
export const variantCount=(family:Family)=>family.variants??6;
export const bodyPoses=['default','preset1','preset2'];
export const nativeMotions=['none','脱捕'];

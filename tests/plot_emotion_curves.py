"""Plot real browser state and clearly separated authored control diagnostics."""
import json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib import font_manager

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'test-results/emotion-curves-v1'
report=json.loads((OUT/'browser/browser-smoke.json').read_text(encoding='utf-8'))
probe=json.loads((OUT/'curve-probe.json').read_text(encoding='utf-8'))
if not report.get('ok') or not report.get('emotion_curve'):raise RuntimeError('A successful real browser curve run is required')
font=Path('C:/Windows/Fonts/msyh.ttc')
if font.exists():
    font_manager.fontManager.addfont(str(font))
    plt.rcParams['font.family']=font_manager.FontProperties(fname=str(font)).get_name()
plt.rcParams['axes.unicode_minus']=False
plt.rcParams['font.size']=10
colors={'happy':'#C58A13','angry':'#CB4B48','shy':'#A463B7','sad':'#438AC0','surprised':'#3B9A8F','confused':'#777F89'}
names={'happy':'开心','angry':'生气','shy':'害羞','sad':'难过','surprised':'惊讶','confused':'困惑'}
fig,axes=plt.subplots(2,1,figsize=(12,7),layout='constrained')

seen=set();actual=[]
for row in report['emotion_curve']['trace']:
    if row['affect']['point_index']<0 or row['media_ms'] in seen:continue
    seen.add(row['media_ms']);actual.append(row)

def draw(ax,rows,keys):
    xs=[row['media_ms']/1000 for row in rows]
    for name in keys:
        ax.plot(xs,[row['affect']['target'][name] for row in rows],color=colors[name],lw=1,ls='--',alpha=.48)
        ax.plot(xs,[row['affect']['weights'][name] for row in rows],color=colors[name],lw=2.1,label=names[name])
    ax.set(xlabel='音频播放进度 / 秒',ylabel='表达权重（控制量）',ylim=(-.015,.91),xlim=(0,max(xs)))
    ax.spines[['top','right']].set_visible(False)
    ax.grid(axis='y',alpha=.16);ax.legend(ncol=len(keys),loc='upper left',frameon=False)

draw(axes[0],actual,list(colors))
scene=report['emotion_curve']
axes[0].set_title(f"真实语音播放：{len(scene['points'])} 个短语观测，{scene['plans']} 个动作语义句，{scene['tts_streams']} 次 TTS",loc='left',fontsize=12,pad=12)
draw(axes[1],probe['trace'],['happy','angry','shy'])
axes[1].set_title('控制层模拟：中性承接、短暂干扰、持续转折（非分类准确率评测）',loc='left',fontsize=12,pad=12)
axes[1].axvspan(5,5.5,color='#777F89',alpha=.11)
axes[1].axvspan(9,9.2,color='#CB4B48',alpha=.15)
axes[1].annotate('短暂干扰',xy=(9.1,.16),xytext=(10,.29),arrowprops={'arrowstyle':'->','color':'#777F89'},color='#555555')
axes[1].axvline(13,color='#777F89',lw=.7,alpha=.5)
axes[1].text(13.15,.83,'持续生气',color='#555555')
axes[1].set_xlabel('模拟播放进度 / 秒')
fig.suptitle('情绪由观测形成曲线，跨句延续并平滑转折',fontsize=16)
fig.supxlabel('虚线：阈值映射后的目标；实线：连续状态。模型分数与表达权重均不等同于真实情绪强度。',fontsize=9,color='#555555')
fig.savefig(OUT/'emotion-curves.png',dpi=180)
plt.close(fig)
print(OUT/'emotion-curves.png')

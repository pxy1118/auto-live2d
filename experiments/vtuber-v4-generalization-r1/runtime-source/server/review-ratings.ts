/** Versioned human review updates; callers load current data after request I/O. */
export function applyReviewVote(ratings:any,vote:any,status:any,at=new Date().toISOString()){
 if(!['pilot','comparison'].includes(vote.stage)||!Number.isInteger(vote.index)||vote.index<0||vote.index>=(vote.stage==='pilot'?16:24)||!['A','B','neither','tie'].includes(vote.choice)||vote.note!==undefined&&(typeof vote.note!=='string'||vote.note.length>1000))throw new Error('评分参数不合法');
 if(vote.dataset_version!==undefined){
  if(vote.stage!=='comparison'||typeof vote.dataset_version!=='string'||vote.dataset_version!==status.dataset_version||status.blocked)throw new Error('盲测版本已过期或尚未开放');
 }
 let destination=ratings[vote.stage]??={};if(vote.dataset_version!==undefined){ratings.comparisons??={};destination=ratings.comparisons[vote.dataset_version]??={};}
 destination[vote.index]={choice:vote.choice,note:vote.note??'',at,source:'user',...(vote.dataset_version?{dataset_version:vote.dataset_version}:{})};return ratings;
}

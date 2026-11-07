/** Punctuation inside quoted speech belongs to the attributed utterance.
 * Retain a following comma continuation so attribution/negation stays together.
 * `limit` is the enclosing unit's character budget: semantic clauses use 240,
 * TTS speech units use the Qwen3-TTS limit (see server/utterance.ts). */
export function clauseEnd(text:string,flush:boolean,sentenceOnly=false,limit=240){
 const quotes=new Map([['“','”'],['‘','’'],['「','」'],['『','』'],['（','）'],['(',')']]),stack:string[]=[];let quoted=false;
 for(let i=0;i<Math.min(limit,text.length);i++){
  const c=text[i];if(quotes.has(c)){stack.push(quotes.get(c)!);quoted=true;continue;}
  if(stack.at(-1)===c){stack.pop();continue;}
  if(c==='"'){if(stack.at(-1)==='"')stack.pop();else stack.push('"');quoted=true;continue;}
  if(!stack.length&&/[。！？!?；;\n]/.test(c))return i+1;
  if(!sentenceOnly&&!stack.length&&!quoted&&/[，,]/.test(c))return i+1;
 }
 return text.length>=limit?limit:flush?text.length:0;
}

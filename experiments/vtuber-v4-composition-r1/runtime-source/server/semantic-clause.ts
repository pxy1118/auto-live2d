/** Punctuation inside quoted speech belongs to the attributed utterance.
 * Retain a following comma continuation so attribution/negation stays together. */
export function clauseEnd(text:string,flush:boolean){
 const quotes=new Map([['“','”'],['‘','’'],['「','」'],['『','』'],['（','）'],['(',')']]),stack:string[]=[];let quoted=false;
 for(let i=0;i<Math.min(240,text.length);i++){
  const c=text[i];if(quotes.has(c)){stack.push(quotes.get(c)!);quoted=true;continue;}
  if(stack.at(-1)===c){stack.pop();continue;}
  if(c==='"'){if(stack.at(-1)==='"')stack.pop();else stack.push('"');quoted=true;continue;}
  if(!stack.length&&/[。！？!?；;\n]/.test(c))return i+1;
  if(!stack.length&&!quoted&&/[，,]/.test(c))return i+1;
 }
 return text.length>=240?240:flush?text.length:0;
}

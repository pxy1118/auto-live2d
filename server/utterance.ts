import {clauseEnd} from './semantic-clause';
/** One Qwen3-TTS streaming generation. The model wrapper limit is 400 characters
 * (speech/config.json); semantic clauses keep their smaller 240-char budget. */
export const MAX_UTTERANCE_CHARS=400;
export type ClauseSpan={clause:number;text:string;start:number;end:number};
/** Known text is packed into one speech unit; commas never commit a short unit. */
export function utteranceEnd(text:string,flush:boolean){
  if(flush&&text.length<=MAX_UTTERANCE_CHARS)return text.length;
  let offset=0,last=0;
  while(offset<Math.min(text.length,MAX_UTTERANCE_CHARS)){
    const end=clauseEnd(text.slice(offset),false,true,MAX_UTTERANCE_CHARS);
    if(!end||offset+end>MAX_UTTERANCE_CHARS)break;
    offset+=end;last=offset;
  }
  if(text.length<MAX_UTTERANCE_CHARS)return last;
  let end=last||MAX_UTTERANCE_CHARS;
  if(end<text.length&&/[\uD800-\uDBFF]/.test(text[end-1])&&/[\uDC00-\uDFFF]/.test(text[end]))end--;
  return end;
}
/** Offsets use Unicode code points, matching the Python model's string indices. */
export function semanticClauses(text:string,firstClause:number):ClauseSpan[]{
  const spans:ClauseSpan[]=[];let offset=0;
  while(offset<text.length){
    const end=offset+(clauseEnd(text.slice(offset),true,true)||text.length-offset),value=text.slice(offset,end).trim();
    if(value)spans.push({clause:firstClause+spans.length,text:value,start:Array.from(text.slice(0,offset)).length,end:Array.from(text.slice(0,end)).length});
    offset=end;
  }
  return spans;
}

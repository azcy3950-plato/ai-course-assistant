import { readFileSync } from 'fs';
import { join } from 'path';
import { buildCampus } from './model';
export function loadCampus(){
  const bytes=readFileSync(join(process.cwd(),'public','zijing_inp.inp'));
  const original=new TextDecoder('gb18030').decode(bytes);
  return {original,campus:buildCampus(original)};
}

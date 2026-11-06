import fs from 'node:fs';
import path from 'node:path';
import { approveSettings, settingsReview } from '../../plugin/engine/core/settings.mjs';

// Non-setting tests explicitly declare their fixture has no managed visual objects.
export function approveEmptySettings(dir,style=null) {
  const file=path.join(dir,'film.json'),film=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):{style};
  if(!film.style)film.style=style;
  fs.writeFileSync(file,JSON.stringify(film));
  fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify({version:1,categories:Object.fromEntries(['characters','props','scenes'].map(k=>[k,{status:'not-applicable',reason:'此测试仅验证其他模块，无管理的设定对象'}])),selections:[]}));
  const review=settingsReview(dir);
  approveSettings(dir,{expectedSignature:review.signature,source:'测试夹具明确确认三类均不适用'});
}

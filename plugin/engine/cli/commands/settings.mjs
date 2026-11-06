import fs from 'node:fs';
import path from 'node:path';
import { initSettings, saveSettingVersion, settingsReview, approveSettings, settingSnapshotFiles } from '../../core/settings.mjs';
import { commitSnapshot } from '../../core/project.mjs';
import { readProgress, recordProgress } from '../../core/state.mjs';

export function settingsCommands({pos,opt,log}) {
  const dir=()=>{if(!pos[0])throw new Error('需要片目录或项目目录');return path.resolve(pos[0]);};
  return {
    'settings-init':async()=>{log(JSON.stringify(initSettings(dir()),null,2));},
    'settings-save':async()=>{
      const file=opt('file');if(typeof file!=='string')throw new Error('settings-save 需要 --file 指向设定 JSON');
      log(JSON.stringify(saveSettingVersion(dir(),JSON.parse(fs.readFileSync(path.resolve(file),'utf8'))),null,2));
    },
    'settings-review':async()=>{const report=settingsReview(dir(),{write:true});log(JSON.stringify(report,null,2));return report.ready?0:2;},
    'settings-reuse':async()=>{
      const filmDir=dir(),approval=approveSettings(filmDir,{reuse:true,expectedSignature:opt('signature')});
      const note=`沿用项目中已确认且未变化的设定（继承记录 ${approval.signature}，未新增人审）`;
      if(!readProgress(filmDir).history.some(h=>h.step===5&&h.note===note))recordProgress(filmDir,{step:5,note});
      commitSnapshot(filmDir,note,{log,extraFiles:settingSnapshotFiles(filmDir)});
      log(JSON.stringify(approval,null,2));
    },
  };
}

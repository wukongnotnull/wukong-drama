// 原创程序合成配乐与拟声音效；非动物实录。
export default async function ({synth,duration,outDir}) {
 const bgm=synth.buffer(duration),amb=synth.buffer(duration),fx=synth.buffer(duration),random=synth.rng(72);
 const melody=['C5','E5','G5','E5','D5','F5','A5','G5','E5','G5','C6','G5'];
 for(let k=0;k<22;k++) {
  const at=k*.4+.08;if(at>=4.05&&at<4.6)continue;
  synth.qin(bgm,{at,note:melody[k%melody.length],dur:.32,gain:.5,bright:.8,vibrato:0,pan:k%2?.15:-.15});
  if(k%2===0)synth.qin(bgm,{at,note:k%4?'G3':'C4',dur:.25,gain:.25,vibrato:0});
 }
 for(const note of ['C5','E5','G5'])synth.qin(bgm,{at:9.05,note,dur:.8,gain:.22,vibrato:0});
 function noise(buf,at,dur,gain,decay=4){let lp=0;for(let n=0;n<dur*buf.sr;n++){const t=n/buf.sr,i=Math.floor(at*buf.sr)+n;if(i>=buf.L.length)break;lp=.8*lp+.2*(random()*2-1);const v=lp*gain*Math.sin(Math.PI*t/dur)*Math.exp(-decay*t);buf.L[i]+=v;buf.R[i]+=v*.95;}}
 for(const at of [1.5,2.4])noise(fx,at,.23,.28);
 for(const at of [3.7,4.2,4.25,4.31])noise(fx,at,.055,.65,35);
 for(const at of [7.5,7.9,8.65])noise(fx,at,.09,.2,12);
 function chirp(at){let phase=0;for(let n=0;n<.13*fx.sr;n++){const t=n/fx.sr,i=Math.floor(at*fx.sr)+n;phase+=2*Math.PI*(2400+1400*Math.sin(Math.PI*t/.13))/fx.sr;const v=.19*Math.sin(phase)*Math.pow(Math.sin(Math.PI*t/.13),2);fx.L[i]+=v;fx.R[i]+=v;}}
 for(const at of [5.6,5.79,7.2,8.7,8.9])chirp(at);
 let phase=0;for(let n=0;n<.34*fx.sr;n++){const t=n/fx.sr,i=Math.floor(6.2*fx.sr)+n;phase+=2*Math.PI*(510+220*Math.sin(Math.PI*t/.34))/fx.sr;const v=(Math.sin(phase)+.3*Math.sin(2*phase)+.13*Math.sin(3*phase))*.16*Math.sin(Math.PI*t/.34);fx.L[i]+=v;fx.R[i]+=v;}
 noise(amb,0,duration,.018,0);
 for(let i=0;i<bgm.L.length;i++){const t=i/bgm.sr;const g=t>=4.2&&t<4.6?0:Math.min(1,t/.08,(duration-t)/.15);bgm.L[i]*=g;bgm.R[i]*=g;}
 return [{file:synth.writeWav(bgm,`${outDir}/bgm.wav`),start:0,gain:0},{file:synth.writeWav(amb,`${outDir}/ambience.wav`),start:0,gain:0},{file:synth.writeWav(fx,`${outDir}/sfx.wav`),start:0,gain:0}];
}

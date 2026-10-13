const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const {ROOT,PYTHON,MODEL_DIR,runtimeEnv,killTree}=require('./ai-runtime');
const {normalizeSpeed}=require('./speech');
const {AudioCache,cacheKey}=require('./audio-cache');
class SupertonicSpeech{
 constructor(onState,workerSource,{spawnProcess=spawn,createAudio=url=>new Audio(url),writeWorker=true,cache=new AudioCache(ROOT),onResources=()=>{},minuteMs=60000}={}){Object.assign(this,{onState,workerSource,spawnProcess,createAudio,writeWorker,cache,onResources,minuteMs});this.serial=0;this.status='idle';this.rate=1;this.voice='F1';this.child=null;this.audio=null;this.url=null;this.idleMinutes=5;this.loaded=false;this.disposed=false;}
 resources(){this.onResources({loaded:this.loaded,process:Boolean(this.child),status:this.status});}
 emit(state,extra={}){this.status=state;this.onState({state,engine:'ai',voice:this.voice,rate:this.rate,...extra});this.resources();}
 setIdleMinutes(value){this.idleMinutes=[1,5,10,30].includes(Number(value))?Number(value):5;if(this.status==='idle')this.scheduleUnload();}
 scheduleUnload(){clearTimeout(this.idleTimer);if(!this.child||this.status!=='idle')return;this.idleSince??=Date.now();this.idleTimer=setTimeout(()=>{if(this.status==='idle')this.releaseModel();},Math.max(0,this.idleMinutes*this.minuteMs-(Date.now()-this.idleSince)));this.idleTimer.unref?.();}
 releaseModel(){clearTimeout(this.idleTimer);const child=this.child;this.child=null;this.loaded=false;this.idleSince=null;if(child)killTree(child);this.resources();return child;}
 async unloadModel(){const child=this.child;if(!child)return;const ended=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('AI 메모리 해제를 기다린 뒤 다시 시도해주세요.')),5000);child.once('close',()=>{clearTimeout(timer);resolve();});});this.releaseModel();await ended;}
 async speak(text,{aiVoice='F1',aiLanguage='ko',rate=1}={}){
  this.stop();clearTimeout(this.idleTimer);this.idleSince=null;const serial=this.serial;this.voice=aiVoice;this.rate=normalizeSpeed(rate);this.received=false;this.metrics={started:Date.now(),cacheHit:false};this.key=cacheKey(text,aiVoice,aiLanguage);this.cacheEpoch=this.cache?.epoch;this.emit('preparing',{message:'Supertonic 준비 중…'});
  try{const data=await this.cache?.get(this.key).catch(()=>null);if(serial!==this.serial||this.disposed)return;if(data){this.metrics.cacheHit=true;this.event({event:'audio',data:data.toString('base64'),cached:true},serial);return;}
   if(!this.child){const worker=path.join(ROOT,'supertonic-worker-0.6.0.py');if(this.writeWorker){fs.mkdirSync(ROOT,{recursive:true});fs.writeFileSync(worker,this.workerSource,'utf8');}const physical=file=>this.spawnProcess===spawn?fs.realpathSync.native(file):file;const child=this.spawnProcess(physical(PYTHON),['-u',physical(worker),physical(MODEL_DIR)],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:runtimeEnv()});this.child=child;this.loaded=false;this.resources();let buffer='';child.stdout.setEncoding('utf8');child.stdout.on('data',data=>{if(this.child!==child)return;buffer+=data;let n;while((n=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,n);buffer=buffer.slice(n+1);let event;try{event=JSON.parse(line);}catch{continue;}this.event(event,event.id);}});child.stderr.on('data',()=>{});child.stdin.on('error',()=>{if(this.child===child)this.fail('AI에 글을 전달하지 못했습니다. 다시 시도해주세요.',this.serial)});child.on('error',()=>{if(this.child===child)this.fail('AI 실행 도구를 시작하지 못했습니다. 설정에서 설치 상태를 확인해주세요.',this.serial)});child.on('close',()=>{if(this.child!==child)return;this.child=null;this.loaded=false;this.resources();if(this.status==='preparing'&&!this.received)this.fail('AI 음성 생성이 중단되었습니다. 다시 시도해주세요.',this.serial);});}
   this.child.stdin.write(JSON.stringify({id:serial,text,speaker:aiVoice,language:aiLanguage})+'\n','utf8');
  }catch(e){this.fail('AI 실행 파일을 찾지 못했습니다. 설정에서 설치 상태를 확인해주세요.',serial);}
 }
 event(event,serial){
  if(serial!==this.serial||this.disposed)return;if(event.event==='error'){this.fail(event.message,serial);return;}if(event.event==='loaded'){this.loaded=true;this.metrics.loadSeconds=event.seconds;this.resources();return;}if(event.event==='progress'){this.emit('preparing',{message:`전체 음성 준비 중… ${event.completed} / ${event.total}`});return;}if(event.event!=='audio'||this.received)return;
  this.received=true;Object.assign(this.metrics,{generationSeconds:event.seconds,duration:event.duration,parts:event.parts});const data=Buffer.from(event.data,'base64');if(!event.cached)void this.cache?.put(this.key,data,this.cacheEpoch).catch(()=>{});
  try{this.url=URL.createObjectURL(new Blob([data],{type:'audio/wav'}));const audio=this.createAudio(this.url);this.audio=audio;audio.playbackRate=this.rate;audio.preservesPitch=true;audio.onplaying=()=>{if(serial!==this.serial)return;if(!this.metrics.firstPlayMs)this.metrics.firstPlayMs=Date.now()-this.metrics.started;this.emit('speaking');};audio.onpause=()=>{if(serial===this.serial&&!audio.ended)this.emit('paused');};audio.onended=()=>{if(serial===this.serial)this.stop();};audio.onerror=()=>this.fail('준비한 음성을 재생하지 못했습니다.',serial);Promise.resolve(audio.play()).catch(()=>this.fail('음성 재생을 시작하지 못했습니다.',serial));}catch{this.fail('준비한 음성을 재생하지 못했습니다.',serial);}
 }
 pause(){if(this.status==='speaking')this.audio?.pause();}
 resume(){if(this.status==='paused'&&this.audio){const serial=this.serial;Promise.resolve(this.audio.play()).catch(()=>this.fail('음성 재생을 이어가지 못했습니다.',serial));}}
 setRate(value){this.rate=normalizeSpeed(value);if(this.audio)this.audio.playbackRate=this.rate;this.emit(this.status);}
 releaseAudio(){if(this.audio){this.audio.onplaying=this.audio.onpause=this.audio.onended=this.audio.onerror=null;this.audio.pause();this.audio.removeAttribute('src');this.audio.load();this.audio=null;}if(this.url){URL.revokeObjectURL(this.url);this.url=null;}}
 stop(){const preparing=this.status==='preparing';this.serial++;if(preparing)this.releaseModel();this.releaseAudio();this.emit('idle');this.scheduleUnload();}
 fail(message,serial){if(serial!==this.serial)return;this.stop();this.releaseModel();this.emit('error',{message});}
 dispose(){this.disposed=true;this.stop();this.releaseModel();}
}
module.exports={SupertonicSpeech};

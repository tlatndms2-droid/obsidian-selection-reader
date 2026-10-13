const fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),https=require('node:https'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const {AI_VOICES,AI_LANGUAGES}=require('./ai-catalog');
const {modelBytes,removeModelFiles}=require('./model-store');
const MODEL='Supertone/supertonic-3',REVISION='3cadd1ee6394adea1bd021217a0e650ede09a323';
const ROOT=path.join(process.env.LOCALAPPDATA || path.join(require('node:os').homedir(),'AppData','Local'),'SelectionReader','supertonic-3');
const PYTHON=path.join(ROOT,'python','python.exe'),MODEL_DIR=path.join(ROOT,'models','supertonic-3');
const runtimeEnv=()=>({...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8',HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1',HF_HOME:path.join(ROOT,'hf'),NUMBA_CACHE_DIR:path.join(ROOT,'numba'),TOKENIZERS_PARALLELISM:'false'});
const killTree=child=>{if(!child?.pid)return;try{spawn('taskkill',['/pid',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'}).on('error',()=>{try{child.kill();}catch{}});}catch{try{child.kill();}catch{}}};
class AiRuntime{
 constructor(onChange=()=>{},isInUse=()=>false){this.onChange=onChange;this.isInUse=isInUse;this.state={phase:'missing',message:'미설치',bytes:0,total:0,installedBytes:0};this.runId=0;this.children=new Set();this.requests=new Set();this.busy=false;this.refresh();}
 update(state){this.state={...this.state,...state};this.onChange(this.state);}
 refresh(){if(this.busy)return;let installedBytes=0;try{installedBytes=modelBytes(MODEL_DIR);}catch(e){this.update({phase:'error',message:e.message,installedBytes:0});return;}try{const ready=JSON.parse(fs.readFileSync(path.join(ROOT,'ready.json'),'utf8'));if(ready.revision!==REVISION || !fs.existsSync(PYTHON) || !fs.existsSync(path.join(ROOT,'packages-ready.json')) || !ready.files?.length)throw Error('missing');for(const f of ready.files){if(fs.statSync(path.join(MODEL_DIR,f.name)).size!==f.size)throw Error('incomplete');}this.catalog=ready.catalog;this.update({phase:'ready',message:'Supertonic 3 설치됨',bytes:ready.bytes,total:ready.bytes,installedBytes,detail:''});}catch{this.update({phase:installedBytes?'incomplete':'missing',message:installedBytes?'설치 파일이 불완전합니다. 다시 설치해주세요.':'미설치',bytes:0,total:0,installedBytes,detail:''});}}
 async acquireLock(){const lock=path.join(ROOT,'install.lock');await fsp.mkdir(ROOT,{recursive:true});if(fs.existsSync(lock)){let alive=false;try{const owner=JSON.parse(await fsp.readFile(lock,'utf8'));process.kill(owner.pid,0);alive=true;}catch{}if(alive)throw Error('다른 창에서 모델을 관리 중입니다. 완료 후 다시 시도해주세요.');await fsp.unlink(lock);}await fsp.writeFile(lock,JSON.stringify({pid:process.pid}),{flag:'wx'});return lock;}
 async removeModel(){
  if(this.busy||this.isInUse())throw Error('AI 준비·재생·일시정지를 끝낸 뒤 모델을 삭제해주세요.');
  this.busy=true;let lock;
  try{this.update({phase:'deleting',message:'Supertonic 모델 삭제 중…',detail:''});lock=await this.acquireLock();if(this.isInUse())throw Error('AI 낭독을 정지한 뒤 삭제해주세요.');await removeModelFiles(ROOT,MODEL_DIR);this.catalog=null;this.update({phase:'missing',message:'모델 삭제됨 · 다시 설치할 수 있습니다.',bytes:0,total:0,installedBytes:0,detail:''});}
  catch(e){this.update({phase:'error',message:'모델을 삭제하지 못했습니다.',detail:e.message});throw e;}
  finally{if(lock)await fsp.unlink(lock).catch(()=>{});this.busy=false;this.onChange(this.state);}
 }
 assert(id){if(id!==this.runId)throw Error('설치가 취소되었습니다.');}
 cancel(){if(this.state.phase==='deleting')return;this.runId++;for(const req of this.requests)req.destroy();this.requests.clear();for(const child of this.children)killTree(child);this.children.clear();this.update({phase:'cancelled',message:'설치 취소됨 · 다시 시도할 수 있습니다.'});}
 async request(url,id,onData){this.assert(id);return new Promise((resolve,reject)=>{
   const req=https.get(url,{headers:{'User-Agent':'SelectionReader/0.4.1'}},res=>{
    if(res.statusCode>=300&&res.statusCode<400&&res.headers.location){res.resume();this.requests.delete(req);resolve(this.request(new URL(res.headers.location,url).href,id,onData));return;}
    if(res.statusCode!==200){res.resume();reject(Error('다운로드 연결 실패 (HTTP '+res.statusCode+'). 인터넷 연결을 확인하고 다시 시도해주세요.'));return;}
    let bytes=0;res.on('data',chunk=>{bytes+=chunk.length;onData(chunk,bytes,Number(res.headers['content-length']||0));});res.on('end',resolve);res.on('error',reject);
   });this.requests.add(req);req.setTimeout(60000,()=>req.destroy(Error('다운로드 응답 시간 초과')));req.on('error',reject);req.on('close',()=>this.requests.delete(req));
 });}
 async json(url,id){const chunks=[];await this.request(url,id,c=>chunks.push(c));this.assert(id);return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
 async download(url,file,id,{size,hash,base=0,total=0}={}){
  this.assert(id);await fsp.mkdir(path.dirname(file),{recursive:true});
  if(size && fs.existsSync(file) && fs.statSync(file).size===size && (!hash || await this.hash(file)===hash)){this.update({bytes:base+size,total});return;}
  const tmp=file+'.partial';const fd=fs.openSync(tmp,'w');let received=0,last=0;
  try{await this.request(url,id,(chunk,n,max)=>{fs.writeSync(fd,chunk);received=n;if(Date.now()-last>200){last=Date.now();this.update({bytes:base+n,total:total||max});}});}finally{fs.closeSync(fd);}
  this.assert(id);if(size&&received!==size)throw Error('다운로드 파일 크기가 일치하지 않습니다.');if(hash&&await this.hash(tmp)!==hash)throw Error('다운로드 파일 검증에 실패했습니다.');this.assert(id);await fsp.rename(tmp,file);this.update({bytes:base+received,total:total||received});
 }
 async hash(file){const hash=crypto.createHash('sha256');for await(const c of fs.createReadStream(file))hash.update(c);return hash.digest('hex');}
 async run(exe,args,id,onOutput=()=>{}){this.assert(id);return new Promise((resolve,reject)=>{const child=spawn(exe,args,{windowsHide:true,stdio:['ignore','pipe','pipe'],env:runtimeEnv()});this.children.add(child);let tail='';const data=c=>{const s=c.toString();tail=(tail+s).slice(-2500);onOutput(s);};child.stdout.on('data',data);child.stderr.on('data',data);child.on('error',reject);child.on('close',code=>{this.children.delete(child);if(id!==this.runId)reject(Error('설치 취소됨'));else if(code!==0)reject(Error(tail||'설치 프로세스 실패 '+code));else resolve(tail);});});}
 async install(){
  if(this.busy||this.isInUse())return;this.busy=true;const id=++this.runId;let ownsLock=false;const lock=path.join(ROOT,'install.lock');
  try{
   await this.acquireLock();ownsLock=true;
   const space=await fsp.statfs(ROOT);if(space.bavail*space.bsize<2*1024**3)throw Error('설치하려면 여유 공간이 최소 2GB 필요합니다.');
   this.update({phase:'installing',message:'Python 실행 환경 다운로드',bytes:0,total:0});
   if(!fs.existsSync(PYTHON)){
    const zip=path.join(ROOT,'python-3.12.10-embed-amd64.zip');await this.download('https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip',zip,id);
    const ps=`$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; $dest='${path.dirname(PYTHON).replace(/'/g,"''")}'; [IO.Directory]::CreateDirectory($dest) | Out-Null; $archive=[IO.Compression.ZipFile]::OpenRead('${zip.replace(/'/g,"''")}'); try { foreach($entry in $archive.Entries) { $target=[IO.Path]::GetFullPath([IO.Path]::Combine($dest,$entry.FullName)); if(-not $target.StartsWith($dest+[IO.Path]::DirectorySeparatorChar)) { throw 'Invalid archive path' }; if($entry.Name) { [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null; [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$target,$true) } } } finally { $archive.Dispose() }`;
    await this.run(path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(ps,'utf16le').toString('base64')],id);
   }
   await fsp.writeFile(path.join(ROOT,'python','python312._pth'),'python312.zip\n.\nLib/site-packages\nimport site\n');
   if(!fs.existsSync(path.join(ROOT,'python','Lib','site-packages','pip'))){const pip=path.join(ROOT,'get-pip.py');await this.download('https://bootstrap.pypa.io/get-pip.py',pip,id);this.update({message:'설치 도구 준비'});await this.run(PYTHON,[pip,'--no-warn-script-location'],id);}
   if(!fs.existsSync(path.join(ROOT,'packages-ready.json'))){
    this.update({message:'Supertonic 실행 도구 설치 중',bytes:0,total:0});
    await this.run(PYTHON,['-m','pip','install','--no-compile','--no-cache-dir','--no-warn-script-location','onnxruntime==1.31.0','numpy==2.5.4','soundfile==0.14.0'],id);
    await this.run(PYTHON,['-c','import onnxruntime,numpy,soundfile; print(onnxruntime.__version__)'],id);
    await fsp.writeFile(path.join(ROOT,'packages-ready.json'),JSON.stringify({onnxruntime:'1.31.0'}));
   }
   this.update({message:'Supertonic 3 모델 파일 확인 중',detail:'',bytes:0,total:0});
   const meta=await this.json(`https://huggingface.co/api/models/${MODEL}/revision/${REVISION}?blobs=true`,id);
   const files=meta.siblings.filter(f=>f.rfilename.startsWith('onnx/') || /^voice_styles\/[FM][1-5]\.json$/.test(f.rfilename) || f.rfilename==='LICENSE');const total=files.reduce((n,f)=>n+f.size,0);let base=0;
   for(const f of files){this.assert(id);this.update({message:'Supertonic 3 다운로드 · '+f.rfilename,bytes:base,total});await this.download(`https://huggingface.co/${MODEL}/resolve/${REVISION}/${f.rfilename}`,path.join(MODEL_DIR,f.rfilename),id,{size:f.size,hash:f.lfs?.sha256,base,total});base+=f.size;}
   this.catalog={speakers:AI_VOICES,languages:Object.keys(AI_LANGUAGES)};
   this.assert(id);await fsp.writeFile(path.join(ROOT,'ready.json'),JSON.stringify({revision:REVISION,bytes:total,files:files.map(f=>({name:f.rfilename,size:f.size})),catalog:this.catalog}));
   this.update({phase:'ready',message:'Supertonic 3 설치됨',bytes:total,total,installedBytes:total,detail:''});
  }catch(e){if(id===this.runId)this.update({phase:'error',message:e.code==='ENOSPC'||e.message.includes('여유 공간')?'저장 공간이 부족합니다.':/HTTP|다운로드 응답|ECONN|ENOTFOUND|ETIMEDOUT/.test(e.message)?'다운로드 연결에 실패했습니다.':'AI 설치 실패',detail:e.message});}finally{if(ownsLock)await fsp.unlink(lock).catch(()=>{});try{this.state.installedBytes=modelBytes(MODEL_DIR);}catch{}this.busy=false;this.onChange(this.state);}
 }
 dispose(){if(this.busy)this.cancel();}
}
module.exports={AiRuntime,ROOT,PYTHON,MODEL_DIR,runtimeEnv,killTree};

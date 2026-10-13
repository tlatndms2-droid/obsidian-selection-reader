const {spawn} = require('node:child_process');
const path = require('node:path');
const SPEEDS = Array.from({length:31}, (_, index) => (50 + index * 5) / 100);
const normalizeSpeed = value => SPEEDS.includes(Number(value)) ? Number(value) : 1;
// User content is JSON on stdin, never executable command text.
const script = `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$engine = $null
$stream = $null
try {
  $request = [Console]::ReadLine() | ConvertFrom-Json
  Add-Type -AssemblyName System.Speech
  $engine = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $voices = @($engine.GetInstalledVoices() | Where-Object { $_.Enabled })
  if ($request.action -eq 'voices') {
    $items = @($voices | ForEach-Object { @{name=$_.VoiceInfo.Name;language=$_.VoiceInfo.Culture.Name} })
    [Console]::WriteLine((@{event='voices';voices=$items} | ConvertTo-Json -Compress -Depth 4))
  } else {
    if ($voices.Count -eq 0) { throw 'No installed Windows voice.' }
    if ($request.voice) { $engine.SelectVoice([string]$request.voice) }
    else {
      $korean = $voices | Where-Object { $_.VoiceInfo.Culture.Name -like 'ko-*' } | Select-Object -First 1
      if ($null -ne $korean) { $engine.SelectVoice($korean.VoiceInfo.Name) }
    }
    $stream = New-Object System.IO.MemoryStream
    $engine.SetOutputToWaveStream($stream)
    $engine.Speak([string]$request.text)
    $engine.SetOutputToNull()
    [Console]::WriteLine((@{event='audio';voice=$engine.Voice.Name;data=[Convert]::ToBase64String($stream.ToArray())} | ConvertTo-Json -Compress))
  }
} catch {
  [Console]::WriteLine((@{event='error';message=$_.Exception.Message} | ConvertTo-Json -Compress))
  exit 1
} finally {
  if ($null -ne $engine) { $engine.Dispose() }
  if ($null -ne $stream) { $stream.Dispose() }
}
`;
class WindowsSpeech {
  constructor(onState, spawnProcess=spawn, createAudio=url=>new Audio(url)) {
    this.onState=onState; this.spawnProcess=spawnProcess; this.createAudio=createAudio;
    this.serial=0;this.child=null;this.audio=null;this.url=null;this.voice='';this.rate=1;this.status='idle';this.queries=new Set();
  }
  emit(state,extra={}) {this.status=state;this.onState({state,voice:this.voice,rate:this.rate,...extra});}
  request(payload,onEvent,onError) {
    const child=this.spawnProcess(path.join(process.env.SystemRoot || 'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),
      ['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],
      {windowsHide:true,stdio:['pipe','pipe','pipe']});
    let buffer='',errors='',received=false;
    const fail=message=>{if(!received){received=true;onError(message);}};
    child.stdout.setEncoding('utf8');
    child.stdout.on('data',data=>{
      buffer+=data;let newline;
      while((newline=buffer.indexOf('\n'))>=0){
        const line=buffer.slice(0,newline).trim();buffer=buffer.slice(newline+1);if(!line)continue;
        let event;try{event=JSON.parse(line);}catch{continue;}
        if(event.event==='error'){fail(event.message);continue;}
        received=true;onEvent(event);
      }
    });
    child.stderr.on('data',data=>{errors=(errors+data.toString()).slice(-2000);});
    child.on('error',e=>fail(e.message));child.stdin.on('error',e=>fail(e.message));
    child.on('close',code=>{if(!received)fail(errors || 'Windows 음성 프로세스가 종료되었습니다 ('+code+').');});
    child.stdin.end(JSON.stringify(payload)+'\n','utf8');return child;
  }
  listVoices(){
    return new Promise((resolve,reject)=>{
      const child=this.request({action:'voices'},event=>{if(event.event==='voices')resolve(event.voices);},message=>reject(new Error(message)));
      this.queries.add(child);const timer=setTimeout(()=>{child.kill();reject(new Error('목소리 목록을 가져오는 시간이 초과되었습니다.'));},15000);
      child.on('close',()=>{clearTimeout(timer);this.queries.delete(child);});
    });
  }
  speak(text,{voice='',rate=1}={}) {
    this.stop();const serial=this.serial;this.voice=voice;this.rate=normalizeSpeed(rate);this.emit('preparing');
    const fail=message=>{if(serial===this.serial){this.stop();this.emit('error',{message});}};
    const child=this.request({action:'speak',text,voice},event=>{
      if(serial!==this.serial || event.event!=='audio')return;
      try{
        this.voice=event.voice;
        this.url=URL.createObjectURL(new Blob([Buffer.from(event.data,'base64')],{type:'audio/wav'}));
        const audio=this.createAudio(this.url);this.audio=audio;audio.playbackRate=this.rate;audio.preservesPitch=true;
        audio.onplaying=()=>{if(serial===this.serial)this.emit('speaking');};
        audio.onpause=()=>{if(serial===this.serial && !audio.ended)this.emit('paused');};
        audio.onended=()=>{if(serial===this.serial)this.stop();};
        audio.onerror=()=>fail('음성 오디오를 재생하지 못했습니다.');
        Promise.resolve(audio.play()).catch(e=>fail(e.message));
      }catch(e){fail(e.message);}
    },fail);
    this.child=child;child.on('close',()=>{if(this.child===child)this.child=null;});
  }
  pause(){if(this.audio && this.status==='speaking')this.audio.pause();}
  resume(){if(this.audio && this.status==='paused'){
    const serial=this.serial;Promise.resolve(this.audio.play()).catch(e=>{if(serial===this.serial){this.stop();this.emit('error',{message:e.message});}});
  }}
  setRate(value){this.rate=normalizeSpeed(value);if(this.audio)this.audio.playbackRate=this.rate;this.emit(this.status);}
  stop(){
    this.serial++;
    if(this.child){this.child.kill();this.child=null;}
    if(this.audio){this.audio.onplaying=this.audio.onpause=this.audio.onended=this.audio.onerror=null;this.audio.pause();this.audio.removeAttribute('src');this.audio.load();this.audio=null;}
    if(this.url){URL.revokeObjectURL(this.url);this.url=null;}
    this.emit('idle');
  }
  dispose(){this.stop();for(const child of this.queries)child.kill();this.queries.clear();}
}
module.exports={WindowsSpeech,SPEEDS,normalizeSpeed};

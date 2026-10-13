const {Plugin, Notice, setIcon, PluginSettingTab, Setting, Modal} = require('obsidian');
const {WindowsSpeech,SPEEDS,normalizeSpeed} = require('./speech');
const {normalizePdfText,frameRect,selectionFocusRect,selectionButtonPosition} = require('./selection');
const {AiRuntime}=require('./ai-runtime');
const {SupertonicSpeech}=require('./ai-speech');
const workerSource=require('./worker-source');
const {AI_VOICES,AI_LANGUAGES,LEGACY_LANGUAGES}=require('./ai-catalog');
class DeleteModelModal extends Modal {
 constructor(app,plugin){super(app);this.plugin=plugin;}
 onOpen(){
  this.titleEl.setText('Supertonic 모델을 삭제할까요?');
  this.contentEl.createEl('p',{text:`모델 파일 약 ${(this.plugin.runtime.state.installedBytes/1024**2).toFixed(1)} MB를 삭제합니다. 다시 사용하려면 다운로드가 필요합니다.`});
  this.contentEl.createEl('p',{text:'목소리·언어 설정과 실행 환경은 유지됩니다. 기존 Qwen 파일과 노트는 삭제하지 않습니다.'});
  const message=this.contentEl.createEl('p',{attr:{role:'status'}});
  new Setting(this.contentEl).addButton(button=>{button.setButtonText('취소').onClick(()=>this.close());this.cancelButton=button;}).addButton(button=>{
   button.setButtonText('모델 삭제 확인').setWarning().onClick(async()=>{
    if(this.plugin.isAIInUse()){message.setText('AI 낭독을 정지한 뒤 삭제해주세요.');return;}
    button.setDisabled(true);this.cancelButton.setDisabled(true);
    try{this.plugin.modelReleasing=true;await this.plugin.aiSpeech.unloadModel();this.plugin.modelReleasing=false;await this.plugin.runtime.removeModel();this.close();}catch(e){this.plugin.modelReleasing=false;message.setText(e.message);button.setDisabled(false);this.cancelButton.setDisabled(false);}
   });
  });
  this.cancelButton.buttonEl.focus();
 }
 onClose(){this.contentEl.empty();}
}
class ReaderSettings extends PluginSettingTab {
  constructor(app,plugin){super(app,plugin);this.plugin=plugin;}
  display(){
    const {containerEl}=this;containerEl.empty();const plugin=this.plugin;plugin.runtime.refresh();
    containerEl.createEl('h2',{text:'Selection Reader'});
    containerEl.createEl('p',{text:'변경한 음성 설정은 다음 낭독부터 적용됩니다.'});
    new Setting(containerEl).setName('음성 방식').addDropdown(drop=>{
      drop.selectEl.setAttribute('aria-label','음성 방식');drop.addOption('windows','Windows 기본 음성').addOption('ai','AI 음성 · Supertonic 3');drop.setValue(plugin.settings.engine).onChange(async value=>{
        plugin.settings.engine=value;await plugin.persistSettings();this.display();
        if(value==='ai' && plugin.runtime.state.phase!=='ready')void plugin.runtime.install();
        else if(value==='windows'&&plugin.runtime.busy)plugin.runtime.cancel();
      });
    });
    if(plugin.settings.engine==='windows'){
    new Setting(containerEl).setName('목소리').setDesc('현재 사용할 수 있는 Windows 음성입니다.').addDropdown(drop=>{
      drop.selectEl.setAttribute('aria-label','기본 목소리');drop.addOption('','자동 · 한국어 우선');
      for(const voice of plugin.voices)drop.addOption(voice.name,voice.name+' · '+voice.language);
      if(plugin.settings.voice && !plugin.voices.some(v=>v.name===plugin.settings.voice))drop.addOption(plugin.settings.voice,plugin.settings.voice+' · 현재 사용 불가');
      drop.setValue(plugin.settings.voice).onChange(async value=>{plugin.settings.voice=value;await plugin.persistSettings();});
    });
    }else{
      new Setting(containerEl).setName('AI 모델').setDesc('Supertonic 3 · 내 컴퓨터에서 실행 · 전체 음성 준비 후 재생');
      new Setting(containerEl).setName('AI 목소리').addDropdown(drop=>{drop.selectEl.setAttribute('aria-label','AI 목소리');for(const name of plugin.runtime.catalog?.speakers || AI_VOICES)drop.addOption(name,(name.startsWith('F')?'여성 ':'남성 ')+name.slice(1)+' · '+name);drop.setValue(plugin.settings.aiVoice).onChange(async value=>{plugin.settings.aiVoice=value;await plugin.persistSettings();});});
      new Setting(containerEl).setName('읽기 언어').setDesc('선택한 글의 언어를 지정하세요. 자동 감지는 지원하지 않습니다.').addDropdown(drop=>{drop.selectEl.setAttribute('aria-label','AI 읽기 언어');for(const name of plugin.runtime.catalog?.languages || Object.keys(AI_LANGUAGES))drop.addOption(name,AI_LANGUAGES[name]||name);drop.setValue(plugin.settings.aiLanguage).onChange(async value=>{plugin.settings.aiLanguage=value;await plugin.persistSettings();});});
      const status=new Setting(containerEl).setName('모델 상태');this.aiStatus=status.descEl;this.aiStatus.setAttribute('role','status');
      status.addButton(button=>{this.installButton=button;button.onClick(()=>void plugin.runtime.install());});
      status.addButton(button=>{this.cancelButton=button;button.setButtonText('다운로드 취소').onClick(()=>plugin.runtime.cancel());});
      const storage=new Setting(containerEl).setName('모델 사용 용량');this.storageStatus=storage.descEl;
      const manage=new Setting(containerEl).setName('설치 모델 관리');this.manageStatus=manage.descEl;
      manage.addButton(button=>{this.deleteButton=button;button.setButtonText('모델 삭제').setWarning().onClick(()=>new DeleteModelModal(this.app,plugin).open());});
      this.updateAIStatus();
      new Setting(containerEl).setName('AI 메모리 해제 시간').setDesc('낭독 종료·정지 후 사용하지 않는 시간이 지나면 메모리를 반환합니다. 일시정지 중에는 유지합니다.').addDropdown(drop=>{drop.selectEl.setAttribute('aria-label','AI 메모리 해제 시간');for(const minutes of [1,5,10,30])drop.addOption(String(minutes),minutes+'분');drop.setValue(String(plugin.settings.idleMinutes)).onChange(async value=>{plugin.settings.idleMinutes=Number(value);plugin.aiSpeech.setIdleMinutes(value);await plugin.persistSettings();});});
      this.memoryStatus=new Setting(containerEl).setName('AI 메모리 상태').descEl;
      const cache=new Setting(containerEl).setName('임시 음성');this.cacheStatus=cache.descEl;
      cache.addButton(button=>{this.clearCacheButton=button;button.setButtonText('임시 음성 비우기').onClick(async()=>{button.setDisabled(true);try{await plugin.aiSpeech.cache.clear();new Notice('임시 음성을 비웠습니다. 현재 낭독은 계속됩니다.');}catch{new Notice('임시 음성을 비우지 못했습니다. 저장 폴더를 확인해주세요.');}finally{this.updateResources();}});});
      this.updateResources();void plugin.aiSpeech.cache.refresh().catch(()=>{});
      containerEl.createEl('p',{text:'선택한 글 전체를 준비한 뒤 재생합니다. 같은 글·목소리·언어의 음성은 최대 100MB·24시간 재사용하며 Vault 밖에 보관합니다. 준비 중 정지는 생성을 취소합니다.'});
    }
    new Setting(containerEl).setName('기본 읽기 속도').setDesc('다음 글을 읽을 때 사용할 속도입니다. 재생 막대의 배속 변경은 현재 낭독에만 적용됩니다.').addDropdown(drop=>{
      drop.selectEl.setAttribute('aria-label','기본 읽기 속도');for(const speed of SPEEDS)drop.addOption(String(speed),speed.toFixed(2)+'×');
      drop.setValue(String(plugin.settings.rate)).onChange(async value=>{plugin.settings.rate=normalizeSpeed(value);await plugin.persistSettings();});
    });
    if(plugin.settings.engine==='windows'){
    if(plugin.voiceError)containerEl.createEl('p',{text:plugin.voiceError,cls:'sr-settings-error'});
    new Setting(containerEl).setName('목소리 목록 새로고침').setDesc('Windows에 음성을 추가한 뒤 눌러주세요.').addButton(button=>button.setButtonText('새로고침').onClick(async()=>{
      button.setDisabled(true);await plugin.refreshVoices();if(containerEl.isConnected)this.display();
    }));
    }
  }
  hide(){for(const key of ['aiStatus','storageStatus','manageStatus','installButton','cancelButton','deleteButton','memoryStatus','cacheStatus','clearCacheButton'])this[key]=null;}
  updateResources(){
    if(!this.memoryStatus?.isConnected)return;const ai=this.plugin.aiSpeech;
    this.memoryStatus.setText(ai.loaded?(['preparing','speaking','paused'].includes(ai.status)?'사용 중 · 일시정지 중에도 유지':'다음 낭독 대기 중 · 미사용 시 자동 해제'):ai.child?'AI 불러오는 중':'해제됨 · 새 음성이 필요하면 다시 불러옵니다.');
    const s=ai.cache.state;this.cacheStatus.setText(s.error||`${(s.bytes/1024**2).toFixed(1)} MB / 100 MB · ${s.count}개 · 최대 24시간`);
    this.clearCacheButton.setDisabled(!s.count);
  }
  updateAIStatus(){
    if(!this.aiStatus?.isConnected)return;const s=this.plugin.runtime.state;
    const amount=s.total&&s.phase==='installing'?` · ${(s.bytes/1024**2).toFixed(0)} / ${(s.total/1024**2).toFixed(0)} MB`:'';
    this.aiStatus.setText(s.message+amount+(s.phase==='error'?' · '+String(s.detail||'').slice(0,350):''));
    const inUse=this.plugin.isAIInUse();
    this.installButton.setButtonText(s.phase==='ready'?'설치됨':s.phase==='missing'?'모델 설치':s.phase==='incomplete'?'다시 설치':'다시 시도').setDisabled(s.phase==='ready'||this.plugin.runtime.busy||inUse);
    this.cancelButton.setDisabled(!this.plugin.runtime.busy||s.phase==='deleting');
    this.storageStatus?.setText(`${((s.installedBytes||0)/1024**2).toFixed(1)} MB · 실행 환경 제외`);
    this.deleteButton?.setDisabled(this.plugin.runtime.busy||inUse||!s.installedBytes);
    this.manageStatus?.setText(inUse?'AI 준비·재생·일시정지 중에는 삭제할 수 없습니다. 낭독을 정지해주세요.':'삭제 후 다시 설치할 수 있습니다. 실행 환경과 설정은 유지됩니다.');
  }
}
module.exports = class SelectionReader extends Plugin {
  async onload() {
    this.active=true;
    const saved=await this.loadData();this.settings={voice:typeof saved?.voice==='string'?saved.voice:'',rate:normalizeSpeed(saved?.rate),engine:saved?.engine==='ai'?'ai':'windows',aiVoice:AI_VOICES.includes(saved?.aiVoice)?saved.aiVoice:'F1',aiLanguage:AI_LANGUAGES[saved?.aiLanguage]?saved.aiLanguage:(LEGACY_LANGUAGES[saved?.aiLanguage]||'ko'),idleMinutes:[1,5,10,30].includes(saved?.idleMinutes)?saved.idleMinutes:5};
    this.voices=[];this.voiceError='';this.saveQueue=Promise.resolve();
    this.selection = null;
    this.state = {state:'idle'};
    this.windowsSpeech = new WindowsSpeech(state => this.renderState(state));
    this.aiSpeech=new SupertonicSpeech(state=>this.renderState(state),workerSource,{onResources:()=>this.settingTab?.updateResources()});this.speech=this.windowsSpeech;
    this.aiSpeech.setIdleMinutes(this.settings.idleMinutes);this.aiSpeech.cache.onChange=()=>this.settingTab?.updateResources();void this.aiSpeech.cache.refresh().catch(()=>{});
    this.cacheTimer=setInterval(()=>void this.aiSpeech.cache.refresh().catch(()=>{}),60000);
    this.runtime=new AiRuntime(()=>this.settingTab?.updateAIStatus(),()=>this.isAIInUse());
    this.button = document.body.createEl('button', {cls:'sr-selection-button', attr:{'aria-label':'선택한 글 읽기',title:'선택한 글 읽기'}});
    setIcon(this.button, 'volume-2'); this.button.hidden = true;
    this.bar = document.createElement('div'); this.bar.className = 'sr-playback-bar'; this.bar.hidden = true;
    this.bar.setAttribute('role','region'); this.bar.setAttribute('aria-label','선택한 글 음성 재생');
    this.pauseButton=this.bar.createEl('button',{attr:{'aria-label':'일시정지',title:'일시정지'}});setIcon(this.pauseButton,'pause');
    this.stopButton = this.bar.createEl('button', {attr:{'aria-label':'읽기 정지',title:'읽기 정지'}});
    setIcon(this.stopButton,'square');
    this.label = this.bar.createEl('span', {cls:'sr-playback-label',attr:{role:'status','aria-live':'polite'}});
    this.errorActions=this.bar.createDiv({cls:'sr-error-actions'});this.errorActions.hidden=true;
    this.errorActions.createEl('button',{text:'다시 시도'}).addEventListener('click',()=>{if(this.lastRequest)this.startReading(this.lastRequest.text,this.lastRequest.settings);});
    this.errorActions.createEl('button',{text:'Windows 음성으로 읽기'}).addEventListener('click',()=>{if(this.lastRequest)this.startReading(this.lastRequest.text,{...this.lastRequest.settings,engine:'windows',voice:this.settings.voice});});
    this.errorActions.createEl('button',{text:'닫기'}).addEventListener('click',()=>this.speech.stop());
    this.rateSelect=this.bar.createEl('select',{cls:'sr-rate-select',attr:{'aria-label':'현재 낭독 배속',title:'현재 낭독에만 적용'}});
    for(const speed of SPEEDS)this.rateSelect.createEl('option',{value:String(speed),text:speed.toFixed(2)+'×'});
    this.rateSelect.value=String(this.settings.rate);
    (document.querySelector('.app-container') || document.body).appendChild(this.bar);
    const statusBar=document.querySelector('.status-bar');
    if(statusBar){
      const reserveStatusSpace=()=>{this.bar.style.marginBottom=Math.ceil(statusBar.getBoundingClientRect().height)+'px';};
      const observer=new ResizeObserver(reserveStatusSpace);observer.observe(statusBar);reserveStatusSpace();
      this.register(()=>observer.disconnect());
    }
    this.registerDomEvent(this.button,'mousedown', e => e.preventDefault());
    this.registerDomEvent(this.button,'click', () => {
      const selection = this.selection;
      if (!selection) return;
      this.button.hidden = true;
      this.startReading(selection.text,{...this.settings});
    });
    this.registerDomEvent(this.stopButton,'click', () => this.speech.stop());
    this.registerDomEvent(this.pauseButton,'click',()=>this.state.state==='paused'?this.speech.resume():this.speech.pause());
    this.registerDomEvent(this.rateSelect,'change',()=>this.speech.setRate(this.rateSelect.value));
    this.selectionDocuments=new Map();this.bindSelectionDocument(document,null);
    const frameObserver=new MutationObserver(records=>{
      if(records.some(r=>[...r.addedNodes,...r.removedNodes].some(n=>n.nodeType===1 && (n.matches('iframe') || n.querySelector('iframe')))))this.syncSelectionFrames();
    });
    frameObserver.observe(this.app.workspace.containerEl,{childList:true,subtree:true});
    this.register(()=>frameObserver.disconnect());
    this.registerDomEvent(document,'load',e=>{if(e.target?.matches?.('iframe'))this.syncSelectionFrames();},true);
    this.syncSelectionFrames();
    this.registerDomEvent(window,'resize', () => this.clearSelection());
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.clearSelection()));
    this.registerEvent(this.app.workspace.on('quit', () => this.disposeSpeech()));
    this.registerDomEvent(window,'beforeunload', () => this.disposeSpeech());
    this.settingTab=new ReaderSettings(this.app,this);this.addSettingTab(this.settingTab);
    await this.persistSettings();
    void this.refreshVoices();
  }
  startReading(text,settings){
    this.speech.stop();this.lastRequest={text,settings:{...settings}};
    this.speech=settings.engine==='ai'?this.aiSpeech:this.windowsSpeech;
    if(settings.engine==='ai'&&(this.runtime.state.phase!=='ready'||this.modelReleasing)){this.aiSpeech.emit('error',{message:this.runtime.busy?'모델 설치 중입니다. 설치 완료 후 다시 시도해주세요.':'설정에서 AI 모델 설치를 완료해주세요.'});return;}
    this.speech.speak(text,settings);
  }
  isAIInUse(){return ['preparing','speaking','paused'].includes(this.aiSpeech?.status)||Boolean(this.modelReleasing);}
  disposeSpeech(){clearInterval(this.cacheTimer);this.runtime?.dispose();this.windowsSpeech?.dispose();this.aiSpeech?.dispose();}
  async refreshVoices(){try{const voices=await this.windowsSpeech.listVoices();if(!this.active)return;this.voices=Array.isArray(voices)?voices:[];this.voiceError=this.voices.length?'':'사용 가능한 Windows 음성이 없습니다.';}catch(e){if(this.active)this.voiceError='목소리 목록을 가져오지 못했습니다. '+e.message;}
    if(this.active && this.settingTab.containerEl?.isShown())this.settingTab.display();
  }
  persistSettings(){const snapshot={...this.settings};this.saveQueue=this.saveQueue.catch(()=>{}).then(()=>this.saveData(snapshot));return this.saveQueue.catch(()=>{new Notice('음성 설정을 저장하지 못했습니다.');});}
  bindSelectionDocument(doc,frame){
    if(this.selectionDocuments.has(doc))return;
    const handlers=[];const on=(name,fn)=>{doc.addEventListener(name,fn,true);handlers.push(()=>doc.removeEventListener(name,fn,true));};
    let dragging=false;
    on('mousedown',e=>{if(!this.button.contains(e.target) && !this.bar.contains(e.target)){dragging=true;this.clearSelection();}});
    on('mouseup',e=>{dragging=false;if(!this.button.contains(e.target) && !this.bar.contains(e.target))this.scheduleSelection(e,frame);});
    on('keyup',e=>{if(e.key==='Escape')this.clearSelection();else if(e.key.startsWith('Arrow') || ['Shift','Home','End','a','A'].includes(e.key))this.scheduleSelection(e,frame);});
    on('selectionchange',()=>{
      if(this.selection?.doc===doc && !this.readSelection(this.selection.target,frame)?.text.trim())this.clearSelection();
      if(!dragging&&!doc.getSelection()?.isCollapsed)this.scheduleSelection({target:doc.getSelection()?.focusNode?.parentElement},frame);
    });
    on('scroll',()=>this.clearSelection());on('wheel',()=>this.clearSelection());
    this.selectionDocuments.set(doc,{frame,dispose:()=>handlers.forEach(fn=>fn())});
  }
  syncSelectionFrames(){
    for(const [doc,entry] of this.selectionDocuments){if(entry.frame && (!entry.frame.isConnected || entry.frame.contentDocument!==doc)){entry.dispose();this.selectionDocuments.delete(doc);if(this.selection?.doc===doc)this.clearSelection();}}
    // Only Obsidian's own Markdown card editors. Never inspect web-page cards.
    for(const frame of document.querySelectorAll('.canvas-node-content.markdown-embed iframe.embed-iframe.is-controlled')){
      try{if(frame.contentDocument)this.bindSelectionDocument(frame.contentDocument,frame);}catch{}
    }
  }
  readSelection(target,frame){
    const doc=frame?.contentDocument||target?.ownerDocument||document,native=doc.getSelection();
    if(!target?.closest?.('.markdown-source-view,.markdown-preview-view,.pdfViewer')){const focus=native?.focusNode;target=focus?.nodeType===1?focus:focus?.parentElement;}
    if(!target?.closest || !target.isConnected)return null;
    const view=this.app.workspace.activeLeaf?.view,type=view?.getViewType();
    let root,editor,kind=type;
    if(type==='markdown' && !frame && view.contentEl.contains(target)){
      root=target.closest('.markdown-source-view,.markdown-preview-view');
      if(view.getMode()==='source')editor=view.editor;
    }else if(type==='canvas'){
      const host=frame || target,card=host.closest('.canvas-node');
      if(!card || !view.contentEl.contains(card) || !host.closest('.canvas-node-content.markdown-embed'))return null;
      root=target.closest('.markdown-source-view,.markdown-preview-view');
      if(frame && (!frame.isConnected || frame.contentDocument!==doc))return null;
      if(root?.matches('.markdown-source-view')){
        const node=[...(view.canvas?.nodes?.values() || [])].find(n=>n.nodeEl===card);
        editor=node?.child?.editor;
      }
    }else if(type==='pdf' && !frame && view.contentEl.contains(target)){
      root=target.closest('.pdfViewer');
      const element=n=>n?.nodeType===1?n:n?.parentElement;
      if(!element(native?.anchorNode)?.closest('.textLayer') || !element(native?.focusNode)?.closest('.textLayer'))return null;
    }
    if(!root)return null;
    let text='';
    if(editor)text=editor.getSelection();
    else if(native?.rangeCount && root.contains(native.anchorNode) && root.contains(native.focusNode))text=native.toString();
    if(kind==='pdf')text=normalizePdfText(text);
    return {text,native,doc,kind};
  }
  scheduleSelection(event,frame=null) {
    window.clearTimeout(this.selectionTimer);
    const target = event.target;
    const point = {x:event.clientX,y:event.clientY};
    this.selectionTimer = window.setTimeout(() => this.captureSelection(target, point,frame), 30);
  }
  captureSelection(target, point,frame) {
    const selected=this.readSelection(target,frame);
    if(!selected?.text.trim()){this.clearSelection();return;}
    const {text,native,doc,kind}=selected;
    let rect=selectionFocusRect(native);
    if (!rect || (!rect.width && !rect.height)) rect={left:point.x??target.getBoundingClientRect().right,right:point.x??target.getBoundingClientRect().right,top:point.y??target.getBoundingClientRect().top,bottom:point.y??target.getBoundingClientRect().bottom,width:0,height:32};
    if(frame && rect)rect={...frameRect(rect,frame.getBoundingClientRect(),frame.clientWidth||1,frame.clientHeight||1),backward:rect.backward};
    this.selection = {text,target,doc,kind};
    this.button.hidden = false;
    const position=selectionButtonPosition(rect,window.innerWidth,window.innerHeight);
    this.button.style.left=position.left+'px';this.button.style.top=position.top+'px';
  }
  clearSelection() { window.clearTimeout(this.selectionTimer); this.selection = null; if (this.button) this.button.hidden = true; }
  renderState(state) {
    this.state = state;
    this.settingTab?.updateAIStatus();
    if (!this.bar) return;
    const ai=state.engine==='ai',error=state.state==='error';
    this.bar.hidden = state.state === 'idle' || (error&&!ai);
    this.errorActions.hidden=!(ai&&error);this.pauseButton.hidden=error;this.stopButton.hidden=error;this.rateSelect.hidden=error;
    this.label.textContent=error?'AI 음성을 준비하지 못했습니다. '+String(state.message).slice(0,200):state.state==='preparing'?(state.message || 'Windows 음성 준비 중…'):state.state==='paused'?'일시정지됨':ai?'Supertonic으로 읽는 중':'Windows 음성으로 읽는 중';
    const paused=state.state==='paused';setIcon(this.pauseButton,paused?'play':'pause');this.pauseButton.setAttribute('aria-label',paused?'이어듣기':'일시정지');this.pauseButton.title=paused?'이어듣기':'일시정지';
    this.pauseButton.disabled=!['speaking','paused'].includes(state.state);
    this.rateSelect.value=String(state.rate || this.settings.rate);
    if (state.state === 'speaking') this.label.title = state.voice;
    if (state.state === 'error'&&!ai) new Notice('Windows 음성을 재생하지 못했습니다. '+state.message, 10000);
  }
  onunload() {
    this.active=false;
    window.clearTimeout(this.selectionTimer);
    for(const entry of this.selectionDocuments?.values() || [])entry.dispose();
    this.selectionDocuments?.clear();
    this.disposeSpeech(); this.button?.remove(); this.bar?.remove();
  }
};

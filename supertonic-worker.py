# Official helper code and its MIT license are prepended by build.cjs.
import sys, io, base64, traceback

def emit(event, **data):
    print(json.dumps(dict(event=event, id=request_id, **data), ensure_ascii=False), flush=True)

request_id=0
try:
    import soundfile as sf
    model=None
    model_dir=sys.argv[1]
    for line in sys.stdin:
        request=json.loads(line)
        request_id=request['id']
        started=time.perf_counter()
        if model is None:
            model=load_text_to_speech(os.path.join(model_dir,'onnx'))
        voice=request.get('speaker','F1')
        if voice not in ['F1','F2','F3','F4','F5','M1','M2','M3','M4','M5']:
            raise ValueError('지원하지 않는 목소리입니다.')
        style=load_voice_style([os.path.join(model_dir,'voice_styles',voice+'.json')])
        lang=request.get('language','ko')
        if lang not in AVAILABLE_LANGS or lang=='na':
            raise ValueError('설정에서 읽기 언어를 선택해주세요.')
        text=request['text']
        if not isinstance(text,str) or not text.strip():
            raise ValueError('읽을 글이 없습니다.')
        emit('loaded',seconds=time.perf_counter()-started)
        chunks=chunk_text(text,max_len=120 if lang in ('ko','ja') else 300)
        start=time.perf_counter();waves=[]
        for index,chunk in enumerate(chunks):
            emit('progress',completed=index,total=len(chunks))
            wav,duration=model._infer([chunk],[lang],style,8,1.05)
            waves.append(wav[0,:int(float(duration[0])*model.sample_rate)])
            if index+1<len(chunks):waves.append(np.zeros(int(.3*model.sample_rate),dtype=np.float32))
        result=np.concatenate(waves)
        buffer=io.BytesIO();sf.write(buffer,result,model.sample_rate,format='WAV',subtype='PCM_16')
        emit('audio',data=base64.b64encode(buffer.getvalue()).decode('ascii'),seconds=time.perf_counter()-start,duration=len(result)/model.sample_rate,parts=len(chunks))
        # Keep only the model while idle; release each request's audio buffers.
        del request,text,chunks,waves,wav,duration,result,buffer,style
except Exception as error:
    emit('error',message=str(error));traceback.print_exc(file=sys.stderr);sys.exit(1)

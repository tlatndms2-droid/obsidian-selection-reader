// Selection Reader 0.6.0
const bundled={};
const localRequire=id=>Object.prototype.hasOwnProperty.call(bundled,id)?bundled[id].exports:require(id);
bundled['./worker-source']={exports:"# MIT License\n# \n# Copyright (c) 2025 Supertone Inc.\n# \n# Permission is hereby granted, free of charge, to any person obtaining a copy\n# of this software and associated documentation files (the \"Software\"), to deal\n# in the Software without restriction, including without limitation the rights\n# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell\n# copies of the Software, and to permit persons to whom the Software is\n# furnished to do so, subject to the following conditions:\n# \n# The above copyright notice and this permission notice shall be included in all\n# copies or substantial portions of the Software.\n# \n# THE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\n# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\n# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\n# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\n# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\n# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\n# SOFTWARE.\nimport json\nimport os\nimport time\nfrom contextlib import contextmanager\nfrom typing import Optional\nfrom unicodedata import normalize\n\nimport numpy as np\nimport onnxruntime as ort\n\nimport re\n\nAVAILABLE_LANGS = [\"en\", \"ko\", \"ja\", \"ar\", \"bg\", \"cs\", \"da\", \"de\", \"el\", \"es\", \"et\", \"fi\", \"fr\", \"hi\", \"hr\", \"hu\", \"id\", \"it\", \"lt\", \"lv\", \"nl\", \"pl\", \"pt\", \"ro\", \"ru\", \"sk\", \"sl\", \"sv\", \"tr\", \"uk\", \"vi\", \"na\"]\n\n\nclass UnicodeProcessor:\n    def __init__(self, unicode_indexer_path: str):\n        with open(unicode_indexer_path, \"r\") as f:\n            self.indexer = json.load(f)\n\n    def _preprocess_text(self, text: str, lang: str) -> str:\n        # TODO: Need advanced normalizer for better performance\n        text = normalize(\"NFKD\", text)\n\n        # Remove emojis (wide Unicode range)\n        emoji_pattern = re.compile(\n            \"[\\U0001f600-\\U0001f64f\"  # emoticons\n            \"\\U0001f300-\\U0001f5ff\"  # symbols & pictographs\n            \"\\U0001f680-\\U0001f6ff\"  # transport & map symbols\n            \"\\U0001f700-\\U0001f77f\"\n            \"\\U0001f780-\\U0001f7ff\"\n            \"\\U0001f800-\\U0001f8ff\"\n            \"\\U0001f900-\\U0001f9ff\"\n            \"\\U0001fa00-\\U0001fa6f\"\n            \"\\U0001fa70-\\U0001faff\"\n            \"\\u2600-\\u26ff\"\n            \"\\u2700-\\u27bf\"\n            \"\\U0001f1e6-\\U0001f1ff]+\",\n            flags=re.UNICODE,\n        )\n        text = emoji_pattern.sub(\"\", text)\n\n        # Replace various dashes and symbols\n        replacements = {\n            \"–\": \"-\",\n            \"‑\": \"-\",\n            \"—\": \"-\",\n            \"_\": \" \",\n            \"\\u201c\": '\"',  # left double quote \"\n            \"\\u201d\": '\"',  # right double quote \"\n            \"\\u2018\": \"'\",  # left single quote '\n            \"\\u2019\": \"'\",  # right single quote '\n            \"´\": \"'\",\n            \"`\": \"'\",\n            \"[\": \" \",\n            \"]\": \" \",\n            \"|\": \" \",\n            \"/\": \" \",\n            \"#\": \" \",\n            \"→\": \" \",\n            \"←\": \" \",\n        }\n        for k, v in replacements.items():\n            text = text.replace(k, v)\n\n        # Remove special symbols\n        text = re.sub(r\"[♥☆♡©\\\\]\", \"\", text)\n\n        # Replace known expressions\n        expr_replacements = {\n            \"@\": \" at \",\n            \"e.g.,\": \"for example, \",\n            \"i.e.,\": \"that is, \",\n        }\n        for k, v in expr_replacements.items():\n            text = text.replace(k, v)\n\n        # Fix spacing around punctuation\n        text = re.sub(r\" ,\", \",\", text)\n        text = re.sub(r\" \\.\", \".\", text)\n        text = re.sub(r\" !\", \"!\", text)\n        text = re.sub(r\" \\?\", \"?\", text)\n        text = re.sub(r\" ;\", \";\", text)\n        text = re.sub(r\" :\", \":\", text)\n        text = re.sub(r\" '\", \"'\", text)\n\n        # Remove duplicate quotes\n        while '\"\"' in text:\n            text = text.replace('\"\"', '\"')\n        while \"''\" in text:\n            text = text.replace(\"''\", \"'\")\n        while \"``\" in text:\n            text = text.replace(\"``\", \"`\")\n\n        # Remove extra spaces\n        text = re.sub(r\"\\s+\", \" \", text).strip()\n\n        # If text doesn't end with punctuation, quotes, or closing brackets, add a period\n        if not re.search(r\"[.!?;:,'\\\"')\\]}…。」』】〉》›»]$\", text):\n            text += \".\"\n\n        if lang not in AVAILABLE_LANGS:\n            raise ValueError(f\"Invalid language: {lang}\")\n        text = f\"<{lang}>\" + text + f\"</{lang}>\"\n        return text\n\n    def _get_text_mask(self, text_ids_lengths: np.ndarray) -> np.ndarray:\n        text_mask = length_to_mask(text_ids_lengths)\n        return text_mask\n\n    def _text_to_unicode_values(self, text: str) -> np.ndarray:\n        unicode_values = np.array(\n            [ord(char) for char in text], dtype=np.uint16\n        )  # 2 bytes\n        return unicode_values\n\n    def __call__(\n        self, text_list: list[str], lang_list: list[str]\n    ) -> tuple[np.ndarray, np.ndarray]:\n        text_list = [\n            self._preprocess_text(t, lang) for t, lang in zip(text_list, lang_list)\n        ]\n        text_ids_lengths = np.array([len(text) for text in text_list], dtype=np.int64)\n        text_ids = np.zeros((len(text_list), text_ids_lengths.max()), dtype=np.int64)\n        for i, text in enumerate(text_list):\n            unicode_vals = self._text_to_unicode_values(text)\n            text_ids[i, : len(unicode_vals)] = np.array(\n                [self.indexer[val] for val in unicode_vals], dtype=np.int64\n            )\n        text_mask = self._get_text_mask(text_ids_lengths)\n        return text_ids, text_mask\n\n\nclass Style:\n    def __init__(self, style_ttl_onnx: np.ndarray, style_dp_onnx: np.ndarray):\n        self.ttl = style_ttl_onnx\n        self.dp = style_dp_onnx\n\n\nclass TextToSpeech:\n    def __init__(\n        self,\n        cfgs: dict,\n        text_processor: UnicodeProcessor,\n        dp_ort: ort.InferenceSession,\n        text_enc_ort: ort.InferenceSession,\n        vector_est_ort: ort.InferenceSession,\n        vocoder_ort: ort.InferenceSession,\n    ):\n        self.cfgs = cfgs\n        self.text_processor = text_processor\n        self.dp_ort = dp_ort\n        self.text_enc_ort = text_enc_ort\n        self.vector_est_ort = vector_est_ort\n        self.vocoder_ort = vocoder_ort\n        self.sample_rate = cfgs[\"ae\"][\"sample_rate\"]\n        self.base_chunk_size = cfgs[\"ae\"][\"base_chunk_size\"]\n        self.chunk_compress_factor = cfgs[\"ttl\"][\"chunk_compress_factor\"]\n        self.ldim = cfgs[\"ttl\"][\"latent_dim\"]\n\n    def sample_noisy_latent(\n        self, duration: np.ndarray\n    ) -> tuple[np.ndarray, np.ndarray]:\n        bsz = len(duration)\n        wav_len_max = duration.max() * self.sample_rate\n        wav_lengths = (duration * self.sample_rate).astype(np.int64)\n        chunk_size = self.base_chunk_size * self.chunk_compress_factor\n        latent_len = ((wav_len_max + chunk_size - 1) / chunk_size).astype(np.int32)\n        latent_dim = self.ldim * self.chunk_compress_factor\n        noisy_latent = np.random.randn(bsz, latent_dim, latent_len).astype(np.float32)\n        latent_mask = get_latent_mask(\n            wav_lengths, self.base_chunk_size, self.chunk_compress_factor\n        )\n        noisy_latent = noisy_latent * latent_mask\n        return noisy_latent, latent_mask\n\n    def _infer(\n        self,\n        text_list: list[str],\n        lang_list: list[str],\n        style: Style,\n        total_step: int,\n        speed: float = 1.05,\n    ) -> tuple[np.ndarray, np.ndarray]:\n        assert (\n            len(text_list) == style.ttl.shape[0]\n        ), \"Number of texts must match number of style vectors\"\n        bsz = len(text_list)\n        text_ids, text_mask = self.text_processor(text_list, lang_list)\n        dur_onnx, *_ = self.dp_ort.run(\n            None, {\"text_ids\": text_ids, \"style_dp\": style.dp, \"text_mask\": text_mask}\n        )\n        dur_onnx = dur_onnx / speed\n        text_emb_onnx, *_ = self.text_enc_ort.run(\n            None,\n            {\"text_ids\": text_ids, \"style_ttl\": style.ttl, \"text_mask\": text_mask},\n        )  # dur_onnx: [bsz]\n        xt, latent_mask = self.sample_noisy_latent(dur_onnx)\n        total_step_np = np.array([total_step] * bsz, dtype=np.float32)\n        for step in range(total_step):\n            current_step = np.array([step] * bsz, dtype=np.float32)\n            xt, *_ = self.vector_est_ort.run(\n                None,\n                {\n                    \"noisy_latent\": xt,\n                    \"text_emb\": text_emb_onnx,\n                    \"style_ttl\": style.ttl,\n                    \"text_mask\": text_mask,\n                    \"latent_mask\": latent_mask,\n                    \"current_step\": current_step,\n                    \"total_step\": total_step_np,\n                },\n            )\n        wav, *_ = self.vocoder_ort.run(None, {\"latent\": xt})\n        return wav, dur_onnx\n\n    def __call__(\n        self,\n        text: str,\n        lang: str,\n        style: Style,\n        total_step: int,\n        speed: float = 1.05,\n        silence_duration: float = 0.3,\n    ) -> tuple[np.ndarray, np.ndarray]:\n        assert (\n            style.ttl.shape[0] == 1\n        ), \"Single speaker text to speech only supports single style\"\n        max_len = 120 if lang in (\"ko\", \"ja\") else 300\n        text_list = chunk_text(text, max_len=max_len)\n        wav_cat = None\n        dur_cat = None\n        for text in text_list:\n            wav, dur_onnx = self._infer([text], [lang], style, total_step, speed)\n            if wav_cat is None:\n                wav_cat = wav\n                dur_cat = dur_onnx\n            else:\n                silence = np.zeros(\n                    (1, int(silence_duration * self.sample_rate)), dtype=np.float32\n                )\n                wav_cat = np.concatenate([wav_cat, silence, wav], axis=1)\n                dur_cat += dur_onnx + silence_duration\n        return wav_cat, dur_cat\n\n    def batch(\n        self,\n        text_list: list[str],\n        lang_list: list[str],\n        style: Style,\n        total_step: int,\n        speed: float = 1.05,\n    ) -> tuple[np.ndarray, np.ndarray]:\n        return self._infer(text_list, lang_list, style, total_step, speed)\n\n\ndef length_to_mask(lengths: np.ndarray, max_len: Optional[int] = None) -> np.ndarray:\n    \"\"\"\n    Convert lengths to binary mask.\n\n    Args:\n        lengths: (B,)\n        max_len: int\n\n    Returns:\n        mask: (B, 1, max_len)\n    \"\"\"\n    max_len = max_len or lengths.max()\n    ids = np.arange(0, max_len)\n    mask = (ids < np.expand_dims(lengths, axis=1)).astype(np.float32)\n    return mask.reshape(-1, 1, max_len)\n\n\ndef get_latent_mask(\n    wav_lengths: np.ndarray, base_chunk_size: int, chunk_compress_factor: int\n) -> np.ndarray:\n    latent_size = base_chunk_size * chunk_compress_factor\n    latent_lengths = (wav_lengths + latent_size - 1) // latent_size\n    latent_mask = length_to_mask(latent_lengths)\n    return latent_mask\n\n\ndef load_onnx(\n    onnx_path: str, opts: ort.SessionOptions, providers: list[str]\n) -> ort.InferenceSession:\n    return ort.InferenceSession(onnx_path, sess_options=opts, providers=providers)\n\n\ndef load_onnx_all(\n    onnx_dir: str, opts: ort.SessionOptions, providers: list[str]\n) -> tuple[\n    ort.InferenceSession,\n    ort.InferenceSession,\n    ort.InferenceSession,\n    ort.InferenceSession,\n]:\n    dp_onnx_path = os.path.join(onnx_dir, \"duration_predictor.onnx\")\n    text_enc_onnx_path = os.path.join(onnx_dir, \"text_encoder.onnx\")\n    vector_est_onnx_path = os.path.join(onnx_dir, \"vector_estimator.onnx\")\n    vocoder_onnx_path = os.path.join(onnx_dir, \"vocoder.onnx\")\n\n    dp_ort = load_onnx(dp_onnx_path, opts, providers)\n    text_enc_ort = load_onnx(text_enc_onnx_path, opts, providers)\n    vector_est_ort = load_onnx(vector_est_onnx_path, opts, providers)\n    vocoder_ort = load_onnx(vocoder_onnx_path, opts, providers)\n    return dp_ort, text_enc_ort, vector_est_ort, vocoder_ort\n\n\ndef load_cfgs(onnx_dir: str) -> dict:\n    cfg_path = os.path.join(onnx_dir, \"tts.json\")\n    with open(cfg_path, \"r\") as f:\n        cfgs = json.load(f)\n    return cfgs\n\n\ndef load_text_processor(onnx_dir: str) -> UnicodeProcessor:\n    unicode_indexer_path = os.path.join(onnx_dir, \"unicode_indexer.json\")\n    text_processor = UnicodeProcessor(unicode_indexer_path)\n    return text_processor\n\n\ndef load_text_to_speech(onnx_dir: str, use_gpu: bool = False) -> TextToSpeech:\n    opts = ort.SessionOptions()\n    # Four sessions otherwise each create a spinning CPU pool. Keep the reader\n    # responsive and avoid contention between these independent pools.\n    opts.intra_op_num_threads = 2\n    opts.inter_op_num_threads = 1\n    opts.add_session_config_entry('session.intra_op.allow_spinning', '0')\n    opts.add_session_config_entry('session.inter_op.allow_spinning', '0')\n    if use_gpu:\n        raise NotImplementedError(\"GPU mode is not fully tested\")\n    else:\n        providers = [\"CPUExecutionProvider\"]\n        print(\"Using CPU for inference\")\n    cfgs = load_cfgs(onnx_dir)\n    dp_ort, text_enc_ort, vector_est_ort, vocoder_ort = load_onnx_all(\n        onnx_dir, opts, providers\n    )\n    text_processor = load_text_processor(onnx_dir)\n    return TextToSpeech(\n        cfgs, text_processor, dp_ort, text_enc_ort, vector_est_ort, vocoder_ort\n    )\n\n\ndef load_voice_style(voice_style_paths: list[str], verbose: bool = False) -> Style:\n    bsz = len(voice_style_paths)\n\n    # Read first file to get dimensions\n    with open(voice_style_paths[0], \"r\") as f:\n        first_style = json.load(f)\n    ttl_dims = first_style[\"style_ttl\"][\"dims\"]\n    dp_dims = first_style[\"style_dp\"][\"dims\"]\n\n    # Pre-allocate arrays with full batch size\n    ttl_style = np.zeros([bsz, ttl_dims[1], ttl_dims[2]], dtype=np.float32)\n    dp_style = np.zeros([bsz, dp_dims[1], dp_dims[2]], dtype=np.float32)\n\n    # Fill in the data\n    for i, voice_style_path in enumerate(voice_style_paths):\n        with open(voice_style_path, \"r\") as f:\n            voice_style = json.load(f)\n\n        ttl_data = np.array(\n            voice_style[\"style_ttl\"][\"data\"], dtype=np.float32\n        ).flatten()\n        ttl_style[i] = ttl_data.reshape(ttl_dims[1], ttl_dims[2])\n\n        dp_data = np.array(voice_style[\"style_dp\"][\"data\"], dtype=np.float32).flatten()\n        dp_style[i] = dp_data.reshape(dp_dims[1], dp_dims[2])\n\n    if verbose:\n        print(f\"Loaded {bsz} voice styles\")\n    return Style(ttl_style, dp_style)\n\n\n@contextmanager\ndef timer(name: str):\n    start = time.time()\n    print(f\"{name}...\")\n    yield\n    print(f\"  -> {name} completed in {time.time() - start:.2f} sec\")\n\n\ndef sanitize_filename(text: str, max_len: int) -> str:\n    \"\"\"Sanitize filename by replacing non-alphanumeric characters with underscores (supports Unicode)\"\"\"\n    import re\n\n    prefix = text[:max_len]\n    # \\w matches Unicode word characters (letters, digits, underscore) with re.UNICODE\n    # We replace non-word characters except keeping existing underscores\n    return re.sub(r\"[^\\w]\", \"_\", prefix, flags=re.UNICODE)\n\n\ndef chunk_text(text: str, max_len: int = 300) -> list[str]:\n    \"\"\"\n    Split text into chunks by paragraphs and sentences.\n\n    Args:\n        text: Input text to chunk\n        max_len: Maximum length of each chunk (default: 300)\n\n    Returns:\n        List of text chunks\n    \"\"\"\n    import re\n\n    # Split by paragraph (two or more newlines)\n    paragraphs = [p.strip() for p in re.split(r\"\\n\\s*\\n+\", text.strip()) if p.strip()]\n\n    chunks = []\n\n    for paragraph in paragraphs:\n        paragraph = paragraph.strip()\n        if not paragraph:\n            continue\n\n        # Split by sentence boundaries (period, question mark, exclamation mark followed by space)\n        # But exclude common abbreviations like Mr., Mrs., Dr., etc. and single capital letters like F.\n        pattern = r\"(?<!Mr\\.)(?<!Mrs\\.)(?<!Ms\\.)(?<!Dr\\.)(?<!Prof\\.)(?<!Sr\\.)(?<!Jr\\.)(?<!Ph\\.D\\.)(?<!etc\\.)(?<!e\\.g\\.)(?<!i\\.e\\.)(?<!vs\\.)(?<!Inc\\.)(?<!Ltd\\.)(?<!Co\\.)(?<!Corp\\.)(?<!St\\.)(?<!Ave\\.)(?<!Blvd\\.)(?<!\\b[A-Z]\\.)(?<=[.!?])\\s+\"\n        sentences = re.split(pattern, paragraph)\n\n        current_chunk = \"\"\n\n        for sentence in sentences:\n            if len(current_chunk) + len(sentence) + 1 <= max_len:\n                current_chunk += (\" \" if current_chunk else \"\") + sentence\n            else:\n                if current_chunk:\n                    chunks.append(current_chunk.strip())\n                current_chunk = sentence\n\n        if current_chunk:\n            chunks.append(current_chunk.strip())\n\n    return chunks\n\n# Official helper code and its MIT license are prepended by build.cjs.\nimport sys, io, base64, traceback\n\ndef emit(event, **data):\n    print(json.dumps(dict(event=event, id=request_id, **data), ensure_ascii=False), flush=True)\n\nrequest_id=0\ntry:\n    import soundfile as sf\n    model=None\n    model_dir=sys.argv[1]\n    for line in sys.stdin:\n        request=json.loads(line)\n        request_id=request['id']\n        started=time.perf_counter()\n        if model is None:\n            model=load_text_to_speech(os.path.join(model_dir,'onnx'))\n        voice=request.get('speaker','F1')\n        if voice not in ['F1','F2','F3','F4','F5','M1','M2','M3','M4','M5']:\n            raise ValueError('지원하지 않는 목소리입니다.')\n        style=load_voice_style([os.path.join(model_dir,'voice_styles',voice+'.json')])\n        lang=request.get('language','ko')\n        if lang not in AVAILABLE_LANGS or lang=='na':\n            raise ValueError('설정에서 읽기 언어를 선택해주세요.')\n        text=request['text']\n        if not isinstance(text,str) or not text.strip():\n            raise ValueError('읽을 글이 없습니다.')\n        emit('loaded',seconds=time.perf_counter()-started)\n        chunks=chunk_text(text,max_len=120 if lang in ('ko','ja') else 300)\n        start=time.perf_counter();waves=[]\n        for index,chunk in enumerate(chunks):\n            emit('progress',completed=index,total=len(chunks))\n            wav,duration=model._infer([chunk],[lang],style,8,1.05)\n            waves.append(wav[0,:int(float(duration[0])*model.sample_rate)])\n            if index+1<len(chunks):waves.append(np.zeros(int(.3*model.sample_rate),dtype=np.float32))\n        result=np.concatenate(waves)\n        buffer=io.BytesIO();sf.write(buffer,result,model.sample_rate,format='WAV',subtype='PCM_16')\n        emit('audio',data=base64.b64encode(buffer.getvalue()).decode('ascii'),seconds=time.perf_counter()-start,duration=len(result)/model.sample_rate,parts=len(chunks))\n        # Keep only the model while idle; release each request's audio buffers.\n        del request,text,chunks,waves,wav,duration,result,buffer,style\nexcept Exception as error:\n    emit('error',message=str(error));traceback.print_exc(file=sys.stderr);sys.exit(1)\r\n"};
bundled['./speech']={exports:{}};
(function(module,require){
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

})(bundled['./speech'],localRequire);
bundled['./selection']={exports:{}};
(function(module,require){
function normalizePdfText(text) {
  return text.replace(/\u00ad/g,'').replace(/[\s\u00a0]+/gu,' ').trim();
}
function frameRect(rect, frameBox, width, height) {
  const sx=frameBox.width/width,sy=frameBox.height/height;
  return {left:frameBox.left+rect.left*sx,right:frameBox.left+rect.right*sx,
    top:frameBox.top+rect.top*sy,bottom:frameBox.top+rect.bottom*sy,width:rect.width*sx,height:rect.height*sy};
}
module.exports={normalizePdfText,frameRect};

})(bundled['./selection'],localRequire);
bundled['./ai-catalog']={exports:{}};
(function(module,require){
const AI_VOICES=['F1','F2','F3','F4','F5','M1','M2','M3','M4','M5'];
const AI_LANGUAGES={ko:'한국어',en:'영어',ja:'일본어',ar:'아랍어',bg:'불가리아어',cs:'체코어',da:'덴마크어',de:'독일어',el:'그리스어',es:'스페인어',et:'에스토니아어',fi:'핀란드어',fr:'프랑스어',hi:'힌디어',hr:'크로아티아어',hu:'헝가리어',id:'인도네시아어',it:'이탈리아어',lt:'리투아니아어',lv:'라트비아어',nl:'네덜란드어',pl:'폴란드어',pt:'포르투갈어',ro:'루마니아어',ru:'러시아어',sk:'슬로바키아어',sl:'슬로베니아어',sv:'스웨덴어',tr:'튀르키예어',uk:'우크라이나어',vi:'베트남어'};
const LEGACY_LANGUAGES={korean:'ko',english:'en',japanese:'ja',german:'de',french:'fr',russian:'ru',portuguese:'pt',spanish:'es',italian:'it'};
module.exports={AI_VOICES,AI_LANGUAGES,LEGACY_LANGUAGES};

})(bundled['./ai-catalog'],localRequire);
bundled['./model-store']={exports:{}};
(function(module,require){
const fs=require('node:fs'),path=require('node:path');
function modelBytes(directory){
 if(!fs.existsSync(directory))return 0;
 const stat=fs.lstatSync(directory);if(stat.isSymbolicLink())throw Error('연결된 폴더는 모델 관리 대상에서 제외됩니다.');
 if(!stat.isDirectory())return stat.size;
 return fs.readdirSync(directory).reduce((n,file)=>n+modelBytes(path.join(directory,file)),0);
}
function checkedModelDirectory(root,directory){
 const expected=path.resolve(root,'models','supertonic-3');
 if(path.resolve(directory)!==expected)throw Error('모델 삭제 경로가 올바르지 않습니다.');
 const realRoot=fs.realpathSync.native(root);
 for(const relative of ['models',path.join('models','supertonic-3')]){
  const candidate=path.join(root,relative);if(!fs.existsSync(candidate))continue;
  if(fs.lstatSync(candidate).isSymbolicLink()||fs.realpathSync.native(candidate)!==path.join(realRoot,relative))throw Error('모델 경로가 저장 폴더 밖으로 연결되어 있어 삭제하지 않았습니다.');
 }
 modelBytes(directory); // Reject nested junctions before recursive removal too.
 return expected;
}
async function removeModelFiles(root,directory){
 const target=checkedModelDirectory(root,directory);
 // Invalidate readiness first. A failed removal remains recoverable by reinstall.
 await fs.promises.rm(path.join(root,'ready.json'),{force:true});
 await fs.promises.rm(target,{recursive:true,force:true});
}
module.exports={modelBytes,checkedModelDirectory,removeModelFiles};

})(bundled['./model-store'],localRequire);
bundled['./ai-runtime']={exports:{}};
(function(module,require){
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

})(bundled['./ai-runtime'],localRequire);
bundled['./audio-cache']={exports:{}};
(function(module,require){
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const MAX_BYTES=100*1024**2,MAX_AGE=24*60*60*1000;
const cacheKey=(text,voice,language)=>crypto.createHash('sha256').update(JSON.stringify(['supertonic-3','3cadd1ee6394adea1bd021217a0e650ede09a323','pcm-v1-steps8',text,voice,language])).digest('hex');
class AudioCache{
 constructor(root,{maxBytes=MAX_BYTES,maxAge=MAX_AGE,now=Date.now,onChange=()=>{}}={}){Object.assign(this,{root,maxBytes,maxAge,now,onChange});this.directory=path.join(root,'audio-cache');this.queue=Promise.resolve();this.state={bytes:0,count:0,error:''};this.epoch=0;}
 run(fn){const task=this.queue.catch(()=>{}).then(async()=>{try{return await fn();}catch(e){this.state.error='임시 음성을 관리하지 못했습니다. 저장 폴더를 확인해주세요.';this.onChange(this.state);throw e;}});this.queue=task;return task;}
 async files(){await fs.promises.mkdir(this.root,{recursive:true});const realRoot=await fs.promises.realpath(this.root);await fs.promises.mkdir(this.directory,{recursive:true});if((await fs.promises.lstat(this.directory)).isSymbolicLink()||await fs.promises.realpath(this.directory)!==path.join(realRoot,'audio-cache'))throw Error('Linked cache directory');const files=await fs.promises.readdir(this.directory);for(const name of files){const s=await fs.promises.lstat(path.join(this.directory,name));if(s.isSymbolicLink()||!s.isFile())throw Error('Unsafe cache entry');}return files;}
 async remove(key){for(const ext of ['json','wav'])await fs.promises.rm(path.join(this.directory,key+'.'+ext),{force:true});}
 async scan(){const names=await this.files(),items=[];for(const name of names){if(!/^[a-f0-9]{64}\.json$/.test(name))continue;const key=name.slice(0,-5);try{const meta=JSON.parse(await fs.promises.readFile(path.join(this.directory,name),'utf8'));const stat=await fs.promises.stat(path.join(this.directory,key+'.wav'));if(!Number.isFinite(meta.created)||!Number.isFinite(meta.used)||meta.created>this.now()||this.now()-meta.created>=this.maxAge||meta.size!==stat.size||stat.size<44)throw Error('Expired or incomplete');items.push({...meta,key,bytes:stat.size+Buffer.byteLength(JSON.stringify(meta))});}catch{await this.remove(key);}}
 for(const name of names){if(/^[a-f0-9]{64}\.wav$/.test(name)&&!items.some(x=>x.key===name.slice(0,-4)))await fs.promises.rm(path.join(this.directory,name),{force:true});}
 items.sort((a,b)=>a.used-b.used);let bytes=items.reduce((n,x)=>n+x.bytes,0);while(bytes>this.maxBytes&&items.length){const old=items.shift();await this.remove(old.key);bytes-=old.bytes;}this.state={bytes,count:items.length,error:''};this.onChange(this.state);return items;}
 refresh(){return this.run(()=>this.scan());}
 get(key){return this.run(async()=>{const items=await this.scan(),item=items.find(x=>x.key===key);if(!item)return null;const data=await fs.promises.readFile(path.join(this.directory,key+'.wav'));if(data.toString('ascii',0,4)!=='RIFF'||data.toString('ascii',8,12)!=='WAVE'||crypto.createHash('sha256').update(data).digest('hex')!==item.hash){await this.remove(key);await this.scan();return null;}const meta={created:item.created,used:this.now(),size:data.length,hash:item.hash};await fs.promises.writeFile(path.join(this.directory,key+'.json'),JSON.stringify(meta));return data;});}
 put(key,data,epoch=this.epoch){return this.run(async()=>{if(epoch!==this.epoch)return;await this.scan();if(data.length+200>this.maxBytes||data.length<44||data.toString('ascii',0,4)!=='RIFF'||data.toString('ascii',8,12)!=='WAVE')return;const meta={created:this.now(),used:this.now(),size:data.length,hash:crypto.createHash('sha256').update(data).digest('hex')};await fs.promises.writeFile(path.join(this.directory,key+'.wav'),data);await fs.promises.writeFile(path.join(this.directory,key+'.json'),JSON.stringify(meta));await this.scan();});}
 clear(){this.epoch++;return this.run(async()=>{for(const name of await this.files()){if(/^[a-f0-9]{64}\.(json|wav)$/.test(name))await fs.promises.rm(path.join(this.directory,name),{force:true});}await this.scan();});}
}
module.exports={AudioCache,cacheKey,MAX_BYTES,MAX_AGE};

})(bundled['./audio-cache'],localRequire);
bundled['./ai-speech']={exports:{}};
(function(module,require){
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

})(bundled['./ai-speech'],localRequire);
(function(module,require){
const {Plugin, Notice, setIcon, PluginSettingTab, Setting, Modal} = require('obsidian');
const {WindowsSpeech,SPEEDS,normalizeSpeed} = require('./speech');
const {normalizePdfText,frameRect} = require('./selection');
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
    on('mousedown',e=>{if(!this.button.contains(e.target) && !this.bar.contains(e.target))this.clearSelection();});
    on('mouseup',e=>{if(!this.button.contains(e.target) && !this.bar.contains(e.target))this.scheduleSelection(e,frame);});
    on('keyup',e=>{if(e.key==='Escape')this.clearSelection();else if(e.key.startsWith('Arrow') || e.key==='Shift')this.scheduleSelection(e,frame);});
    on('selectionchange',()=>{
      if(this.selection?.doc===doc && !this.readSelection(this.selection.target,frame)?.text.trim())this.clearSelection();
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
    if(!target?.closest || !target.isConnected)return null;
    const view=this.app.workspace.activeLeaf?.view,type=view?.getViewType();
    const doc=target.ownerDocument,native=doc.getSelection();
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
    let rect = native?.rangeCount ? native.getRangeAt(0).getBoundingClientRect() : null;
    if (!rect || (!rect.width && !rect.height)) rect = {right:point.x || target.getBoundingClientRect().right,bottom:point.y || target.getBoundingClientRect().bottom};
    if(frame && rect)rect=frameRect(rect,frame.getBoundingClientRect(),frame.clientWidth||1,frame.clientHeight||1);
    this.selection = {text,target,doc,kind};
    this.button.hidden = false;
    this.button.style.left = Math.max(8,Math.min(rect.right+6,window.innerWidth-44))+'px';
    this.button.style.top = Math.max(8,Math.min(rect.bottom+6,window.innerHeight-48))+'px';
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

})(module,localRequire);

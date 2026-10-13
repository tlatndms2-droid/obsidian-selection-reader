# Selection Reader

Obsidian에서 드래그한 글을 Windows 기본 음성 또는 로컬 Supertonic 3 AI 음성으로 읽는 Windows 데스크톱 플러그인입니다.

## 설치

1. Releases에서 `main.js`, `manifest.json`, `styles.css`를 받습니다.
2. 사용할 Vault의 `.obsidian/plugins/selection-reader/` 폴더에 세 파일을 넣습니다.
3. Obsidian을 다시 열고 **설정 → 커뮤니티 플러그인 → Selection Reader**를 켭니다.

모바일과 macOS는 지원하지 않습니다. 실제 Sandbox 검증은 Windows와 Obsidian 1.14.4에서 수행했습니다.

## 사용

- 노트, Canvas 텍스트·노트 카드, 텍스트 선택이 가능한 PDF에서 글을 드래그하고 옆의 스피커 버튼을 누릅니다.
- 아래 재생 막대에서 일시정지, 이어듣기, 정지와 배속을 조절합니다.
- 속도는 0.50~2.00배, 0.05배 간격입니다. 재생 중 바꾼 속도는 현재 낭독에만 적용됩니다.
- **설정 → Selection Reader**에서 기본 속도와 음성 방식을 고릅니다.

## 로컬 AI 음성

- AI 음성을 처음 선택하면 Python 실행 환경과 Supertonic 모델을 다운로드합니다. 최초 설치에는 인터넷과 최소 2GB의 여유 공간이 필요합니다.
- 모델 자체는 약 382.7MB이며 실행 환경은 별도로 공간을 사용합니다. 설치 후 낭독은 로컬 컴퓨터에서 실행됩니다.
- 10개 목소리와 모델이 지원하는 31개 언어를 선택할 수 있습니다. 읽기 언어는 직접 고릅니다.
- 선택한 글 전체의 음성을 준비한 뒤 재생합니다. 첫 낭독의 준비 시간은 글 길이와 컴퓨터 상태에 따라 달라집니다.
- 같은 글·목소리·언어의 음성은 최대 100MB·24시간 임시 보관하여 다시 읽을 때 재사용합니다. **임시 음성 비우기**로 삭제할 수 있습니다.
- 기본 5분 동안 사용하지 않으면 AI 메모리를 해제합니다. 1·5·10·30분 중 설정할 수 있고, 일시정지 중에는 유지합니다.
- 모델과 임시 음성은 Vault 밖의 사용자 앱 데이터 폴더에 저장합니다. 임시 음성에는 읽은 내용이 오디오로 남으며, 원본 문서의 내용은 수정하지 않습니다.
- **모델 삭제**는 확인 창을 거쳐 모델 파일만 지웁니다. 낭독 중에는 삭제할 수 없습니다.

스캔 PDF의 문자 인식, 이미지·수식 읽기, 웹페이지 카드와 다른 플러그인의 특수 화면은 지원하지 않습니다.

## 소스 빌드와 검사

Node.js가 필요합니다. 이 폴더에서 실행합니다.

```sh
node build.cjs
node --check main.js
node --test speech.test.cjs selection.test.cjs ai-speech.test.cjs model-store.test.cjs audio-cache.test.cjs
```

24개 자동 검사와 격리된 Obsidian Sandbox의 실제 낭독·설정·재시작 검증을 수행했습니다. 이 릴리즈에서 BRAT 설치 검증은 수행하지 않았습니다.

## 타사 코드

Supertonic helper 코드를 포함하며 MIT 저작권 고지는 `SUPERTONIC-LICENSE`에 보존했습니다. 모델은 설치할 때 별도로 다운로드하며 해당 모델의 LICENSE도 함께 보관합니다. 모델 파일, 개인 Vault, 테스트 음성과 로컬 실행 환경은 저장소에 포함하지 않습니다.

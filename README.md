# Scraping Lambda

GitHub Actions 기반 네이버 플레이스 크롤링 서비스

## 📋 개요

이 프로젝트는 네이버 플레이스 검색 결과를 크롤링하여 업체의 순위, 리뷰 수, 블로그 리뷰 수 등을 수집합니다.

**🕐 스케줄: 매일 오후 2시 (KST) 자동 실행**

## 🚀 기능

- 네이버 플레이스 키워드 검색
- 특정 업체의 순위 확인 (300위까지)
- 방문자 리뷰 수 수집
- 블로그 리뷰 수 수집
- 점진적 스크롤링 (100개 단위)
- **병렬 처리** (동시 3개 브라우저)
- **Supabase 연동** (키워드 조회, 결과 저장)

---

## 🔧 GitHub Actions 설정 (권장)

### 1단계: GitHub Repository Secrets 설정

GitHub Repository의 Settings → Secrets and variables → Actions 에서 다음 시크릿을 추가합니다:

| Secret Name | 설명 | 예시 |
|-------------|------|------|
| `SUPABASE_URL` | Supabase 프로젝트 URL | `https://xxxxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Service Role Key | `eyJhbG...` |

### 2단계: Repository에 푸시

```bash
git add .
git commit -m "feat: add github actions workflow"
git push origin main
```

### 3단계: Actions 탭에서 확인

Repository의 Actions 탭에서 workflow 실행 상태를 확인할 수 있습니다.

### 수동 실행 방법

1. Repository → Actions 탭 이동
2. "Daily Keyword Ranking Scraping" workflow 선택
3. "Run workflow" 버튼 클릭
4. (선택) 디버그 모드 활성화
5. "Run workflow" 실행

### 스케줄 변경

`.github/workflows/scrape.yml` 파일에서 cron 표현식 수정:

```yaml
on:
  schedule:
    - cron: '0 5 * * *'  # UTC 05:00 = KST 14:00
```

| 원하는 시간 (KST) | Cron 표현식 (UTC) |
|-------------------|-------------------|
| 오전 9시 | `0 0 * * *` |
| 오후 2시 | `0 5 * * *` |
| 오후 6시 | `0 9 * * *` |
| 자정 | `0 15 * * *` |

### GitHub Actions 로그 확인

1. Repository → Actions 탭
2. 실행된 workflow 클릭
3. "scrape" job 클릭
4. 각 step의 로그 확인

---

## 📁 프로젝트 구조

```
scraping-lambda/
├── src/
│   ├── index.ts              # Lambda 핸들러 (배치 + API)
│   ├── test-local.ts         # 로컬 테스트 스크립트
│   └── lib/
│       ├── types.ts          # 타입 정의
│       ├── scraper.ts        # 크롤링 로직
│       ├── supabase.ts       # Supabase 클라이언트
│       ├── database.types.ts # DB 타입 정의
│       └── keyword-service.ts # 키워드/결과 서비스
├── template.yaml             # SAM 템플릿 (스케줄 설정 포함)
├── deploy-sam.bat            # Windows 배포 스크립트
├── deploy-sam.sh             # Linux/Mac 배포 스크립트
├── package.json
├── tsconfig.json
└── README.md
```

## ⏰ 스케줄 설정

**EventBridge 스케줄**: 매일 오후 2시 (KST)

```yaml
# template.yaml
Schedule: cron(0 5 * * ? *)  # UTC 05:00 = KST 14:00
```

스케줄 변경이 필요하면 `template.yaml`의 cron 표현식을 수정하세요:

| 원하는 시간 (KST) | Cron 표현식 (UTC) |
|-------------------|-------------------|
| 오전 9시 | `cron(0 0 * * ? *)` |
| 오후 2시 | `cron(0 5 * * ? *)` |
| 오후 6시 | `cron(0 9 * * ? *)` |
| 자정 | `cron(0 15 * * ? *)` |

## 🛠️ 설치

```bash
npm install
```

## 🔧 환경 변수 설정

`.env` 파일 생성:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

## 📦 의존성

- **puppeteer-core**: 헤드리스 브라우저 제어 (Lambda)
- **puppeteer**: 로컬 테스트용 (devDependency)
- **@supabase/supabase-js**: Supabase 클라이언트
- **@sparticuz/chromium**: Lambda용 Chromium

## 🔧 Lambda Layer 설정

Chromium은 별도의 Lambda Layer로 제공됩니다. 자세한 설정 방법은 [LAYER_SETUP.md](LAYER_SETUP.md)를 참고하세요.

## 🧪 로컬 테스트

```bash
npm test
```

테스트 설정 변경 (`src/test-local.ts`):

```typescript
// 테스트 모드: 'single' = 단일 키워드, 'batch' = Supabase에서 전체 조회
const TEST_MODE: 'single' | 'batch' = 'batch';

// 반복 실행 설정
const REPEAT_ENABLED = false;  // 반복 실행 여부
```

## 🏗️ 빌드

```bash
npm run build
```

컴파일된 파일은 `dist/` 폴더에 생성됩니다.

## 🚀 배포 (SAM)

### 사전 요구사항

- AWS CLI 설치 및 설정
- AWS SAM CLI 설치

### 환경 변수 설정

```bash
# Windows
set SUPABASE_URL=https://your-project.supabase.co
set SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Linux/Mac
export SUPABASE_URL=https://your-project.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

### 배포 실행

```bash
# Windows
deploy-sam.bat

# Linux/Mac
chmod +x deploy-sam.sh
./deploy-sam.sh
```

### 배포 결과

배포 완료 시 다음 리소스가 생성됩니다:

- **BatchScrapingFunction**: 매일 오후 2시 자동 실행
- **ApiScrapingFunction**: API Gateway를 통한 수동 실행
- **EventBridge Rule**: 스케줄 트리거
- **CloudWatch Logs**: 로그 그룹 (30일 보관)

### 2. Lambda Layer 연결

Chromium Layer를 Lambda 함수에 연결합니다 ([LAYER_SETUP.md](LAYER_SETUP.md) 참고):

```bash
aws lambda update-function-configuration \
  --function-name scraping-lambda \
  --layers arn:aws:lambda:ap-northeast-2:ACCOUNT_ID:layer:chromium-layer:1
```

### 3. 함수 업데이트

코드 변경 후 업데이트:

```bash
npm run deploy
```

또는 AWS CLI:

```bash
aws lambda update-function-code \
  --function-name scraping-lambda \
  --zip-file fileb://lambda.zip
```

## 🌐 API Gateway 연동

### API 요청 형식

**POST /scrape**

```json
{
  "keyword": "강남 카페",
  "placeId": "1234567890"
}
```

**GET /scrape**

```
?keyword=강남%20카페&placeId=1234567890
```

### 응답 형식

**성공 (200)**

```json
{
  "success": true,
  "keyword": "강남 카페",
  "placeId": "1234567890",
  "rank": 5,
  "reviewCount": 1234,
  "blogCount": 567,
  "timestamp": "2025-12-13T10:30:00.000Z"
}
```

**순위권 밖 (500)**

```json
{
  "success": false,
  "keyword": "강남 카페",
  "placeId": "1234567890",
  "error": "순위권 밖 (검색 결과 300위 이하)",
  "timestamp": "2025-12-13T10:30:00.000Z"
}
```

## ⚙️ Lambda 설정 권장사항

### 메모리

- **최소**: 1024 MB
- **권장**: 2048 MB
- **최적**: 3008 MB (크롤링 속도 향상)

### 타임아웃

- **최소**: 180초 (3분)
- **권장**: 300초 (5분)

### 동시 실행 제한

과도한 요청 방지를 위해 동시 실행 제한 설정 권장

## 🔧 Chromium Lambda Layer

이 프로젝트는 Chromium을 Lambda Layer로 사용합니다. Layer 빌드 및 배포 방법은 [LAYER_SETUP.md](LAYER_SETUP.md)를 참고하세요.

### Layer 빌드

```bash
# Windows
build-layer.bat

# Linux/Mac
./build-layer.sh
```기본 설정:

```
https://n6qcku8deo9md5eg.public.blob.vercel-storage.com/chromium-v131.0.0-pack.tar
```

## 🐛 문제 해결

### 메모리 부족

```
FATAL ERROR: Reached heap limit Allocation failed
```

→ Lambda 메모리 증가 (2048 MB 이상)

### 타임아웃

```
Task timed out after 300.00 seconds
```

→ Lambda 타임아웃 증가 또는 크롤링 범위 축소

### Chromium 다운로드 실패

→ `CHROMIUM_URL` 환경 변수 확인 또는 Lambda Layer 사용

## 📊 성능 최적화

1. **Chromium 경로 캐싱**: 콜드 스타트 시간 단축
2. **점진적 스크롤링**: 100개 단위로 확인하여 조기 종료
3. **모바일 User Agent**: 가벼운 페이지 로드
4. **Lambda 메모리 증가**: 실행 속도 향상

## 📝 라이선스

ISC

## 👥 기여

이슈나 PR은 언제든지 환영합니다!

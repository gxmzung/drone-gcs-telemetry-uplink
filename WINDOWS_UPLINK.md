# Windows Field Uplink

최신 GCS Telemetry Uplink에 Windows 현장 실행, RTSP TCP proxy,
JSONL 증적 로그 기능을 추가한 구성이다.

## 1. 기본 구조

Mission Planner / GCS
→ UDP 14551
→ Uplink
→ Core HTTP telemetry API

영상 사용 시:

RTSP Client
→ GCS PC TCP 9554
→ RTSP TCP Proxy
→ 실제 RTSP Source

## 2. 실행

현장 PC에서 config.example.bat을 config.bat으로 복사한 뒤 환경에 맞게 수정한다.

실행:
start.bat

Portable 패키지 생성은 Windows PowerShell에서 실행한다.

npm run portable

생성된 portable 폴더에는 node.exe가 포함되므로
현장 PC에서 별도 Node.js 설치가 필요하지 않다.

## 3. UDP / Core

기본값:

GCS_UDP_HOST=0.0.0.0
GCS_UDP_PORT=14551
TELEMETRY_SERVER_URL=http://127.0.0.1:18020/internal/v1/telemetry/drone

실제 배치 시 Core 주소에 맞게 TELEMETRY_SERVER_URL을 변경한다.

## 4. RTSP TCP Proxy

실제 RTSP source가 확정되기 전에는 비활성 상태로 둔다.

RTSP_PROXY_ENABLED=false

활성화 시 다음 값을 현장 환경에 맞게 설정한다.

RTSP_PROXY_ENABLED=true
RTSP_LISTEN_HOST=0.0.0.0
RTSP_LISTEN_PORT=9554
RTSP_SOURCE_HOST=127.0.0.1
RTSP_SOURCE_PORT=8554

현재 구현은 RTSP-over-TCP용 양방향 TCP proxy이다.

RTP/UDP media relay가 필요한 카메라는 별도 현장 검증이 필요하다.

## 5. 현장 증적 로그

일반 Uplink 이벤트:

logs/uplink-YYYY-MM-DD.jsonl

MAVLink frame 단위 증적:

logs/device-events-YYYY-MM-DD.jsonl

frame 단위 로그는 수락시험 또는 장애 분석 시에만 활성화한다.

UPLINK_DEVICE_LOG_ENABLED=true

장시간 운용 시 로그량과 디스크 I/O가 증가할 수 있으므로
일반 운용에서는 false를 권장한다.

## 6. 현재 검증 상태

로컬 검증 완료:

- telemetry/MAVLink/link-quality 기존 테스트
- RTSP TCP 양방향 relay
- JSONL 파일 생성 및 JSON parsing
- RTSP disabled 상태 runtime start/stop
- NET-01 UDP → HTTP path evidence 유지

현장 검증 필요:

- Windows 실제 PC portable 실행
- Mission Planner 실제 UDP 입력
- 실제 RTSP 카메라 연결
- 실기체 비행 텔레메트리
- 장시간 로그 용량 및 성능

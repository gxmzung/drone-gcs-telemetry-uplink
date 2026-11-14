# 회사 원본 동기화 기록

2026-11-14 기준 sonjh-github/drone-gcs-telemetry-uplink의 b801cc13daf1db630472ead445cba523f6820447를 개인 포크에 반영한다.

동기화 전 개인 main에만 있는 커밋은 0개였다. Windows 현장 실행·휴대용 구성·RTSP 증빙·Core 자동 failover/failback 변경을 포함한다. 회사 원본에는 GitHub 배포 워크플로가 없었으며 개인 포크에는 자동 시험 CI만 추가한다. 이 워크플로는 업링크 실행·실제 Core 전송·서버 배포를 하지 않는다.

자동 시험은 모사 메시지·로컬 시험 서버를 이용하며 실제 드론·LTE·Wi-Fi 통신 성공을 뜻하지 않는다. Windows portable 빌드와 현장 장비 통합은 별도 검증한다. 실제 실행 전 GCS 입력 포트와 Core 수신 주소를 확인한다. 운영 장비·서버·DB 설정은 소스 동기화에 포함하지 않는다.

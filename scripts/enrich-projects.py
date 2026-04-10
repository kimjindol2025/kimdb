#!/usr/bin/env python3
"""
주요 프로젝트 summary / reuse_as / maturity 일괄 등록
실제 README + package.json + 소스 파일 읽어서 채움
"""
import os, json, urllib.request, urllib.parse

KIMDB_URL = "http://localhost:40000"

def read_file(path, limit=3000):
    try:
        with open(path, encoding="utf-8", errors="ignore") as f:
            return f.read(limit)
    except:
        return ""

def kimdb_get(pid):
    try:
        url = f"{KIMDB_URL}/api/c/projects/{urllib.parse.quote(pid, safe='')}"
        with urllib.request.urlopen(url, timeout=3) as r:
            return json.loads(r.read())
    except:
        return {}

def kimdb_put(pid, data):
    body = json.dumps({"data": data}, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        f"{KIMDB_URL}/api/c/projects/{urllib.parse.quote(pid, safe='')}",
        data=body,
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="PUT"
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return json.loads(r.read())
    except Exception as e:
        return {"error": str(e)}

# ─────────────────────────────────────────────
# 수동 정의 (README 읽고 정리한 내용)
# ─────────────────────────────────────────────
ENRICHMENTS = {
  "freelang-c": {
    "maturity": "beta",
    "reuse_as": "Node.js 없이 동작하는 순수 C 임베디드 스크립팅 엔진 — 외부 의존성 0, /usr/local/bin/fl 설치 완료",
    "summary": "순수 C로 작성된 FreeLang 런타임. 렉서→파서→컴파일러→VM→GC 전체 파이프라인 C 구현. SMTP·HTTP·JSON·암호화·SIMD 내장, npm 패키지 0개. `fl run file.fl` 단일 바이너리로 실행."
  },
  "freelang-v4-runtime": {
    "maturity": "beta",
    "reuse_as": "TypeScript 기반 FreeLang VM — Node.js 환경에서 .fl 파일 실행, web-repl HTTP API 포트 30003",
    "summary": "FreeLang v4 TypeScript 구현체. 렉서·파서·타입체커·컴파일러·스택VM 포함. async/await·채널·액터 모델 지원. web-repl 서버(포트 30003)로 HTTP POST /api/run 엔드포인트 제공."
  },
  "freelang-v2-unique-entropier": {
    "maturity": "production",
    "reuse_as": "FreeLang v2 공식 구현 — 한글 식별자, 176/176 테스트 통과, 가장 안정적인 FreeLang 버전",
    "summary": "FreeLang v2.8.0 공식 저장소. 한글 식별자 완전 지원, 176개 테스트 100% 통과. 자가호스팅 부트스트랩 증명 완료. 가장 안정적인 FreeLang 레퍼런스 구현체."
  },
  "freelang-ledger-v1": {
    "maturity": "production",
    "reuse_as": "다국어 코드 생성 원장 — 14개 언어 자동 생성, 73/73 테스트, 포트 10000 Docker 배포",
    "summary": "FreeLang 기반 코드-문서 원장. 11,300줄, 73개 테스트 통과. 14개 언어(Go/Rust/Python/TS 등) 동시 코드 생성. Docker 포트 10000, Phase 1~10 완료, A+ Grade."
  },
  "freelang-self-hosting-proof": {
    "maturity": "production",
    "reuse_as": "자가호스팅 증명 레퍼런스 — v1→v2→v3 부트스트랩 8단계 검증 완료",
    "summary": "FreeLang 자가호스팅 증명 저장소. FreeLang으로 FreeLang 컴파일러를 컴파일하는 8단계 부트스트랩 완전 검증. 결정론적 해시 일치 확인."
  },
  "freelang-deployer": {
    "maturity": "production",
    "reuse_as": "4개 언어(Node/Zig/C/FreeLang) 동일 API 구현 비교 레퍼런스",
    "summary": "동일한 REST API를 Node.js·Zig·C·FreeLang 4가지 언어로 구현한 비교 증명 프로젝트. 성능·코드량·의존성 비교 데이터 포함."
  },
  "pyfree": {
    "maturity": "production",
    "reuse_as": "Python 문법 기반 자가호스팅 언어 — CPython 대비 7배 빠른 실행, 15,476줄",
    "summary": "Python 문법을 사용하는 자가호스팅 언어 구현. CPython 대비 7배 성능 향상. 15,476줄, 순수 C 런타임. FreeLang 패밀리 중 Python 개발자 진입점."
  },
  "fv-lang": {
    "maturity": "experimental",
    "reuse_as": "FreeLang + V 언어 통합 실험 — V 언어 문법을 FreeLang VM에서 실행",
    "summary": "FreeLang과 V 언어를 통합하는 실험적 런타임. V 언어의 간결한 문법을 FreeLang VM 위에서 실행하는 하이브리드 접근."
  },
  "flreact": {
    "maturity": "experimental",
    "reuse_as": "FreeLang으로 구현한 React 스타일 UI 라이브러리 — 가상 DOM, 컴포넌트, 상태관리",
    "summary": "React 패러다임을 FreeLang으로 재구현한 실험적 UI 프레임워크. 가상 DOM, 컴포넌트 시스템, useState/useEffect 구현."
  },
  "kimdb": {
    "maturity": "production",
    "reuse_as": "프로젝트 메타데이터 스토어 — REST/WebSocket API, 현재 158개 프로젝트 관리 중 (포트 40000)",
    "summary": "SQLite 기반 고성능 실시간 협업 DB. 909K INSERTs/sec, 8샤드 병렬, CRDT 실시간 동기화, WebSocket 멀티클라이언트. 현재 포트 40000에서 실제 운영 중."
  },
  "dns-manager": {
    "maturity": "production",
    "reuse_as": "PowerDNS 기반 서브도메인 자동 생성 API — dclub.kr 서브도메인 관리, certbot HTTPS 자동화",
    "summary": "DClub 인프라 통합 DNS 관리 시스템. PowerDNS API 연동, 서브도메인 자동 생성, certbot HTTPS 인증서 자동 발급. 웹 UI + REST API + CLI 통합."
  },
  "ssh-hub": {
    "maturity": "production",
    "reuse_as": "SSH 세션 관리 웹 UI — 다중 서버 연결 관리, PM2 운영, Node.js",
    "summary": "여러 서버의 SSH 연결을 웹 브라우저에서 관리하는 허브. 세션 관리, 명령 이력, 서버 상태 모니터링. Node.js + PM2 운영 중."
  },
  "ssh-sftp-server": {
    "maturity": "beta",
    "reuse_as": "SSH/SFTP 서버 구현체 — FreeLang 또는 Node.js 기반 파일 전송 서버",
    "summary": "SSH 및 SFTP 프로토콜 서버 구현. 파일 업로드/다운로드, 디렉토리 탐색, 인증 처리."
  },
  "kimsearch": {
    "maturity": "production",
    "reuse_as": "전문 검색 엔진 — 프로젝트/코드 인덱싱, BM25 랭킹, 웹 API",
    "summary": "로컬 코드베이스 전문 검색 엔진. 인덱서·학습기·랭커 분리 아키텍처. BM25 기반 랭킹, 웹 서버 API 제공."
  },
  "kim-boilerplate": {
    "maturity": "production",
    "reuse_as": "새 Node.js 서비스 시작점 — Fastify+JWT+SQLite+Swagger+Prometheus 5종 세트, 포트 30001",
    "summary": "모든 새 프로젝트의 보일러플레이트. Fastify HTTP 서버, JWT HS256 인증, SQLite WAL, Swagger UI, Prometheus 메트릭, 헬스체크 내장. PM2 ecosystem.config.cjs 포함."
  },
  "gogs-cli": {
    "maturity": "production",
    "reuse_as": "Gogs 저장소 CLI 도구 — 348개 저장소 검색/관리, /usr/local/bin/gogs 전역 설치",
    "summary": "Go 기반 Gogs API CLI. `gogs search <키워드>`로 348개 저장소 즉시 검색. 저장소 생성·삭제·목록·clone URL 조회. gogs.dclub.kr 기본 호스트."
  },
  "language-sdk": {
    "maturity": "beta",
    "reuse_as": "새 프로그래밍 언어 자동 생성 SDK — 소스코드 분석→CIM→언어 생성 E2E 파이프라인",
    "summary": "프로그래밍 언어를 자동으로 설계·생성하는 SDK. 기존 언어 소스 분석→CIM(Common IR)→새 언어 생성. Go·Rust·Python 3개 언어 AST/토큰/문법 추출. Phase 2g+3 완료."
  },
  "grie-engine": {
    "maturity": "beta",
    "reuse_as": "Go 기반 실험적 언어 엔진 — 경량 인터프리터 구현 레퍼런스",
    "summary": "Go로 작성된 실험적 언어 실행 엔진. FreeLang 패밀리 Go 구현체. 벤치마크 및 내부 구현 테스트용."
  },
  "FreeLang_Next_js": {
    "maturity": "beta",
    "reuse_as": "FreeLang 웹 IDE — Next.js 16 + Monaco Editor, 포트 30002, freelang-v4 런타임(포트 30003) 연동",
    "summary": "FreeLang 코드 작성·실행용 웹 IDE. Monaco Editor 문법 강조·자동완성·에러 마커. Next.js 16 기반, /api/run 엔드포인트로 freelang-v4 서버(포트 30003)에 코드 전송 실행."
  },
  "freelang-v4": {
    "maturity": "beta",
    "reuse_as": "FreeLang v4 컴파일러/VM TypeScript 구현 — ts-node로 .fl 실행, Phase 1~6 완료",
    "summary": "FreeLang v4 TypeScript 구현. 렉서·파서·타입체커·IR·컴파일러·스택VM 완성. async/await·채널·제네릭·trait 구현. 150/156 테스트 통과(96%). web-repl 서버 내장."
  },
  "c-compiler-project": {
    "maturity": "beta",
    "reuse_as": "C 자체호스팅 컴파일러 — Phase 2 완료, 179+ 테스트, C로 C 컴파일러 구현 레퍼런스",
    "summary": "C로 작성한 C 컴파일러. 자체호스팅(C로 C 컴파일러를 컴파일) 완성. Phase 2 100%, 179개 이상 테스트 통과."
  },
  "minrust": {
    "maturity": "production",
    "reuse_as": "Rust→C 자체호스팅 컴파일러 — 294+ 테스트, Phase 6 100%, Rust 서브셋 C 코드 생성",
    "summary": "Rust 서브셋을 C로 컴파일하는 자체호스팅 컴파일러. Phase 6 완료, 294개 테스트 통과. Rust 문법 파싱→AST→C 코드 생성 파이프라인."
  },
  "zig-multi-backend": {
    "maturity": "beta",
    "reuse_as": "Zig 멀티 백엔드 컴파일러 — RISC-V/x86-64/ARM64/LLVM IR 4개 타겟, 40+ 테스트",
    "summary": "Zig으로 구현한 4개 아키텍처 동시 지원 컴파일러. RISC-V·x86-64·ARM64·LLVM IR 백엔드. 40개 이상 테스트 통과. 크로스 컴파일 레퍼런스."
  },
  "dclub-sdk": {
    "maturity": "production",
    "reuse_as": "DClub 서비스 통합 TypeScript SDK — JWT 멀티테넌트·KimNexus 로깅·공통 유틸",
    "summary": "DClub 인프라 통합 TypeScript SDK. JWT 발급·검증, 멀티테넌트 지원, KimNexus 로깅 통합. 모든 DClub 서비스의 공통 인증·로깅 레이어."
  },
  "pika-db": {
    "maturity": "production",
    "reuse_as": "LSM Tree KV Store — WAL+SSTable+BloomFilter, 임베디드 고성능 스토리지 엔진",
    "summary": "FreeLang으로 구현한 LSM Tree 기반 KV 스토어. WAL 로그·SSTable·BloomFilter·Compaction 완성. 임베디드 고성능 스토리지가 필요할 때 재사용."
  },
  "pika-odm": {
    "maturity": "production",
    "reuse_as": "FreeLang 전용 ODM — KPM 등록 패키지, 의존성 0, `import stdlib/pika` 즉시 사용",
    "summary": "pika-db 위에서 동작하는 ODM(Object-Document Mapper). KPM 패키지로 등록됨. FreeLang 프로젝트에서 `import stdlib/pika`로 즉시 데이터 모델링 가능. 외부 의존성 0."
  },
  "c-vite": {
    "maturity": "production",
    "reuse_as": "Node.js 없는 순수 C ESM 개발 서버 — HMR·번들링·TypeScript 변환 내장",
    "summary": "Node.js 없이 동작하는 순수 C 기반 프론트엔드 개발 서버. ESM 모듈·HMR·TypeScript 변환·번들링 내장. 엔터프라이즈 보안 적용. Docker 배포 버전(c-vite-deploy) 별도 존재."
  },
  "polyglot-api": {
    "maturity": "beta",
    "reuse_as": "4개 언어(Python/Go/Rust+WASM/Zig) 617개 API 마이크로서비스 — 언어별 성능 비교 레퍼런스",
    "summary": "동일 API를 Python·Go·Rust+WASM·Zig 4가지 언어로 구현한 마이크로서비스. 617개 API 엔드포인트. 언어별 성능·메모리 사용량 비교 데이터 포함."
  },
  "kpm-api-server": {
    "maturity": "production",
    "reuse_as": "KPM(Korean Package Manager) 레지스트리 서버 — 포트 40013, Selective Fields API",
    "summary": "FreeLang 전용 패키지 매니저(KPM) 레지스트리 API 서버. 포트 40013. 패키지 등록·조회·다운로드. Selective Fields로 필요한 필드만 조회 가능."
  },
  "claudehub": {
    "maturity": "beta",
    "reuse_as": "Multi-Claude 에이전트 모니터링 — WebSocket+PostgreSQL, 포트 50200, 실시간 작업 추적",
    "summary": "여러 Claude 에이전트의 작업을 실시간 모니터링하는 허브. WebSocket 실시간 업데이트, PostgreSQL 영속성, 포트 50200. 에이전트 태스크 생성·완료·에러 추적."
  },
  "health-hub": {
    "maturity": "beta",
    "reuse_as": "1억 헬스체크 허브 — SQLite 10샤드+100리전, 포트 50300, 대규모 서비스 모니터링",
    "summary": "초대규모 서비스 헬스체크 허브. SQLite 10샤드·100리전 분산 처리. 1억 개 엔드포인트 헬스체크 목표. 포트 50300."
  },
  "sovereign-mesh-docker": {
    "maturity": "production",
    "reuse_as": "FreeLang 5계층 메시 네트워크 Docker 배포 — 6,600줄, 18개 테스트 100% 통과",
    "summary": "FreeLang으로 구현한 분산 메시 네트워킹 시스템 Docker 배포 버전. 5계층 아키텍처(Transport·Discovery·Routing·Security·Control). 6,600줄, 18개 테스트 전체 통과."
  },
}

def main():
    print(f"총 {len(ENRICHMENTS)}개 프로젝트 enrich 시작\n")
    ok = 0
    fail = 0

    for pid, enrich in ENRICHMENTS.items():
        # 현재 데이터 가져오기
        current = kimdb_get(pid)
        if not current.get("success") and "data" not in str(current):
            # id로 못 찾으면 name으로 시도
            print(f"  ⚠️  {pid} 조회 실패, 스킵")
            fail += 1
            continue

        existing = current.get("data", {})
        if not existing:
            print(f"  ⚠️  {pid} 데이터 없음, 스킵")
            fail += 1
            continue

        # 기존 데이터에 enrich 필드 추가
        existing.update(enrich)

        result = kimdb_put(pid, existing)
        if result.get("success") or result.get("id"):
            print(f"  ✅ {pid:<45} maturity={enrich['maturity']}")
            ok += 1
        else:
            print(f"  ❌ {pid}: {result}")
            fail += 1

    print(f"\n완료: {ok}개 성공, {fail}개 실패")

if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
16개 프로젝트 kimdb summary/reuse_as/maturity 업데이트 스크립트
실행: python3 update_16_projects.py
"""

import json
import urllib.request
import urllib.parse

KIMDB = "http://localhost:40000"

def get_project(pid):
    safe = urllib.parse.quote(pid, safe='')
    with urllib.request.urlopen(f'{KIMDB}/api/c/projects/{safe}', timeout=5) as r:
        return json.loads(r.read())

def put_project(pid, summary, reuse_as, maturity):
    safe = urllib.parse.quote(pid, safe='')
    res = get_project(pid)
    data = res.get('data', {})
    data.update({'summary': summary, 'reuse_as': reuse_as, 'maturity': maturity})
    body = json.dumps({'data': data}, ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request(
        f'{KIMDB}/api/c/projects/{safe}',
        data=body,
        headers={'Content-Type': 'application/json; charset=utf-8'},
        method='PUT'
    )
    with urllib.request.urlopen(req, timeout=5) as r:
        result = json.loads(r.read())
    ok = result.get('success', result)
    print(f"  ✅ {pid}: {ok}")

UPDATES = [
    # (id, summary, reuse_as, maturity)

    (
        "dns-project",
        "DClub 인프라 통합 관리 API — DNS(PowerDNS)+Nginx+SSL+PM2+Port를 단일 REST API로 제어. "
        "원클릭 서브도메인 배포(POST /v2/deploy), 포트 레지스트리 자동관리, Gogs Webhook CI/CD 파이프라인 포함. "
        "73서버(50000포트) 운영 중, api.dclub.kr 외부 노출.",
        "서브도메인 자동배포 로직, 포트 레지스트리 패턴, Nginx 프록시 자동화 코드 재사용",
        "production"
    ),

    (
        "email-warmup",
        "신규 메일서버 IP 평판 구축용 14일 워밍업 자동화 시스템. "
        "일별 발송량 단계적 증가(10→10000+), cron 기반 daily_warmup.sh, "
        "monitor.sh/weekly_report.sh 모니터링 포함. mclub.kr 도메인 Poste.io 연동.",
        "이메일 워밍업 스케줄 로직, 발송량 점진적 증가 패턴, 메일서버 평판관리 운영 스크립트",
        "production"
    ),

    (
        "emotional-diary",
        "Claude Vision API 기반 멀티모달 감정 분석 일기 플랫폼. "
        "텍스트+음성(Web Speech API)+이미지를 통합 분석해 감정 분류·활동 추천·통계 제공. "
        "React(Vite)+Express+SQLite3 풀스택, 포트 50050, PM2/Docker 배포 완성. "
        "완성도 95%(Claude API JSON 포맷 개선 예정).",
        "Claude AI 감정분석 통합 패턴, React+Express 풀스택 보일러플레이트, 멀티모달 입력 처리 구조",
        "beta"
    ),

    (
        "fir",
        "빠른 언어/인터프리터 실험 프로젝트(fir = fast interpreter runtime). "
        "FreeLang 에코시스템 내 언어 설계 초기 탐색용 저장소로 추정. "
        "독립 실행형 파서/VM 프로토타이핑 목적.",
        "언어 인터프리터 초기 프로토타입 구조 참조",
        "experimental"
    ),

    (
        "flreact",
        "FreeLang + React 통합 확장 라이브러리 — React 컴포넌트 생태계에서 "
        "FreeLang 런타임을 사용하거나 FreeLang 문법으로 React 앱을 작성하기 위한 브릿지 레이어. "
        "04_In_Progress_Projects 분류, 초기 개발 단계.",
        "FreeLang-React 바인딩 패턴, 언어-프레임워크 통합 아키텍처 참조",
        "experimental"
    ),

    (
        "freelang-all",
        "모든 FreeLang 프로젝트 통합 아카이브 메타 저장소. "
        "v2-freelang-ai(224MB), freelang-v6(103MB), freelang-v4(2.2MB), freelang-http-server 등 "
        "주요 저장소 링크 및 클론 방법 집약. Gogs: gogs.dclub.kr/kim/freelang-all. 2026-03-02 생성.",
        "FreeLang 프로젝트 전체 목록 참조, Gogs 저장소 인덱스",
        "production"
    ),

    (
        "freelang-api-framework",
        "FreeLang 환경 경량 REST API 프레임워크 v1.0.0 — JWT 인증+RBAC(admin/user/guest) "
        "미들웨어 파이프라인, 8개 엔드포인트, 메모리 기반 데이터 저장소. "
        "TypeScript(ts-node), 포트 3001. Phase 2(GraphQL/DB/Redis/RateLimit) 계획 중.",
        "JWT+RBAC 미들웨어 패턴, TypeScript REST API 보일러플레이트, 역할기반 권한 구조 재사용",
        "beta"
    ),

    (
        "freelang-archive",
        "FreeLang 구버전 프로젝트 보관 저장소. "
        "v2-freelang-ai, freelang-v6, freelang-v4, freelang-http-server 등의 "
        "로컬 사본과 Gogs 저장소 링크 관리. freelang-all과 동일한 아카이브 역할.",
        "FreeLang 히스토리 참조, 구버전 코드 발굴용",
        "production"
    ),

    (
        "freelang-c",
        "FreeLang C 런타임 v2.7 — 외부 패키지 0개, 19,800+ 줄 순수 C 구현. "
        "Lexer→Parser→Compiler→Stack-VM→GC 완전 파이프라인, Opcode 54개, stdlibs 156+ 함수. "
        "13개 Phase 완료: Crypto(SHA-256/HMAC/PBKDF2), HTTP 보안헤더, SIMD 이미지처리(AVX2/NEON), "
        "PM2대체 프로세스관리, DEFLATE/GZIP 압축, 비동기 로깅, OpenAPI 자동생성, SMTP/RFC5321, "
        "JSON 파서. npm 10개 패키지 대체. GCC -O3 지원.",
        "FreeLang 언어 런타임 코어, C 기반 VM/GC/파서 패턴, Zero-Dependency 라이브러리 설계 참조",
        "production"
    ),

    (
        "freelang-cli-tool",
        "FreeLang 패키지 관리 CLI v1.0.0 — search/install/list/update/init/health 명령어. "
        "KPM(K-Package Manager) 기반 FreeLang 에코시스템 패키지 자동화 도구.",
        "CLI 패키지 관리 패턴, KPM 연동 코드 재사용",
        "beta"
    ),

    (
        "freelang-database-driver",
        "@freelang/database-driver v1.0.0 — SQLite(better-sqlite3)+PostgreSQL(pg) 드라이버. "
        "npm sqlite3/pg 대체 목적 FreeLang 에코시스템용 DB 레이어. "
        "TypeScript, ConnectionPool, QueryBuilder, 마이그레이션 지원. "
        "gogs-architect/lib 내 임베디드로도 사용.",
        "SQLite/PostgreSQL 연결풀 패턴, QueryBuilder 구현, FreeLang DB 통합 코드 재사용",
        "beta"
    ),

    (
        "freelang-deployer",
        "언어 독립성 증명 프로젝트 — 동일한 13개 REST API를 Node.js/Zig/C/FreeLang 4개 언어로 구현. "
        "JWT 인증, 메모리 저장소, 로그 처리 동일 구조. "
        "추가로 FreeLang SSH/SFTP 서버 3종(기본311줄/최적화238줄/엔터프라이즈272줄) 포함. "
        "포트 40998~41001 사용. Gogs: gogs.dclub.kr/kim/freelang-deployer.",
        "멀티언어 동일 API 구현 비교, Zig/C HTTP 서버 패턴, FreeLang SSH/SFTP 구현 참조",
        "production"
    ),

    (
        "freelang-final",
        "FreeLang 자체호스팅 컴파일러 완전 구현 v2.0 — Lexer→Parser→Semantic→IR→x86-64 Codegen→ELF Linker "
        "전체 파이프라인 완성. Binary Convergence(bd75bed8) + Determinism(5f06136b) + Fixed Point 증명. "
        "999개 테스트 98.6% 통과, 92%+ 커버리지. compiler.js(465줄)+compiler-advanced.js(510줄)+linker-complete.fl(531줄).",
        "자체호스팅 컴파일러 파이프라인, ELF 바이너리 생성, IR 3-Address Code 패턴, x86-64 코드생성 참조",
        "production"
    ),

    (
        "freelang-form-core",
        "FreeLang Direct-Bind Form Engine — Zero-npm-Dependency, 구조체 메타데이터 기반 "
        "컴파일타임 검증(@required/@email/@range/@min/@max). Dirty-Bit 트래킹, Zero-Copy SIMD 최적화, "
        "MOSS-UI 자동 바인딩. Phase 1(설계+기본 구조체) 진행 중, Phase 2-5 예정.",
        "컴파일타임 폼 검증 패턴, 구조체 어노테이션 기반 UI 바인딩 아키텍처 참조",
        "experimental"
    ),

    (
        "freelang-http-server",
        "FreeLang 기반 초경량 HTTP 정적 파일 서버 — 4ms 시작(Node.js 대비 30배 빠름), "
        "0.6MB 메모리(Node.js 대비 83배 적음), 멀티스레드 풀(기본 4), "
        "디렉토리 트래버설 방어, MIME 자동감지, HTTP/1.1 준수. "
        "IoT/Raspberry Pi/컨테이너 엣지 컴퓨팅 최적화. npm install -g 지원.",
        "임베디드/엣지용 경량 HTTP 서버, FreeLang 기반 정적 서빙 구조 재사용",
        "beta"
    ),

    (
        "freelang-independent.git",
        "언어 독립성 증명 Git 저장소(bare) — freelang-deployer의 Gogs 독립 저장소 사본. "
        "Node.js/Zig/C/FreeLang 4언어 동일 API 구현 + SSH/SFTP 서버 코드 보관. "
        ".git bare 저장소 형식으로 Gogs 직접 미러용.",
        "멀티언어 비교 구현 참조, bare 저장소 미러링 패턴",
        "production"
    ),
]

def main():
    print(f"kimdb 업데이트 시작 — {len(UPDATES)}개 프로젝트")
    print(f"대상: {KIMDB}\n")

    success = 0
    fail = 0
    for pid, summary, reuse_as, maturity in UPDATES:
        print(f"[{pid}]")
        try:
            put_project(pid, summary, reuse_as, maturity)
            success += 1
        except Exception as e:
            print(f"  ❌ FAIL: {e}")
            fail += 1

    print(f"\n완료 — 성공: {success}, 실패: {fail}")

if __name__ == '__main__':
    main()

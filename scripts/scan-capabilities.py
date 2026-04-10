#!/usr/bin/env python3
"""
프로젝트 capabilities 자동 스캔 → kimdb 업데이트
"""
import os, json, re, subprocess, urllib.request, urllib.error

KIMDB_URL = "http://localhost:40000"

# ───────────────────────────────────────────
# 탐지 규칙
# ───────────────────────────────────────────
CAP_RULES = [
    # 언어/런타임 계층
    ("C 렉서",         lambda f,d: any(n in f for n in ["lexer.c","lexer.h","token.c","token.h"])),
    ("C 파서",         lambda f,d: any(n in f for n in ["parser.c","parser.h","ast.c","ast.h"])),
    ("C 컴파일러",     lambda f,d: any(n in f for n in ["compiler.c","compiler.h","codegen.c"])),
    ("C VM",           lambda f,d: any(n in f for n in ["vm.c","vm.h","bytecode.c"])),
    ("C 런타임",       lambda f,d: any(n in f for n in ["runtime.c","runtime.h","gc.c","stdlib.c"])),
    ("타입체커",       lambda f,d: any(n in f for n in ["typechecker.c","typechecker.h","checker.ts","checker.go"])),
    ("TS VM",          lambda f,d: "vm.ts" in f or "compiler.ts" in f),
    ("REPL",           lambda f,d: any(n in f for n in ["repl.c","repl.ts","repl.go","repl.py"])),
    ("자가호스팅",     lambda f,d: any(x in d for x in ["bootstrap","self-host","selfhost"])),

    # 웹/네트워크
    ("HTTP 서버",      lambda f,d: any(n in f for n in ["server.ts","server.js","server.go","server.c","server.py","app.ts","app.js"])),
    ("REST API",       lambda f,d: any(x in d for x in ["routes","router","endpoint","api"]) or any(n in f for n in ["route.ts","route.go","router.ts"])),
    ("WebSocket",      lambda f,d: any(n in f for n in ["ws.ts","ws.go","websocket"]) or "ws" in d),
    ("GraphQL",        lambda f,d: any(n in f for n in ["schema.graphql","resolver.ts","graphql.ts"]) or "graphql" in d),
    ("Proxy/포워딩",   lambda f,d: any(x in d for x in ["proxy","forward","tunnel","bridge"])),
    ("Next.js",        lambda f,d: "next.config" in f or "app/page.tsx" in f or "pages/" in d),
    ("React",          lambda f,d: any(n in f for n in ["App.tsx","App.jsx","index.tsx"]) and "react" in d),

    # 데이터베이스
    ("SQLite",         lambda f,d: any(n in f for n in ["sqlite","pool.js","pool.ts","db.ts","db.go"]) or ".db" in f),
    ("PostgreSQL",     lambda f,d: "pg" in d or "postgres" in d or "psycopg" in d),
    ("MySQL",          lambda f,d: "mysql" in d or "mariadb" in d),
    ("ORM/마이그레이션", lambda f,d: any(n in f for n in ["migrate.js","migrate.ts","migrate.go","orm.ts","orm.go"])),
    ("CRDT",           lambda f,d: "crdt" in d or "crdt" in f),

    # 인증/보안
    ("JWT 인증",       lambda f,d: any(n in f for n in ["auth.ts","auth.go","auth.js","jwt.ts","jwt.go"])),
    ("RBAC",           lambda f,d: "rbac" in d or "rbac" in f or "role" in d),
    ("OAuth",          lambda f,d: "oauth" in d or "oauth" in f),
    ("암호화",         lambda f,d: any(n in f for n in ["crypto.c","crypto.go","hash.go","hasher.ts"])),

    # 인프라/배포
    ("Docker",         lambda f,d: "Dockerfile" in f or "docker-compose" in f),
    ("PM2",            lambda f,d: "ecosystem.config" in f),
    ("Kubernetes",     lambda f,d: any(n in f for n in ["deployment.yaml","k8s.yaml","helm"]) or "k8s" in d),
    ("CI/CD",          lambda f,d: ".github/workflows" in d or "Makefile" in f),
    ("DNS 관리",       lambda f,d: "powerdns" in d or "dns" in d or any(n in f for n in ["dns.go","dns.js","dns.py"])),

    # CLI/도구
    ("CLI 도구",       lambda f,d: any(n in f for n in ["main.go","cli.go","cmd/main","cli.ts","cli.js"]) or "cobra" in d or "commander" in d),
    ("SSH/SFTP",       lambda f,d: "ssh" in d or "sftp" in d or any(n in f for n in ["ssh.go","sftp.go","ssh.ts"])),

    # AI/ML
    ("LLM 통합",       lambda f,d: any(x in d for x in ["llm","anthropic","openai","claude"]) or any(n in f for n in ["llm.ts","llm.py","claude.ts"])),
    ("임베딩/벡터",    lambda f,d: any(x in d for x in ["embedding","vector","similarity"]) or any(n in f for n in ["embedding.ts","vector.ts"])),
    ("ML 학습",        lambda f,d: any(x in d for x in ["training","autograd","neural","gradient"])),

    # 언어별 스택
    ("Go",             lambda f,d: "go.mod" in f or ".go" in f),
    ("Rust",           lambda f,d: "Cargo.toml" in f or ".rs" in f),
    ("Python",         lambda f,d: "requirements.txt" in f or "pyproject.toml" in f or ".py" in f),
    ("TypeScript",     lambda f,d: "tsconfig.json" in f or ".ts" in f),
    ("C/C++",          lambda f,d: (".c" in f or ".cpp" in f or ".h" in f) and "main.c" in f),
    ("FreeLang",       lambda f,d: ".fl" in f or ".free" in f),

    # 모니터링/관찰
    ("Prometheus 메트릭", lambda f,d: "metrics.ts" in f or "prometheus" in d or "metrics.go" in f),
    ("로깅 시스템",    lambda f,d: any(n in f for n in ["logging.ts","logging.go","logger.ts","logger.go","kimnexus-log"])),
    ("Swagger/API문서",lambda f,d: any(n in f for n in ["swagger.ts","swagger.js","openapi.json","swagger.json"])),
]

# 수동 overrides (자동 탐지가 어려운 경우)
MANUAL_CAPS = {
    "freelang-c":      ["C 렉서","C 파서","C 컴파일러","C VM","C 런타임","타입체커","가비지컬렉터","stdlib 1737줄","외부의존성 0"],
    "freelang-v4":     ["TS VM","TS 컴파일러","TS 렉서","TS 파서","타입체커","WebSocket REPL","HTTP API","async/await","채널/액터","SQLite ORM"],
    "freelang-next-js":["Next.js IDE","Monaco Editor","FreeLang 문법강조","자동완성","WebSocket","프록시 API"],
    "FreeLang_Next_js":["Next.js IDE","Monaco Editor","FreeLang 문법강조","자동완성","WebSocket","프록시 API"],
    "kimdb":           ["SQLite","WebSocket","CRDT","REST API","실시간 동기화","컬렉션 기반 DB"],
    "kim-boilerplate": ["Fastify","JWT 인증","SQLite","Swagger","Prometheus 메트릭","헬스체크","CORS","마이그레이션"],
    "shared-libs":     ["캐싱(LRU/TTL)","Config 관리","JWT+RBAC+OAuth2","구조화 로깅","메트릭 수집","DB 커넥션풀","6개 모듈 1605줄"],
    "gogs-cli":        ["Go CLI","Gogs API 클라이언트","348개 저장소 검색","저장소 CRUD","cobra 명령어"],
    "kim-explore":     ["151개 프로젝트 탐색","trending","검색","통계","CLI"],
    "dns-manager":     ["PowerDNS API","서브도메인 자동생성","HTTPS certbot","웹 UI","API 토큰 관리"],
    "ssh-hub":         ["SSH 연결 관리","웹 UI","PM2","세션 관리","Node.js"],
    "language-sdk":    ["언어 분석기","CIM 생성","언어 자동생성","E2E 파이프라인","BNF/PEG 추출","10개언어 지원"],
    "freelang-korean": ["K-FreeLang","한글 문법","K-StdLib 594함수","46모듈","GraphQL Federation","벡터검색"],
    "kimsearch":       ["전문검색","인덱서","학습기","랭킹","웹 서버"],
    "grie-engine":     ["Go 언어","실험적 엔진"],
    "kim-boilerplate": ["Fastify","JWT","SQLite","Swagger","PM2","마이그레이션","헬스체크"],
    "secure-hasher":   ["암호화","해시","보안"],
    "moss-state-core": ["상태 관리"],
    "synaptic-pilot":  ["AI 통합","TypeScript"],
}

def scan_project(path):
    """디렉토리 스캔 → capabilities 추출"""
    if not path or not os.path.isdir(path):
        return []

    # 파일명 목록 (최대 2depth)
    all_files = []
    all_dirs = []
    try:
        for root, dirs, files in os.walk(path):
            depth = root.replace(path, "").count(os.sep)
            if depth > 2:
                dirs.clear()
                continue
            # node_modules, .git 제외
            dirs[:] = [d for d in dirs if d not in ["node_modules",".git","dist","__pycache__",".next"]]
            for fname in files:
                rel = os.path.relpath(os.path.join(root, fname), path)
                all_files.append(rel)
            all_dirs.extend([d.lower() for d in dirs])
    except PermissionError:
        return []

    files_flat = " ".join(all_files).lower()
    dirs_flat  = " ".join(all_dirs).lower()

    caps = []
    for cap_name, rule in CAP_RULES:
        try:
            if rule(files_flat, dirs_flat):
                caps.append(cap_name)
        except:
            pass
    return caps

def get_line_stats(path):
    """주요 소스 파일 라인수 합계"""
    if not path or not os.path.isdir(path):
        return 0
    total = 0
    exts = {".ts",".js",".go",".py",".c",".h",".rs",".fl",".free"}
    try:
        for root, dirs, files in os.walk(path):
            dirs[:] = [d for d in dirs if d not in ["node_modules",".git","dist","__pycache__",".next"]]
            for fname in files:
                if any(fname.endswith(e) for e in exts):
                    fpath = os.path.join(root, fname)
                    try:
                        with open(fpath, "rb") as f:
                            total += f.read().count(b"\n")
                    except:
                        pass
    except:
        pass
    return total

def kimdb_get(project_id):
    try:
        req = urllib.request.Request(f"{KIMDB_URL}/api/c/projects/{project_id}")
        with urllib.request.urlopen(req, timeout=3) as r:
            return json.loads(r.read())
    except:
        return None

def kimdb_put(project_id, data):
    body = json.dumps({"data": data}, ensure_ascii=False).encode("utf-8")
    import urllib.parse
    safe_id = urllib.parse.quote(project_id, safe="")
    req = urllib.request.Request(
        f"{KIMDB_URL}/api/c/projects/{safe_id}",
        data=body,
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="PUT"
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return json.loads(r.read())
    except Exception as e:
        return {"error": str(e)}

def main():
    # 전체 프로젝트 가져오기
    req = urllib.request.Request(f"{KIMDB_URL}/api/c/projects")
    with urllib.request.urlopen(req, timeout=5) as r:
        all_projects = json.loads(r.read())["data"]

    print(f"총 {len(all_projects)}개 프로젝트 스캔 시작\n")

    updated = 0
    skipped = 0

    for proj in all_projects:
        pid   = proj["id"]
        pname = proj.get("name","")
        path  = proj.get("path","")

        # 수동 override 있으면 우선 사용
        manual = MANUAL_CAPS.get(pid) or MANUAL_CAPS.get(pname) or MANUAL_CAPS.get(path.split("/")[-1] if path else "")
        if manual:
            caps = manual
        else:
            caps = scan_project(path)

        if not caps:
            skipped += 1
            continue

        # 라인수 추가
        lines = get_line_stats(path)
        if lines > 100:
            caps.append(f"소스코드 {lines:,}줄")

        # kimdb 현재 데이터 + capabilities 병합
        current = kimdb_get(pid)
        if current and current.get("success"):
            existing = current.get("data", {})
        else:
            existing = {k: v for k,v in proj.items() if k not in ["id","_version"]}

        existing["capabilities"] = caps

        result = kimdb_put(pid, existing)
        if result.get("success") or "id" in str(result):
            print(f"  ✅ {pid:<40} → {len(caps)}개 capabilities")
            updated += 1
        else:
            print(f"  ❌ {pid:<40} → {result}")

    print(f"\n완료: {updated}개 업데이트, {skipped}개 스킵")

if __name__ == "__main__":
    main()

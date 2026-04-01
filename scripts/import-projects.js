#!/usr/bin/env node
/**
 * kim-projects.db → kimdb 마이그레이션
 * Claude Code가 curl 한 줄로 프로젝트 조회 가능하게
 */

import Database from 'better-sqlite3';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KIMDB_URL = process.env.KIMDB_URL || 'http://localhost:40000';
const SOURCE_DB = process.env.SOURCE_DB || '/home/kimjin/kim/kim-projects.db';

const src = new Database(SOURCE_DB, { readonly: true });

const projects = src.prepare(`
  SELECT
    project_name,
    status,
    category,
    tech_stack,
    tech_decision,
    description,
    folder_path,
    priority,
    progress,
    gogs_repo_url,
    gogs_repo_path,
    last_work_date,
    status_detail
  FROM projects
  ORDER BY priority ASC, project_name ASC
`).all();

src.close();

console.log(`📦 ${projects.length}개 프로젝트 kimdb로 임포트 시작...`);

let ok = 0, fail = 0;

for (const row of projects) {
  const id = row.project_name.replace(/\s+/g, '-').toLowerCase();

  // Claude가 한눈에 볼 수 있는 플랫 구조
  const doc = {
    name: row.project_name,
    status: row.status || '활성중',
    category: parseJson(row.category, ['미분류']),
    tech: parseJson(row.tech_stack, []),
    decision: row.tech_decision && row.tech_decision !== 'TBD' ? row.tech_decision : null,
    desc: row.description || null,
    path: row.folder_path || null,
    gogs: row.gogs_repo_url || null,
    priority: row.priority || 3,
    progress: row.progress || 0,
    last_work: row.last_work_date || null,
    detail: row.status_detail || null,
  };

  try {
    const res = await fetch(`${KIMDB_URL}/api/c/projects/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: doc }),
    });

    if (res.ok) {
      ok++;
      process.stdout.write('.');
    } else {
      fail++;
      const err = await res.text();
      console.error(`\n❌ ${row.project_name}: ${err}`);
    }
  } catch (e) {
    fail++;
    console.error(`\n❌ ${row.project_name}: ${e.message}`);
  }
}

console.log(`\n\n✅ 완료: ${ok}개 성공, ${fail}개 실패`);
console.log(`\n📌 Claude 조회 방법:`);
console.log(`  전체 목록: curl http://localhost:40000/api/c/projects`);
console.log(`  특정 프로젝트: curl http://localhost:40000/api/c/projects/dns-manager`);
console.log(`  상태 검색: curl 'http://localhost:40000/api/c/projects?status=진행중'`);

function parseJson(val, fallback) {
  try { return JSON.parse(val); } catch { return fallback; }
}
